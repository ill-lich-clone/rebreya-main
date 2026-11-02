import { MODULE_ID } from "../../constants.js";
import { sourceItemOf } from "./effect-data.js";

const cpr = (doc) => doc?.flags?.["chris-premades"];
const entries = (collection) => Array.from(collection?.values?.() ?? collection ?? []);
const identifier = (doc) => cpr(doc)?.info?.identifier;
const controls = new Map([
  ["hex", ["hex", "hexMove"]],
  ["heatMetal", ["heatMetal", "heatMetalPulse"]],
  ["findSteed", ["findSteed", "findSteedDismiss"]],
  ["wardingBondSource", ["wardingBond", "wardingBondDismiss"]]
]);
const dependentSources = new Map([
  ["wardingBondTarget", "wardingBond"],
  ["blurEffect", "blur"],
  ["compelledDuelSource", "compelledDuel"],
  ["rayOfEnfeeblementEnfeebled", "rayOfEnfeeblement"]
]);
const installations = new WeakMap();
const strictChildren = new Map([
  ["branded", "brandingSmite"],
  ["compelledDuelTarget", "compelledDuel"]
]);
const owns = (actor, user) => Boolean(user && (user.isGM || actor?.testUserPermission?.(user, "OWNER")));
const childKey = (effect) => `worldCardChildren.${effect.uuid.replaceAll(".", "_")}`;

export async function rememberCardDependent(parent, child, user) {
  if (!parent || !child?.uuid || !owns(parent.parent, user) || child.flags?.dnd5e?.dependentOn !== parent.uuid) return;
  if (
    !strictChildren.has(identifier(child)) &&
    (!dependentSources.has(identifier(child)) || !cpr(child)?.interdependent)
  )
    return;
  const key = childKey(child);
  if (parent.getFlag(MODULE_ID, key) !== child.uuid) await parent.setFlag(MODULE_ID, key, child.uuid);
}

function controlFor(effect, deleted = false) {
  const mapping = controls.get(identifier(effect)),
    actor = effect?.parent;
  if (!mapping || actor?.documentName !== "Actor") return null;
  const [spell, key] = mapping,
    expose = cpr(effect)?.unhideActivities;
  if (!Array.isArray(expose?.activityIdentifiers) || !expose.activityIdentifiers.includes(key)) return null;
  const item = entries(actor.items).find((doc) => doc.uuid === expose.itemUuid && identifier(doc) === spell);
  if (!item) return null;
  if (effect.origin !== item.uuid) {
    const concentration = entries(actor.effects).find((e) => e.uuid === effect.origin);
    if (concentration) {
      if (!concentration.statuses?.has("concentrating") || concentration.flags?.dnd5e?.item?.id !== item.id)
        return null;
    } else if (
      !deleted ||
      effect.origin !== cpr(effect)?.concentrationEffectUuid ||
      !effect.origin?.startsWith(`${actor.uuid}.ActiveEffect.`)
    )
      return null;
  }
  const activity = item.system.activities?.get(cpr(item).activityIdentifiers?.[key]);
  return activity ? { item, key, activity } : null;
}

async function reconcileControl(item, key, activity) {
  const actor = item.actor;
  const active = entries(actor.effects).filter(
    (effect) =>
      effect.active !== false &&
      !effect.disabled &&
      !effect.duration?.expired &&
      !effect.isSuppressed &&
      controlFor(effect)?.item === item
  );
  const visible = active.length > 0;
  const hidden = new Set(cpr(item).hiddenActivities ?? []);
  const riders = new Set(item.flags?.dnd5e?.riders?.activity ?? []);
  const nativeRider = entries(item.effects).some((effect) => effect.riders?.activity?.has?.(activity.id));
  const ui = actor.system,
    uuid = activity.relativeUUID;
  const wantsFavorite =
    active.some((e) => cpr(e).unhideActivities.favorite === true) &&
    Boolean(ui?.addFavorite && ui.hasFavorite) &&
    !ui.hasFavorite(uuid);
  const ownedFavorite = item.flags?.[MODULE_ID]?.worldCardFavorite === activity.id;
  const changes = {};
  const prior = item.flags?.[MODULE_ID]?.worldCardShown;
  if (visible && !prior)
    changes[`flags.${MODULE_ID}.worldCardShown`] = {
      id: activity.id,
      hidden: hidden.has(key),
      rider: riders.has(activity.id) || hidden.has(key)
    };
  if (!visible && prior?.id === activity.id) changes[`flags.${MODULE_ID}.worldCardShown`] = null;
  const shouldHide = !visible && (prior?.hidden ?? hidden.has(key));
  const shouldBeRider = !visible && (prior?.rider ?? (hidden.has(key) || riders.has(activity.id)));
  if (shouldHide !== hidden.has(key)) {
    if (shouldHide) hidden.add(key);
    else hidden.delete(key);
    changes["flags.chris-premades.hiddenActivities"] = [...hidden];
  }
  if (!nativeRider && shouldBeRider !== riders.has(activity.id)) {
    if (shouldBeRider) riders.add(activity.id);
    else riders.delete(activity.id);
    changes["flags.dnd5e.riders.activity"] = [...riders];
  }
  if (wantsFavorite && !ownedFavorite) changes[`flags.${MODULE_ID}.worldCardFavorite`] = activity.id;
  if (!visible && ownedFavorite) {
    if (ui.hasFavorite?.(uuid)) await ui.removeFavorite(uuid);
    changes[`flags.${MODULE_ID}.worldCardFavorite`] = null;
  }
  if (Object.keys(changes).length) await item.update(changes);
  if (wantsFavorite) await ui.addFavorite({ type: "activity", id: uuid });
}

async function trackDependent(effect, user, resolve, deleted) {
  const flags = cpr(effect),
    strictSpell = strictChildren.get(identifier(effect));
  const spell = strictSpell ?? dependentSources.get(identifier(effect));
  if (!spell || (!strictSpell && !flags.interdependent)) return;
  const parentUuid = flags.parentEntityUuid ?? flags.concentrationEffectUuid;
  if (!parentUuid || effect.flags.dnd5e?.dependentOn !== parentUuid) return;
  const parent = await resolve(parentUuid);
  if (parent?.documentName !== "ActiveEffect") return;
  if (parent.flags?.dnd5e?.dependentOn === effect.uuid) return;
  const key = childKey(effect);
  const known = parent.getFlag(MODULE_ID, key) === effect.uuid;
  // Only the source owner or a GM can establish this parent-side record. A fabricated
  // link on a player's effect is insufficient to release someone else's concentration.
  const authorized = deleted
    ? known || (effect.parent === parent.parent && owns(parent.parent, user))
    : owns(parent.parent, user);
  if (!authorized) return;
  if (strictSpell) {
    if (identifier(parent) !== (spell === "compelledDuel" ? "compelledDuelSource" : spell)) return;
    const item = await sourceItemOf(parent, resolve);
    if (
      item?.actor !== parent.parent ||
      identifier(item) !== spell ||
      (effect.origin !== parent.uuid && effect.origin !== item.uuid)
    )
      return;
  } else if (spell === "wardingBond") {
    if (identifier(parent) !== "wardingBondSource" || effect.origin !== parent.origin) return;
    const origin = await resolve(parent.origin);
    if (origin?.actor !== parent.parent || identifier(origin) !== spell) return;
  } else {
    if (!parent.statuses?.has("concentrating") || effect.origin !== parent.uuid) return;
    if (identifier(parent.parent.items?.get(parent.flags?.dnd5e?.item?.id)) !== spell) return;
  }
  if (!deleted) {
    await rememberCardDependent(parent, effect, user);
    return;
  }
  if (strictSpell || parent.getDependents?.().every((doc) => doc.uuid === effect.uuid)) await parent.delete();
  else if (known) await parent.unsetFlag(MODULE_ID, key);
}

export function registerWorldCardEffectLifecycle({
  Hooks,
  game,
  resolve = (uuid) => globalThis.fromUuid(uuid, { strict: false })
}) {
  if (installations.has(Hooks)) return installations.get(Hooks);
  const enabled = () => game.user?.id === game.users.activeGM?.id && !game.modules.get("chris-premades")?.active;
  let queue = Promise.resolve();
  const enqueue = (task) => {
    const result = queue.then(() => {
      if (enabled()) return task();
    });
    queue = result.catch((error) => console.error(`${MODULE_ID} | World card effect lifecycle`, error));
    return queue;
  };
  function handle(effect, userId, event) {
    const user = game.users.get(userId);
    if (!enabled() || effect?.parent?.documentName !== "Actor" || !owns(effect.parent, user)) return;
    return enqueue(async () => {
      const control = controlFor(effect, event === "delete");
      if (control) await reconcileControl(control.item, control.key, control.activity);
      if (event !== "update") await trackDependent(effect, user, resolve, event === "delete");
    });
  }
  const hooks = [
    ["createActiveEffect", (effect, options, userId) => handle(effect, userId, "create")],
    ["updateActiveEffect", (effect, changes, options, userId) => handle(effect, userId, "update")],
    ["deleteActiveEffect", (effect, options, userId) => handle(effect, userId, "delete")]
  ].map(([event, callback]) => [event, Hooks.on(event, callback)]);
  const dispose = () => {
    for (const [event, id] of hooks) Hooks.off(event, id);
    installations.delete(Hooks);
  };
  installations.set(Hooks, dispose);
  if (enabled())
    enqueue(async () => {
      for (const actor of entries(game.actors)) {
        const refresh = new Map();
        for (const effect of entries(actor.effects)) {
          const control = controlFor(effect);
          if (control) refresh.set(control.item, control);
        }
        for (const item of entries(actor.items)) {
          const id = item.flags?.[MODULE_ID]?.worldCardShown?.id;
          if (!id || refresh.has(item)) continue;
          const mapping = [...controls.values()].find(
            ([spell, key]) => spell === identifier(item) && cpr(item).activityIdentifiers?.[key] === id
          );
          const activity = item.system.activities?.get(id);
          if (mapping && activity) refresh.set(item, { item, key: mapping[1], activity });
        }
        for (const { item, key, activity } of refresh.values()) await reconcileControl(item, key, activity);
      }
    });
  return dispose;
}
