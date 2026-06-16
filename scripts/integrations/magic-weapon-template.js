import { MODULE_ID } from "../constants.js";
import { buildGearIconLookup, createDnd5eItemData } from "../data/gear-compendium.js";
import { classifyGearEntry } from "../data/item-classification.js";

let magicWeaponTemplateHookRegistered = false;
const pendingMagicWeaponTemplateItemKeys = new Set();
const MAGIC_WEAPON_TEMPLATE_DIALOG_CLASSES = ["rebreya-main", "rebreya-trader-dialog", "rm-magic-weapon-template-window"];

function cleanString(value, fallback = "") {
  const text = String(value ?? "").trim();
  return text || fallback;
}

function cleanId(value) {
  return cleanString(value);
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function clonePlainObject(value) {
  if (!isPlainObject(value)) {
    return {};
  }

  if (typeof globalThis.foundry?.utils?.deepClone === "function") {
    return globalThis.foundry.utils.deepClone(value);
  }

  return JSON.parse(JSON.stringify(value));
}

function escapeHtml(value) {
  if (typeof globalThis.foundry?.utils?.escapeHTML === "function") {
    return globalThis.foundry.utils.escapeHTML(String(value ?? ""));
  }

  return String(value ?? "")
    .replace(/&/gu, "&amp;")
    .replace(/</gu, "&lt;")
    .replace(/>/gu, "&gt;")
    .replace(/"/gu, "&quot;")
    .replace(/'/gu, "&#39;");
}

function normalizeMatchText(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/\u0451/gu, "\u0435")
    .replace(/['\u2019\u2018\u02BC\u02B9\u2032"\u201C\u201D\u00AB\u00BB]/gu, "")
    .replace(/\s+/gu, " ");
}

function isCurrentUserHook(userId) {
  const currentUserId = cleanId(globalThis.game?.user?.id);
  const hookUserId = cleanId(userId);
  return !hookUserId || !currentUserId || hookUserId === currentUserId;
}

function getOwnedActor(item) {
  return item?.parent ?? item?.actor ?? null;
}

function isCharacterOwnedItem(item) {
  return getOwnedActor(item)?.type === "character";
}

function canPromptForActor(actor) {
  return Boolean(globalThis.game?.user?.isGM || actor?.isOwner);
}

function shouldSkipMagicWeaponTemplate(options = {}) {
  return options?.[MODULE_ID]?.skipMagicWeaponTemplate === true
    || options?.skipMagicWeaponTemplate === true;
}

function getItemData(item) {
  if (typeof item?.toObject === "function") {
    return item.toObject();
  }

  return {
    name: item?.name,
    type: item?.type,
    system: clonePlainObject(item?.system),
    flags: clonePlainObject(item?.flags),
  };
}

function getModuleFlags(item) {
  const data = getItemData(item);
  return clonePlainObject(data.flags?.[MODULE_ID] ?? item?.flags?.[MODULE_ID]);
}

function normalizeArray(value) {
  if (!value) {
    return [];
  }

  if (Array.isArray(value)) {
    return value;
  }

  if (typeof value.values === "function") {
    return Array.from(value.values());
  }

  return [];
}

function uniqueCleanArray(values = []) {
  return Array.from(new Set(normalizeArray(values)
    .map((value) => cleanString(value))
    .filter(Boolean)));
}

function mergeProperties(...propertyLists) {
  return uniqueCleanArray(propertyLists.flatMap((properties) => normalizeArray(properties)));
}

function magicWeaponTemplateItemKey(item) {
  return cleanId(
    item?.uuid
    ?? item?.id
    ?? item?._id
    ?? item?.getFlag?.(MODULE_ID, "magicItemId")
    ?? item?.name
  );
}

function maybePreserveSystemField(target, source, field) {
  if (source?.[field] !== undefined) {
    target[field] = clonePlainObject(source[field]);
    if (!isPlainObject(source[field])) {
      target[field] = source[field];
    }
  }
}

function parseModuleSignature(item) {
  const signature = cleanString(getModuleFlags(item).signature);
  if (!signature) {
    return null;
  }

  try {
    const parsed = JSON.parse(signature);
    return isPlainObject(parsed) ? parsed : null;
  }
  catch (_error) {
    return null;
  }
}

function htmlToPlainText(value = "") {
  return String(value ?? "")
    .replace(/<br\s*\/?>/giu, "\n")
    .replace(/<\/p>/giu, "\n\n")
    .replace(/<\/li>/giu, "\n")
    .replace(/<[^>]+>/gu, " ")
    .replace(/\u00A0/gu, " ")
    .replace(/[ \t]+\n/gu, "\n")
    .replace(/\n[ \t]+/gu, "\n")
    .replace(/[ \t]{2,}/gu, " ")
    .replace(/\n{3,}/gu, "\n\n")
    .trim();
}

function renderDescriptionParagraphs(value = "") {
  const text = cleanString(value);
  if (!text) {
    return "";
  }

  return text
    .split(/\n{2,}/u)
    .map((paragraph) => cleanString(paragraph))
    .filter(Boolean)
    .map((paragraph) => `<p>${escapeHtml(paragraph).replace(/\n/gu, "<br>")}</p>`)
    .join("");
}

function readMagicWeaponRulesText(item) {
  const signatureDescription = cleanString(parseModuleSignature(item)?.description);
  if (signatureDescription) {
    return signatureDescription;
  }

  const currentHtml = cleanString(getItemData(item)?.system?.description?.value);
  if (!currentHtml) {
    return "";
  }

  const withoutMetadataLists = currentHtml.replace(/<ul[\s\S]*?<\/ul>/giu, " ");
  return htmlToPlainText(withoutMetadataLists);
}

function buildMagicWeaponDescription(baseDescription = "", magicRulesText = "", bonus = 0) {
  const baseHtml = cleanString(baseDescription);
  const currentHtml = renderDescriptionParagraphs(magicRulesText);
  const note = `<p><strong>Магическое оружие +${bonus}.</strong> Бонус применяется через поле dnd5e magicalBonus.</p>`;

  if (!currentHtml || currentHtml === baseHtml) {
    return [baseHtml, note].filter(Boolean).join("<hr>");
  }

  return [baseHtml, currentHtml, note].filter(Boolean).join("<hr>");
}

function normalizeModelGear(model) {
  if (Array.isArray(model?.gear)) {
    return model.gear;
  }

  if (model?.gear instanceof Map) {
    return Array.from(model.gear.values());
  }

  if (model?.gearById instanceof Map) {
    return Array.from(model.gearById.values());
  }

  return [];
}

function buildMagicWeaponTemplateSelectContent({ item, bonus, weapons }) {
  const itemName = escapeHtml(item?.name || `Оружие +${bonus}`);
  const options = weapons
    .map((weapon) => `<option value="${escapeHtml(weapon.id)}">${escapeHtml(weapon.name)}</option>`)
    .join("");

  return `
    <form class="rm-magic-weapon-template-form">
      <p>Выберите базовый шаблон оружия Rebreya для <strong>${itemName}</strong>.</p>
      <div class="form-group">
        <label>Оружие</label>
        <select name="gearId">${options}</select>
      </div>
    </form>
  `;
}

export function parseMagicWeaponBonus(itemOrName) {
  const item = typeof itemOrName === "string" ? null : itemOrName;
  const name = cleanString(typeof itemOrName === "string" ? itemOrName : item?.name);
  const exactMatch = name.match(/^(?:Оружие|Weapon)\s*\+\s*([123])$/iu);
  if (exactMatch) {
    return Number(exactMatch[1]);
  }

  const flags = item ? getModuleFlags(item) : {};
  const isGenericMagicWeapon = normalizeMatchText(flags.sourceType) === "magicitem"
    && normalizeMatchText(flags.itemType) === normalizeMatchText("Оружие")
    && normalizeMatchText(flags.itemSubtype) === normalizeMatchText("Любое");
  if (!isGenericMagicWeapon) {
    return null;
  }

  const plusMatch = name.match(/\+\s*([123])(?:\b|$)/u);
  if (plusMatch) {
    return Number(plusMatch[1]);
  }

  const magicItemId = cleanString(flags.magicItemId);
  const idMatch = magicItemId.match(/(?:^|[-_])([123])$/u);
  return idMatch ? Number(idMatch[1]) : null;
}

export function buildMagicWeaponTemplateOptions(model) {
  const collator = new Intl.Collator("ru", {
    numeric: true,
    sensitivity: "base",
  });

  return normalizeModelGear(model)
    .map((item) => {
      const id = cleanId(item?.id);
      const name = cleanString(item?.name);
      if (!id || !name) {
        return null;
      }

      const classification = classifyGearEntry(item);
      const isFirearm = Boolean(classification.firearmClass)
        || normalizeMatchText(item?.equipmentType) === normalizeMatchText("Огнестрельное оружие");
      if (classification.documentType !== "weapon" || isFirearm) {
        return null;
      }

      return {
        id,
        name,
        item,
        sourceCategory: classification.sourceCategory ?? "",
        baseItem: classification.baseItem ?? "",
        weaponType: classification.systemTypeValue ?? "",
      };
    })
    .filter(Boolean)
    .sort((left, right) => collator.compare(left.name, right.name));
}

function getPromptableMagicWeaponContext(
  item,
  options = {},
  userId = "",
  { requireCurrentUser = true } = {},
) {
  if ((requireCurrentUser && !isCurrentUserHook(userId)) || shouldSkipMagicWeaponTemplate(options) || !isCharacterOwnedItem(item)) {
    return null;
  }

  const actor = getOwnedActor(item);
  if (item?.type !== "weapon" || item?.getFlag?.(MODULE_ID, "magicWeaponTemplate") === true) {
    return null;
  }

  const bonus = parseMagicWeaponBonus(item);
  if (!bonus) {
    return null;
  }

  return { actor, bonus };
}

export function createMagicWeaponTemplateUpdate(item, weaponTemplate, bonus, { iconLookup = null } = {}) {
  const itemData = getItemData(item);
  const currentSystem = clonePlainObject(itemData.system);
  const baseItemData = createDnd5eItemData(weaponTemplate, new Map(), iconLookup);
  const baseSystem = clonePlainObject(baseItemData.system);
  const currentModuleFlags = getModuleFlags(item);
  const baseModuleFlags = clonePlainObject(baseItemData.flags?.[MODULE_ID]);
  const magicItemId = cleanString(currentModuleFlags.magicItemId, `weapon-plus-${bonus}`);

  const properties = mergeProperties(baseSystem.properties, currentSystem.properties, ["mgc"]);
  baseSystem.properties = properties;
  baseSystem.magicalBonus = Number(bonus);

  maybePreserveSystemField(baseSystem, currentSystem, "quantity");
  maybePreserveSystemField(baseSystem, currentSystem, "price");
  maybePreserveSystemField(baseSystem, currentSystem, "rarity");
  maybePreserveSystemField(baseSystem, currentSystem, "attunement");
  maybePreserveSystemField(baseSystem, currentSystem, "attuned");
  maybePreserveSystemField(baseSystem, currentSystem, "identified");
  maybePreserveSystemField(baseSystem, currentSystem, "container");
  maybePreserveSystemField(baseSystem, currentSystem, "equipped");

  baseSystem.description ??= {};
  baseSystem.description.value = buildMagicWeaponDescription(
    baseSystem.description.value,
    readMagicWeaponRulesText(item),
    bonus,
  );

  return {
    name: `${weaponTemplate.name} +${bonus}`,
    img: baseItemData.img,
    system: baseSystem,
    flags: {
      [MODULE_ID]: {
        ...baseModuleFlags,
        ...currentModuleFlags,
        sourceType: "magicItem",
        magicItemId,
        gearId: cleanId(weaponTemplate.id),
        magicWeaponTemplate: true,
        magicWeaponBonus: Number(bonus),
        magicWeaponGearId: cleanId(weaponTemplate.id),
        magical: true,
        foundryType: "weapon",
        foundrySubtype: baseModuleFlags.foundrySubtype ?? "",
        foundryBaseItem: baseModuleFlags.foundryBaseItem ?? "",
      },
    },
  };
}

async function processMagicWeaponTemplateItem(
  item,
  bonus,
  moduleApi = globalThis.game?.rebreyaMain,
  { prompt = promptMagicWeaponTemplate } = {},
) {
  const itemKey = magicWeaponTemplateItemKey(item);
  if (!itemKey || pendingMagicWeaponTemplateItemKeys.has(itemKey)) {
    return false;
  }

  pendingMagicWeaponTemplateItemKeys.add(itemKey);
  try {
    const model = typeof moduleApi?.getModel === "function"
      ? await moduleApi.getModel()
      : moduleApi?.repository?.model;
    const weapons = buildMagicWeaponTemplateOptions(model);
    if (!weapons.length) {
      globalThis.ui?.notifications?.warn?.("В данных Rebreya не найдено базовых шаблонов оружия.");
      return false;
    }

    const selectedId = cleanId(await prompt({ item, bonus, weapons }));
    if (!selectedId) {
      return false;
    }

    const selectedWeapon = weapons.find((weapon) => weapon.id === selectedId);
    if (!selectedWeapon) {
      globalThis.ui?.notifications?.warn?.("Выбранный шаблон оружия Rebreya не найден.");
      return false;
    }

    const iconLookup = await buildGearIconLookup();
    const updateData = createMagicWeaponTemplateUpdate(item, selectedWeapon.item, bonus, { iconLookup });
    await item.update(updateData, {
      [MODULE_ID]: {
        skipMagicWeaponTemplate: true,
      },
      skipMagicWeaponTemplate: true,
    });

    globalThis.ui?.notifications?.info?.(`Оружие +${bonus} превращено в «${selectedWeapon.name} +${bonus}».`);
    return true;
  }
  finally {
    pendingMagicWeaponTemplateItemKeys.delete(itemKey);
  }
}

export async function promptMagicWeaponTemplate({ item, bonus, weapons }) {
  if (!weapons.length) {
    globalThis.ui?.notifications?.warn?.("В данных Rebreya не найдено базовых шаблонов оружия.");
    return null;
  }

  if (typeof globalThis.Dialog !== "function") {
    return weapons[0].id;
  }

  return new Promise((resolve) => {
    let settled = false;
    const done = (value) => {
      if (settled) {
        return;
      }
      settled = true;
      resolve(value);
    };

    const dialog = new globalThis.Dialog({
      title: `Оружие +${bonus}`,
      content: buildMagicWeaponTemplateSelectContent({ item, bonus, weapons }),
      classes: MAGIC_WEAPON_TEMPLATE_DIALOG_CLASSES,
      buttons: {
        apply: {
          icon: '<i class="fa-solid fa-wand-magic-sparkles"></i>',
          label: "Выбрать",
          callback: (html) => {
            const root = html?.[0] ?? html;
            const selectedId = cleanId(root?.querySelector?.("[name='gearId']")?.value);
            done(selectedId || weapons[0].id);
          },
        },
        cancel: {
          label: "Отмена",
          callback: () => done(null),
        },
      },
      default: "apply",
      close: () => done(null),
    });

    dialog.render(true);
  });
}

export async function handleCreatedMagicWeaponItem(
  item,
  options = {},
  userId = "",
  moduleApi = globalThis.game?.rebreyaMain,
  { prompt = promptMagicWeaponTemplate } = {},
) {
  const promptable = getPromptableMagicWeaponContext(item, options, userId, {
    requireCurrentUser: true,
  });
  if (!promptable) {
    return false;
  }

  return processMagicWeaponTemplateItem(item, promptable.bonus, moduleApi, { prompt });
}

export async function handleActorRenderMagicWeapons(
  actor,
  moduleApi = globalThis.game?.rebreyaMain,
  { prompt = promptMagicWeaponTemplate } = {},
) {
  if (actor?.type !== "character" || !canPromptForActor(actor)) {
    return false;
  }

  for (const item of normalizeArray(actor.items)) {
    const promptable = getPromptableMagicWeaponContext(item, {}, "", {
      requireCurrentUser: false,
    });
    if (!promptable) {
      continue;
    }

    return processMagicWeaponTemplateItem(item, promptable.bonus, moduleApi, { prompt });
  }

  return false;
}

export function registerMagicWeaponTemplateHook(moduleApi, { Hooks = globalThis.Hooks } = {}) {
  if (magicWeaponTemplateHookRegistered || typeof Hooks?.on !== "function") {
    return false;
  }

  magicWeaponTemplateHookRegistered = true;
  Hooks.on("createItem", (item, options, userId) => {
    handleCreatedMagicWeaponItem(item, options, userId, moduleApi).catch((error) => {
      console.error(`${MODULE_ID} | Failed to apply magic weapon template.`, error);
      globalThis.ui?.notifications?.error?.(error.message || "Не удалось применить шаблон магического оружия.");
    });
  });

  const repairActorSheetMagicWeapons = (app) => {
    const actor = app?.actor ?? app?.document ?? null;
    handleActorRenderMagicWeapons(actor, moduleApi).catch((error) => {
      console.error(`${MODULE_ID} | Failed to process rendered magic weapon template.`, error);
      globalThis.ui?.notifications?.error?.(error.message || "Не удалось обработать магическое оружие на листе персонажа.");
    });
  };

  for (const hookName of [
    "renderActorSheet",
    "renderActorSheet5eCharacter2",
    "renderActorSheet5eCharacter",
    "renderCharacterActorSheet",
  ]) {
    Hooks.on(hookName, repairActorSheetMagicWeapons);
  }
  return true;
}
