import { MODULE_ID } from "../constants.js";
import { getCharacterSizeRule } from "./size-automation-service.js?v=1.4.109-character-size";

function collectionValues(collection) {
  if (Array.isArray(collection)) return collection;
  if (Array.isArray(collection?.contents)) return collection.contents;
  if (typeof collection?.values === "function") return Array.from(collection.values());
  if (collection && typeof collection[Symbol.iterator] === "function") return Array.from(collection);
  return [];
}

function finiteNonNegative(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, number) : 0;
}

function actorFlag(actor, key) {
  if (typeof actor?.getFlag === "function") return actor.getFlag(MODULE_ID, key);
  return actor?.flags?.[MODULE_ID]?.[key];
}

function runeKnightReachBonusFeet(actor) {
  let maximum = 0;
  for (const effect of collectionValues(actor?.effects)) {
    if (effect?.disabled === true || effect?.isSuppressed === true) continue;
    const runeKnight = effect?.flags?.[MODULE_ID]?.runeKnight;
    if (String(runeKnight?.automation ?? "").trim() !== "giant-might-form") continue;
    if (String(runeKnight?.form?.appliedActorSize ?? "").trim().toLowerCase() !== "huge") continue;
    maximum = Math.max(maximum, finiteNonNegative(runeKnight?.reachBonus));
  }
  return maximum;
}

export function getNaturalReachFeet(actor) {
  const sizeReach = getCharacterSizeRule(actor?.system?.traits?.size).baseReachFeet;
  const racialReach = finiteNonNegative(actorFlag(actor, "racialReachBonusFeet"));
  return Math.max(0, sizeReach + racialReach + runeKnightReachBonusFeet(actor));
}
