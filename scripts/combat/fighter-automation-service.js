import { MODULE_ID } from "../constants.js";

const EFFECT_MODE_OVERRIDE = 5;
const LAST_ATTACK_MAX_AGE_MS = 120000;
const BLOODIED_STATUS_IDS = new Set(["bloodied", "rebreya-bloodied"]);

function cleanText(value, fallback = "") {
  const text = String(value ?? "").trim();
  return text || String(fallback ?? "").trim();
}

function normalizeText(value) {
  return cleanText(value)
    .toLowerCase()
    .replace(/\u0451/gu, "\u0435")
    .replace(/['"\u2019\u2018\u02BC\u02B9\u2032\u201C\u201D\u00AB\u00BB]/gu, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
}

function toNumber(value, fallback = 0) {
  const numericValue = Number(value ?? fallback);
  return Number.isFinite(numericValue) ? numericValue : fallback;
}

function clampInteger(value, min, max) {
  const numeric = Math.floor(toNumber(value, min));
  return Math.max(min, Math.min(max, numeric));
}

function getProperty(source, path, fallback = undefined) {
  const value = foundry.utils.getProperty(source, path);
  return value === undefined ? fallback : value;
}

function readDocumentFlag(document, key) {
  if (typeof document?.getFlag === "function") {
    return document.getFlag(MODULE_ID, key);
  }

  return getProperty(document, `flags.${MODULE_ID}.${key}`, undefined);
}

function collectionValues(collection) {
  if (!collection) {
    return [];
  }

  if (Array.isArray(collection)) {
    return collection;
  }

  if (Array.isArray(collection.contents)) {
    return collection.contents;
  }

  if (typeof collection.values === "function") {
    return Array.from(collection.values());
  }

  return [];
}

function resolveActorFromTarget(target) {
  return target?.actor
    ?? target?.document?.actor
    ?? target?.object?.actor
    ?? target?.token?.actor
    ?? null;
}

function targetActorsFromWorkflow(workflow) {
  return collectionValues(workflow?.hitTargets ?? workflow?.targets)
    .map(resolveActorFromTarget)
    .filter((actor) => actor instanceof Actor);
}

function defaultDamageTypeFromWorkflow(workflow) {
  const detail = Array.isArray(workflow?.damageDetail) ? workflow.damageDetail : [];
  const detailedType = detail.map((row) => cleanText(row?.type)).find(Boolean);
  if (detailedType) {
    return detailedType;
  }

  const itemType = cleanText(workflow?.item?.system?.damage?.base?.types?.[0]);
  if (itemType) {
    return itemType;
  }

  return cleanText(workflow?.defaultDamageType);
}

function speakerForActor(actor) {
  return ChatMessage.getSpeaker({ actor });
}

function escapeHtml(value) {
  return foundry.utils.escapeHTML(cleanText(value));
}

function itemFeatureId(item) {
  return cleanText(readDocumentFlag(item, "featureId"));
}

function featureIdMatches(item, rawId) {
  const featureId = itemFeatureId(item);
  return featureId === rawId || featureId.endsWith(`::class::${rawId}`);
}

function effectStatuses(effect) {
  const statuses = effect?.statuses;
  if (statuses instanceof Set) {
    return Array.from(statuses).map((entry) => cleanText(entry)).filter(Boolean);
  }

  if (Array.isArray(statuses)) {
    return statuses.map((entry) => cleanText(entry)).filter(Boolean);
  }

  const coreStatus = cleanText(effect?.getFlag?.("core", "statusId") ?? getProperty(effect, "flags.core.statusId"));
  return coreStatus ? [coreStatus] : [];
}

function hasBloodiedStatus(actor) {
  return collectionValues(actor?.effects).some((effect) => (
    effectStatuses(effect).some((statusId) => BLOODIED_STATUS_IDS.has(statusId))
  ));
}

function isBloodied(actor) {
  const max = actorHpMax(actor);
  if (max > 0) {
    return actorHpValue(actor) * 2 < max;
  }

  return hasBloodiedStatus(actor);
}

function isExactlyHalfHp(actor) {
  const hp = actor?.system?.attributes?.hp;
  const max = toNumber(hp?.max, 0);
  if (max <= 0) {
    return false;
  }

  return toNumber(hp?.value, 0) * 2 === max;
}

function actorHpValue(actor) {
  return toNumber(actor?.system?.attributes?.hp?.value, 0);
}

function actorHpMax(actor) {
  return toNumber(actor?.system?.attributes?.hp?.max, 0);
}

function hasActorFeature(actor, rawId, normalizedName) {
  return collectionValues(actor?.items).some((item) => (
    featureIdMatches(item, rawId) || normalizeText(item?.name) === normalizedName
  ));
}

function findActorFeature(actor, rawId, normalizedName) {
  return collectionValues(actor?.items).find((item) => (
    featureIdMatches(item, rawId) || normalizeText(item?.name) === normalizedName
  )) ?? null;
}

export class FighterAutomationService {
  constructor(moduleApi, options = {}) {
    this.moduleApi = moduleApi;
    this._lastAttacks = new Map();
    this._ironWillTurnPrompts = new Set();
    this._options = options;
  }

  async initialize() {
    return true;
  }

  applyMidiRollComplete(workflow) {
    const actor = workflow?.actor;
    if (!(actor instanceof Actor)) {
      return true;
    }

    const targets = targetActorsFromWorkflow(workflow);
    if (!targets.length) {
      return true;
    }

    this._lastAttacks.set(this.#actorKey(actor), {
      targets,
      damageType: defaultDamageTypeFromWorkflow(workflow),
      sourceItemUuid: workflow?.item?.uuid,
      timestamp: Date.now()
    });
    return true;
  }

  async applyDnd5ePostUseActivity(activity, usageConfig, results) {
    void usageConfig;
    void results;

    const actor = activity?.actor ?? activity?.item?.actor;
    if (!(actor instanceof Actor)) {
      return true;
    }

    const automation = cleanText(readDocumentFlag(activity, "automation"));
    const fighterAutomation = readDocumentFlag(activity, "fighterAutomation") ?? {};

    if (automation === "fighter-second-wind" || fighterAutomation?.kind === "secondWind") {
      await this.#useSecondWind(actor, activity?.item, fighterAutomation);
      return true;
    }

    if (automation === "fighter-dominance-maneuver" || fighterAutomation?.kind === "maneuver") {
      await this.#applyManeuver(actor, activity, fighterAutomation);
    }

    return true;
  }

  async handleCombatTurnChange(combat) {
    const actor = combat?.combatant?.actor ?? null;
    if (!(actor instanceof Actor)) {
      return true;
    }

    if (!this.#hasIronWill(actor) || actorHpValue(actor) <= 0) {
      return true;
    }

    if (!isBloodied(actor) && !isExactlyHalfHp(actor)) {
      return true;
    }

    const turnKey = `${combat?.round ?? 0}:${combat?.turn ?? 0}:${this.#actorKey(actor)}:iron-will`;
    if (this._ironWillTurnPrompts.has(turnKey)) {
      return true;
    }
    this._ironWillTurnPrompts.add(turnKey);

    const secondWind = this.#findSecondWind(actor);
    if (!secondWind) {
      return true;
    }

    const confirmed = await this.#confirmIronWillSecondWind(actor);
    if (confirmed) {
      await this.#useSecondWind(actor, secondWind, {
        kind: "secondWind",
        die: "d6",
        maxDiceAbility: "con",
        minDice: 1
      });
    }

    return true;
  }

  async applyDnd5eApplyDamage(actor, amount, options = {}) {
    void options;
    if (!(actor instanceof Actor) || toNumber(amount, 0) >= 0) {
      return true;
    }

    await this.#applyIronWillAfterHealing(actor);
    return true;
  }

  async #applyManeuver(actor, activity, fighterAutomation = {}) {
    const lastAttack = this.#lastAttack(actor);
    const target = this.#resolveManeuverTarget(lastAttack);
    const item = activity?.item;

    if (target && fighterAutomation?.extraDamage?.formula) {
      await this.#applyDamage(target, fighterAutomation.extraDamage.formula, cleanText(lastAttack?.damageType), {
        sourceActor: actor,
        sourceItemUuid: item?.uuid,
        label: item?.name ?? activity?.name ?? "Воинский приём"
      });
    }

    if (target && fighterAutomation?.saveAbility && this.#hasIronWillNextSave(actor)) {
      await this.#applySaveDisadvantageEffect(target, fighterAutomation.saveAbility, actor);
      await this.#consumeIronWillNextSave(actor);
    }

    if (target && fighterAutomation?.status?.id) {
      await this.#setStatus(target, fighterAutomation.status, actor);
    }

    await this.#postManeuverChat(actor, activity, fighterAutomation, target);
  }

  #lastAttack(actor) {
    const entry = this._lastAttacks.get(this.#actorKey(actor));
    if (!entry) {
      return null;
    }

    if ((Date.now() - toNumber(entry.timestamp, 0)) > LAST_ATTACK_MAX_AGE_MS) {
      this._lastAttacks.delete(this.#actorKey(actor));
      return null;
    }

    return entry;
  }

  #resolveManeuverTarget(lastAttack) {
    const storedTarget = lastAttack?.targets?.find((target) => target instanceof Actor);
    if (storedTarget) {
      return storedTarget;
    }

    return collectionValues(game.user?.targets)
      .map(resolveActorFromTarget)
      .find((actor) => actor instanceof Actor) ?? null;
  }

  async #useSecondWind(actor, item, automation = {}) {
    const secondWind = item ?? this.#findSecondWind(actor);
    if (!secondWind) {
      globalThis.ui?.notifications?.warn("Второе дыхание: предмет не найден у актёра.");
      return false;
    }

    const uses = secondWind.system?.uses ?? {};
    const maxUses = await this.#resolveUsesMax(uses.max, actor);
    const spent = Math.max(0, Math.floor(toNumber(uses.spent, 0)));
    const remaining = Math.max(0, maxUses - spent);
    if (remaining <= 0) {
      globalThis.ui?.notifications?.warn("Второе дыхание: не осталось костей лечения.");
      return false;
    }

    const die = cleanText(automation?.die, "d6");
    const minDice = Math.max(1, Math.floor(toNumber(automation?.minDice, 1)));
    const ability = cleanText(automation?.maxDiceAbility, "con");
    const abilityLimit = Math.max(minDice, Math.floor(toNumber(actor?.system?.abilities?.[ability]?.mod, minDice)));
    const maxDice = Math.max(minDice, Math.min(remaining, abilityLimit));
    const diceCount = await this.#promptSecondWindDice(actor, {
      min: minDice,
      max: maxDice,
      remaining,
      die
    });
    if (!diceCount) {
      return false;
    }

    const safeDiceCount = clampInteger(diceCount, minDice, maxDice);
    const roll = this.#createRoll(`${safeDiceCount}${die}`, actor);
    await roll.evaluate();
    const healed = Math.max(0, toNumber(roll.total, 0));
    const nextHp = Math.min(actorHpMax(actor), actorHpValue(actor) + healed);

    await actor.update({ "system.attributes.hp.value": nextHp });
    await secondWind.update?.({ "system.uses.spent": spent + safeDiceCount });
    await roll.toMessage?.({
      speaker: speakerForActor(actor),
      flavor: `Второе дыхание: ${safeDiceCount}${die}`
    });
    await this.#applyIronWillAfterHealing(actor);
    return true;
  }

  async #resolveUsesMax(value, actor) {
    const numeric = Number(value);
    if (Number.isFinite(numeric)) {
      return Math.max(0, Math.floor(numeric));
    }

    const formula = cleanText(value);
    if (!formula) {
      return 0;
    }

    const roll = this.#createRoll(formula, actor);
    await roll.evaluate();
    return Math.max(0, Math.floor(toNumber(roll.total, 0)));
  }

  async #applyIronWillAfterHealing(actor) {
    if (!this.#hasIronWill(actor) || actorHpValue(actor) <= 0) {
      return false;
    }

    if (isBloodied(actor) && !isExactlyHalfHp(actor)) {
      return false;
    }

    if (this.#hasIronWillNextSave(actor)) {
      return true;
    }

    return this.#createActorEffect(actor, this.#ironWillNextSaveEffectData(actor));
  }

  #hasIronWill(actor) {
    return hasActorFeature(actor, "iron-will", "железная воля");
  }

  #findSecondWind(actor) {
    return findActorFeature(actor, "second-wind", "второе дыхание");
  }

  #hasIronWillNextSave(actor) {
    return collectionValues(actor?.effects).some((effect) => (
      readDocumentFlag(effect, "fighterAutomation")?.kind === "ironWillNextSave"
    ));
  }

  #findIronWillNextSaveEffect(actor) {
    return collectionValues(actor?.effects).find((effect) => (
      readDocumentFlag(effect, "fighterAutomation")?.kind === "ironWillNextSave"
    )) ?? null;
  }

  async #consumeIronWillNextSave(actor) {
    const effect = this.#findIronWillNextSaveEffect(actor);
    if (typeof effect?.delete === "function") {
      await effect.delete();
    }
    return Boolean(effect);
  }

  async #applySaveDisadvantageEffect(target, ability, sourceActor) {
    const abilityKey = cleanText(ability, "wis");
    return this.#createActorEffect(target, {
      name: "Железная воля: помеха спасброску",
      type: "base",
      img: "icons/svg/downgrade.svg",
      system: {},
      changes: [{
        key: `flags.midi-qol.disadvantage.ability.save.${abilityKey}`,
        mode: EFFECT_MODE_OVERRIDE,
        value: "1",
        priority: 20
      }],
      disabled: false,
      duration: {
        startTime: null,
        seconds: null,
        combat: null,
        rounds: 1,
        turns: null,
        startRound: null,
        startTurn: null
      },
      description: `<p>Первый спасбросок против воинского приёма ${escapeHtml(sourceActor?.name)} совершается с помехой.</p>`,
      origin: sourceActor?.uuid ?? null,
      transfer: false,
      statuses: [],
      flags: {
        dae: {
          specialDuration: ["isSave", "combatEnd"]
        },
        [MODULE_ID]: {
          managed: true,
          fighterAutomation: {
            kind: "ironWillSaveDisadvantage",
            sourceActorUuid: sourceActor?.uuid ?? "",
            ability: abilityKey
          }
        }
      }
    });
  }

  #ironWillNextSaveEffectData(actor) {
    return {
      name: "Железная воля",
      type: "base",
      img: "icons/svg/aura.svg",
      system: {},
      changes: [],
      disabled: false,
      duration: {
        startTime: null,
        seconds: null,
        combat: null,
        rounds: 2,
        turns: null,
        startRound: null,
        startTurn: null
      },
      description: "<p>Следующий воинский приём со спасброском может дать одной цели помеху на первый спасбросок.</p>",
      origin: actor?.uuid ?? null,
      transfer: false,
      statuses: [],
      flags: {
        dae: {
          specialDuration: ["combatEnd"]
        },
        [MODULE_ID]: {
          managed: true,
          fighterAutomation: {
            kind: "ironWillNextSave"
          }
        }
      }
    };
  }

  async #applyDamage(actor, formula, damageType = "", options = {}) {
    const roll = this.#createRoll(formula, options.sourceActor ?? actor);
    await roll.evaluate();
    await actor.applyDamage([{
      value: Math.max(0, toNumber(roll.total, 0)),
      type: cleanText(damageType)
    }], {
      sourceActorUuid: options.sourceActor?.uuid,
      sourceItemUuid: options.sourceItemUuid
    });
    await roll.toMessage?.({
      speaker: speakerForActor(options.sourceActor ?? actor),
      flavor: cleanText(options.label, "Воинский приём")
    });
    return true;
  }

  async #setStatus(actor, status = {}, sourceActor) {
    const statusId = cleanText(status.id);
    if (!statusId) {
      return false;
    }

    if (typeof this.moduleApi?.combatStatusService?.setStatus === "function") {
      await this.moduleApi.combatStatusService.setStatus(actor, statusId, {
        active: true,
        ...(Object.hasOwn(status, "value") ? { value: status.value } : {}),
        durationRounds: Math.max(0, Math.floor(toNumber(status.durationRounds, 0))),
        sourceActor
      });
      return true;
    }

    return this.#createActorEffect(actor, {
      name: statusId,
      type: "base",
      img: "icons/svg/aura.svg",
      system: {},
      changes: [],
      disabled: false,
      duration: {
        rounds: Math.max(0, Math.floor(toNumber(status.durationRounds, 0)))
      },
      transfer: false,
      statuses: [statusId],
      flags: {
        core: {
          statusId
        },
        [MODULE_ID]: {
          managed: true,
          fighterAutomation: {
            kind: "maneuverStatus"
          }
        }
      }
    });
  }

  async #createActorEffect(actor, effectData) {
    if (!(actor instanceof Actor) || typeof actor.createEmbeddedDocuments !== "function") {
      return false;
    }

    const data = foundry.utils.deepClone(effectData);
    delete data._id;
    await actor.createEmbeddedDocuments("ActiveEffect", [data]);
    return true;
  }

  async #postManeuverChat(actor, activity, fighterAutomation, target) {
    if (!globalThis.ChatMessage?.create) {
      return false;
    }

    const itemName = cleanText(activity?.item?.name, activity?.name ?? "Воинский приём");
    const damageText = fighterAutomation?.extraDamage?.formula
      ? `<p><strong>Урон приёма:</strong> ${escapeHtml(fighterAutomation.extraDamage.formula)}${target ? ` по ${escapeHtml(target.name)}` : ""}.</p>`
      : "";
    const statusText = fighterAutomation?.status?.id
      ? `<p><strong>Состояние:</strong> ${escapeHtml(fighterAutomation.status.id)}${target ? ` на ${escapeHtml(target.name)}` : ""}.</p>`
      : "";
    const saveText = fighterAutomation?.saveAbility
      ? `<p><strong>Спасбросок:</strong> ${escapeHtml(fighterAutomation.saveAbility)}${this.#hasIronWillNextSave(actor) ? " с возможной помехой от Железной воли" : ""}.</p>`
      : "";

    if (!damageText && !statusText && !saveText) {
      return false;
    }

    await ChatMessage.create({
      speaker: speakerForActor(actor),
      flavor: itemName,
      content: `${damageText}${statusText}${saveText}`
    });
    return true;
  }

  #createRoll(formula, actor) {
    if (typeof this._options.rollFactory === "function") {
      return this._options.rollFactory(formula, actor);
    }

    return new Roll(cleanText(formula) || "0", actor?.getRollData?.() ?? {});
  }

  async #promptSecondWindDice(actor, context) {
    if (typeof this._options.promptSecondWindDice === "function") {
      return this._options.promptSecondWindDice(actor, context);
    }

    if (!this.#canPrompt(actor) || typeof Dialog !== "function") {
      return null;
    }

    return new Promise((resolve) => {
      let settled = false;
      const options = [];
      for (let value = context.min; value <= context.max; value += 1) {
        options.push(`<option value="${value}">${value}${escapeHtml(context.die)}</option>`);
      }

      const dialog = new Dialog({
        title: "Второе дыхание",
        content: `
          <form>
            <div class="form-group">
              <label>Костей лечения: ${context.remaining}</label>
              <select data-second-wind-dice>${options.join("")}</select>
            </div>
          </form>
        `,
        buttons: {
          confirm: {
            label: "Исцелиться",
            callback: (html) => {
              const root = globalThis.HTMLElement && html instanceof HTMLElement ? html : html?.[0];
              settled = true;
              resolve(Number(root?.querySelector("[data-second-wind-dice]")?.value ?? context.min));
            }
          },
          cancel: {
            label: "Отмена",
            callback: () => {
              settled = true;
              resolve(null);
            }
          }
        },
        default: "confirm",
        close: () => {
          if (!settled) {
            resolve(null);
          }
        }
      });
      dialog.render(true);
    });
  }

  async #confirmIronWillSecondWind(actor) {
    if (typeof this._options.confirmIronWillSecondWind === "function") {
      return this._options.confirmIronWillSecondWind(actor);
    }

    if (!this.#canPrompt(actor)) {
      return false;
    }

    const DialogV2 = foundry.applications?.api?.DialogV2;
    if (typeof DialogV2?.confirm === "function") {
      return DialogV2.confirm({
        window: {
          title: "Железная воля"
        },
        content: "<p>Вы окровавлены. Использовать Второе дыхание в начале хода?</p>"
      });
    }

    if (typeof globalThis.Dialog?.confirm === "function") {
      return globalThis.Dialog.confirm({
        title: "Железная воля",
        content: "<p>Вы окровавлены. Использовать Второе дыхание в начале хода?</p>",
        yes: () => true,
        no: () => false,
        defaultYes: false
      });
    }

    return false;
  }

  #canPrompt(actor) {
    return Boolean(game.user?.isGM || actor?.isOwner);
  }

  #actorKey(actor) {
    return cleanText(actor?.uuid, actor?.id ?? "");
  }
}
