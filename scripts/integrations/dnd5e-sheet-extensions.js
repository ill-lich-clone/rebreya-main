import { MODULE_ID, REBREYA_TOOLS } from "../constants.js";
import { bringAppToFront } from "../ui.js";
import {
  getHeroDollSlotGroups,
  inferHeroDollSlotGroupFromSlots,
  mapSlotGroupToHeroDollSlots,
  normalizeHeroDollSlotGroup,
  normalizeHeroDollSlots
} from "../data/item-classification.js";

const HERO_DOLL_TAB_ID = "heroDoll";
const HERO_DOLL_TAB_LABEL = "Кукла героя";
const HERO_DOLL_TAB_ICON = "fa-solid fa-person";
const HERO_DOLL_TEMPLATE = `modules/${MODULE_ID}/templates/hero-doll-tab.hbs`;
const HERO_DOLL_PATCH_FLAG = "__rebreyaHeroDollPatched";
const HERO_DOLL_MOVE_DROP_PATCH_FLAG = "__rebreyaHeroDollMoveDropPatched";
const HERO_DOLL_PAYLOAD_PATCH_FLAG = "__rebreyaHeroDollPayloadPatched";
const HEROIC_D20_DIALOG_PATCH_FLAG = "__rebreyaHeroicD20DialogPatched";
const HEROIC_D20_ROLL_PATCH_FLAG = "__rebreyaHeroicD20RollPatched";
const HEROIC_D20_KEYBINDINGS_PATCH_FLAG = "__rebreyaHeroicD20KeybindingsPatched";
const HEROIC_ADVANTAGE_ACTION = "heroic-advantage";
const HEROIC_DISADVANTAGE_ACTION = "heroic-disadvantage";
const ITEM_RANK_MIN = 0;
const ITEM_RANK_MAX = 10;
const ITEM_SLOT_ELIGIBLE_TYPES = new Set(["weapon", "consumable", "equipment"]);
const HERO_DOLL_DROP_MIME_TYPES = ["text/plain", "text", "application/json"];
const REBREYA_TOOL_LABEL_BY_ID = new Map(REBREYA_TOOLS.map((tool) => [tool.id, tool.label]));
const REBREYA_TOOL_ID_BY_TEXT = new Map(REBREYA_TOOLS.map((tool) => [normalizeLookupText(tool.label), tool.id]));
const LICH_WEAPON_PROPERTY_DEFINITIONS = Object.freeze([
  { key: "lchGrip", label: "Хват [L]" },
  { key: "lchPower", label: "Силовое [L]" },
  { key: "lchSwing", label: "Размах [L]" },
  { key: "lchBackswing", label: "О. замах [L]" },
  { key: "lchInterfere", label: "Мешающее [L]" },
  { key: "lchAim", label: "Прицел [L]" },
  { key: "lchPush", label: "Толчок [L]" },
  { key: "lchTrip", label: "Опрокид. [L]" },
  { key: "lchStrReq", label: "Мин. сила [L]" },
  { key: "lchArcShot", label: "Навес [L]" },
  { key: "lchMechanism", label: "Механизм [L]" },
  { key: "lchDash", label: "Наскок [L]" },
  { key: "lchMku", label: "МКУ [L]" },
  { key: "lchMu", label: "МУ [L]" },
  { key: "lchRku", label: "РКУ [L]" },
  { key: "lchWhirl", label: "Круговая [L]" },
  { key: "lchReach", label: "Досяг. [L]" },
  { key: "lchPowerStrike", label: "Сил. удар [L]" },
  { key: "lchMounted", label: "Верховой [L]" },
  { key: "lchDeadly", label: "Смерт. [L]" },
  { key: "lchPoison", label: "Отравл. [L]" }
]);
const LICH_WEAPON_VALUE_FIELDS = Object.freeze([
  { key: "gripModes", propertyKey: "lchGrip", label: "Хват [L]", type: "text", placeholder: "Напр.: 1к8 / 1к10" },
  { key: "minStrength", propertyKey: "lchStrReq", label: "Мин. сила [L]", type: "number", min: 0, step: 1 },
  { key: "mechanism", propertyKey: "lchMechanism", label: "Мех. [L]", type: "number", min: 0, step: 1 },
  { key: "dashDice", propertyKey: "lchDash", label: "Наскок [L]", type: "text", placeholder: "Напр.: 1к2" },
  { key: "reachBonus", propertyKey: "lchReach", label: "Досяг. [L] (фт)", type: "number", min: 0, step: 5 },
  { key: "mku", propertyKey: "lchMku", label: "МКУ [L]", type: "number", min: 0, step: 1 },
  { key: "mu", propertyKey: "lchMu", label: "МУ [L]", type: "number", min: 0, step: 1 },
  { key: "rku", propertyKey: "lchRku", label: "РКУ [L]", type: "number", min: 0, step: 1 },
  { key: "deadly", propertyKey: "lchDeadly", label: "Смерт. [L]", type: "number", min: 0, step: 1 }
]);
const LEGACY_REBREYA_TOOL_LABEL_ALIASES = [
  ["Воровские", "thieves"],
  ["Алхимические", "alchemy"],
  ["Кузнеца", "smith"],
  ["Каллиграфа", "calligrapher"],
  ["Поддельщика", "forgery"],
  ["Гримёра", "disguise"],
  ["Художественные", "artisan"],
  ["Исследователя", "investigator"],
  ["Жестянщика", "tinker"],
  ["Камнелома", "mason"],
  ["Каменолома", "mason"],
  ["Кожедела", "leatherworker"],
  ["Пивовара", "brewer"],
  ["Деревянщика", "woodcarver"],
  ["Повара", "cook"],
  ["Ювелира", "jeweler"]
];
REBREYA_TOOL_ID_BY_TEXT.set(normalizeLookupText("Камнелома"), "mason");
REBREYA_TOOL_ID_BY_TEXT.set(normalizeLookupText("Каменолома"), "mason");
for (const [legacyLabel, toolId] of LEGACY_REBREYA_TOOL_LABEL_ALIASES) {
  REBREYA_TOOL_ID_BY_TEXT.set(normalizeLookupText(legacyLabel), toolId);
}

function normalizeLookupText(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/['\u2019\u2018\u02BC\u02B9\u2032"\u201C\u201D\u00AB\u00BB]/gu, "")
    .replace(/\s+/gu, " ");
}

function normalizeRebreyaToolId(value) {
  const normalized = normalizeLookupText(value);
  if (!normalized) {
    return "";
  }

  if (REBREYA_TOOL_LABEL_BY_ID.has(normalized)) {
    return normalized;
  }

  return REBREYA_TOOL_ID_BY_TEXT.get(normalized) ?? "";
}

function toFiniteNumber(value, fallback = 0) {
  const numeric = Number(value ?? fallback);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function normalizeNonNegativeInteger(value, fallback = 0) {
  return Math.max(0, Math.floor(toFiniteNumber(value, fallback)));
}

function getLichWeaponPropertyValues(item) {
  if (!(item instanceof Item)) {
    return {};
  }

  const source = item.getFlag(MODULE_ID, "lichWeaponPropertyValues");
  if (!source || typeof source !== "object" || Array.isArray(source)) {
    return {};
  }

  return foundry.utils.deepClone(source);
}

function normalizeLichWeaponValue(field, value) {
  if (field.type === "number") {
    return normalizeNonNegativeInteger(value, 0);
  }

  return String(value ?? "").trim();
}

let activeHeroDollDragData = null;
const heroDollPanelAbortControllers = new WeakMap();
const heroDollRootAbortControllers = new WeakMap();

function isDnd5eWorld() {
  return game.system?.id === "dnd5e";
}

function getCharacterActorSheetClass() {
  return game.dnd5e?.applications?.actor?.CharacterActorSheet ?? null;
}

function getSheetRoot(html) {
  if (!html) {
    return null;
  }

  if (html instanceof HTMLElement) {
    return html;
  }

  if (html[0] instanceof HTMLElement) {
    return html[0];
  }

  return null;
}

function getActorFromSheetApp(app) {
  const actor = app?.actor ?? app?.document ?? app?.object ?? null;
  return actor instanceof Actor ? actor : null;
}

function getItemFromSheetApp(app) {
  const item = app?.item ?? app?.document ?? app?.object ?? null;
  return item instanceof Item ? item : null;
}

function isSheetEditable(app, root = null) {
  let editableByPermission = false;
  if (typeof app?.isEditable === "boolean") {
    editableByPermission = app.isEditable;
  }
  else if (typeof app?.options?.editable === "boolean") {
    editableByPermission = app.options.editable;
  }
  else {
    const item = getItemFromSheetApp(app);
    editableByPermission = Boolean(item?.isOwner);
  }

  if (!editableByPermission) {
    return false;
  }

  const modes = app?.constructor?.MODES;
  const editMode = modes?.EDIT;
  if (editMode !== undefined && editMode !== null) {
    const currentMode = app?._mode;
    if (currentMode !== undefined && currentMode !== null) {
      return currentMode === editMode;
    }
  }

  if (root instanceof HTMLElement) {
    if (root.classList.contains("interactable")) {
      return false;
    }

    if (root.classList.contains("editable")) {
      return true;
    }
  }

  return editableByPermission;
}

function buildHeroDollTabState(app) {
  const active = app.tabGroups?.primary === HERO_DOLL_TAB_ID;
  return {
    id: HERO_DOLL_TAB_ID,
    tab: HERO_DOLL_TAB_ID,
    group: "primary",
    label: HERO_DOLL_TAB_LABEL,
    icon: HERO_DOLL_TAB_ICON,
    active,
    cssClass: active ? "active" : ""
  };
}

function ensureHeroDollTabDefinition(CharacterActorSheet) {
  if (!Array.isArray(CharacterActorSheet.TABS)) {
    CharacterActorSheet.TABS = [];
  }

  if (!CharacterActorSheet.TABS.some((tab) => tab?.tab === HERO_DOLL_TAB_ID)) {
    const nextTabs = [...CharacterActorSheet.TABS];
    const insertIndex = nextTabs.findIndex((tab) => tab?.tab === "specialTraits");
    const tabEntry = {
      tab: HERO_DOLL_TAB_ID,
      label: HERO_DOLL_TAB_LABEL,
      icon: HERO_DOLL_TAB_ICON
    };

    if (insertIndex >= 0) {
      nextTabs.splice(insertIndex, 0, tabEntry);
    }
    else {
      nextTabs.push(tabEntry);
    }

    CharacterActorSheet.TABS = nextTabs;
  }

  CharacterActorSheet.PARTS = {
    ...CharacterActorSheet.PARTS,
    [HERO_DOLL_TAB_ID]: {
      classes: ["flexcol"],
      container: { classes: ["tab-body"], id: "tabs" },
      template: HERO_DOLL_TEMPLATE,
      scrollable: [""]
    }
  };
}

function patchHeroDollPartContext(CharacterActorSheet, moduleApi) {
  if (CharacterActorSheet.prototype[HERO_DOLL_PATCH_FLAG]) {
    return;
  }

  const originalPreparePartContext = CharacterActorSheet.prototype._preparePartContext;
  CharacterActorSheet.prototype._preparePartContext = async function (partId, context, options) {
    const prepared = await originalPreparePartContext.call(this, partId, context, options);
    if (partId !== HERO_DOLL_TAB_ID) {
      return prepared;
    }

    const tab = buildHeroDollTabState(this);
    return {
      ...prepared,
      tab,
      heroDollTab: tab,
      heroDoll: moduleApi.heroDollService.getActorSnapshot(this.actor)
    };
  };

  Object.defineProperty(CharacterActorSheet.prototype, HERO_DOLL_PATCH_FLAG, {
    configurable: false,
    enumerable: false,
    writable: false,
    value: true
  });
}

function patchActorMoveDropBehavior() {
  const BaseActorSheet = game.dnd5e?.applications?.actor?.BaseActorSheet ?? null;
  if (!BaseActorSheet?.prototype || BaseActorSheet.prototype[HERO_DOLL_MOVE_DROP_PATCH_FLAG]) {
    return;
  }

  const originalOnDropItem = BaseActorSheet.prototype._onDropItem;
  if (typeof originalOnDropItem !== "function") {
    return;
  }

  BaseActorSheet.prototype._onDropItem = async function (event, item) {
    const sourceActor = item?.parent instanceof Actor ? item.parent : null;
    const targetActor = this.inventorySource instanceof Actor
      ? this.inventorySource
      : getActorFromSheetApp(this);

    if (
      sourceActor instanceof Actor
      && targetActor instanceof Actor
      && sourceActor.isOwner
      && targetActor.isOwner
      && event?._behavior !== "move"
    ) {
      event._behavior = "move";
    }

    return originalOnDropItem.call(this, event, item);
  };

  Object.defineProperty(BaseActorSheet.prototype, HERO_DOLL_MOVE_DROP_PATCH_FLAG, {
    configurable: false,
    enumerable: false,
    writable: false,
    value: true
  });
}

function patchDnd5eDragPayloadFallback() {
  const DragDropClass = CONFIG?.ux?.DragDrop ?? null;
  if (!DragDropClass?.getPayload || DragDropClass[HERO_DOLL_PAYLOAD_PATCH_FLAG]) {
    return;
  }

  const originalGetPayload = DragDropClass.getPayload;
  DragDropClass.getPayload = function (event) {
    const payload = originalGetPayload.call(this, event);
    if (payload && typeof payload === "object") {
      return payload;
    }

    for (const mimeType of HERO_DOLL_DROP_MIME_TYPES) {
      const parsed = parseDropDataRaw(event?.dataTransfer?.getData?.(mimeType));
      if (parsed && typeof parsed === "object") {
        return parsed;
      }
    }

    const uriParsed = parseDropDataRaw(event?.dataTransfer?.getData?.("text/uri-list"));
    if (uriParsed && typeof uriParsed === "object") {
      return uriParsed;
    }

    return payload;
  };

  Object.defineProperty(DragDropClass, HERO_DOLL_PAYLOAD_PATCH_FLAG, {
    configurable: false,
    enumerable: false,
    writable: false,
    value: true
  });
}

function getHeroicRollButtonLabels() {
  const fallbackAdvantage = "ГЕРОИЧ. ПРЕИМУЩЕСТВО";
  const fallbackDisadvantage = "ГЕРОИЧ. ПОМЕХА";
  return {
    heroicAdvantage: game.i18n?.localize?.("REBREYA_MAIN.Combat.HeroicAdvantageButton") || fallbackAdvantage,
    heroicDisadvantage: game.i18n?.localize?.("REBREYA_MAIN.Combat.HeroicDisadvantageButton") || fallbackDisadvantage
  };
}

function patchD20HeroicRollDialog() {
  const D20Roll = CONFIG?.Dice?.D20Roll ?? null;
  const D20Dialog = game.dnd5e?.applications?.dice?.D20RollConfigurationDialog ?? null;
  if (!D20Roll?.prototype || !D20Dialog?.prototype) {
    return;
  }

  if (!D20Dialog.prototype[HEROIC_D20_DIALOG_PATCH_FLAG]) {
    const originalPrepareButtonsContext = D20Dialog.prototype._prepareButtonsContext;
    const originalFinalizeRolls = D20Dialog.prototype._finalizeRolls;

    D20Dialog.prototype._prepareButtonsContext = async function (context, options) {
      const preparedContext = await originalPrepareButtonsContext.call(this, context, options);
      const labels = getHeroicRollButtonLabels();

      const sourceButtons = preparedContext?.buttons ?? {};
      const advantageButton = sourceButtons.advantage ?? {
        default: false,
        label: game.i18n.localize("DND5E.Advantage")
      };
      const normalButton = sourceButtons.normal ?? {
        default: true,
        label: game.i18n.localize("DND5E.Normal")
      };
      const disadvantageButton = sourceButtons.disadvantage ?? {
        default: false,
        label: game.i18n.localize("DND5E.Disadvantage")
      };

      const buttons = {
        advantage: { ...advantageButton },
        normal: { ...normalButton },
        disadvantage: { ...disadvantageButton },
        [HEROIC_ADVANTAGE_ACTION]: {
          default: false,
          label: labels.heroicAdvantage
        },
        [HEROIC_DISADVANTAGE_ACTION]: {
          default: false,
          label: labels.heroicDisadvantage
        }
      };

      // Ensure exactly one button keeps autofocus.
      if (buttons.advantage.default || buttons.disadvantage.default || buttons.normal.default) {
        buttons[HEROIC_ADVANTAGE_ACTION].default = false;
        buttons[HEROIC_DISADVANTAGE_ACTION].default = false;
      }
      else {
        buttons.normal.default = true;
      }

      preparedContext.buttons = buttons;
      return preparedContext;
    };

    D20Dialog.prototype._finalizeRolls = function (action) {
      if (![HEROIC_ADVANTAGE_ACTION, HEROIC_DISADVANTAGE_ACTION].includes(action)) {
        for (const roll of this.rolls ?? []) {
          if (roll?.options && Object.hasOwn(roll.options, "rebreyaHeroicMode")) {
            delete roll.options.rebreyaHeroicMode;
          }
        }
        return originalFinalizeRolls.call(this, action);
      }

      const heroicMode = action === HEROIC_ADVANTAGE_ACTION ? "advantage" : "disadvantage";
      const advantageMode = heroicMode === "advantage"
        ? D20Roll.ADV_MODE.ADVANTAGE
        : D20Roll.ADV_MODE.DISADVANTAGE;

      return this.rolls.map((roll) => {
        roll.options.advantageMode = advantageMode;
        roll.options.rebreyaHeroicMode = heroicMode;
        roll.configureModifiers();
        return roll;
      });
    };

    Object.defineProperty(D20Dialog.prototype, HEROIC_D20_DIALOG_PATCH_FLAG, {
      configurable: false,
      enumerable: false,
      writable: false,
      value: true
    });
  }

  if (!D20Roll.prototype[HEROIC_D20_ROLL_PATCH_FLAG]) {
    const originalConfigureModifiers = D20Roll.prototype.configureModifiers;

    D20Roll.prototype.configureModifiers = function (...args) {
      const result = originalConfigureModifiers.call(this, ...args);
      const heroicMode = String(this.options?.rebreyaHeroicMode ?? "").trim().toLowerCase();
      if (!this.validD20Roll || !["advantage", "disadvantage"].includes(heroicMode)) {
        return result;
      }

      const modifiers = Array.isArray(this.d20?.modifiers) ? this.d20.modifiers : null;
      if (!modifiers) {
        return result;
      }

      const existingModifierIndex = modifiers.findIndex((modifier) => ["kh", "kl"].includes(modifier));
      if (existingModifierIndex >= 0) {
        modifiers.splice(existingModifierIndex, 1);
      }

      this.d20.number = 3;
      modifiers.push(heroicMode === "advantage" ? "kh" : "kl");
      this.resetFormula();
      return result;
    };

    Object.defineProperty(D20Roll.prototype, HEROIC_D20_ROLL_PATCH_FLAG, {
      configurable: false,
      enumerable: false,
      writable: false,
      value: true
    });
  }

  if (!D20Roll[HEROIC_D20_KEYBINDINGS_PATCH_FLAG]) {
    const originalApplyKeybindings = D20Roll.applyKeybindings;

    D20Roll.applyKeybindings = function (config = {}, dialog = {}, message = {}) {
      const outcome = originalApplyKeybindings.call(this, config, dialog, message);
      const event = config?.event ?? null;
      const shift = Boolean(event?.shiftKey);
      const alt = Boolean(event?.altKey);
      const ctrlOrMeta = Boolean(event?.ctrlKey || event?.metaKey);

      let heroicMode = "";
      if (shift && alt && !ctrlOrMeta) {
        heroicMode = "advantage";
      }
      else if (shift && ctrlOrMeta && !alt) {
        heroicMode = "disadvantage";
      }

      for (const roll of config?.rolls ?? []) {
        roll.options ??= {};

        if (heroicMode === "advantage") {
          roll.options.advantageMode = D20Roll.ADV_MODE.ADVANTAGE;
          roll.options.rebreyaHeroicMode = "advantage";
        }
        else if (heroicMode === "disadvantage") {
          roll.options.advantageMode = D20Roll.ADV_MODE.DISADVANTAGE;
          roll.options.rebreyaHeroicMode = "disadvantage";
        }
        else if (Object.hasOwn(roll.options, "rebreyaHeroicMode")) {
          delete roll.options.rebreyaHeroicMode;
        }
      }

      if (heroicMode) {
        dialog.configure = false;
      }

      return outcome;
    };

    Object.defineProperty(D20Roll, HEROIC_D20_KEYBINDINGS_PATCH_FLAG, {
      configurable: false,
      enumerable: false,
      writable: false,
      value: true
    });
  }
}

function setItemDragData(event, itemUuid) {
  if (!itemUuid || !event?.dataTransfer) {
    return;
  }

  event.dataTransfer.effectAllowed = "all";
  const payload = JSON.stringify({
    type: "Item",
    uuid: itemUuid
  });

  for (const mimeType of [...HERO_DOLL_DROP_MIME_TYPES, "text/uri-list"]) {
    try {
      event.dataTransfer.setData(mimeType, payload);
    }
    catch (_error) {
      // ignore unsupported mime types
    }
  }

  activeHeroDollDragData = {
    type: "Item",
    uuid: itemUuid
  };
}

function resolvePreferredDropEffect(dataTransfer, preferred = "move") {
  const effectAllowed = String(dataTransfer?.effectAllowed ?? "").trim().toLowerCase();
  if (!effectAllowed || effectAllowed === "all" || effectAllowed === "uninitialized") {
    return preferred;
  }

  const allows = (effect) => effectAllowed === effect || effectAllowed.includes(effect);
  if (preferred && allows(preferred)) {
    return preferred;
  }

  if (allows("copy")) {
    return "copy";
  }

  if (allows("move")) {
    return "move";
  }

  if (allows("link")) {
    return "link";
  }

  return "none";
}

function parseDropDataRaw(rawValue) {
  if (!rawValue) {
    return null;
  }

  try {
    const parsed = JSON.parse(rawValue);
    if (parsed && typeof parsed === "object") {
      return parsed;
    }
  }
  catch (_error) {
    if (/^(Actor|Compendium|Item)\./u.test(String(rawValue))) {
      return {
        type: "Item",
        uuid: String(rawValue).trim()
      };
    }
  }

  return null;
}

function getHeroDollDropData(event) {
  try {
    const dragData = TextEditor.getDragEventData(event);
    if (dragData && typeof dragData === "object" && dragData.uuid) {
      return dragData;
    }
  }
  catch (_error) {
    // fallback to raw dataTransfer parsing
  }

  for (const mimeType of HERO_DOLL_DROP_MIME_TYPES) {
    const parsed = parseDropDataRaw(event?.dataTransfer?.getData?.(mimeType));
    if (parsed?.uuid) {
      return parsed;
    }
  }

  const uriParsed = parseDropDataRaw(event?.dataTransfer?.getData?.("text/uri-list"));
  if (uriParsed?.uuid) {
    return uriParsed;
  }

  return activeHeroDollDragData ? foundry.utils.deepClone(activeHeroDollDragData) : {};
}

async function rerenderActorSheet(app, moduleApi) {
  try {
    await app.render({ force: true });
  }
  catch (_error) {
    await app.render(true);
  }

  await moduleApi.refreshOpenApps();
}

function parseAllowedSlots(value) {
  return normalizeHeroDollSlots(
    String(value ?? "")
      .split(/[,\s|;]+/u)
      .map((entry) => entry.trim())
      .filter(Boolean),
    []
  );
}

function setHeroDollDragHighlight(panel, slotIds = []) {
  const allowed = new Set(normalizeHeroDollSlots(slotIds, []));
  const hasAllowed = allowed.size > 0;

  panel.querySelectorAll("[data-hero-doll-slot='true']").forEach((slotButton) => {
    const slotId = String(slotButton.dataset.slotId ?? "").trim();
    const isAllowed = hasAllowed && allowed.has(slotId);
    slotButton.classList.toggle("is-target", isAllowed);
    slotButton.classList.toggle("is-dimmed", hasAllowed && !isAllowed);
  });
}

function clearHeroDollDragHighlight(panel) {
  panel.querySelectorAll("[data-hero-doll-slot='true']").forEach((slotButton) => {
    slotButton.classList.remove("is-target", "is-dimmed");
  });
}

function getHeroDollPanelFromEvent(root, event) {
  const candidate = event?.target?.closest?.(`.rm-hero-doll-tab[data-tab='${HERO_DOLL_TAB_ID}']`);
  if (!(candidate instanceof HTMLElement) || !root.contains(candidate)) {
    return null;
  }

  return candidate;
}

function bindHeroDollSlotListeners(panel, app, moduleApi, listenerOptions = undefined) {
  const actor = getActorFromSheetApp(app);
  if (!actor) {
    return;
  }

  panel.querySelectorAll("[data-hero-doll-slot='true']").forEach((slot) => {
    slot.addEventListener("dragover", (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (event.dataTransfer) {
        event.dataTransfer.dropEffect = resolvePreferredDropEffect(event.dataTransfer, "move");
      }
      slot.classList.add("is-dragover");
    }, listenerOptions);

    slot.addEventListener("dragleave", (event) => {
      event.stopPropagation();
      slot.classList.remove("is-dragover");
    }, listenerOptions);

    slot.addEventListener("drop", async (event) => {
      event.preventDefault();
      event.stopPropagation();
      slot.classList.remove("is-dragover");
      clearHeroDollDragHighlight(panel);

      try {
        const dragData = getHeroDollDropData(event);
        await moduleApi.heroDollService.assignItemToSlot(actor, slot.dataset.slotId, dragData);
        await rerenderActorSheet(app, moduleApi);
      }
      catch (error) {
        console.error(`${MODULE_ID} | Failed to assign hero doll slot.`, error);
        ui.notifications?.error(error.message || "Не удалось поместить предмет в слот куклы героя.");
      }
      finally {
        activeHeroDollDragData = null;
      }
    }, listenerOptions);
  });
}

function bindHeroDollInventoryListeners(panel, app, listenerOptions = undefined) {
  const actor = getActorFromSheetApp(app);
  if (!actor) {
    return;
  }

  panel.querySelectorAll("[data-hero-doll-item-drag='true']").forEach((entry) => {
    entry.addEventListener("dragstart", (event) => {
      setItemDragData(event, event.currentTarget.dataset.itemUuid);
      setHeroDollDragHighlight(panel, parseAllowedSlots(event.currentTarget.dataset.allowedSlots));
    }, listenerOptions);

    entry.addEventListener("dragend", () => {
      clearHeroDollDragHighlight(panel);
      activeHeroDollDragData = null;
    }, listenerOptions);
  });
}

function bindHeroDollClickDelegation(panel, app, moduleApi, listenerOptions = undefined) {
  panel.addEventListener("click", async (event) => {
    const actionTarget = event.target.closest?.("[data-action]");
    if (!(actionTarget instanceof HTMLElement) || !panel.contains(actionTarget)) {
      return;
    }

    const action = String(actionTarget.dataset.action ?? "").trim();
    if (!action) {
      return;
    }

    const actor = getActorFromSheetApp(app);
    if (!actor) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();

    switch (action) {
      case "open-slot-item": {
        try {
          const item = await moduleApi.heroDollService.openSlotItem(actor, actionTarget.dataset.slotId);
          bringAppToFront(item?.sheet);
        }
        catch (error) {
          console.error(`${MODULE_ID} | Failed to open hero doll item.`, error);
          ui.notifications?.error(error.message || "Не удалось открыть предмет из вкладки куклы героя.");
        }
        break;
      }

      case "clear-slot": {
        try {
          await moduleApi.heroDollService.clearSlot(actor, actionTarget.dataset.slotId);
          await rerenderActorSheet(app, moduleApi);
        }
        catch (error) {
          console.error(`${MODULE_ID} | Failed to clear hero doll slot.`, error);
          ui.notifications?.error(error.message || "Не удалось очистить слот куклы героя.");
        }
        break;
      }

      case "open-inventory-item": {
        try {
          const item = actor.items?.get?.(actionTarget.dataset.itemId) ?? null;
          if (!item) {
            return;
          }

          await item.sheet?.render?.(true);
          bringAppToFront(item.sheet);
        }
        catch (error) {
          console.error(`${MODULE_ID} | Failed to open inventory item from hero doll tab.`, error);
          ui.notifications?.error("Не удалось открыть предмет персонажа.");
        }
        break;
      }

      case "open-party-inventory": {
        try {
          await moduleApi.openInventoryApp();
        }
        catch (error) {
          console.error(`${MODULE_ID} | Failed to open party inventory from hero doll tab.`, error);
          ui.notifications?.error("Не удалось открыть партийный склад.");
        }
        break;
      }

      default:
        break;
    }
  }, listenerOptions);
}

function bindHeroDollDelegatedListeners(root, app, moduleApi, listenerOptions = undefined) {
  root.addEventListener("dragstart", (event) => {
    const entry = event.target.closest?.("[data-hero-doll-item-drag='true']");
    const panel = entry ? getHeroDollPanelFromEvent(root, event) : null;
    if (!(entry instanceof HTMLElement) || !panel) {
      return;
    }

    setItemDragData(event, entry.dataset.itemUuid);
    setHeroDollDragHighlight(panel, parseAllowedSlots(entry.dataset.allowedSlots));
  }, listenerOptions);

  root.addEventListener("dragend", (event) => {
    const entry = event.target.closest?.("[data-hero-doll-item-drag='true']");
    const panel = entry ? getHeroDollPanelFromEvent(root, event) : null;
    if (!(entry instanceof HTMLElement) || !panel) {
      return;
    }

    clearHeroDollDragHighlight(panel);
    activeHeroDollDragData = null;
  }, listenerOptions);

  root.addEventListener("dragover", (event) => {
    const slot = event.target.closest?.("[data-hero-doll-slot='true']");
    const panel = slot ? getHeroDollPanelFromEvent(root, event) : null;
    if (!(slot instanceof HTMLElement) || !panel) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    if (event.dataTransfer) {
      event.dataTransfer.dropEffect = resolvePreferredDropEffect(event.dataTransfer, "move");
    }
    slot.classList.add("is-dragover");
  }, listenerOptions);

  root.addEventListener("dragleave", (event) => {
    const slot = event.target.closest?.("[data-hero-doll-slot='true']");
    const panel = slot ? getHeroDollPanelFromEvent(root, event) : null;
    if (!(slot instanceof HTMLElement) || !panel) {
      return;
    }

    event.stopPropagation();
    slot.classList.remove("is-dragover");
  }, listenerOptions);

  root.addEventListener("drop", async (event) => {
    const slot = event.target.closest?.("[data-hero-doll-slot='true']");
    const panel = slot ? getHeroDollPanelFromEvent(root, event) : null;
    if (!(slot instanceof HTMLElement) || !panel) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    slot.classList.remove("is-dragover");
    clearHeroDollDragHighlight(panel);

    const actor = getActorFromSheetApp(app);
    if (!actor) {
      return;
    }

    try {
      const dragData = getHeroDollDropData(event);
      await moduleApi.heroDollService.assignItemToSlot(actor, slot.dataset.slotId, dragData);
      await rerenderActorSheet(app, moduleApi);
    }
    catch (error) {
      console.error(`${MODULE_ID} | Failed to assign hero doll slot.`, error);
      ui.notifications?.error(error.message || "Не удалось поместить предмет в слот куклы героя.");
    }
    finally {
      activeHeroDollDragData = null;
    }
  }, listenerOptions);

  root.addEventListener("click", async (event) => {
    const actionTarget = event.target.closest?.("[data-action]");
    if (!(actionTarget instanceof HTMLElement)) {
      return;
    }

    const panel = getHeroDollPanelFromEvent(root, event);
    if (!panel || !panel.contains(actionTarget)) {
      return;
    }

    const action = String(actionTarget.dataset.action ?? "").trim();
    if (!action) {
      return;
    }

    const actor = getActorFromSheetApp(app);
    if (!actor) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();

    switch (action) {
      case "open-slot-item": {
        try {
          const item = await moduleApi.heroDollService.openSlotItem(actor, actionTarget.dataset.slotId);
          bringAppToFront(item?.sheet);
        }
        catch (error) {
          console.error(`${MODULE_ID} | Failed to open hero doll item.`, error);
          ui.notifications?.error(error.message || "Не удалось открыть предмет из вкладки куклы героя.");
        }
        break;
      }

      case "clear-slot": {
        try {
          await moduleApi.heroDollService.clearSlot(actor, actionTarget.dataset.slotId);
          await rerenderActorSheet(app, moduleApi);
        }
        catch (error) {
          console.error(`${MODULE_ID} | Failed to clear hero doll slot.`, error);
          ui.notifications?.error(error.message || "Не удалось очистить слот куклы героя.");
        }
        break;
      }

      case "open-inventory-item": {
        try {
          const item = actor.items?.get?.(actionTarget.dataset.itemId) ?? null;
          if (!item) {
            return;
          }

          await item.sheet?.render?.(true);
          bringAppToFront(item.sheet);
        }
        catch (error) {
          console.error(`${MODULE_ID} | Failed to open inventory item from hero doll tab.`, error);
          ui.notifications?.error("Не удалось открыть предмет персонажа.");
        }
        break;
      }

      case "open-party-inventory": {
        try {
          await moduleApi.openInventoryApp();
        }
        catch (error) {
          console.error(`${MODULE_ID} | Failed to open party inventory from hero doll tab.`, error);
          ui.notifications?.error("Не удалось открыть партийный склад.");
        }
        break;
      }

      default:
        break;
    }
  }, listenerOptions);
}

function bindHeroDollPanel(root, app, moduleApi) {
  const panel = root.querySelector(`[data-application-part='${HERO_DOLL_TAB_ID}'] .rm-hero-doll-tab`)
    ?? root.querySelector(`.rm-hero-doll-tab[data-tab='${HERO_DOLL_TAB_ID}']`);
  if (!panel) {
    if (root.dataset.rebreyaHeroDollWatch !== "true") {
      root.dataset.rebreyaHeroDollWatch = "true";
      root.addEventListener("click", (event) => {
        const tabTrigger = event.target.closest?.(`[data-tab='${HERO_DOLL_TAB_ID}']`);
        if (!tabTrigger) {
          return;
        }

        window.setTimeout(() => bindHeroDollPanel(root, app, moduleApi), 0);
      });
      window.setTimeout(() => bindHeroDollPanel(root, app, moduleApi), 0);
    }

    return;
  }

  heroDollPanelAbortControllers.get(panel)?.abort();
  const panelAbortController = new AbortController();
  heroDollPanelAbortControllers.set(panel, panelAbortController);
  const panelListenerOptions = { signal: panelAbortController.signal };
  bindHeroDollSlotListeners(panel, app, moduleApi, panelListenerOptions);
  bindHeroDollInventoryListeners(panel, app, panelListenerOptions);

  heroDollRootAbortControllers.get(root)?.abort();
  const rootAbortController = new AbortController();
  heroDollRootAbortControllers.set(root, rootAbortController);
  const rootListenerOptions = { signal: rootAbortController.signal };
  bindHeroDollDelegatedListeners(root, app, moduleApi, rootListenerOptions);
}

function clampItemRank(value) {
  const numericValue = Number(value ?? ITEM_RANK_MIN);
  if (!Number.isFinite(numericValue)) {
    return ITEM_RANK_MIN;
  }

  return Math.max(ITEM_RANK_MIN, Math.min(ITEM_RANK_MAX, Math.round(numericValue)));
}

function getItemRank(item) {
  if (!(item instanceof Item)) {
    return ITEM_RANK_MIN;
  }

  return clampItemRank(
    item.getFlag(MODULE_ID, "rank")
    ?? item.getFlag(MODULE_ID, "itemRank")
    ?? foundry.utils.getProperty(item, `flags.${MODULE_ID}.rank`)
    ?? ITEM_RANK_MIN
  );
}

function getItemSlotGroup(item) {
  if (!(item instanceof Item)) {
    return "";
  }

  const explicitGroup = normalizeHeroDollSlotGroup(
    item.getFlag(MODULE_ID, "itemSlot")
    ?? item.getFlag(MODULE_ID, "slot")
    ?? "",
    ""
  );
  if (explicitGroup) {
    return explicitGroup;
  }

  const explicitSlots = normalizeHeroDollSlots(
    item.getFlag(MODULE_ID, "heroDollSlots")
    ?? item.getFlag(MODULE_ID, "allowedHeroDollSlots")
    ?? foundry.utils.getProperty(item, `flags.${MODULE_ID}.heroDoll.slots`)
    ?? foundry.utils.getProperty(item, "system.heroDollSlots")
  );
  const inferredGroup = inferHeroDollSlotGroupFromSlots(explicitSlots, "");
  if (inferredGroup) {
    return inferredGroup;
  }

  const typeValue = String(foundry.utils.getProperty(item, "system.type.value") ?? "").trim().toLowerCase();
  if (item.type === "weapon") {
    return "hand";
  }

  if (item.type === "equipment") {
    if (typeValue === "ring") {
      return "ring";
    }

    if (["shield", "rod", "wand", "staff"].includes(typeValue)) {
      return "hand";
    }
  }

  if (item.type === "consumable" && typeValue === "ammo") {
    return "back";
  }

  return "";
}

function hasItemProperty(item, propertyKey) {
  if (!(item instanceof Item)) {
    return false;
  }

  const safePropertyKey = String(propertyKey ?? "").trim();
  if (!safePropertyKey) {
    return false;
  }

  const properties = foundry.utils.getProperty(item, "system.properties");
  const propertyValue = foundry.utils.getProperty(item, "system.properties.value");
  if (Array.isArray(propertyValue) && propertyValue.includes(safePropertyKey)) {
    return true;
  }

  if (propertyValue instanceof Set && propertyValue.has(safePropertyKey)) {
    return true;
  }

  if (Array.isArray(properties)) {
    return properties.includes(safePropertyKey);
  }

  if (properties instanceof Set) {
    return properties.has(safePropertyKey);
  }

  if (typeof properties?.has === "function") {
    return properties.has(safePropertyKey);
  }

  if (properties && typeof properties === "object") {
    if (Object.hasOwn(properties, safePropertyKey)) {
      return Boolean(properties[safePropertyKey]);
    }

    return Object.values(properties).some((value) => value === safePropertyKey);
  }

  return false;
}

function hasMagicalProperty(item) {
  return hasItemProperty(item, "mgc");
}

function isSheetWeaponPropertyChecked(root, item, propertyKey) {
  const safePropertyKey = String(propertyKey ?? "").trim();
  if (!safePropertyKey) {
    return false;
  }

  const checkbox = root.querySelector(`dnd5e-checkbox[name='system.properties.${safePropertyKey}'], input[name='system.properties.${safePropertyKey}']`);
  if (checkbox) {
    if (typeof checkbox.checked === "boolean") {
      return checkbox.checked;
    }
    return checkbox.hasAttribute("checked");
  }

  return hasItemProperty(item, safePropertyKey);
}

function ensureEquipmentTypeOptions(root, item) {
  if (!(item instanceof Item) || item.type !== "equipment") {
    return;
  }

  const typeSelect = root.querySelector("select[name='system.type.value']");
  if (!(typeSelect instanceof HTMLSelectElement)) {
    return;
  }

  const requiredOptions = [
    { value: "staff", label: "Посох" },
    { value: "wand", label: "Волшебная палочка" }
  ];

  for (const requiredOption of requiredOptions) {
    const existing = typeSelect.querySelector(`option[value='${requiredOption.value}']`);
    if (existing) {
      if (!String(existing.textContent ?? "").trim()) {
        existing.textContent = requiredOption.label;
      }
      continue;
    }

    const option = document.createElement("option");
    option.value = requiredOption.value;
    option.textContent = requiredOption.label;
    typeSelect.append(option);
  }
}

function upsertToolBaseItemOptions(root, app) {
  const item = getItemFromSheetApp(app);
  if (!(item instanceof Item) || item.type !== "tool") {
    return;
  }

  const typeSelect = root.querySelector("select[name='system.type.value']");
  const select = root.querySelector("select[name='system.type.baseItem']");
  if (!(select instanceof HTMLSelectElement)) {
    return;
  }
  if (typeSelect instanceof HTMLSelectElement && typeSelect.dataset.rebreyaToolTypeBound !== "true") {
    typeSelect.dataset.rebreyaToolTypeBound = "true";
    typeSelect.addEventListener("change", () => {
      window.setTimeout(() => {
        upsertToolBaseItemOptions(root, app);
      }, 0);
    });
  }

  // Keep dnd5e's dynamic base-item behavior for non-artisan tools (music, game, etc.).
  const toolTypeValue = String(
    typeSelect?.value
    ?? foundry.utils.getProperty(item, "system.type.value")
    ?? ""
  ).trim().toLowerCase();
  if (toolTypeValue !== "art") {
    select.classList.remove("rm-rebreya-tool-select");
    return;
  }

  const editable = isSheetEditable(app, root);
  const currentValue = String(
    item.getFlag(MODULE_ID, "rebreyaToolId")
    ?? foundry.utils.getProperty(item, "system.type.baseItem")
    ?? select.value
    ?? ""
  ).trim();
  const normalizedCurrentValue = normalizeRebreyaToolId(currentValue);

  select.disabled = !editable;
  select.classList.add("rm-rebreya-tool-select");

  const appendOption = (value, label, selected = false) => {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = label;
    option.selected = selected;
    select.append(option);
  };

  const currentOptionValues = Array.from(select.options).map((option) => String(option.value ?? ""));
  const isAlreadyRebreyaCatalog = currentOptionValues.length === REBREYA_TOOLS.length
    && REBREYA_TOOLS.every((tool, index) => currentOptionValues[index] === tool.id);

  if (!isAlreadyRebreyaCatalog) {
    select.innerHTML = "";
    for (const tool of REBREYA_TOOLS) {
      appendOption(tool.id, tool.label, tool.id === normalizedCurrentValue);
    }

    if (!normalizedCurrentValue && currentValue) {
      appendOption(currentValue, currentValue, true);
    }
  }

  if (normalizedCurrentValue) {
    select.value = normalizedCurrentValue;
  }
  else if (!select.value && REBREYA_TOOLS.length > 0) {
    select.value = REBREYA_TOOLS[0].id;
  }

  if (select.dataset.rebreyaToolBound !== "true") {
    select.dataset.rebreyaToolBound = "true";
    select.addEventListener("change", async (event) => {
      if (!isSheetEditable(app, root)) {
        return;
      }

      try {
        const activeToolType = String(
          typeSelect?.value
          ?? foundry.utils.getProperty(item, "system.type.value")
          ?? ""
        ).trim().toLowerCase();
        if (activeToolType !== "art") {
          return;
        }

        const selectedToolId = normalizeRebreyaToolId(event.currentTarget.value) || String(event.currentTarget.value ?? "").trim();
        const selectedToolLabel = REBREYA_TOOL_LABEL_BY_ID.get(selectedToolId) ?? selectedToolId;
        await item.update({
          "system.type.baseItem": selectedToolId || null,
          [`flags.${MODULE_ID}.rebreyaToolId`]: selectedToolId || null,
          [`flags.${MODULE_ID}.rebreyaToolLabel`]: selectedToolLabel || null
        });
      }
      catch (error) {
        console.error(`${MODULE_ID} | Failed to update Rebreya tool base item.`, error);
        ui.notifications?.error("Не удалось обновить базовый инструмент.");
      }
    });
  }
}

function upsertItemRankBadge(root, item) {
  const subtitles = root.querySelector(".sheet-header .subtitles");
  if (!subtitles) {
    return;
  }

  subtitles.querySelectorAll("[data-rebreya-rank-badge='true']").forEach((badge) => badge.remove());

  const rank = getItemRank(item);
  const badge = document.createElement("li");
  badge.dataset.rebreyaRankBadge = "true";
  badge.textContent = `Ранг ${rank}`;
  subtitles.append(badge);
}

function createFormGroup(labelText) {
  const group = document.createElement("div");
  group.classList.add("form-group");
  group.classList.add("rm-rebreya-item-field");

  const label = document.createElement("label");
  label.textContent = labelText;
  group.append(label);

  const fields = document.createElement("div");
  fields.classList.add("form-fields");
  group.append(fields);

  return { group, fields };
}

function getItemDetailsContainer(root) {
  return root.querySelector(".tab[data-tab='details']") ?? null;
}

function insertGroupIntoDetails(root, group, { key = "" } = {}) {
  const details = getItemDetailsContainer(root);
  if (!details) {
    return null;
  }

  if (key) {
    details.querySelectorAll(`[data-rebreya-item-field='${key}']`).forEach((node) => node.remove());
    group.dataset.rebreyaItemField = key;
  }

  const firstFieldset = details.querySelector("fieldset");
  if (firstFieldset) {
    firstFieldset.prepend(group);
  }
  else {
    details.prepend(group);
  }

  return group;
}

function upsertItemRankField(root, app) {
  const details = getItemDetailsContainer(root);
  if (!details) {
    return;
  }

  const item = getItemFromSheetApp(app);
  if (!item) {
    return;
  }

  const editable = isSheetEditable(app, root);
  const { group, fields } = createFormGroup("Ранг");
  const select = document.createElement("select");
  select.classList.add("unselect");
  select.disabled = !editable;
  for (let rank = ITEM_RANK_MIN; rank <= ITEM_RANK_MAX; rank += 1) {
    const option = document.createElement("option");
    option.value = String(rank);
    option.textContent = String(rank);
    option.selected = rank === getItemRank(item);
    select.append(option);
  }

  select.addEventListener("change", async (event) => {
    if (!editable) {
      return;
    }

    try {
      const nextRank = clampItemRank(event.currentTarget.value);
      await item.update({
        [`flags.${MODULE_ID}.rank`]: nextRank
      });
    }
    catch (error) {
      console.error(`${MODULE_ID} | Failed to update item rank.`, error);
      ui.notifications?.error("Не удалось обновить ранг предмета.");
    }
  });

  fields.append(select);
  insertGroupIntoDetails(root, group, { key: "rank" });
}

function upsertItemSlotField(root, app) {
  const details = getItemDetailsContainer(root);
  if (!details) {
    return;
  }

  const item = getItemFromSheetApp(app);
  if (!item) {
    return;
  }

  const editable = isSheetEditable(app, root);
  details.querySelectorAll("[data-rebreya-item-field='slot']").forEach((node) => node.remove());
  if (!ITEM_SLOT_ELIGIBLE_TYPES.has(item.type)) {
    return;
  }

  if (!hasMagicalProperty(item)) {
    return;
  }

  const slotGroups = getHeroDollSlotGroups();
  const currentGroup = getItemSlotGroup(item);
  const { group, fields } = createFormGroup("Слот");
  const select = document.createElement("select");
  select.classList.add("unselect");
  select.disabled = !editable;

  const emptyOption = document.createElement("option");
  emptyOption.value = "";
  emptyOption.textContent = "Не выбран";
  emptyOption.selected = currentGroup === "";
  select.append(emptyOption);

  for (const slotGroup of slotGroups) {
    const option = document.createElement("option");
    option.value = slotGroup.id;
    option.textContent = slotGroup.label;
    option.selected = slotGroup.id === currentGroup;
    select.append(option);
  }

  select.addEventListener("change", async (event) => {
    if (!editable) {
      return;
    }

    try {
      const nextGroup = normalizeHeroDollSlotGroup(event.currentTarget.value, "");
      const nextSlots = mapSlotGroupToHeroDollSlots(nextGroup, []);
      await item.update({
        [`flags.${MODULE_ID}.itemSlot`]: nextGroup || null,
        [`flags.${MODULE_ID}.heroDollSlots`]: nextSlots,
        [`flags.${MODULE_ID}.allowedHeroDollSlots`]: nextSlots
      });
    }
    catch (error) {
      console.error(`${MODULE_ID} | Failed to update item slot.`, error);
      ui.notifications?.error("Не удалось обновить слот предмета.");
    }
  });

  fields.append(select);
  insertGroupIntoDetails(root, group, { key: "slot" });
}

function upsertWeaponAttackTraitsField(root, app) {
  const details = getItemDetailsContainer(root);
  if (!details) {
    return;
  }

  details.querySelectorAll("[data-rebreya-item-field='attack-traits']").forEach((node) => node.remove());

  const item = getItemFromSheetApp(app);
  if (!(item instanceof Item) || item.type !== "weapon") {
    details.querySelectorAll("[data-rebreya-item-field='attack-traits-values']").forEach((node) => node.remove());
    return;
  }

  const currentValues = getLichWeaponPropertyValues(item);
  const editable = isSheetEditable(app, root);
  const { group, fields } = createFormGroup("Параметры свойств [L]");
  const valuesGrid = document.createElement("div");
  valuesGrid.classList.add("rm-weapon-lich-values-grid");
  const rows = [];

  for (const field of LICH_WEAPON_VALUE_FIELDS) {
    const row = document.createElement("div");
    row.classList.add("rm-weapon-lich-value-row");
    row.dataset.rebreyaLichPropertyKey = String(field.propertyKey ?? "");

    const label = document.createElement("label");
    label.textContent = field.label;
    row.append(label);

    const input = document.createElement("input");
    input.type = field.type === "number" ? "number" : "text";
    input.disabled = !editable;
    input.classList.add("untext");
    if (field.type === "number") {
      input.inputMode = "numeric";
      input.min = String(field.min ?? 0);
      input.step = String(field.step ?? 1);
    }
    if (field.placeholder) {
      input.placeholder = field.placeholder;
    }

    const currentValue = currentValues[field.key];
    input.value = currentValue === undefined || currentValue === null ? "" : String(currentValue);
    input.dataset.rebreyaLichValueKey = field.key;

    input.addEventListener("change", async (event) => {
      if (!editable) {
        return;
      }

      try {
        const nextValues = getLichWeaponPropertyValues(item);
        const rawValue = String(event.currentTarget.value ?? "").trim();

        if (!rawValue) {
          delete nextValues[field.key];
        }
        else {
          nextValues[field.key] = normalizeLichWeaponValue(field, rawValue);
        }

        const cleanedValues = Object.fromEntries(
          Object.entries(nextValues).filter(([, value]) => {
            if (value === null || value === undefined) {
              return false;
            }
            if (typeof value === "string") {
              return value.trim().length > 0;
            }
            return true;
          })
        );

        const attackTraits = {
          mku: normalizeNonNegativeInteger(cleanedValues.mku, 0),
          mu: normalizeNonNegativeInteger(cleanedValues.mu, 0),
          rku: normalizeNonNegativeInteger(cleanedValues.rku, 0)
        };
        const hasAnyAttackTrait = Object.values(attackTraits).some((value) => value > 0);

        await item.update({
          [`flags.${MODULE_ID}.lichWeaponPropertyValues`]: Object.keys(cleanedValues).length > 0 ? cleanedValues : null,
          [`flags.${MODULE_ID}.attackTraits`]: hasAnyAttackTrait ? attackTraits : null
        });
      }
      catch (error) {
        console.error(`${MODULE_ID} | Failed to update Lich weapon property values.`, error);
        ui.notifications?.error("Не удалось обновить параметры свойств [L].");
      }
    });

    row.append(input);
    valuesGrid.append(row);
    rows.push({ field, row });
  }

  fields.append(valuesGrid);
  insertGroupIntoDetails(root, group, { key: "attack-traits-values" });

  const syncVisibility = () => {
    let visibleRows = 0;
    for (const entry of rows) {
      const propertyKey = String(entry.field.propertyKey ?? "").trim();
      const shouldShow = propertyKey
        ? isSheetWeaponPropertyChecked(root, item, propertyKey)
        : true;
      entry.row.style.display = shouldShow ? "" : "none";
      if (shouldShow) {
        visibleRows += 1;
      }
    }

    group.style.display = visibleRows > 0 ? "" : "none";
  };

  const watchedPropertyKeys = new Set(
    rows
      .map((entry) => String(entry.field.propertyKey ?? "").trim())
      .filter(Boolean)
  );
  for (const propertyKey of watchedPropertyKeys) {
    const controls = root.querySelectorAll(
      `dnd5e-checkbox[name='system.properties.${propertyKey}'], input[name='system.properties.${propertyKey}']`
    );
    for (const control of controls) {
      control.addEventListener("change", () => {
        syncVisibility();
      });
      control.addEventListener("click", () => {
        window.setTimeout(() => syncVisibility(), 0);
      });
    }
  }

  syncVisibility();
}

function bindItemSheetEnhancements(root, app) {
  const item = getItemFromSheetApp(app);
  if (!item) {
    return;
  }

  ensureEquipmentTypeOptions(root, item);
  upsertToolBaseItemOptions(root, app);
  upsertItemRankBadge(root, item);
  upsertItemRankField(root, app);
  upsertItemSlotField(root, app);
  upsertWeaponAttackTraitsField(root, app);
}

export function extendDnd5eItemTypes() {
  if (!isDnd5eWorld() || !CONFIG.DND5E) {
    return;
  }

  if (!CONFIG.DND5E.weaponTypes || typeof CONFIG.DND5E.weaponTypes !== "object") {
    CONFIG.DND5E.weaponTypes = {};
  }
  const weaponTypes = CONFIG.DND5E.weaponTypes;
  weaponTypes.firearmPrimitive = weaponTypes.firearmPrimitive ?? "Примитивное огнестрельное";
  weaponTypes.firearmAdvanced = weaponTypes.firearmAdvanced ?? "Продвинутое огнестрельное";

  if (CONFIG.DND5E?.weaponProficienciesMap) {
    CONFIG.DND5E.weaponProficienciesMap.firearmPrimitive ??= "sim";
    CONFIG.DND5E.weaponProficienciesMap.firearmAdvanced ??= "mar";
  }

  if (CONFIG.DND5E?.weaponTypeMap) {
    CONFIG.DND5E.weaponTypeMap.firearmPrimitive ??= "ranged";
    CONFIG.DND5E.weaponTypeMap.firearmAdvanced ??= "ranged";
  }

  CONFIG.DND5E.itemProperties ??= {};
  for (const definition of LICH_WEAPON_PROPERTY_DEFINITIONS) {
    const existing = CONFIG.DND5E.itemProperties[definition.key];
    if (existing && typeof existing === "object") {
      existing.label = definition.label;
      existing.isPhysical ??= true;
      continue;
    }

    CONFIG.DND5E.itemProperties[definition.key] = {
      label: definition.label,
      isPhysical: true
    };
  }

  CONFIG.DND5E.validProperties ??= {};
  if (!(CONFIG.DND5E.validProperties.weapon instanceof Set)) {
    const source = CONFIG.DND5E.validProperties.weapon;
    CONFIG.DND5E.validProperties.weapon = new Set(Array.isArray(source) ? source : []);
  }
  for (const definition of LICH_WEAPON_PROPERTY_DEFINITIONS) {
    CONFIG.DND5E.validProperties.weapon.add(definition.key);
  }

  if (!CONFIG.DND5E.equipmentTypes || typeof CONFIG.DND5E.equipmentTypes !== "object") {
    CONFIG.DND5E.equipmentTypes = {};
  }
  const equipmentTypes = CONFIG.DND5E.equipmentTypes;
  equipmentTypes.staff = equipmentTypes.staff ?? "Посох";
  equipmentTypes.wand = equipmentTypes.wand ?? "Волшебная палочка";

  if (!CONFIG.DND5E.miscEquipmentTypes || typeof CONFIG.DND5E.miscEquipmentTypes !== "object") {
    CONFIG.DND5E.miscEquipmentTypes = {};
  }
  const miscEquipmentTypes = CONFIG.DND5E.miscEquipmentTypes;
  miscEquipmentTypes.staff = miscEquipmentTypes.staff ?? equipmentTypes.staff;
  miscEquipmentTypes.wand = miscEquipmentTypes.wand ?? equipmentTypes.wand;

  CONFIG.DND5E.armorProficienciesMap ??= {};
  CONFIG.DND5E.armorProficienciesMap.staff ??= true;
  CONFIG.DND5E.armorProficienciesMap.wand ??= true;

  const lootTypes = CONFIG.DND5E?.lootTypes ?? {};
  const gearType = lootTypes.gear ?? { label: "DND5E.Loot.Gear" };
  lootTypes.gear = {
    ...(typeof gearType === "object" ? gearType : { label: gearType }),
    subtypes: {
      ...(typeof gearType === "object" ? gearType.subtypes ?? {} : {}),
      attachment: "Обвес"
    }
  };
}

export function registerDnd5eSheetExtensions(moduleApi) {
  if (!isDnd5eWorld() || !CONFIG.DND5E) {
    return;
  }

  const CharacterActorSheet = getCharacterActorSheetClass();
  if (CharacterActorSheet) {
    ensureHeroDollTabDefinition(CharacterActorSheet);
    patchHeroDollPartContext(CharacterActorSheet, moduleApi);
  }
  patchActorMoveDropBehavior();
  patchDnd5eDragPayloadFallback();
  patchD20HeroicRollDialog();

  const onRenderActorSheet = (app, html) => {
    const actor = getActorFromSheetApp(app);
    if (!actor || actor.type !== "character") {
      return;
    }

    const root = getSheetRoot(html);
    if (!root) {
      return;
    }

    bindHeroDollPanel(root, app, moduleApi);
  };

  for (const hookName of [
    "renderActorSheet",
    "renderActorSheet5eCharacter2",
    "renderActorSheet5eCharacter",
    "renderCharacterActorSheet"
  ]) {
    Hooks.on(hookName, onRenderActorSheet);
  }

  const onRenderItemSheet = (app, html) => {
    const item = getItemFromSheetApp(app);
    if (!item) {
      return;
    }

    const root = getSheetRoot(html);
    if (!root) {
      return;
    }

    try {
      bindItemSheetEnhancements(root, app);
    }
    catch (error) {
      console.error(`${MODULE_ID} | Failed to bind item sheet enhancements.`, error);
    }
  };

  Hooks.on("renderItemSheet", onRenderItemSheet);
  Hooks.on("renderItemSheet5e", onRenderItemSheet);

  Hooks.on("renderApplicationV2", (app, element) => {
    const root = getSheetRoot(element);
    if (!root) {
      return;
    }

    const actor = getActorFromSheetApp(app);
    if (actor?.type === "character") {
      bindHeroDollPanel(root, app, moduleApi);
    }

    const item = getItemFromSheetApp(app);
    if (item) {
      try {
        bindItemSheetEnhancements(root, app);
      }
      catch (error) {
        console.error(`${MODULE_ID} | Failed to bind item sheet enhancements on ApplicationV2 render.`, error);
      }
    }
  });
}

