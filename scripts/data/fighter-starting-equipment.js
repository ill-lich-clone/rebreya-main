export const FIGHTER_STARTING_EQUIPMENT_PACKAGE_SOURCE_TYPE = "fighterStartingEquipmentPackage";

export const FIGHTER_STARTING_EQUIPMENT_PACKAGES = Object.freeze([
  Object.freeze({
    id: "a",
    featureId: "fighter-starting-equipment-package-a",
    name: "А) Кольчуга, двуручный меч, цеп, 8 метательных копий, набор исследователя подземелий и 4 зм",
    label: "А) Кольчуга, двуручный меч, цеп, 8 метательных копий, набор исследователя подземелий и 4 зм",
    description: "Кольчуга, двуручный меч, цеп, 8 метательных копий, набор исследователя подземелий и 4 зм.",
    items: Object.freeze([
      Object.freeze({ gearId: "kol-chuga", label: "Кольчуга" }),
      Object.freeze({ gearId: "dvuruchnyy-mech", label: "Двуручный меч" }),
      Object.freeze({ gearId: "tsep", label: "Цеп" }),
      Object.freeze({ gearId: "kop-e", label: "Метательное копьё", quantity: 8 }),
      Object.freeze({ gearId: "instrumenty-issledovatelya-0-y-rang", label: "Набор исследователя подземелий" })
    ]),
    currency: Object.freeze({ gp: 4 })
  }),
  Object.freeze({
    id: "b",
    featureId: "fighter-starting-equipment-package-b",
    name: "Б) Проклёпанная кожана, скимитар, короткий меч, длинный лук, 20 стрел, колчан, набор исследователя подземелий и 11 зм",
    label: "Б) Проклёпанная кожана, скимитар, короткий меч, длинный лук, 20 стрел, колчан, набор исследователя подземелий и 11 зм",
    description: "Проклёпанная кожана, скимитар, короткий меч, длинный лук, 20 стрел, колчан, набор исследователя подземелий и 11 зм.",
    items: Object.freeze([
      Object.freeze({ gearId: "proklyopannyy-kozhanyy-dospekh", label: "Проклёпанная кожана" }),
      Object.freeze({ gearId: "skimitar", label: "Скимитар" }),
      Object.freeze({ gearId: "korotkiy-mech", label: "Короткий меч" }),
      Object.freeze({ gearId: "dlinnyy-luk", label: "Длинный лук" }),
      Object.freeze({ gearId: "strely-20", label: "Стрелы (20)" }),
      Object.freeze({ gearId: "kolchan", label: "Колчан" }),
      Object.freeze({ gearId: "instrumenty-issledovatelya-0-y-rang", label: "Набор исследователя подземелий" })
    ]),
    currency: Object.freeze({ gp: 11 })
  }),
  Object.freeze({
    id: "c",
    featureId: "fighter-starting-equipment-package-c",
    name: "В) 155 зм",
    label: "В) 155 зм",
    description: "155 зм.",
    items: Object.freeze([]),
    currency: Object.freeze({ gp: 155 })
  })
]);

export function getFighterStartingEquipmentPackage(packageId) {
  return FIGHTER_STARTING_EQUIPMENT_PACKAGES.find((entry) => entry.id === String(packageId ?? "").trim()) ?? null;
}

export function getFighterStartingEquipmentPackageChoices() {
  return FIGHTER_STARTING_EQUIPMENT_PACKAGES.map((entry) => ({
    id: entry.id,
    label: entry.label,
    name: entry.name
  }));
}
