export const PALADIN_STARTING_EQUIPMENT_PACKAGE_SOURCE_TYPE = "paladinStartingEquipmentPackage";

export const PALADIN_STARTING_EQUIPMENT_PACKAGES = Object.freeze([
  Object.freeze({
    id: "a",
    featureId: "paladin-starting-equipment-package-a",
    name: "А) Кольчуга, щит, длинный меч, 6 метательных копий, священный символ, набор священника и 9 зм",
    label: "А) Кольчуга, щит, длинный меч, 6 метательных копий, священный символ, набор священника и 9 зм",
    description: "Кольчуга, щит, длинный меч, 6 метательных копий, священный символ, набор священника и 9 зм.",
    items: Object.freeze([
      Object.freeze({ gearId: "kol-chuga", label: "Кольчуга" }),
      Object.freeze({ gearId: "shchit", label: "Щит" }),
      Object.freeze({ gearId: "dlinnyy-mech", label: "Длинный меч" }),
      Object.freeze({ gearId: "kop-e", label: "Метательное копьё", quantity: 6 }),
      Object.freeze({ gearId: "amulet-svyashchennyy-simvol", label: "Амулет (священный символ)" }),
      Object.freeze({ gearId: "nabor-svyashchennika", label: "Набор священника" })
    ]),
    currency: Object.freeze({ gp: 9 })
  }),
  Object.freeze({
    id: "b",
    featureId: "paladin-starting-equipment-package-b",
    name: "Б) 150 зм",
    label: "Б) 150 зм",
    description: "150 зм.",
    items: Object.freeze([]),
    currency: Object.freeze({ gp: 150 })
  })
]);

export function getPaladinStartingEquipmentPackage(packageId) {
  return PALADIN_STARTING_EQUIPMENT_PACKAGES.find((entry) => entry.id === String(packageId ?? "").trim()) ?? null;
}

export function getPaladinStartingEquipmentPackageChoices() {
  return PALADIN_STARTING_EQUIPMENT_PACKAGES.map((entry) => ({
    id: entry.id,
    label: entry.label,
    name: entry.name
  }));
}
