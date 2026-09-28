function clean(value) {
  return String(value ?? "").trim();
}

function itemsOf(actor) {
  if (Array.isArray(actor?.items?.contents)) return actor.items.contents;
  if (typeof actor?.items?.values === "function") return Array.from(actor.items.values());
  return [];
}

function itemSourceId(item) {
  return clean(item?.flags?.core?.sourceId ?? item?.getFlag?.("core", "sourceId"));
}

function normalizedItemName(value) {
  return clean(value).replace(/\s+/gu, " ").toLocaleLowerCase("ru-RU");
}

function firstRollTotal(value) {
  const roll = Array.isArray(value) ? value[0] : value;
  const total = Number(roll?.total ?? roll);
  if (!Number.isFinite(total)) throw new Error("dnd5e не вернула итог броска.");
  return total;
}

export class StorageTriggerDnd5eAdapter {
  constructor({
    fromUuid = (uuid) => globalThis.fromUuid?.(uuid),
    rollFormula = async (formula) => {
      const roll = await new globalThis.Roll(formula).evaluate();
      return Number(roll.total);
    }
  } = {}) {
    if (typeof fromUuid !== "function" || typeof rollFormula !== "function") {
      throw new TypeError("StorageTriggerDnd5eAdapter requires document and Roll adapters.");
    }
    this.fromUuid = fromUuid;
    this.rollFormula = rollFormula;
  }

  async #actor(context) {
    const actor = await this.fromUuid(clean(context?.characterActorUuid));
    if (actor?.documentName !== "Actor" || actor?.type !== "character") {
      throw new Error("Персонаж триггера недоступен.");
    }
    return actor;
  }

  async #item(context, config) {
    const actor = await this.#actor(context);
    const itemUuid = clean(config?.itemUuid);
    const sourceId = clean(config?.sourceId);
    const itemName = normalizedItemName(config?.itemName);
    if (itemUuid) {
      const resolved = await this.fromUuid(itemUuid);
      return itemsOf(actor).find((item) => item === resolved && clean(item.uuid) === itemUuid) ?? null;
    }
    if (sourceId) return itemsOf(actor).find((item) => itemSourceId(item) === sourceId) ?? null;
    if (itemName) return itemsOf(actor).find((item) => normalizedItemName(item?.name) === itemName) ?? null;
    throw new Error("Для шага предмета нужны itemName, itemUuid или sourceId.");
  }

  async hasItem(context, config) {
    return Boolean(await this.#item(context, config));
  }

  async rollCheck(context, config) {
    const actor = await this.#actor(context);
    const ability = clean(config?.ability);
    const dc = Number(config?.dc);
    if (!ability || !Number.isFinite(dc)) throw new Error("Проверка триггера настроена неверно.");
    const method = config?.kind === "savingThrow" ? "rollSavingThrow" : "rollAbilityCheck";
    if (typeof actor[method] !== "function") throw new Error("dnd5e бросок персонажа недоступен.");
    const total = firstRollTotal(await actor[method](
      { ability, target: dc },
      { configure: false },
      { create: true }
    ));
    return { success: total >= dc, total };
  }

  async consumeItem(context, config) {
    const item = await this.#item(context, config);
    if (!item) throw new Error("Предмет для расходования не найден.");
    const quantity = Number(config?.quantity ?? 1);
    const available = Number(item?.system?.quantity ?? 1);
    if (!Number.isSafeInteger(quantity) || quantity < 1 || !Number.isSafeInteger(available) || available < quantity) {
      throw new Error("Недостаточно предметов для триггера.");
    }
    if (available === quantity) await item.delete();
    else await item.update({ "system.quantity": available - quantity });
    return { success: true, itemUuid: clean(item.uuid), quantity };
  }

  async applyDamage(context, config) {
    const actor = await this.#actor(context);
    const formula = clean(config?.formula);
    const damageType = clean(config?.damageType);
    if (!formula || !damageType || typeof actor.applyDamage !== "function") {
      throw new Error("Урон триггера настроен неверно.");
    }
    const applied = Number(await this.rollFormula(formula));
    if (!Number.isFinite(applied) || applied < 0) throw new Error("Формула урона триггера недопустима.");
    await actor.applyDamage([{ value: applied, type: damageType }], { multiplier: 1 });
    return { success: true, applied, damageType };
  }
}
