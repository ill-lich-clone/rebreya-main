import { MODULE_ID } from "../constants.js";
import { aggregateKey, keyedMutationScheduling } from "../application/socket-command-scheduling.js?v=1.5.3";
import { isActiveGmClient } from "../infrastructure/foundry/active-gm.js";
import { getItemUpgradeCategory, getItemUpgradeHostState } from "../data/item-upgrade-service.js?v=1.6.9";
import { isItemEquipped } from "../integrations/held-items.js?v=1.5.29";
import { flushCardDamage } from "../integrations/midi-usage-card.js?v=1.5.61";

const COMMAND = "item-upgrade.spiked-trim";
const PRODUCT_ID = "шипастая-отделка-доспеха";
const NORMALIZED_ID = "shipastaya-otdelka-dospekha";
const RECEIPTS = "spikedTrimReceipts";
const CHAT_UUID = /^ChatMessage\.[A-Za-z0-9_-]{1,64}$/u;
const TOKEN_UUID = /^Scene\.[A-Za-z0-9_-]{1,64}\.Token\.[A-Za-z0-9_-]{1,64}$/u;

const flag = (document, key) => document?.getFlag?.(MODULE_ID, key) ?? document?.flags?.[MODULE_ID]?.[key];
const values = items => items?.values?.() ?? items?.contents ?? [];
const tokenUuid = token => token?.document?.uuid ?? token?.uuid;
const isMelee = (activity, mode) => activity?.type === "attack" && mode !== "ranged" && !String(mode ?? "").startsWith("thrown")
  && (activity.attack?.type?.value ? activity.attack.type.value === "melee" : ["mwak", "msak"].includes(activity.actionType));
const receiptKey = ({ cardUuid, targetUuid }) => `${cardUuid}:${targetUuid}`;
const receipts = actor => {
  const stored = flag(actor, RECEIPTS);
  return Array.isArray(stored) ? stored : [];
};

function isEquippedHost(host) {
  return flag(host, "itemUpgrades")?.installed?.length && isItemEquipped(host)
    && getItemUpgradeCategory(host) === "outerwear" && Number(host.system?.quantity ?? 1) === 1;
}

function hasTrimLink(host, trim, link, { installed, capacity }) {
  if (![PRODUCT_ID, NORMALIZED_ID].includes(flag(trim, "gearId"))) return false;
  const reverse = flag(trim, "installedUpgrade");
  return trim.system?.container === host.id && trim.system.quantity === 1 && reverse?.hostItemId === host.id
    && reverse.slotIndex === link.slotIndex && link.slotIndex <= capacity
    && installed.filter(other => other.slotIndex === link.slotIndex).length === 1;
}

function* equippedTrims(actor) {
  for (const host of values(actor?.items)) {
    if (!isEquippedHost(host)) continue;
    const state = getItemUpgradeHostState(host);
    for (const link of state.installed) {
      const trim = actor.items.get(link.itemId);
      if (hasTrimLink(host, trim, link, state)) yield { host, trim };
    }
  }
}

function attackTargets(card) {
  const hitRows = card.system?.midi?.sections?.hits?.data?.hits;
  if (card.type === "usage" && Array.isArray(hitRows) && hitRows.length) return hitRows.map(row => row.uuid);
  return Array.from(card.system?.targets ?? [], row => row.token);
}

export class SpikedTrimService {
  #damageReceipts = new WeakMap();

  constructor(moduleApi, {
    game = () => globalThis.game,
    resolveToken = uuid => globalThis.fromUuidSync?.(uuid),
    isAuthority = () => isActiveGmClient(game())
  } = {}) {
    Object.assign(this, { moduleApi, game, resolveToken, isAuthority });
  }

  #card(uuid) {
    return CHAT_UUID.test(uuid) ? this.game()?.messages?.get?.(uuid.slice("ChatMessage.".length)) : null;
  }

  #attack(payload, sender) {
    const card = this.#card(payload.cardUuid);
    const author = card?.author;
    if (card?.uuid !== payload.cardUuid || !["usage", "attack"].includes(card.type) || !author?.id
      || !sender?.id || (sender.id !== author.id && !sender.isGM)) return null;
    const attacker = card.getAssociatedActor?.();
    if (!attacker || (!author.isGM && !attacker.testUserPermission?.(author, "OWNER"))) return null;
    const activity = card.getAssociatedActivity?.();
    const roll = card.type === "usage" ? card.rolls?.find(candidate => candidate.options?.["midi-qol"]?.rollType === "attack") : card.rolls?.[0];
    if (activity?.actor?.uuid !== attacker.uuid || !Number.isFinite(roll?.total)
      || !isMelee(activity, roll.options?.attackMode ?? card.system?.mode)
      || !attackTargets(card).includes(payload.targetUuid)) return null;
    if (card.speaker?.scene && !payload.targetUuid.startsWith(`Scene.${card.speaker.scene}.Token.`)) return null;
    const defender = this.resolveToken(payload.targetUuid)?.actor;
    return defender && defender.uuid !== attacker.uuid ? { attacker, defender } : null;
  }

  authorize(payload, { sender } = {}) {
    return Boolean(this.#attack(payload, sender));
  }

  async execute(payload, { sender, assertActiveGm }) {
    const attack = this.#attack(payload, sender);
    if (!attack) return { applied: false };
    const { attacker, defender } = attack;
    const key = receiptKey(payload);
    if (receipts(attacker).includes(key)) return { applied: false };
    for (const { host, trim } of equippedTrims(defender)) {
      const projection = await this.moduleApi.itemUpgradeService.getUpgradeProjection(trim);
      if (projection.sourceId !== PRODUCT_ID || projection.legacyOverride || projection.availability.decision !== "event-implemented") continue;
      if (defender.items.get(host.id) !== host || defender.items.get(trim.id) !== trim || !isEquippedHost(host)) continue;
      const state = getItemUpgradeHostState(host);
      const link = state.installed.find(entry => entry.itemId === trim.id);
      if (!link || !hasTrimLink(host, trim, link, state)) continue;
      assertActiveGm();
      const options = {};
      this.#damageReceipts.set(options, { attacker, key });
      await attacker.applyDamage([{ value: 2, type: "piercing", properties: new Set() }], options);
      return { applied: receipts(attacker).includes(key) };
    }
    return { applied: false };
  }

  captureDamageReceipt(actor, updates, options) {
    const receipt = this.#damageReceipts.get(options);
    if (!receipt || receipt.attacker !== actor) return;
    updates[`flags.${MODULE_ID}.${RECEIPTS}`] = [...receipts(actor), receipt.key].slice(-128);
  }

  #request(cardUuid, targetUuid) {
    const payload = { cardUuid, targetUuid };
    return this.moduleApi.privilegedMutationGateway.mutate(COMMAND, payload, { operationId: receiptKey(payload) });
  }

  async onMidiRollComplete(workflow) {
    if (workflow?.aborted || !workflow?.attackRoll || !isMelee(workflow.activity, workflow.attackRoll.options?.attackMode)
      || !CHAT_UUID.test(workflow.itemCardUuid)) return;
    const card = workflow.chatCard ?? this.#card(workflow.itemCardUuid);
    const user = this.game()?.user;
    if (!card || !user?.id || (!user.isGM && card.author?.id !== user.id)) return;
    const targets = new Set();
    for (const target of workflow.targets ?? []) {
      const uuid = tokenUuid(target), defender = target?.actor ?? target?.document?.actor;
      if (!TOKEN_UUID.test(uuid) || defender?.uuid === workflow.activity.actor?.uuid) continue;
      if ((user.isGM || defender?.testUserPermission?.(user, "OBSERVER")) && equippedTrims(defender).next().done) continue;
      targets.add(uuid);
    }
    if (!targets.size) return;
    if (typeof workflow.performThrottledUpdate === "function") await flushCardDamage(workflow, card);
    await Promise.all([...targets].map(uuid => this.#request(card.uuid, uuid)));
  }

  async onNativeAttackCard(card) {
    if (card?.type !== "attack" || !this.isAuthority() || this.game()?.modules?.get?.("midi-qol")?.active
      || !isMelee(card.getAssociatedActivity?.(), card.rolls?.[0]?.options?.attackMode ?? card.system?.mode)) return;
    for (const uuid of new Set(attackTargets(card))) {
      if (TOKEN_UUID.test(uuid) && !equippedTrims(this.resolveToken(uuid)?.actor).next().done) await this.#request(card.uuid, uuid);
    }
  }

  registerCommand(gateway) {
    gateway.registerCommand(COMMAND, {
      validate: p => Boolean(p && Object.keys(p).length === 2 && typeof p.cardUuid === "string"
        && typeof p.targetUuid === "string" && CHAT_UUID.test(p.cardUuid) && TOKEN_UUID.test(p.targetUuid)),
      authorize: (payload, context) => this.authorize(payload, context),
      scheduling: keyedMutationScheduling(payload => [
        aggregateKey("actor", this.#card(payload.cardUuid)?.getAssociatedActor?.()?.uuid ?? payload.cardUuid)
      ]),
      execute: (payload, context) => this.execute(payload, context)
    });
  }
}

export function registerSpikedTrimHooks(hooks, service) {
  const report = error => console.error(`${MODULE_ID} | Spiked trim retaliation failed.`, error);
  hooks.on("midi-qol.RollComplete", workflow => service.onMidiRollComplete(workflow).catch(report));
  hooks.on("createChatMessage", card => service.onNativeAttackCard(card).catch(report));
  hooks.on("dnd5e.preApplyDamage", (actor, _amount, updates, options) => service.captureDamageReceipt(actor, updates, options));
}
