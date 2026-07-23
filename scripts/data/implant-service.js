import { MODULE_ID } from "../constants.js";

const AGGREGATE_EFFECT_NAME = "Импланты";
const AGGREGATE_EFFECT_FLAG = "implantAggregate";
const INSTALLATION_FLAG = "implantInstallation";
const IMPLANT_FLAG = "implant";
const MOUNTED_ARMOR_AUTOMATION = "mounted-armor-ac";
const MYTHIC_RACE_MARKERS = Object.freeze([
  "минотавр",
  "кентавр",
  "леонид",
  "полувеликан",
  "нефилим",
  "пепельн",
  "голем"
]);

function cleanString(value) {
  return String(value ?? "").trim();
}

function normalizeText(value) {
  return cleanString(value)
    .toLocaleLowerCase("ru-RU")
    .replaceAll("ё", "е");
}

function escapeHtml(value) {
  const escape = globalThis.foundry?.utils?.escapeHTML;
  if (typeof escape === "function") return escape(String(value ?? ""));
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function collectionValues(collection) {
  if (Array.isArray(collection)) return [...collection];
  if (Array.isArray(collection?.contents)) return [...collection.contents];
  if (typeof collection?.values === "function") return [...collection.values()];
  if (collection && typeof collection[Symbol.iterator] === "function") return [...collection];
  return [];
}

function getModuleFlag(document, key) {
  if (typeof document?.getFlag === "function") {
    const value = document.getFlag(MODULE_ID, key);
    if (value !== undefined) return value;
  }
  return document?.flags?.[MODULE_ID]?.[key];
}

function clone(value) {
  if (value === undefined) return undefined;
  if (typeof globalThis.structuredClone === "function") return globalThis.structuredClone(value);
  return JSON.parse(JSON.stringify(value));
}

function actorRaceProfile(actor) {
  const raceItems = collectionValues(actor?.items).filter((item) => (
    item?.type === "race" || getModuleFlag(item, "sourceType") === "race"
  ));
  const raceText = raceItems.map((item) => (
    `${item?.name ?? ""} ${getModuleFlag(item, "raceId") ?? ""}`
  )).join(" ");
  const normalized = normalizeText(raceText);
  const raceGroup = normalizeText(
    raceItems.map((item) => getModuleFlag(item, "raceGroup") ?? "").join(" ")
  );
  return {
    synth: normalized.includes("синтет"),
    ironborn: normalized.includes("железорожден"),
    mythic: raceGroup.includes("мифичес")
      || MYTHIC_RACE_MARKERS.some((marker) => normalized.includes(marker))
  };
}

function actorCasterTier(actor) {
  const progressions = collectionValues(actor?.items)
    .filter((item) => item?.type === "class")
    .map((item) => normalizeText(item?.system?.spellcasting?.progression));
  if (progressions.some((progression) => ["full", "pact"].includes(progression))) return 2;
  if (progressions.some((progression) => ["half", "artificer"].includes(progression))) return 1;
  return 0;
}

function mechanicalTypeTier(type) {
  const normalized = normalizeText(type);
  if (normalized.includes("транспорт")) return 4;
  if (normalized.includes("сверхтяж")) return 3;
  if (normalized.includes("военн")) return 2;
  if (normalized.includes("общ")) return 1;
  return 0;
}

function magicalTypeTier(type) {
  const normalized = normalizeText(type);
  if (normalized.includes("титанич")) return 3;
  if (normalized.includes("древн")) return 2;
  if (normalized.includes("волшеб")) return 1;
  return 0;
}

function compatibilityResult(status, label) {
  return Object.freeze({
    status,
    label,
    safe: status === "safe",
    requiresUnion: status === "union",
    impossible: status === "impossible"
  });
}

export function getImplantData(item) {
  const value = getModuleFlag(item, IMPLANT_FLAG);
  return value && typeof value === "object" ? value : null;
}

export function isImplantItem(item) {
  return Boolean(getImplantData(item));
}

export function getImplantInstallation(item) {
  const state = getModuleFlag(item, INSTALLATION_FLAG);
  const implant = getImplantData(item);
  const fallbackPoints = Number(implant?.pointsMin ?? 0);
  return {
    installed: state?.installed === true,
    united: state?.united === true,
    spentPoints: Number.isFinite(Number(state?.spentPoints))
      ? Number(state.spentPoints)
      : fallbackPoints
  };
}

export function getModificationPointCapacity(actor) {
  const proficiency = Math.max(0, Number(actor?.system?.attributes?.prof ?? 0));
  const race = actorRaceProfile(actor);
  return race.synth || race.ironborn
    ? proficiency * 2
    : Math.ceil(proficiency / 2);
}

export function getImplantCompatibility(actor, item) {
  const implant = getImplantData(item) ?? item?.implant ?? {};
  const race = actorRaceProfile(actor);
  if (implant.kind === "magical" || implant.magical === true) {
    const tier = magicalTypeTier(implant.type);
    if (race.synth || race.ironborn) {
      return tier === 0
        ? compatibilityResult("union", "Требуется объединение")
        : compatibilityResult("impossible", "Несовместимо");
    }
    let actorTier = actorCasterTier(actor);
    if (actorTier >= 2 && race.mythic) actorTier = 3;
    if (tier <= actorTier) return compatibilityResult("safe", "Без проблем");
    if (tier === actorTier + 1) return compatibilityResult("union", "Требуется объединение");
    return compatibilityResult("impossible", "Несовместимо");
  }

  const tier = mechanicalTypeTier(implant.type);
  if (tier === 4) {
    return race.ironborn
      ? compatibilityResult("safe", "Без проблем")
      : compatibilityResult("impossible", "Несовместимо");
  }
  const actorTier = race.ironborn ? 2 : race.synth ? 1 : 0;
  if (tier <= actorTier) return compatibilityResult("safe", "Без проблем");
  if (tier === actorTier + 1) return compatibilityResult("union", "Требуется объединение");
  return compatibilityResult("impossible", "Несовместимо");
}

function isInstallable(implant) {
  return implant?.installable !== false
    && implant?.pointsMin !== null
    && implant?.pointsMin !== undefined
    && implant?.pointsMax !== null
    && implant?.pointsMax !== undefined
    && Number.isFinite(Number(implant?.pointsMin))
    && Number.isFinite(Number(implant?.pointsMax));
}

function normalizeSpentPoints(implant, value) {
  const min = Number(implant?.pointsMin ?? 0);
  const max = Number(implant?.pointsMax ?? min);
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric < min || numeric > max) {
    throw new Error(`Недопустимое количество очков для импланта: ${implant?.pointsText ?? `${min}–${max}`}.`);
  }
  return numeric;
}

function isEffective(compatibility, state) {
  return compatibility.status === "safe"
    || (compatibility.status === "union" && state.united === true);
}

export class ImplantService {
  constructor(options = {}) {
    this.options = options;
  }

  registerLongRestSteps(pipeline) {
    if (typeof pipeline?.registerStep !== "function") return false;
    pipeline.registerStep({
      id: "implants.configure",
      label: "Модифицирование",
      order: 250,
      interactive: true,
      isEligible: ({ actor }) => this.hasImplants(actor),
      run: ({ actor, progress }) => this.chooseImplantsAfterLongRest(actor, { progress })
    });
    return true;
  }

  hasImplants(actor) {
    return collectionValues(actor?.items).some(isImplantItem);
  }

  getActorSnapshot(actor) {
    const capacity = getModificationPointCapacity(actor);
    const entries = collectionValues(actor?.items)
      .filter(isImplantItem)
      .map((item) => {
        const implant = getImplantData(item);
        const installation = getImplantInstallation(item);
        const compatibility = getImplantCompatibility(actor, item);
        return {
          itemId: cleanString(item?.id),
          uuid: cleanString(item?.uuid),
          name: cleanString(item?.name),
          img: cleanString(item?.img),
          type: cleanString(implant?.type) || "Без типа",
          kind: implant?.kind === "magical" ? "magical" : "mechanical",
          magical: implant?.magical === true,
          pointsText: cleanString(implant?.pointsText),
          pointsMin: Number(implant?.pointsMin ?? 0),
          pointsMax: Number(implant?.pointsMax ?? implant?.pointsMin ?? 0),
          effect: cleanString(implant?.effect),
          requirements: cleanString(implant?.requirements),
          installable: isInstallable(implant),
          installed: installation.installed,
          united: installation.united,
          spentPoints: installation.spentPoints,
          effective: installation.installed && isEffective(compatibility, installation),
          compatibility
        };
      })
      .sort((left, right) => (
        Number(right.installed) - Number(left.installed)
        || left.name.localeCompare(right.name, "ru")
      ));
    const used = entries
      .filter((entry) => entry.installed)
      .reduce((sum, entry) => sum + entry.spentPoints, 0);
    return {
      capacity,
      used,
      remaining: capacity - used,
      entries,
      installedEntries: entries.filter((entry) => entry.installed),
      availableEntries: entries.filter((entry) => !entry.installed),
      hasImplants: entries.length > 0
    };
  }

  async chooseImplantsAfterLongRest(actor, execution = {}) {
    if (!this.hasImplants(actor)) return { status: "skipped" };
    const snapshot = this.getActorSnapshot(actor);
    const selections = await this.#promptLoadout(actor, snapshot, execution.progress);
    if (!Array.isArray(selections)) return { status: "skipped" };
    await this.applyLoadout(actor, selections);
    return { status: "completed" };
  }

  async applyLoadout(actor, selections) {
    const items = collectionValues(actor?.items).filter(isImplantItem);
    const selectionById = new Map(
      (Array.isArray(selections) ? selections : [])
        .map((selection) => [cleanString(selection?.itemId), selection])
        .filter(([itemId]) => itemId)
    );
    const planned = [];
    let usedPoints = 0;

    for (const item of items) {
      const implant = getImplantData(item);
      const compatibility = getImplantCompatibility(actor, item);
      const selection = selectionById.get(cleanString(item.id));
      const installed = selection?.installed === true;
      const state = {
        installed,
        united: installed && selection?.united === true,
        spentPoints: normalizeSpentPoints(
          implant,
          selection?.spentPoints ?? getImplantInstallation(item).spentPoints
        )
      };
      if (installed && !isInstallable(implant)) {
        throw new Error(`Имплант «${item.name}» пока не содержит полной стоимости установки.`);
      }
      if (installed && compatibility.impossible) {
        throw new Error(`Имплант «${item.name}» несовместим с персонажем.`);
      }
      if (installed) usedPoints += state.spentPoints;
      planned.push({ item, implant, compatibility, state });
    }

    const capacity = getModificationPointCapacity(actor);
    if (usedPoints > capacity) {
      throw new Error(`Недостаточно очков модификации: требуется ${usedPoints}, доступно ${capacity}.`);
    }

    const itemUpdates = planned
      .filter(({ item, state }) => {
        const current = getImplantInstallation(item);
        return current.installed !== state.installed
          || current.united !== state.united
          || current.spentPoints !== state.spentPoints;
      })
      .map(({ item, state }) => ({
        _id: item.id,
        [`flags.${MODULE_ID}.${INSTALLATION_FLAG}`]: state
      }));
    if (itemUpdates.length) {
      await actor.updateEmbeddedDocuments("Item", itemUpdates);
    }
    await this.#syncAggregateEffect(actor, planned);
    return this.getActorSnapshot(actor);
  }

  async #syncAggregateEffect(actor, planned) {
    const effectiveArmorCount = planned.filter(({ implant, compatibility, state }) => (
      state.installed
      && implant?.automationKey === MOUNTED_ARMOR_AUTOMATION
      && isEffective(compatibility, state)
    )).length;
    const addMode = Number(globalThis.CONST?.ACTIVE_EFFECT_MODES?.ADD ?? 2);
    const changes = effectiveArmorCount > 0
      ? [{
          key: "system.attributes.ac.bonus",
          mode: addMode,
          value: String(effectiveArmorCount),
          priority: 20
        }]
      : [];
    const installedItemIds = planned
      .filter(({ state }) => state.installed)
      .map(({ item }) => item.id);
    const effectFlags = {
      [AGGREGATE_EFFECT_FLAG]: true,
      installedItemIds
    };
    const effectData = {
      name: AGGREGATE_EFFECT_NAME,
      img: "icons/svg/upgrade.svg",
      type: "base",
      origin: actor?.uuid ?? null,
      transfer: false,
      disabled: false,
      statuses: [],
      changes
    };
    const effects = collectionValues(actor?.effects);
    const managed = effects.filter((effect) => getModuleFlag(effect, AGGREGATE_EFFECT_FLAG) === true);
    const aggregate = managed[0]
      ?? effects.find((effect) => cleanString(effect?.name) === AGGREGATE_EFFECT_NAME)
      ?? null;
    if (aggregate) {
      await actor.updateEmbeddedDocuments("ActiveEffect", [{
        _id: aggregate.id,
        ...effectData,
        [`flags.${MODULE_ID}`]: effectFlags
      }]);
    }
    else {
      await actor.createEmbeddedDocuments("ActiveEffect", [{
        ...effectData,
        flags: {
          [MODULE_ID]: effectFlags
        }
      }]);
    }
    const duplicateIds = managed.slice(1).map((effect) => effect.id).filter(Boolean);
    if (duplicateIds.length && typeof actor.deleteEmbeddedDocuments === "function") {
      await actor.deleteEmbeddedDocuments("ActiveEffect", duplicateIds);
    }
  }

  async #promptLoadout(actor, snapshot, progress) {
    if (typeof this.options.promptLoadout === "function") {
      return this.options.promptLoadout(actor, clone(snapshot), { progress });
    }
    if (!actor?.isOwner && !globalThis.game?.user?.isGM) return null;
    const DialogV2 = globalThis.foundry?.applications?.api?.DialogV2 ?? globalThis.DialogV2;
    if (typeof DialogV2?.wait !== "function") return null;

    const rows = snapshot.entries.map((entry) => {
      const disabled = !entry.installable || entry.compatibility.impossible;
      const variablePoints = entry.pointsMin !== entry.pointsMax;
      return `
        <li class="item collapsible rm-implant-dialog__item"
            data-implant-row data-item-id="${escapeHtml(entry.itemId)}" data-uuid="${escapeHtml(entry.uuid)}">
          <div class="item-row">
            <label class="rm-implant-dialog__install">
              <input type="checkbox" name="installed" ${entry.installed ? "checked" : ""} ${disabled ? "disabled" : ""}>
              <img class="item-image gold-icon" src="${escapeHtml(entry.img || "icons/svg/item-bag.svg")}" alt="">
              <span class="item-name">
                <strong>${escapeHtml(entry.name)}</strong>
                <small>${escapeHtml(entry.type)} · ${escapeHtml(entry.compatibility.label)}</small>
              </span>
            </label>
            <label class="rm-implant-dialog__points" title="Очки модификации">
              <span>Очки</span>
              <input type="number" name="spentPoints" min="${entry.pointsMin}" max="${entry.pointsMax}"
                     value="${entry.spentPoints}" ${variablePoints ? "" : "readonly"}>
            </label>
            ${entry.compatibility.requiresUnion ? `
              <label class="rm-implant-dialog__union">
                <input type="checkbox" name="united" ${entry.united ? "checked" : ""}>
                <span>Объединение</span>
              </label>
            ` : ""}
          </div>
          <div class="item-summary">
            <p><strong>Требования:</strong> ${escapeHtml(entry.requirements || "—")}</p>
            <p>${escapeHtml(entry.effect || "Описание пока не заполнено.")}</p>
          </div>
        </li>
      `;
    }).join("");
    const title = progress?.title?.("Модифицирование") ?? "Модифицирование";
    const progressHeader = progress?.header?.("Модифицирование") ?? "";
    const content = `
      ${progressHeader}
      <form class="rm-implant-dialog">
        <p>После продолжительного отдыха выберите установленный набор. Закрытие окна пропустит этот шаг.</p>
        <p><strong>Очки модификации:</strong> ${snapshot.used}/${snapshot.capacity}</p>
        <section class="items-list">
          <div class="items-section card">
            <div class="items-header header"><h3 class="item-name">Импланты персонажа</h3></div>
            <ol class="item-list unlist">${rows}</ol>
          </div>
        </section>
      </form>
    `;
    return DialogV2.wait({
      window: { title },
      content,
      buttons: [{
        action: "install",
        label: "Установить",
        icon: "fa-solid fa-screwdriver-wrench",
        default: true,
        callback: (_event, _button, dialog) => Array.from(
          dialog?.element?.querySelectorAll?.("[data-implant-row]") ?? []
        ).map((row) => ({
          itemId: cleanString(row.dataset.itemId),
          installed: row.querySelector('[name="installed"]')?.checked === true,
          united: row.querySelector('[name="united"]')?.checked === true,
          spentPoints: Number(row.querySelector('[name="spentPoints"]')?.value ?? 0)
        }))
      }, {
        action: "cancel",
        label: "Пропустить",
        callback: () => null
      }],
      close: () => null
    });
  }
}
