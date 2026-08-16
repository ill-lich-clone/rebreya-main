import { MODULE_ID } from "../constants.js";
import { buildNamedIconLookup, normalizeFolderPath, resolveNamedIcon } from "./compendium-utils.js";
import { classifyGearEntry } from "./item-classification.js";

export const DEFAULT_GEAR_ICON = "systems/dnd5e/icons/svg/items/loot.svg";

const CUSTOM_GEAR_ICONS_BASE_PATH = `modules/${MODULE_ID}/templates/icons`;
const GEAR_ICON_SEARCH_PATHS = [
  `${CUSTOM_GEAR_ICONS_BASE_PATH}/Goods`,
  `${CUSTOM_GEAR_ICONS_BASE_PATH}/weapons`,
  CUSTOM_GEAR_ICONS_BASE_PATH
];

const GEAR_COIN_ICONS = Object.freeze({
  "медная монета": `modules/${MODULE_ID}/assets/storage/coins/cp.png`,
  "серебрянная монета": `modules/${MODULE_ID}/assets/storage/coins/sp.png`,
  "золотая монета": `modules/${MODULE_ID}/assets/storage/coins/gp.png`,
  "платиновая монета": `modules/${MODULE_ID}/assets/storage/coins/pp.png`
});

function cleanString(value, fallback = "") {
  const text = String(value ?? "").trim();
  return text || fallback;
}

function moduleIconPath(relativePath) {
  return [
    CUSTOM_GEAR_ICONS_BASE_PATH,
    ...String(relativePath ?? "")
      .split("/")
      .filter(Boolean)
      .map((segment) => encodeURIComponent(segment))
  ].join("/");
}

const GEAR_ICON_ALIAS_TARGETS = Object.freeze({
  BOOK: moduleIconPath("Goods/Книга.webp"),
  PAPER: moduleIconPath("Goods/Бумага.webp"),
  SCIENCE_BOOK: moduleIconPath("Goods/Научная книга.webp"),
  MACHINE: moduleIconPath("Goods/Встроенный станок.webp"),
  TECH: moduleIconPath("Goods/Механизм перезарядки оружия.webp"),
  GLOVE: moduleIconPath("Goods/Металлическая перчатка.webp"),
  ARMOR: moduleIconPath("Goods/Стальная оболочка.webp"),
  WINGS: moduleIconPath("Magic Items/Крылья полёта.webp"),
  FIREARM: moduleIconPath("weapons/Винтовка.webp"),
  REVOLVER: moduleIconPath("weapons/Револьвер.webp"),
  AMMO: moduleIconPath("Goods/Пулевой патрон (10).webp"),
  EXPLOSIVE: moduleIconPath("Goods/Подствольный гранатомет.webp"),
  GEM: moduleIconPath("Goods/Кристалл (фокусировка).webp"),
  STATUE: moduleIconPath("Goods/Каменная статуэтка.webp"),
  JEWELRY: moduleIconPath("Goods/Брошь с эмалью.webp"),
  MASK: moduleIconPath("Goods/Маска карнавальная лакированная.webp"),
  MEDALLION: moduleIconPath("Goods/Амулет (священный символ).webp"),
  RING: moduleIconPath("Goods/Кольцо-печатка.webp"),
  CLOAK: moduleIconPath("Goods/Тяжелый плащ.webp"),
  CUP: moduleIconPath("Goods/Золотой кубок чеканный.webp"),
  HARP: moduleIconPath("Magic Items/Арфа Анструт.webp"),
  CHAIN: moduleIconPath("Goods/Цепь.webp"),
  PAINTING: moduleIconPath("Goods/Большая картина в позолоченной раме.webp"),
  CROWN: moduleIconPath("Goods/Платиновая корона дома.webp"),
  EYE: moduleIconPath("Goods/Искусственный глаз.webp"),
  LEG: moduleIconPath("Goods/Металлическая нога.webp"),
  LANTERN: moduleIconPath("Goods/Фонарь, закрытый.webp"),
  SHADOW: moduleIconPath("Goods/Осколок тени.webp"),
  ENCHANTMENT: moduleIconPath("Goods/Зачарование защиты.webp"),
  SOUL_ENCHANTMENT: moduleIconPath("Goods/Душевное зачарование.webp"),
  BACKPACK: moduleIconPath("Goods/Рюкзак.webp"),
  BOOTS: moduleIconPath("Goods/Сильные ноги.webp"),
  SPYGLASS: moduleIconPath("Goods/Подзорная труба.webp"),
  CLOTHING: moduleIconPath("Goods/Одежда, обычная.webp"),
  CLOCK: moduleIconPath("Goods/Карманные часы латунные.webp"),
  HAMMER: moduleIconPath("Goods/Молот, кузнечный.webp"),
  CROWBAR: moduleIconPath("Goods/Ломик.webp"),
  PULLEY: moduleIconPath("Goods/Блок и лебёдка.webp"),
  ENGINE: moduleIconPath("Goods/Импульсные двигатели.webp"),
  CENSER: moduleIconPath("Goods/Кадило.webp"),
  MAGIC_CONDENSER: moduleIconPath("Goods/Конденсатор магии.webp"),
  MUSIC_BOX: moduleIconPath("Goods/Музыкальная шкатулка.webp"),
  DAGGER: moduleIconPath("Goods/Кинжал.webp")
});

const NEW_GEAR_ICON_IDS = new Set([
  "sistema-termokontrolya",
  "ukreplyonnye-sustavy",
  "modul-ukrepleniya-tela",
  "mnogofunktsionalnyy-zakhvat",
  "razrisovannyy-korpus",
  "usilennye-ladoni",
  "krepkiy-sharnir",
  "magnitnaya-ladon",
  "mozg-chudovishcha",
  "raketnaya-tyaga",
  "modul-vosstanovleniya",
  "konteyner-dlya-familyara",
  "pauchi-lapy-nova-indastriz",
  "kolossalnyy-ekzoskelet-gefest",
  "sistema-absolyutnogo-analiza-spektr",
  "adaptivnaya-platforma-leviafan",
  "oboronitelnaya-sistema-egida",
  "konteyner-dlya-familyara-kolybel",
  "mekhanicheskie-krylya-orion",
  "raketnaya-tyaga-orion",
  "simbioticheskiy-mozg",
  "ruka-boga",
  "khranilishche-neveroyatnoy-pronitsatelnosti",
  "pantsir-kristalnogo-leviafana",
  "cheshuya-tarraska",
  "essentsiya-khaosa",
  "serdtse-preobrazovaniya",
  "yadro-perepletyonnoy-realnosti",
  "kolyaska-dlya-mototsikla",
  "vneshniy-fonar",
  "uluchshennaya-podveska",
  "oblegchyonnyy-korpus-avto",
  "utolshchyonnye-kolyosa",
  "nadyozhnaya-rama",
  "lestnichnyy-mekhanizm",
  "litsevoy-shchit",
  "gusenitsy",
  "utyazhelyonnyy-korpus",
  "essentsiya-koshmarov",
  "listovki-pechatnye-10",
  "gazeta-1-vypusk",
  "raspisanie-perevozok",
  "afisha-pechatnaya",
  "broshyura",
  "tovarnyy-katalog",
  "zhurnal-ili-al-manakh",
  "tipovye-blanki-20",
  "vizitnye-kartochki-20",
  "nastennyy-kalendar",
  "karta-goroda-pechatnaya",
  "karmannyy-spravochnik",
  "pechatnaya-kniga",
  "podshivka-gazet-30-vypuskov",
  "uchebnik",
  "karta-regiona-pechatnaya",
  "illyustrirovannaya-pechatnaya-kniga",
  "tekhnicheskoe-rukovodstvo",
  "komplekt-tekhnicheskikh-chertezhey",
  "sbornik-zakonov-i-postanovleniy",
  "atlas",
  "pishushchaya-mashinka",
  "nabor-tipografskikh-liter",
  "entsiklopediya-10-tomov",
  "ruchnoy-pechatnyy-press",
  "antimaterial-nyy-revol-ver",
  "antimaterial-naya-vintovka",
  "lazernaya-vintovka",
  "gauss-pulemyot",
  "broneboynyy-10",
  "broneboynye-puli-10",
  "obolochennye-puli-10",
  "ekspansivnye-puli-5",
  "standartnyy-10",
  "udarnyy-10",
  "sbivayushchiy-5",
  "dymchatyy-5",
  "dymovoy-3",
  "podzhigayushchiy-10",
  "pulevaya-granata-10",
  "osveshchyayushchiy-10",
  "osvyashchyonnyy-adamantiy",
  "prakh-modronov",
  "poroshok-drokhuby",
  "shyopot-t-my",
  "pantsir-kristal-nogo-leviafana",
  "cherep-orkusa",
  "pantsirnaya-plastina-drednouta-oruzhie",
  "pantsirnaya-plastina-drednouta-dospekh",
  "kleshni-drednouta",
  "oskolok-kosti-chudovishcha",
  "zacharovanie-lyogkosti",
  "khrebet-beskonechnoy-ploti",
  "absolyutnaya-pustota",
  "golova-eridany",
  "proklyat-e-molnienosnoy-reaktsii",
  "proklyat-e-presleduyushchego-uspekha",
  "proklyat-e-zhizni-i-smerti",
  "proklyat-e-tyazhesti-zhizni",
  "proklyat-e-krovopuskaniya",
  "proklyat-e-skorbyashchego-proshlogo",
  "proklyat-e-prityagivanie-snaryadov",
  "proklyat-e-ognennoy-dushi",
  "proklyat-e-voli-k-zhizni",
  "proklyat-e-tsepey",
  "proklyat-e-obsidiana",
  "mednaya-provolka",
  "malaya-oskolochnaya-granata",
  "dymovaya-shashka",
  "oskolochnaya-granat",
  "svetoshumovaya-granata",
  "protivopekhotnaya-mina",
  "ottalkivayushchaya-granata",
  "tsepnaya-granata",
  "granata-bumerang",
  "takticheskaya-oskolochnaya-granata",
  "velikaya-oskolochnaya-granata",
  "protivotankovoya-mina",
  "dymovaya-zavesa",
  "mina-adskiy-shepot",
  "azurit",
  "biryuza",
  "gematit",
  "goluboy-kvarts",
  "obsidian",
  "geliotrop",
  "lunnyy-kamen",
  "oniks",
  "khrizopraz",
  "tsitrin",
  "ametist",
  "granat",
  "zhemchug",
  "nefrit",
  "yantar",
  "akvamarin",
  "aleksandrit",
  "topaz",
  "khrizolit",
  "chyornyy-zhemchug",
  "goluboy-sapfir",
  "zhyoltyy-sapfir",
  "zvyozdchatyy-rubin",
  "izumrud",
  "opal",
  "giatsint",
  "rubin",
  "chyornyy-sapfir",
  "serebryanyy-kuvshin",
  "reznaya-statuetka-iz-kosti",
  "malen-kiy-zolotoy-braslet",
  "chyornaya-barkhatnaya-maska-vyshitaya-serebryanoy-nit-yu",
  "zolotoy-medal-on-s-portretom-vozlyublennoy-vnutri",
  "zolotoe-kol-tso-s-geliotropami",
  "reznaya-statuetka-slonovoy-kosti",
  "bol-shoy-zolotoy-braslet",
  "shyolkovaya-mantiya-s-zolotoy-vyshivkoy",
  "latunnaya-kruzhka-inkrustirovannaya-nefritom",
  "serebryanaya-chasha-dekorirovannaya-lunnym-kamnem",
  "reznaya-arfa-iz-ekzoticheskoy-drevesiny-s-inkrustatsiey",
  "nebol-shoy-zolotoy-idol",
  "tseremonial-nyy-kinzhal-iz-elektruma-s-chyornoy-zhemchuzhinoy",
  "obsidianovaya-statuetka-s-zolotoy-inkrustatsiey",
  "prekrasnaya-zolotaya-tsep-s-ognennym-opalom",
  "starinnyy-shedevr-zhivopisi",
  "platinovyy-braslet-s-sapfirom",
  "zolotaya-muzykal-naya-shkatulka",
  "glaznaya-povyazka-s-lozhnym-glazom-iz-golubogo-sapfira-i-lunnogo-kamnya",
  "ukrashennaya-dragotsennostyami-zolotaya-korona",
  "ukrashennoe-dragotsennostyami-platinovoe-kol-tso",
  "nebol-shaya-zolotaya-statuetka-s-rubinami",
  "zolotoy-kubok-s-izumrudami",
  "nefritovaya-igral-naya-doska-s-zolotymi-figurkami",
  "krokhotnyy-almaz",
  "malen-kiy-almaz",
  "almaz",
  "bol-shoy-almaz",
  "ogromnyy-almaz",
  "giganskiy-almaz",
  "zaryad-para",
  "kompressor",
  "pnevmaticheskiy-garpun",
  "slepyashchaya-shashka",
  "kineticheskie-botinki",
  "binokl",
  "mekhanizirovannyy-ryukzak",
  "mekhanizirovannaya-odezhda",
  "zazhigalka",
  "korobok-spichek",
  "naruchnye-chasy",
  "parashyut",
  "mekhanicheskie-kryl-ya",
  "parovoy-kuznechnyy-molot",
  "zaryazhennye-perchatki",
  "portativnaya-drel",
  "pod-yomnyy-blok",
  "parovoy-ranets",
  "zashchitnaya-maska"
]);

function normalizeMatchText(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/\u0451/gu, "\u0435")
    .replace(/['\u2019\u2018\u02BC\u02B9\u2032"\u201C\u201D\u00AB\u00BB]/gu, "")
    .replace(/\s+/gu, " ");
}

function buildFolderPath(classification) {
  return normalizeFolderPath(classification?.folderPath);
}

function stripTrailingParenthetical(value) {
  return cleanString(value).replace(/\s*\([^()]*\)\s*$/u, "").trim();
}

function getGearIconNameCandidates(item) {
  const name = cleanString(item?.name);
  if (!name) {
    return [];
  }

  const candidates = [];
  const equipmentType = cleanString(item?.equipmentType);
  if (equipmentType) {
    candidates.push(`${name} (${equipmentType})`);
  }

  candidates.push(name);

  const shortenedName = stripTrailingParenthetical(name);
  if (shortenedName && shortenedName !== name) {
    candidates.push(shortenedName);
  }

  return Array.from(new Set(candidates));
}

export const CRAFTSMAN_GADGET_ICON_ALIASES = Object.freeze({
  "Силовая перчатка": GEAR_ICON_ALIAS_TARGETS.GLOVE,
  "Магнитный движок": GEAR_ICON_ALIAS_TARGETS.MAGIC_CONDENSER,
  "Заряженный ботинок": GEAR_ICON_ALIAS_TARGETS.BOOTS,
  "Дымовой аппарат": GEAR_ICON_ALIAS_TARGETS.CENSER,
  "Форсажный инжектор (транспорт)": GEAR_ICON_ALIAS_TARGETS.ENGINE,
  "Аварийный регулятор (транспорт)": GEAR_ICON_ALIAS_TARGETS.MACHINE
});

export function resolveCraftsmanGadgetIcon(name) {
  return CRAFTSMAN_GADGET_ICON_ALIASES[cleanString(name)] ?? "";
}

function resolveNewGearIcon(item) {
  if (!NEW_GEAR_ICON_IDS.has(cleanString(item?.id))) {
    return "";
  }

  const name = normalizeMatchText(item?.name);
  const equipmentType = normalizeMatchText(item?.equipmentType);

  if (equipmentType === normalizeMatchText("Сокровища")) {
    if (/азурит|бирюз|гематит|кварц|обсидиан|гелиотроп|оникс|хризопраз|цитрин|аметист|гранат|жемчуг|нефрит|янтар|аквамарин|александрит|топаз|хризолит|сапфир|рубин|изумруд|опал|гиацинт|алмаз/u.test(name)) {
      return GEAR_ICON_ALIAS_TARGETS.GEM;
    }
    if (/кувшин|кружк|чаш/u.test(name)) {
      return GEAR_ICON_ALIAS_TARGETS.CUP;
    }
    if (/статуэт|идол/u.test(name)) {
      return GEAR_ICON_ALIAS_TARGETS.STATUE;
    }
    if (/браслет|кольц/u.test(name)) {
      return GEAR_ICON_ALIAS_TARGETS.JEWELRY;
    }
    if (/корон/u.test(name)) {
      return GEAR_ICON_ALIAS_TARGETS.CROWN;
    }
    if (/маск|повяз/u.test(name)) {
      return GEAR_ICON_ALIAS_TARGETS.MASK;
    }
    if (/медальон/u.test(name)) {
      return GEAR_ICON_ALIAS_TARGETS.MEDALLION;
    }
    if (/мантия|наряд/u.test(name)) {
      return GEAR_ICON_ALIAS_TARGETS.CLOAK;
    }
    if (/арф/u.test(name)) {
      return GEAR_ICON_ALIAS_TARGETS.HARP;
    }
    if (/кинжал/u.test(name)) {
      return GEAR_ICON_ALIAS_TARGETS.DAGGER;
    }
    if (/цеп/u.test(name)) {
      return GEAR_ICON_ALIAS_TARGETS.CHAIN;
    }
    if (/живопис|портрет|картин/u.test(name)) {
      return GEAR_ICON_ALIAS_TARGETS.PAINTING;
    }
    if (/шкатул/u.test(name)) {
      return GEAR_ICON_ALIAS_TARGETS.MUSIC_BOX;
    }
    return GEAR_ICON_ALIAS_TARGETS.JEWELRY;
  }

  if (equipmentType === normalizeMatchText("Имплант")) {
    if (/крыл/u.test(name)) {
      return GEAR_ICON_ALIAS_TARGETS.WINGS;
    }
    if (/перчат|ладон|рук/u.test(name)) {
      return GEAR_ICON_ALIAS_TARGETS.GLOVE;
    }
    if (/мозг/u.test(name)) {
      return GEAR_ICON_ALIAS_TARGETS.EYE;
    }
    if (/ног|колес|гусениц/u.test(name)) {
      return GEAR_ICON_ALIAS_TARGETS.LEG;
    }
    if (/фонар/u.test(name)) {
      return GEAR_ICON_ALIAS_TARGETS.LANTERN;
    }
    if (/чешу|панцир|оболоч|корпус|экзоскел|рама|сустав|шарнир/u.test(name)) {
      return GEAR_ICON_ALIAS_TARGETS.ARMOR;
    }
    return GEAR_ICON_ALIAS_TARGETS.TECH;
  }

  if (equipmentType === normalizeMatchText("Усовершенствование")) {
    if (/проклят|тьм|пустот|хаос|тени/u.test(name)) {
      return GEAR_ICON_ALIAS_TARGETS.SHADOW;
    }
    if (/адамант|панцир|пластин|кость|хребет|голов|тяжест/u.test(name)) {
      return GEAR_ICON_ALIAS_TARGETS.ARMOR;
    }
    if (/зачар|защит|легк/u.test(name)) {
      return GEAR_ICON_ALIAS_TARGETS.ENCHANTMENT;
    }
    return GEAR_ICON_ALIAS_TARGETS.SOUL_ENCHANTMENT;
  }

  if (equipmentType === normalizeMatchText("Снаряжение")) {
    if (/газет|афиш|брошюр|каталог|журнал|бланк|визит|календар|карт|справочник|книг|учебник|руковод|чертеж|законов|атлас|энциклопед|печат|литер/u.test(name)) {
      return /газет|афиш|брошюр|бланк|визит|листов/u.test(name)
        ? GEAR_ICON_ALIAS_TARGETS.PAPER
        : (/техничес|чертеж|научн/u.test(name)
          ? GEAR_ICON_ALIAS_TARGETS.SCIENCE_BOOK
          : GEAR_ICON_ALIAS_TARGETS.BOOK);
    }
    if (/рюкзак/u.test(name)) {
      return GEAR_ICON_ALIAS_TARGETS.BACKPACK;
    }
    if (/ботин/u.test(name)) {
      return GEAR_ICON_ALIAS_TARGETS.BOOTS;
    }
    if (/бинокл/u.test(name)) {
      return GEAR_ICON_ALIAS_TARGETS.SPYGLASS;
    }
    if (/одежд/u.test(name)) {
      return GEAR_ICON_ALIAS_TARGETS.CLOTHING;
    }
    if (/маск/u.test(name)) {
      return GEAR_ICON_ALIAS_TARGETS.MASK;
    }
    if (/часы/u.test(name)) {
      return GEAR_ICON_ALIAS_TARGETS.CLOCK;
    }
    if (/крыл|парашют/u.test(name)) {
      return GEAR_ICON_ALIAS_TARGETS.WINGS;
    }
    if (/молот/u.test(name)) {
      return GEAR_ICON_ALIAS_TARGETS.HAMMER;
    }
    if (/перчат/u.test(name)) {
      return GEAR_ICON_ALIAS_TARGETS.GLOVE;
    }
    if (/дрел/u.test(name)) {
      return GEAR_ICON_ALIAS_TARGETS.CROWBAR;
    }
    if (/блок/u.test(name)) {
      return GEAR_ICON_ALIAS_TARGETS.PULLEY;
    }
    if (/ранец/u.test(name)) {
      return GEAR_ICON_ALIAS_TARGETS.ENGINE;
    }
    if (/пневмат|гарпун|компрессор|двигател|механ|пар|зажиг|спич/u.test(name)) {
      return GEAR_ICON_ALIAS_TARGETS.TECH;
    }
    return GEAR_ICON_ALIAS_TARGETS.MACHINE;
  }

  if (equipmentType === normalizeMatchText("Огнестрельное оружие")) {
    return /револьвер/u.test(name) ? GEAR_ICON_ALIAS_TARGETS.REVOLVER : GEAR_ICON_ALIAS_TARGETS.FIREARM;
  }

  if (equipmentType === normalizeMatchText("Боеприпас")) {
    return GEAR_ICON_ALIAS_TARGETS.AMMO;
  }

  if (equipmentType === normalizeMatchText("Взрывчатка")) {
    return GEAR_ICON_ALIAS_TARGETS.EXPLOSIVE;
  }

  return "";
}

export async function buildGearIconLookup({ forceRefresh = false } = {}) {
  return buildNamedIconLookup(GEAR_ICON_SEARCH_PATHS, { forceRefresh });
}

export function resolveGearNamedIcon(item, iconLookup) {
  for (const iconName of getGearIconNameCandidates(item)) {
    const iconPath = resolveNamedIcon(iconName, iconLookup, "");
    if (iconPath) {
      return iconPath;
    }
  }

  return resolveNewGearIcon(item);
}

export function resolveGearItemIcon(item, { classification = null, iconLookup = null } = {}) {
  const safeClassification = classification ?? classifyGearEntry(item ?? {});
  const folderPath = buildFolderPath(safeClassification).join(" / ").toLowerCase();
  const typeText = normalizeMatchText(item?.equipmentType);
  const coinIcon = typeText === normalizeMatchText("Сокровища")
    ? GEAR_COIN_ICONS[normalizeMatchText(item?.name)]
    : "";
  if (coinIcon) {
    return coinIcon;
  }
  const namedCustomIcon = resolveGearNamedIcon(item, iconLookup);
  if (namedCustomIcon) {
    return namedCustomIcon;
  }

  if (safeClassification.documentType === "container") {
    if (safeClassification.systemTypeValue === "chest") {
      return "icons/containers/chest/chest-reinforced-steel-brown.webp";
    }

    return "icons/containers/bags/pack-simple-leather-brown.webp";
  }

  if (safeClassification.documentType === "weapon") {
    if (safeClassification.firearmClass) {
      return "icons/weapons/guns/gun-pistol-flintlock-metal.webp";
    }

    const weaponName = normalizeMatchText(item?.name);
    if (/арбалет/u.test(`${typeText} ${weaponName}`)) {
      return "icons/weapons/crossbows/crossbow-simple-brown.webp";
    }

    if (/пращ/u.test(`${typeText} ${weaponName}`)) {
      return "icons/weapons/slings/slingshot-wood.webp";
    }

    if (/лук/u.test(`${typeText} ${weaponName}`)) {
      return "icons/weapons/bows/longbow-recurve-brown.webp";
    }

    return "icons/weapons/swords/greatsword-crossguard-silver.webp";
  }

  if (safeClassification.documentType === "equipment") {
    if (safeClassification.systemTypeValue === "shield") {
      return "icons/equipment/shield/heater-steel-grey.webp";
    }

    return "icons/equipment/chest/breastplate-layered-steel.webp";
  }

  if (safeClassification.documentType === "tool") {
    return "icons/tools/smithing/anvil.webp";
  }

  if (safeClassification.documentType === "consumable") {
    if (safeClassification.systemTypeValue === "ammo") {
      return "icons/weapons/ammunition/arrow-broadhead-glowing-orange.webp";
    }

    return "icons/consumables/potions/potion-bottle-corked-labeled-red.webp";
  }

  if (folderPath.includes("обвес")) {
    return "icons/tools/hand/wrench-steel-grey.webp";
  }

  if (folderPath.includes("скакуны") || folderPath.includes("транспорт")) {
    return "icons/environment/settlement/wagon.webp";
  }

  if (folderPath.includes("снаряжение") && /рюкзак|сумк|чехол|футляр/u.test(normalizeMatchText(item?.name))) {
    return "icons/containers/bags/pack-simple-leather-brown.webp";
  }

  return DEFAULT_GEAR_ICON;
}
