import { WorldMutationCoordinator } from "./world-mutation-coordinator.js";

const TERMINAL_CLAIM_LIMIT = 64;

function clone(value) {
  if (value == null) return value;
  if (typeof globalThis.structuredClone === "function") return globalThis.structuredClone(value);
  return JSON.parse(JSON.stringify(value));
}

function cleanId(value) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeState(value, lootId) {
  const state = value && typeof value === "object" && !Array.isArray(value)
    ? clone(value)
    : {};
  state.lootId = cleanId(state.lootId) || cleanId(lootId);
  state.rows = Array.isArray(state.rows) ? state.rows : [];
  state.coins = state.coins && typeof state.coins === "object" ? state.coins : {};
  state.claims = Array.isArray(state.claims) ? state.claims : [];
  return state;
}

function retainClaims(claims) {
  const nonterminal = claims.filter((claim) => claim?.phase !== "committed");
  const terminal = claims.filter((claim) => claim?.phase === "committed").slice(-TERMINAL_CLAIM_LIMIT);
  return [...nonterminal, ...terminal];
}

export class LootClaimService {
  constructor({
    getMessage,
    readState,
    writeState,
    grantRow,
    grantCoins,
    coordinator = new WorldMutationCoordinator()
  } = {}) {
    for (const [name, operation] of Object.entries({ getMessage, readState, writeState, grantRow, grantCoins })) {
      if (typeof operation !== "function") {
        throw new TypeError(`${name} must be a function`);
      }
    }
    this.getMessage = getMessage;
    this.readState = readState;
    this.writeState = writeState;
    this.grantRow = grantRow;
    this.grantCoins = grantCoins;
    this.coordinator = coordinator;
  }

  claimRow(request = {}) {
    return this.#runClaim("row", request);
  }

  claimCoins(request = {}) {
    return this.#runClaim("coins", request);
  }

  async #runClaim(kind, request) {
    const claimId = cleanId(request.claimId);
    const lootId = cleanId(request.lootId);
    const messageId = cleanId(request.messageId);
    const rowId = cleanId(request.rowId);
    if (!claimId || !lootId || (kind === "row" && !rowId)) {
      throw new TypeError("lootId, claimId, and rowId for row claims are required");
    }
    const message = await this.getMessage({ messageId, lootId });
    if (!message) {
      throw new Error("Loot ChatMessage was not found");
    }

    return this.coordinator.run(`loot-claim:${message.id ?? messageId ?? lootId}`, async () => {
      let state = normalizeState(await this.readState(message), lootId);
      if (state.lootId !== lootId) {
        throw new Error("Loot claim does not match the ChatMessage");
      }
      let claim = state.claims.find((entry) => cleanId(entry?.id) === claimId) ?? null;
      if (claim) {
        if (claim.kind !== kind || (kind === "row" && claim.rowId !== rowId)) {
          throw new Error("Loot claim id conflicts with an existing claim");
        }
        if (claim.phase === "committed") {
          return claim.result === true;
        }
      }
      else {
        const alreadyClaimed = kind === "coins"
          ? state.coinsClaimed === true
          : state.rows.find((row) => cleanId(row?.rowId) === rowId)?.claimed === true;
        if (alreadyClaimed) {
          return false;
        }
        if (kind === "row" && !state.rows.some((row) => cleanId(row?.rowId) === rowId)) {
          return false;
        }
        claim = {
          id: claimId,
          kind,
          rowId: kind === "row" ? rowId : "",
          phase: "prepared"
        };
        state.claims.push(claim);
        state.claims = retainClaims(state.claims);
        state = await this.#writeAndConfirm(message, state, claimId, "prepared");
        claim = state.claims.find((entry) => entry.id === claimId);
      }

      if (claim.phase === "prepared") {
        const row = kind === "row"
          ? state.rows.find((entry) => cleanId(entry?.rowId) === rowId)
          : null;
        const receipt = kind === "row"
          ? await this.grantRow({ claimId, lootId, rowId, row: clone(row), message })
          : await this.grantCoins({ claimId, lootId, coins: clone(state.coins), message });
        const next = normalizeState(await this.readState(message), lootId);
        const nextClaim = next.claims.find((entry) => entry.id === claimId);
        if (!nextClaim || nextClaim.phase !== "prepared") {
          if (nextClaim?.phase !== "granted" && nextClaim?.phase !== "committed") {
            throw new Error("Loot claim phase changed while granting value");
          }
        }
        else {
          nextClaim.phase = "granted";
          nextClaim.receipt = clone(receipt);
          state = await this.#writeAndConfirm(message, next, claimId, "granted");
        }
        claim = state.claims.find((entry) => entry.id === claimId) ?? nextClaim;
      }

      if (claim.phase === "granted") {
        state = normalizeState(await this.readState(message), lootId);
        claim = state.claims.find((entry) => entry.id === claimId);
        if (!claim) throw new Error("Loot claim disappeared before commit");
        if (kind === "row") {
          const row = state.rows.find((entry) => cleanId(entry?.rowId) === rowId);
          if (!row) throw new Error("Loot row disappeared before commit");
          row.claimed = true;
        }
        else {
          state.coinsClaimed = true;
        }
        claim.phase = "committed";
        claim.result = true;
        state.claims = retainClaims(state.claims);
        await this.#writeAndConfirm(message, state, claimId, "committed");
        return true;
      }

      if (claim.phase === "committed") {
        return claim.result === true;
      }
      throw new Error(`Unsupported loot claim phase: ${String(claim.phase)}`);
    });
  }

  async #writeAndConfirm(message, state, claimId, expectedPhase) {
    try {
      await this.writeState(message, clone(state));
      return clone(state);
    }
    catch (error) {
      const durable = normalizeState(await this.readState(message), state.lootId);
      const durableClaim = durable.claims.find((claim) => claim.id === claimId);
      if (durableClaim?.phase === expectedPhase) {
        return durable;
      }
      throw error;
    }
  }
}
