import { MODULE_ID } from "../constants.js";
import { collectionValues, finiteNumber as toNumber } from "../shared/foundry-values.js";

export const LAARU_BARDIC_INSPIRATION_SOURCE_UUID = "Compendium.laaru-dnd5-hw.classfeatures.Item.hpLNiGq7y67d2EHA";

function cleanText(value, fallback = "") {
  const text = String(value ?? "").trim();
  return text || fallback;
}

function normalizeText(value) {
  return cleanText(value)
    .toLowerCase()
    .replace(/\u0451/gu, "\u0435")
    .replace(/['\u2019\u2018\u02BC\u02B9\u2032"\u201C\u201D\u00AB\u00BB]/gu, "")
    .replace(/\s+/gu, " ");
}

function getProperty(source, path, fallback = undefined) {
  const value = globalThis.foundry?.utils?.getProperty instanceof Function
    ? foundry.utils.getProperty(source, path)
    : String(path ?? "").split(".").reduce((current, key) => current?.[key], source);
  return value === undefined ? fallback : value;
}

function setProperty(source, path, value) {
  if (globalThis.foundry?.utils?.setProperty instanceof Function) {
    return foundry.utils.setProperty(source, path, value);
  }

  const keys = String(path ?? "").split(".").filter(Boolean);
  let cursor = source;
  while (keys.length > 1) {
    const key = keys.shift();
    cursor[key] ??= {};
    cursor = cursor[key];
  }
  cursor[keys[0]] = value;
  return true;
}

function getModuleFlags(document) {
  return document?.flags?.[MODULE_ID] ?? {};
}

function getSourceId(item) {
  return cleanText(
    item?.flags?.core?.sourceId
    ?? item?.flags?.dnd5e?.sourceId
    ?? getProperty(item, "flags.core.sourceId")
    ?? getProperty(item, "flags.dnd5e.sourceId")
  );
}

function getItemDescriptionText(item) {
  const html = cleanText(item?.system?.description?.value);
  return html
    .replace(/<br\s*\/?>/giu, "\n")
    .replace(/<[^>]+>/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
}

export function isBardicInspirationRestoreItem(item) {
  const flags = getModuleFlags(item);
  if (flags.restoreBardicInspiration === true || flags.bardicInspirationRestore === true) {
    return true;
  }

  const name = normalizeText(item?.name);
  const description = normalizeText(getItemDescriptionText(item));
  return name.startsWith("барабан задающего ритм")
    && description.includes("восстановить одну кость бардовского вдохновения");
}

export function isLaaruBardicInspirationItem(item) {
  if (!item) {
    return false;
  }

  if (getSourceId(item) === LAARU_BARDIC_INSPIRATION_SOURCE_UUID) {
    return true;
  }

  return normalizeText(item.name).includes("бардовское вдохновение")
    && item.system?.uses
    && normalizeText(getSourceId(item)).includes("laaru");
}

export class BardicInspirationCompatService {
  constructor(moduleApi = null) {
    this.moduleApi = moduleApi;
  }

  findBardicInspirationItem(actor) {
    return collectionValues(actor?.items).find((item) => isLaaruBardicInspirationItem(item)) ?? null;
  }

  async restoreBardicInspiration(actor, { amount = 1 } = {}) {
    const item = this.findBardicInspirationItem(actor);
    if (!item) {
      return { restored: false, reason: "missing-bardic-inspiration" };
    }

    const spent = Math.max(0, Math.floor(toNumber(item?.system?.uses?.spent, 0)));
    const restoreAmount = Math.max(1, Math.floor(toNumber(amount, 1)));
    const nextSpent = Math.max(0, spent - restoreAmount);
    if (nextSpent === spent) {
      return { restored: false, reason: "already-full", item };
    }

    if (typeof item.update === "function") {
      await item.update({ "system.uses.spent": nextSpent });
    }
    else {
      setProperty(item, "system.uses.spent", nextSpent);
    }

    return {
      restored: true,
      item,
      previousSpent: spent,
      nextSpent
    };
  }

  async applyDnd5ePostUseActivity(activity, _usageConfig = {}, _results = {}) {
    const item = activity?.item ?? activity?.parent ?? null;
    if (!isBardicInspirationRestoreItem(item)) {
      return true;
    }

    const actor = activity?.actor ?? item?.actor ?? item?.parent ?? null;
    await this.restoreBardicInspiration(actor);
    return true;
  }
}
