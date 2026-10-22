export const GROUP_REGISTRY_REGISTER_COMMAND = "group.registry.register";
export const GROUP_REGISTRY_ACTIVATE_COMMAND = "group.registry.activate";
export const GROUP_INVENTORY_MERGE_LEGACY_COMMAND = "group.inventory.merge-legacy";
export const GROUP_PARTY_DEFAULTS_UPDATE_COMMAND = "group.party.defaults.update";
export const GROUP_PARTY_MEMBER_UPDATE_COMMAND = "group.party.member.update";

function isPlainObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function isExactGroupActorPayload(payload) {
  return isPlainObject(payload)
    && Object.keys(payload).length === 1
    && Object.prototype.hasOwnProperty.call(payload, "groupActorId")
    && typeof payload.groupActorId === "string"
    && payload.groupActorId.trim().length > 0
    && payload.groupActorId === payload.groupActorId.trim();
}

export function isValidGroupRegistryRegisterPayload(payload) {
  return isExactGroupActorPayload(payload);
}

export function isValidGroupRegistryActivatePayload(payload) {
  return isExactGroupActorPayload(payload);
}

export function isValidGroupInventoryMergeLegacyPayload(payload) {
  return isExactGroupActorPayload(payload);
}

export function isValidGroupPartyDefaultsUpdatePayload(payload) {
  if (!isPlainObject(payload) || Object.keys(payload).length !== 2
    || !Object.prototype.hasOwnProperty.call(payload, "patch")
    || !isExactGroupActorPayload({ groupActorId: payload.groupActorId })
    || !isPlainObject(payload.patch)) return false;
  return Object.entries(payload.patch).every(([key, value]) => {
    if (key === "coverFoodExpenses" || key === "coverWaterExpenses") return typeof value === "boolean";
    if (key === "defaultCapMod") return typeof value === "string" || (typeof value === "number" && Number.isFinite(value));
    return false;
  });
}

export function isValidGroupPartyMemberUpdatePayload(payload) {
  if (!isPlainObject(payload) || Object.keys(payload).length !== 3
    || !isExactGroupActorPayload({ groupActorId: payload.groupActorId })
    || !isExactGroupActorPayload({ groupActorId: payload.actorId })
    || !isPlainObject(payload.patch)) return false;
  const numeric = value => value === null || typeof value === "string" || (typeof value === "number" && Number.isFinite(value));
  const numericFields = new Set(["foodPerDay", "waterGalPerDay", "strOverride", "capModOverride", "capBonusLb", "conModOverride", "energyCurrent"]);
  return Object.entries(payload.patch).every(([key, value]) => {
    if (key === "role") return typeof value === "string";
    if (numericFields.has(key)) return numeric(value);
    if (key !== "tools" || !isPlainObject(value)) return false;
    return Object.entries(value).every(([toolId, tool]) => toolId.trim()
      && !["__proto__", "constructor", "prototype"].includes(toolId) && isPlainObject(tool)
      && Object.entries(tool).every(([field, entry]) => ["owned", "prof"].includes(field)
        ? typeof entry === "boolean" || numeric(entry)
        : ["mod", "rank"].includes(field) && numeric(entry)));
  });
}
