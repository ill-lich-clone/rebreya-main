import { MODULE_ID } from "../constants.js";
import { GROUND_PILE_PRESET_ID } from "./builtin-storage-presets.js";
import { readStorageState } from "./storage-service.js";
import {
  buildStorageContainerRow,
  buildStorageContainerSnapshot,
  createPortableStorageContainerItemData,
  readPortableStorageContainerSnapshot
} from "./storage-container-snapshot.js";

export const STORAGE_CONTAINER_MEMBER_FLAG = "storageContainerMember";
export const STORAGE_CONTAINER_MUTATION_FLAG = "storageContainerMutation";

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function clean(value) {
  return String(value ?? "").trim();
}

function randomId(prefix) {
  const random = globalThis.foundry?.utils?.randomID?.()
    ?? globalThis.crypto?.randomUUID?.()
    ?? Math.random().toString(36).slice(2);
  return `${prefix}-${random}`;
}

function readFlag(document, key) {
  if (typeof document?.getFlag === "function") return document.getFlag(MODULE_ID, key);
  return document?.flags?.[MODULE_ID]?.[key];
}

function itemCollection(actor) {
  const contents = actor?.items?.contents;
  if (Array.isArray(contents)) return contents;
  if (actor?.items && typeof actor.items[Symbol.iterator] === "function") return Array.from(actor.items);
  return [];
}

function collectionValues(collection) {
  if (Array.isArray(collection?.contents)) return collection.contents;
  if (Array.isArray(collection)) return collection;
  if (typeof collection?.values === "function") return Array.from(collection.values());
  return [];
}

function nativeStorageKind(item) {
  const value = clean(item?.system?.type?.value).toLowerCase();
  if (value === "chest") return "chest";
  if (value === "pile") return "pile";
  return "bag";
}

function nativeContainerSnapshot(item) {
  const name = clean(item?.name) || "Хранилище";
  const currency = clone(item?.system?.currency) ?? {};
  return buildStorageContainerSnapshot({
    containerId: `native-${clean(item?.uuid ?? item?.id) || randomId("container")}`,
    storageKind: nativeStorageKind(item),
    name,
    img: clean(item?.img),
    state: {
      baseName: name,
      state: "opened",
      displayMode: "opened",
      manualRows: [],
      generatedRows: [],
      claimedRowIds: [],
      manualCoins: currency,
      generatedCoins: {},
      coinsClaimed: false
    },
    presentation: { itemSystem: clone(item?.system) ?? {} }
  });
}

function plainItemData(item) {
  const data = clone(item?.toObject?.() ?? item) ?? {};
  for (const key of ["_id", "folder", "sort", "ownership", "_stats"]) delete data[key];
  data.flags ??= {};
  data.flags[MODULE_ID] ??= {};
  delete data.flags[MODULE_ID][STORAGE_CONTAINER_MEMBER_FLAG];
  delete data.flags[MODULE_ID][STORAGE_CONTAINER_MUTATION_FLAG];
  data.system ??= {};
  return data;
}

function visibleCoins(state) {
  const keys = ["pp", "gp", "sp", "cp"];
  return Object.fromEntries(keys.map((key) => [
    key,
    state?.coinsClaimed === true
      ? 0
      : Math.max(0, Math.trunc(Number(state?.manualCoins?.[key] ?? 0) + Number(state?.generatedCoins?.[key] ?? 0)))
  ]));
}

function hasCoins(coins) {
  return Object.values(coins ?? {}).some((value) => Number(value) > 0);
}

function memberRowId(item) {
  return clean(readFlag(item, STORAGE_CONTAINER_MEMBER_FLAG)?.rowId) || `item-${clean(item?.id) || randomId("row")}`;
}

function itemQuantity(item) {
  const quantity = Number(item?.system?.quantity ?? item?.toObject?.()?.system?.quantity ?? 1);
  return Number.isSafeInteger(quantity) && quantity >= 1 ? quantity : 1;
}

function containerOptions(snapshot, parentContainerId) {
  const storedSystem = snapshot?.presentation?.itemSystem ?? {};
  const capacity = storedSystem.capacity ?? {};
  const properties = Array.from(storedSystem.properties ?? []);
  return {
    parentContainerId,
    capacityCount: capacity.count ?? 0,
    capacityVolume: capacity.volume?.value ?? (snapshot.storageKind === "bag" ? 30 : 64),
    capacityWeight: capacity.weight?.value ?? (snapshot.storageKind === "bag" ? 30 : 500),
    weight: storedSystem.weight?.value ?? (snapshot.storageKind === "bag" ? 5 : 25),
    weightlessContents: properties.includes("weightlessContents")
  };
}

export function buildStorageContainerSnapshotFromToken(token) {
  const document = token?.document ?? token;
  const state = readStorageState(document);
  const texture = clone(document?.texture ?? token?.texture) ?? {};
  const img = clean(state.textures?.[state.displayMode] ?? texture.src);
  return buildStorageContainerSnapshot({
    containerId: state.containerId,
    storageKind: state.storageKind,
    name: state.baseName,
    img,
    state,
    presentation: {
      actorId: clean(document?.actorId ?? document?.actor?.id ?? token?.actor?.id),
      tokenData: {
        name: clean(document?.name ?? token?.name) || "Сундук",
        width: Number(document?.width ?? token?.width) || 1,
        height: Number(document?.height ?? token?.height) || 1,
        elevation: Number(document?.elevation ?? token?.elevation) || 0,
        rotation: Number(document?.rotation ?? token?.rotation) || 0,
        disposition: Number(document?.disposition ?? token?.disposition) || 0,
        displayName: Number(document?.displayName ?? token?.displayName) || 0,
        displayBars: Number(document?.displayBars ?? token?.displayBars) || 0,
        texture
      }
    }
  });
}

export class StorageContainerItemService {
  constructor({
    resolveScene = (id) => globalThis.game?.scenes?.get?.(id) ?? null,
    resolveActor = (id) => globalThis.game?.actors?.get?.(id) ?? null,
    resolveFallbackActor = () => collectionValues(globalThis.game?.actors).find((actor) => (
      clean(readFlag(actor, "builtinStoragePreset")?.id) === GROUND_PILE_PRESET_ID
    )) ?? null,
    logger = console
  } = {}) {
    this.resolveScene = resolveScene;
    this.resolveActor = resolveActor;
    this.resolveFallbackActor = resolveFallbackActor;
    this.logger = logger;
  }

  #findMutationRoot(actor, mutationId) {
    const id = clean(mutationId);
    if (!id) return null;
    return itemCollection(actor).find((item) => (
      clean(readFlag(item, STORAGE_CONTAINER_MUTATION_FLAG)?.id) === id
    )) ?? null;
  }

  async #createItem(actor, data, createdIds) {
    if (typeof actor?.createEmbeddedDocuments !== "function") {
      throw new TypeError("Актёр не поддерживает создание предметов-контейнеров.");
    }
    const [item] = await actor.createEmbeddedDocuments("Item", [data]);
    if (!item) throw new Error("Созданный предмет-контейнер не найден.");
    createdIds.push(clean(item.id));
    return item;
  }

  async #materializeChildren(actor, parentItem, snapshot, createdIds) {
    const state = snapshot.state ?? {};
    const claimed = new Set((Array.isArray(state.claimedRowIds) ? state.claimedRowIds : []).map(clean));
    const rows = [
      ...(Array.isArray(state.manualRows) ? state.manualRows : []),
      ...(Array.isArray(state.generatedRows) ? state.generatedRows : [])
    ].filter((row) => !claimed.has(clean(row?.rowId)));

    for (const row of rows) {
      if (row?.rowKind === "container" && row.container) {
        const nested = buildStorageContainerSnapshot(row.container);
        const data = createPortableStorageContainerItemData(nested, containerOptions(nested, parentItem.id));
        data.flags[MODULE_ID][STORAGE_CONTAINER_MEMBER_FLAG] = {
          rootContainerId: snapshot.containerId,
          containerId: nested.containerId,
          rowId: clean(row.rowId)
        };
        const child = await this.#createItem(actor, data, createdIds);
        await this.#materializeChildren(actor, child, nested, createdIds);
        continue;
      }

      const data = plainItemData(row?.itemData ?? row);
      const quantity = Math.max(1, Math.trunc(Number(row?.quantity ?? data.system?.quantity ?? 1)) || 1);
      data.name = clean(row?.name ?? data.name) || "Предмет";
      data.img = clean(row?.img ?? data.img);
      data.system.quantity = quantity;
      data.system.container = parentItem.id;
      data.flags[MODULE_ID][STORAGE_CONTAINER_MEMBER_FLAG] = {
        rootContainerId: snapshot.containerId,
        containerId: snapshot.containerId,
        rowId: clean(row?.rowId) || randomId("row")
      };
      await this.#createItem(actor, data, createdIds);
    }
  }

  async materializeToActorOnce(actor, snapshot, mutationId, { parentContainerId = null } = {}) {
    const normalized = buildStorageContainerSnapshot(snapshot);
    const stableMutationId = clean(mutationId) || randomId("storage-container-grant");
    const existing = this.#findMutationRoot(actor, stableMutationId);
    if (existing) return existing;

    const createdIds = [];
    try {
      const rootData = createPortableStorageContainerItemData(
        normalized,
        containerOptions(normalized, parentContainerId)
      );
      rootData.flags[MODULE_ID][STORAGE_CONTAINER_MUTATION_FLAG] = {
        id: stableMutationId,
        kind: "materialize"
      };
      const root = await this.#createItem(actor, rootData, createdIds);
      await this.#materializeChildren(actor, root, normalized, createdIds);
      return root;
    }
    catch (error) {
      if (createdIds.length && typeof actor?.deleteEmbeddedDocuments === "function") {
        try {
          await actor.deleteEmbeddedDocuments("Item", createdIds);
        }
        catch (rollbackError) {
          throw new AggregateError([error, rollbackError], "Не удалось откатить создание контейнера в инвентаре.");
        }
      }
      throw error;
    }
  }

  async captureFromItem(item) {
    if (clean(item?.type) !== "container") {
      throw new Error("Предмет не является переносимым контейнером Rebreya.");
    }
    const actor = item?.parent?.documentName === "Actor" || item?.parent?.type
      ? item.parent
      : item?.actor ?? null;
    const allItems = itemCollection(actor);
    const visit = async (current, ancestors = new Set()) => {
      const base = readPortableStorageContainerSnapshot(current) ?? nativeContainerSnapshot(current);
      const itemId = clean(current.id);
      if (ancestors.has(itemId)) throw new Error("Обнаружен цикл нативных dnd5e-контейнеров.");
      const nextAncestors = new Set(ancestors).add(itemId);
      const children = allItems.filter((candidate) => clean(candidate?.system?.container) === itemId);
      const rows = [];
      for (const child of children) {
        if (clean(child?.type) === "container") {
          rows.push(buildStorageContainerRow(await visit(child, nextAncestors), {
            rowId: memberRowId(child)
          }));
          continue;
        }
        const data = plainItemData(child);
        delete data.system.container;
        const quantity = itemQuantity(child);
        data.system.quantity = quantity;
        rows.push({
          rowKind: "item",
          rowId: memberRowId(child),
          stackKey: clean(child?.flags?.core?.sourceId ?? child?.flags?.dnd5e?.sourceId),
          sourceId: clean(child?.uuid),
          sourceType: clean(child?.type),
          name: clean(child?.name ?? data.name) || "Предмет",
          img: clean(child?.img ?? data.img),
          quantity,
          itemData: data
        });
      }

      const storedState = base.state ?? {};
      if (storedState.state === "unopened") {
        return buildStorageContainerSnapshot({
          ...base,
          name: clean(current?.name) || base.name,
          img: clean(current?.img) || base.img,
          presentation: {
            ...(clone(base.presentation) ?? {}),
            itemSystem: clone(current?.system) ?? {}
          }
        });
      }
      const currency = clone(current?.system?.currency) ?? visibleCoins(storedState);
      return buildStorageContainerSnapshot({
        ...base,
        name: clean(current?.name) || base.name,
        img: clean(current?.img) || base.img,
        state: {
          ...storedState,
          baseName: clean(current?.name) || base.name,
          manualRows: rows,
          generatedRows: [],
          claimedRowIds: [],
          manualCoins: currency,
          generatedCoins: {},
          coinsClaimed: false,
          state: rows.length || hasCoins(currency) ? "opened" : "empty",
          displayMode: rows.length || hasCoins(currency) ? "opened" : "empty"
        },
        presentation: {
          ...(clone(base.presentation) ?? {}),
          itemSystem: clone(current?.system) ?? {}
        }
      });
    };
    return visit(item);
  }

  async removeItemTree(item) {
    const actor = item?.parent?.documentName === "Actor" || item?.parent?.items
      ? item.parent
      : item?.actor ?? null;
    if (!actor) throw new Error("Контейнер не принадлежит инвентарю актёра.");
    const snapshot = await this.captureFromItem(item);
    const rootId = clean(item.id);
    const allItems = itemCollection(actor);
    const descendants = [];
    const collect = (parentId) => {
      for (const child of allItems.filter((candidate) => clean(candidate?.system?.container) === parentId)) {
        collect(clean(child.id));
        descendants.push(clean(child.id));
      }
    };
    collect(rootId);
    const ids = [...descendants, rootId].filter(Boolean);
    if (typeof actor.deleteEmbeddedDocuments === "function") {
      await actor.deleteEmbeddedDocuments("Item", ids);
    }
    else if (typeof item?.delete === "function") {
      for (const id of descendants) await actor.items?.get?.(id)?.delete?.();
      await item.delete();
    }
    else {
      throw new TypeError("Актёр не поддерживает удаление дерева контейнера.");
    }
    return {
      actor,
      actorUuid: clean(actor.uuid),
      parentContainerId: clean(item?.system?.container) || null,
      snapshot
    };
  }

  async restoreItemTree(receipt) {
    if (!receipt?.actor || !receipt?.snapshot) return null;
    return this.materializeToActorOnce(receipt.actor, receipt.snapshot, randomId("storage-container-restore"), {
      parentContainerId: receipt.parentContainerId
    });
  }

  async restoreSnapshotToScene(snapshot, { sceneId, x, y, mutationId } = {}) {
    const normalized = buildStorageContainerSnapshot(snapshot);
    const stableMutationId = clean(mutationId) || randomId("storage-container-scene");
    const scene = await this.resolveScene(clean(sceneId));
    if (!scene || typeof scene.createEmbeddedDocuments !== "function") {
      throw new Error("Сцена для контейнера не найдена.");
    }
    const existing = (scene.tokens?.contents ?? scene.tokens ?? []).find?.((token) => (
      clean(readFlag(token, STORAGE_CONTAINER_MUTATION_FLAG)?.id) === stableMutationId
    )) ?? null;
    if (existing) return existing;

    let actorId = clean(normalized.presentation?.actorId);
    let actor = actorId ? await this.resolveActor(actorId) : null;
    if (!actor) {
      actor = await this.resolveFallbackActor?.();
      actorId = clean(actor?.id);
    }
    if (!actor) throw new Error("Актёр-прототип контейнера не найден.");
    let prototypeData = {};
    if (typeof actor.getTokenDocument === "function") {
      const prototype = await actor.getTokenDocument();
      prototypeData = clone(prototype?.toObject?.() ?? prototype) ?? {};
    }
    const presented = clone(normalized.presentation?.tokenData) ?? {};
    const data = {
      ...prototypeData,
      ...presented,
      actorId,
      actorLink: false,
      name: normalized.storageKind === "chest"
        ? "Сундук"
        : clean(presented.name) || normalized.name,
      x: Number(x),
      y: Number(y),
      texture: {
        ...(clone(prototypeData.texture) ?? {}),
        ...(clone(presented.texture) ?? {}),
        src: clean(normalized.img) || clean(presented.texture?.src) || clean(prototypeData.texture?.src)
      },
      flags: {
        ...(clone(prototypeData.flags) ?? {}),
        ...(clone(presented.flags) ?? {}),
        [MODULE_ID]: {
          ...(clone(prototypeData.flags?.[MODULE_ID]) ?? {}),
          ...(clone(presented.flags?.[MODULE_ID]) ?? {}),
          storage: {
            ...normalized.state,
            containerId: normalized.containerId,
            storageKind: normalized.storageKind
          },
          [STORAGE_CONTAINER_MUTATION_FLAG]: {
            id: stableMutationId,
            kind: "scene-restore"
          },
          ...(normalized.storageKind === "pile" ? { groundPile: { enabled: true } } : {})
        }
      }
    };
    delete data._id;
    if (!Number.isFinite(data.x) || !Number.isFinite(data.y)) {
      throw new Error("Не удалось определить место контейнера на сцене.");
    }
    const [created] = await scene.createEmbeddedDocuments("Token", [data]);
    if (!created) throw new Error("Созданный токен-контейнер не найден.");
    return created;
  }
}
