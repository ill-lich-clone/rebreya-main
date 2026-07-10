export const SORCERER_STARTING_EQUIPMENT_PACKAGE_SOURCE_TYPE = "sorcererStartingEquipmentPackage";

export const SORCERER_STARTING_EQUIPMENT_PACKAGES = Object.freeze([
  Object.freeze({
    id: "a",
    featureId: "sorcerer-starting-equipment-package-a",
    name: "А) Копьё, 2 кинжала, магическая фокусировка (кристалл), набор исследователя подземелий и 28 зм",
    label: "А) Копьё, 2 кинжала, магическая фокусировка (кристалл), набор исследователя подземелий и 28 зм",
    description: "Копьё, 2 кинжала, магическая фокусировка (кристалл), набор исследователя подземелий и 28 зм.",
    items: Object.freeze([
      Object.freeze({ gearId: "kop-e", label: "Копьё" }),
      Object.freeze({ gearId: "kinzhal", label: "Кинжал", quantity: 2 }),
      Object.freeze({ gearId: "kristall-fokusirovka", label: "Кристалл (фокусировка)" }),
      Object.freeze({ gearId: "nabor-issledovatelya-podzemeliy", label: "Набор исследователя подземелий" })
    ]),
    currency: Object.freeze({ gp: 28 })
  }),
  Object.freeze({
    id: "b",
    featureId: "sorcerer-starting-equipment-package-b",
    name: "Б) 50 зм",
    label: "Б) 50 зм",
    description: "50 зм.",
    items: Object.freeze([]),
    currency: Object.freeze({ gp: 50 })
  })
]);

export function getSorcererStartingEquipmentPackage(packageId) {
  return SORCERER_STARTING_EQUIPMENT_PACKAGES.find((entry) => entry.id === String(packageId ?? "").trim()) ?? null;
}

export function getSorcererStartingEquipmentPackageChoices() {
  return SORCERER_STARTING_EQUIPMENT_PACKAGES.map((entry) => ({
    id: entry.id,
    label: entry.label,
    name: entry.name
  }));
}
