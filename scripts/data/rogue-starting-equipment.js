export const ROGUE_STARTING_EQUIPMENT_PACKAGE_SOURCE_TYPE = "rogueStartingEquipmentPackage";

export const ROGUE_STARTING_EQUIPMENT_PACKAGES = Object.freeze([
  Object.freeze({
    id: "a",
    featureId: "rogue-starting-equipment-package-a",
    name: "А) Кожаный доспех, 2 кинжала, короткий меч, короткий лук, 20 стрел, колчан, воровские инструменты, набор взломщика и 8 зм",
    label: "А) Кожаный доспех, 2 кинжала, короткий меч, короткий лук, 20 стрел, колчан, воровские инструменты, набор взломщика и 8 зм",
    description: "Кожаный доспех, 2 кинжала, короткий меч, короткий лук, 20 стрел, колчан, воровские инструменты, набор взломщика и 8 зм.",
    items: Object.freeze([
      Object.freeze({ gearId: "kozhanyy-dospekh", label: "Кожаный доспех" }),
      Object.freeze({ gearId: "kinzhal", label: "Кинжал", quantity: 2 }),
      Object.freeze({ gearId: "korotkiy-mech", label: "Короткий меч" }),
      Object.freeze({ gearId: "korotkiy-luk", label: "Короткий лук" }),
      Object.freeze({ gearId: "strely-20", label: "Стрелы (20)" }),
      Object.freeze({ gearId: "kolchan", label: "Колчан" }),
      Object.freeze({ gearId: "instrumenty-vorovskie-0-y-rang", label: "Инструменты воровские 0-й ранг" }),
      Object.freeze({ gearId: "nabor-vzlomshchika", label: "Набор взломщика" })
    ]),
    currency: Object.freeze({ gp: 8 })
  }),
  Object.freeze({
    id: "b",
    featureId: "rogue-starting-equipment-package-b",
    name: "Б) 100 зм",
    label: "Б) 100 зм",
    description: "100 зм.",
    items: Object.freeze([]),
    currency: Object.freeze({ gp: 100 })
  })
]);

export function getRogueStartingEquipmentPackage(packageId) {
  return ROGUE_STARTING_EQUIPMENT_PACKAGES.find((entry) => entry.id === String(packageId ?? "").trim()) ?? null;
}

export function getRogueStartingEquipmentPackageChoices() {
  return ROGUE_STARTING_EQUIPMENT_PACKAGES.map((entry) => ({
    id: entry.id,
    label: entry.label,
    name: entry.name
  }));
}
