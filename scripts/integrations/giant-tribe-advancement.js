import {
  clearGiantTribeItemData,
  configureGiantTribeItemData,
  isGiantTribeFeature
} from "../combat/race-automation-service.js?v=1.4.110-giant-tribe-cache-fixes-2";

export const GIANT_TRIBE_CHOICES = Object.freeze({
  hill: "Холмовой великан",
  stone: "Каменный великан",
  frost: "Ледяной великан",
  fire: "Огненный великан",
  cloud: "Облачный великан",
  storm: "Штормовой великан"
});

const GIANT_TRIBE_VALUES = new Set(Object.keys(GIANT_TRIBE_CHOICES));
const FLOW_TEMPLATE = "modules/rebreya-main/templates/advancement/giant-tribe-flow.hbs";

let GiantTribeAdvancement;
let GiantTribeFlow;

function selectedTribe(advancement, retainedData = null) {
  const retained = String(retainedData?.size ?? "").trim().toLowerCase();
  if (GIANT_TRIBE_VALUES.has(retained)) return retained;
  const saved = String(advancement?.value?.size ?? "").trim().toLowerCase();
  return GIANT_TRIBE_VALUES.has(saved) ? saved : "";
}

export function createGiantTribeAdvancementClasses({ SizeAdvancement, AdvancementFlow }) {
  if (!SizeAdvancement || !AdvancementFlow) {
    throw new Error("Для GiantTribe недоступны базовые классы Advancement dnd5e.");
  }

  class GiantTribeFlowClass extends AdvancementFlow {
    static get defaultOptions() {
      return foundry.utils.mergeObject(super.defaultOptions, {
        template: FLOW_TEMPLATE
      }, { inplace: false });
    }

    getData() {
      return foundry.utils.mergeObject(super.getData(), {
        choices: GIANT_TRIBE_CHOICES,
        selectedTribe: selectedTribe(this.advancement, this.retainedData)
      }, { inplace: false });
    }
  }

  class GiantTribeAdvancementClass extends SizeAdvancement {
    static get metadata() {
      return foundry.utils.mergeObject(super.metadata, {
        order: 45,
        icon: "icons/environment/wilderness/mountain-snow.webp",
        typeIcon: "icons/environment/wilderness/mountain-snow.webp",
        title: "Великанье племя",
        hint: "Выберите одно из шести великаньих племён.",
        apps: { flow: GiantTribeFlowClass }
      }, { inplace: false });
    }

    static availableForItem(item) {
      return item?.type === "race" && !item?.advancement?.byType?.GiantTribe?.length;
    }

    get levels() {
      return [0];
    }

    configuredForLevel() {
      return Boolean(selectedTribe(this));
    }

    summaryForLevel(level, { configMode = false } = {}) {
      if (configMode) return "";
      const tribe = selectedTribe(this);
      return tribe ? `<span class="tag">${GIANT_TRIBE_CHOICES[tribe]}</span>` : "";
    }

    automaticApplicationValue() {
      return false;
    }

    async apply(level, data) {
      const tribe = String(data?.size ?? "").trim().toLowerCase();
      if (!GIANT_TRIBE_VALUES.has(tribe)) {
        throw new this.constructor.ERROR("Выберите великанье племя.");
      }

      const feature = this.actor?.items?.find?.(isGiantTribeFeature);
      if (!feature) {
        throw new this.constructor.ERROR("Не найдена черта «Великанье племя».");
      }

      const configured = configureGiantTribeItemData(feature, tribe);
      this.actor.items.delete(feature.id ?? feature._id);
      this.actor.updateSource({ items: [configured] });
      this.updateSource({ "value.size": tribe });
      return { size: tribe };
    }

    async restore(level, data) {
      return this.apply(level, data);
    }

    async reverse(level) {
      const size = selectedTribe(this) || null;
      const feature = this.actor?.items?.find?.(isGiantTribeFeature);
      if (feature) {
        const cleared = clearGiantTribeItemData(feature);
        this.actor.items.delete(feature.id ?? feature._id);
        this.actor.updateSource({ items: [cleared] });
      }
      this.updateSource({ "value.size": null });
      return { size };
    }
  }

  Object.defineProperty(GiantTribeFlowClass, "name", { value: "GiantTribeFlow" });
  Object.defineProperty(GiantTribeAdvancementClass, "name", { value: "GiantTribeAdvancement" });
  return {
    GiantTribeAdvancement: GiantTribeAdvancementClass,
    GiantTribeFlow: GiantTribeFlowClass
  };
}

export function getGiantTribeAdvancementClasses() {
  return { GiantTribeAdvancement, GiantTribeFlow };
}

export function registerGiantTribeAdvancement() {
  const SizeAdvancement = globalThis.game?.dnd5e?.documents?.advancement?.SizeAdvancement;
  const AdvancementFlow = globalThis.game?.dnd5e?.applications?.advancement?.AdvancementFlow;
  const advancementTypes = globalThis.CONFIG?.DND5E?.advancementTypes;
  if (!SizeAdvancement || !AdvancementFlow || !advancementTypes) return false;

  const classes = createGiantTribeAdvancementClasses({ SizeAdvancement, AdvancementFlow });
  GiantTribeAdvancement = classes.GiantTribeAdvancement;
  GiantTribeFlow = classes.GiantTribeFlow;
  advancementTypes.GiantTribe = {
    documentClass: GiantTribeAdvancement,
    validItemTypes: new Set(["race"]),
    hidden: true
  };
  return true;
}
