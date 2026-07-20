import {
  RESEARCH_ITEM_TYPE,
  SPECIALTY_ITEM_TYPE
} from "../constants.js";

const ARCHETYPE_CONFIG = Object.freeze({
  [RESEARCH_ITEM_TYPE]: Object.freeze({
    duplicateKey: "REBREYA_MAIN.CraftsmanArchetype.DuplicateResearch",
    icon: "fa-solid fa-flask",
    labelKey: `TYPES.Item.${RESEARCH_ITEM_TYPE}`,
    pluralLabelKey: `TYPES.Item.${RESEARCH_ITEM_TYPE}Pl`
  }),
  [SPECIALTY_ITEM_TYPE]: Object.freeze({
    duplicateKey: "REBREYA_MAIN.CraftsmanArchetype.DuplicateSpecialty",
    icon: "fa-solid fa-hammer",
    labelKey: `TYPES.Item.${SPECIALTY_ITEM_TYPE}`,
    pluralLabelKey: `TYPES.Item.${SPECIALTY_ITEM_TYPE}Pl`
  })
});

let ResearchChoice;
let SpecialtyChoice;

function cleanString(value) {
  return String(value ?? "").trim();
}

function actorItems(actor) {
  const items = actor?.items?.contents ?? actor?.items ?? [];
  return Array.from(items);
}

export function hasDuplicateCraftsmanArchetype(actor, candidate, { excludeId = "" } = {}) {
  const type = cleanString(candidate?.type);
  const classIdentifier = cleanString(candidate?.system?.classIdentifier);
  const ignoredId = cleanString(excludeId || candidate?.id || candidate?._id);
  if (!ARCHETYPE_CONFIG[type] || !classIdentifier) {
    return false;
  }

  return actorItems(actor).some((item) => (
    cleanString(item?.id || item?._id) !== ignoredId
    && item?.type === type
    && cleanString(item?.system?.classIdentifier) === classIdentifier
  ));
}

function localize(key) {
  return globalThis.game?.i18n?.localize?.(key) ?? key;
}

function warnDuplicate(type) {
  const key = ARCHETYPE_CONFIG[type]?.duplicateKey;
  if (key) {
    globalThis.ui?.notifications?.warn?.(localize(key));
  }
}

function createArchetypeDataModel(SubclassData, type) {
  const config = ARCHETYPE_CONFIG[type];
  return class RebreyaCraftsmanArchetypeData extends SubclassData {
    static metadata = Object.freeze(foundry.utils.mergeObject(super.metadata, {
      singleton: false
    }, { inplace: false }));

    async getFavoriteData() {
      return {
        img: this.parent.img,
        title: this.parent.name,
        subtitle: localize(config.labelKey)
      };
    }

    async getSheetData(context) {
      if (typeof super.getSheetData === "function") {
        await super.getSheetData(context);
      }
      context.subtitles = [{ label: localize(config.labelKey) }];
    }

    async _preCreate(data, options, user) {
      if (typeof super._preCreate === "function" && (await super._preCreate(data, options, user)) === false) {
        return false;
      }

      const candidate = {
        type: this.parent?.type ?? type,
        system: {
          classIdentifier: data?.system?.classIdentifier ?? this.classIdentifier
        }
      };
      if (hasDuplicateCraftsmanArchetype(this.parent?.actor, candidate)) {
        warnDuplicate(type);
        return false;
      }
      return undefined;
    }

    async _preUpdate(changed, options, user) {
      if (typeof super._preUpdate === "function" && (await super._preUpdate(changed, options, user)) === false) {
        return false;
      }

      const candidate = {
        id: this.parent?.id,
        type: this.parent?.type ?? type,
        system: {
          classIdentifier: changed?.classIdentifier
            ?? changed?.system?.classIdentifier
            ?? this.classIdentifier
        }
      };
      if (hasDuplicateCraftsmanArchetype(this.parent?.actor, candidate, { excludeId: this.parent?.id })) {
        warnDuplicate(type);
        return false;
      }
      return undefined;
    }
  };
}

function createAdvancementClasses(ItemChoiceAdvancement) {
  class ResearchChoiceAdvancement extends ItemChoiceAdvancement {
    static VALID_TYPES = new Set([RESEARCH_ITEM_TYPE]);

    static get metadata() {
      return foundry.utils.mergeObject(super.metadata, {
        title: localize("REBREYA_MAIN.Advancement.ResearchChoice.Title"),
        hint: localize("REBREYA_MAIN.Advancement.ResearchChoice.Hint")
      }, { inplace: false });
    }
  }

  class SpecialtyChoiceAdvancement extends ItemChoiceAdvancement {
    static VALID_TYPES = new Set([SPECIALTY_ITEM_TYPE]);

    static get metadata() {
      return foundry.utils.mergeObject(super.metadata, {
        title: localize("REBREYA_MAIN.Advancement.SpecialtyChoice.Title"),
        hint: localize("REBREYA_MAIN.Advancement.SpecialtyChoice.Hint")
      }, { inplace: false });
    }
  }

  ResearchChoice = ResearchChoiceAdvancement;
  SpecialtyChoice = SpecialtyChoiceAdvancement;
}

export function getCraftsmanAdvancementClasses() {
  return { ResearchChoice, SpecialtyChoice };
}

export function registerCraftsmanArchetypeTypes() {
  const SubclassData = globalThis.CONFIG?.Item?.dataModels?.subclass;
  const ItemChoiceAdvancement = globalThis.game?.dnd5e?.documents?.advancement?.ItemChoiceAdvancement;
  const advancementTypes = globalThis.CONFIG?.DND5E?.advancementTypes;
  if (!SubclassData || !ItemChoiceAdvancement || !advancementTypes) {
    return false;
  }

  CONFIG.Item.dataModels ??= {};
  CONFIG.Item.typeIcons ??= {};
  CONFIG.Item.typeLabels ??= {};
  for (const [type, config] of Object.entries(ARCHETYPE_CONFIG)) {
    CONFIG.Item.dataModels[type] = createArchetypeDataModel(SubclassData, type);
    CONFIG.Item.typeIcons[type] ??= config.icon;
    CONFIG.Item.typeLabels[type] = config.labelKey;
    CONFIG.Item.typeLabels[`${type}Pl`] = config.pluralLabelKey;
  }

  createAdvancementClasses(ItemChoiceAdvancement);
  advancementTypes.ResearchChoice = {
    documentClass: ResearchChoice,
    validItemTypes: new Set(["class"])
  };
  advancementTypes.SpecialtyChoice = {
    documentClass: SpecialtyChoice,
    validItemTypes: new Set(["class"])
  };
  if (advancementTypes.ItemGrant?.validItemTypes instanceof Set) {
    advancementTypes.ItemGrant.validItemTypes.add(RESEARCH_ITEM_TYPE);
    advancementTypes.ItemGrant.validItemTypes.add(SPECIALTY_ITEM_TYPE);
  }

  return true;
}
