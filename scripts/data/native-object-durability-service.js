import { WorldMutationCoordinator } from "../application/world-mutation-coordinator.js";
import { MODULE_ID } from "../constants.js";
import {
  applyDurabilityDamage,
  markDurabilityBroken,
  markDurabilityDestroyed
} from "./durability-rules.js";
import { storageObjectKind } from "./storage-object-kind.js";
import { readStorageState } from "./storage-service.js";

export const STORAGE_OBJECT_DURABILITY_FLAG = "objectDurability";

export const CHEST_OBJECT_DURABILITY = Object.freeze({
  version: 1,
  eligible: true,
  state: "intact",
  breakStage: 0,
  materialProfile: "wood",
  construction: "sturdy",
  size: "medium",
  hp: Object.freeze({ value: 18, max: 18 }),
  ac: 15,
  damageThreshold: 0
});

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function clean(value) {
  return String(value ?? "").trim();
}

function ignoredTransition(flag = null) {
  return { outcome: "ignored", nextFlag: clone(flag), appliedDamage: 0 };
}

function readFlag(document, key) {
  try {
    return document?.getFlag?.(MODULE_ID, key) ?? document?.flags?.[MODULE_ID]?.[key];
  }
  catch (_error) {
    return document?.flags?.[MODULE_ID]?.[key] ?? null;
  }
}

function tokenDocumentOf(target) {
  const direct = target?.document ?? target;
  if (direct?.actor && storageObjectKind(direct)) return direct;
  const candidates = [
    direct?.token?.document,
    direct?.token,
    direct?.actor?.token?.document,
    direct?.actor?.token
  ];
  return candidates.map((value) => value?.document ?? value)
    .find((value) => value?.actor && storageObjectKind(value)) ?? null;
}

function itemDocumentOf(target) {
  const document = target?.document ?? target;
  if (document?.documentName === "Item") return document;
  return null;
}

function visibleRows(state) {
  const claimed = new Set(state?.claimedRowIds ?? []);
  return [...(state?.manualRows ?? []), ...(state?.generatedRows ?? [])]
    .filter((row) => !claimed.has(clean(row?.rowId)));
}

function rowDurability(row) {
  return row?.itemData?.flags?.[MODULE_ID]?.durability ?? null;
}

export function normalizeStorageObjectDurability(value = null) {
  const source = value && typeof value === "object" ? value : CHEST_OBJECT_DURABILITY;
  const state = ["intact", "broken", "destroyed"].includes(clean(source.state).toLowerCase())
    ? clean(source.state).toLowerCase()
    : "intact";
  const hpValue = Math.max(0, Math.min(18, Math.trunc(Number(source?.hp?.value ?? 18)) || 0));
  return {
    version: 1,
    eligible: source.eligible !== false,
    state,
    breakStage: state === "destroyed" ? 2 : state === "broken" ? 1 : 0,
    materialProfile: "wood",
    construction: "sturdy",
    size: "medium",
    hp: { value: hpValue, max: 18 },
    ac: 15,
    damageThreshold: 0
  };
}

export function readStorageObjectDurability(token) {
  const document = token?.document ?? token;
  const value = readFlag(document, STORAGE_OBJECT_DURABILITY_FLAG);
  return value && typeof value === "object" ? normalizeStorageObjectDurability(value) : null;
}

function chestProjection(flag) {
  return {
    [`flags.${MODULE_ID}.${STORAGE_OBJECT_DURABILITY_FLAG}`]: clone(flag),
    "delta.system.attributes.hp": {
      value: flag.hp.value,
      max: flag.hp.max,
      dt: flag.damageThreshold
    },
    "delta.system.attributes.ac": { calc: "flat", flat: flag.ac },
    "bar1.attribute": "attributes.hp"
  };
}

export async function ensureStorageObjectDurability(token, {
  isActiveGm = () => true
} = {}) {
  const document = token?.document ?? token;
  if (!document || typeof document.update !== "function") {
    throw new TypeError("Storage token must support updates.");
  }
  if (isActiveGm() !== true) {
    const error = new Error("Изменять прочность объекта может только активный мастер.");
    error.code = "gm-required";
    throw error;
  }
  const next = normalizeStorageObjectDurability(readStorageObjectDurability(document));
  await document.update(chestProjection(next));
  return clone(next);
}

export class NativeObjectDurabilityService {
  constructor({
    durabilityService,
    storageService,
    groundPileService,
    mutationCoordinator = new WorldMutationCoordinator(),
    isActiveGm = () => true,
    resolveUuid = (uuid) => globalThis.fromUuid?.(uuid)
  } = {}) {
    if (!durabilityService || typeof durabilityService.damageItem !== "function") {
      throw new TypeError("NativeObjectDurabilityService requires DurabilityService.");
    }
    if (!storageService || typeof storageService.updateRowDurability !== "function") {
      throw new TypeError("NativeObjectDurabilityService requires StorageService row mutations.");
    }
    this.durabilityService = durabilityService;
    this.storageService = storageService;
    this.groundPileService = groundPileService;
    this.mutationCoordinator = mutationCoordinator;
    this.isActiveGm = isActiveGm;
    this.resolveUuid = resolveUuid;
  }

  #requireActiveGm() {
    if (this.isActiveGm() === true) return;
    const error = new Error("Изменять прочность объекта может только активный мастер.");
    error.code = "gm-required";
    throw error;
  }

  async resolve(target) {
    const document = typeof target === "string" ? await this.resolveUuid(clean(target)) : target;
    const item = itemDocumentOf(document);
    const durability = readFlag(item, "durability");
    if (item && durability?.eligible !== false && durability && typeof durability === "object") {
      return { kind: "item", uuid: clean(item.uuid ?? item.id), item };
    }

    const token = tokenDocumentOf(document);
    const kind = storageObjectKind(token);
    if (!token || !kind) return null;
    if (kind === "chest") {
      return { kind: "chest", uuid: clean(token.uuid ?? token.id), token };
    }

    const state = readStorageState(token);
    const rows = visibleRows(state);
    if (rows.length !== 1) return null;
    const row = rows[0];
    const rowFlag = rowDurability(row);
    if (!rowFlag || rowFlag.eligible === false) return null;
    return {
      kind: "groundItem",
      uuid: `${clean(token.uuid ?? token.id)}#${clean(row.rowId)}`,
      token,
      row: clone(row),
      durability: clone(rowFlag)
    };
  }

  async damage(target, options = {}) {
    this.#requireActiveGm();
    const resolved = await this.resolve(target);
    if (!resolved) return ignoredTransition();
    return this.mutationCoordinator.run(`native-durability:${resolved.uuid}`, async () => {
      if (resolved.kind === "item") {
        return this.durabilityService.damageItem(resolved.item, options);
      }
      if (resolved.kind === "chest") {
        const current = await ensureStorageObjectDurability(resolved.token, { isActiveGm: this.isActiveGm });
        const transition = applyDurabilityDamage(current, options);
        if (transition.outcome !== "ignored") {
          await resolved.token.update(chestProjection(transition.nextFlag));
        }
        return clone(transition);
      }
      const transition = applyDurabilityDamage(resolved.durability, options);
      if (transition.outcome !== "ignored") {
        const state = await this.storageService.updateRowDurability(
          resolved.token,
          resolved.row.rowId,
          transition.nextFlag
        );
        await this.groundPileService?.refreshAfterStorageMutation?.(resolved.token, state);
      }
      return clone(transition);
    });
  }

  async resolveDepletion(target, choice, options = {}) {
    this.#requireActiveGm();
    const resolved = await this.resolve(target);
    if (!resolved || !["broken", "destroyed"].includes(clean(choice))) return ignoredTransition();
    return this.mutationCoordinator.run(`native-durability:${resolved.uuid}`, async () => {
      if (resolved.kind === "item") {
        return choice === "broken"
          ? this.durabilityService.breakItem(resolved.item, options)
          : this.durabilityService.destroyItem(resolved.item, options);
      }
      if (resolved.kind === "chest") {
        if (choice === "destroyed") return this.destroyChest(resolved.token, options);
        const current = await ensureStorageObjectDurability(resolved.token, { isActiveGm: this.isActiveGm });
        const transition = markDurabilityBroken(current);
        if (transition.outcome !== "ignored") await resolved.token.update(chestProjection(transition.nextFlag));
        return clone(transition);
      }
      if (choice === "destroyed") {
        const state = await this.storageService.deleteRow(resolved.token, resolved.row.rowId);
        await this.groundPileService?.refreshAfterStorageMutation?.(resolved.token, state);
        return markDurabilityDestroyed(resolved.durability);
      }
      const transition = markDurabilityBroken(resolved.durability);
      if (transition.outcome !== "ignored") {
        const state = await this.storageService.updateRowDurability(
          resolved.token,
          resolved.row.rowId,
          transition.nextFlag
        );
        await this.groundPileService?.refreshAfterStorageMutation?.(resolved.token, state);
      }
      return clone(transition);
    });
  }

  async destroyChest() {
    throw new Error("Разрушение сундука ещё не подключено.");
  }
}
