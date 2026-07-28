import { MODULE_ID } from "../constants.js";

const DEFINITIONS = Object.freeze({
  "nastroennye-servoprivody": { capabilities: [{ type: "abilityBonus", ability: "dex", value: 2, maximum: 22 }] },
  "sokrushitelnye-konechnosti": { capabilities: [{ type: "abilityMinimum", ability: "str", value: 19 }] },
  "pomoshch-v-postroenii-traektorii": { capabilities: [{ type: "weaponAttackBonus", value: 1 }] },
  "dopolnitelnaya-konechnost": { stackable: true, capabilities: [{ type: "secondaryHand", value: 1 }] },
  "kondensator-magii": { capabilities: [{ type: "spellCondenser" }] },
  "impulsnye-nogi": { capabilities: [{ type: "impulseLegs" }] },
  "modul-chuvstva-zhizni": { capabilities: [{ type: "lifeSense", range: 30 }] },
  "ultrazvukovye-datchiki": { capabilities: [{ type: "senseMinimum", sense: "blindsight", value: 10 }] },
  "modul-pareniya": { capabilities: [{ type: "hover" }] },
  "telepaticheskiy-modul": { capabilities: [{ type: "telepathy" }] },
  "silnye-nogi": { capabilities: [{ type: "movementBonus", movement: "walk", value: 10 }] },
  "mekhanizm-perezaryadki-oruzhiya": { capabilities: [{ type: "reloadWithoutFreeHand" }] },
  "velikoe-khranilishche-energii": { capabilities: [{ type: "electricalStorage" }] },
  "sintezator-yada": { capabilities: [{ type: "poisonSynthesizer", diceMaximum: 12 }] },
  "monolitnoe-telo": { capabilities: [{ type: "saveAdvantage", ability: "str" }] },
  "otkalibrovannye-servoprivody": { capabilities: [{ type: "saveAdvantage", ability: "dex" }] },
  "navesnaya-bronya": { capabilities: [{ type: "armorClassBonus", value: 1 }] },
  "vstroennyy-stanok": { capabilities: [{ type: "artisanToolBonus", value: 2 }] },
  "modul-nochnogo-zreniya": { capabilities: [{ type: "senseMinimum", sense: "darkvision", value: 60 }] },
  "impulsnye-dvigateli": { capabilities: [{ type: "impulseEngines", jumpMultiplier: 2, fallAbsorption: 30 }] },
  "modul-s-preparatami": { capabilities: [{ type: "medicineModule" }] },
  "sistema-termokontrolya": { capabilities: [{ type: "extremeTemperatureAdaptation" }] },
  "ukreplyonnye-sustavy": { capabilities: [{ type: "carryingStrengthBonus", value: 2 }] },
  "modul-ukrepleniya-tela": { capabilities: [{ type: "abilityCheckAndSaveBonus", ability: "con", value: 1 }] },
  "mnogofunktsionalnyy-zakhvat": { capabilities: [{ type: "multiToolGrip" }] },
  "razrisovannyy-korpus": { capabilities: [{ type: "paintedBodyProvocation", range: 10, value: 1 }] },
  "usilennye-ladoni": { capabilities: [{ type: "climbingHand" }] },
  "krepkiy-sharnir": { capabilities: [{ type: "grappleShoveBonus", value: 2 }] },
  "magnitnaya-ladon": { capabilities: [{ type: "magneticPalm", range: 30, maximumWeight: 5 }] },
  "mozg-chudovishcha": { capabilities: [{ type: "abilityBonus", ability: "int", value: 1, maximum: 20 }] },
  "raketnaya-tyaga": { capabilities: [{ type: "rocketThrust", minutesMaximum: 60 }] },
  "modul-vosstanovleniya": { capabilities: [{ type: "turnRegeneration", value: 1, minimumHitPoints: 2 }] },
  "konteyner-dlya-familyara": { capabilities: [{ type: "familiarContainer" }] },
  "simbioticheskiy-mozg": { capabilities: [{ type: "intelligenceChecksAndInitiativeBonus", value: 2 }, { type: "symbioticSpells" }] },
  "ruka-boga": { capabilities: [{ type: "craftingInvestmentBonus", ordinary: 5, construct: 10 }] },
  "khranilishche-neveroyatnoy-pronitsatelnosti": { capabilities: [{ type: "insightStorage", goldMaximum: 10000, potionLevelMaximum: 7 }] }
});

function getModuleFlag(document, key) {
  if (typeof document?.getFlag === "function") {
    const value = document.getFlag(MODULE_ID, key);
    if (value !== undefined) return value;
  }
  return document?.flags?.[MODULE_ID]?.[key];
}

function cloneDefinition(id, definition) {
  return {
    id,
    stackable: definition.stackable === true,
    capabilities: definition.capabilities.map((capability) => ({ ...capability }))
  };
}

export const SUPPORTED_MECHANICAL_IMPLANT_IDS = new Set(Object.keys(DEFINITIONS));

export function getMechanicalImplantDefinition(item) {
  const implant = getModuleFlag(item, "implant");
  if (!implant || implant.kind === "magical" || implant.magical === true) return null;
  const gearId = String(getModuleFlag(item, "gearId") ?? "").trim();
  const definition = DEFINITIONS[gearId];
  return definition ? cloneDefinition(gearId, definition) : null;
}

function effectChange(key, mode, value) {
  return { key, mode, value: String(value), priority: 20 };
}

function capabilityChanges(capability) {
  switch (capability.type) {
    case "abilityBonus":
      return [effectChange(`system.abilities.${capability.ability}.value`, 2, capability.value)];
    case "abilityMinimum":
      return [effectChange(`system.abilities.${capability.ability}.value`, 4, capability.value)];
    case "weaponAttackBonus":
      return [
        effectChange("system.bonuses.mwak.attack", 2, capability.value),
        effectChange("system.bonuses.rwak.attack", 2, capability.value)
      ];
    case "senseMinimum":
      return [effectChange(`system.attributes.senses.${capability.sense}`, 4, capability.value)];
    case "hover":
      return [effectChange("system.attributes.movement.hover", 5, "true")];
    case "movementBonus":
      return [effectChange(`system.attributes.movement.${capability.movement}`, 2, capability.value)];
    case "saveAdvantage":
      return [effectChange(`system.abilities.${capability.ability}.save.roll.mode`, 5, 1)];
    case "armorClassBonus":
      return [effectChange("system.attributes.ac.bonus", 2, capability.value)];
    case "abilityCheckAndSaveBonus":
      return [
        effectChange(`system.abilities.${capability.ability}.bonuses.check`, 2, capability.value),
        effectChange(`system.abilities.${capability.ability}.bonuses.save`, 2, capability.value)
      ];
    case "intelligenceChecksAndInitiativeBonus":
      return [
        effectChange("system.abilities.int.bonuses.check", 2, capability.value),
        effectChange("system.attributes.init.bonus", 2, capability.value)
      ];
    default:
      return [];
  }
}

function mergeChanges(changes) {
  const byKey = new Map();
  for (const change of changes) {
    const current = byKey.get(change.key);
    if (!current) {
      byKey.set(change.key, { ...change });
      continue;
    }
    if (current.mode === 2 && change.mode === 2) {
      current.value = String(Number(current.value) + Number(change.value));
    }
    else if (current.mode === 4 && change.mode === 4) {
      current.value = String(Math.max(Number(current.value), Number(change.value)));
    }
    else {
      byKey.set(change.key, { ...change });
    }
  }
  return [...byKey.values()].sort((left, right) => left.key.localeCompare(right.key, "en"));
}

export function compileMechanicalImplants(actorOrPlanned, maybePlanned) {
  const planned = Array.isArray(actorOrPlanned) ? actorOrPlanned : maybePlanned;
  if (!Array.isArray(planned)) {
    return { changes: [], actorFlags: {}, capabilities: [], warnings: [] };
  }

  const changes = [];
  const capabilities = [];
  const actorFlags = {};
  for (const entry of planned) {
    if (entry?.state?.installed !== true || entry?.effective !== true) continue;
    const definition = getMechanicalImplantDefinition(entry.item);
    if (!definition) continue;
    const count = definition.stackable
      ? Math.max(1, Math.floor(Number(entry.state.installedCount ?? 1)))
      : 1;
    for (const capability of definition.capabilities) {
      const compiledCapability = { implantId: definition.id, count, ...capability };
      capabilities.push(compiledCapability);
      for (let index = 0; index < count; index += 1) {
        changes.push(...capabilityChanges(capability));
      }
      if (capability.type === "abilityBonus" && Number.isFinite(Number(capability.maximum))) {
        actorFlags.abilityMaximums ??= {};
        actorFlags.abilityMaximums[capability.ability] = Number(capability.maximum);
      }
      if (capability.type === "secondaryHand") {
        actorFlags.secondaryHands = (actorFlags.secondaryHands ?? 0) + (Number(capability.value) * count);
      }
      if (capability.type === "carryingStrengthBonus") {
        actorFlags.carryingStrengthBonus = (actorFlags.carryingStrengthBonus ?? 0) + Number(capability.value);
      }
      if (capability.type === "extremeTemperatureAdaptation") {
        actorFlags.extremeTemperatureAdaptation = true;
      }
    }
  }
  capabilities.sort((left, right) => (
    left.implantId.localeCompare(right.implantId, "en")
    || left.type.localeCompare(right.type, "en")
  ));
  return {
    changes: mergeChanges(changes),
    actorFlags,
    capabilities,
    warnings: []
  };
}
