import { MODULE_ID } from "../constants.js";
import { getInstalledUpgradeItems } from "../data/item-upgrade-service.js?v=1.4.96-item-upgrades";

export const CURSE_EATER_RARITY = Object.freeze({
  common: 0,
  uncommon: 1,
  rare: 2,
  veryRare: 3,
  legendary: 4,
  artifact: 5
});

const CURSE_EATER_TIER_REQUIREMENTS = Object.freeze([
  CURSE_EATER_RARITY.uncommon,
  CURSE_EATER_RARITY.rare,
  CURSE_EATER_RARITY.rare,
  CURSE_EATER_RARITY.rare,
  CURSE_EATER_RARITY.veryRare,
  CURSE_EATER_RARITY.veryRare,
  CURSE_EATER_RARITY.legendary,
  CURSE_EATER_RARITY.artifact
]);

const EFFECT_MODE_ADD = 2;
const CURSE_EATER_ABILITY_IDS = new Set(["str", "dex", "con", "int", "wis", "cha"]);
const LEGACY_CURSE_EATER_EFFECT_IDS = new Set([
  "84fc61e9aa590cdd",
  "97bc79c890fe169c",
  "8fda6d6913e11cc3",
  "a9621f0597064272",
  "59ed1e4584bc7aba"
]);

const ITEM_RARITY_BY_NAME = new Map([
  ["common", CURSE_EATER_RARITY.common],
  ["обычный", CURSE_EATER_RARITY.common],
  ["обычная", CURSE_EATER_RARITY.common],
  ["uncommon", CURSE_EATER_RARITY.uncommon],
  ["необычный", CURSE_EATER_RARITY.uncommon],
  ["необычная", CURSE_EATER_RARITY.uncommon],
  ["rare", CURSE_EATER_RARITY.rare],
  ["редкий", CURSE_EATER_RARITY.rare],
  ["редкая", CURSE_EATER_RARITY.rare],
  ["veryrare", CURSE_EATER_RARITY.veryRare],
  ["очень редкий", CURSE_EATER_RARITY.veryRare],
  ["очень редкая", CURSE_EATER_RARITY.veryRare],
  ["legendary", CURSE_EATER_RARITY.legendary],
  ["легендарный", CURSE_EATER_RARITY.legendary],
  ["легендарная", CURSE_EATER_RARITY.legendary],
  ["artifact", CURSE_EATER_RARITY.artifact],
  ["артефакт", CURSE_EATER_RARITY.artifact]
]);

function getProperty(source, path) {
  return globalThis.foundry?.utils?.getProperty?.(source, path)
    ?? String(path ?? "").split(".").reduce((current, part) => (
      current && typeof current === "object" ? current[part] : undefined
    ), source);
}

function collectionValues(collection) {
  if (!collection) return [];
  if (Array.isArray(collection)) return collection;
  if (Array.isArray(collection.contents)) return collection.contents;
  if (typeof collection.values === "function") return Array.from(collection.values());
  return [];
}

function readModuleFlag(document, key) {
  return document?.getFlag?.(MODULE_ID, key)
    ?? getProperty(document, `flags.${MODULE_ID}.${key}`);
}

function normalizeText(value) {
  return String(value ?? "")
    .trim()
    .toLocaleLowerCase("ru-RU")
    .replace(/\s+/gu, " ");
}

function isCurseText(value) {
  return /проклят(?:ье|ие)/iu.test(String(value ?? ""));
}

function normalizeItemRarity(item) {
  const rawRarity = getProperty(item, "system.rarity")
    ?? readModuleFlag(item, "rarity")
    ?? "";
  const normalized = normalizeText(rawRarity).replace(/\s+/gu, " ");
  return ITEM_RARITY_BY_NAME.get(normalized)
    ?? ITEM_RARITY_BY_NAME.get(normalized.replace(/\s+/gu, ""))
    ?? CURSE_EATER_RARITY.common;
}

function readUpgradeProfile(upgrade) {
  const profile = readModuleFlag(upgrade, "upgrade");
  return profile && typeof profile === "object" ? profile : {};
}

export function curseRankToRarity(rank) {
  const numericRank = Number(rank);
  const safeRank = Number.isFinite(numericRank)
    ? Math.max(1, Math.min(10, Math.trunc(numericRank)))
    : 1;
  return Math.floor((safeRank - 1) / 2);
}

export function getEffectiveCursedItemRarity(item) {
  const curseRarities = getInstalledUpgradeItems(item)
    .map(readUpgradeProfile)
    .filter((profile) => isCurseText(profile.type))
    .map((profile) => curseRankToRarity(profile.rank));
  return Math.max(normalizeItemRarity(item), ...curseRarities);
}

function isCursedItem(item) {
  const description = getProperty(item, "system.description.value")
    ?? getProperty(item, "system.description")
    ?? "";
  return isCurseText(description)
    || getInstalledUpgradeItems(item)
      .map(readUpgradeProfile)
      .some((profile) => isCurseText(profile.type));
}

export function collectActiveCursedItems(actor) {
  const slots = readModuleFlag(actor, "heroDoll")?.slots ?? {};
  const itemIds = [...new Set(
    Object.values(slots)
      .map((slot) => String(slot?.itemId ?? "").trim())
      .filter(Boolean)
  )];
  const actorItems = collectionValues(actor?.items);

  return itemIds
    .map((itemId) => actor?.items?.get?.(itemId)
      ?? actorItems.find((item) => String(item?.id ?? item?._id ?? "") === itemId)
      ?? null)
    .filter((item) => item && isCursedItem(item))
    .map((item) => ({
      itemId: String(item.id ?? item._id ?? ""),
      itemName: String(item.name ?? ""),
      rarity: getEffectiveCursedItemRarity(item)
    }))
    .sort((left, right) => (
      (left.rarity - right.rarity)
      || left.itemId.localeCompare(right.itemId)
    ));
}

export function calculateCurseEaterProgress(items = []) {
  const available = (Array.isArray(items) ? items : [])
    .map((item) => ({
      ...item,
      itemId: String(item?.itemId ?? ""),
      rarity: Math.max(
        CURSE_EATER_RARITY.common,
        Math.min(CURSE_EATER_RARITY.artifact, Math.trunc(Number(item?.rarity) || 0))
      )
    }))
    .sort((left, right) => (
      (left.rarity - right.rarity)
      || left.itemId.localeCompare(right.itemId)
    ));
  const usedItems = [];

  for (const requiredRarity of CURSE_EATER_TIER_REQUIREMENTS) {
    const itemIndex = available.findIndex((item) => item.rarity >= requiredRarity);
    if (itemIndex < 0) break;
    usedItems.push(available.splice(itemIndex, 1)[0]);
  }

  return {
    tier: usedItems.length,
    usedItemIds: usedItems.map((item) => item.itemId),
    usedItems
  };
}

function addEffectChange(key, value) {
  return {
    key,
    mode: EFFECT_MODE_ADD,
    value,
    priority: 20
  };
}

function normalizeAbilityChoice(choice) {
  const abilities = Array.isArray(choice)
    ? choice.map((ability) => normalizeText(ability)).filter((ability) => CURSE_EATER_ABILITY_IDS.has(ability))
    : [];
  return abilities.length === 2 && abilities[0] !== abilities[1] ? abilities : [];
}

function bindAbilityChoiceValidation(_event, dialog) {
  const root = dialog?.element ?? dialog;
  const first = root?.querySelector?.('[name="firstAbility"]');
  const second = root?.querySelector?.('[name="secondAbility"]');
  const confirm = root?.querySelector?.('[data-action="confirm"]');
  if (!first || !second || !confirm) return;

  const update = () => {
    confirm.disabled = !first.value || !second.value || first.value === second.value;
  };
  first.addEventListener?.("change", update);
  second.addEventListener?.("change", update);
  update();
}

export async function promptCurseEaterAbilityChoice() {
  const DialogV2 = globalThis.foundry?.applications?.api?.DialogV2
    ?? globalThis.DialogV2
    ?? null;
  if (typeof DialogV2?.wait !== "function") return [];

  const abilities = [
    ["str", "Сила"],
    ["dex", "Ловкость"],
    ["con", "Телосложение"],
    ["int", "Интеллект"],
    ["wis", "Мудрость"],
    ["cha", "Харизма"]
  ];
  const options = abilities
    .map(([value, label]) => `<option value="${value}">${label}</option>`)
    .join("");
  const result = await DialogV2.wait({
    window: { title: "Пожиратель проклятий" },
    content: `
      <form>
        <p>Выберите две разные характеристики. Этот выбор нельзя будет изменить.</p>
        <div class="form-group">
          <label>Первая характеристика</label>
          <select name="firstAbility">${options}</select>
        </div>
        <div class="form-group">
          <label>Вторая характеристика</label>
          <select name="secondAbility">${options}</select>
        </div>
      </form>
    `,
    render: bindAbilityChoiceValidation,
    buttons: [
      {
        action: "confirm",
        label: "Подтвердить",
        default: true,
        callback: (_event, button) => normalizeAbilityChoice([
          button?.form?.elements?.firstAbility?.value,
          button?.form?.elements?.secondAbility?.value
        ])
      },
      {
        action: "cancel",
        label: "Отмена",
        callback: () => []
      }
    ],
    close: () => []
  });
  return normalizeAbilityChoice(result);
}

export function buildCurseEaterEffectData(progress = {}, abilityChoice = []) {
  const tier = Math.max(0, Math.min(8, Math.trunc(Number(progress?.tier) || 0)));
  const abilities = normalizeAbilityChoice(abilityChoice);
  const changes = [];

  if (tier >= 1) {
    changes.push(
      addEffectChange("system.bonuses.mwak.attack", "+1"),
      addEffectChange("system.bonuses.mwak.damage", "+1"),
      addEffectChange("system.bonuses.rwak.attack", "+1"),
      addEffectChange("system.bonuses.rwak.damage", "+1")
    );
  }
  if (tier >= 2) {
    changes.push(addEffectChange("system.attributes.hp.bonuses.overall", "@prof"));
  }
  if (tier >= 3) {
    changes.push(addEffectChange("system.bonuses.abilities.save", "+1"));
  }
  if (tier >= 5) {
    changes.push(addEffectChange("system.attributes.ac.bonus", "1"));
  }
  if (tier >= 6 && abilities.length === 2) {
    changes.push(...abilities.map((ability) => addEffectChange(`system.abilities.${ability}.value`, "1")));
  }
  if (tier >= 7) {
    changes.push(
      addEffectChange("system.traits.dr.value", "necrotic"),
      addEffectChange("system.traits.dr.value", "psychic")
    );
  }

  return {
    name: "Пожиратель проклятий",
    img: "icons/svg/aura.svg",
    type: "base",
    system: {},
    changes,
    disabled: false,
    transfer: false,
    statuses: [],
    duration: {},
    flags: {
      [MODULE_ID]: {
        curseEater: {
          managed: true,
          version: 1,
          tier,
          manualTierEight: tier >= 8,
          abilities,
          usedItems: (Array.isArray(progress?.usedItems) ? progress.usedItems : []).map((item) => ({
            itemId: String(item?.itemId ?? ""),
            itemName: String(item?.itemName ?? ""),
            rarity: Number(item?.rarity ?? 0)
          }))
        }
      }
    }
  };
}

function documentId(document) {
  return String(document?.id ?? document?._id ?? "").trim();
}

function isCurseEaterFeat(item) {
  return String(item?.type ?? "") === "feat"
    && (
      normalizeText(getProperty(item, "system.identifier")) === "pozhiratel-proklyatiy"
      || normalizeText(readModuleFlag(item, "featId")) === "pozhiratel-proklyatiy"
    );
}

function isManagedCurseEaterEffect(effect) {
  return readModuleFlag(effect, "curseEater")?.managed === true;
}

function effectSignature(effect) {
  return JSON.stringify({
    changes: Array.isArray(effect?.changes) ? effect.changes : [],
    disabled: effect?.disabled === true,
    flags: readModuleFlag(effect, "curseEater") ?? {},
    name: String(effect?.name ?? "")
  });
}

function managedEffectTier(effect) {
  return Math.max(0, Math.min(8, Math.trunc(Number(
    readModuleFlag(effect, "curseEater")?.tier
  ) || 0)));
}

export class CurseEaterAutomationService {
  constructor(options = {}) {
    this.options = options && typeof options === "object" ? options : {};
    this._pendingSyncs = new Map();
  }

  #notifyTierChanged(actor, previousTier, nextTier) {
    if (previousTier === nextTier) return;
    if (typeof this.options.notifyTierChanged === "function") {
      this.options.notifyTierChanged(actor, previousTier, nextTier);
      return;
    }
    globalThis.ui?.notifications?.info?.(
      `Пожиратель проклятий: ступень ${previousTier} → ${nextTier}.`
    );
  }

  applyDnd5ePreUseActivity(activity, usageConfig = {}) {
    if (
      activity?.type !== "save"
      || usageConfig?.rebreyaCurseEaterDcApplied === true
    ) {
      return true;
    }

    const actor = activity?.actor ?? activity?.item?.actor ?? null;
    const effect = collectionValues(actor?.effects).find(isManagedCurseEaterEffect);
    if (managedEffectTier(effect) < 4 || !activity?.save?.dc) {
      return true;
    }

    const currentBonus = String(activity.save.dc.bonus ?? "").trim();
    activity.save.dc.bonus = currentBonus ? `${currentBonus} + 1` : "1";
    usageConfig.rebreyaCurseEaterDcApplied = true;
    return true;
  }

  #scheduleActorSync(actor) {
    if (!actor) return Promise.resolve({ tier: 0, usedItemIds: [], usedItems: [] });
    const current = this._pendingSyncs.get(actor);
    if (current) return current;

    const debounceMs = Math.max(0, Number(this.options.debounceMs ?? 40) || 0);
    const pending = new Promise((resolve, reject) => {
      globalThis.setTimeout(async () => {
        try {
          resolve(await this.syncActor(actor));
        }
        catch (error) {
          reject(error);
        }
        finally {
          this._pendingSyncs.delete(actor);
        }
      }, debounceMs);
    });
    this._pendingSyncs.set(actor, pending);
    return pending;
  }

  handleActorChanged(actor, _changed = {}, options = {}) {
    if (options?.rebreyaCurseEaterSync === true) {
      return Promise.resolve({ tier: 0, usedItemIds: [], usedItems: [] });
    }
    return this.#scheduleActorSync(actor);
  }

  handleItemChanged(item, options = {}) {
    if (options?.rebreyaCurseEaterSync === true) {
      return Promise.resolve({ tier: 0, usedItemIds: [], usedItems: [] });
    }
    return this.#scheduleActorSync(item?.actor ?? item?.parent ?? null);
  }

  async initialize() {
    const logger = this.options.logger ?? globalThis.console;
    for (const actor of collectionValues(globalThis.game?.actors)) {
      try {
        await this.syncActor(actor);
      }
      catch (error) {
        logger?.warn?.(
          `${MODULE_ID} | Failed to initialize Curse Eater automation for '${actor?.name ?? actor?.id ?? "actor"}'.`,
          error
        );
      }
    }
  }

  async syncActor(actor) {
    const emptyProgress = { tier: 0, usedItemIds: [], usedItems: [] };
    if (!actor || actor.type !== "character" || actor.isOwner === false) {
      return emptyProgress;
    }

    const items = collectionValues(actor.items);
    const feats = items.filter(isCurseEaterFeat);
    const hasFeat = feats.length > 0;
    for (const feat of feats) {
      const legacyIds = collectionValues(feat.effects)
        .map(documentId)
        .filter((effectId) => LEGACY_CURSE_EATER_EFFECT_IDS.has(effectId));
      if (legacyIds.length) {
        await feat.deleteEmbeddedDocuments("ActiveEffect", legacyIds, {
          rebreyaCurseEaterSync: true,
          render: false
        });
      }
    }

    const progress = hasFeat
      ? calculateCurseEaterProgress(collectActiveCursedItems(actor))
      : emptyProgress;
    const managedEffects = collectionValues(actor.effects).filter(isManagedCurseEaterEffect);
    const previousTier = managedEffectTier(managedEffects[0]);

    if (!hasFeat || progress.tier < 1) {
      const ids = managedEffects.map(documentId).filter(Boolean);
      if (ids.length) {
        await actor.deleteEmbeddedDocuments("ActiveEffect", ids, {
          rebreyaCurseEaterSync: true,
          render: false
        });
      }
      if (previousTier > 0) this.#notifyTierChanged(actor, previousTier, 0);
      return progress;
    }

    const actorState = readModuleFlag(actor, "curseEater") ?? {};
    let abilityChoice = normalizeAbilityChoice(actorState.abilities);
    if (
      progress.tier >= 6
      && abilityChoice.length !== 2
    ) {
      const chooseAbilities = typeof this.options.chooseAbilities === "function"
        ? this.options.chooseAbilities
        : promptCurseEaterAbilityChoice;
      const selected = normalizeAbilityChoice(await chooseAbilities(actor));
      if (selected.length === 2) {
        abilityChoice = selected;
        await actor.setFlag(MODULE_ID, "curseEater", {
          ...actorState,
          abilities: selected
        });
      }
    }
    const desired = buildCurseEaterEffectData(progress, abilityChoice);
    const [primary, ...duplicates] = managedEffects;
    const duplicateIds = duplicates.map(documentId).filter(Boolean);
    if (duplicateIds.length) {
      await actor.deleteEmbeddedDocuments("ActiveEffect", duplicateIds, {
        rebreyaCurseEaterSync: true,
        render: false
      });
    }

    if (!primary) {
      await actor.createEmbeddedDocuments("ActiveEffect", [desired], {
        rebreyaCurseEaterSync: true,
        render: false
      });
    }
    else if (effectSignature(primary) !== effectSignature(desired)) {
      await primary.update(desired, {
        rebreyaCurseEaterSync: true,
        render: false
      });
    }

    this.#notifyTierChanged(actor, previousTier, progress.tier);
    return progress;
  }
}
