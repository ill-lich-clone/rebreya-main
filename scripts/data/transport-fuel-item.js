import { MODULE_ID } from "../constants.js";
import { cleanText, collectionValues, finiteNumber } from "../shared/foundry-values.js";

function itemSource(item) {
  return typeof item?.toObject === "function" ? item.toObject() : (item ?? {});
}

function normalizeName(value) {
  return cleanText(value).toLocaleLowerCase("ru-RU").replace(/\s+/gu, " ");
}

export function normalizeTransportFuelSelector(value) {
  const selector = value && typeof value === "object" ? value : {};
  const name = cleanText(selector.name);
  return {
    uuid: cleanText(selector.uuid),
    sourceUuid: cleanText(selector.sourceUuid),
    sourceType: cleanText(selector.sourceType),
    sourceId: cleanText(selector.sourceId),
    type: cleanText(selector.type),
    normalizedName: normalizeName(selector.normalizedName || name),
    name,
    img: cleanText(selector.img)
  };
}

export function buildTransportFuelSelector(item) {
  const source = itemSource(item);
  const flags = source.flags ?? item?.flags ?? {};
  const moduleFlags = flags?.[MODULE_ID] ?? {};
  const name = cleanText(item?.name ?? source.name);
  return normalizeTransportFuelSelector({
    uuid: cleanText(item?.uuid ?? source.uuid),
    sourceUuid: cleanText(flags?.core?.sourceId ?? moduleFlags.sourceUuid),
    sourceType: cleanText(moduleFlags.sourceType),
    sourceId: cleanText(moduleFlags.sourceId),
    type: cleanText(item?.type ?? source.type),
    normalizedName: normalizeName(name),
    name,
    img: cleanText(item?.img ?? source.img)
  });
}

function isConfigured(selector) {
  return Boolean(
    selector.uuid
    || selector.sourceUuid
    || (selector.sourceType && selector.sourceId)
    || (selector.type && selector.normalizedName)
  );
}

export function matchesTransportFuelSelector(item, value) {
  const selector = normalizeTransportFuelSelector(value);
  if (!isConfigured(selector)) return false;
  const candidate = buildTransportFuelSelector(item);

  if (selector.uuid && candidate.uuid === selector.uuid) return true;
  if (
    selector.sourceType
    && selector.sourceId
    && candidate.sourceType === selector.sourceType
    && candidate.sourceId === selector.sourceId
  ) return true;
  if (
    (selector.uuid && candidate.sourceUuid === selector.uuid)
    || (selector.sourceUuid && candidate.uuid === selector.sourceUuid)
    || (selector.sourceUuid && candidate.sourceUuid === selector.sourceUuid)
  ) return true;
  return Boolean(
    selector.type
    && selector.normalizedName
    && candidate.type === selector.type
    && candidate.normalizedName === selector.normalizedName
  );
}

export function buildTransportFuelInventorySnapshot(items, value) {
  const selector = normalizeTransportFuelSelector(value);
  const configured = isConfigured(selector);
  const stacks = configured
    ? collectionValues(items)
      .filter((item) => matchesTransportFuelSelector(item, selector))
      .map((item) => {
        const source = itemSource(item);
        return {
          itemId: cleanText(item?.id ?? source._id ?? source.id),
          itemUuid: cleanText(item?.uuid ?? source.uuid),
          quantity: Math.max(0, finiteNumber(item?.system?.quantity ?? source.system?.quantity, 0)),
          name: cleanText(item?.name ?? source.name),
          img: cleanText(item?.img ?? source.img),
          type: cleanText(item?.type ?? source.type)
        };
      })
      .sort((left, right) => left.itemId.localeCompare(right.itemId))
    : [];
  const primary = stacks[0] ?? null;
  const quantity = stacks.reduce((total, stack) => total + stack.quantity, 0);

  return {
    configured,
    selector,
    stacks,
    quantity,
    primaryItemId: primary?.itemId ?? "",
    primaryItemUuid: primary?.itemUuid ?? "",
    openUuid: primary?.itemUuid || selector.uuid || selector.sourceUuid,
    name: primary?.name || selector.name,
    img: primary?.img || selector.img,
    type: primary?.type || selector.type,
    isEmpty: quantity <= 0
  };
}
