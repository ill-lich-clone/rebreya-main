import { MODULE_ID } from "../constants.js";

const ROGUE_CLASS_IDENTIFIER = "rogue-rework-v00";
const SNEAK_ATTACK_FEATURE_ID = "rogue-sneak-attack";
const CUNNING_STRIKE_SOURCE_TYPE = "rogueCunningStrike";

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

function getProperty(source, path, fallback = undefined) {
  const value = foundry.utils.getProperty(source, path);
  return value === undefined ? fallback : value;
}

function itemFlag(item, scope, key) {
  if (typeof item?.getFlag === "function") {
    return item.getFlag(scope, key);
  }

  return getProperty(item, `flags.${scope}.${key}`, undefined);
}

function rawFeatureId(featureId) {
  return cleanText(featureId).split("::").pop() ?? "";
}

function itemFeatureId(item) {
  return cleanText(itemFlag(item, MODULE_ID, "featureId"));
}

function featureIdMatches(item, rawId) {
  const featureId = itemFeatureId(item);
  return featureId === rawId || rawFeatureId(featureId) === rawId;
}

function findActorFeature(actor, rawId, normalizedName = "") {
  return collectionValues(actor?.items).find((item) => (
    featureIdMatches(item, rawId)
    || (normalizedName && normalizeText(item?.name) === normalizedName)
  )) ?? null;
}

function resolveActorFromTarget(target) {
  return target?.actor
    ?? target?.document?.actor
    ?? target?.object?.actor
    ?? target?.token?.actor
    ?? null;
}

function targetActorsFromWorkflow(workflow) {
  const targets = [
    ...collectionValues(workflow?.hitTargets),
    ...collectionValues(workflow?.hitTargetsEC)
  ];
  const seen = new Set();
  const actors = [];
  for (const target of targets) {
    const actor = resolveActorFromTarget(target);
    if (!(actor instanceof Actor)) {
      continue;
    }

    const key = cleanText(actor.uuid ?? actor.id ?? actor.name);
    if (key && seen.has(key)) {
      continue;
    }
    if (key) {
      seen.add(key);
    }
    actors.push(actor);
  }
  return actors;
}

function isWeaponAttackWorkflow(workflow) {
  const activity = workflow?.activity;
  const item = activity?.item ?? workflow?.item;
  if (item?.type !== "weapon") {
    return false;
  }

  const activityType = cleanText(activity?.type);
  return !activityType || activityType === "attack";
}

function defaultDamageTypeFromWorkflow(workflow) {
  const detail = Array.isArray(workflow?.damageDetail) ? workflow.damageDetail : [];
  const detailedType = detail.map((row) => cleanText(row?.type)).find(Boolean);
  if (detailedType) {
    return detailedType;
  }

  const item = workflow?.activity?.item ?? workflow?.item;
  const itemType = cleanText(item?.system?.damage?.base?.types?.[0]);
  if (itemType) {
    return itemType;
  }

  return cleanText(workflow?.defaultDamageType);
}

function rogueClassLevel(actor) {
  const classes = actor?.system?.classes;
  if (classes && typeof classes === "object") {
    for (const [key, entry] of Object.entries(classes)) {
      const text = normalizeText([
        key,
        entry?.identifier,
        entry?.name,
        entry?.label,
        entry?.system?.identifier
      ].filter(Boolean).join(" "));
      if (text !== ROGUE_CLASS_IDENTIFIER && !text.includes("rogue") && !text.includes("плут")) {
        continue;
      }

      const levels = toNumber(entry?.levels ?? entry?.level ?? entry?.value, 0);
      if (levels > 0) {
        return Math.floor(levels);
      }
    }
  }

  for (const item of collectionValues(actor?.items)) {
    if (item?.type !== "class") {
      continue;
    }

    const text = normalizeText([
      item?.system?.identifier,
      item?.identifier,
      item?.name
    ].filter(Boolean).join(" "));
    if (text !== ROGUE_CLASS_IDENTIFIER && !text.includes("rogue") && !text.includes("плут")) {
      continue;
    }

    const levels = toNumber(item?.system?.levels ?? item?.system?.level ?? item?.system?.advancement?.level, 0);
    if (levels > 0) {
      return Math.floor(levels);
    }
  }

  return 0;
}

function sneakAttackDiceCount(actor) {
  const scale = getProperty(actor, `system.scale.${ROGUE_CLASS_IDENTIFIER}.sneak-attack`, null);
  const number = Math.floor(toNumber(scale?.number, 0));
  const faces = Math.floor(toNumber(scale?.faces, 0));
  if (number > 0 && faces === 6) {
    return number;
  }

  const stringMatch = cleanText(scale?.value ?? scale).match(/^(\d+)d6$/iu);
  if (stringMatch) {
    return Math.max(1, Math.floor(toNumber(stringMatch[1], 1)));
  }

  const rogueLevel = Math.max(1, rogueClassLevel(actor));
  return Math.min(10, Math.max(1, Math.ceil(rogueLevel / 2)));
}

function combatTurnKey(actor, workflow) {
  const combat = workflow?.combat ?? game?.combat ?? null;
  if (!cleanText(combat?.id)) {
    return "";
  }

  return [
    cleanText(combat?.id),
    Math.floor(toNumber(combat?.round, 0)),
    Math.floor(toNumber(combat?.turn, 0)),
    cleanText(actor?.uuid ?? actor?.id ?? actor?.name, "actor"),
    "sneak-attack"
  ].join(":");
}

function getDialogRoot(html) {
  if (typeof HTMLElement !== "undefined" && html instanceof HTMLElement) {
    return html;
  }

  if (typeof HTMLElement !== "undefined" && html?.[0] instanceof HTMLElement) {
    return html[0];
  }

  return null;
}

function escapeHtml(value) {
  return foundry.utils.escapeHTML(cleanText(value));
}

function selectedCunningStrikeId(choice) {
  return cleanText(
    choice?.cunningStrikeId
    ?? choice?.cunningStrikeFeatureId
    ?? choice?.variantId
    ?? choice?.cunningStrike
  );
}

function damageDiceFormula(diceCount, faces) {
  const dice = Math.max(0, Math.floor(toNumber(diceCount, 0)));
  return `${dice}d${Math.max(1, Math.floor(toNumber(faces, 1)))}`;
}

function damagePropertiesFromWorkflow(workflow) {
  const item = workflow?.activity?.item ?? workflow?.item ?? null;
  const properties = collectionValues(item?.system?.properties)
    .map((property) => cleanText(property))
    .filter(Boolean);
  const propertyConfig = globalThis.CONFIG?.DND5E?.itemProperties ?? {};
  return properties.filter((property) => propertyConfig[property]?.isPhysical !== false);
}

function appendDamageRollConfig(config, workflow, actor, formula, damageType, flavor) {
  const safeFormula = cleanText(formula);
  if (!safeFormula) {
    return false;
  }

  const safeDamageType = cleanText(damageType);
  config.rolls ??= [];
  config.rolls.push({
    data: actor?.getRollData?.() ?? {},
    parts: [safeFormula],
    options: {
      type: safeDamageType,
      types: safeDamageType ? [safeDamageType] : [],
      properties: damagePropertiesFromWorkflow(workflow),
      flavor: cleanText(flavor, safeDamageType)
    }
  });
  return true;
}

export class RogueAutomationService {
  constructor(moduleApi, options = {}) {
    this.moduleApi = moduleApi;
    this._sneakAttackTurnUses = new Set();
    this._options = options;
  }

  async initialize() {
    return true;
  }

  async applyMidiPreDamageRoll(workflow, activity, config = {}) {
    if (workflow && activity && !workflow.activity) {
      workflow.activity = activity;
    }

    const actor = workflow?.actor;
    if (!(actor instanceof Actor)) {
      return true;
    }

    const sneakAttackFeature = this.#findSneakAttack(actor);
    if ((!sneakAttackFeature && !this.#hasRogueSneakAttack(actor)) || !isWeaponAttackWorkflow(workflow)) {
      return true;
    }

    const targets = targetActorsFromWorkflow(workflow);
    if (!targets.length) {
      return true;
    }

    const turnKey = combatTurnKey(actor, workflow);
    if (turnKey && this._sneakAttackTurnUses.has(turnKey)) {
      return true;
    }

    const diceCount = sneakAttackDiceCount(actor);
    const damageType = defaultDamageTypeFromWorkflow(workflow);
    const weapon = workflow?.activity?.item ?? workflow?.item ?? null;
    const details = {
      formula: damageDiceFormula(diceCount, 6),
      diceCount,
      damageType,
      weapon: {
        uuid: cleanText(weapon?.uuid),
        id: cleanText(weapon?.id),
        name: cleanText(weapon?.name, "Оружие"),
        actionType: cleanText(workflow?.activity?.actionType ?? weapon?.system?.actionType)
      },
      targets: targets.map((target) => ({
        uuid: cleanText(target.uuid ?? target.id),
        name: cleanText(target.name, "Цель")
      })),
      cunningStrikes: this.#cunningStrikeOptions(actor, diceCount)
    };
    const choice = await this.#promptSneakAttack(actor, details);
    if (!choice) {
      return true;
    }

    const chosenTarget = this.#chosenTarget(targets, choice) ?? targets[0];
    if (!(chosenTarget instanceof Actor)) {
      return true;
    }

    const selectedStrike = this.#chosenCunningStrike(details.cunningStrikes, choice);
    const remainingDice = Math.max(0, diceCount - Math.floor(toNumber(selectedStrike?.cost, 0)));
    const label = this.#sneakAttackLabel(selectedStrike);
    if (remainingDice > 0) {
      if (!appendDamageRollConfig(config, workflow, actor, damageDiceFormula(remainingDice, 6), damageType, label)) {
        return true;
      }
    }

    if (turnKey) {
      this._sneakAttackTurnUses.add(turnKey);
    }
    return true;
  }

  async applyMidiRollComplete() {
    return true;
  }

  #findSneakAttack(actor) {
    return findActorFeature(actor, SNEAK_ATTACK_FEATURE_ID, "скрытая атака");
  }

  #hasRogueSneakAttack(actor) {
    if (rogueClassLevel(actor) > 0) {
      return true;
    }

    return getProperty(actor, `system.scale.${ROGUE_CLASS_IDENTIFIER}.sneak-attack`, null) !== null;
  }

  #cunningStrikeOptions(actor, diceCount) {
    const options = [];
    const seen = new Set();
    for (const item of collectionValues(actor?.items)) {
      const sourceType = cleanText(itemFlag(item, MODULE_ID, "sourceType"));
      if (sourceType !== CUNNING_STRIKE_SOURCE_TYPE) {
        continue;
      }

      const id = rawFeatureId(itemFeatureId(item)) || cleanText(item?.id);
      const cost = Math.max(0, Math.floor(toNumber(itemFlag(item, MODULE_ID, "cunningStrikeCost"), 0)));
      if (!id || cost > diceCount || seen.has(id)) {
        continue;
      }

      seen.add(id);
      options.push({
        id,
        name: cleanText(item?.name, "Хитрый удар"),
        cost,
        itemUuid: cleanText(item?.uuid),
        description: cleanText(item?.system?.description?.value ?? item?.system?.description?.chat)
      });
    }
    return options;
  }

  #chosenTarget(targets, choice) {
    const targetUuid = cleanText(choice?.targetUuid);
    if (!targetUuid) {
      return targets[0] ?? null;
    }

    return targets.find((target) => cleanText(target?.uuid ?? target?.id) === targetUuid) ?? null;
  }

  #chosenCunningStrike(options, choice) {
    const id = selectedCunningStrikeId(choice);
    if (!id) {
      return null;
    }

    return options.find((option) => option.id === id) ?? null;
  }

  #sneakAttackLabel(selectedStrike) {
    const suffix = selectedStrike?.name ? `: ${selectedStrike.name}` : "";
    return `Скрытая атака${suffix}`;
  }

  async #promptSneakAttack(actor, details) {
    if (typeof this._options.promptSneakAttack === "function") {
      const choice = await this._options.promptSneakAttack(actor, details);
      return choice ? { ...choice, actor } : null;
    }

    if (!this.#canPrompt(actor) || typeof Dialog !== "function") {
      return null;
    }

    const targetOptions = details.targets.map((target) => (
      `<option value="${escapeHtml(target.uuid)}">${escapeHtml(target.name)}</option>`
    )).join("");
    const strikeOptions = [
      `<option value="">Без Хитрого удара</option>`,
      ...details.cunningStrikes.map((strike) => (
        `<option value="${escapeHtml(strike.id)}">${escapeHtml(strike.name)} (-${escapeHtml(strike.cost)}к6)</option>`
      ))
    ].join("");

    return new Promise((resolve) => {
      let settled = false;
      const dialog = new Dialog({
        title: "Скрытая атака",
        content: `
          <form>
            <p>Попадание оружием: <strong>${escapeHtml(details.weapon.name)}</strong>. Использовать Скрытую атаку?</p>
            <p>Урон: ${escapeHtml(details.formula)} ${details.damageType ? `(${escapeHtml(details.damageType)})` : ""}</p>
            ${details.targets.length > 1 ? `
              <div class="form-group">
                <label>Цель</label>
                <select data-sneak-attack-target>${targetOptions}</select>
              </div>
            ` : ""}
            <div class="form-group">
              <label>Хитрый удар</label>
              <select data-sneak-attack-cunning-strike>${strikeOptions}</select>
            </div>
          </form>
        `,
        buttons: {
          confirm: {
            label: "Скрытая атака",
            callback: (html) => {
              const root = getDialogRoot(html);
              const targetUuid = cleanText(root?.querySelector("[data-sneak-attack-target]")?.value);
              const cunningStrikeId = cleanText(root?.querySelector("[data-sneak-attack-cunning-strike]")?.value);
              settled = true;
              resolve({ targetUuid, cunningStrikeId, actor });
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
        close: () => {
          if (!settled) {
            resolve(null);
          }
        },
        default: "confirm"
      });
      dialog.render(true);
    });
  }

  #canPrompt(actor) {
    return Boolean(game.user?.isGM || actor?.isOwner);
  }
}
