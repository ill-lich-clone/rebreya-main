import { MODULE_ID } from "../constants.js";

const PALADIN_CLASS_IDENTIFIER = "paladin-rework-v01";

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

function setProperty(target, path, value) {
  foundry.utils.setProperty(target, path, value);
  return target;
}

function escapeHtml(value) {
  return foundry.utils.escapeHTML(cleanText(value));
}

function isActorDocument(actor) {
  return typeof Actor !== "undefined" && actor instanceof Actor;
}

function itemFlag(item, scope, key) {
  if (typeof item?.getFlag === "function") {
    return item.getFlag(scope, key);
  }

  return getProperty(item, `flags.${scope}.${key}`, undefined);
}

function itemSourceId(item) {
  return cleanText(itemFlag(item, "dnd5e", "sourceId"));
}

function isLongRest(result = {}, config = {}) {
  if (result?.longRest === true || config?.longRest === true) {
    return true;
  }

  return [
    result?.type,
    result?.restType,
    result?.period,
    config?.type,
    config?.restType,
    config?.period
  ].some((value) => {
    const text = normalizeText(value);
    return text === "long" || text === "lr" || text.includes("продолж");
  });
}

function paladinClassLevel(actor) {
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
      if (text !== PALADIN_CLASS_IDENTIFIER && !text.includes("paladin") && !text.includes("паладин")) {
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
    if (text !== PALADIN_CLASS_IDENTIFIER && !text.includes("paladin") && !text.includes("паладин")) {
      continue;
    }

    const levels = toNumber(item?.system?.levels ?? item?.system?.level ?? item?.system?.advancement?.level, 0);
    if (levels > 0) {
      return Math.floor(levels);
    }
  }

  return 0;
}

function paladinPreparedSpellCount(actor, paladinLevel) {
  const charismaModifier = Math.floor(toNumber(actor?.system?.abilities?.cha?.mod, 0));
  return Math.max(1, charismaModifier + Math.floor(paladinLevel / 2));
}

function paladinMaxSpellLevel(paladinLevel) {
  if (paladinLevel < 2) {
    return 0;
  }

  return Math.min(5, Math.floor((paladinLevel - 1) / 4) + 1);
}

function isPaladinPreparedSpellItem(item) {
  if (item?.type !== "spell") {
    return false;
  }

  if (itemFlag(item, MODULE_ID, "paladinPreparedSpell") === true) {
    return true;
  }

  return cleanText(item?.system?.sourceClass) === PALADIN_CLASS_IDENTIFIER
    && cleanText(item?.system?.method, "spell") === "spell";
}

function spellMatchKeys(spell) {
  return {
    uuid: cleanText(spell?.uuid),
    sourceId: itemSourceId(spell),
    identifier: cleanText(spell?.system?.identifier),
    name: normalizeText(spell?.name)
  };
}

function actorSpellMatchesSelection(item, selected) {
  const keys = spellMatchKeys(item);
  return Boolean(
    (keys.sourceId && selected.uuids.has(keys.sourceId))
    || (keys.uuid && selected.uuids.has(keys.uuid))
    || (keys.identifier && selected.identifiers.has(keys.identifier))
    || (keys.name && selected.names.has(keys.name))
  );
}

function selectedUuidForActorSpell(item, selected) {
  const keys = spellMatchKeys(item);
  if (keys.sourceId && selected.uuids.has(keys.sourceId)) {
    return keys.sourceId;
  }
  if (keys.uuid && selected.uuids.has(keys.uuid)) {
    return keys.uuid;
  }
  if (keys.identifier && selected.uuidByIdentifier.has(keys.identifier)) {
    return selected.uuidByIdentifier.get(keys.identifier);
  }
  if (keys.name && selected.uuidByName.has(keys.name)) {
    return selected.uuidByName.get(keys.name);
  }
  return "";
}

function createSpellData(spellDocument) {
  const data = typeof spellDocument?.toObject === "function"
    ? spellDocument.toObject()
    : foundry.utils.deepClone(spellDocument);
  delete data._id;
  data.type = "spell";
  setProperty(data, "system.sourceClass", PALADIN_CLASS_IDENTIFIER);
  setProperty(data, "system.method", "spell");
  setProperty(data, "system.prepared", 1);
  setProperty(data, `flags.${MODULE_ID}.paladinPreparedSpell`, true);
  if (spellDocument?.uuid) {
    setProperty(data, "flags.dnd5e.sourceId", spellDocument.uuid);
  }
  return data;
}

function actorHpValue(actor) {
  return Math.max(0, Math.floor(toNumber(actor?.system?.attributes?.hp?.value, 0)));
}

function actorHpMax(actor) {
  return Math.max(0, Math.floor(toNumber(actor?.system?.attributes?.hp?.max, 0)));
}

function clampInteger(value, min, max) {
  const numericValue = Math.floor(toNumber(value, min));
  return Math.min(Math.max(numericValue, min), max);
}

function speakerForActor(actor) {
  if (typeof globalThis.ChatMessage?.getSpeaker === "function") {
    return globalThis.ChatMessage.getSpeaker({ actor });
  }

  return {
    actor: actor?.id,
    alias: actor?.name
  };
}

export class PaladinAutomationService {
  constructor(moduleApi, options = {}) {
    this.moduleApi = moduleApi;
    this._options = options;
  }

  async initialize() {
    return true;
  }

  async applyDnd5ePostUseActivity(activity, usageConfig, results) {
    void usageConfig;
    void results;

    const actor = activity?.actor ?? activity?.item?.actor;
    if (!(actor instanceof Actor)) {
      return true;
    }

    const automation = cleanText(itemFlag(activity, MODULE_ID, "automation"));
    if (automation === "paladin-lay-on-hands") {
      await this.#useLayOnHands(actor, activity?.item);
    }

    return true;
  }

  async handleRestCompleted(actor, result = {}, config = {}) {
    if (!isActorDocument(actor) || !isLongRest(result, config)) {
      return true;
    }

    const paladinLevel = paladinClassLevel(actor);
    const maxSpellLevel = paladinMaxSpellLevel(paladinLevel);
    if (maxSpellLevel <= 0 || !this.#canPrompt(actor)) {
      return true;
    }

    const details = {
      paladinLevel,
      preparedCount: paladinPreparedSpellCount(actor, paladinLevel),
      maxSpellLevel
    };
    const confirmed = await this.#confirmPreparedSpellChange(actor, details);
    if (!confirmed) {
      return true;
    }

    const selectedUuids = await this.#selectPreparedSpellUuids(actor, details);
    if (!selectedUuids) {
      return true;
    }

    await this.#applyPreparedSpellSelection(actor, selectedUuids);
    return true;
  }

  #canPrompt(actor) {
    return Boolean(game.user?.isGM || actor?.isOwner);
  }

  async #useLayOnHands(actor, item) {
    const layOnHands = item ?? this.#findLayOnHands(actor);
    if (!layOnHands) {
      globalThis.ui?.notifications?.warn("Наложение рук: предмет не найден у актёра.");
      return false;
    }

    const target = this.#selectedTargetActor();
    if (!target) {
      return false;
    }

    const targetCurrentHp = actorHpValue(target);
    const targetMaxHp = actorHpMax(target);
    const missingHp = Math.max(0, targetMaxHp - targetCurrentHp);
    if (missingHp <= 0) {
      globalThis.ui?.notifications?.warn("Наложение рук: выбранная цель уже полностью здорова.");
      return false;
    }

    const uses = layOnHands.system?.uses ?? {};
    const maxUses = this.#layOnHandsMaxUses(actor, layOnHands);
    const spent = Math.max(0, Math.floor(toNumber(uses.spent, 0)));
    const remaining = Math.max(0, maxUses - spent);
    if (remaining <= 0) {
      globalThis.ui?.notifications?.warn("Наложение рук: запас целительной силы исчерпан.");
      return false;
    }

    const maxSpend = Math.min(remaining, missingHp);
    const amount = await this.#promptLayOnHandsPoints(actor, layOnHands, {
      remaining,
      max: maxSpend
    });
    if (!amount) {
      return false;
    }

    const healing = clampInteger(amount, 1, maxSpend);
    await target.update?.({ "system.attributes.hp.value": targetCurrentHp + healing });
    await layOnHands.update?.({ "system.uses.spent": spent + healing });
    await globalThis.ChatMessage?.create?.({
      speaker: speakerForActor(actor),
      flavor: `Наложение рук: ${healing} хитов для ${target.name ?? "цели"}.`
    });
    return true;
  }

  #findLayOnHands(actor) {
    return collectionValues(actor?.items).find((item) => {
      if (item?.type !== "feat") {
        return false;
      }

      const featureId = cleanText(itemFlag(item, MODULE_ID, "featureId"));
      return featureId.endsWith("::paladin-lay-on-hands")
        || normalizeText(item?.name) === "наложение рук";
    }) ?? null;
  }

  #layOnHandsMaxUses(actor, item) {
    const rawMax = item?.system?.uses?.max;
    const numericMax = Math.floor(toNumber(rawMax, 0));
    if (numericMax > 0) {
      return numericMax;
    }

    return Math.max(0, paladinClassLevel(actor) * 5);
  }

  #selectedTargetActor() {
    const targets = Array.from(game.user?.targets ?? []);
    const targetActors = targets
      .map((target) => target?.actor ?? target?.document?.actor ?? null)
      .filter((actor) => actor instanceof Actor);
    if (targetActors.length !== 1) {
      globalThis.ui?.notifications?.warn("Наложение рук: выберите ровно одну цель.");
      return null;
    }

    return targetActors[0];
  }

  async #promptLayOnHandsPoints(actor, item, details) {
    if (typeof this._options.promptLayOnHandsPoints === "function") {
      return this._options.promptLayOnHandsPoints(actor, item, details);
    }

    if (!this.#canPrompt(actor) || typeof Dialog !== "function") {
      return null;
    }

    return new Promise((resolve) => {
      let settled = false;
      const dialog = new Dialog({
        title: "Наложение рук",
        content: `
          <form>
            <p>Осталось в запасе: ${escapeHtml(details.remaining)}. Можно потратить до ${escapeHtml(details.max)}.</p>
            <div class="form-group">
              <label>Сколько хитов восстановить?</label>
              <input type="number" min="1" max="${escapeHtml(details.max)}" value="${escapeHtml(details.max)}" data-lay-on-hands-points>
            </div>
          </form>
        `,
        buttons: {
          confirm: {
            label: "Вылечить",
            callback: (html) => {
              const root = globalThis.HTMLElement && html instanceof HTMLElement ? html : html?.[0];
              const rawValue = root?.querySelector("[data-lay-on-hands-points]")?.value;
              settled = true;
              resolve(clampInteger(rawValue, 1, details.max));
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

  async #confirmPreparedSpellChange(actor, details) {
    if (typeof this._options.confirmPreparedSpellChange === "function") {
      return this._options.confirmPreparedSpellChange(actor, details);
    }

    const content = [
      `Вы завершили продолжительный отдых. Изменить подготовленные заклинания паладина?`,
      `Можно подготовить ${details.preparedCount} закл. до ${details.maxSpellLevel}-го уровня.`
    ].map((line) => `<p>${escapeHtml(line)}</p>`).join("");
    const DialogV2 = foundry.applications?.api?.DialogV2;
    if (typeof DialogV2?.confirm === "function") {
      return DialogV2.confirm({
        window: { title: "Заклинания паладина" },
        content
      });
    }

    if (typeof globalThis.Dialog?.confirm === "function") {
      return globalThis.Dialog.confirm({
        title: "Заклинания паладина",
        content,
        yes: () => true,
        no: () => false,
        defaultYes: false
      });
    }

    return false;
  }

  async #selectPreparedSpellUuids(actor, details) {
    if (typeof this._options.selectPreparedSpellUuids === "function") {
      return this._options.selectPreparedSpellUuids(actor, details);
    }

    const CompendiumBrowser = globalThis.dnd5e?.applications?.CompendiumBrowser ?? null;
    if (typeof CompendiumBrowser?.select !== "function") {
      ui.notifications?.warn("Rebreya: библиотека заклинаний dnd5e недоступна, выбор заклинаний паладина не открыт.");
      return null;
    }

    const result = await CompendiumBrowser.select({
      tab: "spells",
      filters: {
        locked: {
          documentClass: "Item",
          types: new Set(["spell"]),
          additional: {
            level: {
              min: 0,
              max: details.maxSpellLevel
            },
            spelllist: {
              "class:paladin": 1
            }
          }
        }
      },
      selection: {
        min: 1,
        max: details.preparedCount
      }
    });
    return result ? Array.from(result) : null;
  }

  async #fromUuid(uuid) {
    if (typeof this._options.fromUuid === "function") {
      return this._options.fromUuid(uuid);
    }

    return globalThis.fromUuid?.(uuid) ?? null;
  }

  async #applyPreparedSpellSelection(actor, selectedUuids) {
    const selectedDocuments = (await Promise.all(
      Array.from(selectedUuids ?? []).map((uuid) => this.#fromUuid(uuid))
    )).filter((document) => document?.type === "spell");
    const selected = {
      uuids: new Set(selectedDocuments.map((spell) => cleanText(spell.uuid)).filter(Boolean)),
      identifiers: new Set(selectedDocuments.map((spell) => cleanText(spell.system?.identifier)).filter(Boolean)),
      names: new Set(selectedDocuments.map((spell) => normalizeText(spell.name)).filter(Boolean)),
      uuidByIdentifier: new Map(selectedDocuments
        .map((spell) => [cleanText(spell.system?.identifier), cleanText(spell.uuid)])
        .filter(([identifier, uuid]) => identifier && uuid)),
      uuidByName: new Map(selectedDocuments
        .map((spell) => [normalizeText(spell.name), cleanText(spell.uuid)])
        .filter(([name, uuid]) => name && uuid))
    };
    const matchedUuids = new Set();

    for (const item of collectionValues(actor?.items)) {
      if (item?.type !== "spell") {
        continue;
      }

      const shouldPrepare = actorSpellMatchesSelection(item, selected);
      if (shouldPrepare) {
        const matchedUuid = selectedUuidForActorSpell(item, selected);
        if (matchedUuid) {
          matchedUuids.add(matchedUuid);
        }
        const patch = {};
        if (cleanText(item?.system?.sourceClass) !== PALADIN_CLASS_IDENTIFIER) {
          patch["system.sourceClass"] = PALADIN_CLASS_IDENTIFIER;
        }
        if (cleanText(item?.system?.method, "spell") !== "spell") {
          patch["system.method"] = "spell";
        }
        if (toNumber(item?.system?.prepared, 0) !== 1) {
          patch["system.prepared"] = 1;
        }
        if (itemFlag(item, MODULE_ID, "paladinPreparedSpell") !== true) {
          patch[`flags.${MODULE_ID}.paladinPreparedSpell`] = true;
        }
        if (Object.keys(patch).length && typeof item.update === "function") {
          await item.update(patch);
        }
        continue;
      }

      if (isPaladinPreparedSpellItem(item) && toNumber(item?.system?.prepared, 0) !== 0 && typeof item.update === "function") {
        await item.update({ "system.prepared": 0 });
      }
    }

    const itemData = selectedDocuments
      .filter((spell) => !matchedUuids.has(cleanText(spell.uuid)))
      .map((spell) => createSpellData(spell));
    if (itemData.length && typeof actor?.createEmbeddedDocuments === "function") {
      await actor.createEmbeddedDocuments("Item", itemData);
    }
  }
}
