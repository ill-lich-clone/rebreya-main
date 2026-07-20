import { MODULE_ID } from "../constants.js";
import { buildGearIconLookup, createDnd5eItemData } from "../data/gear-compendium.js";
import { classifyGearEntry } from "../data/item-classification.js";

let magicWeaponTemplateHookRegistered = false;
const pendingMagicWeaponTemplateItemKeys = new Set();
const MAGIC_WEAPON_TEMPLATE_DIALOG_CLASSES = ["rebreya-main", "rebreya-trader-dialog", "rm-magic-weapon-template-window"];

const MAGIC_ARMOR_TEMPLATE_NAMES = [
  "Стёганый доспех",
  "Кожаный доспех",
  "Проклёпанный кожаный доспех",
  "Боевая броня шеф-повара",
  "Шкурный доспех",
  "Кольчужная рубаха",
  "Чешуйчатый доспех",
  "Кираса",
  "Полулаты",
  "Импровизированный доспех",
  "Колечный доспех",
  "Кольчуга",
  "Наборный доспех",
  "Латы",
  "Панцирь тортла",
];

const MAGIC_SHIELD_TEMPLATE_NAMES = [
  "Щит",
  "Баклер",
  "Башенный щит",
];

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

const NORMALIZED_MAGIC_ARMOR_TEMPLATE_NAMES = new Set(MAGIC_ARMOR_TEMPLATE_NAMES.map((name) => normalizeMatchText(name)));
const NORMALIZED_MAGIC_SHIELD_TEMPLATE_NAMES = new Set(MAGIC_SHIELD_TEMPLATE_NAMES.map((name) => normalizeMatchText(name)));

function buildTemplateRule(subtypes, config = {}) {
  return {
    subtypes: new Set(subtypes.map((subtype) => normalizeMatchText(subtype))),
    names: config.names ? new Set(config.names.map((name) => normalizeMatchText(name))) : null,
    armorTypes: config.armorTypes ? new Set(config.armorTypes.map((type) => normalizeMatchText(type))) : null,
    ammoSubtypes: config.ammoSubtypes ? new Set(config.ammoSubtypes.map((subtype) => normalizeMatchText(subtype))) : null,
    itemKind: config.itemKind ?? "",
  };
}

const MAGIC_WEAPON_TEMPLATE_RULES = [
  buildTemplateRule(["Любое", "любое", "Любой", "Any"]),
  buildTemplateRule(["Арбалет"], {
    names: ["Арбалет, лёгкий", "Арбалет, легкий", "Лёгкий арбалет", "Легкий арбалет", "Арбалет, ручной", "Ручной арбалет", "Арбалет, тяжёлый", "Арбалет, тяжелый", "Тяжёлый арбалет", "Тяжелый арбалет", "Многозарядный арбалет"],
  }),
  buildTemplateRule(["Боевая кирка"], { names: ["Боевая кирка"] }),
  buildTemplateRule(["Боевой посох"], { names: ["Боевой посох"] }),
  buildTemplateRule(["Боевой топор"], { names: ["Боевой топор"] }),
  buildTemplateRule(["Булава"], { names: ["Булава"] }),
  buildTemplateRule(["Длинный лук"], { names: ["Длинный лук"] }),
  buildTemplateRule(["Кинжал"], { names: ["Кинжал"] }),
  buildTemplateRule(["Кнут"], { names: ["Кнут"] }),
  buildTemplateRule(["Копьё", "Копье"], { names: ["Копьё", "Копье", "Кавалерийская пика", "Пика"] }),
  buildTemplateRule(["Лук"], { names: ["Длинный лук", "Короткий лук", "Лук всадника", "Композитный лук"] }),
  buildTemplateRule(["Меч"], {
    names: ["Длинный меч", "Короткий меч", "Двуручный меч", "Скимитар", "Рапира", "Палаш", "Сабля", "Катана", "Эсток", "Меч палача", "Шамшир"],
  }),
  buildTemplateRule(["Молот", "Молоты"], {
    names: ["Боевой молот", "Лёгкий молот", "Легкий молот", "Молот", "Молот всадника", "Двусторонний молот"],
  }),
  buildTemplateRule(["Моргенштерн"], { names: ["Моргенштерн"] }),
  buildTemplateRule(["Праща"], { names: ["Праща"] }),
  buildTemplateRule(["Ручной топор"], { names: ["Ручной топор"] }),
  buildTemplateRule(["Секира"], { names: ["Секира"] }),
  buildTemplateRule(["Серп"], { names: ["Серп"] }),
  buildTemplateRule(["Скимитар"], { names: ["Скимитар"] }),
  buildTemplateRule(["Топор"], { names: ["Боевой топор", "Ручной топор", "Секира", "Двусторонний топор", "Костяной топор"] }),
  buildTemplateRule(["Трезубец"], { names: ["Трезубец"] }),
  buildTemplateRule(["Цеп"], { names: ["Цеп", "Цепь"] }),
];

const MAGIC_ARMOR_TEMPLATE_RULES = [
  buildTemplateRule(["Любой", "Любая", "Any"], { itemKind: "armor" }),
  buildTemplateRule(["Лёгкий", "Легкий"], { itemKind: "armor", armorTypes: ["light"] }),
  buildTemplateRule(["Средний, Тяжёлый", "Средний, Тяжелый"], { itemKind: "armor", armorTypes: ["medium", "heavy"] }),
  buildTemplateRule(["Тяжёлый", "Тяжелый"], { itemKind: "armor", armorTypes: ["heavy"] }),
  buildTemplateRule(["Кираса"], { itemKind: "armor", names: ["Кираса"] }),
  buildTemplateRule(["Кольчуга"], { itemKind: "armor", names: ["Кольчуга"] }),
  buildTemplateRule(["Латы"], { itemKind: "armor", names: ["Латы"] }),
  buildTemplateRule(["Проклёпанный кожаный доспех", "Проклепанный кожаный доспех"], {
    itemKind: "armor",
    names: ["Проклёпанный кожаный доспех", "Проклепанный кожаный доспех"],
  }),
  buildTemplateRule(["Щит"], { itemKind: "shield" }),
  buildTemplateRule(["Баклер"], { itemKind: "shield", names: ["Баклер"] }),
];

const MAGIC_AMMUNITION_TEMPLATE_RULES = [
  buildTemplateRule(["Боеприпас", "Любой боеприпас"], { ammoSubtypes: ["arrow", "crossbowBolt", "blowgunNeedle", "slingBullet", "firearmBullet", ""] }),
  buildTemplateRule(["Стрела"], { ammoSubtypes: ["arrow"] }),
];

const MAGIC_AMMUNITION_ITEM_RULES_BY_NAME = new Map([
  [normalizeMatchText("Снаряды Альтемоны для пращи"), buildTemplateRule(["Боеприпас"], { ammoSubtypes: ["slingBullet"] })],
]);

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

function normalizeUsers(users) {
  if (!users) {
    return [];
  }

  if (Array.isArray(users)) {
    return users;
  }

  if (Array.isArray(users.contents)) {
    return users.contents;
  }

  if (typeof users.values === "function") {
    return Array.from(users.values());
  }

  return [];
}

function actorOwnerLevel() {
  return Number(globalThis.CONST?.DOCUMENT_OWNERSHIP_LEVELS?.OWNER ?? 3);
}

function userOwnsActor(actor, user) {
  if (!actor || !user?.id) {
    return false;
  }

  if (typeof actor.testUserPermission === "function") {
    return actor.testUserPermission(user, "OWNER") === true;
  }

  const ownership = actor.ownership ?? actor._source?.ownership ?? {};
  return Number(ownership[user.id] ?? ownership.default ?? 0) >= actorOwnerLevel();
}

function hasActivePlayerOwner(actor) {
  return normalizeUsers(globalThis.game?.users)
    .some((user) => user?.isGM !== true && user?.active !== false && userOwnsActor(actor, user));
}

function canPromptForActor(actor) {
  const currentUser = globalThis.game?.user;
  if (!currentUser) {
    return actor?.isOwner === true;
  }

  if (currentUser.isGM === true) {
    return !hasActivePlayerOwner(actor);
  }

  return actor?.isOwner === true || userOwnsActor(actor, currentUser);
}

function shouldSkipMagicTemplate(options = {}, skipKeys = []) {
  return skipKeys.some((key) =>
    options?.[MODULE_ID]?.[key] === true
    || options?.[key] === true
  );
}

function shouldSkipMagicWeaponTemplate(options = {}) {
  return shouldSkipMagicTemplate(options, ["skipMagicWeaponTemplate", "skipMagicEquipmentTemplate"]);
}

function shouldSkipMagicArmorTemplate(options = {}) {
  return shouldSkipMagicTemplate(options, [
    "skipMagicArmorTemplate",
    "skipMagicShieldTemplate",
    "skipMagicEquipmentTemplate",
  ]);
}

function shouldSkipMagicAmmunitionTemplate(options = {}) {
  return shouldSkipMagicTemplate(options, ["skipMagicAmmunitionTemplate", "skipMagicEquipmentTemplate"]);
}

function shouldSkipMagicToolTemplate(options = {}) {
  return shouldSkipMagicTemplate(options, ["skipMagicToolTemplate", "skipMagicEquipmentTemplate"]);
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

function applyCommonPreservedFields(baseSystem, currentSystem) {
  maybePreserveSystemField(baseSystem, currentSystem, "quantity");
  maybePreserveSystemField(baseSystem, currentSystem, "price");
  maybePreserveSystemField(baseSystem, currentSystem, "rarity");
  maybePreserveSystemField(baseSystem, currentSystem, "attunement");
  maybePreserveSystemField(baseSystem, currentSystem, "attuned");
  maybePreserveSystemField(baseSystem, currentSystem, "identified");
  maybePreserveSystemField(baseSystem, currentSystem, "container");
  maybePreserveSystemField(baseSystem, currentSystem, "equipped");
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

function readMagicItemRulesText(item) {
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

function buildMagicTemplateDescription(baseDescription = "", magicRulesText = "", noteHtml = "") {
  const baseHtml = cleanString(baseDescription);
  const currentHtml = renderDescriptionParagraphs(magicRulesText);

  if (!currentHtml || currentHtml === baseHtml) {
    return [baseHtml, noteHtml].filter(Boolean).join("<hr>");
  }

  return [baseHtml, currentHtml, noteHtml].filter(Boolean).join("<hr>");
}

function buildMagicWeaponDescription(baseDescription = "", magicRulesText = "", bonus = 0) {
  const resolvedBonus = normalizeMagicTemplateBonus(bonus);
  return buildMagicTemplateDescription(
    baseDescription,
    magicRulesText,
    resolvedBonus
      ? `<p><strong>Магическое оружие +${resolvedBonus}.</strong> Бонус применяется через поле dnd5e magicalBonus.</p>`
      : "<p><strong>Магическое оружие.</strong> Базовый шаблон Rebreya применён к магическому предмету.</p>",
  );
}

function buildMagicArmorDescription(baseDescription = "", magicRulesText = "", bonus = 0, itemLabel = "доспех") {
  const magicItemLabel = itemLabel === "щит" ? "Магический щит" : "Магический доспех";
  const resolvedBonus = normalizeMagicTemplateBonus(bonus);
  return buildMagicTemplateDescription(
    baseDescription,
    magicRulesText,
    resolvedBonus
      ? `<p><strong>${magicItemLabel} +${resolvedBonus}.</strong> Бонус применяется через поле dnd5e armor.magicalBonus.</p>`
      : `<p><strong>${magicItemLabel}.</strong> Базовый шаблон Rebreya применён к магическому предмету.</p>`,
  );
}

function buildMagicToolDescription(baseDescription = "", magicRulesText = "", bonus = 0) {
  const resolvedBonus = normalizeMagicTemplateBonus(bonus);
  return buildMagicTemplateDescription(
    baseDescription,
    magicRulesText,
    resolvedBonus
      ? `<p><strong>Магический инструмент +${resolvedBonus}.</strong> Бонус применяется через поле dnd5e tool.bonus.</p>`
      : "<p><strong>Магический инструмент.</strong> Базовый шаблон Rebreya применён к магическому предмету.</p>",
  );
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

function buildMagicItemTemplateSelectContent({ item, bonus, itemLabel, options }) {
  const itemName = escapeHtml(item?.name || `${itemLabel} +${bonus}`);
  const optionsHtml = options
    .map((entry) => `<option value="${escapeHtml(entry.id)}">${escapeHtml(entry.name)}</option>`)
    .join("");

  return `
    <form class="rm-magic-weapon-template-form">
      <p>Выберите базовый шаблон ${escapeHtml(itemLabel.toLowerCase())} Rebreya для <strong>${itemName}</strong>.</p>
      <div class="form-group">
        <label>${escapeHtml(itemLabel)}</label>
        <select name="gearId">${optionsHtml}</select>
      </div>
    </form>
  `;
}

async function promptMagicItemTemplate({ item, bonus, itemLabel, options, emptyMessage }) {
  if (!options.length) {
    globalThis.ui?.notifications?.warn?.(emptyMessage);
    return null;
  }

  if (typeof globalThis.Dialog !== "function") {
    return options[0].id;
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

    const resolvedBonus = normalizeMagicTemplateBonus(bonus);
    const dialog = new globalThis.Dialog({
      title: resolvedBonus ? `${itemLabel} +${resolvedBonus}` : itemLabel,
      content: buildMagicItemTemplateSelectContent({ item, bonus, itemLabel, options }),
      classes: MAGIC_WEAPON_TEMPLATE_DIALOG_CLASSES,
      buttons: {
        apply: {
          icon: '<i class="fa-solid fa-wand-magic-sparkles"></i>',
          label: "Выбрать",
          callback: (html) => {
            const root = html?.[0] ?? html;
            const selectedId = cleanId(root?.querySelector?.("[name='gearId']")?.value);
            done(selectedId || options[0].id);
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

function parseGenericMagicItemBonus(item, expectedItemType, expectedSubtypes = []) {
  const flags = item ? getModuleFlags(item) : {};
  const isGenericMagicItem = normalizeMatchText(flags.sourceType) === "magicitem"
    && normalizeMatchText(flags.itemType) === normalizeMatchText(expectedItemType)
    && expectedSubtypes.some((subtype) => normalizeMatchText(flags.itemSubtype) === normalizeMatchText(subtype));
  if (!isGenericMagicItem) {
    return null;
  }

  const name = cleanString(item?.name);
  const plusMatch = name.match(/\+\s*([123])(?:\b|$)/u);
  if (plusMatch) {
    return Number(plusMatch[1]);
  }

  const magicItemId = cleanString(flags.magicItemId);
  const idMatch = magicItemId.match(/(?:^|[-_])([123])$/u);
  return idMatch ? Number(idMatch[1]) : null;
}

function getMagicItemTemplateSource(item) {
  const flags = getModuleFlags(item);
  const signature = parseModuleSignature(item) ?? {};
  return {
    name: cleanString(signature.name ?? item?.name),
    sourceType: cleanString(flags.sourceType ?? signature.sourceType),
    itemType: cleanString(flags.itemType ?? signature.itemType),
    itemSubtype: cleanString(flags.itemSubtype ?? signature.itemSubtype),
    magicItemId: cleanString(flags.magicItemId ?? signature.id),
  };
}

function isMagicItemSource(source) {
  return normalizeMatchText(source?.sourceType) === "magicitem";
}

function isArmorItemType(source) {
  const itemType = normalizeMatchText(source?.itemType);
  return itemType === normalizeMatchText("Доспех") || itemType === normalizeMatchText("Доспехи");
}

function isWeaponItemType(source) {
  const itemType = normalizeMatchText(source?.itemType);
  return itemType === normalizeMatchText("Оружие") || itemType === normalizeMatchText("Посох");
}

function isToolItemType(source) {
  const itemType = normalizeMatchText(source?.itemType);
  return [
    "Инструменты",
    "Инструмент",
    "Чудесный предмет",
    "Чудестный предмет",
    "Tool",
    "Tools",
    "Wondrous item",
  ].some((type) => itemType === normalizeMatchText(type));
}

function isUniversalMagicToolSource(source) {
  if (!isMagicItemSource(source) || !isToolItemType(source)) {
    return false;
  }

  const name = normalizeMatchText(source?.name);
  return /^(?:универсальный\s+)?инструмент(?:ы)?\s*\+\s*[123]$/iu.test(name)
    || /^tool(?:s)?\s*\+\s*[123]$/iu.test(name);
}

function findTemplateRule(rules, subtype) {
  const normalizedSubtype = normalizeMatchText(subtype);
  if (!normalizedSubtype) {
    return null;
  }

  return rules.find((rule) => rule.subtypes.has(normalizedSubtype)) ?? null;
}

function findWeaponTemplateRule(source) {
  if (!isMagicItemSource(source) || !isWeaponItemType(source)) {
    return null;
  }

  return findTemplateRule(MAGIC_WEAPON_TEMPLATE_RULES, source.itemSubtype);
}

function findArmorTemplateRule(source) {
  if (!isMagicItemSource(source) || !isArmorItemType(source)) {
    return null;
  }

  return findTemplateRule(MAGIC_ARMOR_TEMPLATE_RULES, source.itemSubtype);
}

function findAmmunitionTemplateRule(source) {
  if (!isMagicItemSource(source) || normalizeMatchText(source?.itemType) !== normalizeMatchText("Оружие")) {
    return null;
  }

  return MAGIC_AMMUNITION_ITEM_RULES_BY_NAME.get(normalizeMatchText(source.name))
    ?? findTemplateRule(MAGIC_AMMUNITION_TEMPLATE_RULES, source.itemSubtype);
}

function templateOptionMatchesRule(option, rule) {
  if (!rule) {
    return true;
  }

  if (rule.names && !rule.names.has(normalizeMatchText(option?.name))) {
    return false;
  }

  if (rule.armorTypes && !rule.armorTypes.has(normalizeMatchText(option?.armorType))) {
    return false;
  }

  if (rule.ammoSubtypes && !rule.ammoSubtypes.has(normalizeMatchText(option?.ammoSubtype))) {
    return false;
  }

  return true;
}

function filterTemplateOptions(options, rule) {
  return normalizeArray(options).filter((option) => templateOptionMatchesRule(option, rule));
}

function normalizeMagicTemplateBonus(value) {
  const numeric = Number(value);
  return Number.isInteger(numeric) && numeric >= 1 && numeric <= 3 ? numeric : null;
}

function parseBonusFromRulesText(item, kind) {
  const text = `${cleanString(item?.name)}\n${readMagicItemRulesText(item)}`;
  const normalizedKind = cleanString(kind);
  const patterns = normalizedKind === "armor" || normalizedKind === "shield"
    ? [
      /бонус\s*\+([123])\s*к\s*КД/iu,
      /\+\s*([123])\s*к\s*КД/iu,
    ]
    : [
      /бонус\s*\+([123])\s*к\s*броскам\s+атаки\s+и\s+урона/iu,
      /бонус\s*\+([123])\s*к\s*броскам\s+атаки\s+и\s+урон/iu,
    ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    const bonus = normalizeMagicTemplateBonus(match?.[1]);
    if (bonus) {
      return bonus;
    }
  }

  return null;
}

function parseNamedMagicEquipmentBonus(item, kind) {
  const nameMatch = cleanString(item?.name).match(/\+\s*([123])(?:\b|$)/u);
  const nameBonus = normalizeMagicTemplateBonus(nameMatch?.[1]);
  return nameBonus ?? parseBonusFromRulesText(item, kind);
}

function formatMagicTemplateName(itemName, templateName, bonus, { preserveMagicItemName = false } = {}) {
  const safeTemplateName = cleanString(templateName);
  const safeItemName = cleanString(itemName);
  const resolvedBonus = normalizeMagicTemplateBonus(bonus);

  if (preserveMagicItemName && safeItemName && safeTemplateName && normalizeMatchText(safeItemName) !== normalizeMatchText(safeTemplateName)) {
    return `${safeItemName} (${safeTemplateName})`;
  }

  if (resolvedBonus) {
    return `${safeTemplateName || safeItemName} +${resolvedBonus}`;
  }

  return safeTemplateName || safeItemName;
}

export function parseMagicWeaponBonus(itemOrName) {
  const item = typeof itemOrName === "string" ? null : itemOrName;
  const name = cleanString(typeof itemOrName === "string" ? itemOrName : item?.name);
  const exactMatch = name.match(/^(?:Оружие|Weapon)\s*\+\s*([123])$/iu);
  if (exactMatch) {
    return Number(exactMatch[1]);
  }

  return item ? parseGenericMagicItemBonus(item, "Оружие", ["Любое", "Any"]) : null;
}

export function parseMagicArmorBonus(itemOrName) {
  const item = typeof itemOrName === "string" ? null : itemOrName;
  const name = cleanString(typeof itemOrName === "string" ? itemOrName : item?.name);
  const exactMatch = name.match(/^(?:Доспех|Armor)\s*\+\s*([123])$/iu);
  if (exactMatch) {
    return Number(exactMatch[1]);
  }

  return item ? parseGenericMagicItemBonus(item, "Доспех", ["Любой", "Any"]) : null;
}

export function parseMagicShieldBonus(itemOrName) {
  const item = typeof itemOrName === "string" ? null : itemOrName;
  const name = cleanString(typeof itemOrName === "string" ? itemOrName : item?.name);
  const exactMatch = name.match(/^(?:Щит|Shield)\s*\+\s*([123])$/iu);
  if (exactMatch) {
    return Number(exactMatch[1]);
  }

  return item ? parseGenericMagicItemBonus(item, "Доспех", ["Щит", "Shield"]) : null;
}

export function parseMagicToolBonus(itemOrName) {
  const item = typeof itemOrName === "string" ? null : itemOrName;
  const name = cleanString(typeof itemOrName === "string" ? itemOrName : item?.name);
  const exactMatch = name.match(/^(?:(?:универсальный\s+)?инструмент(?:ы)?|Tool|Tools)\s*\+\s*([123])$/iu);
  if (exactMatch) {
    return Number(exactMatch[1]);
  }

  return item && isUniversalMagicToolSource(getMagicItemTemplateSource(item))
    ? parseNamedMagicEquipmentBonus(item, "tool")
    : null;
}

function buildMagicArmorTemplateOption(item) {
  const id = cleanId(item?.id);
  const name = cleanString(item?.name);
  if (!id || !name) {
    return null;
  }

  const classification = classifyGearEntry(item);
  const armorType = cleanString(item?.armor?.type).toLowerCase();
  if (classification.documentType !== "equipment" || !armorType) {
    return null;
  }

  return {
    id,
    name,
    item,
    armorType,
    sourceCategory: classification.sourceCategory ?? "",
    baseItem: cleanString(item?.armor?.baseItem ?? classification.baseItem),
  };
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

function buildMagicToolTemplateOption(item) {
  const id = cleanId(item?.id);
  const name = cleanString(item?.name);
  if (!id || !name) {
    return null;
  }

  const classification = classifyGearEntry(item);
  if (classification.documentType !== "tool") {
    return null;
  }

  return {
    id,
    name,
    item,
    sourceCategory: classification.sourceCategory ?? "",
    toolType: classification.systemTypeValue ?? "",
  };
}

export function buildMagicToolTemplateOptions(model) {
  const collator = new Intl.Collator("ru", {
    numeric: true,
    sensitivity: "base",
  });

  return normalizeModelGear(model)
    .map((item) => buildMagicToolTemplateOption(item))
    .filter(Boolean)
    .sort((left, right) => collator.compare(left.name, right.name));
}

function buildMagicEquipmentTemplateOptions(model, { allowedNames, kind }) {
  const collator = new Intl.Collator("ru", {
    numeric: true,
    sensitivity: "base",
  });

  return normalizeModelGear(model)
    .map((item) => buildMagicArmorTemplateOption(item))
    .filter((entry) => {
      if (!entry) {
        return false;
      }

      const normalizedName = normalizeMatchText(entry.name);
      if (!allowedNames.has(normalizedName)) {
        return false;
      }

      if (kind === "shield") {
        return entry.armorType === "shield";
      }

      return entry.armorType !== "shield";
    })
    .sort((left, right) => collator.compare(left.name, right.name));
}

export function buildMagicArmorTemplateOptions(model) {
  return buildMagicEquipmentTemplateOptions(model, {
    allowedNames: NORMALIZED_MAGIC_ARMOR_TEMPLATE_NAMES,
    kind: "armor",
  });
}

export function buildMagicShieldTemplateOptions(model) {
  return buildMagicEquipmentTemplateOptions(model, {
    allowedNames: NORMALIZED_MAGIC_SHIELD_TEMPLATE_NAMES,
    kind: "shield",
  });
}

function buildMagicAmmunitionTemplateOption(item) {
  const id = cleanId(item?.id);
  const name = cleanString(item?.name);
  if (!id || !name) {
    return null;
  }

  const classification = classifyGearEntry(item);
  if (classification.documentType !== "consumable" || classification.systemTypeValue !== "ammo") {
    return null;
  }

  return {
    id,
    name: cleanString(name.replace(/\s*\(\d+\)\s*$/u, ""), name),
    item,
    ammoSubtype: cleanString(classification.systemTypeSubtype),
    sourceCategory: classification.sourceCategory ?? "",
  };
}

export function buildMagicAmmunitionTemplateOptions(model) {
  const collator = new Intl.Collator("ru", {
    numeric: true,
    sensitivity: "base",
  });

  return normalizeModelGear(model)
    .map((item) => buildMagicAmmunitionTemplateOption(item))
    .filter(Boolean)
    .sort((left, right) => collator.compare(left.name, right.name));
}

function isAlreadyTemplated(item, flagKeys = []) {
  return flagKeys.some((flagKey) => item?.getFlag?.(MODULE_ID, flagKey) === true);
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
  if (item?.type !== "weapon" || isAlreadyTemplated(item, ["magicWeaponTemplate", "magicEquipmentTemplate"])) {
    return null;
  }

  const source = getMagicItemTemplateSource(item);
  const genericBonus = parseMagicWeaponBonus(item);
  if (genericBonus) {
    return {
      actor,
      bonus: genericBonus,
      itemKind: "weapon",
      itemLabel: "Оружие",
      rule: findWeaponTemplateRule(source),
      preserveMagicItemName: false,
    };
  }

  const rule = findWeaponTemplateRule(source);
  if (!rule) {
    return null;
  }

  return {
    actor,
    bonus: parseNamedMagicEquipmentBonus(item, "weapon"),
    itemKind: "weapon",
    itemLabel: "Оружие",
    rule,
    preserveMagicItemName: true,
  };
}

function getPromptableMagicArmorContext(
  item,
  options = {},
  userId = "",
  { requireCurrentUser = true } = {},
) {
  if ((requireCurrentUser && !isCurrentUserHook(userId)) || shouldSkipMagicArmorTemplate(options) || !isCharacterOwnedItem(item)) {
    return null;
  }

  const actor = getOwnedActor(item);
  if (item?.type !== "equipment" || isAlreadyTemplated(item, ["magicArmorTemplate", "magicShieldTemplate", "magicEquipmentTemplate"])) {
    return null;
  }

  const source = getMagicItemTemplateSource(item);
  const armorBonus = parseMagicArmorBonus(item);
  if (armorBonus) {
    return {
      actor,
      bonus: armorBonus,
      itemKind: "armor",
      itemLabel: "Доспех",
      rule: findArmorTemplateRule(source),
      preserveMagicItemName: false,
    };
  }

  const shieldBonus = parseMagicShieldBonus(item);
  if (shieldBonus) {
    return {
      actor,
      bonus: shieldBonus,
      itemKind: "shield",
      itemLabel: "Щит",
      rule: findArmorTemplateRule(source),
      preserveMagicItemName: false,
    };
  }

  const rule = findArmorTemplateRule(source);
  if (rule) {
    const itemKind = rule.itemKind === "shield" ? "shield" : "armor";
    return {
      actor,
      bonus: parseNamedMagicEquipmentBonus(item, itemKind),
      itemKind,
      itemLabel: itemKind === "shield" ? "Щит" : "Доспех",
      rule,
      preserveMagicItemName: true,
    };
  }

  return null;
}

function getPromptableMagicAmmunitionContext(
  item,
  options = {},
  userId = "",
  { requireCurrentUser = true } = {},
) {
  if ((requireCurrentUser && !isCurrentUserHook(userId)) || shouldSkipMagicAmmunitionTemplate(options) || !isCharacterOwnedItem(item)) {
    return null;
  }

  const actor = getOwnedActor(item);
  if (item?.type !== "consumable" || isAlreadyTemplated(item, ["magicAmmunitionTemplate", "magicEquipmentTemplate"])) {
    return null;
  }

  const source = getMagicItemTemplateSource(item);
  const rule = findAmmunitionTemplateRule(source);
  if (!rule) {
    return null;
  }

  return {
    actor,
    bonus: parseNamedMagicEquipmentBonus(item, "ammunition"),
    itemKind: "ammunition",
    itemLabel: "Боеприпас",
    rule,
    preserveMagicItemName: !parseGenericMagicItemBonus(item, "Оружие", ["Боеприпас", "Любой боеприпас", "Стрела"]),
  };
}

function getPromptableMagicToolContext(
  item,
  options = {},
  userId = "",
  { requireCurrentUser = true } = {},
) {
  if ((requireCurrentUser && !isCurrentUserHook(userId)) || shouldSkipMagicToolTemplate(options) || !isCharacterOwnedItem(item)) {
    return null;
  }

  const actor = getOwnedActor(item);
  if (!["equipment", "loot", "tool"].includes(cleanString(item?.type)) || isAlreadyTemplated(item, ["magicToolTemplate", "magicEquipmentTemplate"])) {
    return null;
  }

  const bonus = parseMagicToolBonus(item);
  if (!bonus) {
    return null;
  }

  return {
    actor,
    bonus,
    itemKind: "tool",
    itemLabel: "Инструмент",
    rule: null,
    preserveMagicItemName: false,
  };
}

export function createMagicWeaponTemplateUpdate(item, weaponTemplate, bonus, { iconLookup = null, preserveMagicItemName = false } = {}) {
  const itemData = getItemData(item);
  const currentSystem = clonePlainObject(itemData.system);
  const baseItemData = createDnd5eItemData(weaponTemplate, new Map(), iconLookup);
  const baseSystem = clonePlainObject(baseItemData.system);
  const currentModuleFlags = getModuleFlags(item);
  const baseModuleFlags = clonePlainObject(baseItemData.flags?.[MODULE_ID]);
  const resolvedBonus = normalizeMagicTemplateBonus(bonus);
  const magicItemId = cleanString(currentModuleFlags.magicItemId, resolvedBonus ? `weapon-plus-${resolvedBonus}` : "magic-weapon-template");

  baseSystem.properties = mergeProperties(baseSystem.properties, currentSystem.properties, ["mgc"]);
  if (resolvedBonus) {
    baseSystem.magicalBonus = resolvedBonus;
  }
  applyCommonPreservedFields(baseSystem, currentSystem);

  baseSystem.description ??= {};
  baseSystem.description.value = buildMagicWeaponDescription(
    baseSystem.description.value,
    readMagicItemRulesText(item),
    resolvedBonus,
  );

  return {
    name: formatMagicTemplateName(itemData.name, weaponTemplate.name, resolvedBonus, { preserveMagicItemName }),
    img: baseItemData.img,
    system: baseSystem,
    flags: {
      [MODULE_ID]: {
        ...baseModuleFlags,
        ...currentModuleFlags,
        sourceType: "magicItem",
        magicItemId,
        gearId: cleanId(weaponTemplate.id),
        magicEquipmentTemplate: true,
        magicEquipmentKind: "weapon",
        magicEquipmentBonus: resolvedBonus,
        magicEquipmentGearId: cleanId(weaponTemplate.id),
        magicWeaponTemplate: true,
        magicWeaponBonus: resolvedBonus,
        magicWeaponGearId: cleanId(weaponTemplate.id),
        magical: true,
        foundryType: "weapon",
        foundrySubtype: baseModuleFlags.foundrySubtype ?? "",
        foundrySubtypeExtra: baseModuleFlags.foundrySubtypeExtra ?? "",
        foundryBaseItem: baseModuleFlags.foundryBaseItem ?? "",
      },
    },
  };
}

export function createMagicToolTemplateUpdate(item, toolTemplate, bonus, { iconLookup = null, preserveMagicItemName = false } = {}) {
  const itemData = getItemData(item);
  const currentSystem = clonePlainObject(itemData.system);
  const baseItemData = createDnd5eItemData(toolTemplate, new Map(), iconLookup);
  const baseSystem = clonePlainObject(baseItemData.system);
  const currentModuleFlags = getModuleFlags(item);
  const baseModuleFlags = clonePlainObject(baseItemData.flags?.[MODULE_ID]);
  const gearId = cleanId(toolTemplate.id);
  const resolvedBonus = normalizeMagicTemplateBonus(bonus);
  const magicItemId = cleanString(currentModuleFlags.magicItemId, resolvedBonus ? `tool-plus-${resolvedBonus}` : "magic-tool-template");

  applyCommonPreservedFields(baseSystem, currentSystem);
  baseSystem.properties = mergeProperties(baseSystem.properties, currentSystem.properties, ["mgc"]);
  baseSystem.bonus = resolvedBonus ? `+${resolvedBonus}` : cleanString(currentSystem.bonus);

  baseSystem.description ??= {};
  baseSystem.description.value = buildMagicToolDescription(
    baseSystem.description.value,
    readMagicItemRulesText(item),
    resolvedBonus,
  );

  return {
    name: formatMagicTemplateName(itemData.name, toolTemplate.name, resolvedBonus, { preserveMagicItemName }),
    type: "tool",
    img: baseItemData.img,
    system: baseSystem,
    flags: {
      [MODULE_ID]: {
        ...baseModuleFlags,
        ...currentModuleFlags,
        sourceType: "magicItem",
        magicItemId,
        gearId,
        magicEquipmentTemplate: true,
        magicEquipmentKind: "tool",
        magicEquipmentBonus: resolvedBonus,
        magicEquipmentGearId: gearId,
        magicToolTemplate: true,
        magicToolBonus: resolvedBonus,
        magicToolGearId: gearId,
        magical: true,
        foundryType: "tool",
        foundrySubtype: baseModuleFlags.foundrySubtype ?? "",
        foundrySubtypeExtra: baseModuleFlags.foundrySubtypeExtra ?? "",
        foundryBaseItem: baseModuleFlags.foundryBaseItem ?? "",
      },
    },
  };
}

function createMagicArmorLikeTemplateUpdate(
  item,
  armorTemplate,
  bonus,
  {
    iconLookup = null,
    itemKind = "armor",
    templateFlagName = "magicArmorTemplate",
    bonusFlagName = "magicArmorBonus",
    gearFlagName = "magicArmorGearId",
    magicItemIdFallback = `armor-plus-${bonus}`,
    preserveMagicItemName = false,
  } = {},
) {
  const itemData = getItemData(item);
  const currentSystem = clonePlainObject(itemData.system);
  const baseItemData = createDnd5eItemData(armorTemplate, new Map(), iconLookup);
  const baseSystem = clonePlainObject(baseItemData.system);
  const currentModuleFlags = getModuleFlags(item);
  const baseModuleFlags = clonePlainObject(baseItemData.flags?.[MODULE_ID]);
  const gearId = cleanId(armorTemplate.id);
  const resolvedBonus = normalizeMagicTemplateBonus(bonus);
  const magicItemId = cleanString(currentModuleFlags.magicItemId, resolvedBonus ? magicItemIdFallback : `${itemKind}-magic-template`);

  applyCommonPreservedFields(baseSystem, currentSystem);
  baseSystem.properties = mergeProperties(baseSystem.properties, currentSystem.properties, ["mgc"]);
  baseSystem.armor ??= {};
  baseSystem.armor.magicalBonus = resolvedBonus;

  baseSystem.description ??= {};
  baseSystem.description.value = buildMagicArmorDescription(
    baseSystem.description.value,
    readMagicItemRulesText(item),
    resolvedBonus,
    itemKind === "shield" ? "щит" : "доспех",
  );

  return {
    name: formatMagicTemplateName(itemData.name, armorTemplate.name, resolvedBonus, { preserveMagicItemName }),
    img: baseItemData.img,
    system: baseSystem,
    flags: {
      [MODULE_ID]: {
        ...baseModuleFlags,
        ...currentModuleFlags,
        sourceType: "magicItem",
        magicItemId,
        gearId,
        magicEquipmentTemplate: true,
        magicEquipmentKind: itemKind,
        magicEquipmentBonus: resolvedBonus,
        magicEquipmentGearId: gearId,
        [templateFlagName]: true,
        [bonusFlagName]: resolvedBonus,
        [gearFlagName]: gearId,
        magical: true,
        foundryType: "equipment",
        foundrySubtype: baseModuleFlags.foundrySubtype ?? "",
        foundrySubtypeExtra: baseModuleFlags.foundrySubtypeExtra ?? "",
        foundryBaseItem: baseModuleFlags.foundryBaseItem ?? "",
      },
    },
  };
}

export function createMagicArmorTemplateUpdate(item, armorTemplate, bonus, { iconLookup = null, preserveMagicItemName = false } = {}) {
  return createMagicArmorLikeTemplateUpdate(item, armorTemplate, bonus, {
    iconLookup,
    itemKind: "armor",
    templateFlagName: "magicArmorTemplate",
    bonusFlagName: "magicArmorBonus",
    gearFlagName: "magicArmorGearId",
    magicItemIdFallback: `armor-plus-${bonus}`,
    preserveMagicItemName,
  });
}

export function createMagicShieldTemplateUpdate(item, shieldTemplate, bonus, { iconLookup = null, preserveMagicItemName = false } = {}) {
  return createMagicArmorLikeTemplateUpdate(item, shieldTemplate, bonus, {
    iconLookup,
    itemKind: "shield",
    templateFlagName: "magicShieldTemplate",
    bonusFlagName: "magicShieldBonus",
    gearFlagName: "magicShieldGearId",
    magicItemIdFallback: `shield-plus-${bonus}`,
    preserveMagicItemName,
  });
}

export function createMagicAmmunitionTemplateUpdate(item, ammunitionTemplate, bonus, { iconLookup = null, preserveMagicItemName = false } = {}) {
  const itemData = getItemData(item);
  const currentSystem = clonePlainObject(itemData.system);
  const baseItemData = createDnd5eItemData(ammunitionTemplate, new Map(), iconLookup);
  const baseSystem = clonePlainObject(baseItemData.system);
  const currentModuleFlags = getModuleFlags(item);
  const baseModuleFlags = clonePlainObject(baseItemData.flags?.[MODULE_ID]);
  const gearId = cleanId(ammunitionTemplate.id);
  const resolvedBonus = normalizeMagicTemplateBonus(bonus);
  const magicItemId = cleanString(currentModuleFlags.magicItemId, resolvedBonus ? `ammunition-plus-${resolvedBonus}` : "magic-ammunition-template");
  const templateName = cleanString(baseItemData.name, ammunitionTemplate.name);

  applyCommonPreservedFields(baseSystem, currentSystem);
  baseSystem.properties = mergeProperties(baseSystem.properties, currentSystem.properties, ["mgc"]);
  if (resolvedBonus) {
    baseSystem.magicalBonus = resolvedBonus;
  }

  baseSystem.description ??= {};
  baseSystem.description.value = buildMagicTemplateDescription(
    baseSystem.description.value,
    readMagicItemRulesText(item),
    resolvedBonus
      ? `<p><strong>Магический боеприпас +${resolvedBonus}.</strong> Бонус сохранён на предмете для использования при атаке.</p>`
      : "<p><strong>Магический боеприпас.</strong> Базовый шаблон Rebreya применён к магическому предмету.</p>",
  );

  return {
    name: formatMagicTemplateName(itemData.name, templateName, resolvedBonus, { preserveMagicItemName }),
    type: "consumable",
    img: baseItemData.img,
    system: baseSystem,
    flags: {
      [MODULE_ID]: {
        ...baseModuleFlags,
        ...currentModuleFlags,
        sourceType: "magicItem",
        magicItemId,
        gearId,
        magicEquipmentTemplate: true,
        magicEquipmentKind: "ammunition",
        magicEquipmentBonus: resolvedBonus,
        magicEquipmentGearId: gearId,
        magicAmmunitionTemplate: true,
        magicAmmunitionBonus: resolvedBonus,
        magicAmmunitionGearId: gearId,
        magical: true,
        foundryType: "consumable",
        foundrySubtype: "ammo",
        foundrySubtypeExtra: baseModuleFlags.foundrySubtypeExtra ?? baseSystem.type?.subtype ?? "",
        foundryBaseItem: baseModuleFlags.foundryBaseItem ?? "",
      },
    },
  };
}

async function resolveModuleModel(moduleApi = globalThis.game?.rebreyaMain) {
  return typeof moduleApi?.getModel === "function"
    ? moduleApi.getModel()
    : moduleApi?.repository?.model;
}

async function processMagicWeaponTemplateItem(
  item,
  context,
  moduleApi = globalThis.game?.rebreyaMain,
  { prompt = promptMagicWeaponTemplate } = {},
) {
  const safeContext = isPlainObject(context) ? context : {
    bonus: normalizeMagicTemplateBonus(context),
    itemLabel: "Оружие",
    rule: null,
    preserveMagicItemName: false,
  };
  const itemKey = magicWeaponTemplateItemKey(item);
  if (!itemKey || pendingMagicWeaponTemplateItemKeys.has(itemKey)) {
    return false;
  }

  pendingMagicWeaponTemplateItemKeys.add(itemKey);
  try {
    const model = await resolveModuleModel(moduleApi);
    const weapons = filterTemplateOptions(buildMagicWeaponTemplateOptions(model), safeContext.rule);
    if (!weapons.length) {
      globalThis.ui?.notifications?.warn?.("В данных Rebreya не найдено базовых шаблонов оружия.");
      return false;
    }

    const selectedId = cleanId(await prompt({
      item,
      bonus: safeContext.bonus,
      itemLabel: safeContext.itemLabel ?? "Оружие",
      options: weapons,
      weapons,
    }));
    if (!selectedId) {
      return false;
    }

    const selectedWeapon = weapons.find((weapon) => weapon.id === selectedId);
    if (!selectedWeapon) {
      globalThis.ui?.notifications?.warn?.("Выбранный шаблон оружия Rebreya не найден.");
      return false;
    }

    const iconLookup = await buildGearIconLookup();
    const updateData = createMagicWeaponTemplateUpdate(item, selectedWeapon.item, safeContext.bonus, {
      iconLookup,
      preserveMagicItemName: safeContext.preserveMagicItemName === true,
    });
    await item.update(updateData, {
      [MODULE_ID]: {
        skipMagicWeaponTemplate: true,
        skipMagicEquipmentTemplate: true,
      },
      skipMagicWeaponTemplate: true,
      skipMagicEquipmentTemplate: true,
    });

    const bonusText = safeContext.bonus ? ` +${safeContext.bonus}` : "";
    globalThis.ui?.notifications?.info?.(`Оружие${bonusText} превращено в «${updateData.name}».`);
    return true;
  }
  finally {
    pendingMagicWeaponTemplateItemKeys.delete(itemKey);
  }
}

async function processMagicArmorTemplateItem(
  item,
  context,
  moduleApi = globalThis.game?.rebreyaMain,
  { prompt = promptMagicArmorTemplate } = {},
) {
  const itemKey = magicWeaponTemplateItemKey(item);
  if (!itemKey || pendingMagicWeaponTemplateItemKeys.has(itemKey)) {
    return false;
  }

  pendingMagicWeaponTemplateItemKeys.add(itemKey);
  try {
    const model = await resolveModuleModel(moduleApi);
    const options = filterTemplateOptions(context.itemKind === "shield"
      ? buildMagicShieldTemplateOptions(model)
      : buildMagicArmorTemplateOptions(model), context.rule);
    if (!options.length) {
      globalThis.ui?.notifications?.warn?.(
        context.itemKind === "shield"
          ? "В данных Rebreya не найдено базовых шаблонов щитов."
          : "В данных Rebreya не найдено базовых шаблонов доспехов.",
      );
      return false;
    }

    const selectedId = cleanId(await prompt({
      item,
      bonus: context.bonus,
      itemLabel: context.itemLabel,
      options,
    }));
    if (!selectedId) {
      return false;
    }

    const selectedTemplate = options.find((entry) => entry.id === selectedId);
    if (!selectedTemplate) {
      globalThis.ui?.notifications?.warn?.(
        context.itemKind === "shield"
          ? "Выбранный шаблон щита Rebreya не найден."
          : "Выбранный шаблон доспеха Rebreya не найден.",
      );
      return false;
    }

    const iconLookup = await buildGearIconLookup();
    const updateData = context.itemKind === "shield"
      ? createMagicShieldTemplateUpdate(item, selectedTemplate.item, context.bonus, {
        iconLookup,
        preserveMagicItemName: context.preserveMagicItemName === true,
      })
      : createMagicArmorTemplateUpdate(item, selectedTemplate.item, context.bonus, {
        iconLookup,
        preserveMagicItemName: context.preserveMagicItemName === true,
      });
    await item.update(updateData, {
      [MODULE_ID]: {
        skipMagicArmorTemplate: true,
        skipMagicEquipmentTemplate: true,
      },
      skipMagicArmorTemplate: true,
      skipMagicEquipmentTemplate: true,
    });

    const bonusText = context.bonus ? ` +${context.bonus}` : "";
    globalThis.ui?.notifications?.info?.(`${context.itemLabel}${bonusText} превращён в «${updateData.name}».`);
    return true;
  }
  finally {
    pendingMagicWeaponTemplateItemKeys.delete(itemKey);
  }
}

async function processMagicAmmunitionTemplateItem(
  item,
  context,
  moduleApi = globalThis.game?.rebreyaMain,
  { prompt = promptMagicAmmunitionTemplate } = {},
) {
  const itemKey = magicWeaponTemplateItemKey(item);
  if (!itemKey || pendingMagicWeaponTemplateItemKeys.has(itemKey)) {
    return false;
  }

  pendingMagicWeaponTemplateItemKeys.add(itemKey);
  try {
    const model = await resolveModuleModel(moduleApi);
    const options = filterTemplateOptions(buildMagicAmmunitionTemplateOptions(model), context.rule);
    if (!options.length) {
      globalThis.ui?.notifications?.warn?.("В данных Rebreya не найдено базовых шаблонов боеприпасов.");
      return false;
    }

    const selectedId = cleanId(await prompt({
      item,
      bonus: context.bonus,
      itemLabel: context.itemLabel,
      options,
    }));
    if (!selectedId) {
      return false;
    }

    const selectedTemplate = options.find((entry) => entry.id === selectedId);
    if (!selectedTemplate) {
      globalThis.ui?.notifications?.warn?.("Выбранный шаблон боеприпаса Rebreya не найден.");
      return false;
    }

    const iconLookup = await buildGearIconLookup();
    const updateData = createMagicAmmunitionTemplateUpdate(item, selectedTemplate.item, context.bonus, {
      iconLookup,
      preserveMagicItemName: context.preserveMagicItemName === true,
    });
    await item.update(updateData, {
      [MODULE_ID]: {
        skipMagicAmmunitionTemplate: true,
        skipMagicEquipmentTemplate: true,
      },
      skipMagicAmmunitionTemplate: true,
      skipMagicEquipmentTemplate: true,
    });

    const bonusText = context.bonus ? ` +${context.bonus}` : "";
    globalThis.ui?.notifications?.info?.(`Боеприпас${bonusText} превращён в «${updateData.name}».`);
    return true;
  }
  finally {
    pendingMagicWeaponTemplateItemKeys.delete(itemKey);
  }
}

async function processMagicToolTemplateItem(
  item,
  context,
  moduleApi = globalThis.game?.rebreyaMain,
  { prompt = promptMagicToolTemplate } = {},
) {
  const itemKey = magicWeaponTemplateItemKey(item);
  if (!itemKey || pendingMagicWeaponTemplateItemKeys.has(itemKey)) {
    return false;
  }

  pendingMagicWeaponTemplateItemKeys.add(itemKey);
  try {
    const model = await resolveModuleModel(moduleApi);
    const options = filterTemplateOptions(buildMagicToolTemplateOptions(model), context.rule);
    if (!options.length) {
      globalThis.ui?.notifications?.warn?.("В данных Rebreya не найдено базовых шаблонов инструментов.");
      return false;
    }

    const selectedId = cleanId(await prompt({
      item,
      bonus: context.bonus,
      itemLabel: context.itemLabel,
      options,
    }));
    if (!selectedId) {
      return false;
    }

    const selectedTemplate = options.find((entry) => entry.id === selectedId);
    if (!selectedTemplate) {
      globalThis.ui?.notifications?.warn?.("Выбранный шаблон инструмента Rebreya не найден.");
      return false;
    }

    const iconLookup = await buildGearIconLookup();
    const updateData = createMagicToolTemplateUpdate(item, selectedTemplate.item, context.bonus, {
      iconLookup,
      preserveMagicItemName: context.preserveMagicItemName === true,
    });
    await item.update(updateData, {
      [MODULE_ID]: {
        skipMagicToolTemplate: true,
        skipMagicEquipmentTemplate: true,
      },
      skipMagicToolTemplate: true,
      skipMagicEquipmentTemplate: true,
    });

    const bonusText = context.bonus ? ` +${context.bonus}` : "";
    globalThis.ui?.notifications?.info?.(`Инструмент${bonusText} превращён в «${updateData.name}».`);
    return true;
  }
  finally {
    pendingMagicWeaponTemplateItemKeys.delete(itemKey);
  }
}

export async function promptMagicWeaponTemplate({ item, bonus, weapons }) {
  return promptMagicItemTemplate({
    item,
    bonus,
    itemLabel: "Оружие",
    options: weapons,
    emptyMessage: "В данных Rebreya не найдено базовых шаблонов оружия.",
  });
}

async function promptMagicArmorTemplate({ item, bonus, itemLabel, options }) {
  const emptyMessage = itemLabel === "Щит"
    ? "В данных Rebreya не найдено базовых шаблонов щитов."
    : "В данных Rebreya не найдено базовых шаблонов доспехов.";
  return promptMagicItemTemplate({
    item,
    bonus,
    itemLabel,
    options,
    emptyMessage,
  });
}

export async function promptMagicAmmunitionTemplate({ item, bonus, itemLabel = "Боеприпас", options }) {
  return promptMagicItemTemplate({
    item,
    bonus,
    itemLabel,
    options,
    emptyMessage: "В данных Rebreya не найдено базовых шаблонов боеприпасов.",
  });
}

export async function promptMagicToolTemplate({ item, bonus, itemLabel = "Инструмент", options }) {
  return promptMagicItemTemplate({
    item,
    bonus,
    itemLabel,
    options,
    emptyMessage: "В данных Rebreya не найдено базовых шаблонов инструментов.",
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

  return processMagicWeaponTemplateItem(item, promptable, moduleApi, { prompt });
}

export async function handleCreatedMagicArmorItem(
  item,
  options = {},
  userId = "",
  moduleApi = globalThis.game?.rebreyaMain,
  { prompt = promptMagicArmorTemplate } = {},
) {
  const promptable = getPromptableMagicArmorContext(item, options, userId, {
    requireCurrentUser: true,
  });
  if (!promptable) {
    return false;
  }

  return processMagicArmorTemplateItem(item, promptable, moduleApi, { prompt });
}

export async function handleCreatedMagicAmmunitionItem(
  item,
  options = {},
  userId = "",
  moduleApi = globalThis.game?.rebreyaMain,
  { prompt = promptMagicAmmunitionTemplate } = {},
) {
  const promptable = getPromptableMagicAmmunitionContext(item, options, userId, {
    requireCurrentUser: true,
  });
  if (!promptable) {
    return false;
  }

  return processMagicAmmunitionTemplateItem(item, promptable, moduleApi, { prompt });
}

export async function handleCreatedMagicToolItem(
  item,
  options = {},
  userId = "",
  moduleApi = globalThis.game?.rebreyaMain,
  { prompt = promptMagicToolTemplate } = {},
) {
  const promptable = getPromptableMagicToolContext(item, options, userId, {
    requireCurrentUser: true,
  });
  if (!promptable) {
    return false;
  }

  return processMagicToolTemplateItem(item, promptable, moduleApi, { prompt });
}

export async function handleActorRenderMagicWeapons(
  actor,
  moduleApi = globalThis.game?.rebreyaMain,
  {
    prompt = promptMagicWeaponTemplate,
    armorPrompt = promptMagicArmorTemplate,
    ammunitionPrompt = promptMagicAmmunitionTemplate,
    toolPrompt = promptMagicToolTemplate,
  } = {},
) {
  if (actor?.type !== "character" || !canPromptForActor(actor)) {
    return false;
  }

  for (const item of normalizeArray(actor.items)) {
    const promptableWeapon = getPromptableMagicWeaponContext(item, {}, "", {
      requireCurrentUser: false,
    });
    if (promptableWeapon) {
      return processMagicWeaponTemplateItem(item, promptableWeapon, moduleApi, { prompt });
    }

    const promptableArmor = getPromptableMagicArmorContext(item, {}, "", {
      requireCurrentUser: false,
    });
    if (promptableArmor) {
      return processMagicArmorTemplateItem(item, promptableArmor, moduleApi, {
        prompt: armorPrompt,
      });
    }

    const promptableAmmunition = getPromptableMagicAmmunitionContext(item, {}, "", {
      requireCurrentUser: false,
    });
    if (promptableAmmunition) {
      return processMagicAmmunitionTemplateItem(item, promptableAmmunition, moduleApi, {
        prompt: ammunitionPrompt,
      });
    }

    const promptableTool = getPromptableMagicToolContext(item, {}, "", {
      requireCurrentUser: false,
    });
    if (promptableTool) {
      return processMagicToolTemplateItem(item, promptableTool, moduleApi, {
        prompt: toolPrompt,
      });
    }
  }

  return false;
}

export function registerMagicWeaponTemplateHook(moduleApi, { Hooks = globalThis.Hooks } = {}) {
  if (magicWeaponTemplateHookRegistered || typeof Hooks?.on !== "function") {
    return false;
  }

  magicWeaponTemplateHookRegistered = true;
  Hooks.on("createItem", (item, options, userId) => {
    (async () => {
      if (await handleCreatedMagicWeaponItem(item, options, userId, moduleApi)) {
        return true;
      }

      if (await handleCreatedMagicArmorItem(item, options, userId, moduleApi)) {
        return true;
      }

      if (await handleCreatedMagicAmmunitionItem(item, options, userId, moduleApi)) {
        return true;
      }

      return handleCreatedMagicToolItem(item, options, userId, moduleApi);
    })().catch((error) => {
      console.error(`${MODULE_ID} | Failed to apply magic equipment template.`, error);
      globalThis.ui?.notifications?.error?.(error.message || "Не удалось применить шаблон магического предмета.");
    });
  });

  const repairActorSheetMagicWeapons = (app) => {
    const actor = app?.actor ?? app?.document ?? null;
    handleActorRenderMagicWeapons(actor, moduleApi).catch((error) => {
      console.error(`${MODULE_ID} | Failed to process rendered magic equipment template.`, error);
      globalThis.ui?.notifications?.error?.(error.message || "Не удалось обработать магический предмет на листе персонажа.");
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
