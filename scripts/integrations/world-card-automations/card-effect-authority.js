// Receiver-owned effects. The socket request contains identifiers, never ActiveEffect data.
const owners = {
  bless: "bless",
  faerieFire: "faerieFire",
  boomingBlade: "boomingBlade",
  chillTouchChilled: "chillTouch",
  compelledDuelTarget: "compelledDuel",
  hexed: "hex",
  rayOfEnfeeblementEnfeebled: "rayOfEnfeeblement",
  rimesBindingIceFrozen: "rimesBindingIce",
  holdPersonInvalidTarget: "holdPerson",
  heatMetalHeld: "heatMetal",
  wardingBondTarget: "wardingBond",
  branded: "brandingSmite",
  hexbladesCurseTarget: "hexbladesCurse",
  curseCritical: "hexbladesCurse",
  spiritShroudHit: "spiritShroud",
  spiritShroudSlow: "spiritShroud",
  grappled: "grapple"
};
const pending = new WeakMap();
const perCast = new Set([
  "bless",
  "faerieFire",
  "rayOfEnfeeblementEnfeebled",
  "wardingBondTarget",
  "compelledDuelTarget",
  "grappled",
  "hexed",
  "hexbladesCurseTarget"
]);
export const cardId = (doc) => doc?.flags?.["chris-premades"]?.info?.identifier;
export function onlyKeys(data, keys) {
  return (
    data && Object.getPrototypeOf(data) === Object.prototype && Object.keys(data).every((key) => keys.includes(key))
  );
}
const worldUuid = (value) =>
  typeof value === "string" && value.length <= 400 && /^(?:Actor|Scene)\.[\w-]+(?:\.[\w-]+)*$/u.test(value);
export async function resolveCard(uuid, resolve) {
  const seen = new Set();
  while (worldUuid(uuid) && !seen.has(uuid) && seen.size < 6) {
    seen.add(uuid);
    const doc = await resolve(uuid);
    if (doc?.documentName === "Item") return doc;
    if (doc?.documentName === "ActiveEffect" && doc.parent?.documentName === "Item") return doc.parent;
    if (doc?.documentName !== "ActiveEffect") return null;
    uuid = doc.origin;
  }
  return null;
}
const change = (key, type, value, priority = 20) => ({ key, type, value: String(value), priority });
function bounded(number, max) {
  return Number.isFinite(number) && number >= 0 && number <= max;
}
function recipeData(recipe, item, target, parent, sourceToken) {
  const actor = item.actor,
    cpr = { info: { identifier: recipe } },
    dae = {},
    changes = [];
  const effect = {
    name: item.name,
    img: item.img,
    origin: item.uuid,
    flags: { "chris-premades": cpr, dae },
    system: { changes }
  };
  const duration = globalThis.DAE?.convertDuration?.(item.system?.duration);
  if (duration) effect.duration = duration;
  const linked = parent?.flags?.["chris-premades"];
  switch (recipe) {
    case "bless": {
      // Rebuild the mechanical fields. World templates may also contain macro.tokenMagic or editable scripts.
      const template = Array.from(item.system.activities ?? [])
        .flatMap((a) => Array.from(a.effects ?? []))
        .find((e) => e.effect)?.effect;
      const expected = new Set([
        "system.bonuses.abilities.save",
        ...["mwak", "rwak", "msak", "rsak"].map((t) => "system.bonuses." + t + ".attack")
      ]);
      for (const field of template?.system?.changes ?? template?.changes ?? []) {
        if (
          expected.has(field.key) &&
          /^\+?[1-9]d[1-9]\d?$/u.test(String(field.value)) &&
          (field.type === "add" || field.mode === 2)
        ) {
          changes.push(change(field.key, "add", field.value));
          expected.delete(field.key);
        }
      }
      if (expected.size) throw Error("Мастер должен сверить изменения Bless на карточке заклинания.");
      break;
    }
    case "faerieFire":
      changes.push(
        change("flags.midi-qol.grants.advantage.attack.all", "custom", 1),
        change("system.traits.ci.value", "add", "invisible"),
        change("ATL.light.dim", "upgrade", 10)
      );
      cpr.faerieFire = { playAnimation: item.flags?.["chris-premades"]?.config?.playAnimation !== false };
      cpr.macros = { effect: ["faerieFireOutlined"] };
      break;
    case "chillTouchChilled": {
      const undead = String(globalThis.MidiQOL?.typeOrRace?.(target) ?? "").toLowerCase() === "undead";
      changes.push(change("system.traits.di.value", "add", "healing"));
      dae.showIcon = true;
      dae.specialDuration = [undead ? "turnEndSource" : "turnStartSource"];
      if (undead) cpr.macros = { midi: { actor: [recipe] }, combat: [recipe] };
      delete effect.duration;
      break;
    }
    case "boomingBlade":
      effect.duration = { seconds: 12 };
      dae.specialDuration = ["turnStartSource"];
      cpr.macros = { movement: ["boomingBladeMoved"] };
      cpr.boomingBlade = { damageType: item.flags?.["chris-premades"]?.config?.damageType ?? "thunder" };
      break;
    case "rimesBindingIceFrozen":
      changes.push(change("system.attributes.movement.all", "custom", "*0"));
      cpr.macros = { effect: [recipe] };
      break;
    case "rayOfEnfeeblementEnfeebled": {
      const dc =
        item.system?.activities?.getByType?.("save")?.[0]?.save?.dc?.value ?? actor.system?.attributes?.spell?.dc;
      if (!bounded(dc, 100)) throw Error("Мастер должен сверить Сл спасброска луча.");
      changes.push(
        change(
          "flags.midi-qol.OverTime",
          "custom",
          "label=Ray of Enfeeblement,turn=end,saveDC=" + dc + ",saveAbility=con,savingThrow=true,saveMagic=true"
        )
      );
      cpr.interdependent = true;
      cpr.macros = { midi: { actor: [recipe] } };
      break;
    }
    case "hexed": {
      if (cardId(parent) !== "hex" || !["str", "dex", "con", "int", "wis", "cha"].includes(linked?.hex?.ability))
        throw Error("Нет исходного эффекта Hex с выбранной характеристикой.");
      changes.push(change("flags.midi-qol.disadvantage.check." + linked.hex.ability, "custom", true));
      const seconds = parent.duration?.remaining ?? parent.duration?.seconds;
      if (!bounded(seconds, 86400)) throw Error("Мастер должен сверить оставшуюся длительность Hex.");
      effect.duration = { seconds };
      break;
    }
    case "compelledDuelTarget":
      if (cardId(parent) !== "compelledDuelSource" || sourceToken?.actor?.uuid !== actor.uuid)
        throw Error("Нет подтверждённого источника дуэли.");
      cpr.rules = "modern";
      cpr.compelledDuel = { sourceUuid: sourceToken.uuid };
      cpr.macros = {
        midi: { actor: ["compelledDuelCompelled"] },
        combat: ["compelledDuelCompelled"],
        movement: ["compelledDuelCompelled"]
      };
      break;
    case "grappled": {
      if (
        cardId(parent) !== "grappling" ||
        sourceToken?.actor?.uuid !== actor.uuid ||
        sourceToken.parent?.tokens?.get(linked.grapple?.tokenId)?.actor?.uuid !== target.uuid ||
        target.system?.traits?.ci?.value?.has("grappled")
      )
        throw Error("Токены, иммунитет или исходный эффект захвата изменились.");
      effect.name = "Захвачен: " + sourceToken.name;
      effect.origin = actor.uuid;
      effect.statuses = ["grappled"];
      delete effect.duration;
      dae.showIcon = true;
      cpr.grapple = { tokenId: sourceToken.id };
      cpr.conditions = ["grappled"];
      cpr.macros = { death: ["grapple"] };
      changes.push(change("flags.Rideable.RegisteredActorEffectsFlag.grapple", "add", effect.name));
      break;
    }
    case "wardingBondTarget":
      if (
        cardId(parent) !== "wardingBondSource" ||
        sourceToken?.actor?.uuid !== actor.uuid ||
        !bounded(linked?.wardingBond?.maxDistance, 1000)
      )
        throw Error("Нет подтверждённого источника оберега.");
      cpr.wardingBond = { bondUuid: sourceToken.uuid, maxDistance: linked.wardingBond.maxDistance };
      cpr.macros = { movement: [recipe], midi: { actor: [recipe] } };
      cpr.interdependent = true;
      changes.push(
        change("system.traits.dr.all", "custom", 1),
        change("system.attributes.ac.bonus", "add", "+1"),
        change("system.bonuses.abilities.save", "add", "+1")
      );
      break;
    case "holdPersonInvalidTarget":
      if (globalThis.MidiQOL?.typeOrRace?.(target) === "humanoid") throw Error("Цель является гуманоидом.");
      effect.duration = { turns: 1 };
      dae.specialDuration = ["isSave"];
      changes.push(change("flags.midi-qol.min.ability.save.all", "override", 99, 120));
      break;
    case "heatMetalHeld":
      effect.duration = { seconds: 12 };
      dae.specialDuration = ["turnStartSource"];
      changes.push(
        change("flags.midi-qol.disadvantage.attack.all", "custom", 1),
        change("flags.midi-qol.disadvantage.ability.all", "custom", 1)
      );
      break;
    case "branded":
      changes.push(change("ATL.light.dim", "upgrade", 5), change("system.traits.ci.value", "add", "invisible"));
      break;
    case "hexbladesCurseTarget":
      dae.specialDuration = ["zeroHP"];
      cpr.macros = { effect: [recipe], midi: { actor: [recipe] } };
      break;
    case "curseCritical":
      delete effect.duration;
      dae.specialDuration = ["isAttacked"];
      changes.push(change("flags.midi-qol.grants.criticalThreshold", "override", 19));
      break;
    case "spiritShroudHit":
      effect.duration = { rounds: 1 };
      dae.specialDuration = ["turnStartSource", "combatEnd"];
      changes.push(change("system.traits.di.value", "add", "healing", 120));
      break;
    case "spiritShroudSlow":
      effect.duration = { rounds: 1 };
      dae.specialDuration = ["turnStartSource", "combatEnd"];
      changes.push(change("system.attributes.movement.all", "custom", -10));
      break;
  }
  return effect;
}

export async function applyCardEffect(payload, { sender, resolve, confirm }) {
  if (
    !onlyKeys(payload, ["source", "target", "recipe", "parent", "sourceToken", "concentration", "requestId"]) ||
    !Object.hasOwn(owners, payload.recipe) ||
    !/^[a-zA-Z0-9_-]{8,90}$/u.test(payload.requestId ?? "")
  )
    throw Error("Неизвестное действие эффекта.");
  if (
    !worldUuid(payload.source) ||
    !worldUuid(payload.target) ||
    (payload.parent != null && !worldUuid(payload.parent)) ||
    (payload.sourceToken != null && !worldUuid(payload.sourceToken)) ||
    (payload.concentration != null && typeof payload.concentration !== "boolean")
  )
    throw Error("Некорректные ссылки карточки.");
  const { source, target: targetId, recipe } = payload;
  const [item, target, parent, sourceToken] = await Promise.all([
    resolveCard(source, resolve),
    resolve(targetId),
    payload.parent ? resolve(payload.parent) : null,
    payload.sourceToken ? resolve(payload.sourceToken) : null
  ]);
  if (
    !item?.actor?.testUserPermission(sender, "OWNER") ||
    cardId(item) !== owners[recipe] ||
    target?.documentName !== "Actor"
  )
    throw Error("Источник или цель эффекта не подтверждены.");
  if (
    parent &&
    (parent.documentName !== "ActiveEffect" ||
      parent.parent?.uuid !== item.actor.uuid ||
      (!(recipe === "grappled" && parent.origin === item.actor.uuid) &&
        (await resolveCard(parent.origin, resolve))?.uuid !== item.uuid))
  )
    throw Error("Чужой родительский эффект.");
  if (payload.parent && !parent) throw Error("Связанный эффект уже завершён.");
  const effect = recipeData(recipe, item, target, parent, sourceToken);
  const concentration =
    payload.concentration === true ? globalThis.MidiQOL?.getConcentrationEffect?.(item.actor, item) : null;
  const link = parent ?? concentration;
  const operation = JSON.stringify([
    sender.id,
    item.uuid,
    recipe,
    perCast.has(recipe) && link ? link.uuid : payload.requestId
  ]);
  effect.flags["rebreya-main"] = { worldCardAuthority: { source: item.uuid, recipe, operation } };
  if (link) {
    effect.flags.dnd5e = { dependentOn: link.uuid };
    effect.flags["chris-premades"][parent ? "parentEntityUuid" : "concentrationEffectUuid"] = link.uuid;
    if (concentration) effect.origin = concentration.uuid;
  }
  const existing = () =>
    Array.from(target.effects ?? []).find(
      (e) => e.flags?.["rebreya-main"]?.worldCardAuthority?.operation === operation
    );
  const current = existing();
  if (current) return current.uuid;
  let active = pending.get(target);
  if (!active) {
    active = new Map();
    pending.set(target, active);
  }
  if (active.has(operation)) return active.get(operation);
  const create = async () => {
    const description = [
      item.actor.name,
      item.name,
      target.name,
      recipe,
      ...effect.system.changes.map((c) => c.key + " " + c.value)
    ].join(" · ");
    if (!(await confirm(sender, "Наложить эффект", description))) throw Error("Владелец отклонил наложение эффекта.");
    if (!item.actor.testUserPermission(sender, "OWNER") || (link && !(await resolve(link.uuid))))
      throw Error("Источник эффекта изменился.");
    const already = existing();
    if (already) return already.uuid;
    const [created] = await target.createEmbeddedDocuments("ActiveEffect", [effect]);
    return created.uuid;
  };
  active.set(operation, create());
  try {
    return await active.get(operation);
  } finally {
    active.delete(operation);
  }
}
