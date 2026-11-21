/**
 * Site build → embedded dnd5e Items (class, subclass, race, background and the
 * features their advancement grants). Foundry side of site-build-resolver.js.
 *
 * Applies, non-interactively, what dnd5e's AdvancementManager would apply
 * automatically: non-optional ItemGrant features up to the class level, the
 * Subclass link, HitPoints (max at 1st level, average after) and a fixed race
 * size. Choices (skills, ASI, optional features) are left to the player — the
 * site already supplies final ability scores, saves and skills.
 *
 * Granted items carry the same flags dnd5e sets (flags.dnd5e.sourceId /
 * advancementOrigin / advancementRoot) and are recorded in the advancement
 * `value`, so later level-ups and removals through the dnd5e UI work.
 *
 * Every item created here is flagged `flags.rebreya-main.siteBuild`; a
 * re-import deletes and recreates only those. Classes, races or backgrounds the
 * player added by hand are kept and the site's matching item is skipped.
 */
import { MODULE_ID } from "../constants.js";
import {
  SRD_PACKS,
  resolveBuildPlan,
  collectGrants,
  hitPointsValue,
  subclassLevel,
  raceSize,
  applyAdvancementValues,
  buildPlaceholderItem,
  hitDieFor,
} from "../data/site-build-resolver.js";

const FLAG = "siteBuild";
const DESCRIPTION_LIMIT = 4000;

const randomId = () => globalThis.foundry.utils.randomID();

export class SiteBuildImporter {
  /**
   * @param {object} opts
   * @param {object|null} [opts.api] RebreyaSiteApi (for placeholder descriptions)
   * @param {string} [opts.baseUrl]
   */
  constructor({ api = null, baseUrl = "https://rebreya.com" } = {}) {
    this.api = api;
    this.baseUrl = baseUrl;
    this._indexes = new Map();
  }

  /**
   * @param {Actor} actor dnd5e character
   * @param {object} character site character record
   * @returns {Promise<{created:number, classes:string[], warnings:string[]}>}
   */
  async import(actor, character) {
    const plan = resolveBuildPlan(character);
    const warnings = [];
    const items = [];
    const ours = actor.items.filter((i) => i.getFlag(MODULE_ID, FLAG));
    const oursIds = new Set(ours.map((i) => i.id));
    const foreign = actor.items.filter((i) => !oursIds.has(i.id));
    const foreignClassIds = new Set(foreign.filter((i) => i.type === "class").map((i) => i.system?.identifier));
    const hasForeign = (type) => foreign.some((i) => i.type === type);

    const actorUpdate = {};
    const subclassLinks = [];
    let primaryClassId = null;
    let spellcastingAbility = null;

    for (const cls of plan.classes) {
      if (foreignClassIds.has(cls.identifier)) {
        warnings.push(`Класс «${cls.name || cls.identifier}» уже есть на листе (добавлен вручную) — оставлен как есть.`);
        continue;
      }
      const built = await this.#buildClass(cls, warnings);
      if (!built) continue;
      items.push(...built.items);
      if (built.subclassLink) subclassLinks.push(built.subclassLink);
      if (cls.primary || !primaryClassId) primaryClassId = built.classId;
      const ability = built.spellcastingAbility;
      if (ability && (cls.primary || !spellcastingAbility)) spellcastingAbility = ability;
    }

    if (plan.race) {
      if (hasForeign("race")) warnings.push("Раса уже есть на листе (добавлена вручную) — оставлена как есть.");
      else {
        const built = await this.#buildOrigin("race", plan.race, plan.totalLevel, warnings);
        items.push(...built.items);
        if (built.size) foundry.utils.setProperty(actorUpdate, "system.traits.size", built.size);
      }
    }
    if (plan.background) {
      if (hasForeign("background")) warnings.push("Предыстория уже есть на листе (добавлена вручную) — оставлена как есть.");
      else items.push(...(await this.#buildOrigin("background", plan.background, plan.totalLevel, warnings)).items);
    }

    // Build everything first, then swap: a failed lookup never leaves the Actor half-cleared.
    if (ours.length) await actor.deleteEmbeddedDocuments("Item", ours.map((i) => i.id));
    let createdCount = 0;
    if (items.length) {
      const created = await actor.createEmbeddedDocuments("Item", items, { keepId: true });
      createdCount = created.length;
      // Foundry drops an invalid Item from a batch with only a UI error — report it.
      const createdIds = new Set(created.map((i) => i.id));
      for (const data of items) {
        if (!createdIds.has(data._id)) warnings.push(`Не удалось создать «${data.name}» (${data.type}) — dnd5e отклонил данные.`);
      }
    }

    // The Subclass advancement's `document` is a LocalDocumentField: it only
    // validates once the subclass Item exists, so set it after creation.
    for (const link of subclassLinks) {
      const classItem = actor.items.get(link.classId);
      if (!classItem || !actor.items.get(link.subclassId)) continue;
      try {
        await classItem.updateAdvancement(link.advancementId, { value: { document: link.subclassId, uuid: link.uuid } });
      } catch (error) {
        console.warn(`${MODULE_ID} | Could not link subclass advancement.`, error);
      }
    }

    if (primaryClassId) actorUpdate["system.details.originalClass"] = primaryClassId;
    if (spellcastingAbility) actorUpdate["system.attributes.spellcasting"] = spellcastingAbility;
    if (Object.keys(actorUpdate).length) await actor.update(actorUpdate);

    return {
      created: createdCount,
      classes: plan.classes.map((c) => `${c.name || c.identifier} ${c.level}`),
      warnings,
    };
  }

  // --- Compendium helpers -----------------------------------------------------

  async #index(packId) {
    if (this._indexes.has(packId)) return this._indexes.get(packId);
    const pack = game.packs.get(packId);
    const index = pack ? await pack.getIndex({ fields: ["system.identifier", "system.classIdentifier"] }) : null;
    const entry = pack ? { pack, index } : null;
    this._indexes.set(packId, entry);
    return entry;
  }

  /** First pack entry of `type` with this identifier (and classIdentifier for subclasses). */
  async #find(kind, identifier, classIdentifier = null) {
    if (!identifier) return null;
    for (const packId of SRD_PACKS[kind] ?? []) {
      const found = await this.#index(packId);
      if (!found) continue;
      const hit = found.index.find((e) => e.type === kind
        && e.system?.identifier === identifier
        && (!classIdentifier || e.system?.classIdentifier === classIdentifier));
      if (hit) return found.pack.getDocument(hit._id);
    }
    return null;
  }

  /** Item source from a compendium document, as dnd5e's createItemData does. */
  #fromCompendium(doc, kind, extraFlags = {}) {
    const data = game.items.fromCompendium(doc);
    data._id = randomId();
    foundry.utils.setProperty(data, "flags.dnd5e.sourceId", doc.uuid);
    for (const [key, value] of Object.entries(extraFlags)) foundry.utils.setProperty(data, `flags.dnd5e.${key}`, value);
    foundry.utils.setProperty(data, `flags.${MODULE_ID}.${FLAG}`, { kind });
    return data;
  }

  /**
   * Features granted by `parent`'s ItemGrant advancements up to `level`.
   * @returns {Promise<{items:object[], added:Record<string,Record<string,string>>}>}
   */
  async #grantFeatures(parentData, level, warnings) {
    const items = [];
    const added = {};
    for (const { advancementId, uuids } of collectGrants(parentData, level)) {
      const origin = `${parentData._id}.${advancementId}`;
      for (const uuid of uuids) {
        let doc = null;
        try { doc = await fromUuid(uuid); } catch (_error) { doc = null; }
        if (!doc) { warnings.push(`Не найдено умение ${uuid} (${parentData.name}).`); continue; }
        const data = this.#fromCompendium(doc, "feature", { advancementOrigin: origin, advancementRoot: origin });
        foundry.utils.setProperty(data, "flags.dnd5e.sourceId", uuid);
        items.push(data);
        (added[advancementId] ??= {})[data._id] = uuid;
      }
    }
    return { items, added };
  }

  // --- Classes ----------------------------------------------------------------

  async #buildClass(cls, warnings) {
    const label = cls.name || cls.identifier;
    const doc = cls.srd ? await this.#find("class", cls.identifier) : null;
    if (!doc) {
      if (cls.srd) warnings.push(`Класс «${label}» не найден в компендиях dnd5e — создана заглушка.`);
      else warnings.push(`Класс «${label}» не из SRD — создана заглушка без умений (уровень и кость хитов учтены).`);
      const data = await this.#placeholder("class", "classes", cls.slug, {
        name: label, identifier: cls.identifier, level: cls.level, hitDie: hitDieFor(cls.identifier),
      });
      const items = [data];
      if (cls.subclass) items.push(await this.#subclassPlaceholder(cls, warnings));
      return { items, classId: data._id, spellcastingAbility: null };
    }

    if (cls.variant) warnings.push(`«${label}» — вариант Ребреи: умения взяты из SRD-класса, сверьте с описанием на сайте.`);
    const classData = this.#fromCompendium(doc, "class");
    classData.system.levels = cls.level;
    const { items: features, added } = await this.#grantFeatures(classData, cls.level, warnings);
    const extra = {};
    const hpAdv = (classData.system.advancement ?? []).find((a) => a.type === "HitPoints");
    if (hpAdv) extra[hpAdv._id] = hitPointsValue(cls.level, { primary: cls.primary });

    const items = [];
    let subclassLink = null;
    if (cls.subclass) {
      const minLevel = subclassLevel(classData);
      if (minLevel != null && cls.level < minLevel) {
        warnings.push(`Подкласс «${cls.subclass.name}» доступен с ${minLevel} уровня «${label}» — не добавлен.`);
      } else {
        const sub = await this.#buildSubclass(cls, classData, warnings);
        items.push(...sub.items);
        const subAdv = (classData.system.advancement ?? []).find((a) => a.type === "Subclass");
        if (subAdv && sub.subclassId && sub.uuid) {
          extra[subAdv._id] = { uuid: sub.uuid };
          subclassLink = { classId: classData._id, advancementId: subAdv._id, subclassId: sub.subclassId, uuid: sub.uuid };
        }
      }
    }
    applyAdvancementValues(classData, added, extra);

    const ability = classData.system.spellcasting?.progression && classData.system.spellcasting.progression !== "none"
      ? classData.system.spellcasting.ability || null
      : null;
    return { items: [classData, ...features, ...items], classId: classData._id, spellcastingAbility: ability, subclassLink };
  }

  async #buildSubclass(cls, classData, warnings) {
    const doc = cls.subclass.identifier ? await this.#find("subclass", cls.subclass.identifier, cls.identifier) : null;
    if (!doc) {
      warnings.push(`Подкласс «${cls.subclass.name}» не из SRD — создана заглушка без умений.`);
      return { items: [await this.#subclassPlaceholder(cls, warnings)], subclassId: null, uuid: null };
    }
    // dnd5e's Subclass advancement strips advancementOrigin/Root from the subclass itself.
    const data = this.#fromCompendium(doc, "subclass");
    data.system.classIdentifier = cls.identifier;
    const { items: features, added } = await this.#grantFeatures(data, cls.level, warnings);
    applyAdvancementValues(data, added);
    return { items: [data, ...features], subclassId: data._id, uuid: doc.uuid };
  }

  async #subclassPlaceholder(cls) {
    const data = buildPlaceholderItem("subclass", { name: cls.subclass.name, classIdentifier: cls.identifier });
    data._id = randomId();
    foundry.utils.setProperty(data, `flags.${MODULE_ID}.${FLAG}`, { kind: "subclass" });
    return data;
  }

  // --- Race / background --------------------------------------------------------

  async #buildOrigin(kind, origin, totalLevel, warnings) {
    const label = origin.name || origin.slug;
    const doc = origin.identifier ? await this.#find(kind, origin.identifier) : null;
    if (!doc) {
      const what = kind === "race" ? "Раса" : "Предыстория";
      warnings.push(`${what} «${label}» не из SRD — создана заглушка с описанием с сайта (черты не перенесены).`);
      const resource = kind === "race" ? "races" : "backgrounds";
      return { items: [await this.#placeholder(kind, resource, origin.slug, { name: label, identifier: origin.slug })], size: null };
    }
    if (origin.assumedSubrace) {
      warnings.push(`Раса «${label}»: в SRD есть только подраса «${doc.name}» — использована она, сверьте черты.`);
    }
    const data = this.#fromCompendium(doc, kind);
    const { items: features, added } = await this.#grantFeatures(data, Math.max(totalLevel, 1), warnings);
    const extra = {};
    const size = kind === "race" ? raceSize(data) : null;
    if (size) extra[size.advancementId] = { size: size.size };
    applyAdvancementValues(data, added, extra);
    return { items: [data, ...features], size: size?.size ?? null };
  }

  /** Placeholder item with the site's description (best-effort fetch). */
  async #placeholder(kind, resource, slug, fields) {
    let description = "";
    let siteUrl = "";
    const cleanSlug = String(slug ?? "").trim();
    if (cleanSlug) {
      let record = null;
      try {
        record = await this.api?.getBySlug?.(resource, cleanSlug);
      } catch (_error) {
        record = null;
      }
      const text = String(record?.details || record?.description || "").trim();
      description = text.length > DESCRIPTION_LIMIT ? `${text.slice(0, DESCRIPTION_LIMIT)}…` : text;
      // Site routes are /{mode}/{resource}/{slug}; official slugs are "NNN-name".
      const mode = record?.mode || (/^\d+-/u.test(cleanSlug) ? "dnd-5e" : "dnd-rebreya");
      siteUrl = `${this.baseUrl}/${mode}/${resource}/${encodeURIComponent(cleanSlug)}`;
    }
    const data = buildPlaceholderItem(kind, { ...fields, description, siteUrl });
    data._id = randomId();
    foundry.utils.setProperty(data, `flags.${MODULE_ID}.${FLAG}`, { kind, slug: cleanSlug });
    return data;
  }
}
