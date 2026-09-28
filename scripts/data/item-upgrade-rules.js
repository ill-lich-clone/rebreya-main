const BASE_TAGS = new Set(["any", "weapon", "armor", "outerwear", "shield", "wondrous-item"]);
const QUALIFIERS = new Set(["melee", "ranged", "nonmetal", "brass-knuckles-or-metal-gauntlet"]);
const MESSAGES = {
  unavailable: "Усовершенствования нет в реализации",
  incompatible: "Усовершенствование несовместимо с этим предметом.",
  capacity: "На предмете нет свободного слота усовершенствования или указана недопустимая вместимость.",
  "slot-conflict": "Слот усовершенствования уже занят или связи слотов повреждены.",
  "invalid-quantity": "Сначала отделите один экземпляр предмета; количество должно быть целым положительным числом."
};

export class UpgradeRuleError extends Error {
  constructor(code, details = {}) {
    super(`${MESSAGES[code] ?? code}${details.reason ? `: ${details.reason}` : ""}`);
    this.name = "UpgradeRuleError";
    this.code = code;
    this.details = details;
  }
}

/** An explicit stored object is authoritative, including incomplete custom rules. */
export function resolveUpgradeProfile(storedProfile, catalogProfile) {
  const profile = storedProfile && typeof storedProfile === "object" && !Array.isArray(storedProfile)
    ? storedProfile : catalogProfile;
  return profile && typeof profile === "object" && !Array.isArray(profile) ? structuredClone(profile) : null;
}

export function validateUpgradeCapacity(host, installed, capacity) {
  if (host?.quantity !== 1) throw new UpgradeRuleError("invalid-quantity");
  if (!Number.isInteger(capacity) || capacity < 1 || capacity > 3 || !Array.isArray(installed)
    || installed.some(entry => !Number.isInteger(entry.slotIndex) || entry.slotIndex < 1 || entry.slotIndex > capacity)) {
    throw new UpgradeRuleError("capacity");
  }
  if (new Set(installed.map(entry => entry.slotIndex)).size !== installed.length) throw new UpgradeRuleError("slot-conflict");
  return capacity;
}

export function validateUpgradeInstallation(host, installed, candidate) {
  const availability = candidate?.availability;
  const decision = typeof availability === "string" ? availability : availability?.decision;
  if (!["existing-curse", "simple-implemented"].includes(decision)) {
    throw new UpgradeRuleError("unavailable", { reason: availability?.reason });
  }
  const capacity = validateUpgradeCapacity(host, installed, host?.capacity);
  const tags = candidate?.profile?.compatibility;
  const hostTags = new Set(host?.compatibilityTags ?? []);
  // Catalog weapon qualifiers are conjunctions: "weapon, ranged" must not admit a melee weapon.
  // Base categories are alternatives: "outerwear, shield" admits either category.
  if (!Array.isArray(tags) || !tags.length || tags.some(tag => !BASE_TAGS.has(tag) && !QUALIFIERS.has(tag))
    || !tags.some(tag => BASE_TAGS.has(tag) && (tag === "any" || hostTags.has(tag)))
    || tags.some(tag => QUALIFIERS.has(tag) && !hostTags.has(tag))) throw new UpgradeRuleError("incompatible");
  const occupied = new Set(installed.map(entry => entry.slotIndex));
  const slotIndex = candidate.slotIndex ?? Array.from({ length: capacity }, (_, i) => i + 1).find(i => !occupied.has(i));
  if (!Number.isInteger(slotIndex) || slotIndex < 1 || slotIndex > capacity) throw new UpgradeRuleError("capacity");
  if (occupied.has(slotIndex)) throw new UpgradeRuleError("slot-conflict");
  return { allowed: true, slotIndex };
}

export function evaluateUpgradeActivation(host, actor, profile) {
  const policy = profile?.activation;
  if (!["carried", "equipped", "held", "attuned"].includes(policy)) return { supported: false, active: false, reason: "unsupported-policy" };
  if (host?.isBroken && profile?.worksWhenBroken === false) return { supported: true, active: false, reason: "broken" };
  const active = policy === "carried" || Boolean(host?.[{ equipped: "isEquipped", held: "isHeld", attuned: "isAttuned" }[policy]]);
  return { supported: true, active, reason: active ? "active" : policy };
}
