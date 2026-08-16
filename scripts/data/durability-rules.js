const MODULE_ID = "rebreya-main";
const DURABLE_ITEM_TYPES = new Set(["weapon", "equipment", "tool", "container", "consumable", "loot"]);
const NON_DURABLE_STACK_SOURCE_TYPES = new Set(["material", "good", "resource", "supply"]);
const MAGIC_PROPERTY_KEYS = new Set([
  "mgc",
  "magic",
  "magical",
  "магия",
  "магический",
  "магическое",
  "волшебный",
  "волшебное"
]);
const IMMUNE_DAMAGE_TYPES = new Set(["poison", "psychic", "яд", "психический", "психическая энергия"]);

export const DURABILITY_PROFILES = Object.freeze({
  fabric: Object.freeze({ fragile: 1, sturdy: 3, ac: 9, threshold: 0 }),
  wood: Object.freeze({ fragile: 3, sturdy: 6, ac: 12, threshold: 2 }),
  glass: Object.freeze({ fragile: 2, sturdy: 5, ac: 11, threshold: 0 }),
  leather: Object.freeze({ fragile: 2, sturdy: 6, ac: 11, threshold: 2 }),
  iron: Object.freeze({ fragile: 5, sturdy: 11, ac: 14, threshold: 5 }),
  steel: Object.freeze({ fragile: 7, sturdy: 15, ac: 17, threshold: 6 }),
  adamantine: Object.freeze({ fragile: 10, sturdy: 22, ac: 19, threshold: 10 }),
  stone: Object.freeze({ fragile: 4, sturdy: 8, ac: 13, threshold: 3 }),
  mithral: Object.freeze({ fragile: 6, sturdy: 12, ac: 15, threshold: 5 }),
  crystal: Object.freeze({ fragile: 4, sturdy: 11, ac: 12, threshold: 4 })
});

const SIZE_MULTIPLIERS = Object.freeze({
  tiny: 0.5,
  small: 1,
  medium: 2,
  large: 3,
  huge: 4,
  gargantuan: 6
});

const MATERIAL_ALIASES = Object.freeze({
  fabric: Object.freeze([
    "fabric", "fabrics", "cloth", "textile", "textiles", "thread", "silk", "wool", "linen",
    "flax", "cotton", "canvas", "hemp", "rope", "paper", "parchment", "ткань", "ткани",
    "текстиль", "нить", "шелк", "шерсть", "лен", "хлопок", "холст", "пенька", "веревка",
    "бумага", "пергамент", "паутина гиганского паука", "шерсть гриффона", "шерсть чудовища"
  ]),
  wood: Object.freeze([
    "wood", "wooden", "timber", "lumber", "oak", "pine", "ash wood", "yew", "bamboo", "cork",
    "bone", "ivory", "horn", "antler", "дерево", "деревянный", "древесина", "дуб", "сосна",
    "ясень", "тис", "бамбук", "пробка", "кость", "кости", "слоновая кость", "бивень", "рог",
    "бивень чудовища", "гиганский коготь", "жало чудовища", "коготь чудовища", "кости мантикоры",
    "кость мантикоры", "коготь", "осколок черепа чудовища", "рог чудовища", "сердцевина древня",
    "фейское дерево", "хребет чудовища", "ядовитый шип", "осколок кости чудовища"
  ]),
  glass: Object.freeze([
    "glass", "glassware", "obsidian", "стекло", "стеклянный", "обсидиан", "обсидиановый осколок"
  ]),
  leather: Object.freeze([
    "leather", "hide", "skin", "fur", "pelt", "rawhide", "chitin", "carapace", "scale", "scales",
    "sinew", "кожа", "кожаный", "шкура", "мех", "сыромятная кожа", "хитин", "панцирь", "чешуя",
    "сухожилие", "закаленная чешуя", "панцирь чудовища", "фрагмент панциря чудовища",
    "хитин чудовища", "чешуя монстра", "шкура чудовища", "сухожилие чудовища", "кожа и ткань"
  ]),
  iron: Object.freeze([
    "iron", "cast iron", "wrought iron", "copper", "tin", "lead", "silver", "gold", "platinum",
    "bronze", "brass", "pewter", "железо", "железный", "чугун", "кованое железо", "медь",
    "олово", "свинец", "серебро", "золото", "платина", "бронза", "латунь", "оловянный сплав"
  ]),
  steel: Object.freeze([
    "steel", "refined steel", "tempered steel", "alloy steel", "сталь", "стальной", "рафинированная сталь",
    "закаленная сталь", "легированная сталь", "дьявольское железо", "искажающая сталь",
    "коричневая сталь", "лунный металл", "ночная сталь", "радужный металл", "эльфийская сталь"
  ]),
  adamantine: Object.freeze([
    "adamantine", "adamant", "adamantium", "адамантин", "адамантий", "адамант", "освященный адамантий"
  ]),
  stone: Object.freeze([
    "stone", "rock", "slate", "clay", "brick", "limestone", "lime", "masonry", "marble", "granite",
    "sandstone", "sand", "камень", "каменный", "сланец", "глина", "кирпич", "известняк", "известь",
    "каменная кладка", "мрамор", "гранит", "песчаник", "песок", "грозовой камень",
    "осколки метеоритных звезд"
  ]),
  mithral: Object.freeze([
    "mithral", "mithril", "митрал", "митрил", "мифрал", "мифрил"
  ]),
  crystal: Object.freeze([
    "crystal", "crystalline", "gem", "gems", "gemstone", "gemstones", "quartz", "diamond", "ruby",
    "sapphire", "emerald", "amethyst", "opal", "кристалл", "кристал", "кристаллический", "хрусталь",
    "самоцвет", "драгоценный камень", "кварц", "алмаз", "бриллиант", "рубин", "сапфир", "изумруд",
    "аметист", "опал", "великий осколок души", "грозовой кристалл", "кристалы забытых титанов",
    "кристаллы забытых титанов", "кристальный левиафан", "крупный кристал маны", "крупный кристалл маны",
    "малый осколок души", "осколок маны", "осколок тени", "чистый кристалл маны"
  ])
});

const CONSTRUCTION_ALIASES = new Map([
  ["fragile", "fragile"],
  ["хрупкий", "fragile"],
  ["хрупкая", "fragile"],
  ["хрупкое", "fragile"],
  ["sturdy", "sturdy"],
  ["прочный", "sturdy"],
  ["прочная", "sturdy"],
  ["прочное", "sturdy"]
]);

const SIZE_ALIASES = new Map([
  ["tiny", "tiny"],
  ["крошечный", "tiny"],
  ["крошечная", "tiny"],
  ["small", "small"],
  ["маленький", "small"],
  ["маленькая", "small"],
  ["medium", "medium"],
  ["средний", "medium"],
  ["средняя", "medium"],
  ["large", "large"],
  ["большой", "large"],
  ["большая", "large"],
  ["huge", "huge"],
  ["огромный", "huge"],
  ["огромная", "huge"],
  ["gargantuan", "gargantuan"],
  ["исполинский", "gargantuan"],
  ["исполинская", "gargantuan"]
]);

function normalizeToken(value) {
  return String(value ?? "")
    .normalize("NFKC")
    .trim()
    .toLowerCase()
    .replace(/ё/gu, "е")
    .replace(/[‐‑‒–—-]+/gu, " ")
    .replace(/\s+/gu, " ");
}

function normalizeCompactToken(value) {
  return normalizeToken(value).replace(/[\s_.:/\\-]+/gu, "");
}

const MATERIAL_PROFILE_BY_ALIAS = new Map();
for (const [profile, aliases] of Object.entries(MATERIAL_ALIASES)) {
  MATERIAL_PROFILE_BY_ALIAS.set(profile, profile);
  for (const alias of aliases) {
    MATERIAL_PROFILE_BY_ALIAS.set(normalizeToken(alias), profile);
  }
}

function recognizedMaterialProfile(value) {
  const token = normalizeToken(value);
  if (Object.hasOwn(DURABILITY_PROFILES, token)) {
    return token;
  }
  return MATERIAL_PROFILE_BY_ALIAS.get(token) ?? "";
}

function recognizedConstruction(value) {
  return CONSTRUCTION_ALIASES.get(normalizeToken(value)) ?? "";
}

function recognizedSize(value) {
  return SIZE_ALIASES.get(normalizeToken(value)) ?? "";
}

function firstResolved(values, resolver) {
  for (const value of values) {
    const resolved = resolver(value);
    if (resolved) {
      return resolved;
    }
  }
  return "";
}

function moduleFlags(itemData) {
  return itemData?.flags?.[MODULE_ID]
    ?? itemData?._source?.flags?.[MODULE_ID]
    ?? {};
}

function propertyTokens(properties) {
  if (properties instanceof Set || Array.isArray(properties)) {
    return Array.from(properties).flatMap((entry) => propertyTokens(entry));
  }
  if (typeof properties === "string") {
    return [normalizeToken(properties)];
  }
  if (!properties || typeof properties !== "object") {
    return [];
  }

  const tokens = propertyTokens(properties.value);
  for (const [key, enabled] of Object.entries(properties)) {
    if (key !== "value" && enabled === true) {
      tokens.push(normalizeToken(key));
    }
  }
  return tokens;
}

function rarityToken(rarity) {
  if (rarity && typeof rarity === "object") {
    return normalizeToken(rarity.value ?? rarity.id ?? rarity.key ?? rarity.slug);
  }
  return normalizeToken(rarity);
}

function isMagicSourceType(value) {
  const token = normalizeCompactToken(value);
  return token === "magicitem"
    || token === "magicitems"
    || token === "magic"
    || token === "magical"
    || token === "магическийпредмет"
    || token === "магия";
}

function hasMagicMarker(itemData) {
  const flags = moduleFlags(itemData);
  const propertyIsMagical = propertyTokens(itemData?.system?.properties)
    .some((property) => MAGIC_PROPERTY_KEYS.has(property));
  const rarity = rarityToken(itemData?.system?.rarity ?? itemData?.rarity);

  return propertyIsMagical
    || Boolean(rarity)
    || flags.magical === true
    || flags.isMagical === true
    || flags.magic === true
    || Boolean(flags.magicItemId)
    || Boolean(flags.magicId)
    || isMagicSourceType(flags.sourceType)
    || isMagicSourceType(flags.itemType)
    || isMagicSourceType(flags.magicItemType);
}

function isNonDurableStack(flags) {
  return Boolean(flags.materialId)
    || Boolean(flags.linkedGoodId)
    || flags.managedPartySupply === true
    || Boolean(flags.resourceKey)
    || normalizeToken(flags.sourceType) === "cointemplate"
    || Boolean(normalizeToken(flags.storageCoinTemplate?.denomination))
    || NON_DURABLE_STACK_SOURCE_TYPES.has(normalizeToken(flags.sourceType));
}

export function isDurabilityEligible(itemData) {
  if (!itemData || typeof itemData !== "object") {
    return false;
  }

  const type = normalizeToken(itemData.type);
  if (!DURABLE_ITEM_TYPES.has(type)) {
    return false;
  }

  const flags = moduleFlags(itemData);
  if (flags?.durability?.eligible === false || isNonDurableStack(flags)) {
    return false;
  }

  return !hasMagicMarker(itemData);
}

export function resolveDurabilityProfile({ itemData = {}, gear = {}, material = {} } = {}) {
  const flags = moduleFlags(itemData);
  const itemDurability = itemData?.durability ?? flags?.durability ?? {};
  const gearDurability = gear?.durability ?? {};

  const explicitMaterialProfile = firstResolved([
    itemDurability.materialProfile,
    flags.durabilityProfile,
    itemData?.durabilityProfile,
    gearDurability.materialProfile,
    gear?.durabilityProfile,
    gear?.materialProfile
  ], recognizedMaterialProfile);
  const materialRecordProfile = firstResolved([
    material?.durability?.materialProfile,
    material?.durabilityProfile,
    material?.materialProfile,
    material?.profile
  ], recognizedMaterialProfile);
  const materialNames = [
    material?.name,
    material?.subtype,
    material?.category,
    gear?.predominantMaterialName,
    gear?.materialName,
    flags?.predominantMaterialName,
    itemData?.predominantMaterialName
  ];
  const aliasedMaterialProfile = firstResolved(materialNames, recognizedMaterialProfile);
  const materialProfile = explicitMaterialProfile || materialRecordProfile || aliasedMaterialProfile || "wood";

  const construction = firstResolved([
    itemDurability.construction,
    flags.durabilityConstruction,
    itemData?.construction,
    gearDurability.construction,
    gear?.durabilityConstruction,
    gear?.construction
  ], recognizedConstruction) || "sturdy";
  const size = firstResolved([
    itemDurability.size,
    flags.durabilitySize,
    itemData?.objectSize,
    gearDurability.size,
    gear?.durabilitySize,
    gear?.objectSize,
    gear?.size
  ], recognizedSize) || "small";

  const baseProfile = DURABILITY_PROFILES[materialProfile];
  const result = {
    materialProfile,
    construction,
    size,
    hpMax: Math.max(1, Math.ceil(baseProfile[construction] * SIZE_MULTIPLIERS[size])),
    ac: baseProfile.ac,
    damageThreshold: baseProfile.threshold
  };

  if (!explicitMaterialProfile && !materialRecordProfile && !aliasedMaterialProfile) {
    const unknownName = materialNames.map(normalizeToken).find(Boolean) || "missing";
    result.diagnosticToken = `unknown-material:${unknownName}`;
  }

  return result;
}

export function buildInitialDurability(profile = {}) {
  const hpMax = Math.max(0, Number(profile.hpMax) || 0);
  const flag = {
    version: 1,
    eligible: true,
    state: "intact",
    breakStage: 0,
    materialProfile: recognizedMaterialProfile(profile.materialProfile) || "wood",
    construction: recognizedConstruction(profile.construction) || "sturdy",
    size: recognizedSize(profile.size) || "small",
    hp: { value: hpMax, max: hpMax },
    ac: Math.max(0, Number(profile.ac) || 0),
    damageThreshold: Math.max(0, Number(profile.damageThreshold) || 0)
  };

  if (profile.diagnosticToken) {
    flag.diagnosticToken = String(profile.diagnosticToken);
  }
  if (profile.initializedFrom && typeof profile.initializedFrom === "object") {
    flag.initializedFrom = { ...profile.initializedFrom };
  }
  return flag;
}

function cloneDurabilityFlag(flag = {}) {
  const nextFlag = {
    ...flag,
    hp: { ...(flag?.hp ?? {}) }
  };
  if (flag?.initializedFrom && typeof flag.initializedFrom === "object") {
    nextFlag.initializedFrom = { ...flag.initializedFrom };
  }
  return nextFlag;
}

function ignoredTransition(flag) {
  return {
    outcome: "ignored",
    nextFlag: cloneDurabilityFlag(flag),
    appliedDamage: 0
  };
}

export function applyDurabilityDamage(flag, { amount, damageType } = {}) {
  const damage = Number(amount);
  const normalizedDamageType = normalizeToken(damageType);
  if (!flag || flag.eligible === false || flag.state === "destroyed") {
    return ignoredTransition(flag);
  }
  if (!Number.isFinite(damage) || damage <= 0 || IMMUNE_DAMAGE_TYPES.has(normalizedDamageType)) {
    return ignoredTransition(flag);
  }

  const threshold = Math.max(0, Number(flag.damageThreshold) || 0);
  if (damage <= threshold) {
    return ignoredTransition(flag);
  }

  const currentHp = Math.max(0, Number(flag?.hp?.value) || 0);
  const maxHp = Math.max(0, Number(flag?.hp?.max) || 0);
  if (currentHp <= 0) {
    return ignoredTransition(flag);
  }
  const remainingHp = Math.max(0, currentHp - damage);
  const appliedDamage = currentHp - remainingHp;
  const nextFlag = cloneDurabilityFlag(flag);

  if (remainingHp > 0) {
    nextFlag.hp.value = remainingHp;
    nextFlag.hp.max = maxHp;
    return { outcome: "damaged", nextFlag, appliedDamage };
  }

  nextFlag.hp = { value: 0, max: maxHp };
  return { outcome: "depleted", nextFlag, appliedDamage };
}

export function markDurabilityBroken(flag) {
  if (!flag || flag.eligible === false || ["broken", "destroyed"].includes(normalizeToken(flag.state))) {
    return ignoredTransition(flag);
  }
  const nextFlag = cloneDurabilityFlag(flag);
  const maxHp = Math.max(0, Number(nextFlag?.hp?.max) || 0);
  nextFlag.state = "broken";
  nextFlag.breakStage = 1;
  nextFlag.hp = { value: 0, max: maxHp };
  return { outcome: "broken", nextFlag, appliedDamage: 0 };
}

export function markDurabilityDestroyed(flag) {
  if (!flag || flag.eligible === false) {
    return ignoredTransition(flag);
  }
  if (normalizeToken(flag.state) === "destroyed") {
    return { outcome: "destroyed", nextFlag: cloneDurabilityFlag(flag), appliedDamage: 0 };
  }
  const nextFlag = cloneDurabilityFlag(flag);
  const maxHp = Math.max(0, Number(nextFlag?.hp?.max) || 0);
  nextFlag.state = "destroyed";
  nextFlag.breakStage = 2;
  nextFlag.hp = { value: 0, max: maxHp };
  return { outcome: "destroyed", nextFlag, appliedDamage: 0 };
}

export function buildDurabilitySignature(flag = {}) {
  return JSON.stringify({
    version: Number(flag.version) || 1,
    eligible: flag.eligible !== false,
    state: normalizeToken(flag.state),
    breakStage: Math.max(0, Number(flag.breakStage) || 0),
    materialProfile: recognizedMaterialProfile(flag.materialProfile),
    construction: recognizedConstruction(flag.construction),
    size: recognizedSize(flag.size),
    hpValue: Math.max(0, Number(flag?.hp?.value) || 0),
    hpMax: Math.max(0, Number(flag?.hp?.max) || 0),
    ac: Math.max(0, Number(flag.ac) || 0),
    damageThreshold: Math.max(0, Number(flag.damageThreshold) || 0)
  });
}
