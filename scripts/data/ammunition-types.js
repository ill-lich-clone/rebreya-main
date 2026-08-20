export const REBREYA_AMMUNITION_SUBTYPES = Object.freeze({
  rebreyaMusket: "Мушкетные патроны",
  rebreyaRifle: "Винтовочные патроны",
  rebreyaShotgun: "Картечные патроны",
  rebreyaPistol: "Пистолетные патроны",
  rebreyaFuelTank: "Топливные баки",
  rebreyaRocket: "Ракетные выстрелы",
  rebreyaEnergyBattery: "Энергетические батареи",
  rebreyaGaussBolt: "Стальные болты Гаусса",
  rebreyaAntimatter: "Заряды антиматерии",
  rebreyaThermalBattery: "Тепловые батареи",
  rebreyaCannonball: "Орудийные боеприпасы"
});

const AMMUNITION_SUBTYPE_BY_GEAR_ID = new Map([
  ["mushketnyy-patron-20", "rebreyaMusket"],
  ["broneboynye-puli-10", "rebreyaMusket"],
  ["vintovochnyy-patron-10", "rebreyaRifle"],
  ["obolochennye-puli-10", "rebreyaRifle"],
  ["kartechnyy-patron-20", "rebreyaShotgun"],
  ["pulevoy-patron-10", "rebreyaShotgun"],
  ["ekspansivnye-puli-5", "rebreyaShotgun"],
  ["pistoletnyy-patron-20", "rebreyaPistol"],
  ["toplivnyy-bak-1", "rebreyaFuelTank"],
  ["raketnyy-vystrel-3", "rebreyaRocket"],
  ["batareya-4", "rebreyaEnergyBattery"],
  ["stal-noy-bolt-1", "rebreyaGaussBolt"],
  ["zaryad-antimaterii-20", "rebreyaAntimatter"],
  ["teplovaya-batareya-20", "rebreyaThermalBattery"],
  ["broneboynyy-10", "rebreyaCannonball"],
  ["standartnyy-10", "rebreyaCannonball"],
  ["udarnyy-10", "rebreyaCannonball"],
  ["sbivayushchiy-5", "rebreyaCannonball"],
  ["dymchatyy-5", "rebreyaCannonball"],
  ["dymovoy-3", "rebreyaCannonball"],
  ["podzhigayushchiy-10", "rebreyaCannonball"],
  ["pulevaya-granata-10", "rebreyaCannonball"],
  ["osveshchyayushchiy-10", "rebreyaCannonball"]
]);

function clean(value) {
  return String(value ?? "").trim();
}

function normalized(value) {
  return clean(value).toLocaleLowerCase("ru-RU").replace(/ё/gu, "е");
}

function moduleValue(document, key) {
  return document?.getFlag?.("rebreya-main", key)
    ?? document?.flags?.["rebreya-main"]?.[key]
    ?? document?.[key];
}

export function inferRebreyaAmmunitionSubtype(item) {
  const gearId = normalized(moduleValue(item, "gearId") ?? moduleValue(item, "sourceId") ?? item?.id);
  return AMMUNITION_SUBTYPE_BY_GEAR_ID.get(gearId) ?? "";
}

export function inferRebreyaWeaponAmmunitionSubtype(item) {
  const label = normalized(
    item?.weapon?.lichWeaponPropertyValues?.ammunition
    ?? moduleValue(item, "lichWeaponPropertyValues")?.ammunition
    ?? item?.lichWeaponPropertyValues?.ammunition
  );
  if (!label) return "";
  if (label.includes("стальн") && label.includes("болт")) return "rebreyaGaussBolt";
  if (label.includes("антиматер")) return "rebreyaAntimatter";
  if (label.includes("теплов") && label.includes("батар")) return "rebreyaThermalBattery";
  if (label.includes("топлив")) return "rebreyaFuelTank";
  if (label.includes("ракет")) return "rebreyaRocket";
  if (label.includes("мушкет")) return "rebreyaMusket";
  if (label.includes("винтов")) return "rebreyaRifle";
  if (label.includes("картеч")) return "rebreyaShotgun";
  if (label.includes("пистолет")) return "rebreyaPistol";
  if (label.includes("батар")) return "rebreyaEnergyBattery";
  if (label.includes("ядр")) return "rebreyaCannonball";
  return "";
}
