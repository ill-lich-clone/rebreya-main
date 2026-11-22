/**
 * In-play state mapping between dnd5e and the Rebreya site (pure, tested).
 *
 * - Conditions: the site stores condition catalogue slugs (transliterated RU);
 *   dnd5e uses status ids (DND5E.conditionTypes keys). Unknown values pass
 *   through untouched in both directions. Exhaustion travels as the numeric
 *   `exhaustion` level, never inside `conditions`.
 * - Hit dice: the site keeps one number (total spent); dnd5e keeps `hd.spent`
 *   per class Item.
 * - stateSignature: a stable fingerprint of the synced state, used to tell
 *   "changed locally since the last sync" and to suppress echo pushes.
 */

/** Site condition slug → dnd5e status id. */
export const SITE_CONDITION_TO_STATUS = Object.freeze({
  shvachennyy: "grappled",
  "sbityy-s-nog": "prone",
  paralizovannyy: "paralyzed",
  oshelomlennyy: "stunned",
  ocharovannyy: "charmed",
  otravlennyy: "poisoned",
  osleplennyy: "blinded",
  oputannyy: "restrained",
  okamenevshiy: "petrified",
  oglohshiy: "deafened",
  nedeesposobnyy: "incapacitated",
  nevidimyy: "invisible",
  ispugannyy: "frightened",
  bessoznatelnyy: "unconscious",
});

/** dnd5e status id → site condition slug. */
export const STATUS_TO_SITE_CONDITION = Object.freeze(
  Object.fromEntries(Object.entries(SITE_CONDITION_TO_STATUS).map(([slug, id]) => [id, slug])),
);

/** Statuses that never go into `conditions` (sent as their own fields). */
const NON_CONDITION_STATUSES = new Set(["exhaustion"]);
const SITE_EXHAUSTION_SLUG = "istoschenie";

/** Statuses the sync fully owns (added AND removed to match the site). */
export const SYNCED_STATUS_IDS = Object.freeze(Object.values(SITE_CONDITION_TO_STATUS));

/** dnd5e statuses → site `conditions` (sorted, unique, unknown kept as-is). */
export function toSiteConditions(statuses = []) {
  const out = new Set();
  for (const raw of statuses ?? []) {
    const id = String(raw ?? "").trim();
    if (!id || NON_CONDITION_STATUSES.has(id)) continue;
    out.add(STATUS_TO_SITE_CONDITION[id] ?? id);
  }
  return [...out].sort();
}

/** Site `conditions` → dnd5e status ids (unknown kept as-is, exhaustion dropped). */
export function fromSiteConditions(conditions = []) {
  const out = new Set();
  for (const raw of Array.isArray(conditions) ? conditions : []) {
    const slug = String(raw ?? "").trim();
    if (!slug || slug === SITE_EXHAUSTION_SLUG) continue;
    out.add(SITE_CONDITION_TO_STATUS[slug] ?? slug);
  }
  return [...out].sort();
}

/**
 * Which statuses to switch on/off so the Actor matches the site. Synced
 * (mapped) statuses are added and removed; unknown ones are only added — a
 * status the site does not know about is never removed by a pull.
 * @returns {{add:string[], remove:string[]}}
 */
export function diffStatuses(localStatuses = [], siteConditions = []) {
  const local = new Set(localStatuses ?? []);
  const wanted = new Set(fromSiteConditions(siteConditions));
  const add = [...wanted].filter((id) => !local.has(id)).sort();
  const remove = SYNCED_STATUS_IDS.filter((id) => local.has(id) && !wanted.has(id)).sort();
  return { add, remove };
}

const dieSize = (denomination) => Number(String(denomination ?? "").replace(/^d/u, "")) || 0;

/**
 * Total spent hit dice across class Items.
 * @param {{system?:{levels?:number, hd?:{spent?:number}}}[]} classes
 */
export function sumSpentHitDice(classes = []) {
  return (classes ?? []).reduce((total, cls) => total + Math.max(0, Math.trunc(Number(cls?.system?.hd?.spent) || 0)), 0);
}

/**
 * Spread the site's single spent count over class Items, spending the largest
 * die first (and never more than a class's levels).
 * @returns {{_id:string, "system.hd.spent":number}[]} updates for changed classes only
 */
export function distributeSpentHitDice(classes = [], totalSpent = 0) {
  let remaining = Math.max(0, Math.trunc(Number(totalSpent) || 0));
  const ordered = [...(classes ?? [])].sort((a, b) =>
    dieSize(b?.system?.hd?.denomination) - dieSize(a?.system?.hd?.denomination)
    || String(a?._id ?? a?.id ?? "").localeCompare(String(b?._id ?? b?.id ?? "")));
  const updates = [];
  for (const cls of ordered) {
    const levels = Math.max(0, Math.trunc(Number(cls?.system?.levels) || 0));
    const spent = Math.min(levels, remaining);
    remaining -= spent;
    const current = Math.max(0, Math.trunc(Number(cls?.system?.hd?.spent) || 0));
    if (spent !== current) updates.push({ _id: cls._id ?? cls.id, "system.hd.spent": spent });
  }
  return updates;
}

/** Stable JSON (sorted keys) so equal states give equal strings. */
function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${stableStringify(value[k])}`).join(",")}}`;
  }
  return JSON.stringify(value ?? null);
}

/**
 * Fingerprint of a state patch (clientSync excluded): FNV-1a over stable JSON.
 * Equal for equal synced state, whatever the key order.
 */
export function stateSignature(patch = {}) {
  const { clientSync: _ignored, ...state } = patch ?? {};
  const text = stableStringify(state);
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return `fnv1a:${hash.toString(16).padStart(8, "0")}`;
}
