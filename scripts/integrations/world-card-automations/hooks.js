import { cardActivityRole } from "./activity-role.js";
import { applyPassiveModifier, routeIncomingPassive } from "./passive-authority.js";
import { requestCardPassive } from "./selected/lib/sockets.js";

// Only functions shipped in the two explicit registries are executable.
const installed = new WeakMap();
const stages = {
  "midi-qol.preTargeting": ["preTargeting"],
  "midi-qol.postPreambleComplete": ["preambleComplete"],
  "midi-qol.preAttackRollConfig": ["preAttackRollConfig", "targetPreAttackRollConfig"],
  "midi-qol.postWaitForAttackRoll": ["postAttackRoll"],
  "midi-qol.postAttackRollComplete": ["attackRollComplete"],
  "midi-qol.preDamageRollComplete": ["damageRollComplete"],
  "midi-qol.postRollFinished": ["rollFinished", "onHit"],
  "midi-qol.preTargetDamageApplication": ["targetApplyDamage"]
};
const documentPasses = {
  effect: ["created", "deleted"],
  movement: ["moved"],
  death: ["dead"],
  combat: ["turnEnd", "everyTurn", "turnStartNear", "combatEnd"]
};
const flags = (entity) => entity?.flags?.["chris-premades"];
const values = (collection) => collection?.contents ?? Array.from(collection ?? []);

function actorEntities(actor) {
  if (!actor) return [];
  const items = values(actor.items);
  const enchantments = items.flatMap((i) =>
    values(i.effects).filter((e) => e.type === "enchantment" && e.isAppliedEnchantment)
  );
  const effects = new Set([...(actor.allApplicableEffects?.() ?? actor.appliedEffects ?? []), ...enchantments]);
  return [...items, ...Array.from(effects).filter((e) => !e.disabled && !e.isSuppressed)];
}

function getCastData(entity) {
  const data = flags(entity)?.castData ?? entity.flags?.["midi-qol"]?.castData ?? {};
  const level = entity.system?.level ?? -1;
  const save = entity.system?.activities?.getByType?.("save")?.[0];
  return {
    castLevel: data.castLevel ?? level,
    baseLevel: data.baseLevel ?? level,
    saveDC:
      data.saveDC ??
      save?.save?.dc?.value ??
      entity.actor?.system?.abilities?.[entity.abilityMod]?.dc ??
      entity.actor?.system?.attributes?.spell?.dc ??
      -1
  };
}

function collect(definitions, entities, type, scope, pass, context, eligible) {
  const grouped = new Map();
  for (const entity of entities) {
    const config = flags(entity);
    const ids = scope ? config?.macros?.[type]?.[scope] : config?.macros?.[type];
    if (!Array.isArray(ids)) continue;
    const rules =
      entity.documentName === "Item" ? entity.system?.source?.rules : entity.system?.source?.rules || config.rules;
    const book = rules === "2024" || rules === "modern" ? definitions.modern : definitions.legacy;
    if (!book) continue;
    const activity = context.activity;
    const identifier = activity && cardActivityRole(activity);
    const candidates = [];
    for (const id of new Set(ids)) {
      if (typeof id !== "string" || !Object.hasOwn(book, id)) continue;
      const rows = scope ? book[id]?.[type]?.[scope] : book[id]?.[type];
      for (const row of rows ?? []) {
        if (row.pass !== pass || typeof row.macro !== "function") continue;
        let macro = row.macro;
        if (
          scope === "actor" &&
          ((id === "wardingBondTarget" && pass === "onHit") ||
            (id === "compelledDuelCompelled" && pass === "targetApplyDamage"))
        ) {
          macro = async (args) => {
            await routeIncomingPassive(id, args, requestCardPassive);
          };
        } else if (!eligible(entity)) {
          if (
            scope !== "actor" ||
            !(
              (id === "blurEffect" && pass === "targetPreAttackRollConfig") ||
              (id === "hexbladesCurseTarget" && pass === "targetApplyDamage")
            )
          )
            continue;
          macro = async (args) => {
            await applyPassiveModifier(id, args);
          };
        }
        if (row.activities?.length && !row.activities.includes(identifier)) continue;
        if (row.distance != null && !(context.distance >= 0 && context.distance <= row.distance)) continue;
        if (row.disposition && context.token?.document && context.target?.document) {
          const same = context.token.document.disposition === context.target.document.disposition;
          if ((row.disposition === "enemy" && same) || (row.disposition === "ally" && !same)) continue;
        }
        candidates.push({ ...row, macro });
      }
    }
    if (!candidates.length) continue;
    const castData = getCastData(entity),
      name = entity.name?.slugify?.() ?? entity.name ?? entity.uuid;
    const prior = grouped.get(name);
    if (
      prior &&
      (prior.castLevel > castData.castLevel ||
        (prior.castLevel === castData.castLevel && prior.saveDC >= castData.saveDC))
    )
      continue;
    grouped.set(name, {
      ...castData,
      rows: candidates.map((row) => ({ ...row, trigger: { ...context, entity, castData, name } }))
    });
  }
  return Array.from(grouped.values()).flatMap((entry) => entry.rows);
}

async function execute(rows, args) {
  const unique = new Set();
  for (const row of rows.sort((a, b) => (a.priority ?? 50) - (b.priority ?? 50))) {
    if (row.unique && unique.has(row.unique)) continue;
    if (row.unique) unique.add(row.unique);
    if (await row.macro({ ...args, trigger: row.trigger })) return true;
    if (args.workflow?.aborted) break;
  }
}

export function registerCprCardHandlers({ Hooks, game, definitions }) {
  if (installed.has(Hooks)) return installed.get(Hooks);
  const used = new Set(),
    unsupported = [];
  const supported = new Set(
    Object.values(stages)
      .flat()
      .map((pass) => "midi." + pass)
  );
  for (const [kind, passes] of Object.entries(documentPasses))
    for (const pass of passes) supported.add(kind + "." + pass);
  for (const book of Object.values(definitions))
    for (const [id, def] of Object.entries(book)) {
      for (const [kind, data] of Object.entries(def)) {
        const rows =
          kind === "midi" ? [...(data?.item ?? []), ...(data?.actor ?? [])] : Array.isArray(data) ? data : [];
        for (const row of rows) {
          if (!row?.pass) continue;
          if (supported.has(kind + "." + row.pass)) used.add(kind + "." + row.pass);
          else unsupported.push(id + "." + kind + "." + row.pass);
        }
      }
    }
  if (unsupported.length) console.warn("Rebreya Main | Unsupported world-card passes", unsupported);
  const enabled = () => game.modules?.get("midi-qol")?.active && !game.modules?.get("chris-premades")?.active;
  // A flag on a player-editable document is not a delegation of GM privileges.
  const executorFor = (entity) => {
    const documents = new Set();
    for (let doc = entity; doc && documents.size < 8 && !documents.has(doc);) {
      documents.add(doc);
      const origin =
        doc.flags?.["rebreya-main"]?.worldCardAuthority?.source ??
        doc.flags?.["rebreya-main"]?.worldCardSource ??
        doc.origin;
      doc =
        typeof origin === "string" && /^(?:Actor|Scene|Item)\./u.test(origin)
          ? globalThis.fromUuidSync?.(origin)
          : null;
    }
    for (const doc of documents) {
      const actor =
        doc.documentName === "Actor"
          ? doc
          : (doc.actor ?? doc.parent?.actor ?? (doc.parent?.documentName === "Actor" ? doc.parent : null));
      const writer = game.users?.get?.(doc._stats?.lastModifiedBy);
      if (writer && !writer.isGM && !actor?.hasPlayerOwner) return writer.active ? writer.id : null;
      if (!actor?.hasPlayerOwner) continue;
      const owners = values(game.users)
        .filter((u) => u.active && !u.isGM && actor.testUserPermission(u, "OWNER"))
        .sort((a, b) => String(a.id).localeCompare(b.id));
      return owners.find((u) => u.character?.uuid === actor.uuid)?.id ?? owners[0]?.id ?? null;
    }
    if (entity.documentName === "ActiveEffect") {
      const knownOrigin =
        Array.from(documents).some((d) => d.documentName === "Item" || d.documentName === "Actor") ||
        (entity.parent?.documentName === "Item" && entity.parent?.actor && !entity.parent.actor.hasPlayerOwner);
      if (!knownOrigin || !game.users?.get?.(entity._stats?.lastModifiedBy)?.isGM) return null;
    }
    return game.users?.activeGM?.id;
  };
  const documentExecutor = (entity) => executorFor(entity) === game.user?.id;
  const workflowExecutor = (entity) => !game.user?.isGM || executorFor(entity) === game.users?.activeGM?.id;
  const register = (name, callback) =>
    Hooks.on(name, (...args) => {
      if (enabled()) return callback(...args);
    });
  for (const [hook, passes] of Object.entries(stages)) {
    if (!passes.some((pass) => used.has("midi." + pass))) continue;
    register(hook, async (first, damageContext) => {
      const before = passes[0] === "preTargeting",
        damage = passes[0] === "targetApplyDamage";
      const workflow = before ? null : damage ? damageContext.workflow : first;
      const activity = before ? first.activity : workflow.activity;
      const item = activity?.item ?? workflow?.item,
        actor = activity?.actor ?? workflow?.actor;
      const token = before ? (first.token ?? actor?.getActiveTokens?.()[0]) : workflow.token;
      const args = before ? { ...first, token, actor } : { workflow, ditem: damageContext?.ditem };
      for (const pass of passes) {
        if (!used.has("midi." + pass)) continue;
        let rows;
        if (pass === "targetApplyDamage" || pass === "targetPreAttackRollConfig" || pass === "onHit") {
          const targets = damage ? [first] : pass === "onHit" ? workflow.hitTargets : workflow.targets;
          rows = values(targets).flatMap((target) =>
            collect(
              definitions,
              actorEntities(target.actor),
              "midi",
              "actor",
              pass,
              { token: target },
              workflowExecutor
            )
          );
        } else {
          rows = collect(
            definitions,
            item ? [item] : [],
            "midi",
            "item",
            pass,
            { activity, token },
            workflowExecutor
          ).concat(collect(definitions, actorEntities(actor), "midi", "actor", pass, { token }, workflowExecutor));
        }
        const stop = await execute(rows, args);
        if (before && stop) return false;
        if (workflow?.aborted) break;
      }
    });
  }

  const runDocuments = (kind, pass, entities, context, args = {}) =>
    execute(collect(definitions, entities, kind, null, pass, context, documentExecutor), args);
  for (const [pass, name] of [
    ["created", "createActiveEffect"],
    ["deleted", "deleteActiveEffect"]
  ]) {
    if (!used.has("effect." + pass) && !(pass === "created" && used.has("death.dead"))) continue;
    register(name, async (effect, options) => {
      const parent = effect.parent;
      const actor = parent?.documentName === "Actor" ? parent : effect.type === "enchantment" ? parent?.actor : null;
      if (!actor) return;
      const token = actor.getActiveTokens?.()[0];
      await runDocuments("effect", pass, [effect], { token, target: effect, options });
      if (pass === "created" && effect.statuses?.has("dead"))
        await runDocuments("death", "dead", actorEntities(actor), { token, actor });
    });
  }
  if (used.has("movement.moved"))
    register("moveToken", async (doc, movement, options = {}) => {
      if (
        !doc.actor ||
        !doc.object ||
        doc.parent?.id !== globalThis.canvas?.scene?.id ||
        movement.pending?.waypoints?.length ||
        options["chris-premades"]?.movement?.ignore
      )
        return;
      const action = movement.passed?.waypoints?.at(-1)?.action;
      const opts = {
        ...options,
        "chris-premades": {
          ...options["chris-premades"],
          movement: {
            ...options["chris-premades"]?.movement,
            teleport: globalThis.CONFIG?.Token?.movement?.actions?.[action]?.teleport
          }
        }
      };
      await doc.object.movementAnimationPromise;
      await runDocuments("movement", "moved", actorEntities(doc.actor), { token: doc.object }, { options: opts });
    });

  const combatToken = (combat, id) => combat.combatants?.get(id)?.token;
  const onToken = (pass, doc, extra) =>
    doc && runDocuments("combat", pass, actorEntities(doc.actor), { token: doc.object, ...extra });
  if (["turnEnd", "everyTurn", "turnStartNear"].some((pass) => used.has("combat." + pass)))
    register("updateCombat", async (combat, changes) => {
      if (!combat.started || !combat.isActive || !("turn" in changes || "round" in changes)) return;
      const cur = combat.current,
        prev = combat.previous;
      if (!cur || !prev || cur.round < prev.round || (cur.round === prev.round && cur.turn <= prev.turn)) return;
      const current = combatToken(combat, cur.combatantId),
        previous = combatToken(combat, prev.combatantId);
      const details = {
        currentRound: cur.round,
        previousRound: prev.round,
        currentTurn: cur.turn,
        previousTurn: prev.turn
      };
      if (used.has("combat.turnEnd")) await onToken("turnEnd", previous, details);
      if (used.has("combat.everyTurn"))
        for (const c of values(combat.combatants)) await onToken("everyTurn", c.token, details);
      if (!current?.object || !used.has("combat.turnStartNear")) return;
      for (const doc of values(current.parent?.tokens)) {
        if (!doc.object || doc === current) continue;
        const distance = globalThis.MidiQOL?.computeDistance?.(current.object, doc.object, {
          wallsBlock: true,
          includeCover: false
        });
        if (Number.isFinite(distance) && distance >= 0)
          await onToken("turnStartNear", doc, { target: current.object, distance, ...details });
      }
    });
  if (used.has("combat.combatEnd"))
    register("deleteCombat", async (combat) => {
      for (const c of values(combat.combatants)) await onToken("combatEnd", c.token, {});
    });
  installed.set(Hooks, unsupported);
  return unsupported;
}
