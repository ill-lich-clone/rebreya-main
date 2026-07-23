import {
  MODULE_ID,
  SPELLS_COMPENDIUM_LABEL,
  SPELLS_COMPENDIUM_NAME
} from "../constants.js";
import { ensurePackSidebarFolder } from "./compendium-utils.js";

const DND5E_SYSTEM_ID = "dnd5e";
const PACK_ID = `world.${SPELLS_COMPENDIUM_NAME}`;
const REBREYA_SOURCE_LABEL = "Rebreya";
const SPELLS_DATA_PATH = `modules/${MODULE_ID}/data/rebreya-spells-v01.json`;
const COUNTERSPELL_ID = "counterspell-rebreya";

function cleanString(value, fallback = "") {
  const text = String(value ?? "").trim();
  return text || fallback;
}

function clone(value) {
  if (globalThis.foundry?.utils?.deepClone) {
    return globalThis.foundry.utils.deepClone(value);
  }

  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function getProperty(object, path) {
  if (globalThis.foundry?.utils?.getProperty) {
    return globalThis.foundry.utils.getProperty(object, path);
  }

  return String(path ?? "").split(".").reduce((value, key) => value?.[key], object);
}

function getObserverOwnership() {
  return globalThis.CONST?.DOCUMENT_OWNERSHIP_LEVELS?.OBSERVER ?? 2;
}

function isDnd5eWorld() {
  return game.system?.id === DND5E_SYSTEM_ID;
}

function getDesiredPackMetadata() {
  return {
    label: SPELLS_COMPENDIUM_LABEL,
    type: "Item",
    name: SPELLS_COMPENDIUM_NAME,
    system: game.system.id,
    ownership: {
      PLAYER: "OBSERVER",
      ASSISTANT: "OWNER"
    },
    flags: {
      dnd5e: {
        sourceBook: REBREYA_SOURCE_LABEL,
        types: ["spell"]
      }
    }
  };
}

async function ensurePack() {
  const desired = getDesiredPackMetadata();
  let pack = game.packs.get(PACK_ID);

  if (pack && (pack.documentName !== desired.type || pack.metadata?.system !== desired.system)) {
    if (typeof pack.deleteCompendium === "function") {
      await pack.deleteCompendium();
    }
    pack = null;
  }

  if (!pack) {
    pack = await foundry.documents.collections.CompendiumCollection.createCompendium(desired);
  }

  try {
    await ensurePackSidebarFolder(pack, [REBREYA_SOURCE_LABEL]);
  }
  catch (error) {
    console.warn(`${MODULE_ID} | Failed to assign spells compendium to the Rebreya sidebar folder.`, error);
  }

  return pack;
}

async function loadSpellDefinitions() {
  const response = await fetch(SPELLS_DATA_PATH, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`Failed to load ${SPELLS_DATA_PATH}: ${response.status} ${response.statusText}`);
  }

  const data = await response.json();
  const sourcePack = cleanString(data?.sourcePack, "dnd5e.spells");
  const spells = (Array.isArray(data?.spells) ? data.spells : [])
    .map((entry) => ({
      id: cleanString(entry?.id),
      sourceIdentifier: cleanString(entry?.sourceIdentifier)
    }))
    .filter((entry) => entry.id && entry.sourceIdentifier);

  return { sourcePack, spells };
}

async function resolveSourceSpell(sourcePackId, sourceIdentifier) {
  const sourcePack = game.packs.get(sourcePackId);
  if (!sourcePack) {
    throw new Error(`Required dnd5e spell pack '${sourcePackId}' was not found.`);
  }

  const index = await sourcePack.getIndex({ fields: ["system.identifier"] });
  const identifier = cleanString(sourceIdentifier).toLowerCase();
  const entry = index.find((candidate) => (
    cleanString(getProperty(candidate, "system.identifier")).toLowerCase() === identifier
  ));
  if (!entry) {
    throw new Error(`Required dnd5e spell '${sourceIdentifier}' was not found in '${sourcePackId}'.`);
  }

  return sourcePack.getDocument(entry._id ?? entry.id);
}

function getSpellSource(document) {
  if (typeof document?.toObject === "function") {
    return document.toObject();
  }

  return document;
}

function buildCounterspellActivity(sourceSystem = {}) {
  const activities = sourceSystem.activities && typeof sourceSystem.activities === "object"
    ? sourceSystem.activities
    : {};
  const sourceActivity = activities.counterspell
    ?? Object.values(activities).find((activity) => cleanString(activity?._id) === "counterspell")
    ?? Object.values(activities)[0]
    ?? {};

  const {
    check: _check,
    save: _save,
    attack: _attack,
    damage: _damage,
    ...activity
  } = clone(sourceActivity) ?? {};

  return {
    ...activity,
    _id: "counterspell",
    type: "utility",
    activation: {
      ...(activity.activation ?? {}),
      type: "reaction",
      value: activity.activation?.value ?? 1
    },
    consumption: {
      ...(activity.consumption ?? {}),
      targets: Array.isArray(activity.consumption?.targets) ? activity.consumption.targets : [],
      scaling: {
        ...(activity.consumption?.scaling ?? {}),
        allowed: true,
        max: activity.consumption?.scaling?.max ?? ""
      }
    },
    spell: {
      ...(activity.spell ?? {}),
      level: 3,
      scaling: {
        ...(activity.spell?.scaling ?? {}),
        mode: "level",
        formula: activity.spell?.scaling?.formula ?? ""
      }
    }
  };
}

export function buildRebreyaSpellItem(source) {
  const item = clone(source) ?? {};
  const sourceSystem = item.system ?? {};
  const sourceFlags = item.flags ?? {};
  delete item._id;

  return {
    ...item,
    type: "spell",
    ownership: {
      default: getObserverOwnership()
    },
    system: {
      ...sourceSystem,
      identifier: COUNTERSPELL_ID,
      source: {
        ...(sourceSystem.source ?? {}),
        custom: REBREYA_SOURCE_LABEL
      },
      activities: {
        counterspell: buildCounterspellActivity(sourceSystem)
      }
    },
    flags: {
      ...sourceFlags,
      dnd5e: {
        ...(sourceFlags.dnd5e ?? {}),
        riders: {
          ...(sourceFlags.dnd5e?.riders ?? {}),
          activity: []
        }
      },
      [MODULE_ID]: {
        ...(sourceFlags[MODULE_ID] ?? {}),
        managed: true,
        spellId: COUNTERSPELL_ID,
        spellAutomation: {
          kind: "counterspell"
        }
      }
    }
  };
}

function isManagedSpell(document, spellId) {
  return document?.getFlag?.(MODULE_ID, "spellId") === spellId
    || cleanString(getProperty(document, "system.identifier")) === spellId;
}

async function getPackDocuments(pack) {
  const documents = await pack.getDocuments();
  return Array.isArray(documents) ? documents : [];
}

async function syncSpell(pack, definition, source) {
  if (definition.id !== COUNTERSPELL_ID) {
    return;
  }

  const documents = await getPackDocuments(pack);
  const existing = documents.find((document) => isManagedSpell(document, definition.id));
  const itemData = buildRebreyaSpellItem(source);
  if (!existing) {
    await Item.implementation.createDocuments([itemData], { pack: pack.collection });
    return;
  }

  await Item.implementation.updateDocuments([{
    ...itemData,
    _id: existing.id ?? existing._id
  }], { pack: pack.collection });
}

export class SpellsCompendiumService {
  async sync() {
    if (!game.user?.isGM || !isDnd5eWorld()) {
      return null;
    }

    const { sourcePack, spells } = await loadSpellDefinitions();
    const pack = await ensurePack();
    for (const definition of spells) {
      const sourceDocument = await resolveSourceSpell(sourcePack, definition.sourceIdentifier);
      if (!sourceDocument) {
        throw new Error(`Unable to load dnd5e spell '${definition.sourceIdentifier}'.`);
      }
      await syncSpell(pack, definition, getSpellSource(sourceDocument));
    }

    return game.packs.get(PACK_ID) ?? pack;
  }
}
