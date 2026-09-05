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

function normalizeInventoryPartialFailure(error) {
  const code = cleanId(error?.code);
  const completedSourceKeys = Array.isArray(error?.completedSourceKeys)
    ? error.completedSourceKeys.map(cleanId).filter(Boolean)
    : [];
  const failedSourceKey = cleanId(error?.failedSourceKey);
  const hasStructuredOutcome = Boolean(failedSourceKey)
    || completedSourceKeys.length > 0
    || error?.changed === true;
  if (!new Set(["inventory-ingress-partial", "transfer-manual-review"]).has(code)
    || !hasStructuredOutcome) return null;
  return {
    code,
    message: cleanId(error.message) || "Inventory ingress completed only part of the loot claim.",
    actorId: cleanId(error.actorId),
    batchMutationId: cleanId(error.batchMutationId),
    completedSourceKeys,
    skippedSourceKeys: Array.isArray(error?.skippedSourceKeys)
      ? error.skippedSourceKeys.map(cleanId).filter(Boolean)
      : [],
    failedSourceKey,
    unprocessedSourceKeys: Array.isArray(error?.unprocessedSourceKeys)
      ? error.unprocessedSourceKeys.map(cleanId).filter(Boolean)
      : [],
    changed: error?.changed === true || completedSourceKeys.length > 0,
    rows: Array.isArray(error?.rows) ? clone(error.rows) : [],
    inventoryTransferMode: cleanId(error?.inventoryTransferMode)
  };
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
    grantBatch = null,
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
    if (grantBatch !== null && typeof grantBatch !== "function") {
      throw new TypeError("grantBatch must be a function");
    }
    this.grantBatch = grantBatch ?? (async ({ claimId, lootId, rows, coins, includeCoins, message }) => {
      const acceptedRowIds = [];
      for (const row of rows) {
        const rowId = cleanId(row?.rowId);
        await this.grantRow({ claimId, lootId, rowId, row: clone(row), message });
        acceptedRowIds.push(rowId);
      }
      if (includeCoins) {
        await this.grantCoins({ claimId, lootId, coins: clone(coins), message });
      }
      return {
        acceptedRowIds,
        coinsGranted: includeCoins,
        receipt: { claimId }
      };
    });
    this.coordinator = coordinator;
  }

  async claimRow(request = {}) {
    const rowId = cleanId(request.rowId);
    const result = await this.claimBatch({
      messageId: request.messageId,
      lootId: request.lootId,
      claimId: request.claimId,
      rowIds: rowId ? [rowId] : [],
      includeCoins: false,
      ingressPlan: null
    });
    return result.claimedRowIds.includes(rowId);
  }

  async claimCoins(request = {}) {
    const result = await this.claimBatch({
      messageId: request.messageId,
      lootId: request.lootId,
      claimId: request.claimId,
      rowIds: [],
      includeCoins: true,
      ingressPlan: null
    });
    return result.claimedCoins;
  }

  async claimBatch(request = {}) {
    const claimId = cleanId(request.claimId);
    const lootId = cleanId(request.lootId);
    const messageId = cleanId(request.messageId);
    if (!claimId || !lootId || !Array.isArray(request.rowIds) || typeof request.includeCoins !== "boolean") {
      throw new TypeError("lootId, claimId, rowIds, and includeCoins are required");
    }
    const rowIds = request.rowIds.map(cleanId);
    if (rowIds.some((rowId) => !rowId) || new Set(rowIds).size !== rowIds.length) {
      throw new TypeError("Loot batch rowIds must be unique nonempty strings");
    }
    const ingressPlan = clone(request.ingressPlan ?? null);
    const fingerprint = JSON.stringify({ lootId, rowIds, includeCoins: request.includeCoins, ingressPlan });
    const message = await this.getMessage({ messageId, lootId });
    if (!message) throw new Error("Loot ChatMessage was not found");

    return this.coordinator.run(`loot-claim:${message.id ?? messageId ?? lootId}`, async () => {
      let state = normalizeState(await this.readState(message), lootId);
      if (state.lootId !== lootId) throw new Error("Loot claim does not match the ChatMessage");
      let claim = state.claims.find((entry) => cleanId(entry?.id) === claimId) ?? null;
      if (claim) {
        if (claim.kind !== "batch" || claim.fingerprint !== fingerprint) {
          throw new Error("Loot claim id conflicts with an existing claim");
        }
        if (claim.phase === "committed") return this.#returnBatchResult(claim.result);
      }
      else {
        const availableRowIds = rowIds.filter((rowId) => {
          const row = state.rows.find((entry) => cleanId(entry?.rowId) === rowId);
          return row && row.claimed !== true;
        });
        const includeCoins = request.includeCoins && state.coinsClaimed !== true;
        if (availableRowIds.length === 0 && !includeCoins) {
          return { changed: false, claimedRowIds: [], claimedCoins: false, receipt: null };
        }
        claim = {
          id: claimId,
          kind: "batch",
          fingerprint,
          rowIds: availableRowIds,
          includeCoins,
          ingressPlan,
          phase: "prepared"
        };
        state.claims.push(claim);
        state.claims = retainClaims(state.claims);
        state = await this.#writeAndConfirm(message, state, claimId, "prepared");
        claim = state.claims.find((entry) => entry.id === claimId);
      }

      if (claim.phase === "prepared") {
        const selectedRows = claim.rowIds.map((rowId) => (
          state.rows.find((row) => cleanId(row?.rowId) === rowId)
        )).filter(Boolean);
        let grantResult;
        let partialFailure = null;
        try {
          grantResult = await this.grantBatch({
            claimId,
            lootId,
            rows: clone(selectedRows),
            coins: clone(state.coins),
            includeCoins: claim.includeCoins,
            ingressPlan: clone(claim.ingressPlan),
            message
          });
        }
        catch (error) {
          partialFailure = normalizeInventoryPartialFailure(error);
          if (!partialFailure) throw error;
          grantResult = {
            acceptedRowIds: partialFailure.completedSourceKeys,
            coinsGranted: false,
            receipt: {
              actorId: partialFailure.actorId,
              batchMutationId: partialFailure.batchMutationId || claimId
            }
          };
        }
        const acceptedRowIds = Array.isArray(grantResult?.acceptedRowIds)
          ? grantResult.acceptedRowIds.map(cleanId)
          : [];
        const selectedIds = new Set(claim.rowIds);
        if (acceptedRowIds.some((rowId) => !selectedIds.has(rowId))
          || new Set(acceptedRowIds).size !== acceptedRowIds.length) {
          throw new Error("Loot batch grant returned invalid accepted rows");
        }
        claim.phase = "granted";
        claim.grantResult = {
          acceptedRowIds,
          coinsGranted: grantResult?.coinsGranted === true && claim.includeCoins,
          receipt: clone(grantResult?.receipt ?? null),
          partialFailure: clone(partialFailure),
          inventoryTransferMode: cleanId(grantResult?.inventoryTransferMode)
        };
        state = await this.#writeAndConfirm(message, state, claimId, "granted");
        claim = state.claims.find((entry) => entry.id === claimId);
      }

      if (claim.phase === "granted") {
        const accepted = new Set(claim.grantResult.acceptedRowIds);
        for (const row of state.rows) {
          if (accepted.has(cleanId(row?.rowId))) row.claimed = true;
        }
        if (claim.grantResult.coinsGranted) state.coinsClaimed = true;
        claim.phase = "committed";
        claim.result = {
          changed: accepted.size > 0 || claim.grantResult.coinsGranted,
          claimedRowIds: [...claim.grantResult.acceptedRowIds],
          claimedCoins: claim.grantResult.coinsGranted,
          receipt: clone(claim.grantResult.receipt),
          ...(claim.grantResult.partialFailure
            ? { partialFailure: clone(claim.grantResult.partialFailure) }
            : {}),
          ...(claim.grantResult.inventoryTransferMode
            ? { inventoryTransferMode: claim.grantResult.inventoryTransferMode }
            : {})
        };
        state.claims = retainClaims(state.claims);
        state = await this.#writeAndConfirm(message, state, claimId, "committed");
        claim = state.claims.find((entry) => entry.id === claimId);
      }
      if (claim.phase === "committed") return this.#returnBatchResult(claim.result);
      throw new Error(`Unsupported loot batch claim phase: ${String(claim.phase)}`);
    });
  }

  #returnBatchResult(result) {
    const detached = clone(result);
    const partialFailure = detached?.partialFailure;
    if (!partialFailure) return detached;
    const error = new Error(partialFailure.message || "Inventory ingress completed only part of the loot claim.");
    error.code = partialFailure.code || "inventory-ingress-partial";
    error.details = clone(partialFailure);
    Object.assign(error, clone(partialFailure));
    throw error;
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
