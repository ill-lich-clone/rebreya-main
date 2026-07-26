import { MODULE_ID } from "../constants.js";
import {
  getInstalledActorUpgradeItemIds,
  getInstalledUpgradeItems,
  getItemUpgradeHostState,
  isInstalledUpgradeItem,
  isUpgradeableHostItem,
  isUpgradeItem,
  UPGRADE_HOLD_DURATION_MS
} from "../data/item-upgrade-service.js?v=1.4.96-item-upgrades";

const DRAG_DATA_TYPES = ["text/plain", "text", "application/json"];
const HOLD_STATES = new WeakMap();
const INVENTORY_ROW_DROP_BOUND_FLAG = "rebreyaItemUpgradeDropBound";
const INVENTORY_ROW_DROP_TARGET_CLASS = "is-rebreya-upgrade-drop-target";
const INVENTORY_ROW_HAS_UPGRADES_CLASS = "has-rebreya-installed-upgrades";
const INVENTORY_ROW_INSTALLING_CLASS = "is-rebreya-upgrade-installing";
const UPGRADE_INSTALL_ANIMATION_MS = 700;
let filterHookRegistered = false;

function cleanText(value) {
  return String(value ?? "").trim();
}

function escapeHtml(value) {
  return globalThis.foundry?.utils?.escapeHTML?.(String(value ?? ""))
    ?? String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
}

function getItemId(item) {
  return cleanText(item?.id ?? item?._id);
}

function getSheetItem(app) {
  return app?.item ?? app?.document ?? app?.object ?? null;
}

function getItemActor(item) {
  return item?.actor ?? item?.parent ?? null;
}

function collectionValues(collection) {
  if (!collection) {
    return [];
  }
  if (Array.isArray(collection)) {
    return collection;
  }
  if (Array.isArray(collection.contents)) {
    return collection.contents;
  }
  if (typeof collection.values === "function") {
    return Array.from(collection.values());
  }
  return [];
}

function getActorItems(actor) {
  return collectionValues(actor?.items);
}

function resolveActorItem(actor, itemId) {
  const id = cleanText(itemId);
  if (!actor || !id) {
    return null;
  }
  return actor.items?.get?.(id)
    ?? getActorItems(actor).find((item) => getItemId(item) === id)
    ?? null;
}

function getItemIdFromUuid(uuid) {
  const match = cleanText(uuid).match(/(?:^|\.)Item\.([^.]+)$/u);
  return match?.[1] ?? "";
}

function hasDropDataPayload(value) {
  return Boolean(value && typeof value === "object" && Object.keys(value).length);
}

export function getItemUpgradeDropData(event) {
  const dragDropPayload = globalThis.CONFIG?.ux?.DragDrop?.getPayload;
  if (dragDropPayload instanceof Function) {
    try {
      const payload = dragDropPayload.call(globalThis.CONFIG.ux.DragDrop, event);
      if (hasDropDataPayload(payload)) {
        return payload;
      }
    }
    catch (_error) {
      // Fall back to the legacy data readers below.
    }
  }

  if (globalThis.TextEditor?.getDragEventData instanceof Function) {
    try {
      const dragData = TextEditor.getDragEventData(event);
      if (hasDropDataPayload(dragData)) {
        return dragData;
      }
    }
    catch (_error) {
      // Fall back to direct DataTransfer payloads below.
    }
  }

  for (const type of DRAG_DATA_TYPES) {
    const raw = event?.dataTransfer?.getData?.(type);
    if (!raw) {
      continue;
    }
    try {
      return JSON.parse(raw);
    }
    catch (_error) {
      return { uuid: raw };
    }
  }
  return null;
}

function getDragKey(dropData) {
  return cleanText(dropData?.uuid ?? dropData?.id ?? dropData?.itemId ?? dropData?.name);
}

function resolveDropDocumentSync(dropData) {
  if (!dropData?.uuid || !(globalThis.fromUuidSync instanceof Function)) {
    return null;
  }
  try {
    return fromUuidSync(dropData.uuid);
  }
  catch (_error) {
    return null;
  }
}

function resolveDropItemSync(dropData, actor = null) {
  const directItem = resolveActorItem(actor, dropData?.itemId ?? dropData?.id);
  if (directItem) {
    return directItem;
  }

  const uuidItem = resolveActorItem(actor, getItemIdFromUuid(dropData?.uuid));
  if (uuidItem) {
    return uuidItem;
  }

  return resolveDropDocumentSync(dropData);
}

async function resolveDropItem(dropData, actor = null) {
  const syncItem = resolveDropItemSync(dropData, actor);
  if (syncItem) {
    return syncItem;
  }

  if (!dropData?.uuid || !(globalThis.fromUuid instanceof Function)) {
    throw new Error("Перетащенный предмет не найден.");
  }
  const document = await fromUuid(dropData.uuid);
  if (!document) {
    throw new Error("Перетащенный предмет не найден.");
  }
  return document;
}

function hasPotentialDropDataTransfer(event) {
  const types = Array.from(event?.dataTransfer?.types ?? []);
  return types.some((type) => DRAG_DATA_TYPES.includes(type) || type === "text/uri-list");
}

function isPotentialUpgradeDrop(dropData, event = null) {
  const document = resolveDropItemSync(dropData);
  if (document) {
    return isUpgradeItem(document);
  }
  return Boolean(dropData?.uuid || dropData?.id || dropData?.itemId || hasPotentialDropDataTransfer(event));
}

function isPotentialActorInventoryUpgradeDrop(dropData, actor, event = null) {
  const document = resolveDropItemSync(dropData, actor);
  if (document) {
    return isUpgradeItem(document);
  }
  return isPotentialUpgradeDrop(dropData, event);
}

function isDuplicateInventoryItemNode(node, root) {
  const itemId = cleanText(node?.dataset?.itemId);
  if (!itemId) {
    return false;
  }

  for (let parent = node.parentElement; parent && parent !== root; parent = parent.parentElement) {
    if (cleanText(parent.dataset?.itemId) === itemId) {
      return true;
    }
  }
  return false;
}

function clearInventoryUpgradeIndicator(row) {
  row.classList?.remove?.(INVENTORY_ROW_HAS_UPGRADES_CLASS);
  delete row.dataset.rebreyaItemUpgradesSlotsShort;
  delete row.dataset.rebreyaItemUpgradesSlotsLabel;
  row.removeAttribute?.("data-rebreya-item-upgrades-slots-short");
  row.removeAttribute?.("data-rebreya-item-upgrades-slots-label");
}

function renderInventoryUpgradeIndicator(row, hostItem) {
  const state = getItemUpgradeHostState(hostItem);
  const installedCount = getInstalledUpgradeItems(hostItem).length;
  if (installedCount <= 0) {
    clearInventoryUpgradeIndicator(row);
    return false;
  }

  const capacity = Math.max(1, Number.isFinite(Number(state.capacity)) ? Number(state.capacity) : 1, installedCount);
  const shortLabel = `${installedCount}/${capacity}`;
  const fullLabel = `Усовершенствования: ${shortLabel}`;
  row.classList?.add?.(INVENTORY_ROW_HAS_UPGRADES_CLASS);
  row.dataset.rebreyaItemUpgradesSlotsShort = shortLabel;
  row.dataset.rebreyaItemUpgradesSlotsLabel = fullLabel;
  row.setAttribute?.("data-rebreya-item-upgrades-slots-short", shortLabel);
  row.setAttribute?.("data-rebreya-item-upgrades-slots-label", fullLabel);
  return true;
}

function getPanelContainer(root) {
  return root?.querySelector?.(".sheet-body .tab[data-tab='mods']")
    ?? root?.querySelector?.(".tab[data-tab='mods']")
    ?? root?.querySelector?.("[data-application-part='mods']")
    ?? null;
}

function createPanelHtml(hostItem) {
  const state = getItemUpgradeHostState(hostItem);
  const installedBySlot = new Map();
  for (const upgrade of getInstalledUpgradeItems(hostItem)) {
    const entry = state.installed.find((candidate) => candidate.itemId === getItemId(upgrade));
    if (entry) {
      installedBySlot.set(entry.slotIndex, upgrade);
    }
  }

  const capacityButtons = [1, 2, 3].map((capacity) => `
    <button type="button"
      class="rm-item-upgrades__capacity-button${capacity === state.capacity ? " is-active" : ""}"
      data-action="rebreya-item-upgrade-capacity"
      data-capacity="${capacity}"
      title="Слотов: ${capacity}"
      aria-label="Слотов усовершенствований: ${capacity}">
      ${capacity}
    </button>
  `).join("");

  const slots = Array.from({ length: state.capacity }, (_entry, index) => {
    const slotIndex = index + 1;
    const upgrade = installedBySlot.get(slotIndex) ?? null;
    if (!upgrade) {
      return `
        <li class="rm-item-upgrades__slot is-empty" data-upgrade-slot="${slotIndex}">
          <span class="rm-item-upgrades__slot-index">${slotIndex}</span>
          <span class="rm-item-upgrades__empty-label">Пусто</span>
        </li>
      `;
    }

    return `
      <li class="rm-item-upgrades__slot" data-upgrade-slot="${slotIndex}" data-item-id="${escapeHtml(getItemId(upgrade))}">
        <span class="rm-item-upgrades__slot-index">${slotIndex}</span>
        <img class="rm-item-upgrades__icon" src="${escapeHtml(upgrade.img ?? "icons/svg/item-bag.svg")}" alt="">
        <button type="button"
          class="rm-item-upgrades__name rm-item-upgrades__open"
          data-action="rebreya-item-upgrade-open"
          data-item-id="${escapeHtml(getItemId(upgrade))}"
          title="Открыть усовершенствование">
          ${escapeHtml(upgrade.name ?? "Усовершенствование")}
        </button>
        <button type="button"
          class="rm-item-upgrades__remove"
          data-action="rebreya-item-upgrade-remove"
          data-item-id="${escapeHtml(getItemId(upgrade))}"
          title="Снять"
          aria-label="Снять ${escapeHtml(upgrade.name ?? "усовершенствование")}">
          <i class="fa-solid fa-xmark" aria-hidden="true"></i>
        </button>
      </li>
    `;
  }).join("");

  return `
    <section class="rm-item-upgrades" data-rebreya-item-upgrades="true">
      <header class="rm-item-upgrades__header">
        <div class="rm-item-upgrades__title">
          <i class="fa-solid fa-hammer" aria-hidden="true"></i>
          <span>Усовершенствования</span>
        </div>
        <div class="rm-item-upgrades__capacity" role="group" aria-label="Количество слотов усовершенствований">
          ${capacityButtons}
        </div>
      </header>
      <ol class="rm-item-upgrades__slots">
        ${slots}
      </ol>
      <div class="rm-item-upgrades__hold" aria-hidden="true">
        <div class="rm-item-upgrades__hold-ring"></div>
      </div>
    </section>
  `;
}

export function createItemUpgradePanelHtml(hostItem) {
  return isUpgradeableHostItem(hostItem) ? createPanelHtml(hostItem) : "";
}

export function isItemUpgradeHostItem(item) {
  return isUpgradeableHostItem(item);
}

function cancelHold(panel) {
  const state = HOLD_STATES.get(panel);
  if (state?.timeoutId) {
    window.clearTimeout(state.timeoutId);
  }
  if (state) {
    state.cancelled = true;
  }
  HOLD_STATES.delete(panel);
  panel.classList.remove("is-dragover", "is-holding", "is-hold-ready");
}

function finishHold(panel, token) {
  const state = HOLD_STATES.get(panel);
  if (!state || state.token !== token || state.cancelled) {
    return;
  }
  state.ready = true;
  panel.classList.add("is-hold-ready");
}

function playSequencerHold(panel, token) {
  if (globalThis.game?.modules?.get?.("sequencer")?.active !== true || typeof globalThis.Sequence !== "function") {
    panel.classList.add("is-holding");
    return;
  }

  try {
    new Sequence()
      .thenDo(() => {
        const state = HOLD_STATES.get(panel);
        if (state?.token === token && !state.cancelled) {
          panel.classList.add("is-holding");
        }
      })
      .wait(UPGRADE_HOLD_DURATION_MS)
      .thenDo(() => finishHold(panel, token))
      .play({ local: true });
  }
  catch (error) {
    console.debug(`${MODULE_ID} | Sequencer item upgrade hold animation was skipped.`, error);
    panel.classList.add("is-holding");
  }
}

export function startItemUpgradeHold(panel, dragKey) {
  const current = HOLD_STATES.get(panel);
  if (current?.dragKey === dragKey) {
    return current;
  }

  cancelHold(panel);
  const token = Symbol("item-upgrade-hold");
  const state = {
    cancelled: false,
    dragKey,
    ready: false,
    timeoutId: window.setTimeout(() => finishHold(panel, token), UPGRADE_HOLD_DURATION_MS),
    token
  };
  HOLD_STATES.set(panel, state);
  panel.style.setProperty("--rm-item-upgrade-hold-duration", `${UPGRADE_HOLD_DURATION_MS}ms`);
  panel.classList.add("is-dragover", "is-holding");
  playSequencerHold(panel, token);
  return state;
}

async function rerenderItemSheet(app, moduleApi) {
  try {
    await app?.render?.({ force: true });
  }
  catch (_error) {
    await app?.render?.(true);
  }
  await moduleApi?.refreshOpenApps?.();
}

async function openInstalledUpgradeSheet(hostItem, upgradeItemId) {
  const upgradeItem = resolveActorItem(getItemActor(hostItem), upgradeItemId);
  if (!(upgradeItem?.sheet?.render instanceof Function)) {
    throw new Error("Карточка установленного усовершенствования недоступна.");
  }

  try {
    await upgradeItem.sheet.render({ force: true });
  }
  catch (_error) {
    await upgradeItem.sheet.render(true);
  }
}

async function rerenderActorSheetAfterUpgrade(app, moduleApi, rerenderActorSheet) {
  if (rerenderActorSheet instanceof Function) {
    await rerenderActorSheet(app, moduleApi);
    return;
  }

  try {
    await app?.render?.({ force: true });
  }
  catch (_error) {
    await app?.render?.(true);
  }
  await moduleApi?.refreshOpenApps?.();
}

function playInventoryInstallAnimation(row, callback) {
  row.classList?.add?.(INVENTORY_ROW_INSTALLING_CLASS);
  const runAfterAnimation = async () => {
    try {
      await callback();
    }
    catch (error) {
      console.error(`${MODULE_ID} | Failed to refresh actor sheet after item upgrade animation.`, error);
    }
    finally {
      row.classList?.remove?.(INVENTORY_ROW_INSTALLING_CLASS);
    }
  };

  const setTimeoutFn = globalThis.window?.setTimeout ?? globalThis.setTimeout;
  if (setTimeoutFn instanceof Function) {
    setTimeoutFn(runAfterAnimation, UPGRADE_INSTALL_ANIMATION_MS);
  }
  else {
    void runAfterAnimation();
  }
}

export function renderItemUpgradePanel(root, hostItem) {
  if (!(root instanceof HTMLElement) || !isUpgradeableHostItem(hostItem)) {
    return null;
  }

  root.querySelector?.("[data-rebreya-item-upgrades='true']")?.remove?.();
  const container = getPanelContainer(root);
  if (!(container instanceof HTMLElement)) {
    return null;
  }

  const wrapper = document.createElement("div");
  wrapper.innerHTML = createPanelHtml(hostItem).trim();
  const panel = wrapper.firstElementChild;
  if (!(panel instanceof HTMLElement)) {
    return null;
  }
  container.append(panel);
  return panel;
}

export function hideInstalledUpgradeInventoryRows(root, actor) {
  if (!(root instanceof HTMLElement) || !actor) {
    return false;
  }

  const installedIds = getInstalledActorUpgradeItemIds(actor);
  let changed = false;

  for (const node of Array.from(root.querySelectorAll?.("[data-item-id]") ?? [])) {
    if (
      !(node instanceof HTMLElement)
      || node.closest?.("[data-rebreya-item-upgrades='true']")
      || isDuplicateInventoryItemNode(node, root)
    ) {
      continue;
    }
    if (installedIds.has(cleanText(node.dataset.itemId))) {
      node.hidden = true;
      node.classList?.add?.("rm-item-upgrades-hidden-item");
      changed = true;
      continue;
    }

    const item = resolveActorItem(actor, node.dataset.itemId);
    if (item && renderInventoryUpgradeIndicator(node, item)) {
      changed = true;
    }
    else {
      clearInventoryUpgradeIndicator(node);
    }
  }
  return changed;
}

export function registerItemUpgradeFilterHook() {
  if (filterHookRegistered || !(globalThis.Hooks?.on instanceof Function)) {
    return false;
  }

  filterHookRegistered = true;
  globalThis.Hooks.on("dnd5e.filterItem", (_sheet, item) => {
    if (isInstalledUpgradeItem(item)) {
      return false;
    }
    return undefined;
  });
  return true;
}

export function bindItemUpgradeInventoryRows(root, { actor, app, moduleApi, rerenderActorSheet } = {}) {
  if (!(root instanceof HTMLElement) || !actor || !(moduleApi?.installItemUpgrade instanceof Function)) {
    return false;
  }

  let bound = false;
  for (const row of Array.from(root.querySelectorAll?.("[data-item-id]") ?? [])) {
    if (
      !(row instanceof HTMLElement)
      || row.dataset[INVENTORY_ROW_DROP_BOUND_FLAG] === "true"
      || isDuplicateInventoryItemNode(row, root)
    ) {
      continue;
    }

    const hostItem = resolveActorItem(actor, row.dataset.itemId);
    if (!hostItem || !isUpgradeableHostItem(hostItem)) {
      continue;
    }

    row.dataset[INVENTORY_ROW_DROP_BOUND_FLAG] = "true";
    bound = true;

    row.addEventListener("dragover", (event) => {
      const dropData = getItemUpgradeDropData(event);
      if (!isPotentialActorInventoryUpgradeDrop(dropData, actor, event)) {
        return;
      }

      event.preventDefault?.();
      event.stopPropagation?.();
      if (event.dataTransfer) {
        event.dataTransfer.dropEffect = "move";
      }
      row.classList?.add?.(INVENTORY_ROW_DROP_TARGET_CLASS);
    }, { capture: true });

    row.addEventListener("dragleave", (event) => {
      if (event.relatedTarget && row.contains?.(event.relatedTarget)) {
        return;
      }
      row.classList?.remove?.(INVENTORY_ROW_DROP_TARGET_CLASS);
    }, { capture: true });

    row.addEventListener("drop", async (event) => {
      const dropData = getItemUpgradeDropData(event);
      if (!isPotentialActorInventoryUpgradeDrop(dropData, actor, event)) {
        return;
      }

      event.preventDefault?.();
      event.stopPropagation?.();
      row.classList?.remove?.(INVENTORY_ROW_DROP_TARGET_CLASS);

      try {
        const upgradeItem = await resolveDropItem(dropData, actor);
        const installed = await moduleApi.installItemUpgrade(hostItem, upgradeItem);
        ui.notifications?.info?.(`Установлено: ${installed?.name ?? upgradeItem?.name ?? "усовершенствование"}.`);
        row.classList?.add?.(INVENTORY_ROW_HAS_UPGRADES_CLASS);
        playInventoryInstallAnimation(row, () => rerenderActorSheetAfterUpgrade(app, moduleApi, rerenderActorSheet));
      }
      catch (error) {
        console.error(`${MODULE_ID} | Failed to install item upgrade from actor sheet row.`, error);
        ui.notifications?.error?.(error.message || "Не удалось установить усовершенствование.");
      }
    }, { capture: true });
  }

  return bound;
}

export function bindItemUpgradeSheet(root, app, moduleApi) {
  const hostItem = getSheetItem(app);
  const actor = getItemActor(hostItem);
  if (!(root instanceof HTMLElement) || !actor || !isUpgradeableHostItem(hostItem)) {
    return false;
  }

  const panel = root.querySelector?.("[data-rebreya-item-upgrades='true']")
    ?? renderItemUpgradePanel(root, hostItem);
  if (!(panel instanceof HTMLElement)) {
    return false;
  }

  panel.addEventListener("dragover", (event) => {
    const dropData = getItemUpgradeDropData(event);
    if (!isPotentialUpgradeDrop(dropData, event)) {
      return;
    }

    event.preventDefault?.();
    event.stopPropagation?.();
    if (event.dataTransfer) {
      event.dataTransfer.dropEffect = "move";
    }
    startItemUpgradeHold(panel, getDragKey(dropData));
  }, { capture: true });

  panel.addEventListener("dragleave", (event) => {
    if (event.relatedTarget && panel.contains(event.relatedTarget)) {
      return;
    }
    cancelHold(panel);
  }, { capture: true });

  panel.addEventListener("drop", async (event) => {
    const state = HOLD_STATES.get(panel);
    const dropData = getItemUpgradeDropData(event);
    if (!state || !state.ready) {
      event.preventDefault?.();
      event.stopPropagation?.();
      cancelHold(panel);
      ui.notifications?.warn?.("Подержите усовершенствование над предметом 3 секунды.");
      return;
    }

    event.preventDefault?.();
    event.stopPropagation?.();
    try {
      const upgradeItem = await resolveDropItem(dropData);
      const installed = await moduleApi.installItemUpgrade(hostItem, upgradeItem);
      ui.notifications?.info?.(`Установлено: ${installed?.name ?? upgradeItem?.name ?? "усовершенствование"}.`);
      await rerenderItemSheet(app, moduleApi);
    }
    catch (error) {
      console.error(`${MODULE_ID} | Failed to install item upgrade.`, error);
      ui.notifications?.error?.(error.message || "Не удалось установить усовершенствование.");
    }
    finally {
      cancelHold(panel);
    }
  }, { capture: true });

  panel.addEventListener("dragend", () => {
    cancelHold(panel);
  }, { capture: true });

  panel.addEventListener("click", async (event) => {
    const action = event.target?.closest?.("[data-action='rebreya-item-upgrade-open'], [data-action='rebreya-item-upgrade-remove'], [data-action='rebreya-item-upgrade-capacity']");
    if (!(action instanceof HTMLElement)) {
      return;
    }

    event.preventDefault?.();
    event.stopPropagation?.();
    try {
      if (action.dataset.action === "rebreya-item-upgrade-open") {
        await openInstalledUpgradeSheet(hostItem, action.dataset.itemId);
        return;
      }
      if (action.dataset.action === "rebreya-item-upgrade-remove") {
        await moduleApi.removeItemUpgrade(hostItem, action.dataset.itemId);
      }
      else {
        await moduleApi.setItemUpgradeCapacity(hostItem, Number(action.dataset.capacity ?? 1));
      }
      await rerenderItemSheet(app, moduleApi);
    }
    catch (error) {
      console.error(`${MODULE_ID} | Failed to handle item upgrade sheet action.`, error);
      ui.notifications?.error?.(error.message || "Не удалось изменить усовершенствования предмета.");
    }
  }, { capture: true });

  return true;
}
