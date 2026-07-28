import { MODULE_ID } from "../constants.js";
import { escapeFoundryHtml as escapeHtml } from "../shared/foundry-values.js";

const RELOAD_MECHANISM_ID = "mekhanizm-perezaryadki-oruzhiya";
const ACTION_SELECTOR = "[data-rebreya-implant-reload-action]";

function cleanText(value) {
  return String(value ?? "").trim();
}

function rootElement(html) {
  if (html?.querySelector) return html;
  if (html?.[0]?.querySelector) return html[0];
  return null;
}

function itemGearId(item) {
  if (typeof item?.getFlag === "function") {
    const value = cleanText(item.getFlag(MODULE_ID, "gearId"));
    if (value) return value;
  }
  return cleanText(item?.flags?.[MODULE_ID]?.gearId);
}

function collectionValues(collection) {
  if (Array.isArray(collection)) return [...collection];
  if (Array.isArray(collection?.contents)) return [...collection.contents];
  if (typeof collection?.values === "function") return [...collection.values()];
  if (collection && typeof collection[Symbol.iterator] === "function") return [...collection];
  return [];
}

function itemQuantity(item) {
  const direct = Number(item?.system?.quantity);
  if (Number.isFinite(direct)) return Math.max(0, Math.floor(direct));
  const nested = Number(item?.system?.quantity?.value);
  return Number.isFinite(nested) ? Math.max(0, Math.floor(nested)) : 0;
}

function ammunitionItems(actor) {
  return collectionValues(actor?.items)
    .filter((item) => (
      item?.type === "consumable"
      && cleanText(item?.system?.type?.value).toLowerCase() === "ammo"
      && itemQuantity(item) > 0
    ))
    .sort((left, right) => cleanText(left?.name).localeCompare(cleanText(right?.name), "ru"));
}

export async function promptImplantReloadReservoir(actor, {
  DialogV2 = globalThis.foundry?.applications?.api?.DialogV2 ?? globalThis.DialogV2
} = {}) {
  if (!actor?.isOwner && globalThis.game?.user?.isGM !== true) return null;
  const items = ammunitionItems(actor);
  if (!items.length || typeof DialogV2?.wait !== "function") {
    globalThis.ui?.notifications?.warn?.("В инвентаре нет доступных боеприпасов.");
    return null;
  }
  const optionsHtml = items.map((item) => (
    `<option value="${escapeHtml(item.id)}">${escapeHtml(item.name)} (${itemQuantity(item)})</option>`
  )).join("");
  return DialogV2.wait({
    window: { title: "Механизм перезарядки оружия" },
    content: `
      <form class="rm-implant-reload-dialog">
        <div class="form-group">
          <label>Боеприпасы</label>
          <select name="ammunitionItemId">${optionsHtml}</select>
        </div>
        <div class="form-group">
          <label>Количество</label>
          <input type="number" name="amount" value="20" min="1" max="20" step="1">
        </div>
      </form>
    `,
    buttons: [{
      action: "load",
      label: "Загрузить",
      icon: "fa-solid fa-bullets",
      default: true,
      callback: (_event, _button, dialog) => ({
        ammunitionItemId: cleanText(
          dialog?.element?.querySelector?.('[name="ammunitionItemId"]')?.value
        ),
        amount: Number(dialog?.element?.querySelector?.('[name="amount"]')?.value)
      })
    }, {
      action: "cancel",
      label: "Отмена",
      callback: () => null
    }],
    close: () => null
  });
}

export function renderImplantItemSheetActions(app, html, moduleApi) {
  const root = rootElement(html);
  const item = app?.document ?? app?.item ?? null;
  const actor = item?.actor ?? item?.parent ?? null;
  const automationService = moduleApi?.implantAutomationService;
  const attackService = moduleApi?.combatAttackService;
  if (
    !root
    || !actor
    || itemGearId(item) !== RELOAD_MECHANISM_ID
    || typeof automationService?.hasCapability !== "function"
    || !automationService.hasCapability(actor, "reloadWithoutFreeHand")
    || typeof attackService?.loadImplantReloadReservoir !== "function"
  ) {
    return false;
  }

  if (root.querySelector(ACTION_SELECTOR)) return true;
  const container = root.querySelector("form") ?? root;
  if (typeof container?.insertAdjacentHTML !== "function") return false;
  container.insertAdjacentHTML("beforeend", `
    <section class="rm-implant-item-actions">
      <button type="button" data-rebreya-implant-reload-action>
        <i class="fa-solid fa-bullets" aria-hidden="true"></i>
        Загрузить механизм
      </button>
      <p class="hint">Действием поместить во внутренний боезапас до 20 единиц выбранных боеприпасов.</p>
    </section>
  `);
  const button = root.querySelector(ACTION_SELECTOR);
  if (!button || typeof button.addEventListener !== "function") return false;
  button.addEventListener("click", async (event) => {
    event.preventDefault();
    event.stopPropagation();
    try {
      const prompt = typeof moduleApi?.promptImplantReloadReservoir === "function"
        ? moduleApi.promptImplantReloadReservoir
        : promptImplantReloadReservoir;
      const selection = await prompt(actor);
      if (!selection) return;
      await attackService.loadImplantReloadReservoir(actor, selection);
    }
    catch (error) {
      console.error(`${MODULE_ID} | Failed to load implant ammunition reservoir.`, error);
      globalThis.ui?.notifications?.error?.("Не удалось загрузить механизм перезарядки.");
    }
  });
  return true;
}
