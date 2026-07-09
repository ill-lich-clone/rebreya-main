import { MODULE_ID } from "../constants.js";
import {
  getInstalledActorUpgradeItemIds,
  getInstalledUpgradeItems,
  getItemUpgradeHostState,
  isUpgradeableHostItem,
  isUpgradeItem,
  UPGRADE_HOLD_DURATION_MS
} from "../data/item-upgrade-service.js?v=1.4.93-item-upgrades";

const DRAG_DATA_TYPES = ["text/plain", "text", "application/json"];
const HOLD_STATES = new WeakMap();

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

function getDropData(event) {
  if (globalThis.TextEditor?.getDragEventData instanceof Function) {
    try {
      const dragData = TextEditor.getDragEventData(event);
      if (dragData && typeof dragData === "object") {
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

async function resolveDropItem(dropData) {
  if (!dropData?.uuid || !(globalThis.fromUuid instanceof Function)) {
    throw new Error("Перетащенный предмет не найден.");
  }
  const document = await fromUuid(dropData.uuid);
  if (!document) {
    throw new Error("Перетащенный предмет не найден.");
  }
  return document;
}

function isPotentialUpgradeDrop(dropData) {
  const document = resolveDropDocumentSync(dropData);
  if (document) {
    return isUpgradeItem(document);
  }
  return Boolean(dropData?.uuid || dropData?.id || dropData?.itemId);
}

function getPanelContainer(root) {
  return root?.querySelector?.(".sheet-body .tab[data-tab='details']")
    ?? root?.querySelector?.(".sheet-body")
    ?? root?.querySelector?.("form")
    ?? root;
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
        <span class="rm-item-upgrades__name">${escapeHtml(upgrade.name ?? "Усовершенствование")}</span>
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

function startHold(panel, dragKey) {
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
  panel.classList.add("is-dragover");
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
  if (!installedIds.size) {
    return false;
  }

  for (const node of Array.from(root.querySelectorAll?.("[data-item-id]") ?? [])) {
    if (!(node instanceof HTMLElement) || node.closest?.("[data-rebreya-item-upgrades='true']")) {
      continue;
    }
    if (installedIds.has(cleanText(node.dataset.itemId))) {
      node.hidden = true;
      node.classList?.add?.("rm-item-upgrades-hidden-item");
    }
  }
  return true;
}

export function bindItemUpgradeSheet(root, app, moduleApi) {
  const hostItem = getSheetItem(app);
  const actor = getItemActor(hostItem);
  if (!(root instanceof HTMLElement) || !actor || !isUpgradeableHostItem(hostItem)) {
    return false;
  }

  const panel = renderItemUpgradePanel(root, hostItem);
  if (!(panel instanceof HTMLElement)) {
    return false;
  }

  panel.addEventListener("dragover", (event) => {
    const dropData = getDropData(event);
    if (!isPotentialUpgradeDrop(dropData)) {
      return;
    }

    event.preventDefault?.();
    event.stopPropagation?.();
    if (event.dataTransfer) {
      event.dataTransfer.dropEffect = "move";
    }
    startHold(panel, getDragKey(dropData));
  }, { capture: true });

  panel.addEventListener("dragleave", (event) => {
    if (event.relatedTarget && panel.contains(event.relatedTarget)) {
      return;
    }
    cancelHold(panel);
  }, { capture: true });

  panel.addEventListener("drop", async (event) => {
    const state = HOLD_STATES.get(panel);
    const dropData = getDropData(event);
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
    const action = event.target?.closest?.("[data-action='rebreya-item-upgrade-remove'], [data-action='rebreya-item-upgrade-capacity']");
    if (!(action instanceof HTMLElement)) {
      return;
    }

    event.preventDefault?.();
    event.stopPropagation?.();
    try {
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
