import {
  BARBARIAN_STARTING_EQUIPMENT_PACKAGES,
  BARBARIAN_STARTING_EQUIPMENT_PACKAGE_SOURCE_TYPE,
  getBarbarianStartingEquipmentPackage,
  getBarbarianStartingEquipmentPackageChoices
} from "./barbarian-starting-equipment.js";
import {
  FIGHTER_STARTING_EQUIPMENT_PACKAGES,
  FIGHTER_STARTING_EQUIPMENT_PACKAGE_SOURCE_TYPE,
  getFighterStartingEquipmentPackage,
  getFighterStartingEquipmentPackageChoices
} from "./fighter-starting-equipment.js";
import {
  PALADIN_STARTING_EQUIPMENT_PACKAGES,
  PALADIN_STARTING_EQUIPMENT_PACKAGE_SOURCE_TYPE,
  getPaladinStartingEquipmentPackage,
  getPaladinStartingEquipmentPackageChoices
} from "./paladin-starting-equipment.js";
import {
  ROGUE_STARTING_EQUIPMENT_PACKAGES,
  ROGUE_STARTING_EQUIPMENT_PACKAGE_SOURCE_TYPE,
  getRogueStartingEquipmentPackage,
  getRogueStartingEquipmentPackageChoices
} from "./rogue-starting-equipment.js";

export const CLASS_STARTING_EQUIPMENT_CONFIGS = Object.freeze([
  Object.freeze({
    classIdentifier: "barbarian-rework-v012",
    sourceType: BARBARIAN_STARTING_EQUIPMENT_PACKAGE_SOURCE_TYPE,
    packages: BARBARIAN_STARTING_EQUIPMENT_PACKAGES,
    choiceHint: "Выберите А или Б:",
    getPackage: getBarbarianStartingEquipmentPackage,
    getChoices: getBarbarianStartingEquipmentPackageChoices
  }),
  Object.freeze({
    classIdentifier: "fighter-rework-v028",
    sourceType: FIGHTER_STARTING_EQUIPMENT_PACKAGE_SOURCE_TYPE,
    packages: FIGHTER_STARTING_EQUIPMENT_PACKAGES,
    choiceHint: "Выберите А, Б или В:",
    getPackage: getFighterStartingEquipmentPackage,
    getChoices: getFighterStartingEquipmentPackageChoices
  }),
  Object.freeze({
    classIdentifier: "paladin-rework-v01",
    sourceType: PALADIN_STARTING_EQUIPMENT_PACKAGE_SOURCE_TYPE,
    packages: PALADIN_STARTING_EQUIPMENT_PACKAGES,
    choiceHint: "Выберите А или Б:",
    getPackage: getPaladinStartingEquipmentPackage,
    getChoices: getPaladinStartingEquipmentPackageChoices
  }),
  Object.freeze({
    classIdentifier: "rogue-rework-v00",
    sourceType: ROGUE_STARTING_EQUIPMENT_PACKAGE_SOURCE_TYPE,
    packages: ROGUE_STARTING_EQUIPMENT_PACKAGES,
    choiceHint: "Выберите А или Б:",
    getPackage: getRogueStartingEquipmentPackage,
    getChoices: getRogueStartingEquipmentPackageChoices
  })
]);

const CONFIG_BY_CLASS = new Map(CLASS_STARTING_EQUIPMENT_CONFIGS.map((entry) => [entry.classIdentifier, entry]));
const CONFIG_BY_SOURCE_TYPE = new Map(CLASS_STARTING_EQUIPMENT_CONFIGS.map((entry) => [entry.sourceType, entry]));

export function getClassStartingEquipmentConfig(classIdentifier) {
  return CONFIG_BY_CLASS.get(String(classIdentifier ?? "").trim()) ?? null;
}

export function getClassStartingEquipmentConfigBySourceType(sourceType) {
  return CONFIG_BY_SOURCE_TYPE.get(String(sourceType ?? "").trim()) ?? null;
}

export function isClassStartingEquipmentPackageSourceType(sourceType) {
  return CONFIG_BY_SOURCE_TYPE.has(String(sourceType ?? "").trim());
}

export function getClassStartingEquipmentPackage(sourceType, packageId) {
  return getClassStartingEquipmentConfigBySourceType(sourceType)?.getPackage(packageId) ?? null;
}
