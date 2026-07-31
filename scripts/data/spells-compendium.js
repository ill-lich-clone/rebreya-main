import {
  MODULE_ID,
  SPELLS_COMPENDIUM_LABEL,
  SPELLS_COMPENDIUM_NAME
} from "../constants.js";
import { isActiveGmClient } from "../infrastructure/foundry/active-gm.js";
import { buildCounterspellActivity } from "./counterspell-activity.js";
import { ensurePackSidebarFolder } from "./compendium-utils.js";
import { syncFlaggedManagedDocuments } from "./managed-compendium-sync.js";
import {
  MELFS_MINUTE_METEORS_ID,
  MELFS_MINUTE_METEORS_RECIPE,
  MELFS_MINUTE_METEORS_VERSION,
  buildMelfsMinuteMeteorsItem
} from "./melfs-minute-meteors-item.js";

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

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableValue(value[key])])) ;
  }
  return value;
}

function stableSignature(value) {
  return JSON.stringify(stableValue(value));
}

function normalizedSourceDefinition(entry) {
  const id = cleanString(entry?.id);
  const sourceIdentifier = cleanString(entry?.sourceIdentifier);
  if (id === COUNTERSPELL_ID && sourceIdentifier && !cleanString(entry?.builder) && entry?.version == null) {
    return { id, sourceIdentifier };
  }
  return null;
}

function normalizedBuilderDefinition(entry) {
  const id = cleanString(entry?.id);
  const builder = cleanString(entry?.builder);
  const version = Number(entry?.version);
  if (id === MELFS_MINUTE_METEORS_ID
    && builder === MELFS_MINUTE_METEORS_RECIPE
    && version === MELFS_MINUTE_METEORS_VERSION
    && !cleanString(entry?.sourceIdentifier)) {
    return { id, builder, version };
  }
  return null;
}

export async function loadSpellDefinitions() {
  const response = await fetch(SPELLS_DATA_PATH, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`Failed to load ${SPELLS_DATA_PATH}: ${response.status} ${response.statusText}`);
  }

  const data = await response.json();
  const sourcePack = cleanString(data?.sourcePack, "dnd5e.spells");
  const spells = (Array.isArray(data?.spells) ? data.spells : []).map((entry) => {
    const definition = normalizedSourceDefinition(entry) ?? normalizedBuilderDefinition(entry);
    if (!definition) throw new Error(`Invalid spell definition: ${cleanString(entry?.id, "unknown")}`);
    return definition;
  });

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

export function buildManagedSpellEntry(definition, source = null) {
  const data = definition?.builder === MELFS_MINUTE_METEORS_RECIPE
    ? buildMelfsMinuteMeteorsItem()
    : buildRebreyaSpellItem(source);
  data.flags ??= {};
  data.flags[MODULE_ID] = {
    ...(data.flags[MODULE_ID] ?? {}),
    managed: true,
    spellId: definition.id
  };
  const signature = stableSignature({
    builder: definition.builder ?? "source",
    name: data.name,
    version: definition.version ?? null,
    system: data.system,
    flags: data.flags
  });
  data.flags[MODULE_ID].signature = signature;
  return {
    spellId: definition.id,
    documentId: cleanString(data._id),
    signature,
    data
  };
}

async function getPackDocuments(pack) {
  const documents = await pack.getDocuments();
  return Array.isArray(documents) ? documents : [];
}

export class SpellsCompendiumService {
  async sync() {
    if (!game.user?.isGM || !isDnd5eWorld()) {
      return null;
    }
    if (!isActiveGmClient(game)) {
      return {
        skipped: true,
        pack: null,
        sync: { skipped: true, unchanged: 0, created: 0, updated: 0, deleted: 0 }
      };
    }

    const { sourcePack, spells } = await loadSpellDefinitions();
    const pack = await ensurePack();
    const entries = [];
    for (const definition of spells) {
      if (definition.sourceIdentifier) {
        const sourceDocument = await resolveSourceSpell(sourcePack, definition.sourceIdentifier);
        if (!sourceDocument) {
          throw new Error(`Unable to load dnd5e spell '${definition.sourceIdentifier}'.`);
        }
        entries.push(buildManagedSpellEntry(definition, getSpellSource(sourceDocument)));
      }
      else {
        entries.push(buildManagedSpellEntry(definition));
      }
    }

    const sync = await syncFlaggedManagedDocuments({
      pack,
      entries,
      documents: await getPackDocuments(pack),
      moduleId: MODULE_ID,
      sourceIdFlag: "spellId",
      buildData: (entry) => entry.data
    });
    return { pack: game.packs.get(PACK_ID) ?? pack, sync };
  }
}
