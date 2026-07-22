import {
  CRAFTSMAN_CLASS_IDENTIFIER,
  CRAFTSMAN_TRACK_FLAG,
  CRAFTSMAN_TRACKS,
  MODULE_ID
} from "../constants.js";
import {
  assertValidCraftsmanSubclass,
  CraftsmanSubclassIdentityError,
  getCraftsmanSubclasses,
  hasCraftsmanTrackDuplicate,
  isCraftsmanClass,
  validateCraftsmanSubclassIdentity
} from "./craftsman-subclass-tracks.js";

const TRACK_CONFIG = Object.freeze({
  [CRAFTSMAN_TRACKS.RESEARCH]: Object.freeze({
    advancementType: "ResearchSubclass",
    hintKey: "REBREYA_MAIN.Advancement.ResearchSubclass.Hint",
    icon: "systems/dnd5e/icons/classes/sage.webp",
    titleKey: "REBREYA_MAIN.Advancement.ResearchSubclass.Title"
  }),
  [CRAFTSMAN_TRACKS.SPECIALTY]: Object.freeze({
    advancementType: "SpecialtySubclass",
    hintKey: "REBREYA_MAIN.Advancement.SpecialtySubclass.Hint",
    icon: "systems/dnd5e/icons/classes/fighter.webp",
    titleKey: "REBREYA_MAIN.Advancement.SpecialtySubclass.Title"
  })
});

const INVALID_CLASS_KEY = "REBREYA_MAIN.CraftsmanSubclass.InvalidClass";
const INVALID_TRACK_KEY = "REBREYA_MAIN.CraftsmanSubclass.InvalidTrack";
const INVALID_SOURCE_KEY = "REBREYA_MAIN.CraftsmanSubclass.InvalidSource";
const DUPLICATE_KEY = "REBREYA_MAIN.CraftsmanSubclass.Duplicate";
const INVALID_TYPE_KEY = "DND5E.ADVANCEMENT.Subclass.Warning.InvalidType";

let ResearchSubclass;
let SpecialtySubclass;
let ResearchSubclassFlow;
let SpecialtySubclassFlow;

function localize(key) {
  return globalThis.game?.i18n?.localize?.(key) ?? key;
}

function warn(key) {
  globalThis.ui?.notifications?.warn?.(key, { localize: true });
}

function duplicateError() {
  return new Error(localize(DUPLICATE_KEY));
}

function invalidSourceError() {
  return new Error(localize(INVALID_SOURCE_KEY));
}

function identityWarningKey(error) {
  if (!(error instanceof CraftsmanSubclassIdentityError)) return INVALID_SOURCE_KEY;
  if (error.reason === "type") return INVALID_TYPE_KEY;
  if (error.reason === "class") return INVALID_CLASS_KEY;
  if (error.reason === "track") return INVALID_TRACK_KEY;
  return INVALID_SOURCE_KEY;
}

function validateCandidate(item, track, actor, {
  notify = false,
  excludeId = "",
  sourceUuid = ""
} = {}) {
  let definition;
  try {
    definition = validateCraftsmanSubclassIdentity(item, track);
    if (sourceUuid && sourceUuid !== definition.uuid) throw invalidSourceError();
  }
  catch (error) {
    if (!notify) throw error;
    warn(identityWarningKey(error));
    return false;
  }

  if (hasCraftsmanTrackDuplicate(actor, item, { excludeId })) {
    if (notify) warn(DUPLICATE_KEY);
    else throw duplicateError();
    return false;
  }
  return definition;
}

function validateRetainedData(retainedData, uuid, track, actor) {
  if (!retainedData) return;
  const dnd5eFlags = retainedData.flags?.dnd5e ?? {};
  if (dnd5eFlags.sourceId !== uuid) return;
  if (
    Object.hasOwn(dnd5eFlags, "advancementOrigin")
    || Object.hasOwn(dnd5eFlags, "advancementRoot")
  ) {
    throw invalidSourceError();
  }
  validateCandidate(retainedData, track, actor, {
    excludeId: retainedData.id ?? retainedData._id,
    sourceUuid: uuid
  });
}

export function createTrackedSubclassFlow(SubclassFlow, track) {
  if (!TRACK_CONFIG[track]) {
    throw new Error(`Unsupported Craftsman subclass track: ${track}`);
  }

  class TrackedSubclassFlow extends SubclassFlow {
    async _onBrowseCompendium(event) {
      event.preventDefault();
      const filters = {
        locked: {
          additional: { class: { [CRAFTSMAN_CLASS_IDENTIFIER]: 1 } },
          arbitrary: [{
            k: `flags.${MODULE_ID}.${CRAFTSMAN_TRACK_FLAG}`,
            o: "exact",
            v: track
          }],
          types: new Set(["subclass"])
        }
      };
      const result = await game.dnd5e.applications.CompendiumBrowser.selectOne({ filters });
      if (result) {
        const subclass = await fromUuid(result);
        if (validateCandidate(subclass, track, this.advancement?.actor, {
          notify: true,
          sourceUuid: result
        })) {
          this.subclass = subclass;
        }
      }
      this.render();
    }

    async _onDrop(event) {
      let data;
      try {
        data = JSON.parse(event.dataTransfer.getData("text/plain"));
      }
      catch (error) {
        return false;
      }

      if (data.type !== "Item") return false;
      const item = await Item.implementation.fromDropData(data);
      const definition = validateCandidate(item, track, this.advancement?.actor, { notify: true });
      if (!definition) {
        return undefined;
      }

      const source = await fromUuid(definition.uuid);
      if (!validateCandidate(source, track, this.advancement?.actor, {
        notify: true,
        sourceUuid: definition.uuid
      })) return undefined;

      this.subclass = source;
      this.render();
      return undefined;
    }
  }

  if (track === CRAFTSMAN_TRACKS.RESEARCH) {
    return class ResearchSubclassFlow extends TrackedSubclassFlow {};
  }
  return class SpecialtySubclassFlow extends TrackedSubclassFlow {};
}

export function createTrackedSubclassAdvancement(SubclassAdvancement, Flow, track) {
  const config = TRACK_CONFIG[track];
  if (!config) {
    throw new Error(`Unsupported Craftsman subclass track: ${track}`);
  }

  class TrackedSubclassAdvancement extends SubclassAdvancement {
    static get metadata() {
      return foundry.utils.mergeObject(super.metadata, {
        apps: { flow: Flow },
        hint: localize(config.hintKey),
        icon: config.icon,
        title: localize(config.titleKey)
      }, { inplace: false });
    }

    static availableForItem(item) {
      return isCraftsmanClass(item)
        && !item.advancement?.byType?.[config.advancementType]?.length;
    }

    summaryForLevel(level, { configMode = false } = {}) {
      const subclass = this.value?.document;
      if (configMode || !subclass) return "";
      assertValidCraftsmanSubclass(subclass, track);
      return subclass.toAnchor().outerHTML;
    }

    async apply(level, data, retainedData) {
      const subclass = await fromUuid(data?.uuid);
      validateCandidate(subclass, track, this.actor, { sourceUuid: data?.uuid });
      validateRetainedData(retainedData, data?.uuid, track, this.actor);
      return super.apply(level, data, retainedData);
    }

    async restore(level, data) {
      if (!data) return super.restore(level, data);
      validateCandidate(data, track, this.actor, { excludeId: data.id ?? data._id });
      return super.restore(level, data);
    }

    async reverse(level) {
      const linkedSubclass = this.value?.document;
      if (linkedSubclass) {
        validateCandidate(linkedSubclass, track, this.actor, {
          excludeId: linkedSubclass.id ?? linkedSubclass._id
        });
        return super.reverse(level);
      }

      const fallback = getCraftsmanSubclasses(this.item)[track];
      if (!fallback) return undefined;
      validateCandidate(fallback, track, this.actor, {
        excludeId: fallback.id ?? fallback._id
      });
      this.actor.items.delete(fallback.id);
      this.updateSource({ value: { document: null, uuid: null } });
      return fallback.toObject();
    }
  }

  if (track === CRAFTSMAN_TRACKS.RESEARCH) {
    return class ResearchSubclassAdvancement extends TrackedSubclassAdvancement {};
  }
  return class SpecialtySubclassAdvancement extends TrackedSubclassAdvancement {};
}

export function getCraftsmanSubclassAdvancementClasses() {
  return {
    ResearchSubclass,
    ResearchSubclassFlow,
    SpecialtySubclass,
    SpecialtySubclassFlow
  };
}

export function registerCraftsmanSubclassAdvancements() {
  const SubclassAdvancement = globalThis.game?.dnd5e?.documents?.advancement?.SubclassAdvancement;
  const SubclassFlow = globalThis.game?.dnd5e?.applications?.advancement?.SubclassFlow;
  const CompendiumBrowser = globalThis.game?.dnd5e?.applications?.CompendiumBrowser;
  const advancementTypes = globalThis.CONFIG?.DND5E?.advancementTypes;
  if (!SubclassAdvancement || !SubclassFlow || !CompendiumBrowser?.selectOne || !advancementTypes) {
    return false;
  }

  ResearchSubclassFlow = createTrackedSubclassFlow(SubclassFlow, CRAFTSMAN_TRACKS.RESEARCH);
  SpecialtySubclassFlow = createTrackedSubclassFlow(SubclassFlow, CRAFTSMAN_TRACKS.SPECIALTY);
  ResearchSubclass = createTrackedSubclassAdvancement(
    SubclassAdvancement,
    ResearchSubclassFlow,
    CRAFTSMAN_TRACKS.RESEARCH
  );
  SpecialtySubclass = createTrackedSubclassAdvancement(
    SubclassAdvancement,
    SpecialtySubclassFlow,
    CRAFTSMAN_TRACKS.SPECIALTY
  );

  advancementTypes.ResearchSubclass = {
    documentClass: ResearchSubclass,
    validItemTypes: new Set(["class"])
  };
  advancementTypes.SpecialtySubclass = {
    documentClass: SpecialtySubclass,
    validItemTypes: new Set(["class"])
  };
  return true;
}
