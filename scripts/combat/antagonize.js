import { MODULE_ID } from "../constants.js";
import { aggregateKey, keyedMutationScheduling } from "../application/socket-command-scheduling.js?v=1.5.3";
import { escapeFoundryHtml } from "../shared/foundry-values.js";

const COMMAND = "spell.antagonize";
const values = (collection) => Array.from(collection?.values?.() ?? collection ?? []);
const tokenUuid = (token) => token?.document?.uuid;
const validId = (value) => typeof value === "string" && /^[a-zA-Z0-9]{1,64}$/.test(value);

function choices(caster, failed, user = game.user) {
  const midi = globalThis.MidiQOL;
  if (!caster || !failed || !canvas.scene || failed.document?.parent?.id !== canvas.scene.id) {
    throw new Error("Для разрешения Враждебности откройте сцену заклинания.");
  }
  if (midi.hasUsedReaction(failed.actor)) return [];
  const options = [];
  for (const weapon of values(failed.actor.items)) {
    if (weapon.type !== "weapon" || !weapon.system.equipped) continue;
    for (const activity of values(weapon.system.activities)) {
      if (activity.type !== "attack" || activity.attack?.type?.value !== "melee") continue;
      const reach = Number(activity.range?.reach ?? weapon.system.range?.reach) || 5;
      for (const victim of canvas.tokens.placeables) {
        if (
          victim === failed ||
          !victim.actor ||
          (victim.document.hidden && !user.isGM) ||
          (!victim.visible && !game.user.isGM) ||
          !midi.canSee(caster, victim)
        )
          continue;
        const distance = midi.getDistance(failed, victim, { wallsBlock: true, includeCover: false });
        if (!Number.isFinite(distance) || distance < 0 || distance > reach) continue;
        options.push({
          key: [weapon.id, activity.id, victim.id].join("."),
          activity,
          victim,
          label: `${weapon.name} — ${activity.name || weapon.name} → ${victim.name}`
        });
      }
    }
  }
  return options;
}

async function choose(options) {
  if (options.length < 2) return options[0]?.key ?? "";
  return foundry.applications.api.DialogV2.prompt({
    window: { title: "Враждебность" },
    rejectClose: false,
    content: `<label>Атака и цель <select name="attack">${options
      .map(({ key, label }) => `<option value="${key}">${escapeFoundryHtml(label)}</option>`)
      .join("")}</select></label>`,
    ok: { label: "Атаковать", callback: (_event, button) => button.form.elements.attack.value }
  });
}

export const antagonize = {
  name: "Antagonize",
  midi: {
    item: [
      {
        pass: "rollFinished",
        priority: 50,
        async macro({ workflow }) {
          for (const failed of values(workflow.failedSaves)) {
            if (!failed.actor || MidiQOL.checkIncapacitated(failed.actor)) continue;
            const choice = await choose(choices(workflow.token, failed));
            if (choice == null) {
              globalThis.ui?.notifications?.info(
                "Выбор отменён. Вторичный эффект Враждебности нужно разрешить вручную."
              );
              continue;
            }
            const result = await game.rebreyaMain.privilegedMutationGateway.mutate(
              COMMAND,
              {
                cardUuid: workflow.itemCardUuid,
                failedUuid: tokenUuid(failed),
                choice
              },
              { operationId: `antagonize:${workflow.itemCardUuid}:${failed.id}` }
            );
            if (result?.status === "uncertain")
              globalThis.ui?.notifications?.warn("Враждебность: проверьте последний бросок и расход реакции в чате.");
          }
        }
      }
    ]
  }
};

function recordedUse(payload, sender) {
  const card = game.messages.get(payload.cardUuid.slice("ChatMessage.".length));
  if (card?.uuid !== payload.cardUuid || (!sender?.isGM && card.author?.id !== sender?.id)) return null;
  if (!Number.isFinite(card.timestamp) || Date.now() - card.timestamp > 5 * 60_000) return null;
  const workflow = MidiQOL.Workflow.getWorkflow(card.uuid);
  const item = card.getAssociatedItem?.() ?? workflow?.item;
  if (
    item?.type !== "spell" ||
    item.flags?.["chris-premades"]?.info?.identifier !== "antagonize" ||
    (!sender?.isGM && !item.actor?.testUserPermission(sender, "OWNER"))
  )
    return null;
  const savedFailures = card.getFlag("midi-qol", "failedSaveUuids") ?? [];
  const failed =
    values(workflow?.failedSaves).find((target) => tokenUuid(target) === payload.failedUuid) ??
    (savedFailures.includes(payload.failedUuid) &&
      canvas.tokens.placeables.find((token) => tokenUuid(token) === payload.failedUuid));
  const caster = workflow?.token ?? (card.speaker?.scene === canvas.scene?.id && canvas.tokens.get(card.speaker.token));
  if (!failed?.actor || !caster || MidiQOL.checkIncapacitated(failed.actor)) return null;
  return { card, item, caster, failed };
}

export function registerAntagonizeCommand(gateway) {
  gateway.registerCommand(COMMAND, {
    validate: (p) =>
      Boolean(
        p &&
        Object.keys(p).length === 3 &&
        /^ChatMessage\.[a-zA-Z0-9]{1,64}$/.test(p.cardUuid) &&
        /^Scene\.[a-zA-Z0-9]{1,64}\.Token\.[a-zA-Z0-9]{1,64}$/.test(p.failedUuid) &&
        typeof p.choice === "string" &&
        (p.choice === "" || (p.choice.split(".").length === 3 && p.choice.split(".").every(validId)))
      ),
    authorize: (p, { sender }) => Boolean(recordedUse(p, sender)),
    scheduling: keyedMutationScheduling((p) => [aggregateKey("antagonize", p.failedUuid)]),
    async execute(p, { sender, assertActiveGm }) {
      const use = recordedUse(p, sender);
      if (!use) throw new Error("Враждебность: результат спасброска не подтверждён.");
      const { card, item, caster, failed } = use;
      const receipt = `antagonize.${failed.id}`;
      const previous = card.getFlag(MODULE_ID, receipt);
      if (previous) return { applied: false, status: previous === "done" ? "done" : "uncertain" };
      const options = choices(caster, failed, sender);
      const attack = options.find((option) => option.key === p.choice);
      if (options.length && !attack) throw new Error("Враждебность: выбранная атака недоступна.");
      assertActiveGm();
      await card.setFlag(MODULE_ID, receipt, "started");
      assertActiveGm();
      if (attack) {
        const reactionCount = () => Number(failed.actor.flags?.["midi-qol"]?.actions?.reactionsUsed ?? 0);
        const before = reactionCount();
        const result = await MidiQOL.completeActivityUse(
          attack.activity,
          {
            midiOptions: { targetUuids: [tokenUuid(attack.victim)], ignoreUserTargets: true }
          },
          { configure: false },
          {}
        );
        if (!result || result.aborted) {
          return { applied: false, status: "uncertain" };
        }
        assertActiveGm();
        if (reactionCount() === before && !MidiQOL.hasUsedReaction(failed.actor))
          await MidiQOL.setReactionUsed(failed.actor);
      } else {
        const key = "flags.midi-qol.disadvantage.attack.all";
        await failed.actor.createEmbeddedDocuments("ActiveEffect", [
          {
            name: item.name,
            img: item.img,
            origin: item.uuid,
            ...(game.release.generation >= 14
              ? {
                  duration: { value: 12, units: "seconds" },
                  system: { changes: [{ key, type: "custom", value: 1, priority: 20 }] }
                }
              : { duration: { seconds: 12 }, changes: [{ key, mode: 0, value: "1", priority: 20 }] }),
            flags: { dae: { specialDuration: ["turnStartSource", "1Attack"] } }
          }
        ]);
      }
      await card.setFlag(MODULE_ID, receipt, "done");
      return { applied: true };
    }
  });
}
