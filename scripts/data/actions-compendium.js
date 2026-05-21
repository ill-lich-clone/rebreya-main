import {
  ACTIONS_COMPENDIUM_LABEL,
  ACTIONS_COMPENDIUM_NAME,
  MODULE_ID
} from "../constants.js";
import { ensurePackSidebarFolder } from "./compendium-utils.js";

const PACK_ID = `world.${ACTIONS_COMPENDIUM_NAME}`;
const DND5E_SYSTEM_ID = "dnd5e";
const SOURCE_LABEL = "Глоссарий БЕТА Заметки о землях Тейванкаля, 2-я редакция";
const COMPENDIUM_SIDEBAR_FOLDER = ["Ребрея"];
const DEFAULT_ACTION_ITEM_TYPE = "feat";

function cleanString(value, fallback = "") {
  const text = String(value ?? "").trim();
  return text || fallback;
}

function isDnd5eWorld() {
  return game.system?.id === DND5E_SYSTEM_ID;
}

function getPackSourceBook(pack) {
  return cleanString(foundry.utils.getProperty(pack, "metadata.flags.dnd5e.sourceBook"));
}

async function getPackDocuments(pack) {
  const documents = await pack.getDocuments();
  return Array.isArray(documents) ? documents : [];
}

function getDesiredPackMetadata() {
  return {
    label: ACTIONS_COMPENDIUM_LABEL,
    type: "Item",
    name: ACTIONS_COMPENDIUM_NAME,
    system: game.system.id,
    ownership: {
      PLAYER: "OBSERVER",
      ASSISTANT: "OWNER"
    },
    flags: {
      dnd5e: {
        sourceBook: SOURCE_LABEL,
        types: [DEFAULT_ACTION_ITEM_TYPE]
      }
    }
  };
}

async function ensurePack() {
  const desired = getDesiredPackMetadata();
  let pack = game.packs.get(PACK_ID);

  if (pack && pack.documentName !== desired.type) {
    if (typeof pack.deleteCompendium === "function") {
      await pack.deleteCompendium();
    }
    pack = null;
  }

  if (pack && desired.system && pack.metadata.system !== desired.system) {
    if (typeof pack.deleteCompendium === "function") {
      await pack.deleteCompendium();
    }
    pack = null;
  }

  if (pack && getPackSourceBook(pack) !== SOURCE_LABEL) {
    const documents = await getPackDocuments(pack);
    const unmanagedDocuments = documents.filter((document) => !document.getFlag(MODULE_ID, "managed"));

    if (unmanagedDocuments.length) {
      console.warn(
        `${MODULE_ID} | Actions compendium source is '${getPackSourceBook(pack)}', expected '${SOURCE_LABEL}', `
        + "but the pack has unmanaged documents and will not be recreated automatically."
      );
    }
    else if (typeof pack.deleteCompendium === "function") {
      await pack.deleteCompendium();
      pack = null;
    }
  }

  if (!pack) {
    pack = await foundry.documents.collections.CompendiumCollection.createCompendium(desired);
  }

  try {
    await ensurePackSidebarFolder(pack, COMPENDIUM_SIDEBAR_FOLDER);
  }
  catch (error) {
    console.warn(`${MODULE_ID} | Failed to assign actions compendium to sidebar folder '${COMPENDIUM_SIDEBAR_FOLDER.join("/")}'.`, error);
  }

  return pack;
}

export class ActionsCompendiumService {
  async sync() {
    if (!game.user?.isGM || !isDnd5eWorld()) {
      return null;
    }

    return ensurePack();
  }
}
