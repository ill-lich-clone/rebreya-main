export const BARBARIAN_STARTING_EQUIPMENT_PACKAGE_SOURCE_TYPE = "barbarianStartingEquipmentPackage";

export const BARBARIAN_STARTING_EQUIPMENT_PACKAGES = Object.freeze([
  Object.freeze({
    id: "a",
    featureId: "barbarian-starting-equipment-package-a",
    name: "А) Секира, 4 ручных топора, набор путешественника и 15 зм",
    label: "А) Секира, 4 ручных топора, набор путешественника и 15 зм",
    description: "Секира, 4 ручных топора, набор путешественника и 15 зм.",
    items: Object.freeze([
      Object.freeze({ gearId: "sekira", label: "Секира" }),
      Object.freeze({ gearId: "ruchnoy-topor", label: "Ручной топор", quantity: 4 }),
      Object.freeze({ gearId: "nabor-puteshestvennika", label: "Набор путешественника" })
    ]),
    currency: Object.freeze({ gp: 15 })
  }),
  Object.freeze({
    id: "b",
    featureId: "barbarian-starting-equipment-package-b",
    name: "Б) 75 зм",
    label: "Б) 75 зм",
    description: "75 зм.",
    items: Object.freeze([]),
    currency: Object.freeze({ gp: 75 })
  })
]);

export function getBarbarianStartingEquipmentPackage(packageId) {
  return BARBARIAN_STARTING_EQUIPMENT_PACKAGES.find((entry) => entry.id === String(packageId ?? "").trim()) ?? null;
}

export function getBarbarianStartingEquipmentPackageChoices() {
  return BARBARIAN_STARTING_EQUIPMENT_PACKAGES.map((entry) => ({
    id: entry.id,
    label: entry.label,
    name: entry.name
  }));
}
