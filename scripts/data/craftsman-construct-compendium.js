import {
  CRAFTSMAN_CONSTRUCT_DOCUMENT_ID,
  CRAFTSMAN_CONSTRUCT_TOKEN_PATH,
  CRAFTSMAN_CONSTRUCT_UUID,
  CRAFTSMAN_CONSTRUCTS_COMPENDIUM_LABEL,
  CRAFTSMAN_CONSTRUCTS_COMPENDIUM_NAME,
  MODULE_ID
} from "../constants.js";
import { syncFlaggedManagedDocuments } from "./managed-compendium-sync.js";

const PACK_ID = `world.${CRAFTSMAN_CONSTRUCTS_COMPENDIUM_NAME}`;
const SOURCE_ID = "craftsman-construct-template";
const TEMPLATE_VERSION = 1;
const SIGNATURE = `${SOURCE_ID}:${TEMPLATE_VERSION}`;
const OWNER_PERMISSION = 3;

function clone(value) {
  return globalThis.foundry?.utils?.deepClone
    ? globalThis.foundry.utils.deepClone(value)
    : structuredClone(value);
}

function collectionValues(collection) {
  if (Array.isArray(collection?.contents)) return collection.contents.filter(Boolean);
  if (Array.isArray(collection)) return collection.filter(Boolean);
  if (typeof collection?.values === "function") return Array.from(collection.values()).filter(Boolean);
  return [];
}

function ability(value, proficient = 0) {
  return { value, proficient, bonuses: { check: "", save: "" }, max: null };
}

function skill() {
  return { value: 0, ability: "", bonuses: { check: "", passive: "" }, roll: { min: null, max: null, mode: 0 } };
}

export function buildCraftsmanConstructActorData() {
  return {
    _id: CRAFTSMAN_CONSTRUCT_DOCUMENT_ID,
    name: "Конструкт",
    type: "npc",
    img: CRAFTSMAN_CONSTRUCT_TOKEN_PATH,
    ownership: { default: OWNER_PERMISSION },
    flags: {
      [MODULE_ID]: {
        managed: true,
        sourceId: SOURCE_ID,
        signature: SIGNATURE,
        craftsmanConstructTemplate: { version: TEMPLATE_VERSION }
      }
    },
    prototypeToken: {
      name: "Конструкт",
      actorLink: false,
      disposition: 1,
      texture: { src: CRAFTSMAN_CONSTRUCT_TOKEN_PATH },
      width: 1,
      height: 1,
      displayName: 20,
      displayBars: 20,
      bar1: { attribute: "attributes.hp" },
      sight: { enabled: true, range: 60, visionMode: "darkvision" }
    },
    system: {
      abilities: {
        str: ability(16),
        dex: ability(12, 1),
        con: ability(15),
        int: ability(8),
        wis: ability(10, 1),
        cha: ability(7)
      },
      attributes: {
        ac: { calc: "flat", flat: 14 },
        hp: { value: 5, max: 5, temp: 0, tempmax: 0, formula: "0d10" },
        movement: { burrow: 0, climb: 0, fly: 0, swim: 0, walk: 30, units: "ft", hover: false },
        senses: { blindsight: 0, darkvision: 60, tremorsense: 0, truesight: 0, units: "ft", special: "" }
      },
      details: {
        alignment: "Без мировоззрения",
        biography: { value: "<p>Средний конструкт, связанный со своим создателем.</p>", public: "" },
        type: { value: "construct", subtype: "", swarm: "", custom: "" },
        source: { book: "Rebreya: Shadow of Progress", page: "", custom: "", revision: 1 },
        cr: null
      },
      traits: {
        size: "med",
        di: { value: ["poison"], bypasses: [], custom: "" },
        dr: { value: [], bypasses: [], custom: "" },
        dv: { value: [], bypasses: [], custom: "" },
        ci: { value: ["poisoned", "charmed", "exhaustion"], custom: "" },
        languages: { value: [], custom: "Понимает языки создателя, но не говорит" },
        weaponProf: { value: ["sim", "mar"], custom: "Все виды оружия" },
        armorProf: { value: ["lgt", "med", "hvy", "shl"], custom: "Все виды доспехов" }
      },
      skills: Object.fromEntries([
        "acr", "ani", "arc", "ath", "dec", "his", "ins", "itm", "inv",
        "med", "nat", "prc", "prf", "per", "rel", "slt", "ste", "sur"
      ].map((id) => [id, skill()]))
    },
    items: [],
    effects: []
  };
}

function worldActorData() {
  const data = buildCraftsmanConstructActorData();
  delete data._id;
  data._stats = { compendiumSource: CRAFTSMAN_CONSTRUCT_UUID };
  data.flags.dnd5e = { isAutoImported: true };
  data.flags[MODULE_ID].technicalWorldActor = true;
  return data;
}

export class CraftsmanConstructCompendiumService {
  constructor(options = {}) {
    this.options = options;
  }

  async sync() {
    const game = this.options.gameProvider?.() ?? globalThis.game;
    const active = this.options.isActiveGmClient?.(game) ?? game?.user?.isGM === true;
    if (!active || game?.system?.id !== "dnd5e") {
      return { skipped: true, pack: null, worldActor: null };
    }
    const pack = await this.#ensurePack(game);
    const documents = await pack.getDocuments();
    await syncFlaggedManagedDocuments({
      pack,
      entries: [{ sourceId: SOURCE_ID, signature: SIGNATURE, documentId: CRAFTSMAN_CONSTRUCT_DOCUMENT_ID }],
      documents,
      moduleId: MODULE_ID,
      sourceIdFlag: "sourceId",
      buildData: () => buildCraftsmanConstructActorData()
    });
    const worldActor = await this.#syncWorldActor(game);
    return { skipped: false, pack, worldActor };
  }

  async #ensurePack(game) {
    let pack = game?.packs?.get?.(PACK_ID) ?? null;
    if (pack && (pack.documentName !== "Actor" || pack.metadata?.system !== "dnd5e")) {
      await pack.deleteCompendium?.();
      pack = null;
    }
    if (!pack) {
      const CompendiumCollection = globalThis.foundry?.documents?.collections?.CompendiumCollection;
      const create = this.options.createCompendium;
      const metadata = {
        name: CRAFTSMAN_CONSTRUCTS_COMPENDIUM_NAME,
        label: CRAFTSMAN_CONSTRUCTS_COMPENDIUM_LABEL,
        type: "Actor",
        system: "dnd5e",
        package: "world"
      };
      if (typeof create === "function") {
        pack = await create(metadata);
      }
      else if (typeof CompendiumCollection?.createCompendium === "function") {
        pack = await CompendiumCollection.createCompendium(metadata);
      }
      else {
        throw new TypeError("CompendiumCollection.createCompendium is required");
      }
    }
    return pack;
  }

  async #syncWorldActor(game) {
    const actors = collectionValues(game?.actors);
    const existing = actors.find((actor) => (
      actor?.getFlag?.(MODULE_ID, "technicalWorldActor") === true
      || actor?.flags?.[MODULE_ID]?.technicalWorldActor === true
    )) ?? null;
    const data = worldActorData();
    if (existing) {
      if (existing?.flags?.[MODULE_ID]?.signature !== SIGNATURE) await existing.update?.(clone(data));
      return existing;
    }
    const Actor = this.options.actorProvider?.() ?? globalThis.Actor;
    if (typeof Actor?.create !== "function") throw new TypeError("Actor.create is required");
    return Actor.create(data, { keepId: false });
  }
}
