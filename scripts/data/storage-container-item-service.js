import { readLootgenPreparedComposition } from "./lootgen-prepared-item.js?v=1.4.268";
import { normalizeLootgenComposition } from "./lootgen-composition.js?v=1.4.268";
import { buildCompositeItemGraph } from "./composite-item-graph.js?v=1.4.268";
import { buildRuntimeGraphDocuments, materializeRuntimeItemGraph } from "./runtime-item-graph.js?v=1.4.267-native-schema";
import { itemInstanceFingerprint } from "../application/item-instance-workflow.js";
import { WorldMutationCoordinator } from "../application/world-mutation-coordinator.js";
import { MODULE_ID } from "../constants.js";
import { GROUND_PILE_PRESET_ID } from "./builtin-storage-presets.js";
import { readStorageState } from "./storage-service.js";
import {
  buildStorageContainerRow,
  buildStorageContainerSnapshot,
  createPortableStorageContainerItemData,
  isStorageJournalRow,
  readPortableStorageContainerSnapshot
} from "./storage-container-snapshot.js";
import { resolveTopDownItemPresentation } from "./top-down-item-texture-resolver.js?v=1.4.211-furniture-footprints";
import {
  buildGroundPileTokenLayout,
  deterministicStorageTokenRotation
} from "./storage-ground-pile-layout.js?v=1.4.215-container-rotation";

function treeConflict(reason) {
  const error = new Error(`Дерево контейнера требует сверки: ${reason}.`);
  error.code = "storage-container-manual-review";
  throw error;
}

export const STORAGE_CONTAINER_MEMBER_FLAG = "storageContainerMember";
export const STORAGE_CONTAINER_MUTATION_FLAG = "storageContainerMutation";

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function clean(value) {
  return String(value ?? "").trim();
}

function ownedSyntheticActorDelta(delta, ownerUserId) {
  const userId = clean(ownerUserId);
  const next = clone(delta) ?? {};
  if (!userId) return next;
  next.ownership = { ...(next.ownership ?? {}), [userId]: 3 };
  return next;
}

function randomId(prefix) {
  const random = globalThis.foundry?.utils?.randomID?.()
    ?? globalThis.crypto?.randomUUID?.()
    ?? Math.random().toString(36).slice(2);
  return `${prefix}-${random}`;
}

function documentId() {
  const foundryId = globalThis.foundry?.utils?.randomID?.();
  if (clean(foundryId)) return clean(foundryId);
  const random = globalThis.crypto?.randomUUID?.()?.replaceAll("-", "")
    ?? Math.random().toString(36).slice(2).padEnd(16, "0");
  return clean(random).slice(0, 16);
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

function canonicalItemIdentity(item) {
  const source = item?.flags?.[MODULE_ID];
  if (!source || typeof source !== "object" || Array.isArray(source)) return {};
  return Object.fromEntries(["sourceType", "sourceId", "gearId", "materialId"]
    .map((key) => [key, clean(source[key])])
    .filter(([, value]) => value));
}

function containerTopDownPresentation(snapshot) {
  const identity = snapshot?.presentation?.itemIdentity;
  if (!identity || typeof identity !== "object" || Array.isArray(identity)) return null;
  return resolveTopDownItemPresentation({
    itemData: { flags: { [MODULE_ID]: clone(identity) } }
  });
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
    presentation: {
      itemSystem: clone(item?.system) ?? {},
      itemIdentity: canonicalItemIdentity(item)
    }
  });
}

function plainItemData(item) {
  const data = clone(item?.toObject?.() ?? item) ?? {};
  for (const key of ["_id", "id", "uuid", "documentName", "folder", "sort", "ownership", "_stats"]) delete data[key];
  data.flags ??= {};
  data.flags[MODULE_ID] ??= {};
  delete data.flags[MODULE_ID][STORAGE_CONTAINER_MEMBER_FLAG];
  delete data.flags[MODULE_ID][STORAGE_CONTAINER_MUTATION_FLAG];
  data.system ??= {};
  return data;
}

/** Keep native electrum value in the storage currency vocabulary (1 ep = 5 sp). */
function captureCurrency(currency) {
  const result = {};
  for (const key of ["pp","gp","sp","cp","ep"]) {
    const value = currency?.[key] ?? 0;
    if (!Number.isSafeInteger(value) || value < 0) treeConflict("native-currency");
    result[key] = value;
  }
  result.sp += result.ep * 5; delete result.ep;
  if (!Number.isSafeInteger(result.sp)) treeConflict("native-currency-overflow");
  return result;
}

/** Capture only this host and installed upgrades; ordinary contents remain canonical snapshot rows. */
function captureHostData(item, allItems, composition) {
  const data = plainItemData(item), flags = data.flags[MODULE_ID];
  delete flags.storageContainer; delete flags.runtimeItemGraph; delete flags.lootgenComposition;
  const installed = flags.itemUpgrades?.installed ?? [], seen = new Set(), nodes = [{...clone(data),_id:clean(item.id)}];
  if (installed.length && itemQuantity(item) !== 1) treeConflict("stacked-upgrade-host");
  const upgrades = [];
  for (const link of installed) {
    const child = allItems.find(candidate=>candidate.id===link.itemId);
    const binding = readFlag(child,"installedUpgrade");
    if (!child || seen.has(child.id) || child.system?.container !== item.id || binding?.hostItemId !== item.id
      || binding.slotIndex !== link.slotIndex || Number(child.system?.quantity) !== 1) treeConflict("installed-upgrade-link");
    seen.add(child.id);
    const childData = plainItemData(child);
    delete childData.flags[MODULE_ID].runtimeItemGraph;
    if ((childData.flags[MODULE_ID].itemUpgrades?.installed ?? []).length
      || allItems.some(candidate=>candidate.system?.container===child.id)) treeConflict("nested-upgrade-child");
    nodes.push({...childData,_id:child.id});
    const sourceId = clean(readFlag(child,"gearId"));
    const previous = composition?.upgrades?.find(entry=>entry.sourceId===sourceId && entry.slotIndex===link.slotIndex);
    upgrades.push({instanceKey:previous?.instanceKey ?? `native-upgrade:${child.uuid ?? child.id}`,sourceId,
      slotIndex:link.slotIndex,choices:clone(readFlag(child,"upgradeChoices")) ?? {}});
  }
  if (allItems.some(child=>readFlag(child,"installedUpgrade")?.hostItemId===item.id && !seen.has(child.id))) treeConflict("orphan-installed-upgrade");
  if (item.type !== "container" && allItems.some(child=>child.system?.container===item.id && !seen.has(child.id))) treeConflict("ordinary-host-contents");
  if (nodes.length > 1) flags.runtimeItemGraph = {version:1,rootId:clean(item.id),nodes};
  flags.storageCapturedHost = true;
  let metadata;
  if (composition) {
    // Custom installed Items remain physically transferable, but are not advertised as priced catalog compositions.
    try { metadata = normalizeLootgenComposition({...composition,upgrades}); } catch { metadata = undefined; }
  }
  return {data,composition:metadata,installedIds:seen};
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

function unclaimedJournalRows(state) {
  const claimed = new Set((Array.isArray(state?.claimedRowIds) ? state.claimedRowIds : []).map(clean));
  const rowIds = new Set();
  return [
    ...(Array.isArray(state?.manualRows) ? state.manualRows : []),
    ...(Array.isArray(state?.generatedRows) ? state.generatedRows : [])
  ].filter((row) => {
    const rowId = clean(row?.rowId);
    if (!isStorageJournalRow(row) || !rowId || claimed.has(rowId) || rowIds.has(rowId)) return false;
    rowIds.add(rowId);
    return true;
  }).map(clone);
}

function mergeRowsWithJournalReferences(rows, state) {
  const rowIds = new Set();
  return [...unclaimedJournalRows(state), ...rows].filter((row) => {
    const rowId = clean(row?.rowId);
    if (!rowId || rowIds.has(rowId)) return false;
    rowIds.add(rowId);
    return true;
  });
}

function resetUnclaimedJournalRows(state) {
  const journals = unclaimedJournalRows(state);
  const journalIds = new Set(journals.map((row) => clean(row.rowId)));
  const retain = (rows) => (Array.isArray(rows) ? rows : []).filter((row) => (
    !isStorageJournalRow(row) || !journalIds.has(clean(row?.rowId))
  ));
  return {
    ...state,
    manualRows: [...retain(state?.manualRows), ...journals],
    generatedRows: retain(state?.generatedRows)
  };
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
    journal = null,
    coordinator = new WorldMutationCoordinator(),
    buildItemData = null,
    getManifest = async () => [],
    createDocumentId = documentId,
    logger = console
  } = {}) {
    this.resolveScene = resolveScene;
    this.resolveActor = resolveActor;
    this.resolveFallbackActor = resolveFallbackActor;
    this.logger = logger;
    Object.assign(this, {journal, coordinator, buildItemData, getManifest, createDocumentId});
  }

  #findMutationRoot(actor, mutationId) {
    const id = clean(mutationId);
    if (!id) return null;
    return itemCollection(actor).find((item) => (
      clean(readFlag(item, STORAGE_CONTAINER_MUTATION_FLAG)?.id) === id
    )) ?? null;
  }

  /** One detached plan for every shell, content Item and installed upgrade. No world writes. */
  async prepareItemGraph(snapshot, {actorId = "",createDocumentId=this.createDocumentId,buildItemData=this.buildItemData,getManifest=this.getManifest} = {}) {
    const normalized = buildStorageContainerSnapshot(snapshot);
    const documents = [], documentIds = new Set(), instances = new Set();
    let manifest;
    const allocate = () => {
      const id = createDocumentId();
      if (typeof id !== "string" || !/^[a-zA-Z0-9]{16}$/u.test(id) || documentIds.has(id) || documentIds.size >= 200) treeConflict("document-identity-or-limit");
      documentIds.add(id); return id;
    };
    const appendHost = async (composition, quantity, fallback, parentId, member) => {
      let nodes;
      if (composition) {
        for (const entry of [composition, ...composition.upgrades]) {
          if (instances.has(entry.instanceKey)) treeConflict("duplicate-composition");
          instances.add(entry.instanceKey);
        }
      }
      const liveGraph = fallback?.flags?.[MODULE_ID]?.runtimeItemGraph;
      if (liveGraph) {
        if (quantity !== 1 || liveGraph.nodes?.[0]?.system?.quantity !== 1) treeConflict("stacked-upgrade-host");
        const plan = buildRuntimeGraphDocuments(liveGraph,`storage-host:${createDocumentId()}`,fallback,{actorId});
        nodes = plan.documents;
        for (const node of nodes) {
          if (documentIds.has(node._id) || documentIds.size >= 200) treeConflict("document-identity-or-limit");
          documentIds.add(node._id);
        }
      } else if (composition && !fallback?.flags?.[MODULE_ID]?.storageCapturedHost) {
        if (typeof buildItemData !== "function") treeConflict("catalog-builder-required");
        manifest ??= await getManifest();
        const graph = await buildCompositeItemGraph({...composition, quantity, container:null}, {
          actorId, manifest, createDocumentId:allocate,
          buildBase:(sourceType,sourceId)=>buildItemData({sourceType,sourceId,quantity,isBroken:composition.isBroken}),
          buildUpgrade:sourceId=>buildItemData({sourceType:"gear",sourceId,quantity:1,isBroken:false})
        });
        nodes = graph.documents;
      } else {
        const data = plainItemData(fallback); data._id = allocate(); data.system.quantity = quantity;
        nodes = [data];
      }
      const root = nodes[0]; root.system.container = parentId;
      delete root.flags[MODULE_ID].storageCapturedHost;
      root.flags[MODULE_ID][STORAGE_CONTAINER_MEMBER_FLAG] = {...member, ...(composition ? {composition:clone(composition)} : {})};
      documents.push(...nodes); return root;
    };
    const visit = async (current, parentId, rowId = "") => {
      const portable = createPortableStorageContainerItemData(current, containerOptions(current,parentId));
      const shell = current.presentation?.itemData ?? portable;
      const root = await appendHost(current.state.lootgenComposition,1,shell,parentId,
        {rootContainerId:normalized.containerId,containerId:current.containerId,rowId});
      if (root.type !== "container") treeConflict("catalog-shell-type");
      Object.assign(root.flags[MODULE_ID],portable.flags[MODULE_ID]);
      root.system.currency = visibleCoins(current.state);
      const claimed = new Set(current.state.claimedRowIds ?? []);
      for (const row of [...(current.state.manualRows ?? []), ...(current.state.generatedRows ?? [])]) {
        if (claimed.has(row.rowId) || isStorageJournalRow(row)) continue;
        if (row.rowKind === "container" && row.container) { await visit(row.container,root._id,row.rowId); continue; }
        const fallback = plainItemData(row.itemData ?? row);
        fallback.name = clean(row.name ?? fallback.name) || "Предмет";
        fallback.img = clean(row.img ?? fallback.img);
        await appendHost(row.composition,row.quantity,fallback,root._id,
          {rootContainerId:normalized.containerId,containerId:current.containerId,rowId:row.rowId});
      }
      return root;
    };
    const root = await visit(normalized,null);
    return {version:1,rootId:root._id,nodes:documents};
  }

  async #materializeDurable(actor, normalized, mutationId, parentContainerId) {
    const actorUuid = clean(actor?.uuid);
    if (!actorUuid) treeConflict("actor-identity");
    const id = `storage-container:${mutationId}`;
    const fingerprint = itemInstanceFingerprint({actorUuid,parentContainerId,snapshot:normalized});
    return this.coordinator.run(`storage-container:${normalized.containerId}`, async () => {
      let receipt = await this.journal.find(id);
      if (receipt && (receipt.fingerprint !== fingerprint || receipt.kind !== "storage-container-materialize")) treeConflict("receipt-conflict");
      if (receipt?.terminal) {
        const root = actor.items.get(receipt.rootItemId);
        if (clean(readFlag(root,STORAGE_CONTAINER_MUTATION_FLAG)?.id) !== mutationId) treeConflict("terminal-target-missing");
        return root;
      }
      if (parentContainerId && actor.items.get(parentContainerId)?.type !== "container") treeConflict("destination-parent-missing");
      if (!receipt) {
        if (this.#findMutationRoot(actor,mutationId)) treeConflict("legacy-target-without-receipt");
        const pending = await this.journal.listPending();
        if (pending.some(record=>record.kind === "storage-container-materialize" && record.sourceContainerId === normalized.containerId)) treeConflict("source-reserved");
        const graph = await this.prepareItemGraph(normalized,{actorId:actor.id ?? ""});
        graph.nodes[0].flags[MODULE_ID][STORAGE_CONTAINER_MUTATION_FLAG] = {id:mutationId,kind:"materialize"};
        const plan = buildRuntimeGraphDocuments(graph,id,null,{actorId:actor.id ?? "",parentContainerId});
        receipt = await this.journal.start({id,kind:"storage-container-materialize",phase:"prepared",fingerprint,actorUuid,
          parentContainerId,sourceContainerId:normalized.containerId,graph,rootItemId:plan.rootItemId,expectedItemIds:plan.documents.map(data=>data._id)});
        if (receipt.fingerprint !== fingerprint) treeConflict("receipt-conflict");
      }
      const plan = buildRuntimeGraphDocuments(receipt.graph,id,null,{actorId:actor.id ?? "",parentContainerId});
      if (plan.rootItemId !== receipt.rootItemId || itemInstanceFingerprint(plan.documents.map(data=>data._id)) !== itemInstanceFingerprint(receipt.expectedItemIds)) treeConflict("receipt-graph-conflict");
      if ((receipt.observedItemIds ?? []).some(itemId=>!actor.items.get(itemId))) treeConflict("observed-target-deleted");
      let root;
      try {
        root = await materializeRuntimeItemGraph(actor,receipt.graph,id,null,{recoverMissing:true,parentContainerId});
      } catch (error) {
        const observedItemIds = [...new Set([...(receipt.observedItemIds ?? []),...receipt.expectedItemIds.filter(itemId=>actor.items.get(itemId))])];
        await this.journal.checkpoint(id,receipt.phase,receipt.phase,{observedItemIds});
        throw error;
      }
      await this.journal.finish(id,{rootItemId:root.id});
      return root;
    });
  }

  async materializeToActorOnce(actor, snapshot, mutationId, { parentContainerId = null } = {}) {
    const normalized = buildStorageContainerSnapshot(snapshot);
    const stableMutationId = clean(mutationId) || randomId("storage-container-grant");
    parentContainerId = clean(parentContainerId) || null;
    if (this.journal) return this.#materializeDurable(actor,normalized,stableMutationId,parentContainerId);
    const existing = this.#findMutationRoot(actor, stableMutationId);
    if (existing) return existing;

    if (typeof actor?.createEmbeddedDocuments !== "function") {
      throw new TypeError("Актёр не поддерживает создание предметов-контейнеров.");
    }
    const graph = await this.prepareItemGraph(normalized,{actorId:actor?.id ?? ""});
    const documents = graph.nodes, rootId = graph.rootId;
    const rootData = documents[0]; rootData.system.container = parentContainerId;
    rootData.flags[MODULE_ID][STORAGE_CONTAINER_MUTATION_FLAG] = {id:stableMutationId,kind:"materialize"};
    try {
      const created = await actor.createEmbeddedDocuments("Item", documents, { keepId: true });
      const root = created?.find?.((item) => clean(item?.id ?? item?._id) === rootId) ?? created?.[0];
      if (!root) throw new Error("Созданный предмет-контейнер не найден.");
      return root;
    }
    catch (error) {
      const partialRoot = this.#findMutationRoot(actor, stableMutationId);
      if (partialRoot && typeof actor?.deleteEmbeddedDocuments === "function") {
        try {
          const ids = [];
          const allItems = itemCollection(actor);
          const collect = (parentId) => {
            for (const child of allItems.filter((item) => clean(item?.system?.container) === parentId)) {
              ids.push(clean(child.id));
              collect(clean(child.id));
            }
          };
          collect(clean(partialRoot.id));
          ids.push(clean(partialRoot.id));
          await actor.deleteEmbeddedDocuments("Item", ids.filter(Boolean));
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
    return this.#captureItemTree(item,itemCollection(actor));
  }

  /** Freeze a validated detached generation graph into the canonical portable snapshot. No native documents or catalog reads. */
  async capturePreparedContainer(itemData) {
    const prepared=readLootgenPreparedComposition(itemData);
    if(!prepared?.descriptor.container)throw new Error("Требуется подготовленный контейнер с полным составом.");
    const graph=itemData.flags[MODULE_ID].runtimeItemGraph;
    const items=graph.nodes.map(data=>({...clone(data),id:data._id}));
    return this.#captureItemTree(items.find(item=>item.id===graph.rootId),items);
  }

  async #captureItemTree(item,allItems) {
    const visit = async (current, ancestors = new Set()) => {
      const base = readPortableStorageContainerSnapshot(current) ?? nativeContainerSnapshot(current);
      const storedState = base.state ?? {};
      const itemId = clean(current.id);
      if (ancestors.has(itemId)) throw new Error("Обнаружен цикл нативных dnd5e-контейнеров.");
      const nextAncestors = new Set(ancestors).add(itemId);
      const capturedHost = captureHostData(current,allItems,readFlag(current,STORAGE_CONTAINER_MEMBER_FLAG)?.composition ?? storedState.lootgenComposition);
      const children = allItems.filter((candidate) => clean(candidate?.system?.container) === itemId && !capturedHost.installedIds.has(candidate.id));
      const rows = [];
      for (const child of children) {
        if (clean(child?.type) === "container") {
          rows.push(buildStorageContainerRow(await visit(child, nextAncestors), {
            rowId: memberRowId(child)
          }));
          continue;
        }
        const captured = captureHostData(child,allItems,readFlag(child,STORAGE_CONTAINER_MEMBER_FLAG)?.composition);
        const data = captured.data;
        delete data.system.container;
        const quantity = itemQuantity(child);
        data.system.quantity = quantity;
        rows.push({
          rowKind: "item",
          rowId: memberRowId(child),
          stackKey: clean(child?.flags?.core?.sourceId ?? child?.flags?.dnd5e?.sourceId),
          sourceId: captured.composition?.sourceId ?? clean(child?.uuid),
          sourceType: captured.composition?.sourceType ?? clean(child?.type),
          ...(captured.composition ? {composition:captured.composition} : {}),
          name: clean(child?.name ?? data.name) || "Предмет",
          img: clean(child?.img ?? data.img),
          quantity,
          itemData: data
        });
      }

      if (storedState.state === "unopened") {
        const resetState = resetUnclaimedJournalRows(storedState);
        return buildStorageContainerSnapshot({
          ...base,
          name: clean(current?.name) || base.name,
          img: clean(current?.img) || base.img,
          state: resetState,
          presentation: {
            ...(clone(base.presentation) ?? {}),
            itemSystem: clone(current?.system) ?? {},
            itemData: capturedHost.data
          }
        });
      }
      const currency = captureCurrency(current?.system?.currency ?? visibleCoins(storedState));
      const mergedRows = mergeRowsWithJournalReferences(rows, storedState);
      const liveState = clone(storedState);
      delete liveState.lootgenComposition;
      if (capturedHost.composition) liveState.lootgenComposition = capturedHost.composition;
      return buildStorageContainerSnapshot({
        ...base,
        name: clean(current?.name) || base.name,
        img: clean(current?.img) || base.img,
        state: {
          ...liveState,
          baseName: clean(current?.name) || base.name,
          manualRows: mergedRows,
          generatedRows: [],
          claimedRowIds: [],
          manualCoins: currency,
          generatedCoins: {},
          coinsClaimed: false,
          state: mergedRows.length || hasCoins(currency) ? "opened" : "empty",
          displayMode: mergedRows.length || hasCoins(currency) ? "opened" : "empty"
        },
        presentation: {
          ...(clone(base.presentation) ?? {}),
          itemSystem: clone(current?.system) ?? {},
            itemData: capturedHost.data
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
    // Prove the transport can be restored before deleting the source tree.
    await this.prepareItemGraph(snapshot,{actorId:actor.id ?? ""});
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

  async restoreSnapshotToScene(snapshot, { sceneId, x, y, mutationId, ownerUserId = "" } = {}) {
    const normalized = buildStorageContainerSnapshot(snapshot);
    const topDown = containerTopDownPresentation(normalized);
    const topDownSize = topDown
      ? (topDown.visualType === "Доспех" ? 1 : 0.5)
      : null;
    const topDownLayout = topDown ? buildGroundPileTokenLayout({
      width: topDown.tokenWidth ?? topDownSize,
      height: topDown.tokenHeight ?? topDownSize,
      textureScale: topDown.textureScale,
      rotationMode: topDown.rotationMode
    }, deterministicStorageTokenRotation(normalized.containerId, topDown.rotationMode)) : null;
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
    const moduleFlags = {
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
      }
    };
    if (normalized.storageKind === "pile") moduleFlags.groundPile = { enabled: true };
    else delete moduleFlags.groundPile;
    const data = {
      ...prototypeData,
      ...presented,
      actorId,
      actorLink: false,
      sight: {
        ...(clone(prototypeData.sight) ?? {}),
        ...(clone(presented.sight) ?? {}),
        enabled: false
      },
      delta: ownedSyntheticActorDelta(presented.delta ?? prototypeData.delta, ownerUserId),
      name: normalized.storageKind === "chest"
        ? "Сундук"
        : clean(presented.name) || normalized.name,
      x: Number(x),
      y: Number(y),
      ...(topDownLayout ? {
        width: topDownLayout.width,
        height: topDownLayout.height,
        rotation: topDownLayout.rotation
      } : {}),
      texture: {
        ...(clone(prototypeData.texture) ?? {}),
        ...(clone(presented.texture) ?? {}),
        src: clean(topDown?.img) || clean(normalized.img) || clean(presented.texture?.src) || clean(prototypeData.texture?.src),
        ...(topDownLayout ? {
          scaleX: topDownLayout.textureScale,
          scaleY: topDownLayout.textureScale,
          ...(topDown.rotationMode === "cardinal" ? { fit: "contain" } : {})
        } : {})
      },
      flags: {
        ...(clone(prototypeData.flags) ?? {}),
        ...(clone(presented.flags) ?? {}),
        [MODULE_ID]: moduleFlags
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
