import { createLootgenCatalogReader } from "./lootgen-catalog-reader.js?v=1.4.266";
import { loadUpgradeAutomationManifest } from "./upgrade-automation-manifest.js?v=1.4.255";
import { MODULE_ID, GEAR_COMPENDIUM_NAME, MAGIC_ITEMS_COMPENDIUM_NAME } from "../constants.js";
import { resolveLootgenItemValue } from "./item-value.js?v=1.4.264";
import { collectBreakableManagedGearIds } from "./lootgen-durability.js?v=1.4.154-corpse-storage-broken-name";
import { generateLootgenResult, isLootgenUpgrade, normalizeLootgenForm } from "./lootgen-generator.js?v=1.4.278";
import { buildLootgenTypeFilterOptions, isLootgenTypeAllowed, resolveMagicLootgenTypeLabel } from "./lootgen-type-filters.js?v=1.4.258";
const MATERIAL_LOOTGEN_TYPE_LABEL="Материал";
function toNumber(value, fallback = 0) {
  const numericValue = Number(value ?? fallback);
  return Number.isFinite(numericValue) ? numericValue : fallback;
}

function toInteger(value, fallback = 0) {
  return Math.floor(toNumber(value, fallback));
}

function parsePriceToGold(price = {}) {
  const value = Math.max(0, toNumber(price?.value, 0));
  const denomination = String(price?.denomination ?? "gp").toLowerCase();

  switch (denomination) {
    case "pp":
      return value * 10;
    case "sp":
      return value * 0.1;
    case "cp":
      return value * 0.01;
    case "gp":
    default:
      return value;
  }
}

function normalizeBargainingTag(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/ё/gu, "е");
}

function isBargainingBlocked(value) {
  const normalized = normalizeBargainingTag(value);
  if (!normalized) {
    return false;
  }

  return normalized.includes("запрещ") || normalized.includes("невозмож");
}

export function buildLootgenMundaneCandidate(gearItem, {
  rank,
  value,
  typeLabel,
  breakable = false
} = {}) {
  return {
    sourceType: "gear",
    sourceId: String(gearItem?.id ?? ""),
    name: String(gearItem?.name ?? "Снаряжение"),
    rank: Math.max(0, toInteger(rank, 0)),
    value: Math.max(0, toInteger(value, 0)),
    multipleAppearance: String(gearItem?.multipleAppearance ?? "1"),
    typeLabel: String(typeLabel ?? gearItem?.equipmentType ?? "Снаряжение"),
    stackable: true,
    breakable: Boolean(breakable)
  };
}

export function buildLootgenGearTypeOptions(model, selectedState={}) {
    return buildLootgenTypeFilterOptions(
      [
        ...(model?.gear ?? []).filter(item => !isLootgenUpgrade(item)).map((item) => item?.equipmentType ?? "Снаряжение"),
        ...((model?.materials ?? []).length ? [MATERIAL_LOOTGEN_TYPE_LABEL] : [])
      ],
      selectedState
    );
  }

export function buildLootgenMundanePool({model,form,breakableGearIds=new Set()}) {
    form=normalizeLootgenForm(form);
    const minRank = Math.max(0, Math.min(form.rankMin, form.rankMax));
    const maxRank = Math.max(minRank, Math.max(form.rankMin, form.rankMax));
    const pool = [];
    const gearTypeOptions = buildLootgenGearTypeOptions(model, form.gearTypeFilters);

    if (form.includeGear) {
      for (const gearItem of model.gear ?? []) {
        if (isLootgenUpgrade(gearItem)) continue;
        const bargaining = gearItem.bargaining ?? gearItem.itemBargaining ?? "";
        if (isBargainingBlocked(bargaining)) {
          continue;
        }

        const rank = Math.max(0, toInteger(gearItem.rank, 0));
        if (rank < minRank || rank > maxRank) {
          continue;
        }

        const typeLabel = String(gearItem.equipmentType ?? "Снаряжение");
        if (!isLootgenTypeAllowed(typeLabel, gearTypeOptions)) {
          continue;
        }

        const fallbackGold = toNumber(gearItem.priceGoldEquivalent, toNumber(gearItem.priceValue, 0));
        const value = resolveLootgenItemValue(gearItem.value, fallbackGold);
        pool.push(buildLootgenMundaneCandidate(gearItem, {
          rank,
          value,
          typeLabel,
          breakable: breakableGearIds.has(String(gearItem.id))
        }));
      }

      if (isLootgenTypeAllowed(MATERIAL_LOOTGEN_TYPE_LABEL, gearTypeOptions)) {
        for (const material of model.materials ?? []) {
          const bargaining = material.bargaining ?? material.itemBargaining ?? "";
          if (isBargainingBlocked(bargaining)) {
            continue;
          }

          const rank = Math.max(0, toInteger(material.rank, 0));
          if (rank < minRank || rank > maxRank) {
            continue;
          }

          const fallbackGold = toNumber(material.priceGold, 0);
          const value = resolveLootgenItemValue(material.value, fallbackGold);
          pool.push({
            sourceType: "material",
            sourceId: String(material.id),
            name: String(material.name ?? MATERIAL_LOOTGEN_TYPE_LABEL),
            rank,
            value,
            multipleAppearance: "1",
            typeLabel: MATERIAL_LOOTGEN_TYPE_LABEL,
            stackable: true
          });
        }
      }
    }

    return pool.sort((left, right) => left.rank - right.rank || left.value - right.value);
  }

export function buildLootgenMagicPool({form,documents=[]}) {
    form=normalizeLootgenForm(form);
    const minRank = Math.max(0, Math.min(form.rankMin, form.rankMax));
    const maxRank = Math.max(minRank, Math.max(form.rankMin, form.rankMax));

    const magicTypeOptions = buildLootgenTypeFilterOptions(documents.map(resolveMagicLootgenTypeLabel),form.magicTypeFilters);
    const pool = [];
    for (const document of documents) {
      const flags = document?.flags?.[MODULE_ID] ?? {};
      let signatureBargaining = "";
      const signatureRaw = String(flags.signature ?? "").trim();
      if (signatureRaw.startsWith("{")) {
        try {
          signatureBargaining = String(JSON.parse(signatureRaw)?.bargaining ?? "");
        }
        catch (_error) {
          signatureBargaining = "";
        }
      }

      const bargaining = flags.bargaining ?? flags.itemBargaining ?? signatureBargaining;
      if (isBargainingBlocked(bargaining)) {
        continue;
      }

      const rank = Math.max(0, toInteger(
        flags.rank
        ?? flags.itemRank
        ?? document?.system?.rank
        ?? 0,
        0
      ));
      if (rank < minRank || rank > maxRank) {
        continue;
      }

      const sourceId = String(flags.magicItemId ?? document.id ?? "").trim();
      if (!sourceId) {
        continue;
      }

      const explicitValue = toNumber(flags.value, 0);
      const legacyValue = toNumber(flags.priceGold, 0);
      const fallbackPrice = parsePriceToGold(document?.system?.price ?? {});
      const value = explicitValue > 0
        ? Math.max(1, toInteger(explicitValue, 1))
        : (legacyValue > 0
          ? Math.max(1, toInteger(legacyValue, 1))
          : Math.max(1, toInteger(Math.round(fallbackPrice * 100), 1)));
      const isConsumable = document.type === "consumable"
        || Boolean(flags.isConsumable)
        || String(flags.foundryType ?? "").trim().toLowerCase() === "consumable";
      const typeLabel = resolveMagicLootgenTypeLabel(document);
      if (!isLootgenTypeAllowed(typeLabel, magicTypeOptions)) {
        continue;
      }

      pool.push({
        sourceType: "magicItem",
        sourceId,
        name: String(document.name ?? "Магический предмет"),
        rank,
        value,
        typeLabel,
        stackable: isConsumable
      });
    }

    return pool.sort((left, right) => left.rank - right.rank || left.value - right.value);
  }


/** Read-only shared source owner; no Application, writes, random selection or compendium synchronization in load. */
export class LootgenSourceCatalog {
  constructor({getModel,getGearIndex=readLootgenGearIndex,getMagicDocuments=readLootgenMagicDocuments,getManifest=loadUpgradeAutomationManifest,getCoinWeight=readLootgenCoinWeight}={}) {
    this.getManifest=getManifest;this.getCoinWeight=getCoinWeight;
    this.getModel=getModel;this.getGearIndex=getGearIndex;this.getMagicDocuments=getMagicDocuments;
  }
  async load(rawForm) {
    const form=normalizeLootgenForm(rawForm);
    const [model,gearIndex,magicDocuments,manifest]=await Promise.all([
      this.getModel(),(form.includeGear||form.enableUpgrades||form.enableFilledContainers)?this.getGearIndex():[],form.includeMagicItems?this.getMagicDocuments():[],form.enableUpgrades?this.getManifest():[]
    ]);
    return {form,model,gearIndex,magicDocuments,manifest,
      coinWeightPerCoinLb:form.enableFilledContainers?this.getCoinWeight():0.02,
      catalogReader:(form.enableUpgrades||form.enableFilledContainers)?createLootgenCatalogReader({model,gearIndex,magicDocuments,manifest}):null,
      mundanePool:buildLootgenMundanePool({model,form,breakableGearIds:collectBreakableManagedGearIds(gearIndex)}),
      magicPool:form.includeMagicItems?buildLootgenMagicPool({form,documents:magicDocuments}):[]};
  }
  async generate(form, options={}) {
    const snapshot=await this.load(form);
    return generateLootgenResult({...options,form:snapshot.form,mundanePool:snapshot.mundanePool,magicPool:snapshot.magicPool,manifest:snapshot.manifest,catalogReader:snapshot.catalogReader,coinWeightPerCoinLb:snapshot.coinWeightPerCoinLb});
  }
}

export async function readLootgenGearIndex() {
  const pack=globalThis.game?.packs?.get(`world.${GEAR_COMPENDIUM_NAME}`);
  if(!pack)return [];
    return pack.getIndex({
      fields: [
        "type",
        "system.type",
        "system.quantity",
        "system.weight",
        "system.volume",
        "system.capacity",
        "_stats.modifiedTime",
        `flags.${MODULE_ID}.equipmentType`,
        `flags.${MODULE_ID}.upgradeCompatibilityTags`,
        `flags.${MODULE_ID}.itemUpgrades`,
        `flags.${MODULE_ID}.upgrade`,
        `flags.${MODULE_ID}.itemUpgradeTemplate`,
        "system.rarity",
        "system.properties",
        `flags.${MODULE_ID}.managed`,
        `flags.${MODULE_ID}.sourceType`,
        `flags.${MODULE_ID}.sourceId`,
        `flags.${MODULE_ID}.gearId`,
        `flags.${MODULE_ID}.magical`,
        `flags.${MODULE_ID}.isMagical`,
        `flags.${MODULE_ID}.magic`,
        `flags.${MODULE_ID}.magicItemId`,
        `flags.${MODULE_ID}.magicId`
      ]
    });
}

export async function readLootgenMagicDocuments() {
  const pack=globalThis.game?.packs?.get(`world.${MAGIC_ITEMS_COMPENDIUM_NAME}`);
  return pack?pack.getDocuments():[];
}

/** Match native dnd5e currency weight without reading or changing any Actor. */
export function readLootgenCoinWeight(){
  const settings=globalThis.game?.settings;
  if(!settings?.get)return 0.02;
  if(settings.get("dnd5e","currencyWeight")===false)return 0;
  const metric=settings.get("dnd5e","metricWeightUnits")===true;
  const config=globalThis.CONFIG?.DND5E;
  const perWeight=config?.encumbrance?.currencyPerWeight?.[metric?"metric":"imperial"]??(metric?100:50);
  const factor=metric?(config?.weightUnits?.kg?.conversion??2.5)/(config?.weightUnits?.lb?.conversion??1):1;
  if(!Number.isFinite(perWeight) || perWeight<=0 || !Number.isFinite(factor) || factor<=0)throw new Error("Неизвестен вес монет системы.");
  return factor/perWeight;
}
