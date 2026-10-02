import { inferRebreyaAmmunitionSubtype, inferRebreyaWeaponAmmunitionSubtype } from "./ammunition-types.js";
import { inferWeaponAmmunitionSubtype } from "./ammunition-compatibility.js";

const normalized = value => String(value ?? "").toLowerCase().replace(/ё/gu, "е");
const profile = (themes, role, details = {}) => ({ themes: [...new Set(themes)], role, ...details });
const AMMO_FAMILIES = {
  bow: "arrow", crossbow: "crossbowBolt", blowgun: "blowgunNeedle", sling: "slingBullet",
  musket: "rebreyaMusket", arquebus: "rebreyaMusket", "flintlock-pistol": "rebreyaMusket",
  "multibarrel-flintlock-pistol": "rebreyaMusket", wheellock: "rebreyaMusket",
  rifle: "rebreyaRifle", carbine: "rebreyaRifle", pistol: "rebreyaPistol",
  shotgun: "rebreyaShotgun", musketoon: "rebreyaShotgun",
  "gauss-rifle": "rebreyaGaussBolt", "gauss-machine-gun": "rebreyaGaussBolt",
  "tesla-rifle": "rebreyaEnergyBattery", "laser-weapon": "rebreyaThermalBattery",
  flamethrower: "rebreyaFuelTank", "antimatter-weapon": "rebreyaAntimatter",
  "hand-grenade-launcher": "rebreyaCannonball", "hand-cannon": "rebreyaCannonball",
  "portable-cannon": "rebreyaCannonball", "grenade-launcher": "rebreyaRocket", "rocket-launcher": "rebreyaRocket"
};
const PHYSICAL_AMMO = [...new Set(Object.values(AMMO_FAMILIES))].filter(family => !["rebreyaEnergyBattery", "rebreyaThermalBattery", "rebreyaFuelTank", "rebreyaAntimatter"].includes(family));
const TWO_HANDED_BASES = new Set(["greatsword", "greataxe", "greatclub", "glaive", "halberd", "pike", "maul", "longbow", "shortbow", "lightcrossbow", "heavycrossbow"]);

/** Semantic metadata belongs to catalog selection, not physical Item identity. */
export function getLootgenThemeProfile(item = {}) {
  if (item.lootTheme) return item.lootTheme;
  if (item.itemData) {
    const data = item.itemData;
    const flags = data.flags?.["rebreya-main"] ?? {};
    const properties = data.system?.properties ?? [];
    return getLootgenThemeProfile({ ...data, ...item, itemData: undefined,
      itemType: flags.itemType, itemSubtype: flags.itemSubtype,
      foundryType: data.type, foundrySubtype: data.system?.type?.value,
      weapon: data.type === "weapon" ? { properties: Array.isArray(properties) ? properties : properties instanceof Set ? [...properties] : [], baseItem: data.system?.type?.baseItem } : undefined,
      armor: data.type === "equipment" && ["light", "medium", "heavy", "shield"].includes(data.system?.type?.value) ? { type: data.system.type.value } : undefined
    });
  }
  const name = normalized(item.name);
  const type = normalized(item.typeLabel ?? item.equipmentType ?? item.itemType ?? item.type);
  const subtype = normalized(item.itemSubtype ?? item.foundrySubtype);
  const shop = normalized(item.shopSubtype);
  const identity = { ...item, gearId: item.sourceId ?? item.id };
  const classicalAmmo = /болт/u.test(name + subtype) ? "crossbowBolt" : /стрел/u.test(name + subtype) ? "arrow" : "";
  const ammoFamily = inferRebreyaAmmunitionSubtype(identity) || classicalAmmo;
  if (/боеприпас/u.test(type + subtype) || /^(стрела|болт|ammo)$/u.test(subtype) || item.ammunition || /^(стрелы|арбалетные болты)$/u.test(name)) {
    const compatibility = item.ammunition?.compatibility;
    const universal = Array.isArray(compatibility) ? compatibility.includes("all") : item.sourceType === "magicItem" && /боеприпас/u.test(subtype);
    const ammoFamilies = Array.isArray(compatibility)
      ? [...new Set(compatibility.flatMap(kind => kind === "all" ? PHYSICAL_AMMO : AMMO_FAMILIES[kind] ? [AMMO_FAMILIES[kind]] : []))]
      : universal ? PHYSICAL_AMMO : ammoFamily ? [ammoFamily] : [];
    const classical = ammoFamilies.some(family => ["arrow", "crossbowBolt", "blowgunNeedle", "slingBullet"].includes(family));
    const firearm = ammoFamilies.some(family => family.startsWith("rebreya"));
    return profile(firearm || !classical ? ["technology", ...(classical ? ["hunting"] : [])] : ["hunting"], "ammunition", { ammoFamilies,
      ...(universal ? { openTheme: true } : firearm || !classical ? { specialty: "firearms" } : {}) });
  }
  if (item.sourceType === "magicItem" && (/^(посох|жезл|палочка|свиток)$/u.test(type) || subtype === "боевой посох")) {
    return profile(/лечен/u.test(name) ? ["medicine", "arcane"] : ["arcane"], type === "свиток" ? "scroll" : "focus");
  }
  if (/имплант/u.test(type)) return profile(["technology", "medicine"], "implant", { specialty: "augmentation" });
  if (item.armor?.type === "shield" || subtype === "щит" || /(?:^|[^\p{L}])щит(?:[^\p{L}]|$)/u.test(name) || type === "щит") return profile(["combat", "hunting", "technology"], "shield");
  if (/оружие|weapon/u.test(type) || item.weapon
    || !item.armor && !/броня|доспех|armor/u.test(type) && /меч|лук|арбалет|боевой молот|клинок/u.test(name)) {
    // Managed magic documents project mgc only; their known native base still defines selection compatibility.
    const magicBaseAmmo = item.sourceType === "magicItem" && item.weapon?.baseItem
      ? inferWeaponAmmunitionSubtype({ system: { type: { baseItem: item.weapon.baseItem }, properties: ["amm"] } }) : "";
    const weaponAmmo = inferWeaponAmmunitionSubtype(identity)
      || magicBaseAmmo
      || (/арбалет/u.test(name) ? "crossbowBolt" : /лук/u.test(name) ? "arrow" : "");
    const twoHanded = (item.weapon?.properties ? item.weapon.properties.includes("two") : /двуруч/u.test(name))
      || item.sourceType === "magicItem" && (TWO_HANDED_BASES.has(item.weapon?.baseItem) || /двуруч/u.test(name));
    const theme = /огнестрель/u.test(type) || inferRebreyaWeaponAmmunitionSubtype(identity) ? "technology" : weaponAmmo ? "hunting" : "combat";
    return profile([theme, ...(/кинжал|ручной топор|легкий молот/u.test(name) ? ["camping", "hunting"] : [])], "weapon", { twoHanded, ammoFamily: weaponAmmo,
      ...(theme === "technology" ? { specialty: "firearms" } : {}) });
  }
  if (item.armor || /броня|доспех|armor/u.test(type) || /кольчуг|латы|доспех|кираса/u.test(name)) return profile(["combat", "hunting", "technology"], "armor");
  if (/колчан|контейнер.*болт/u.test(name)) return profile(["hunting"], "quiver");
  if (/наручи.*стрельб/u.test(name)) return profile(["hunting"], "accessory");
  if (/невидим|лазутчик|эльфийск.*(сапоги|плащ)/u.test(name)) return profile(["thievery", "exploration"], "stealth");
  if (/рюкзак|походная сумка/u.test(name)) return profile(["camping", "exploration"], "container");
  if (/спальн.*мешок|спальник|лежанка/u.test(name)) return profile(["camping"], "sleep");
  if (/одеял|плед/u.test(name)) return profile(["camping"], "warmth");
  if (/рацион|провиант|паек|пища/u.test(name)) return profile(["camping", "hunting"], "food");
  if (/котел|сковород|кастрюл|столов|повар/u.test(name)) return profile(["camping"], "cooking");
  if (/бурдюк|фляг/u.test(name)) return profile(["camping", "exploration"], "water");
  if (/палатк/u.test(name)) return profile(["camping"], "shelter");
  if (/факел|фонар|огнив|лампа|свеча|спичк|трутниц|зажигалк/u.test(name)) return profile(["camping", "exploration"], "light");
  if (/веревк|крюк|кошк.*лаз|альпинист/u.test(name)) return profile(["exploration"], "climbing");
  if (/лазани|лестниц|блок и лебедка/u.test(name)) return profile(["exploration", "crafting"], "climbing");
  if (/наживк|рыбалк/u.test(name)) return profile(["hunting", "camping"], "fishing");
  if (/бинокл|подзорн|увеличител/u.test(name)) return profile(["exploration", "hunting"], "vision");
  if (/атлас|карта|компас/u.test(name)) return profile(["exploration", "scholar"], "navigation");
  if (/фокусировк|компонентами/u.test(name)) return profile(["arcane"], /компонент/u.test(name) ? "components" : "focus");
  if (/лечен|лекар|целител|бинт|медицин/u.test(name)) return profile(["medicine", "combat", "camping"], /комплект|инструмент/u.test(name) ? "medical-tool" : "medicine");
  if (/алхим/u.test(name) && /инструмент/u.test(type)) return profile(["alchemy", "crafting"], "tool");
  if (/алхим|реагент|склян|кислота/u.test(name)) return profile(["alchemy"], "reagent");
  if (/воров|отмыч|взлом/u.test(name)) return profile(["thievery"], "tool");
  if (/книга|справочник/u.test(name)) return profile([/заклинани/u.test(name) ? "arcane" : "scholar", "scholar"], "reference");
  if (/бумага|пергамент/u.test(name)) return profile(["scholar", "arcane"], "writing");
  if (/чернил|писч|каллигра/u.test(name)) return profile(["scholar", "arcane"], "writing-tool");
  if (/абак/u.test(name)) return profile(["scholar"], "calculation");
  if (/священ|ладан|ритуал|четки/u.test(name)) return profile(["ritual"], "ritual");
  if (/сокровищ|монет/u.test(type) || /самоцвет|драгоцен|хризолит|кварц|жемчуг|агат|аметист/u.test(name)) return profile(["valuables"], "treasure");
  if (/бензин|дизель|керосин|мазут|уголь/u.test(name)) return profile(["technology"], "fuel", { specialty: "mechanics" });
  if (/обвес|взрывчат|инженер/u.test(type + " " + name)) return profile(["technology"], "component");
  if (item.foundryType === "container" || item.containerCapacity) {
    if (/flask|bottle|vial|jug|tankard/u.test(item.foundrySubtype ?? "")) return profile(["alchemy", "camping"], "vessel");
    return profile(["storage"], "container", { openTheme: true });
  }
  if (/точильн|молоток|молот кузнеч/u.test(name)) return profile(["crafting", "combat"], "maintenance");
  if (/инструмент/u.test(type) || item.sourceType === "material") return profile(["crafting"], "supplies");
  if (item.sourceType === "magicItem") return profile(["arcane"], "artifact");
  // Catalog shops are a fallback only; structural and curated semantics win above.
  if (/книжн|писч/u.test(shop)) return profile(["scholar", "arcane"], "document");
  if (/ювелир|галере|художествен/u.test(shop)) return profile(["valuables"], /час/u.test(name) ? "clock" : "art");
  if (/портняж/u.test(shop)) return profile(["camping", "valuables"], "clothing");
  if (/автомобил/u.test(shop)) return profile(["technology"], "component", { specialty: "mechanics" });
  if (/оптическ|стекольн/u.test(shop)) return profile(["exploration", "alchemy"], "vessel");
  if (/скобян/u.test(shop)) return profile(["crafting", "exploration"], "hardware");
  if (/столярн|бондарн/u.test(shop)) return profile(["crafting"], "furniture");
  if (/аптекар/u.test(shop)) return profile(["alchemy", "medicine"], "supplies");
  if (/кожевен|походн/u.test(shop)) return profile(["camping", "exploration"], "accessory");
  return profile([], "other");
}

/** One scope prefers related and complementary equipment without excluding other loot. */
export function createLootgenThemeContext(seedRows = [], { initialTheme = "" } = {}) {
  let theme = initialTheme;
  let hasTwoHandedWeapon = false;
  let hasShield = false;
  let weaponAmmo = "";
  let hasAmmunition = false;
  const roles = new Map();
  const ammunition = new Set();
  let specialty = "";
  const profiles = new WeakMap();
  const read = row => {
    if (!profiles.has(row)) profiles.set(row, getLootgenThemeProfile(row));
    return profiles.get(row);
  };
  const context = {
    weight(row) {
      const info = read(row);
      let weight = !theme || info.openTheme ? 1
        : !info.themes.length ? 0.15 : info.themes.includes(theme) ? 4 : 0.25;
      weight /= 1 + (roles.get(info.role) ?? 0);
      if (info.role === "shield" && hasTwoHandedWeapon || info.twoHanded && hasShield) weight *= 0.1;
      if (specialty && info.specialty && info.specialty !== specialty) weight *= 0.1;
      if (info.role === "ammunition" && weaponAmmo && !(info.ammoFamilies ?? []).includes(weaponAmmo)) weight *= 0.1;
      if (info.role === "weapon" && hasAmmunition && (!info.ammoFamily || !ammunition.has(info.ammoFamily))) weight *= 0.1;
      return weight;
    },
    accept(row) {
      const info = read(row);
      if (!info.openTheme) theme ||= info.themes[0] ?? "";
      specialty ||= info.specialty ?? "";
      roles.set(info.role, (roles.get(info.role) ?? 0) + 1);
      hasTwoHandedWeapon ||= info.twoHanded === true;
      hasShield ||= info.role === "shield";
      if (info.role === "weapon") weaponAmmo = info.ammoFamily ?? "";
      if (info.role === "ammunition") {
        hasAmmunition = true;
        for (const family of info.ammoFamilies ?? []) ammunition.add(family);
      }
    },
    forContainer(row) {
      const info = read(row);
      return createLootgenThemeContext([], { initialTheme: info.openTheme ? theme : info.themes[0] ?? theme });
    }
  };
  const seeds = seedRows.filter(row => row && typeof row === "object" && row.rowKind !== "journal");
  const thematicSeeds = seeds.map(read).filter(info => !info.openTheme && info.themes.length);
  if (!theme && thematicSeeds.length) {
    const common = thematicSeeds[0].themes.filter(candidate => thematicSeeds.every(info => info.themes.includes(candidate)));
    theme = common[0] ?? thematicSeeds.reduce((best, info) => info.themes.length < best.themes.length ? info : best).themes[0];
  }
  for (const row of seeds) context.accept(row);
  return context;
}
