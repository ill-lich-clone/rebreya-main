const BACK_SLOTS = ["back1", "back2", "back3", "back4", "back5"];
const HAND_SLOTS = ["leftHand", "rightHand"];
const RING_SLOTS = ["ring1", "ring2"];

const HERO_DOLL_SLOTS = [
  { id: "head", label: "Голова" },
  { id: "neck", label: "Шея" },
  { id: "shoulders", label: "Плечи" },
  { id: "chest", label: "Грудь" },
  { id: "belt", label: "Пояс" },
  { id: "legs", label: "Ноги" },
  { id: "bracers", label: "Наручи" },
  { id: "leftHand", label: "Рука" },
  { id: "rightHand", label: "Рука" },
  { id: "ring1", label: "Кольцо 1" },
  { id: "ring2", label: "Кольцо 2" },
  { id: "back1", label: "Спина 1" },
  { id: "back2", label: "Спина 2" },
  { id: "back3", label: "Спина 3" },
  { id: "back4", label: "Спина 4" },
  { id: "back5", label: "Спина 5" }
];

const HERO_DOLL_SLOT_GROUPS = [
  { id: "head", label: "Голова", slotIds: ["head"] },
  { id: "neck", label: "Шея", slotIds: ["neck"] },
  { id: "shoulders", label: "Плечи", slotIds: ["shoulders"] },
  { id: "bracers", label: "Наручи", slotIds: ["bracers"] },
  { id: "hand", label: "Рука", slotIds: [...HAND_SLOTS] },
  { id: "chest", label: "Грудь", slotIds: ["chest"] },
  { id: "belt", label: "Пояс", slotIds: ["belt"] },
  { id: "legs", label: "Ноги", slotIds: ["legs"] },
  { id: "ring", label: "Кольцо", slotIds: [...RING_SLOTS] },
  { id: "back", label: "Спина", slotIds: [...BACK_SLOTS] }
];

const NATIVE_DND5E_WEAPON_BASE_ITEMS = new Set([
  "battleaxe",
  "blowgun",
  "club",
  "dagger",
  "dart",
  "flail",
  "glaive",
  "greataxe",
  "greatclub",
  "greatsword",
  "halberd",
  "handaxe",
  "handcrossbow",
  "heavycrossbow",
  "javelin",
  "lance",
  "lightcrossbow",
  "lighthammer",
  "longbow",
  "longsword",
  "mace",
  "maul",
  "morningstar",
  "musket",
  "pike",
  "pistol",
  "quarterstaff",
  "rapier",
  "scimitar",
  "shortbow",
  "shortsword",
  "sickle",
  "sling",
  "spear",
  "trident",
  "warhammer",
  "warpick",
  "whip"
]);

const REBREYA_ORDINARY_WEAPON_PROFILES = [
  { names: ["Боевой посох"], gearId: "boevoy-posokh", baseItem: "quarterstaff", systemTypeValue: "simpleM" },
  { names: ["Булава"], gearId: "bulava", baseItem: "mace", systemTypeValue: "simpleM" },
  { names: ["Дубинка"], gearId: "dubinka", baseItem: "club", systemTypeValue: "simpleM" },
  { names: ["Кинжал"], gearId: "kinzhal", baseItem: "dagger", systemTypeValue: "simpleM" },
  { names: ["Копье", "Копьё"], gearId: "kop-e", baseItem: "spear", systemTypeValue: "simpleM" },
  { names: ["Лёгкий молот", "Легкий молот"], gearId: "lyogkiy-molot", baseItem: "lighthammer", systemTypeValue: "simpleM" },
  { names: ["Палица"], gearId: "palitsa", baseItem: "greatclub", systemTypeValue: "simpleM" },
  { names: ["Коса"], gearId: "kosa", baseItem: "kosa", systemTypeValue: "simpleM" },
  { names: ["Кастет"], gearId: "kastet", baseItem: "kastet", systemTypeValue: "simpleM" },
  { names: ["Ручной топор"], gearId: "ruchnoy-topor", baseItem: "handaxe", systemTypeValue: "simpleM" },
  { names: ["Серп"], gearId: "serp", baseItem: "sickle", systemTypeValue: "simpleM" },
  { names: ["Арбалет, легкий", "Арбалет, лёгкий", "Легкий арбалет", "Лёгкий арбалет"], gearId: "arbalet-legkiy", baseItem: "lightcrossbow", systemTypeValue: "simpleR" },
  { names: ["Дротик"], gearId: "drotik", baseItem: "dart", systemTypeValue: "simpleR" },
  { names: ["Короткий лук"], gearId: "korotkiy-luk", baseItem: "shortbow", systemTypeValue: "simpleR" },
  { names: ["Праща"], gearId: "prashcha", baseItem: "sling", systemTypeValue: "simpleR" },
  { names: ["Алебарда"], gearId: "alebarda", baseItem: "halberd", systemTypeValue: "martialM" },
  { names: ["Боевая кирка"], gearId: "boevaya-kirka", baseItem: "warpick", systemTypeValue: "martialM" },
  { names: ["Боевой молот"], gearId: "boevoy-molot", baseItem: "warhammer", systemTypeValue: "martialM" },
  { names: ["Глефа"], gearId: "glefa", baseItem: "glaive", systemTypeValue: "martialM" },
  { names: ["Двуручный меч"], gearId: "dvuruchnyy-mech", baseItem: "greatsword", systemTypeValue: "martialM" },
  { names: ["Кавалерийская пика", "Копьё всадника", "Копье всадника"], gearId: "kavaleriyskaya-pika", baseItem: "lance", systemTypeValue: "martialM" },
  { names: ["Длинный меч"], gearId: "dlinnyy-mech", baseItem: "longsword", systemTypeValue: "martialM" },
  { names: ["Кнут"], gearId: "knut", baseItem: "whip", systemTypeValue: "martialM" },
  { names: ["Короткий меч"], gearId: "korotkiy-mech", baseItem: "shortsword", systemTypeValue: "martialM" },
  { names: ["Молот"], gearId: "molot", baseItem: "maul", systemTypeValue: "martialM" },
  { names: ["Моргенштерн"], gearId: "morgenshtern", baseItem: "morningstar", systemTypeValue: "martialM" },
  { names: ["Пика"], gearId: "pika", baseItem: "pike", systemTypeValue: "martialM" },
  { names: ["Рапира"], gearId: "rapira", baseItem: "rapier", systemTypeValue: "martialM" },
  { names: ["Секира"], gearId: "sekira", baseItem: "greataxe", systemTypeValue: "martialM" },
  { names: ["Скимитар"], gearId: "skimitar", baseItem: "scimitar", systemTypeValue: "martialM" },
  { names: ["Трезубец"], gearId: "trezubets", baseItem: "trident", systemTypeValue: "martialM" },
  { names: ["Цеп"], gearId: "tsep", baseItem: "flail", systemTypeValue: "martialM" },
  { names: ["Цепь"], gearId: "gear-2", baseItem: "tsep-chain", systemTypeValue: "martialM" },
  { names: ["Палаш"], gearId: "palash", baseItem: "palash", systemTypeValue: "martialM" },
  { names: ["Сабля"], gearId: "sablya", baseItem: "sablya", systemTypeValue: "martialM" },
  { names: ["Катана"], gearId: "katana", baseItem: "katana", systemTypeValue: "martialM" },
  { names: ["Эсток"], gearId: "estok", baseItem: "estok", systemTypeValue: "martialM" },
  { names: ["Боевая коса"], gearId: "boevaya-kosa", baseItem: "boevaya-kosa", systemTypeValue: "martialM" },
  { names: ["Двусторонний топор"], gearId: "dvustoronniy-topor", baseItem: "dvustoronniy-topor", systemTypeValue: "martialM" },
  { names: ["Костяной топор"], gearId: "kostyanoy-topor", baseItem: "kostyanoy-topor", systemTypeValue: "martialM" },
  { names: ["Молот всадника"], gearId: "molot-vsadnika", baseItem: "molot-vsadnika", systemTypeValue: "martialM" },
  { names: ["Двусторонний молот"], gearId: "dvustoronniy-molot", baseItem: "dvustoronniy-molot", systemTypeValue: "martialM" },
  { names: ["Кинжал на цепи"], gearId: "kinzhal-na-tsepi", baseItem: "kinzhal-na-tsepi", systemTypeValue: "martialM" },
  { names: ["Длинная булава"], gearId: "dlinnaya-bulava", baseItem: "dlinnaya-bulava", systemTypeValue: "martialM" },
  { names: ["Цепной серп"], gearId: "tsepnoy-serp", baseItem: "tsepnoy-serp", systemTypeValue: "martialM" },
  { names: ["Меч палача"], gearId: "mech-palacha", baseItem: "mech-palacha", systemTypeValue: "martialM" },
  { names: ["Металлическая перчатка"], gearId: "metallicheskaya-perchatka", baseItem: "metallicheskaya-perchatka", systemTypeValue: "martialM" },
  { names: ["Шамшир"], gearId: "shamshir", baseItem: "shamshir", systemTypeValue: "martialM" },
  { names: ["Боевой топор"], gearId: "boevoy-topor", baseItem: "battleaxe", systemTypeValue: "martialM" },
  { names: ["Арбалет, ручной", "Ручной арбалет"], gearId: "arbalet-ruchnoy", baseItem: "handcrossbow", systemTypeValue: "martialR" },
  { names: ["Арбалет, тяжелый", "Арбалет, тяжёлый", "Тяжелый арбалет", "Тяжёлый арбалет"], gearId: "arbalet-tyazhelyy", baseItem: "heavycrossbow", systemTypeValue: "martialR" },
  { names: ["Длинный лук"], gearId: "dlinnyy-luk", baseItem: "longbow", systemTypeValue: "martialR" },
  { names: ["Духовая трубка"], gearId: "dukhovaya-trubka", baseItem: "blowgun", systemTypeValue: "martialR" },
  { names: ["Сеть"], gearId: "set", baseItem: "set", systemTypeValue: "martialR" },
  { names: ["Лук всадника"], gearId: "luk-vsadnika", baseItem: "luk-vsadnika", systemTypeValue: "martialR" },
  { names: ["Композитный лук"], gearId: "kompozitnyy-luk", baseItem: "kompozitnyy-luk", systemTypeValue: "martialR" },
  { names: ["Многозарядный арбалет"], gearId: "mnogozaryadnyy-arbalet", baseItem: "mnogozaryadnyy-arbalet", systemTypeValue: "martialR" }
];

const REBREYA_ORDINARY_WEAPON_PROFILE_BY_NAME = new Map();
for (const profile of REBREYA_ORDINARY_WEAPON_PROFILES) {
  for (const name of profile.names) {
    REBREYA_ORDINARY_WEAPON_PROFILE_BY_NAME.set(normalizeNameKey(name), profile);
  }
}

const SLOT_ALIAS_MAP = new Map([
  ["head", ["head"]],
  ["голова", ["head"]],
  ["neck", ["neck"]],
  ["шея", ["neck"]],
  ["shoulders", ["shoulders"]],
  ["плечи", ["shoulders"]],
  ["chest", ["chest"]],
  ["грудь", ["chest"]],
  ["тело", ["chest"]],
  ["belt", ["belt"]],
  ["пояс", ["belt"]],
  ["legs", ["legs"]],
  ["ноги", ["legs"]],
  ["bracers", ["bracers"]],
  ["наручи", ["bracers"]],
  ["браслеты", ["bracers"]],
  ["браслет", ["bracers"]],
  ["gloves", ["bracers"]],
  ["перчатки", ["bracers"]],
  ["рукавицы", ["bracers"]],
  ["left hand", ["leftHand"]],
  ["левая рука", ["leftHand"]],
  ["lefthand", ["leftHand"]],
  ["right hand", ["rightHand"]],
  ["правая рука", ["rightHand"]],
  ["righthand", ["rightHand"]],
  ["hand", HAND_SLOTS],
  ["hands", HAND_SLOTS],
  ["рука", HAND_SLOTS],
  ["руки", HAND_SLOTS],
  ["ring", RING_SLOTS],
  ["кольцо", RING_SLOTS],
  ["ring1", ["ring1"]],
  ["кольцо 1", ["ring1"]],
  ["ring2", ["ring2"]],
  ["кольцо 2", ["ring2"]],
  ["back", BACK_SLOTS],
  ["спина", BACK_SLOTS],
  ["back1", ["back1"]],
  ["спина 1", ["back1"]],
  ["back2", ["back2"]],
  ["спина 2", ["back2"]],
  ["back3", ["back3"]],
  ["спина 3", ["back3"]],
  ["back4", ["back4"]],
  ["спина 4", ["back4"]],
  ["back5", ["back5"]],
  ["спина 5", ["back5"]]
]);

const SLOT_GROUP_ALIAS_MAP = new Map([
  ["head", "head"],
  ["голова", "head"],
  ["neck", "neck"],
  ["шея", "neck"],
  ["shoulders", "shoulders"],
  ["плечи", "shoulders"],
  ["hand", "hand"],
  ["hands", "hand"],
  ["рука", "hand"],
  ["руки", "hand"],
  ["left hand", "hand"],
  ["lefthand", "hand"],
  ["right hand", "hand"],
  ["righthand", "hand"],
  ["bracers", "bracers"],
  ["наручи", "bracers"],
  ["перчатки", "bracers"],
  ["chest", "chest"],
  ["грудь", "chest"],
  ["body", "chest"],
  ["belt", "belt"],
  ["пояс", "belt"],
  ["legs", "legs"],
  ["ноги", "legs"],
  ["ring", "ring"],
  ["кольцо", "ring"],
  ["ring1", "ring"],
  ["кольцо 1", "ring"],
  ["ring2", "ring"],
  ["кольцо 2", "ring"],
  ["back", "back"],
  ["спина", "back"],
  ["back1", "back"],
  ["спина 1", "back"],
  ["back2", "back"],
  ["спина 2", "back"],
  ["back3", "back"],
  ["спина 3", "back"],
  ["back4", "back"],
  ["спина 4", "back"],
  ["back5", "back"],
  ["спина 5", "back"],
  ["—", ""],
  ["none", ""],
  ["нет", ""]
]);

const SIMPLE_MELEE_WEAPON_MAP = new Map([
  ["боевой посох", { baseItem: "quarterstaff", systemTypeValue: "simpleM" }],
  ["булава", { baseItem: "mace", systemTypeValue: "simpleM" }],
  ["дубинка", { baseItem: "club", systemTypeValue: "simpleM" }],
  ["кинжал", { baseItem: "dagger", systemTypeValue: "simpleM" }],
  ["копье", { baseItem: "spear", systemTypeValue: "simpleM" }],
  ["лёгкий молот", { baseItem: "lighthammer", systemTypeValue: "simpleM" }],
  ["легкий молот", { baseItem: "lighthammer", systemTypeValue: "simpleM" }],
  ["палица", { baseItem: "greatclub", systemTypeValue: "simpleM" }],
  ["серп", { baseItem: "sickle", systemTypeValue: "simpleM" }],
  ["ручной топор", { baseItem: "handaxe", systemTypeValue: "simpleM" }],
  ["дротик", { baseItem: "dart", systemTypeValue: "simpleR" }],
  ["духовая трубка", { baseItem: "blowgun", systemTypeValue: "simpleR" }],
  ["короткий лук", { baseItem: "shortbow", systemTypeValue: "simpleR" }],
  ["лёгкий арбалет", { baseItem: "lightcrossbow", systemTypeValue: "simpleR" }],
  ["легкий арбалет", { baseItem: "lightcrossbow", systemTypeValue: "simpleR" }],
  ["арбалет, легкий", { baseItem: "lightcrossbow", systemTypeValue: "simpleR" }],
  ["праща", { baseItem: "sling", systemTypeValue: "simpleR" }]
]);

const MARTIAL_WEAPON_MAP = new Map([
  ["алебарда", { baseItem: "halberd", systemTypeValue: "martialM" }],
  ["боевая кирка", { baseItem: "warpick", systemTypeValue: "martialM" }],
  ["боевой топор", { baseItem: "battleaxe", systemTypeValue: "martialM" }],
  ["глефа", { baseItem: "glaive", systemTypeValue: "martialM" }],
  ["двуручный меч", { baseItem: "greatsword", systemTypeValue: "martialM" }],
  ["длинное копьё", { baseItem: "pike", systemTypeValue: "martialM" }],
  ["длинное копье", { baseItem: "pike", systemTypeValue: "martialM" }],
  ["пика", { baseItem: "pike", systemTypeValue: "martialM" }],
  ["длинный лук", { baseItem: "longbow", systemTypeValue: "martialR" }],
  ["длинный меч", { baseItem: "longsword", systemTypeValue: "martialM" }],
  ["кистень", { baseItem: "flail", systemTypeValue: "martialM" }],
  ["короткий меч", { baseItem: "shortsword", systemTypeValue: "martialM" }],
  ["кнут", { baseItem: "whip", systemTypeValue: "martialM" }],
  ["копьё всадника", { baseItem: "lance", systemTypeValue: "martialM" }],
  ["молот", { baseItem: "maul", systemTypeValue: "martialM" }],
  ["моргенштерн", { baseItem: "morningstar", systemTypeValue: "martialM" }],
  ["палаш", { baseItem: "longsword", systemTypeValue: "martialM" }],
  ["рапира", { baseItem: "rapier", systemTypeValue: "martialM" }],
  ["ручной арбалет", { baseItem: "handcrossbow", systemTypeValue: "martialR" }],
  ["арбалет, ручной", { baseItem: "handcrossbow", systemTypeValue: "martialR" }],
  ["секира", { baseItem: "greataxe", systemTypeValue: "martialM" }],
  ["скимитар", { baseItem: "scimitar", systemTypeValue: "martialM" }],
  ["трезубец", { baseItem: "trident", systemTypeValue: "martialM" }],
  ["тяжёлый арбалет", { baseItem: "heavycrossbow", systemTypeValue: "martialR" }],
  ["тяжелый арбалет", { baseItem: "heavycrossbow", systemTypeValue: "martialR" }],
  ["арбалет, тяжелый", { baseItem: "heavycrossbow", systemTypeValue: "martialR" }],
  ["цеп", { baseItem: "flail", systemTypeValue: "martialM" }],
  ["шпага", { baseItem: "rapier", systemTypeValue: "martialM" }],
  ["боевой молот", { baseItem: "warhammer", systemTypeValue: "martialM" }]
]);

const LIGHT_ARMOR_MAP = new Map([
  ["стёганый доспех", { baseItem: "padded" }],
  ["стеганый доспех", { baseItem: "padded" }],
  ["кожаный доспех", { baseItem: "leather" }],
  ["проклёпанный кожаный доспех", { baseItem: "studded" }],
  ["проклепанный кожаный доспех", { baseItem: "studded" }]
]);

const MEDIUM_ARMOR_MAP = new Map([
  ["шкурный доспех", { baseItem: "hide" }],
  ["кольчужная рубаха", { baseItem: "chainshirt" }],
  ["защитная рубашка", { baseItem: "chainshirt" }],
  ["чешуйчатый доспех", { baseItem: "scalemail" }],
  ["кираса", { baseItem: "breastplate" }],
  ["полулаты", { baseItem: "halfplate" }]
]);

const HEAVY_ARMOR_MAP = new Map([
  ["кольчуга", { baseItem: "chainmail" }],
  ["латы", { baseItem: "plate" }]
]);

function normalizeText(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/\u0451/gu, "\u0435")
    .replace(/["'`«»]/gu, "")
    .replace(/\s+/gu, " ");
}

function unique(values = []) {
  return Array.from(new Set(values.filter(Boolean)));
}

function splitList(value) {
  if (Array.isArray(value)) {
    return value.flatMap((entry) => splitList(entry));
  }

  return String(value ?? "")
    .split(/[;,|/]+/u)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function normalizeNameKey(value) {
  return normalizeText(value);
}

function getHeroDollSlotGroupConfig(slotGroup) {
  return HERO_DOLL_SLOT_GROUPS.find((entry) => entry.id === slotGroup) ?? null;
}

function normalizeSlotGroupToken(value) {
  return normalizeNameKey(value).replace(/\s+/gu, " ");
}

export function normalizeHeroDollSlotGroup(value, fallback = "") {
  if (Array.isArray(value)) {
    return inferHeroDollSlotGroupFromSlots(value, fallback);
  }

  const token = normalizeSlotGroupToken(value);
  if (!token) {
    return fallback;
  }

  const direct = SLOT_GROUP_ALIAS_MAP.get(token);
  if (direct !== undefined) {
    return direct;
  }

  const slotIds = SLOT_ALIAS_MAP.get(token) ?? [];
  if (slotIds.length) {
    return inferHeroDollSlotGroupFromSlots(slotIds, fallback);
  }

  return fallback;
}

export function mapSlotGroupToHeroDollSlots(slotGroup, fallback = []) {
  const normalizedGroup = normalizeHeroDollSlotGroup(slotGroup, "");
  if (!normalizedGroup) {
    return unique(fallback);
  }

  const group = getHeroDollSlotGroupConfig(normalizedGroup);
  return unique(group?.slotIds ?? fallback);
}

export function inferHeroDollSlotGroupFromSlots(slotIds, fallback = "") {
  const normalizedSlots = normalizeHeroDollSlots(slotIds, []);
  if (!normalizedSlots.length) {
    return fallback;
  }

  const set = new Set(normalizedSlots);
  if (set.has("head")) {
    return "head";
  }

  if (set.has("neck")) {
    return "neck";
  }

  if (set.has("shoulders")) {
    return "shoulders";
  }

  if (set.has("chest")) {
    return "chest";
  }

  if (set.has("belt")) {
    return "belt";
  }

  if (set.has("legs")) {
    return "legs";
  }

  if (set.has("bracers")) {
    return "bracers";
  }

  if (set.has("ring1") || set.has("ring2")) {
    return "ring";
  }

  if (set.has("leftHand") || set.has("rightHand")) {
    return "hand";
  }

  if (Array.from(set).some((slotId) => slotId.startsWith("back"))) {
    return "back";
  }

  return fallback;
}

function buildHeroDollSlots(rawValue, fallback = []) {
  const explicit = splitList(rawValue)
    .flatMap((entry) => SLOT_ALIAS_MAP.get(normalizeNameKey(entry)) ?? [])
    .filter(Boolean);
  return unique(explicit.length ? explicit : fallback);
}

function isBackItem(name) {
  const text = normalizeText(name);
  return /рюкзак|ранец|колчан|ножн|футляр|чехол|спинн|плащ|пальто|мантия|накид|щит/u.test(text);
}

function inferSlotsFromName(name, fallback = []) {
  const text = normalizeText(name);

  if (/кольц/u.test(text)) {
    return [...RING_SLOTS];
  }

  if (/амулет|ожерел|кулон|подвес|медальон/u.test(text)) {
    return ["neck"];
  }

  if (/шлем|шляп|маск|корон|тиар|венок|визор|капюш/u.test(text)) {
    return ["head"];
  }

  if (/плащ|мантия|накид|пальто|шаль|пелерин/u.test(text)) {
    return ["shoulders"];
  }

  if (/наруч|браслет|рукавиц|перчат|обмотк/u.test(text)) {
    return ["bracers"];
  }

  if (/пояс|ремень|портуп/u.test(text)) {
    return ["belt"];
  }

  if (/сапог|ботин|обув|понож|штаны|брюк/u.test(text)) {
    return ["legs"];
  }

  if (/доспех|брон|кирас|латы|рубах|жилет|одежд|куртк|нагруд|мундир/u.test(text)) {
    return ["chest"];
  }

  if (/жезл|палоч|посох|щит|книг|гримуар|сфера|фокус/u.test(text)) {
    return [...HAND_SLOTS, ...BACK_SLOTS];
  }

  if (isBackItem(text)) {
    return [...BACK_SLOTS];
  }

  return fallback;
}

export function inferHeroDollSlotsFromName(name, fallback = []) {
  return inferSlotsFromName(name, fallback);
}

function buildWeaponProfile(name, fallbackBaseItem = "") {
  const text = normalizeNameKey(name);
  const rebreyaWeapon = REBREYA_ORDINARY_WEAPON_PROFILE_BY_NAME.get(text);
  if (rebreyaWeapon) {
    return {
      systemTypeValue: rebreyaWeapon.systemTypeValue,
      baseItem: rebreyaWeapon.baseItem,
      heroDollSlots: [...HAND_SLOTS, ...BACK_SLOTS]
    };
  }

  const simple = SIMPLE_MELEE_WEAPON_MAP.get(text);
  if (simple) {
    return {
      systemTypeValue: simple.systemTypeValue,
      baseItem: simple.baseItem,
      heroDollSlots: [...HAND_SLOTS, ...BACK_SLOTS]
    };
  }

  const martial = MARTIAL_WEAPON_MAP.get(text);
  if (martial) {
    return {
      systemTypeValue: martial.systemTypeValue,
      baseItem: martial.baseItem,
      heroDollSlots: [...HAND_SLOTS, ...BACK_SLOTS]
    };
  }

  if (/лук|арбалет|пращ|дротик|трубк/u.test(text)) {
    return {
      systemTypeValue: "martialR",
      baseItem: fallbackBaseItem,
      heroDollSlots: [...HAND_SLOTS, ...BACK_SLOTS]
    };
  }

  return {
    systemTypeValue: "martialM",
    baseItem: fallbackBaseItem,
    heroDollSlots: [...HAND_SLOTS, ...BACK_SLOTS]
  };
}

function buildArmorProfile(name) {
  const text = normalizeNameKey(name);

  if (/щит/u.test(text)) {
    return {
      systemTypeValue: "shield",
      baseItem: text === "щит" ? "shield" : "",
      heroDollSlots: [...HAND_SLOTS, ...BACK_SLOTS]
    };
  }

  const light = LIGHT_ARMOR_MAP.get(text);
  if (light) {
    return {
      systemTypeValue: "light",
      baseItem: light.baseItem,
      heroDollSlots: ["chest"]
    };
  }

  const medium = MEDIUM_ARMOR_MAP.get(text);
  if (medium) {
    return {
      systemTypeValue: "medium",
      baseItem: medium.baseItem,
      heroDollSlots: ["chest"]
    };
  }

  const heavy = HEAVY_ARMOR_MAP.get(text);
  if (heavy) {
    return {
      systemTypeValue: "heavy",
      baseItem: heavy.baseItem,
      heroDollSlots: ["chest"]
    };
  }

  return {
    systemTypeValue: "heavy",
    baseItem: "",
    heroDollSlots: ["chest"]
  };
}

function buildFirearmProfile(name, firearmClass = "", fallbackBaseItem = "") {
  const text = normalizeText(name);
  const normalizedClass = firearmClass === "advanced"
    ? "advanced"
    : (firearmClass === "primitive" ? "primitive" : (
      /кремнев|мушкет|аркебуз|колесц|мушкетон|драгун|дерриндж/u.test(text)
        ? "primitive"
        : "advanced"
    ));
  const baseItem = /мушкет/u.test(text)
    ? "musket"
    : (/пистолет/u.test(text) ? "pistol" : fallbackBaseItem);

  return {
    firearmClass: normalizedClass,
    systemTypeValue: normalizedClass === "primitive" ? "firearmPrimitive" : "firearmAdvanced",
    baseItem,
    heroDollSlots: [...HAND_SLOTS, ...BACK_SLOTS]
  };
}

function buildConsumableAmmoProfile(name) {
  const text = normalizeText(name);

  if (/стрел/u.test(text)) {
    return { systemTypeValue: "ammo", systemTypeSubtype: "arrow" };
  }

  if (/болт/u.test(text)) {
    return { systemTypeValue: "ammo", systemTypeSubtype: "crossbowBolt" };
  }

  if (/игл/u.test(text) && /трубк/u.test(text)) {
    return { systemTypeValue: "ammo", systemTypeSubtype: "blowgunNeedle" };
  }

  if (/пращ/u.test(text)) {
    return { systemTypeValue: "ammo", systemTypeSubtype: "slingBullet" };
  }

  if (/патрон|пул|обойм/u.test(text)) {
    return { systemTypeValue: "ammo", systemTypeSubtype: "firearmBullet" };
  }

  return null;
}

function buildToolProfile(name) {
  const text = normalizeText(name);
  if (/лютн|флейт|барабан|скрип|цитр|арф|мандол|рожок|волын|инструмент музы/u.test(text)) {
    return { systemTypeValue: "music" };
  }

  if (/кости|карты|шахмат|кости|набор.*игр/u.test(text)) {
    return { systemTypeValue: "game" };
  }

  if (/транспорт|экипаж|повоз|седло/u.test(text)) {
    return { systemTypeValue: "vehicle" };
  }

  return { systemTypeValue: "art" };
}

export function getHeroDollSlots() {
  return HERO_DOLL_SLOTS.map((slot) => ({
    ...slot,
    area: slot.area ?? slot.id
  }));
}

export function getHeroDollBackSlots() {
  return [...BACK_SLOTS];
}

export function getHeroDollSlotGroups() {
  return HERO_DOLL_SLOT_GROUPS.map((group) => ({
    ...group,
    slotIds: [...group.slotIds]
  }));
}

export function buildSlug(value, fallback = "entry") {
  return normalizeText(value)
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-|-$/gu, "")
    || fallback;
}

export function getRebreyaWeaponBaseItemDefinitions() {
  return REBREYA_ORDINARY_WEAPON_PROFILES
    .filter((profile) => !NATIVE_DND5E_WEAPON_BASE_ITEMS.has(profile.baseItem))
    .map((profile) => ({
      baseItem: profile.baseItem,
      gearId: profile.gearId,
      name: profile.names[0],
      systemTypeValue: profile.systemTypeValue
    }));
}

export function normalizeHeroDollSlots(value, fallback = []) {
  return buildHeroDollSlots(value, fallback);
}

export function classifyGearEntry(item = {}) {
  const equipmentType = String(item.equipmentType ?? item.foundryFolder ?? "").trim();
  const normalizedEquipmentType = normalizeText(equipmentType);
  const explicitSlots = normalizeHeroDollSlots(item.heroDollSlots ?? item.foundryHeroDollSlots ?? item.itemSlot);
  const explicitFolder = String(item.foundryFolder ?? "").trim();
  const explicitType = String(item.foundryType ?? "").trim().toLowerCase();
  const explicitSubtype = String(item.foundrySubtype ?? "").trim();
  const explicitSubtypeExtra = String(item.foundrySubtypeExtra ?? "").trim();
  const explicitBaseItem = String(item.foundryBaseItem ?? "").trim();
  const explicitFirearmClass = normalizeText(item.firearmClass ?? "");

  if (explicitType) {
    const fallbackSlots = inferSlotsFromName(item.name, explicitType === "weapon" ? [...HAND_SLOTS, ...BACK_SLOTS] : []);
    return {
      documentType: explicitType,
      systemTypeValue: explicitType === "loot"
        ? (explicitSubtype || "gear")
        : (explicitType === "consumable"
          ? (explicitSubtype || "potion")
          : explicitSubtype),
      systemTypeSubtype: (explicitType === "loot" || explicitType === "consumable")
        ? explicitSubtypeExtra
        : "",
      baseItem: explicitBaseItem,
      folderPath: explicitFolder || equipmentType || "Прочее",
      heroDollSlots: buildHeroDollSlots(explicitSlots, fallbackSlots),
      firearmClass: explicitFirearmClass,
      sourceCategory: equipmentType || "Прочее"
    };
  }

  if (normalizedEquipmentType === normalizeText("Оружие")) {
    const weaponProfile = buildWeaponProfile(item.name, item.id);
    return {
      documentType: "weapon",
      systemTypeValue: weaponProfile.systemTypeValue,
      systemTypeSubtype: "",
      baseItem: weaponProfile.baseItem,
      folderPath: "Оружие",
      heroDollSlots: buildHeroDollSlots(explicitSlots, weaponProfile.heroDollSlots),
      firearmClass: "",
      sourceCategory: "Оружие"
    };
  }

  if (normalizedEquipmentType === normalizeText("Огнестрельное оружие")) {
    const firearmProfile = buildFirearmProfile(item.name, explicitFirearmClass, item.id);
    return {
      documentType: "weapon",
      systemTypeValue: firearmProfile.systemTypeValue,
      systemTypeSubtype: "",
      baseItem: firearmProfile.baseItem,
      folderPath: `Огнестрельное оружие/${firearmProfile.firearmClass === "primitive" ? "Примитивное" : "Продвинутое"}`,
      heroDollSlots: buildHeroDollSlots(explicitSlots, firearmProfile.heroDollSlots),
      firearmClass: firearmProfile.firearmClass,
      sourceCategory: "Огнестрельное оружие"
    };
  }

  if (normalizedEquipmentType === normalizeText("Доспех")) {
    const armorProfile = buildArmorProfile(item.name);
    return {
      documentType: "equipment",
      systemTypeValue: armorProfile.systemTypeValue,
      systemTypeSubtype: "",
      baseItem: armorProfile.baseItem,
      folderPath: "Доспех",
      heroDollSlots: buildHeroDollSlots(explicitSlots, armorProfile.heroDollSlots),
      firearmClass: "",
      sourceCategory: "Доспех"
    };
  }

  if (normalizedEquipmentType === normalizeText("Инструменты")) {
    const toolProfile = buildToolProfile(item.name);
    return {
      documentType: "tool",
      systemTypeValue: toolProfile.systemTypeValue,
      systemTypeSubtype: "",
      baseItem: "",
      folderPath: "Инструменты",
      heroDollSlots: [],
      firearmClass: "",
      sourceCategory: "Инструменты"
    };
  }

  if (normalizedEquipmentType === normalizeText("Зелье")) {
    return {
      documentType: "consumable",
      systemTypeValue: "potion",
      systemTypeSubtype: "",
      baseItem: "",
      folderPath: "Зелье",
      heroDollSlots: [],
      firearmClass: "",
      sourceCategory: "Зелье"
    };
  }

  if ((normalizedEquipmentType === normalizeText("Снаряжение")) || !normalizedEquipmentType) {
    const ammoProfile = buildConsumableAmmoProfile(item.name);
    if (ammoProfile) {
      return {
        documentType: "consumable",
        systemTypeValue: ammoProfile.systemTypeValue,
        systemTypeSubtype: ammoProfile.systemTypeSubtype,
        baseItem: "",
        folderPath: equipmentType || "Боеприпасы",
        heroDollSlots: [],
        firearmClass: "",
        sourceCategory: equipmentType || "Боеприпасы"
      };
    }
  }

  if (normalizedEquipmentType === normalizeText("Обвес")) {
    return {
      documentType: "loot",
      systemTypeValue: "gear",
      systemTypeSubtype: "attachment",
      baseItem: "",
      folderPath: "Снаряжение/Обвес",
      heroDollSlots: [],
      firearmClass: "",
      sourceCategory: "Обвес"
    };
  }

  if (normalizedEquipmentType === normalizeText("Скакуны и транспорт")) {
    return {
      documentType: "loot",
      systemTypeValue: "gear",
      systemTypeSubtype: "",
      baseItem: "",
      folderPath: "Скакуны и транспорт",
      heroDollSlots: [],
      firearmClass: "",
      sourceCategory: "Скакуны и транспорт"
    };
  }

  return {
    documentType: "loot",
    systemTypeValue: "gear",
    systemTypeSubtype: "",
    baseItem: "",
    folderPath: "Снаряжение",
    heroDollSlots: buildHeroDollSlots(explicitSlots, inferSlotsFromName(item.name, isBackItem(item.name) ? [...BACK_SLOTS] : [])),
    firearmClass: "",
    sourceCategory: equipmentType || "Снаряжение"
  };
}

function normalizeMagicConsumableType(item) {
  const text = normalizeText(item.name);
  if (/стрел|болт|боеприпас|патрон|пуля|обойм/u.test(text)) {
    return buildConsumableAmmoProfile(item.name) ?? { systemTypeValue: "ammo", systemTypeSubtype: "" };
  }

  if (/свиток/u.test(text)) {
    return { systemTypeValue: "scroll", systemTypeSubtype: "" };
  }

  if (/яд/u.test(text)) {
    return { systemTypeValue: "poison", systemTypeSubtype: "" };
  }

  return { systemTypeValue: "potion", systemTypeSubtype: "" };
}

export function classifyMagicItem(item = {}) {
  const itemType = normalizeText(item.itemType ?? item.ItemType ?? "");
  const explicitSlots = normalizeHeroDollSlots(item.heroDollSlots ?? item.itemSlot ?? "");
  const isConsumable = item.isConsumable === true || normalizeText(item.isConsumable) === "true";
  const slotFallback = inferSlotsFromName(item.name, []);

  if (isConsumable) {
    const consumable = normalizeMagicConsumableType(item);
    return {
      documentType: "consumable",
      systemTypeValue: consumable.systemTypeValue,
      systemTypeSubtype: consumable.systemTypeSubtype,
      baseItem: "",
      folderPath: String(item.rarity ?? item.itemRarity ?? "Без редкости").trim() || "Без редкости",
      heroDollSlots: buildHeroDollSlots(explicitSlots, []),
      firearmClass: "",
      sourceCategory: String(item.itemType ?? item.ItemType ?? "Магический предмет").trim() || "Магический предмет"
    };
  }

  if (itemType === normalizeText("Оружие")) {
    const subtypeProfile = /пистолет|мушкет|аркебуз|руж/u.test(normalizeText(item.itemSubtype))
      ? buildFirearmProfile(item.name)
      : buildWeaponProfile(item.name);
    return {
      documentType: "weapon",
      systemTypeValue: subtypeProfile.systemTypeValue,
      systemTypeSubtype: "",
      baseItem: subtypeProfile.baseItem,
      folderPath: String(item.rarity ?? item.itemRarity ?? "Без редкости").trim() || "Без редкости",
      heroDollSlots: buildHeroDollSlots(explicitSlots, subtypeProfile.heroDollSlots),
      firearmClass: subtypeProfile.firearmClass ?? "",
      sourceCategory: "Магическое оружие"
    };
  }

  if (itemType === normalizeText("Доспех")) {
    const armorProfile = buildArmorProfile(item.name);
    return {
      documentType: "equipment",
      systemTypeValue: armorProfile.systemTypeValue,
      systemTypeSubtype: "",
      baseItem: armorProfile.baseItem,
      folderPath: String(item.rarity ?? item.itemRarity ?? "Без редкости").trim() || "Без редкости",
      heroDollSlots: buildHeroDollSlots(explicitSlots, armorProfile.heroDollSlots),
      firearmClass: "",
      sourceCategory: "Магический доспех"
    };
  }

  if (itemType === normalizeText("Волшебная палочка")) {
    return {
      documentType: "equipment",
      systemTypeValue: "wand",
      systemTypeSubtype: "",
      baseItem: "",
      folderPath: String(item.rarity ?? item.itemRarity ?? "Без редкости").trim() || "Без редкости",
      heroDollSlots: buildHeroDollSlots(explicitSlots, [...HAND_SLOTS, ...BACK_SLOTS]),
      firearmClass: "",
      sourceCategory: "Магическая палочка"
    };
  }

  if (itemType === normalizeText("Жезл")) {
    return {
      documentType: "equipment",
      systemTypeValue: "rod",
      systemTypeSubtype: "",
      baseItem: "",
      folderPath: String(item.rarity ?? item.itemRarity ?? "Без редкости").trim() || "Без редкости",
      heroDollSlots: buildHeroDollSlots(explicitSlots, [...HAND_SLOTS, ...BACK_SLOTS]),
      firearmClass: "",
      sourceCategory: "Магический фокус"
    };
  }

  if (itemType === normalizeText("Посох")) {
    return {
      documentType: "equipment",
      systemTypeValue: "staff",
      systemTypeSubtype: "",
      baseItem: "",
      folderPath: String(item.rarity ?? item.itemRarity ?? "Без редкости").trim() || "Без редкости",
      heroDollSlots: buildHeroDollSlots(explicitSlots, [...HAND_SLOTS, ...BACK_SLOTS]),
      firearmClass: "",
      sourceCategory: "Магический фокус"
    };
  }

  if (explicitSlots.some((slotId) => RING_SLOTS.includes(slotId))) {
    return {
      documentType: "equipment",
      systemTypeValue: "ring",
      systemTypeSubtype: "",
      baseItem: "",
      folderPath: String(item.rarity ?? item.itemRarity ?? "Без редкости").trim() || "Без редкости",
      heroDollSlots: buildHeroDollSlots(explicitSlots, [...RING_SLOTS]),
      firearmClass: "",
      sourceCategory: "Магическое кольцо"
    };
  }

  if (explicitSlots.some((slotId) => slotId === "head")) {
    return {
      documentType: "equipment",
      systemTypeValue: "wondrous",
      systemTypeSubtype: "",
      baseItem: "",
      folderPath: String(item.rarity ?? item.itemRarity ?? "Без редкости").trim() || "Без редкости",
      heroDollSlots: buildHeroDollSlots(explicitSlots, ["head"]),
      firearmClass: "",
      sourceCategory: "Магический предмет"
    };
  }

  return {
    documentType: "equipment",
    systemTypeValue: "wondrous",
    systemTypeSubtype: "",
    baseItem: "",
    folderPath: String(item.rarity ?? item.itemRarity ?? "Без редкости").trim() || "Без редкости",
    heroDollSlots: buildHeroDollSlots(explicitSlots, slotFallback),
    firearmClass: "",
    sourceCategory: "Магический предмет"
  };
}

