import { MODULE_ID } from "../constants.js";

const SORCERER_ADVANCEMENT_ROOT = "sorcerer-rework-v011";
const SORCERY_POINTS_FEATURE_ID = "sorcerer-sorcery-points";
const SORCERY_POINTS_SCALE_ID = "sorcery-points";
const MAXIMUM_SPELL_LEVEL_SCALE_ID = "maximum-spell-level";
const VIRTUAL_SLOT_COSTS = Object.freeze({
  1: 2,
  2: 3,
  3: 5,
  4: 6,
  5: 7,
  6: 9,
  7: 10,
  8: 11,
  9: 13
});
const SORCERY_POINTS_RECOVERY = Object.freeze([{
  period: "lr",
  type: "recoverAll",
  formula: ""
}]);
const COOLDOWNS_FLAG = "sorcererAutomation.virtualSlotCooldowns";
const COOLDOWN_CARD_FLAG = "sorcererAutomation.virtualSlotCooldown";
const HIGH_LEVEL_CASTS_FLAG = "sorcererAutomation.highLevelCasts";
const PREFLIGHT_FLAG = "sorcererAutomationPreflight";
const FINAL_BYPASS_FLAG = "sorcererAutomationBypass";
const REACTION_CHECK_COMPLETE_FLAG = "reactionCheckComplete";
const METAMAGIC_SOURCE_TYPE = "sorcererMetamagic";
const DRACONIC_ANCESTOR_SOURCE_TYPE = "sorcererDraconicAncestor";
const DRACONIC_ELEMENTAL_AFFINITY_PART_ID = "rebreya-draconic-elemental-affinity";
const MAX_EXTENDED_DURATION_SECONDS = 24 * 60 * 60;
const SORCERER_CAST_DIALOG_WIDTH = 720;
const EFFECT_MODE_ADD = globalThis.CONST?.ACTIVE_EFFECT_MODES?.ADD ?? 2;
const EFFECT_MODE_UPGRADE = globalThis.CONST?.ACTIVE_EFFECT_MODES?.UPGRADE ?? 4;
const COMPONENT_PROPERTY_KEYS = Object.freeze(new Set(["vocal", "somatic", "verbal", "s"]));
const DRACONIC_PROTECTION_DAMAGE_TYPES = Object.freeze(new Set(["acid", "cold", "fire", "lightning", "poison"]));
const DAMAGE_TYPE_BY_LABEL = Object.freeze(new Map([
  ["огонь", "fire"],
  ["холод", "cold"],
  ["электричество", "lightning"],
  ["молния", "lightning"],
  ["яд", "poison"],
  ["кислота", "acid"],
  ["fire", "fire"],
  ["cold", "cold"],
  ["lightning", "lightning"],
  ["poison", "poison"],
  ["acid", "acid"]
]));
const METAMAGIC_UI_TEXT = Object.freeze({
  "careful-spell": { name: "Аккуратное заклинание", detail: "Когда вы накладываете заклинание, которое вынуждает других существ совершить спасбросок, вы можете защитить некоторых из них от магического воздействия. Для этого вы тратите 1 единицу чародейства и выбираете существ в количестве, равном вашему модификатору Харизмы (минимум одно существо). Указанные существа автоматически преуспевают в спасброске от данного заклинания." },
  "distant-spell": { name: "Далёкое заклинание", detail: "При накладывании заклинания, дистанция которого 5 футов и более, вы можете потратить 1 единицу чародейства, чтобы удвоить это расстояние.\nПри накладывании заклинания с дистанцией «касание», вы можете потратить 1 единицу чародейства, чтобы увеличить это расстояние до 30 футов." },
  "heightened-spell": { name: "Непреодолимое заклинание", detail: "Когда вы накладываете заклинание, которое вынуждает существо совершить спасбросок для защиты от его эффектов, вы можете потратить 3 единицы чародейства, чтобы одна из целей заклинания совершила первый спасбросок от этого заклинания с помехой." },
  "subtle-spell": { name: "Неуловимое заклинание", detail: "Во время накладывания заклинания вы можете потратить 1 единицу чародейства, чтоб наложить его без вербальных и соматических компонентов." },
  "extended-spell": { name: "Продлённое заклинание", detail: "При накладывании заклинания с длительностью 1 минута или более, вы можете потратить 1 единицу чародейства, чтобы один раз удвоить это время, вплоть до максимального в 24 часа." },
  "twinned-spell": { name: "Удвоенное заклинание", detail: "Если вы используете заклинание, нацеливаемое только на одно существо или объект и не имеющее дистанцию «на себя», вы можете потратить количество единиц чародейства, равное уровню заклинания (1 для заговоров), чтобы нацелиться им на второе существо или объект-цель в пределах дистанции этого заклинания.\nЧтобы применить этот вариант, заклинание не должно быть способно нацеливаться более чем на одну цель на текущем накладываемом уровне. Например, волшебная стрела [magic missile] и палящий луч [scorching ray] не могут быть усилены этой метамагией, а луч холода [ray of frost] и цветной шарик [chromatic orb] — могут." },
  "empowered-spell": { name: "Усиленное заклинание", detail: "При совершении броска урона от заклинания вы можете потратить 1 единицу чародейства, чтобы перебросить несколько костей урона в количестве не больше вашего модификатора Харизмы (минимум одна). Вы должны использовать новое выпавшее значение.\n\tВы можете использовать этот вариант метамагии, даже если вы уже использовали другой вариант метамагии во время накладывания заклинания." },
  "quickened-spell": { name: "Ускоренное заклинание", detail: "Если вы накладываете заклинание со временем накладывания «1 действие», вы можете потратить 2 единицы чародейства, чтобы наложить это заклинание бонусным действием." },
  "seeking-spell": { name: "Ищущее заклинание", detail: "Если вы совершаете бросок атаки для заклинания и промахиваетесь, вы можете потратить 2 единицы чародейства, чтобы перебросить к20, и должны использовать новый бросок.\n\tВы можете использовать этот вариант метамагии, даже если вы уже использовали другой вариант метамагии во время накладывания заклинания." }
});

function cleanText(value, fallback = "") {
  const text = String(value ?? "").trim();
  return text || fallback;
}

function normalizeMatchText(value) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/\u0451/gu, "\u0435")
    .replace(/['"\u2019\u2018\u02BC\u02B9\u2032\u201C\u201D\u00AB\u00BB]/gu, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
}

function toInteger(value, fallback = 0) {
  const numeric = Number(value ?? fallback);
  return Number.isFinite(numeric) ? Math.floor(numeric) : fallback;
}

function getProperty(source, path, fallback = undefined) {
  const value = globalThis.foundry?.utils?.getProperty instanceof Function
    ? globalThis.foundry.utils.getProperty(source, path)
    : String(path ?? "").split(".").reduce((current, key) => current?.[key], source);
  return value === undefined ? fallback : value;
}

function setProperty(target, path, value) {
  if (globalThis.foundry?.utils?.setProperty instanceof Function) {
    globalThis.foundry.utils.setProperty(target, path, value);
    return target;
  }

  const keys = String(path ?? "").split(".").filter(Boolean);
  let cursor = target;
  while (keys.length > 1) {
    const key = keys.shift();
    cursor[key] ??= {};
    cursor = cursor[key];
  }
  cursor[keys[0]] = value;
  return target;
}

function deepClone(value) {
  if (globalThis.foundry?.utils?.deepClone instanceof Function) {
    return globalThis.foundry.utils.deepClone(value);
  }

  return JSON.parse(JSON.stringify(value));
}

function updateSource(document, patch) {
  if (!document || !patch || !Object.keys(patch).length) {
    return document;
  }

  if (typeof document.updateSource === "function") {
    document.updateSource(patch);
    return document;
  }

  for (const [path, value] of Object.entries(patch)) {
    setProperty(document, path, value instanceof Set ? new Set(value) : deepClone(value));
  }
  return document;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function plainTextFromHtml(value) {
  return String(value ?? "")
    .replace(/<\s*br\s*\/?>/giu, "\n")
    .replace(/<\s*\/p\s*>\s*<\s*p[^>]*>/giu, "\n")
    .replace(/<[^>]*>/gu, "")
    .replace(/&nbsp;/giu, " ")
    .replace(/&lt;/giu, "<")
    .replace(/&gt;/giu, ">")
    .replace(/&quot;/giu, "\"")
    .replace(/&#039;|&apos;/giu, "'")
    .replace(/&amp;/giu, "&")
    .replace(/[ \t]+\n/gu, "\n")
    .replace(/\n{3,}/gu, "\n\n")
    .trim();
}

function dialogV2() {
  return globalThis.foundry?.applications?.api?.DialogV2 ?? globalThis.DialogV2 ?? null;
}

function formValues(form, name) {
  const elements = form?.elements?.[name];
  if (!elements) {
    return [];
  }

  if (elements?.tagName === "SELECT" && elements.multiple) {
    return Array.from(elements.selectedOptions ?? [])
      .map((option) => cleanText(option?.value))
      .filter(Boolean);
  }
  const inputs = typeof elements.length === "number" && !elements.tagName
    ? Array.from(elements)
    : [elements];
  return inputs
    .filter((input) => input?.checked !== false && input?.selected !== false)
    .map((input) => cleanText(input?.value))
    .filter(Boolean);
}

function formMetamagicCosts(form, ids = []) {
  return Object.fromEntries(ids.map((id) => {
    const element = form?.elements?.[`metamagicCost.${id}`];
    const input = typeof element?.length === "number" && !element?.tagName
      ? Array.from(element).find((entry) => entry?.value !== undefined)
      : element;
    return [id, toInteger(input?.value, 0)];
  }).filter(([, cost]) => cost > 0));
}

function clampInteger(value, min, max) {
  return Math.min(Math.max(toInteger(value, min), min), max);
}

function metamagicCostMode(option = {}) {
  const mode = cleanText(option.costMode).toLowerCase();
  if (mode === "variable") return "variable";
  return option.cost === "spellLevel" ? "spellLevel" : "fixed";
}

function metamagicMinCost(option = {}) {
  if (metamagicCostMode(option) === "fixed") {
    return Math.max(0, toInteger(option.minCost ?? option.cost, option.cost ?? 0));
  }
  return Math.max(1, toInteger(option.minCost, 1));
}

function metamagicMaxCost(option = {}, spellLevel = 1) {
  if (metamagicCostMode(option) === "spellLevel") {
    return Math.max(1, toInteger(spellLevel, 1));
  }
  return Math.max(metamagicMinCost(option), toInteger(option.maxCost ?? option.cost, option.cost ?? 1));
}

function metamagicCostForOption(option = {}, spellLevel = 1, requestedCost = undefined) {
  const mode = metamagicCostMode(option);
  const discount = Math.max(0, toInteger(option.discount, 0));
  const applyDiscount = (cost) => discount > 0 ? Math.max(1, cost - discount) : cost;
  if (mode === "spellLevel") {
    return applyDiscount(Math.max(1, toInteger(spellLevel, 1)));
  }
  if (mode === "variable") {
    const min = metamagicMinCost(option);
    const max = metamagicMaxCost(option, spellLevel);
    return applyDiscount(clampInteger(requestedCost ?? option.selectedCost ?? min, min, max));
  }
  return applyDiscount(Math.max(0, toInteger(option.cost, 0)));
}

function metamagicDescription(item) {
  return cleanText(plainTextFromHtml(
    item?.system?.description?.value
      ?? item?.system?.description?.chat
      ?? item?.description?.value
      ?? item?.description
  ));
}

function metamagicDisplayText(option = {}) {
  const known = METAMAGIC_UI_TEXT[option.id];
  return {
    name: cleanText(known?.name, option.label ?? option.id),
    detail: cleanText(known?.detail, option.detail)
  };
}

function metamagicSummary(meta = {}, spellLevel = 1) {
  return (meta.options ?? []).map((option) => {
    const text = metamagicDisplayText(option);
    return {
      id: option.id,
      name: text.name,
      cost: metamagicCostForOption(option, spellLevel, option.selectedCost),
      stacking: option.stacking,
      automation: option.automation
    };
  });
}

function sorcererCastDialogRoot(...candidates) {
  const queue = [...candidates];
  while (queue.length) {
    const candidate = queue.shift();
    if (!candidate) continue;
    if (candidate.querySelector instanceof Function) return candidate;
    if (candidate.element) queue.push(candidate.element);
    if (candidate.html) queue.push(candidate.html);
    if (candidate[0]) queue.push(candidate[0]);
  }
  return null;
}

function selectedOptionForLevel(level) {
  return level?.selectedOptions?.[0]
    ?? (typeof level?.selectedIndex === "number" ? level?.options?.[level.selectedIndex] : null)
    ?? null;
}

function fitSorcererCastDialogWindow(container) {
  const appWindow = container?.closest?.(".application, .window-app");
  if (!appWindow?.style) {
    return;
  }
  appWindow.style.width = `${SORCERER_CAST_DIALOG_WIDTH}px`;
  appWindow.style.maxWidth = `min(${SORCERER_CAST_DIALOG_WIDTH}px, calc(100vw - 2rem))`;
}

export function updateSorcererCastDialogControls(root) {
  const container = root?.matches?.("[data-sorcerer-cast-dialog]")
    ? root
    : root?.querySelector?.("[data-sorcerer-cast-dialog]");
  if (!container) {
    return false;
  }

  const level = container.querySelector("[name=spellLevel]");
  const option = selectedOptionForLevel(level);
  const selectedLevel = toInteger(option?.value ?? level?.value, 0);
  const castingMode = cleanText(
    container.querySelector("[name=castingMode]")?.value,
    selectedLevel > 0 ? "sorcery" : "normal"
  );
  const usesSorcerySlot = castingMode === "sorcery" && selectedLevel > 0;
  const consume = container.querySelector("[name=consumeResource]");
  const spend = !consume || consume.checked !== false;
  const inputs = Array.from(container.querySelectorAll("input[name=metamagic]"));
  const selectedBase = inputs.find((input) => input.checked && input.dataset.stacking !== "additive");
  const selectedAdditive = inputs.find((input) => input.checked && input.dataset.stacking === "additive");

  for (const input of inputs) {
    const label = input.closest?.(".rebreya-sorcerer-option");
    const min = input.dataset.costMode === "fixed"
      ? Math.max(0, toInteger(input.dataset.minCost, input.dataset.cost ?? 0))
      : Math.max(1, toInteger(input.dataset.minCost, 1));
    const max = Math.max(min, toInteger(input.dataset.maxCost, input.dataset.cost ?? min));
    const discount = Math.max(0, toInteger(input.dataset.discount, 0));
    const applyDiscount = (cost) => discount > 0 ? Math.max(1, cost - discount) : cost;
    const slider = label?.querySelector?.("[data-metamagic-cost-slider]");
    const requestedCost = slider ? slider.value : input.dataset.cost;
    const currentCost = input.dataset.costMode === "spellLevel"
      ? applyDiscount(Math.max(1, selectedLevel))
      : input.dataset.costMode === "variable"
        ? applyDiscount(clampInteger(requestedCost, min, max))
        : applyDiscount(Math.max(0, toInteger(input.dataset.cost, 0)));
    input.dataset.currentCost = String(currentCost);
    if (slider) {
      slider.value = String(currentCost);
    }
    const costLabels = [
      label?.querySelector?.("[data-metamagic-cost-label]"),
      label?.querySelector?.("[data-metamagic-cost-output]")
    ].filter(Boolean);
    for (const costLabel of costLabels) {
      costLabel.textContent = String(currentCost);
    }

    const locked = input.dataset.stacking === "additive"
      ? Boolean(selectedAdditive && input !== selectedAdditive)
      : Boolean(selectedBase && input !== selectedBase);
    input.disabled = locked;
    if (label) {
      label.classList?.toggle?.("is-locked", locked);
      label.setAttribute?.("aria-disabled", locked ? "true" : "false");
    }
  }

  const checkedIds = inputs.filter((input) => input.checked).map((input) => input.value);
  for (const row of Array.from(container.querySelectorAll("[data-metamagic-fields]"))) {
    const ids = cleanText(row.dataset.metamagicFields).split(/\s+/u).filter(Boolean);
    row.hidden = !ids.some((id) => checkedIds.includes(id));
  }

  const requiresExhaustion = usesSorcerySlot && (
    option?.dataset?.sorcererExhaustion === "true"
    || level?.dataset?.sorcererExhaustion === "true"
  );
  const exhaustionRow = container.querySelector("[data-sorcerer-exhaustion-row]");
  let exhaustionOverride = false;
  if (exhaustionRow) {
    const exhaustion = exhaustionRow.querySelector?.("input");
    exhaustionRow.hidden = !requiresExhaustion;
    if (!requiresExhaustion) {
      if (exhaustion) exhaustion.checked = false;
    }
    exhaustionOverride = requiresExhaustion && exhaustion?.checked === true;
  }
  const cooldownBlocked = requiresExhaustion && !exhaustionOverride;
  const blocked = container.querySelector("[data-sorcerer-blocked]");
  if (blocked) {
    blocked.hidden = !cooldownBlocked;
    blocked.textContent = cooldownBlocked
      ? "Лимит чародейского каста активен: выберите обычный каст или разрешите истощение."
      : "";
  }

  const slotCost = spend && usesSorcerySlot
    ? toInteger(option?.dataset?.sorcererCost ?? level?.dataset?.sorcererCost, 0)
    : 0;
  const metamagicCost = spend
    ? inputs.filter((input) => input.checked).reduce((total, input) => total + toInteger(input.dataset.currentCost ?? input.dataset.cost, 0), 0)
    : 0;
  const total = container.querySelector("[data-sorcerer-total]");
  const totalCost = slotCost + metamagicCost;
  if (total) {
    total.textContent = String(totalCost);
  }
  const availablePoints = Math.max(0, toInteger(container.dataset.sorcererAvailablePoints, 0));
  const appWindow = container.closest?.(".application, .window-app");
  const castButton = appWindow?.querySelector?.('[data-action="cast"]');
  if (castButton) {
    castButton.disabled = (spend && totalCost > availablePoints) || cooldownBlocked;
  }
  return true;
}

export function bindSorcererCastDialogControls(...candidates) {
  const root = sorcererCastDialogRoot(...candidates);
  if (!root) {
    return false;
  }
  const containers = root.matches?.("[data-sorcerer-cast-dialog]")
    ? [root]
    : Array.from(root.querySelectorAll?.("[data-sorcerer-cast-dialog]") ?? []);
  for (const container of containers) {
    fitSorcererCastDialogWindow(container);
    if (!container.dataset.sorcererControlsBound) {
      const refresh = () => updateSorcererCastDialogControls(container);
      container.addEventListener?.("change", refresh);
      container.addEventListener?.("input", refresh);
      container.dataset.sorcererControlsBound = "true";
    }
    updateSorcererCastDialogControls(container);
  }
  return containers.length > 0;
}

function tokenUuid(target) {
  return cleanText(target?.document?.uuid ?? target?.uuid ?? target?.actor?.uuid ?? target);
}

function targetLabel(target) {
  return cleanText(target?.name ?? target?.document?.name ?? target?.actor?.name ?? tokenUuid(target), "Target");
}

function availableTargets({ selectedOnly = false } = {}) {
  const selected = collectionValues(globalThis.game?.user?.targets);
  const candidates = selectedOnly
    ? selected
    : [...selected, ...collectionValues(globalThis.canvas?.tokens?.placeables)];
  const seen = new Set();
  return candidates.reduce((targets, target) => {
    const uuid = tokenUuid(target);
    if (!uuid || seen.has(uuid) || !(target?.actor ?? target?.document?.actor ?? target?.type === "Actor")) {
      return targets;
    }
    seen.add(uuid);
    targets.push({ uuid, label: targetLabel(target) });
    return targets;
  }, []);
}

function damageDieChoices(activity) {
  const parts = activity?.damage?.parts ?? activity?.system?.damage?.parts ?? activity?.item?.system?.damage?.parts ?? [];
  return Array.from(parts ?? []).flatMap((part, partIndex) => {
    const formula = cleanText(part?.formula ?? part?.[0]);
    const partId = cleanText(part?._id ?? part?.id, String(partIndex));
    let dieIndex = 0;
    return Array.from(formula.matchAll(/(\d*)d\d+/giu)).flatMap((match) => {
      const count = Math.max(1, toInteger(match[1] || 1, 1));
      return Array.from({ length: count }, () => ({
        id: `${partId}:${dieIndex}`,
        label: `${formula || "damage"} #${dieIndex + 1}`,
        partIndex,
        dieIndex: dieIndex++
      }));
    });
  });
}

function normalizedDamageDice(activity, values) {
  const valid = new Map(damageDieChoices(activity).map((choice) => [choice.id, choice]));
  const ids = Array.from(new Set((values ?? []).map((value) => cleanText(value)).filter(Boolean)));
  if (!ids.length || ids.some((id) => !valid.has(id))) {
    return null;
  }
  return ids.map((id) => valid.get(id));
}

function notifyWarning(message) {
  globalThis.ui?.notifications?.warn?.(message);
}

async function documentFromUuid(uuid) {
  if (typeof globalThis.fromUuid === "function") {
    return globalThis.fromUuid(uuid);
  }
  if (typeof globalThis.fromUuidSync === "function") {
    return globalThis.fromUuidSync(uuid);
  }
  return null;
}

function targetActor(document) {
  return document?.actor ?? document?.document?.actor ?? (document?.type === "Actor" ? document : null);
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

function documentFlag(document, scope, key) {
  if (typeof document?.getFlag === "function") {
    try {
      const value = document.getFlag(scope, key);
      if (value !== undefined) {
        return value;
      }
    }
    catch (_error) {
      // Fall through to source flags for plain documents and malformed hooks.
    }
  }

  return getProperty(document, `flags.${scope}.${key}`, undefined);
}

function rawFeatureId(item) {
  return cleanText(documentFlag(item, MODULE_ID, "featureId"))
    .split("::")
    .at(-1) ?? "";
}

function isCurrentUserHook(userId) {
  return !userId || !globalThis.game?.user?.id || userId === globalThis.game.user.id;
}

function actorFrom(subject) {
  return subject?.actor ?? subject?.item?.actor ?? subject?.item?.parent ?? null;
}

function classIdentifier(item) {
  return cleanText(
    item?.system?.identifier
    ?? documentFlag(item, MODULE_ID, "classIdentifier")
  );
}

function isSorcererClassItem(item) {
  return item?.type === "class" && classIdentifier(item) === SORCERER_ADVANCEMENT_ROOT;
}

function actorHasSorcererClass(actor) {
  return collectionValues(actor?.items).some(isSorcererClassItem);
}

function isSorcererSpellActivity(activity) {
  const item = activity?.item;
  if (item?.type !== "spell") {
    return false;
  }
  return actorHasSorcererClass(actorFrom(activity));
}

function scaleValue(actor, scaleId) {
  const rawValue = getProperty(actor, `system.scale.${SORCERER_ADVANCEMENT_ROOT}.${scaleId}`, 0);
  return Math.max(0, toInteger(rawValue?.value ?? rawValue, 0));
}

function isSorceryPointsItem(item) {
  return rawFeatureId(item) === SORCERY_POINTS_FEATURE_ID
    || cleanText(item?.system?.identifier) === SORCERY_POINTS_FEATURE_ID;
}

function pointsFeature(actor) {
  return collectionValues(actor?.items).find(isSorceryPointsItem) ?? null;
}

function spellBaseLevel(activity) {
  const item = activity?.item;
  return Math.max(0, toInteger(
    activity?.spellLevel
    ?? activity?.system?.level
    ?? item?.system?.level?.value
    ?? item?.system?.level,
    0
  ));
}

function spellIdentifier(activity) {
  const item = activity?.item;
  return cleanText(
    item?.system?.identifier
    ?? item?.identifier
    ?? item?.id
    ?? item?._id
    ?? item?.uuid,
    "spell"
  );
}

function spellComponents(activity) {
  return deepClone(activity?.components ?? activity?.system?.components ?? activity?.item?.system?.components ?? {});
}

function sharedSpellComponents(activity, overrides = {}) {
  const components = spellComponents(activity);
  return {
    verbal: overrides.verbal ?? (components.verbal === true || components.vocal === true || components.v === true),
    somatic: overrides.somatic ?? (components.somatic === true || components.s === true),
    material: overrides.material ?? (components.material === true || components.m === true)
  };
}

function withoutVocalSomaticProperties(properties) {
  if (properties instanceof Set) {
    return new Set(Array.from(properties).filter((property) => !COMPONENT_PROPERTY_KEYS.has(cleanText(property))));
  }
  if (Array.isArray(properties)) {
    return properties.filter((property) => !COMPONENT_PROPERTY_KEYS.has(cleanText(property)));
  }
  if (properties && typeof properties === "object") {
    const adjusted = { ...properties };
    for (const key of COMPONENT_PROPERTY_KEYS) {
      delete adjusted[key];
    }
    return adjusted;
  }
  return undefined;
}

function spellRange(activity) {
  const range = activity?.range ?? activity?.system?.range ?? activity?.item?.system?.range ?? {};
  return {
    value: Math.max(0, toInteger(range?.value ?? range, 0)),
    units: cleanText(range?.units, "ft").toLowerCase()
  };
}

function spellDuration(activity) {
  const duration = activity?.duration ?? activity?.system?.duration ?? activity?.item?.system?.duration ?? {};
  return {
    value: Math.max(0, toInteger(duration?.value ?? duration, 0)),
    units: cleanText(duration?.units, "inst").toLowerCase()
  };
}

function durationSeconds({ value, units }) {
  const multipliers = {
    round: 6,
    rounds: 6,
    turn: 6,
    turns: 6,
    minute: 60,
    minutes: 60,
    hour: 3600,
    hours: 3600,
    day: 86400,
    days: 86400
  };
  return value * (multipliers[units] ?? 0);
}

function durationFromSeconds(seconds, preferredUnits) {
  const normalizedSeconds = Math.min(MAX_EXTENDED_DURATION_SECONDS, Math.max(0, seconds));
  const multipliers = {
    round: 6,
    rounds: 6,
    turn: 6,
    turns: 6,
    minute: 60,
    minutes: 60,
    hour: 3600,
    hours: 3600,
    day: 86400,
    days: 86400
  };
  const multiplier = multipliers[preferredUnits] ?? 0;
  if (multiplier && normalizedSeconds % multiplier === 0) {
    return { value: normalizedSeconds / multiplier, units: preferredUnits };
  }
  if (normalizedSeconds % 3600 === 0) {
    return { value: normalizedSeconds / 3600, units: "hour" };
  }
  return { value: normalizedSeconds / 60, units: "minute" };
}

function spellHasSave(activity) {
  const save = activity?.save ?? activity?.system?.save ?? activity?.item?.system?.save ?? {};
  return Boolean(cleanText(save?.ability ?? save?.abilityId ?? save?.type));
}

function spellTargetCount(activity) {
  const target = activity?.target ?? activity?.system?.target ?? activity?.item?.system?.target ?? {};
  return Math.max(0, toInteger(target?.affects?.count ?? target?.count ?? target?.value, 0));
}

function spellActivation(activity) {
  const activation = activity?.activation ?? activity?.system?.activation ?? activity?.item?.system?.activation ?? {};
  return {
    type: cleanText(activation?.type).toLowerCase(),
    value: Math.max(0, toInteger(activation?.value, 1))
  };
}

function spellHasDamage(activity) {
  const damage = activity?.damage ?? activity?.system?.damage ?? activity?.item?.system?.damage ?? {};
  return Array.isArray(damage?.parts) && damage.parts.length > 0;
}

function spellDamageParts(activity) {
  const parts = activity?.damage?.parts ?? activity?.system?.damage?.parts ?? activity?.item?.system?.damage?.parts ?? [];
  return Array.isArray(parts) ? deepClone(parts) : [];
}

function normalizedDamageType(value) {
  const text = cleanText(value).toLowerCase();
  return DAMAGE_TYPE_BY_LABEL.get(text) ?? text;
}

function damagePartType(part = {}) {
  return normalizedDamageType(part?.types?.[0] ?? part?.[1] ?? part?.type ?? part?.damageType);
}

function damageBonusSource(bonus = {}) {
  return cleanText(bonus.source ?? bonus.id ?? bonus.flavor);
}

function damageBonusFlavor(bonus = {}) {
  const source = damageBonusSource(bonus);
  if (source === "draconic-elemental-affinity") {
    return "Родство со стихией";
  }
  if (source === "draconic-dragon-spell") {
    return "Драконье заклятье";
  }
  return cleanText(bonus.flavor, "Драконье заклятье");
}

function damageRollConfigHasBonus(rollConfig = {}, bonus = {}) {
  const source = damageBonusSource(bonus);
  if (!source) {
    return false;
  }
  return (rollConfig.rolls ?? []).some((roll) => (
    cleanText(roll?.options?.rebreyaDamageBonusSource) === source
      || cleanText(roll?.options?.[MODULE_ID]?.damageBonusSource) === source
  ));
}

function firstSpellDamageType(activity) {
  return spellDamageParts(activity).map(damagePartType).find(Boolean) ?? "";
}

function spellDamageTypes(activity) {
  return new Set(spellDamageParts(activity).map(damagePartType).filter(Boolean));
}

function spellHasDamageType(activity, damageType) {
  const type = normalizedDamageType(damageType);
  return Boolean(type && spellDamageTypes(activity).has(type));
}

function firstAllowedSpellDamageType(activity, allowedTypes) {
  const allowed = allowedTypes instanceof Set
    ? allowedTypes
    : new Set(Array.from(allowedTypes ?? []).map(normalizedDamageType));
  return spellDamageParts(activity).map(damagePartType).find((type) => allowed.has(type)) ?? "";
}

function spellDamagePartWithType(part, damageType) {
  const type = normalizedDamageType(damageType);
  const adjusted = deepClone(part);
  if (Array.isArray(adjusted)) {
    adjusted[1] = type;
    return adjusted;
  }

  adjusted.types = [type];
  if (Object.hasOwn(adjusted, "type")) adjusted.type = type;
  if (Object.hasOwn(adjusted, "damageType")) adjusted.damageType = type;
  if (adjusted.custom && typeof adjusted.custom === "object" && Object.hasOwn(adjusted.custom, "type")) {
    adjusted.custom.type = type;
  }
  return adjusted;
}

function replaceSpellDamageTypes(activity, damageType) {
  const parts = spellDamageParts(activity).map((part) => spellDamagePartWithType(part, damageType));
  updateSource(activity, {
    "damage.parts": parts,
    "system.damage.parts": parts
  });
  updateSource(activity?.item, {
    "system.damage.parts": parts
  });
  return parts;
}

function draconicAncestorDamageType(actor) {
  const ancestor = collectionValues(actor?.items)
    .find((item) => cleanText(documentFlag(item, MODULE_ID, "sourceType")) === DRACONIC_ANCESTOR_SOURCE_TYPE);
  return normalizedDamageType(documentFlag(ancestor, MODULE_ID, "damageType"));
}

function actorHasFeatureNamed(actor, name) {
  const normalized = normalizeMatchText(name);
  return collectionValues(actor?.items).some((item) => (
    normalizeMatchText(item?.name) === normalized
      || normalizeMatchText(documentFlag(item, MODULE_ID, "featureId")) === normalized
      || normalizeMatchText(item?.system?.identifier) === normalized
  ));
}

function actorHasFeatureId(actor, featureId) {
  const normalized = normalizeMatchText(featureId);
  return collectionValues(actor?.items).some((item) => (
    normalizeMatchText(documentFlag(item, MODULE_ID, "featureId")) === normalized
      || normalizeMatchText(item?.system?.identifier) === normalized
  ));
}

function temporaryMetamagicEffectData(activity, { name, kind, changes, specialDuration, meta = {} } = {}) {
  const item = activity?.item;
  const origin = cleanText(item?.uuid ?? activity?.uuid);
  return {
    name,
    img: cleanText(item?.img, "icons/svg/aura.svg"),
    icon: cleanText(item?.img, "icons/svg/aura.svg"),
    origin: origin || null,
    disabled: false,
    transfer: false,
    changes: deepClone(changes ?? []),
    duration: {
      rounds: 1,
      turns: 1,
      startRound: currentRound(),
      startTurn: Math.max(0, toInteger(globalThis.game?.combat?.turn, 0))
    },
    flags: {
      dae: { specialDuration: [...(specialDuration ?? [])] },
      [MODULE_ID]: {
        sorcererAutomation: {
          kind,
          ...deepClone(meta)
        }
      }
    }
  };
}

function draconicProtectionEffectData(activity, damageType) {
  const type = normalizedDamageType(damageType);
  return temporaryMetamagicEffectData(activity, {
    name: "Драконья защита",
    kind: "draconicDragonProtection",
    changes: [{
      key: "system.traits.dr.value",
      mode: EFFECT_MODE_ADD,
      value: type,
      priority: 20
    }],
    specialDuration: ["turnStartSource", "combatEnd"],
    meta: { damageType: type }
  });
}

function draconicDragonWingEffectData(activity, spent) {
  const cost = Math.max(0, toInteger(spent, 0));
  const flySpeed = cost * 10;
  return temporaryMetamagicEffectData(activity, {
    name: "Крыло дракона",
    kind: "draconicDragonWing",
    changes: [{
      key: "system.attributes.movement.fly",
      mode: EFFECT_MODE_UPGRADE,
      value: String(flySpeed),
      priority: 20
    }],
    specialDuration: ["turnEndSource", "combatEnd"],
    meta: { flySpeed, cost }
  });
}

function manaStormEffectData(activity, spellLevel) {
  const damage = Math.max(1, toInteger(spellLevel, 1));
  return temporaryMetamagicEffectData(activity, {
    name: "Мана-шторм",
    kind: "advancedManaStorm",
    changes: [],
    specialDuration: ["combatEnd"],
    meta: {
      radius: 10,
      damage,
      damageType: "force"
    }
  });
}

async function createActorEffects(actor, effects = []) {
  const rows = (effects ?? []).filter(Boolean).map((effect) => {
    const data = deepClone(effect);
    delete data._id;
    return data;
  });
  if (!rows.length || typeof actor?.createEmbeddedDocuments !== "function") {
    return [];
  }
  return actor.createEmbeddedDocuments("ActiveEffect", rows);
}

async function deleteActorEffects(actor, effects = []) {
  const documents = collectionValues(effects).filter(Boolean);
  const ids = documents.map((effect) => cleanText(effect?.id ?? effect?._id)).filter(Boolean);
  if (ids.length && typeof actor?.deleteEmbeddedDocuments === "function") {
    await actor.deleteEmbeddedDocuments("ActiveEffect", ids);
    return true;
  }

  await Promise.all(documents
    .filter((effect) => typeof effect?.delete === "function")
    .map((effect) => effect.delete()));
  return documents.length > 0;
}

function metamagicDamagePart({ id, formula, damageType }) {
  const safeFormula = cleanText(formula);
  const safeDamageType = normalizedDamageType(damageType);
  return {
    _id: cleanText(id, "rebreya-metamagic-damage"),
    formula: safeFormula,
    types: safeDamageType ? [safeDamageType] : [],
    custom: {
      enabled: true,
      formula: safeFormula
    }
  };
}

function appendSpellDamagePart(activity, part) {
  const safePart = deepClone(part);
  const nextParts = [
    ...spellDamageParts(activity).filter((entry) => cleanText(entry?._id ?? entry?.id) !== cleanText(safePart._id)),
    safePart
  ];
  updateSource(activity, {
    "damage.parts": nextParts,
    "system.damage.parts": nextParts
  });
  updateSource(activity?.item, {
    "system.damage.parts": nextParts
  });
  return safePart;
}

function spellHasAttack(activity) {
  const attack = activity?.attack ?? activity?.system?.attack ?? activity?.item?.system?.attack ?? null;
  return Boolean(attack && typeof attack === "object");
}

function charismaModifier(actor) {
  return Math.max(1, toInteger(actor?.system?.abilities?.cha?.mod ?? actor?.system?.abilities?.cha?.modifier, 1));
}

function metamagicOptions(actor) {
  const hasTranscendence = actorHasFeatureNamed(actor, "Трансцендентность")
    || actorHasFeatureId(actor, "sorcerer-transcendence");
  const byId = new Map();
  for (const item of collectionValues(actor?.items)
    .filter((entry) => cleanText(documentFlag(entry, MODULE_ID, "sourceType")) === METAMAGIC_SOURCE_TYPE)
  ) {
    const cost = documentFlag(item, MODULE_ID, "cost");
    const costMode = cleanText(documentFlag(item, MODULE_ID, "costMode")).toLowerCase();
    const minCost = costMode === "variable" || cost === "spellLevel"
      ? Math.max(1, toInteger(documentFlag(item, MODULE_ID, "minCost"), 1))
      : Math.max(0, toInteger(documentFlag(item, MODULE_ID, "minCost") ?? cost, cost ?? 0));
    const maxCost = cost === "spellLevel"
      ? undefined
      : Math.max(minCost, toInteger(documentFlag(item, MODULE_ID, "maxCost") ?? cost, cost ?? minCost));
    const id = cleanText(documentFlag(item, MODULE_ID, "metamagicId") ?? item?.system?.identifier);
    if (!id) {
      continue;
    }

    const existing = byId.get(id);
    if (existing) {
      existing.ownedCount += 1;
      continue;
    }

    byId.set(id, {
      id,
      label: cleanText(item?.name, documentFlag(item, MODULE_ID, "metamagicId") ?? item?.system?.identifier),
      detail: metamagicDescription(item),
      cost,
      costMode,
      minCost,
      maxCost,
      automation: cleanText(documentFlag(item, MODULE_ID, "metamagicAutomation") ?? documentFlag(item, MODULE_ID, "automation")),
      stacking: cleanText(documentFlag(item, MODULE_ID, "stacking"), "base").toLowerCase(),
      item,
      ownedCount: 1
    });
  }

  return Array.from(byId.values()).map((option) => {
    if (hasTranscendence && option.ownedCount > 1) {
      return {
        ...option,
        discount: 1,
        stacking: "additive",
        transcendentDiscount: true
      };
    }
    return option;
  });
}

function selectedTargetUuids(value) {
  const targets = Array.isArray(value) ? value : value ? collectionValues(value) : [];
  return targets.map((target) => cleanText(target?.uuid ?? target?.id ?? target)).filter(Boolean);
}

function isLongRest(result = {}, config = {}) {
  if (result?.longRest === true || config?.longRest === true) {
    return true;
  }

  return [result?.type, result?.restType, config?.type, config?.restType]
    .map((value) => cleanText(value).toLowerCase())
    .includes("long");
}

function currentRound() {
  return Math.max(0, toInteger(globalThis.game?.combat?.round, 0));
}

function hasOwnerTurnCooldown(record) {
  return Boolean(record && typeof record === "object"
    && Object.hasOwn(record, "remaining")
    && Number.isFinite(Number(record.remaining)));
}

function cooldownRemaining(record) {
  return Math.max(0, toInteger(record?.remaining, 0));
}

function cooldownIsActive(record) {
  if (hasOwnerTurnCooldown(record)) {
    return cooldownRemaining(record) > 0;
  }
  return toInteger(record?.expiresAtRound, 0) > currentRound();
}

function cooldownCardMetadata(actor, cooldownKey, remaining) {
  const actorUuid = cleanText(actor?.uuid);
  const actorId = cleanText(actor?.id ?? actor?._id);
  const key = cleanText(cooldownKey);
  if (!key || (!actorUuid && !actorId)) {
    return null;
  }
  return { actorUuid, actorId, cooldownKey: key, remaining: Math.max(0, toInteger(remaining, 0)) };
}

function cooldownCardFlag(message) {
  let value;
  if (typeof message?.getFlag === "function") {
    value = message.getFlag(MODULE_ID, COOLDOWN_CARD_FLAG);
  }
  value ??= message?.flags?.[MODULE_ID]?.[COOLDOWN_CARD_FLAG]
    ?? getProperty(message, `flags.${MODULE_ID}.${COOLDOWN_CARD_FLAG}`, undefined);
  if (!value || typeof value !== "object") {
    return null;
  }

  const cooldownKey = cleanText(value.cooldownKey);
  const actorUuid = cleanText(value.actorUuid);
  const actorId = cleanText(value.actorId);
  if (!cooldownKey || (!actorUuid && !actorId)) {
    return null;
  }
  return { actorUuid, actorId, cooldownKey, remaining: Math.max(0, toInteger(value.remaining, 0)) };
}

function spellCastCardFlag(message) {
  let value;
  if (typeof message?.getFlag === "function") {
    value = message.getFlag(MODULE_ID, "spellCast");
  }
  value ??= message?.flags?.[MODULE_ID]?.spellCast
    ?? getProperty(message, `flags.${MODULE_ID}.spellCast`, undefined);
  if (!value || typeof value !== "object") {
    return null;
  }
  const metamagic = Array.isArray(value.metamagic) ? value.metamagic : [];
  const components = value.components && typeof value.components === "object" ? value.components : null;
  if (!metamagic.length && !components) {
    return null;
  }
  return {
    ...value,
    metamagic,
    components
  };
}

function rollConfigMessageId(rollConfig = {}) {
  return cleanText(
    rollConfig?.event?.target?.closest?.("[data-message-id]")?.dataset?.messageId
      ?? rollConfig?.message?.id
      ?? rollConfig?.message?._id
      ?? rollConfig?.messageId
      ?? rollConfig?.options?.messageId
      ?? rollConfig?.options?.originatingMessage
      ?? rollConfig?.rolls?.[0]?.options?.messageId
      ?? rollConfig?.rolls?.[0]?.options?.originatingMessage
  );
}

function saveOverridesTargetMatches(overrides = {}, actorUuid = "") {
  const targetMatches = (uuid) => cleanText(uuid) === actorUuid;
  return Boolean((overrides.carefulTargetUuids ?? []).some(targetMatches)
    || targetMatches(overrides.heightenedTargetUuid));
}

function isCooldownCardForActor(metadata, actor, cooldownKey) {
  if (!metadata || cleanText(metadata.cooldownKey) !== cleanText(cooldownKey)) {
    return false;
  }
  const actorUuid = cleanText(actor?.uuid);
  const actorId = cleanText(actor?.id ?? actor?._id);
  return Boolean((actorUuid && actorUuid === cleanText(metadata.actorUuid))
    || (actorId && actorId === cleanText(metadata.actorId)));
}

function cooldownRoundLabel(remaining) {
  const rounds = Math.max(0, toInteger(remaining, 0));
  const lastTwoDigits = rounds % 100;
  const lastDigit = rounds % 10;
  return lastTwoDigits >= 11 && lastTwoDigits <= 14
    ? "раундов"
    : lastDigit === 1
      ? "раунд"
      : lastDigit >= 2 && lastDigit <= 4
        ? "раунда"
        : "раундов";
}

function cooldownActiveText(remaining) {
  const rounds = Math.max(0, toInteger(remaining, 0));
  return `Перезарядка: ${rounds} ${cooldownRoundLabel(rounds)}`;
}

function cooldownCardFooter(remaining) {
  const rounds = Math.max(0, toInteger(remaining, 0));
  const text = rounds > 0
    ? cooldownActiveText(rounds)
    : "Перезарядка: готово";
  return `<li class="rebreya-sorcerer-cooldown" data-rebreya-sorcerer-cooldown="true">${text}</li>`;
}

function componentLabels(components = {}) {
  const verbal = components.verbal === true || components.vocal === true || components.v === true;
  const somatic = components.somatic === true || components.s === true;
  const material = components.material === true || components.m === true;
  return [
    verbal ? "В" : "",
    somatic ? "С" : "",
    material ? "М" : ""
  ].filter(Boolean).join(", ");
}

function replaceComponentFooter(content, components = {}) {
  const labels = componentLabels(components);
  return String(content ?? "").replace(/<li\b([^>]*)>([\s\S]*?)<\/li>/giu, (match, attrs, body) => {
    const plain = String(body ?? "")
      .replace(/<[^>]*>/gu, "")
      .replace(/\s+/gu, " ")
      .trim();
    return /^(?:[ВСМVSM](?:\s*,\s*[ВСМVSM])*)$/u.test(plain)
      ? (labels ? `<li${attrs}>${escapeHtml(labels)}</li>` : "")
      : match;
  });
}

function metamagicCardFooter(spellCast = {}) {
  const names = (spellCast.metamagic ?? [])
    .map((entry) => cleanText(entry?.name ?? entry?.id))
    .filter(Boolean);
  if (!names.length) {
    return "";
  }
  return `<li class="rebreya-sorcerer-metamagic-card" data-rebreya-sorcerer-metamagic-card="true">Метамагия: ${escapeHtml(names.join(", "))}</li>`;
}

function withMetamagicCardFooter(content, spellCast = {}) {
  let safeContent = String(content ?? "");
  if (spellCast.components) {
    safeContent = replaceComponentFooter(safeContent, spellCast.components);
  }
  const footer = metamagicCardFooter(spellCast);
  if (!footer || /data-rebreya-sorcerer-metamagic-card/iu.test(safeContent)) {
    return safeContent;
  }

  const cardFooter = /<ul\b[^>]*class=["'][^"']*\bcard-footer\b[^"']*["'][^>]*>[\s\S]*?<\/ul>/iu;
  const existingFooter = safeContent.match(cardFooter)?.[0];
  if (existingFooter) {
    return safeContent.replace(existingFooter, existingFooter.replace(/<\/ul>\s*$/iu, `${footer}</ul>`));
  }

  const newFooter = `<ul class="card-footer pills unlist">${footer}</ul>`;
  if (/<\/div>\s*$/iu.test(safeContent)) {
    return safeContent.replace(/<\/div>\s*$/iu, `${newFooter}</div>`);
  }
  return `${safeContent}${safeContent ? "\n" : ""}${newFooter}`;
}

function withCooldownCardFooter(content, remaining) {
  const safeContent = String(content ?? "");
  const footer = cooldownCardFooter(remaining);
  const existing = /<li\b[^>]*\bdata-rebreya-sorcerer-cooldown(?:=["'][^"']*["'])?[^>]*>[\s\S]*?<\/li>/iu;
  if (existing.test(safeContent)) {
    return safeContent.replace(existing, footer);
  }

  const cardFooter = /<ul\b[^>]*class=["'][^"']*\bcard-footer\b[^"']*["'][^>]*>[\s\S]*?<\/ul>/iu;
  const existingFooter = safeContent.match(cardFooter)?.[0];
  if (existingFooter) {
    return safeContent.replace(existingFooter, existingFooter.replace(/<\/ul>\s*$/iu, `${footer}</ul>`));
  }

  const newFooter = `<ul class="card-footer pills unlist">${footer}</ul>`;
  if (/<\/div>\s*$/iu.test(safeContent)) {
    return safeContent.replace(/<\/div>\s*$/iu, `${newFooter}</div>`);
  }
  return `${safeContent}${safeContent ? "\n" : ""}${newFooter}`;
}

function exhaustionLevel(actor) {
  const value = actor?.system?.attributes?.exhaustion;
  return Math.max(0, toInteger(value?.value ?? value, 0));
}

function normalizeCastingMode(value, baseLevel) {
  if (baseLevel <= 0) {
    return "normal";
  }
  return cleanText(value).toLowerCase() === "normal" ? "normal" : "sorcery";
}

function normalizeSelection(value, fallbackLevel) {
  if (value === false || value === null) {
    return {
      accepted: false,
      spellLevel: fallbackLevel,
      castingMode: normalizeCastingMode(undefined, fallbackLevel),
      exhaustionOverride: false,
      consumeResource: true
    };
  }

  if (typeof value === "number") {
    return {
      accepted: true,
      spellLevel: toInteger(value, fallbackLevel),
      castingMode: normalizeCastingMode(undefined, fallbackLevel),
      exhaustionOverride: false,
      consumeResource: true
    };
  }

  if (value && typeof value === "object") {
    return {
      accepted: value.accepted !== false && value.confirmed !== false,
      spellLevel: toInteger(value.spellLevel ?? value.level, fallbackLevel),
      castingMode: normalizeCastingMode(value.castingMode ?? value.mode, fallbackLevel),
      exhaustionOverride: value.exhaustionOverride === true || value.override === true,
      consumeResource: value.consumeResource !== false && value.spendResource !== false,
      metamagic: value.metamagic && typeof value.metamagic === "object" ? value.metamagic : null
    };
  }

  return {
    accepted: true,
    spellLevel: fallbackLevel,
    castingMode: normalizeCastingMode(undefined, fallbackLevel),
    exhaustionOverride: false,
    consumeResource: true
  };
}

function explicitSelection(usageConfig, dialogConfig, fallbackLevel) {
  const selected = usageConfig?.sorcererVirtualSpellLevel
    ?? dialogConfig?.sorcererVirtualSpellLevel
    ?? usageConfig?.spellCast?.spellLevel
    ?? fallbackLevel;
  const selection = normalizeSelection(selected, fallbackLevel);
  selection.castingMode = normalizeCastingMode(
    usageConfig?.sorcererCastingMode
      ?? dialogConfig?.sorcererCastingMode
      ?? usageConfig?.spellCast?.castingMode
      ?? selection.castingMode,
    fallbackLevel
  );
  if (usageConfig?.sorcererConsumeResource === false || dialogConfig?.sorcererConsumeResource === false) {
    selection.consumeResource = false;
  }
  return selection;
}

function hasExplicitSelection(usageConfig, dialogConfig) {
  return Object.hasOwn(usageConfig ?? {}, "sorcererVirtualSpellLevel")
    || Object.hasOwn(dialogConfig ?? {}, "sorcererVirtualSpellLevel")
    || Object.hasOwn(usageConfig ?? {}, "sorcererCastingMode")
    || Object.hasOwn(dialogConfig ?? {}, "sorcererCastingMode")
    || getProperty(usageConfig, "spellCast.spellLevel", undefined) !== undefined;
}

function explicitExhaustionOverride(usageConfig, dialogConfig) {
  return usageConfig?.sorcererExhaustionOverride === true
    || dialogConfig?.sorcererExhaustionOverride === true
    || usageConfig?.spellCast?.modifiers?.exhaustionOverride === true;
}

function cooldownKey(activity, virtualLevel) {
  return `${spellIdentifier(activity)}:${virtualLevel}`;
}

function splitCooldownKey(key) {
  const value = cleanText(key);
  const separator = value.lastIndexOf(":");
  if (separator <= 0) {
    return null;
  }
  const identifier = cleanText(value.slice(0, separator));
  const level = toInteger(value.slice(separator + 1), 0);
  return identifier ? { identifier, level } : null;
}

function actorFlag(actor, key, fallback = {}) {
  const value = typeof actor?.getFlag === "function"
    ? actor.getFlag(MODULE_ID, key)
    : getProperty(actor, `flags.${MODULE_ID}.${key}`, undefined);
  return value && typeof value === "object" ? deepClone(value) : fallback;
}

function actorItemById(actor, itemId) {
  const id = cleanText(itemId);
  if (!actor || !id) {
    return null;
  }
  const direct = actor.items?.get?.(id);
  if (direct) {
    return direct;
  }
  return collectionValues(actor.items)
    .find((item) => cleanText(item?.id ?? item?._id) === id) ?? null;
}

function spellItemIdentifiers(item) {
  return new Set([
    item?.system?.identifier,
    item?.identifier,
    item?.id,
    item?._id,
    item?.uuid
  ].map((value) => cleanText(value)).filter(Boolean));
}

function activeCooldownsByIdentifier(actor) {
  const result = new Map();
  const cooldowns = actorFlag(actor, COOLDOWNS_FLAG);
  for (const [key, record] of Object.entries(cooldowns)) {
    const remaining = cooldownRemaining(record);
    if (remaining <= 0) {
      continue;
    }
    const parsed = splitCooldownKey(key);
    if (!parsed) {
      continue;
    }
    const previous = result.get(parsed.identifier);
    if (!previous || remaining > previous.remaining) {
      result.set(parsed.identifier, {
        ...parsed,
        remaining
      });
    }
  }
  return result;
}

function removeCooldownSheetBadges(row) {
  for (const badge of Array.from(row.querySelectorAll?.("[data-rebreya-sorcerer-cooldown-badge='true']") ?? [])) {
    badge.remove?.();
  }
  row.classList?.remove?.("has-rebreya-sorcerer-cooldown");
  delete row.dataset.rebreyaSorcererCooldownRemaining;
}

function cooldownBadgeTarget(row) {
  return row.querySelector?.(".item-name .name-stacked")
    ?? row.querySelector?.(".name.name-stacked")
    ?? row.querySelector?.(".name-stacked")
    ?? row.querySelector?.(".item-name")
    ?? row;
}

export function bindSorcererVirtualSlotCooldownBadges(root, actor) {
  if (typeof globalThis.HTMLElement === "undefined" || !(root instanceof globalThis.HTMLElement)) {
    return false;
  }
  const active = activeCooldownsByIdentifier(actor);
  let changed = false;
  for (const row of Array.from(root.querySelectorAll?.("[data-item-id]") ?? [])) {
    if (!(row instanceof globalThis.HTMLElement)) {
      continue;
    }
    removeCooldownSheetBadges(row);

    const item = actorItemById(actor, row.dataset?.itemId);
    if (item?.type !== "spell") {
      continue;
    }
    const cooldown = Array.from(spellItemIdentifiers(item))
      .map((identifier) => active.get(identifier))
      .find(Boolean);
    if (!cooldown) {
      continue;
    }

    const badge = globalThis.document?.createElement?.("span");
    if (!(badge instanceof globalThis.HTMLElement)) {
      continue;
    }
    const text = cooldownActiveText(cooldown.remaining);
    badge.classList.add("rebreya-sorcerer-cooldown-badge");
    badge.dataset.rebreyaSorcererCooldownBadge = "true";
    badge.textContent = text;
    badge.setAttribute("title", `Виртуальная ячейка чародея перезаряжается: ${cooldown.remaining} ${cooldownRoundLabel(cooldown.remaining)}`);
    badge.setAttribute("aria-label", text);

    const target = cooldownBadgeTarget(row);
    target.append?.(badge);
    row.classList.add("has-rebreya-sorcerer-cooldown");
    row.dataset.rebreyaSorcererCooldownRemaining = String(cooldown.remaining);
    changed = true;
  }
  return changed;
}

async function setActorFlag(actor, key, value) {
  if (typeof actor?.setFlag === "function") {
    await actor.setFlag(MODULE_ID, key, value);
    return;
  }

  if (typeof actor?.update === "function") {
    await actor.update({ [`flags.${MODULE_ID}.${key}`]: value });
    return;
  }

  setProperty(actor, `flags.${MODULE_ID}.${key}`, value);
}

async function updateDocument(document, patch) {
  if (!Object.keys(patch).length) {
    return document;
  }

  if (typeof document?.update === "function") {
    return document.update(patch);
  }

  for (const [path, value] of Object.entries(patch)) {
    setProperty(document, path, value);
  }
  return document;
}

function resourceData(max) {
  return {
    name: "Единицы чародейства",
    type: "feat",
    system: {
      identifier: SORCERY_POINTS_FEATURE_ID,
      uses: {
        spent: 0,
        max,
        recovery: deepClone(SORCERY_POINTS_RECOVERY)
      }
    },
    flags: {
      [MODULE_ID]: {
        featureId: SORCERY_POINTS_FEATURE_ID
      }
    }
  };
}

export class SorcererAutomationService {
  constructor(moduleApi = {}, options = {}) {
    this.moduleApi = moduleApi;
    this._options = Object.keys(options).length
      ? options
      : moduleApi ?? {};
    this._deferredActivities = new WeakSet();
    this._finalizingActivities = new WeakSet();
    this._pendingSeekingAttacks = new WeakMap();
    this._pendingEmpoweredDamage = new WeakMap();
    this._saveOverridesByMessage = new Map();
    this._metamagicRecordsByMessage = new Map();
    this._paymentLocks = new WeakMap();
  }

  async initialize() {
    return true;
  }

  bindSorcererCastDialogControls(...args) {
    return bindSorcererCastDialogControls(...args);
  }

  bindActorSheetCooldownBadges(root, actor) {
    return bindSorcererVirtualSlotCooldownBadges(root, actor);
  }

  async #chooseVirtualSpellLevel({
    actor,
    activity,
    choices,
    usageConfig,
    dialogConfig,
    baseLevel,
    cooldowns = {},
    highLevelCasts = {}
  }) {
    if (this._options.chooseVirtualSpellLevel instanceof Function) {
      return normalizeSelection(
        await this._options.chooseVirtualSpellLevel({ actor, activity, choices: deepClone(choices) }),
        baseLevel
      );
    }

    if (hasExplicitSelection(usageConfig, dialogConfig)) {
      return explicitSelection(usageConfig, dialogConfig, baseLevel);
    }

    const DialogV2 = dialogV2();
    if (typeof DialogV2?.wait !== "function") {
      return explicitSelection(usageConfig, dialogConfig, baseLevel);
    }

    const options = choices.map(({ spellLevel, cost }) => (
      `<option value="${spellLevel}" data-sorcerer-cost="${cost}" data-sorcerer-exhaustion="${(
        (spellLevel <= 5 && cooldownIsActive(cooldowns[cooldownKey(activity, spellLevel)]))
        || (spellLevel >= 6 && highLevelCasts[String(spellLevel)] === true)
      ) ? "true" : "false"}"${spellLevel === baseLevel ? " selected" : ""}>${spellLevel} (${cost})</option>`
    )).join("");
    const points = pointsFeature(actor);
    const availablePoints = Math.max(
      0,
      toInteger(points?.system?.uses?.max, 0) - toInteger(points?.system?.uses?.spent, 0)
    );
    const canUseSorceryMode = baseLevel > 0 && choices.some(({ cost }) => cost <= availablePoints);
    const modeControl = baseLevel > 0
      ? `<label class="rebreya-sorcerer-field">Способ каста<select name="castingMode"><option value="sorcery"${canUseSorceryMode ? "" : " disabled"}>Единицы чародейства</option><option value="normal"${canUseSorceryMode ? "" : " selected"}>Обычный каст</option></select></label>`
      : `<input type="hidden" name="castingMode" value="normal">`;
    const availableMetamagic = metamagicOptions(actor);
    const metamagicCheckboxes = availableMetamagic.map((option) => {
      const { id, stacking } = option;
      const text = metamagicDisplayText(option);
      const costMode = metamagicCostMode(option);
      const minCost = metamagicMinCost(option);
      const maxCost = metamagicMaxCost(option, baseLevel);
      const actualCost = metamagicCostForOption(option, baseLevel);
      const safeStacking = stacking === "additive" ? "additive" : "base";
      const variableCost = costMode === "variable"
        ? `<span class="rebreya-sorcerer-option__slider"><span>Стоимость</span><input type="range" name="metamagicCost.${escapeHtml(id)}" min="${minCost}" max="${maxCost}" value="${actualCost}" data-metamagic-cost-slider><output data-metamagic-cost-output>${actualCost}</output></span>`
        : "";
      return `<label class="rebreya-sorcerer-option"><input type="checkbox" name="metamagic" value="${escapeHtml(id)}" data-cost="${actualCost}" data-cost-mode="${costMode}" data-min-cost="${minCost}" data-max-cost="${maxCost}" data-discount="${Math.max(0, toInteger(option.discount, 0))}" data-stacking="${safeStacking}"><span class="rebreya-sorcerer-option__body"><strong>${escapeHtml(text.name)}</strong><span class="rebreya-sorcerer-option__details">${escapeHtml(text.detail)}</span>${variableCost}</span><span class="rebreya-sorcerer-option__cost"><span data-metamagic-cost-label>${actualCost}</span> ед.</span><i class="fa-solid fa-lock rebreya-sorcerer-option__lock" aria-hidden="true"></i></label>`;
    }).join("");
    const selectedTargets = availableTargets({ selectedOnly: true });
    const targetOptions = selectedTargets.map(({ uuid, label }) => (
      `<option value="${escapeHtml(uuid)}">${escapeHtml(label)}</option>`
    )).join("");
    const dieOptions = damageDieChoices(activity).map(({ id, label }) => (
      `<option value="${escapeHtml(id)}">${escapeHtml(label)}</option>`
    )).join("");
    const currentChoiceNeedsExhaustion = choices.some(({ spellLevel }) => (
      spellLevel === baseLevel
      && (
        (spellLevel <= 5 && cooldownIsActive(cooldowns[cooldownKey(activity, spellLevel)]))
        || (spellLevel >= 6 && highLevelCasts[String(spellLevel)] === true)
      )
    ));
    const hasExhaustionChoice = choices.some(({ spellLevel }) => (
      (spellLevel <= 5 && cooldownIsActive(cooldowns[cooldownKey(activity, spellLevel)]))
      || (spellLevel >= 6 && highLevelCasts[String(spellLevel)] === true)
    ));
    const exhaustionOverride = hasExhaustionChoice
      ? `<label class="rebreya-sorcerer-toggle" data-sorcerer-exhaustion-row${currentChoiceNeedsExhaustion ? "" : " hidden"}><input type="checkbox" name="exhaustionOverride"><span>Игнорировать ограничение ценой истощения</span></label>`
      : "";
    const metamagicSection = metamagicCheckboxes
      ? `<section class="rebreya-sorcerer-metamagic"><h3>Метамагия</h3>${metamagicCheckboxes}<div class="rebreya-sorcerer-metamagic__fields"><label data-metamagic-fields="careful-spell" hidden>Аккуратное: существа, автоматически преуспевающие в спасброске<select name="carefulTargets" multiple>${targetOptions}</select></label><label data-metamagic-fields="heightened-spell" hidden>Непреодолимое: цель с помехой к первому спасброску<select name="heightenedTarget">${targetOptions}</select></label><div class="rebreya-sorcerer-field-hint" data-metamagic-fields="twinned-spell" hidden>Удвоенное: выберите две подходящие цели обычным инструментом выбора целей Foundry.</div><label data-metamagic-fields="empowered-spell" hidden>Усиленное: кубы для переброса<select name="damageDice" multiple>${dieOptions}</select></label></div></section>`
      : "";
    const initialChoice = choices.find(({ spellLevel }) => spellLevel === baseLevel) ?? choices[0];
    const initialCost = canUseSorceryMode ? initialChoice?.cost ?? 0 : 0;
    const result = await DialogV2.wait({
      window: { title: "Единицы чародейства" },
      position: { width: SORCERER_CAST_DIALOG_WIDTH },
      render: (...args) => bindSorcererCastDialogControls(...args),
      content: `<div class="rebreya-sorcerer-choice-row rebreya-sorcerer-cast-dialog" data-sorcerer-cast-dialog data-sorcerer-available-points="${availablePoints}"><div class="rebreya-sorcerer-dialog-copy">Выберите способ каста, уровень и метамагию.</div>${modeControl}<label class="rebreya-sorcerer-field">Уровень ячейки<select name="spellLevel">${options}</select></label><div class="rebreya-sorcerer-toggle-row"><label class="rebreya-sorcerer-toggle"><input type="checkbox" name="consumeResource" checked><span>Расходовать ресурс</span></label>${exhaustionOverride}</div><output class="rebreya-sorcerer-blocked" data-sorcerer-blocked role="status" hidden></output>${metamagicSection}<output class="rebreya-sorcerer-total">итого: <strong data-sorcerer-total>${initialCost}</strong> единиц чародейства</output></div>`,
      buttons: [{
        action: "cast",
        label: "Сотворить",
        default: true,
        callback: (_event, button) => {
          const carefulTargets = formValues(button?.form, "carefulTargets");
          const heightenedTarget = formValues(button?.form, "heightenedTarget").at(0) ?? "";
          const metamagicIds = formValues(button?.form, "metamagic");
          return {
            accepted: true,
            spellLevel: toInteger(button?.form?.elements?.spellLevel?.value, baseLevel),
            castingMode: normalizeCastingMode(button?.form?.elements?.castingMode?.value, baseLevel),
            exhaustionOverride: button?.form?.elements?.exhaustionOverride?.checked === true,
            consumeResource: button?.form?.elements?.consumeResource?.checked !== false,
            metamagic: {
              accepted: true,
              ids: metamagicIds,
              costs: formMetamagicCosts(button?.form, metamagicIds),
              targetUuids: carefulTargets.length ? carefulTargets : [heightenedTarget].filter(Boolean),
              currentTargets: selectedTargets.map(({ uuid }) => uuid),
              secondTargetUuid: "",
              damageDice: formValues(button?.form, "damageDice")
            }
          };
        }
      }, {
        action: "cancel",
        label: "Отмена"
      }]
    });
    return normalizeSelection(result, baseLevel);
  }

  #metamagicRequest(usageConfig = {}, dialogConfig = {}) {
    const value = usageConfig?.sorcererMetamagic ?? dialogConfig?.sorcererMetamagic ?? {};
    if (Array.isArray(value)) {
      return { ids: value };
    }
    if (typeof value === "string") {
      return { ids: [value] };
    }
    return value && typeof value === "object" ? value : {};
  }

  async #chooseMetamagic({ actor, activity, spellLevel, usageConfig, dialogConfig }) {
    const configured = this.#metamagicRequest(usageConfig, dialogConfig);
    if (Array.isArray(configured.ids) && configured.ids.length) {
      return { accepted: true, ...configured, ids: configured.ids.map((id) => cleanText(id)).filter(Boolean) };
    }

    const options = metamagicOptions(actor);
    if (this._options.chooseMetamagic instanceof Function) {
      const result = await this._options.chooseMetamagic({
        actor,
        activity,
        spellLevel,
        options: deepClone(options.map(({ id, cost, stacking }) => ({ id, cost, stacking })))
      });
      if (result === false || result?.accepted === false || result?.confirmed === false) {
        return { accepted: false, ids: [] };
      }
      const choice = Array.isArray(result) ? { ids: result } : (result ?? {});
      return { accepted: true, ...choice, ids: (choice.ids ?? []).map((id) => cleanText(id)).filter(Boolean) };
    }

    const DialogV2 = dialogV2();
    if (typeof DialogV2?.wait !== "function" || !options.length) {
      return { accepted: true, ids: [] };
    }

    const virtualCost = VIRTUAL_SLOT_COSTS[spellLevel] ?? 0;
    const checkboxes = options.map((option) => {
      const { id, stacking } = option;
      const text = metamagicDisplayText(option);
      const costMode = metamagicCostMode(option);
      const minCost = metamagicMinCost(option);
      const maxCost = metamagicMaxCost(option, spellLevel);
      const actualCost = metamagicCostForOption(option, spellLevel);
      const safeStacking = stacking === "additive" ? "additive" : "base";
      const variableCost = costMode === "variable"
        ? `<span class="rebreya-sorcerer-option__slider"><span>Стоимость</span><input type="range" name="metamagicCost.${escapeHtml(id)}" min="${minCost}" max="${maxCost}" value="${actualCost}" data-metamagic-cost-slider><output data-metamagic-cost-output>${actualCost}</output></span>`
        : "";
      return `<label class="rebreya-sorcerer-option"><input type="checkbox" name="metamagic" value="${escapeHtml(id)}" data-cost="${actualCost}" data-cost-mode="${costMode}" data-min-cost="${minCost}" data-max-cost="${maxCost}" data-stacking="${safeStacking}"><span class="rebreya-sorcerer-option__body"><strong>${escapeHtml(text.name)}</strong><span class="rebreya-sorcerer-option__details">${escapeHtml(text.detail)}</span>${variableCost}</span><span class="rebreya-sorcerer-option__cost"><span data-metamagic-cost-label>${actualCost}</span> ед.</span><i class="fa-solid fa-lock rebreya-sorcerer-option__lock" aria-hidden="true"></i></label>`;
    }).join("");
    const selectedTargets = availableTargets({ selectedOnly: true });
    const targetOptions = selectedTargets.map(({ uuid, label }) => (
      `<option value="${escapeHtml(uuid)}">${escapeHtml(label)}</option>`
    )).join("");
    const dieOptions = damageDieChoices(activity).map(({ id, label }) => (
      `<option value="${escapeHtml(id)}">${escapeHtml(label)}</option>`
    )).join("");
    const result = await DialogV2.wait({
      window: { title: "Метамагия" },
      position: { width: SORCERER_CAST_DIALOG_WIDTH },
      render: (...args) => bindSorcererCastDialogControls(...args),
      content: `<div class="rebreya-sorcerer-choice-row" data-sorcerer-cast-dialog><input type="hidden" name="spellLevel" value="${spellLevel}" data-sorcerer-cost="${virtualCost}">${checkboxes}<label data-metamagic-fields="careful-spell" hidden>Аккуратное: существа, автоматически преуспевающие в спасброске<select name="carefulTargets" multiple>${targetOptions}</select></label><label data-metamagic-fields="heightened-spell" hidden>Непреодолимое: цель с помехой к первому спасброску<select name="heightenedTarget">${targetOptions}</select></label><div class="rebreya-sorcerer-field-hint" data-metamagic-fields="twinned-spell" hidden>Удвоенное: выберите две подходящие цели обычным инструментом выбора целей Foundry.</div><label data-metamagic-fields="empowered-spell" hidden>Усиленное: кубы для переброса<select name="damageDice" multiple>${dieOptions}</select></label><output>Итого: <strong data-sorcerer-total>${virtualCost}</strong> ед. чародейства</output></div>`,
      buttons: [{
        action: "confirm",
        label: "Применить",
        default: true,
        callback: (_event, button) => {
          const carefulTargets = formValues(button?.form, "carefulTargets");
          const heightenedTarget = formValues(button?.form, "heightenedTarget").at(0) ?? "";
          const ids = formValues(button?.form, "metamagic");
          return {
            accepted: true,
            ids,
            costs: formMetamagicCosts(button?.form, ids),
            targetUuids: carefulTargets.length ? carefulTargets : [heightenedTarget].filter(Boolean),
            currentTargets: selectedTargets.map(({ uuid }) => uuid),
            secondTargetUuid: "",
            damageDice: formValues(button?.form, "damageDice")
          };
        }
      }, { action: "cancel", label: "Отмена" }]
    });
    if (!result || result.accepted === false) {
      return { accepted: false, ids: [] };
    }
    return { ...result, ids: (result.ids ?? []).map((id) => cleanText(id)).filter(Boolean) };
  }

  #metamagicCost(option, spellLevel, requestedCost = undefined) {
    return metamagicCostForOption(option, spellLevel, requestedCost);
  }

  #validateMetamagic(activity, actor, spellLevel, request = {}) {
    const ids = Array.from(new Set((request?.ids ?? []).map((id) => cleanText(id)).filter(Boolean)));
    const ownedById = new Map(metamagicOptions(actor).map((option) => [option.id, option]));
    const requestedCosts = request?.costs ?? request?.metamagicCosts ?? {};
    const options = ids.map((id) => {
      const option = ownedById.get(id);
      if (!option) return undefined;
      return {
        ...option,
        selectedCost: this.#metamagicCost(option, spellLevel, requestedCosts[id])
      };
    });
    if (options.some((option) => !option)) {
      return null;
    }

    const additive = options.filter((option) => option.stacking === "additive");
    const base = options.filter((option) => option.stacking !== "additive");
    if (base.length > 1 || additive.length > 1 || options.length > 2 || (options.length === 2 && (base.length !== 1 || additive.length !== 1))) {
      return null;
    }

    const targetUuids = selectedTargetUuids(request.targetUuids);
    const currentTargets = selectedTargetUuids(request.targets ?? request.currentTargets);
    const requestedDamageDice = Array.from(new Set((request.damageDice ?? []).map((id) => cleanText(id)).filter(Boolean)));
    const selectedDamageDice = ids.includes("empowered-spell")
      ? normalizedDamageDice(activity, requestedDamageDice)
      : [];
    let secondTargetUuid = cleanText(request.secondTargetUuid);
    for (const id of ids) {
      if (id === "careful-spell" && (!spellHasSave(activity) || targetUuids.length < 1 || targetUuids.length > charismaModifier(actor))) {
        return null;
      }
      if (id === "distant-spell") {
        const range = spellRange(activity);
        if (range.units !== "touch" && range.value < 5) return null;
      }
      if (id === "heightened-spell" && (!spellHasSave(activity) || targetUuids.length !== 1)) {
        return null;
      }
      if (id === "extended-spell" && durationSeconds(spellDuration(activity)) < 60) {
        return null;
      }
      if (id === "twinned-spell") {
        const range = spellRange(activity);
        const nativeTargeting = currentTargets.length === 2 && new Set(currentTargets).size === 2;
        if (spellTargetCount(activity) !== 1 || range.units === "self" || !nativeTargeting) {
          return null;
        }
      }
      if (id === "empowered-spell" && (!spellHasDamage(activity) || !selectedDamageDice || selectedDamageDice.length < 1 || selectedDamageDice.length > charismaModifier(actor))) {
        return null;
      }
      if (id === "draconic-ancestral-spell" && (!spellHasDamage(activity) || !draconicAncestorDamageType(actor))) {
        return null;
      }
      if (id === "draconic-dragon-protection" && !firstAllowedSpellDamageType(activity, DRACONIC_PROTECTION_DAMAGE_TYPES)) {
        return null;
      }
      if (id === "draconic-dragon-spell") {
        const ancestorDamageType = draconicAncestorDamageType(actor);
        if (!ancestorDamageType || !spellHasDamageType(activity, ancestorDamageType)) {
          return null;
        }
      }
      if (id === "draconic-dragon-wing" && !actor) {
        return null;
      }
      if (id === "quickened-spell" && spellActivation(activity).type !== "action") {
        return null;
      }
      if (id === "seeking-spell" && !spellHasAttack(activity)) {
        return null;
      }
    }

    return {
      ids,
      options,
      cost: options
        .filter((option) => option.id !== "seeking-spell")
        .reduce((total, option) => total + this.#metamagicCost(option, spellLevel, option.selectedCost), 0),
      targetUuids,
      currentTargets,
      secondTargetUuid,
      selectedDamageDice,
      rerollDamage: request.rerollDamage instanceof Function ? request.rerollDamage : null
    };
  }

  #applyPassiveSorcererFeatureConfig(activity, plan, messageConfig = {}) {
    const modifiers = {};
    const actor = plan.actor;
    if (actorHasFeatureNamed(actor, "Родство со стихией")) {
      const damageType = draconicAncestorDamageType(actor);
      const charismaBonus = toInteger(
        actor?.system?.abilities?.cha?.mod ?? actor?.system?.abilities?.cha?.modifier,
        0
      );
      const alreadyApplied = spellDamageParts(activity)
        .some((part) => cleanText(part?._id ?? part?.id) === DRACONIC_ELEMENTAL_AFFINITY_PART_ID);
      if (damageType && charismaBonus !== 0 && spellHasDamageType(activity, damageType) && !alreadyApplied) {
        const formula = String(charismaBonus);
        const part = appendSpellDamagePart(activity, metamagicDamagePart({
          id: DRACONIC_ELEMENTAL_AFFINITY_PART_ID,
          formula,
          damageType
        }));
        modifiers.draconicElementalAffinity = {
          formula,
          damageType: damagePartType(part)
        };
        messageConfig.data ??= {};
        messageConfig.data.flags ??= {};
        messageConfig.data.flags[MODULE_ID] ??= {};
        messageConfig.data.flags[MODULE_ID].damageBonus = {
          source: "draconic-elemental-affinity",
          formula,
          damageType: damagePartType(part)
        };
      }
    }

    return { modifiers };
  }

  #applyMetamagicConfig(activity, usageConfig, plan, messageConfig = {}) {
    const meta = plan.metamagic ?? {};
    const modifiers = {};
    const updates = {};
    const actorUpdates = {};
    const actorEffects = [];
    let components = spellComponents(activity);
    for (const id of meta.ids) {
      if (id === "careful-spell") {
        modifiers.careful = { targets: meta.targetUuids };
      }
      else if (id === "distant-spell") {
        const range = spellRange(activity);
        plan.range ??= range.units === "touch"
          ? { value: 30, units: "ft" }
          : { value: range.value * 2, units: range.units };
        updates["range.value"] = plan.range.value;
        updates["range.units"] = plan.range.units;
        modifiers.distant = true;
      }
      else if (id === "heightened-spell") {
        modifiers.heightened = { targetUuid: meta.targetUuids[0], firstSaveDisadvantage: true };
      }
      else if (id === "subtle-spell") {
        components = sharedSpellComponents(activity, { verbal: false, somatic: false });
        const source = spellComponents(activity);
        if (Object.hasOwn(source, "vocal")) updates["components.vocal"] = false;
        else updates["components.verbal"] = false;
        if (Object.hasOwn(source, "somatic")) updates["components.somatic"] = false;
        else updates["components.s"] = false;
        const systemComponents = activity?.system?.components;
        if (systemComponents && typeof systemComponents === "object") {
          if (Object.hasOwn(systemComponents, "vocal")) updates["system.components.vocal"] = false;
          if (Object.hasOwn(systemComponents, "verbal")) updates["system.components.verbal"] = false;
          if (Object.hasOwn(systemComponents, "somatic")) updates["system.components.somatic"] = false;
          if (Object.hasOwn(systemComponents, "s")) updates["system.components.s"] = false;
        }
        const systemProperties = withoutVocalSomaticProperties(activity?.system?.properties);
        if (systemProperties !== undefined) {
          updates["system.properties"] = systemProperties;
        }
        const itemComponentUpdates = {};
        const itemComponents = activity?.item?.system?.components;
        if (itemComponents && typeof itemComponents === "object") {
          if (Object.hasOwn(itemComponents, "vocal")) itemComponentUpdates["system.components.vocal"] = false;
          if (Object.hasOwn(itemComponents, "verbal")) itemComponentUpdates["system.components.verbal"] = false;
          if (Object.hasOwn(itemComponents, "somatic")) itemComponentUpdates["system.components.somatic"] = false;
          if (Object.hasOwn(itemComponents, "s")) itemComponentUpdates["system.components.s"] = false;
        }
        const itemProperties = withoutVocalSomaticProperties(activity?.item?.system?.properties);
        if (itemProperties !== undefined) {
          itemComponentUpdates["system.properties"] = itemProperties;
        }
        updateSource(activity.item, itemComponentUpdates);
        modifiers.subtle = true;
      }
      else if (id === "draconic-ancestral-spell") {
        const damageType = draconicAncestorDamageType(plan.actor);
        replaceSpellDamageTypes(activity, damageType);
        modifiers.draconicAncestralSpell = { damageType };
      }
      else if (id === "draconic-dragon-protection") {
        const damageType = firstAllowedSpellDamageType(activity, DRACONIC_PROTECTION_DAMAGE_TYPES);
        actorEffects.push(draconicProtectionEffectData(activity, damageType));
        modifiers.draconicDragonProtection = { damageType };
      }
      else if (id === "draconic-dragon-spell") {
        const option = meta.options?.find((entry) => entry.id === id) ?? { selectedCost: 1 };
        const diceCount = this.#metamagicCost(option, plan.choice.spellLevel, option.selectedCost);
        const formula = `${diceCount}d6`;
        const damageType = draconicAncestorDamageType(plan.actor) || firstSpellDamageType(activity);
        const part = appendSpellDamagePart(activity, metamagicDamagePart({
          id: "rebreya-draconic-dragon-spell",
          formula,
          damageType
        }));
        modifiers.draconicDragonSpell = {
          formula,
          damageType: damagePartType(part),
          cost: diceCount
        };
        messageConfig.data ??= {};
        messageConfig.data.flags ??= {};
        messageConfig.data.flags[MODULE_ID] ??= {};
        messageConfig.data.flags[MODULE_ID].damageBonus = {
          source: id,
          formula,
          damageType: damagePartType(part),
          cost: diceCount
        };
      }
      else if (id === "draconic-dragon-wing") {
        const option = meta.options?.find((entry) => entry.id === id) ?? { selectedCost: 1 };
        const cost = this.#metamagicCost(option, plan.choice.spellLevel, option.selectedCost);
        actorEffects.push(draconicDragonWingEffectData(activity, cost));
        modifiers.draconicDragonWing = {
          flySpeed: cost * 10,
          cost
        };
      }
      else if (id === "advanced-mana-storm") {
        const tempHp = Math.max(1, toInteger(plan.choice.spellLevel, 1));
        const currentTempHp = Math.max(0, toInteger(plan.actor?.system?.attributes?.hp?.temp, 0));
        if (tempHp > currentTempHp) {
          actorUpdates["system.attributes.hp.temp"] = tempHp;
        }
        actorEffects.push(manaStormEffectData(activity, tempHp));
        modifiers.manaStorm = {
          tempHp,
          radius: 10,
          damage: tempHp,
          damageType: "force"
        };
      }
      else if (id === "extended-spell") {
        const duration = spellDuration(activity);
        plan.duration ??= durationFromSeconds(durationSeconds(duration) * 2, duration.units);
        updates["duration.value"] = plan.duration.value;
        updates["duration.units"] = plan.duration.units;
        const seconds = Math.min(MAX_EXTENDED_DURATION_SECONDS, Math.max(0, durationSeconds(duration) * 2));
        for (const effect of collectionValues(activity?.item?.effects)) {
          if (getProperty(effect, "flags.dnd5e.concentration", false) === true) continue;
          updateSource(effect, { "duration.seconds": seconds });
        }
        modifiers.extended = true;
      }
      else if (id === "twinned-spell") {
        modifiers.twinned = { targetUuids: [...meta.currentTargets] };
      }
      else if (id === "empowered-spell") {
        modifiers.empowered = { damageDice: meta.selectedDamageDice };
      }
      else if (id === "quickened-spell") {
        plan.activation ??= { type: "bonus", value: 1 };
        usageConfig.activation = deepClone(plan.activation);
        updates["activation.type"] = "bonus";
        updates["activation.value"] = 1;
        modifiers.quickened = true;
      }
      else if (id === "seeking-spell") {
        const option = meta.options?.find((entry) => entry.id === id) ?? { cost: meta.seekingCost ?? 2 };
        modifiers.seeking = {
          pending: true,
          cost: plan.spendResource === false ? 0 : this.#metamagicCost(option, plan.choice.spellLevel, option.selectedCost)
        };
      }
    }
    if (meta.ids?.length) {
      modifiers.metamagic = metamagicSummary(meta, plan.choice.spellLevel);
    }
    updateSource(activity, updates);

    usageConfig.flags ??= {};
    usageConfig.flags[MODULE_ID] ??= {};
    usageConfig.flags[MODULE_ID].castContext = {
      components: deepClone(components),
      targetUuids: meta.ids?.includes("twinned-spell")
        ? [...meta.currentTargets]
        : undefined
    };
    if (meta.ids?.some((id) => id === "careful-spell" || id === "heightened-spell")) {
      messageConfig.data ??= {};
      messageConfig.data.flags ??= {};
      messageConfig.data.flags[MODULE_ID] ??= {};
      messageConfig.data.flags[MODULE_ID].saveOverrides = {
        carefulTargetUuids: meta.ids.includes("careful-spell") ? [...meta.targetUuids] : [],
        heightenedTargetUuid: meta.ids.includes("heightened-spell") ? meta.targetUuids[0] : null,
        heightenedUsed: false
      };
    }
    if (meta.ids?.includes("empowered-spell")) {
      messageConfig.data ??= {};
      messageConfig.data.flags ??= {};
      messageConfig.data.flags[MODULE_ID] ??= {};
      messageConfig.data.flags[MODULE_ID].damageReroll = {
        selectedDamageDice: meta.selectedDamageDice.map((die) => die?.id ?? die)
      };
    }
    if (meta.ids?.includes("seeking-spell")) {
      messageConfig.data ??= {};
      messageConfig.data.flags ??= {};
      messageConfig.data.flags[MODULE_ID] ??= {};
      messageConfig.data.flags[MODULE_ID].attackReroll = {
        cost: modifiers.seeking.cost
      };
    }
    if (meta.ids?.includes("seeking-spell") && spellHasAttack(activity)) {
      this._pendingSeekingAttacks.set(activity, {
        actor: plan.actor,
        activity,
        cost: modifiers.seeking.cost,
        used: false,
        charged: false
      });
    }
    if (meta.ids?.includes("empowered-spell")) {
      this._pendingEmpoweredDamage.set(activity, {
        actor: plan.actor,
        selectedDamageDice: deepClone(meta.selectedDamageDice),
        used: false
      });
    }
    return { components, modifiers, updates, actorUpdates, actorEffects };
  }

  #applyCooldownCardConfig(messageConfig = {}, metadata = null) {
    if (!metadata) {
      return;
    }
    messageConfig.data ??= {};
    messageConfig.data.flags ??= {};
    messageConfig.data.flags[MODULE_ID] ??= {};
    messageConfig.data.flags[MODULE_ID][COOLDOWN_CARD_FLAG] = deepClone(metadata);
  }

  #applySpellCastMessageConfig(messageConfig = {}, spellCast = null) {
    if (!spellCast) {
      return;
    }
    messageConfig.data ??= {};
    messageConfig.data.flags ??= {};
    messageConfig.data.flags[MODULE_ID] ??= {};
    messageConfig.data.flags[MODULE_ID].spellCast = deepClone(spellCast);
  }

  #persistResolvedPlan(usageConfig, plan) {
    usageConfig[MODULE_ID] ??= {};
    usageConfig[MODULE_ID][PREFLIGHT_FLAG] = {
      accepted: true,
      spellLevel: plan.choice.spellLevel,
      castingMode: plan.castingMode,
      exhaustionOverride: plan.override,
      consumeResource: plan.spendResource !== false,
      metamagic: {
        ids: [...plan.metamagic.ids],
        costs: Object.fromEntries(plan.metamagic.options.map((option) => [
          option.id,
          this.#metamagicCost(option, plan.choice.spellLevel, option.selectedCost)
        ])),
        targetUuids: [...plan.metamagic.targetUuids],
        currentTargets: [...plan.metamagic.currentTargets],
        secondTargetUuid: plan.metamagic.secondTargetUuid,
        damageDice: plan.metamagic.selectedDamageDice.map((die) => die?.id ?? die),
        seekingCost: this.#metamagicCost(
          plan.metamagic.options.find((option) => option.id === "seeking-spell"),
          plan.choice.spellLevel,
          plan.metamagic.options.find((option) => option.id === "seeking-spell")?.selectedCost
        )
      },
      range: plan.range ? deepClone(plan.range) : null,
      duration: plan.duration ? deepClone(plan.duration) : null,
      activation: plan.activation ? deepClone(plan.activation) : null
    };
    return usageConfig[MODULE_ID][PREFLIGHT_FLAG];
  }

  #preflightPlan(activity, usageConfig = {}) {
    const stored = usageConfig?.[MODULE_ID]?.[PREFLIGHT_FLAG];
    if (!stored?.accepted) {
      return null;
    }
    const actor = actorFrom(activity);
    const baseLevel = spellBaseLevel(activity);
    const spellLevel = toInteger(stored.spellLevel, baseLevel);
    const castingMode = normalizeCastingMode(stored.castingMode, baseLevel);
    const metamagic = this.#validateMetamagic(activity, actor, spellLevel, stored.metamagic);
    if (!metamagic) {
      return null;
    }
    return {
      actor,
      choice: { spellLevel },
      castingMode,
      usesSorcerySlot: castingMode === "sorcery",
      metamagic,
      override: stored.exhaustionOverride === true,
      spendResource: stored.consumeResource !== false,
      range: stored.range ? deepClone(stored.range) : null,
      duration: stored.duration ? deepClone(stored.duration) : null,
      activation: stored.activation ? deepClone(stored.activation) : null
    };
  }

  async #validateSelectedDocuments(plan) {
    const meta = plan.metamagic;
    if (typeof globalThis.fromUuid !== "function" && typeof globalThis.fromUuidSync !== "function") {
      return true;
    }
    const resolveCreature = async (uuid) => {
      const document = await documentFromUuid(uuid);
      const actor = targetActor(document);
      return actor?.uuid ? { document, actor } : null;
    };
    if (meta.ids.some((id) => id === "careful-spell" || id === "heightened-spell")) {
      const targets = await Promise.all(meta.targetUuids.map(resolveCreature));
      if (targets.some((target) => !target)) {
        return false;
      }
      meta.targetUuids = targets.map(({ actor }) => actor.uuid);
    }
    if (meta.ids.includes("twinned-spell")) {
      const targets = await Promise.all(meta.currentTargets.map(resolveCreature));
      const currentScene = globalThis.canvas?.scene;
      const placeableIds = new Set(collectionValues(globalThis.canvas?.tokens?.placeables)
        .map((token) => cleanText(token?.document?.id ?? token?.id)));
      const isCurrentSceneToken = ({ document }) => {
        if (document?.documentName !== "Token" && currentScene) return false;
        // Canvas is always available in Foundry. The no-canvas fallback retains
        // compatibility with plain unit-document fixtures only.
        if (!currentScene) return Boolean(document?.actor && cleanText(document?.id ?? document?._id));
        return (document.parent === currentScene || document.parent?.id === currentScene?.id)
          && placeableIds.has(cleanText(document.id ?? document._id));
      };
      if (targets.length !== 2 || targets.some((target) => !target)
        || targets[0].actor.uuid === targets[1].actor.uuid
        || targets.some((target) => !isCurrentSceneToken(target))) {
        return false;
      }
      const targetIds = targets.map((target) => cleanText(target.document?.id ?? target.document?._id));
      if (targetIds.some((id) => !id)) {
        return false;
      }
      meta.targetIds = targetIds;
    }
    return true;
  }

  async #prepareCastPlan(activity, usageConfig = {}, dialogConfig = {}) {
    const actor = actorFrom(activity);
    const baseLevel = spellBaseLevel(activity);
    const maxLevel = scaleValue(actor, MAXIMUM_SPELL_LEVEL_SCALE_ID);
    if (!actor || baseLevel < 0 || maxLevel < baseLevel) {
      return null;
    }
    const choices = baseLevel === 0
      ? [{ spellLevel: 0, cost: 0 }]
      : Object.entries(VIRTUAL_SLOT_COSTS)
        .map(([level, cost]) => ({ spellLevel: Number(level), cost }))
        .filter(({ spellLevel }) => spellLevel >= baseLevel && spellLevel <= maxLevel);
    const cooldowns = actorFlag(actor, COOLDOWNS_FLAG);
    const highLevelCasts = actorFlag(actor, HIGH_LEVEL_CASTS_FLAG);
    const stored = usageConfig?.[MODULE_ID]?.[PREFLIGHT_FLAG];
    const selected = stored
      ? normalizeSelection(stored, baseLevel)
      : await this.#chooseVirtualSpellLevel({
        actor,
        activity,
        choices,
        usageConfig,
        dialogConfig,
        baseLevel,
        cooldowns,
        highLevelCasts
      });
    if (!selected.accepted) {
      return null;
    }
    const choice = choices.find(({ spellLevel }) => spellLevel === selected.spellLevel);
    if (!choice) {
      return null;
    }

    const request = stored?.metamagic ?? selected.metamagic ?? await this.#chooseMetamagic({
      actor,
      activity,
      spellLevel: choice.spellLevel,
      usageConfig,
      dialogConfig
    });
    if (request?.accepted === false) {
      return null;
    }
    const metamagic = this.#validateMetamagic(activity, actor, choice.spellLevel, {
      ...(request ?? {}),
      targets: stored
        ? request?.targets
        : request?.targets ?? usageConfig?.targets ?? globalThis.game?.user?.targets
    });
    if (!metamagic) {
      return null;
    }

    const castingMode = normalizeCastingMode(selected.castingMode, baseLevel);
    const usesSorcerySlot = castingMode === "sorcery";
    const override = usesSorcerySlot
      && (selected.exhaustionOverride || explicitExhaustionOverride(usageConfig, dialogConfig));
    const key = cooldownKey(activity, choice.spellLevel);
    const activeCooldown = usesSorcerySlot
      && choice.spellLevel <= 5
      && cooldownIsActive(cooldowns[key]);
    const highLevelRepeat = usesSorcerySlot
      && choice.spellLevel >= 6
      && highLevelCasts[String(choice.spellLevel)] === true;
    if ((activeCooldown || highLevelRepeat) && !override) {
      return null;
    }
    const points = pointsFeature(actor);
    const spent = Math.max(0, toInteger(points?.system?.uses?.spent, 0));
    const max = Math.max(0, toInteger(points?.system?.uses?.max, 0));
    const virtualSlotCost = usesSorcerySlot ? choice.cost : 0;
    const resourceCost = virtualSlotCost + metamagic.cost;
    const spendResource = selected.consumeResource !== false;
    const totalCost = spendResource ? resourceCost : 0;
    if (totalCost > 0 && (!points || max - spent < totalCost)) {
      return null;
    }

    const plan = {
      actor,
      baseLevel,
      choice,
      castingMode,
      usesSorcerySlot,
      metamagic,
      totalCost,
      resourceCost,
      spendResource,
      override,
      cooldowns,
      highLevelCasts,
      key,
      activeCooldown,
      highLevelRepeat
    };
    plan.range = stored?.range ? deepClone(stored.range) : null;
    plan.duration = stored?.duration ? deepClone(stored.duration) : null;
    plan.activation = stored?.activation ? deepClone(stored.activation) : null;
    this.#resolvePlannedActivityChanges(activity, plan);
    if (!(await this.#validateSelectedDocuments(plan))) {
      notifyWarning("Selected metamagic targets are no longer valid.");
      return null;
    }

    return plan;
  }

  #resolvePlannedActivityChanges(activity, plan) {
    const ids = plan.metamagic?.ids ?? [];
    if (ids.includes("distant-spell") && !plan.range) {
      const range = spellRange(activity);
      plan.range = range.units === "touch"
        ? { value: 30, units: "ft" }
        : { value: range.value * 2, units: range.units };
    }
    if (ids.includes("extended-spell") && !plan.duration) {
      const duration = spellDuration(activity);
      plan.duration = durationFromSeconds(durationSeconds(duration) * 2, duration.units);
    }
    if (ids.includes("quickened-spell") && !plan.activation) {
      plan.activation = { type: "bonus", value: 1 };
    }
  }

  async handleCreatedItem(item, _options = {}, userId = "") {
    if (!isCurrentUserHook(userId) || (!isSorcererClassItem(item) && !isSorceryPointsItem(item))) {
      return true;
    }

    await this.syncSorceryPoints(actorFrom(item));
    return true;
  }

  async handleUpdatedItem(item, changed = {}, _options = {}, userId = "") {
    if (!isCurrentUserHook(userId) || !isSorcererClassItem(item)) {
      return true;
    }

    const levelChanged = getProperty(changed, "system.levels", undefined) !== undefined
      || getProperty(changed, "system.level", undefined) !== undefined
      || getProperty(changed, "levels", undefined) !== undefined;
    if (levelChanged) {
      await this.syncSorceryPoints(actorFrom(item));
    }
    return true;
  }

  async syncSorceryPoints(actor) {
    const max = scaleValue(actor, SORCERY_POINTS_SCALE_ID);
    if (!actor || max <= 0) {
      return null;
    }

    let points = pointsFeature(actor);
    if (!points && typeof actor.createEmbeddedDocuments === "function") {
      const created = await actor.createEmbeddedDocuments("Item", [resourceData(max)], { renderSheet: false });
      points = pointsFeature(actor) ?? collectionValues(created).find(isSorceryPointsItem) ?? null;
    }

    if (!points) {
      return null;
    }

    const uses = points.system?.uses ?? {};
    const spent = Math.max(0, toInteger(uses.spent, 0));
    const patch = {};
    if (toInteger(uses.max, -1) !== max) {
      patch["system.uses.max"] = max;
    }
    if (JSON.stringify(uses.recovery ?? []) !== JSON.stringify(SORCERY_POINTS_RECOVERY)) {
      patch["system.uses.recovery"] = deepClone(SORCERY_POINTS_RECOVERY);
    }
    if (spent > max) {
      patch["system.uses.spent"] = max;
    }
    await updateDocument(points, patch);
    return points;
  }

  async spendSorceryPoints(actor, amount = 0) {
    const cost = Math.max(0, toInteger(amount, 0));
    if (!cost) {
      return true;
    }

    const points = await this.syncSorceryPoints(actor) ?? pointsFeature(actor);
    if (!points) {
      return false;
    }

    const uses = points.system?.uses ?? {};
    const max = Math.max(0, toInteger(uses.max, scaleValue(actor, SORCERY_POINTS_SCALE_ID)));
    const spent = Math.max(0, toInteger(uses.spent, 0));
    if (max - spent < cost) {
      return false;
    }

    await updateDocument(points, { "system.uses.spent": spent + cost });
    return true;
  }

  async restoreSorceryPoints(actor, amount = 0) {
    const refund = Math.max(0, toInteger(amount, 0));
    if (!refund) {
      return true;
    }

    const points = await this.syncSorceryPoints(actor) ?? pointsFeature(actor);
    if (!points) {
      return false;
    }

    const spent = Math.max(0, toInteger(points.system?.uses?.spent, 0));
    await updateDocument(points, { "system.uses.spent": Math.max(0, spent - refund) });
    return true;
  }

  async handleRestCompleted(actor, result = {}, config = {}) {
    if (!isLongRest(result, config)) {
      return true;
    }

    const points = await this.syncSorceryPoints(actor) ?? pointsFeature(actor);
    if (points && Math.max(0, toInteger(points?.system?.uses?.spent, 0)) > 0) {
      await updateDocument(points, { "system.uses.spent": 0 });
    }
    await setActorFlag(actor, COOLDOWNS_FLAG, {});
    await setActorFlag(actor, HIGH_LEVEL_CASTS_FLAG, {});
    return true;
  }

  async handleCombatTurnChange(combat, updateData = {}, updateOptions = {}) {
    if (toInteger(updateOptions?.direction, 1) < 0) {
      return true;
    }
    const actor = this.#resolveCombatTurnActor(combat, updateData);
    if (!actor) {
      return true;
    }

    const cooldowns = actorFlag(actor, COOLDOWNS_FLAG);
    const changedCooldowns = [];
    for (const [key, record] of Object.entries(cooldowns)) {
      if (!hasOwnerTurnCooldown(record)) {
        continue;
      }
      const remaining = cooldownRemaining(record);
      if (remaining <= 0) {
        continue;
      }
      const nextRemaining = remaining - 1;
      cooldowns[key] = { ...record, remaining: nextRemaining };
      changedCooldowns.push({ key, remaining: nextRemaining });
    }
    if (!changedCooldowns.length) {
      return true;
    }

    await setActorFlag(actor, COOLDOWNS_FLAG, cooldowns);
    await Promise.all(changedCooldowns.map(({ key, remaining }) => (
      this.#updateCooldownCards(actor, key, remaining)
    )));
    return true;
  }

  #resolveCombatTurnActor(combat, updateData = {}) {
    const directActor = updateData?.combatant?.actor;
    if (directActor) {
      return directActor;
    }

    const combatantId = cleanText(updateData?.combatantId);
    if (combatantId) {
      const combatant = combat?.combatants?.get?.(combatantId)
        ?? collectionValues(combat?.combatants).find((entry) => cleanText(entry?.id) === combatantId);
      if (combatant?.actor) {
        return combatant.actor;
      }
    }

    const turn = Number(updateData?.turn);
    if (Number.isInteger(turn)) {
      const combatant = collectionValues(combat?.turns)[turn];
      if (combatant?.actor) {
        return combatant.actor;
      }
    }
    return combat?.combatant?.actor ?? null;
  }

  async #updateCooldownCards(actor, cooldownKey, remaining) {
    const updates = collectionValues(globalThis.game?.messages)
      .map((message) => ({ message, metadata: cooldownCardFlag(message) }))
      .filter(({ metadata }) => isCooldownCardForActor(metadata, actor, cooldownKey))
      .map(({ message, metadata }) => updateDocument(message, {
        content: withCooldownCardFooter(message?.content, remaining),
        [`flags.${MODULE_ID}.${COOLDOWN_CARD_FLAG}`]: {
          ...metadata,
          remaining: Math.max(0, toInteger(remaining, 0))
        }
      }));
    const results = await Promise.allSettled(updates);
    for (const result of results) {
      if (result.status === "rejected") {
        console.error(`${MODULE_ID} | Failed to update Sorcerer cooldown chat card.`, result.reason);
      }
    }
  }

  deferDnd5ePreUseActivity(activity, usageConfig = {}, dialogConfig = {}, messageConfig = {}) {
    if (!isSorcererSpellActivity(activity)) {
      return true;
    }

    if (usageConfig?.[MODULE_ID]?.[PREFLIGHT_FLAG]) {
      const preflightPlan = this.#preflightPlan(activity, usageConfig);
      if (!preflightPlan) {
        notifyWarning("The stored Sorcerer spell plan is no longer valid.");
        return false;
      }
      this.#applyMetamagicConfig(activity, usageConfig, preflightPlan, messageConfig);
      return true;
    }

    if (this.#isFinalDnd5eUse(usageConfig)) {
      return true;
    }

    if (this._deferredActivities.has(activity)) {
      return false;
    }

    this._deferredActivities.add(activity);
    void this.#resolvePreflightDnd5eUse(activity, usageConfig, dialogConfig, messageConfig);
    return false;
  }

  finalizeDnd5ePreUseActivity(activity, usageConfig = {}, dialogConfig = {}, messageConfig = {}) {
    if (
      this.#isFinalDnd5eUse(usageConfig)
      || !isSorcererSpellActivity(activity)
      || usageConfig?.[MODULE_ID]?.[PREFLIGHT_FLAG] === undefined
      || usageConfig?.flags?.[MODULE_ID]?.[REACTION_CHECK_COMPLETE_FLAG] !== true
    ) {
      return true;
    }
    if (this._finalizingActivities.has(activity)) {
      return false;
    }

    this._finalizingActivities.add(activity);
    void this.#resolveFinalDnd5eUse(activity, usageConfig, dialogConfig, messageConfig);
    return false;
  }

  async applyDnd5ePreUseActivity(activity, usageConfig = {}, dialogConfig = {}, messageConfig = {}) {
    if (this.#isFinalDnd5eUse(usageConfig) || !isSorcererSpellActivity(activity)) {
      return true;
    }

    const result = await this.#applyVirtualSlotPayment(activity, usageConfig, dialogConfig, messageConfig);
    return result !== null;
  }

  async applyDnd5ePostAttackRoll(rolls = [], context = {}) {
    const activity = context?.subject ?? context?.activity ?? null;
    const safeRolls = Array.isArray(rolls) ? rolls : [rolls].filter(Boolean);
    let pending = activity ? this._pendingSeekingAttacks.get(activity) : null;
    if (!pending) {
      const record = this.#rollUsageRecord(safeRolls)?.attackReroll;
      if (record && activity) {
        pending = {
          actor: actorFrom(activity),
          activity,
          cost: Math.max(0, toInteger(record.cost, 2)),
          used: false,
          charged: false
        };
        this._pendingSeekingAttacks.set(activity, pending);
      }
    }
    if (!pending || pending.used || !isSorcererSpellActivity(activity)) {
      return true;
    }

    if (!safeRolls.some((roll) => roll?.isFailure === true)) {
      return true;
    }

    const points = pointsFeature(pending.actor);
    const cost = Math.max(0, toInteger(pending.cost, 2));
    const spent = Math.max(0, toInteger(points?.system?.uses?.spent, 0));
    const max = Math.max(0, toInteger(points?.system?.uses?.max, 0));
    if (cost > 0 && (!points || max - spent < cost)) {
      return true;
    }

    if (!(await this.#chooseSeekingReroll(activity, safeRolls, cost))) {
      return true;
    }

    pending.used = true;
    try {
      if (cost > 0) {
        await updateDocument(points, { "system.uses.spent": spent + cost });
        pending.charged = true;
      }
      const usageMessageId = this.#rollUsageMessageId(safeRolls);
      const rerolled = await activity.rollAttack({}, {}, usageMessageId
        ? { data: { "flags.dnd5e.originatingMessage": usageMessageId } }
        : {});
      if (!rerolled && cost > 0) {
        await updateDocument(points, { "system.uses.spent": spent });
        pending.charged = false;
        pending.used = false;
      }
    }
    catch (error) {
      if (pending.charged) {
        await updateDocument(points, { "system.uses.spent": spent });
      }
      pending.charged = false;
      pending.used = false;
      console.error(`${MODULE_ID} | Failed to reroll a missed Seeking Spell attack.`, error);
    }
    return true;
  }

  async #chooseSeekingReroll(activity, rolls, cost = 2) {
    if (this._options.chooseSeekingReroll instanceof Function) {
      return (await this._options.chooseSeekingReroll({ activity, rolls, cost })) === true;
    }
    const DialogV2 = dialogV2();
    if (typeof DialogV2?.wait !== "function") {
      return false;
    }
    const content = cost > 0
      ? `<div class="rebreya-sorcerer-dialog-copy">Spend ${cost} Sorcery Points to reroll this missed spell attack?</div>`
      : `<div class="rebreya-sorcerer-dialog-copy">Reroll this missed spell attack?</div>`;
    const result = await DialogV2.wait({
      window: { title: "Seeking Spell" },
      content,
      buttons: [
        { action: "reroll", label: "Reroll", default: true, callback: () => true },
        { action: "cancel", label: "Cancel", callback: () => false }
      ]
    });
    return result === true;
  }

  handleDnd5ePostCreateUsageMessage(_activity, message) {
    const overrides = typeof message?.getFlag === "function"
      ? message.getFlag(MODULE_ID, "saveOverrides")
      : getProperty(message, `flags.${MODULE_ID}.saveOverrides`, null);
    const id = cleanText(message?.id ?? message?._id);
    if (id && overrides && typeof overrides === "object") {
      this._saveOverridesByMessage.set(id, deepClone(overrides));
    }
    if (id) {
      const record = typeof message?.getFlag === "function"
        ? {
          damageReroll: message.getFlag(MODULE_ID, "damageReroll"),
          damageBonus: message.getFlag(MODULE_ID, "damageBonus"),
          attackReroll: message.getFlag(MODULE_ID, "attackReroll")
        }
        : getProperty(message, `flags.${MODULE_ID}`, {});
      if (record?.damageReroll || record?.damageBonus || record?.attackReroll) {
        this._metamagicRecordsByMessage.set(id, deepClone(record));
      }
    }
    const cooldown = cooldownCardFlag(message);
    const spellCast = spellCastCardFlag(message);
    const patch = {};
    let content = String(message?.content ?? "");
    if (spellCast) {
      content = withMetamagicCardFooter(content, spellCast);
    }
    if (cooldown) {
      content = withCooldownCardFooter(content, cooldown.remaining);
      patch[`flags.${MODULE_ID}.${COOLDOWN_CARD_FLAG}`] = cooldown;
    }
    if (content !== String(message?.content ?? "")) {
      patch.content = content;
    }
    if (Object.keys(patch).length) {
      updateDocument(message, patch).catch((error) => {
        console.error(`${MODULE_ID} | Failed to update Sorcerer usage chat card.`, error);
      });
    }
    return true;
  }

  #rollUsageMessageId(rolls = []) {
    const parent = (Array.isArray(rolls) ? rolls : [rolls])[0]?.parent ?? null;
    return cleanText(
      parent?.flags?.dnd5e?.originatingMessage
      ?? getProperty(parent, "flags.dnd5e.originatingMessage", undefined)
      ?? parent?.getFlag?.("dnd5e", "originatingMessage")
    );
  }

  #rollUsageRecord(rolls = []) {
    const usageMessageId = this.#rollUsageMessageId(rolls);
    if (!usageMessageId) {
      return null;
    }
    const cached = this._metamagicRecordsByMessage.get(usageMessageId);
    if (cached) {
      return cached;
    }
    const message = globalThis.game?.messages?.get?.(usageMessageId);
    const record = typeof message?.getFlag === "function"
      ? {
        damageReroll: message.getFlag(MODULE_ID, "damageReroll"),
        damageBonus: message.getFlag(MODULE_ID, "damageBonus"),
        attackReroll: message.getFlag(MODULE_ID, "attackReroll")
      }
      : getProperty(message, `flags.${MODULE_ID}`, null);
    if (record?.damageReroll || record?.damageBonus || record?.attackReroll) {
      this._metamagicRecordsByMessage.set(usageMessageId, deepClone(record));
      return record;
    }
    return null;
  }

  applyDnd5ePreRollSavingThrow(rollConfig = {}) {
    const messageId = rollConfigMessageId(rollConfig);
    let overrides = this._saveOverridesByMessage.get(messageId);
    if (!overrides && messageId) {
      const message = globalThis.game?.messages?.get?.(messageId);
      const sourceMessage = message ?? rollConfig?.message;
      const persisted = typeof sourceMessage?.getFlag === "function"
        ? sourceMessage.getFlag(MODULE_ID, "saveOverrides")
        : getProperty(sourceMessage, `flags.${MODULE_ID}.saveOverrides`, null);
      if (persisted && typeof persisted === "object") {
        overrides = deepClone(persisted);
        this._saveOverridesByMessage.set(messageId, overrides);
      }
    }
    const actorUuid = cleanText(rollConfig?.subject?.uuid);
    let cacheKey = messageId;
    if (!overrides && actorUuid) {
      const cached = Array.from(this._saveOverridesByMessage.entries())
        .reverse()
        .find(([, entry]) => saveOverridesTargetMatches(entry, actorUuid));
      if (cached) {
        [cacheKey, overrides] = cached;
      }
    }
    if (!overrides || !actorUuid) {
      return true;
    }

    const targetMatches = (uuid) => cleanText(uuid) === actorUuid;
    if ((overrides.carefulTargetUuids ?? []).some(targetMatches)) {
      rollConfig.target = 0;
      for (const roll of rollConfig.rolls ?? []) {
        roll.options ??= {};
        roll.options.target = 0;
      }
    }
    if (!overrides.heightenedUsed && targetMatches(overrides.heightenedTargetUuid)) {
      rollConfig.disadvantage = true;
      for (const roll of rollConfig.rolls ?? []) {
        roll.options ??= {};
        roll.options.disadvantage = true;
      }
      overrides.heightenedUsed = true;
      if (cacheKey) {
        this._saveOverridesByMessage.set(cacheKey, overrides);
      }
    }
    return true;
  }

  applyDnd5ePreRollDamage(rollConfig = {}, _dialogConfig = {}, _messageConfig = {}) {
    const messageId = rollConfigMessageId(rollConfig);
    let record = messageId ? this._metamagicRecordsByMessage.get(messageId) : null;
    if (!record && messageId) {
      const message = globalThis.game?.messages?.get?.(messageId) ?? rollConfig?.message;
      const damageBonus = typeof message?.getFlag === "function"
        ? message.getFlag(MODULE_ID, "damageBonus")
        : getProperty(message, `flags.${MODULE_ID}.damageBonus`, null);
      if (damageBonus) {
        record = { damageBonus };
        this._metamagicRecordsByMessage.set(messageId, deepClone(record));
      }
    }

    const bonus = record?.damageBonus;
    if (!bonus?.formula) {
      return true;
    }
    if (damageRollConfigHasBonus(rollConfig, bonus)) {
      return true;
    }
    const activity = rollConfig?.subject ?? rollConfig?.activity ?? null;
    const damageType = normalizedDamageType(bonus.damageType);
    const source = damageBonusSource(bonus);
    rollConfig.rolls ??= [];
    rollConfig.rolls.push({
      data: actorFrom(activity)?.getRollData?.() ?? {},
      parts: [cleanText(bonus.formula)],
      options: {
        type: damageType,
        types: damageType ? [damageType] : [],
        flavor: damageBonusFlavor(bonus),
        rebreyaDamageBonusSource: source,
        [MODULE_ID]: {
          damageBonusSource: source
        }
      }
    });
    return true;
  }

  async applyDnd5ePostDamageRoll(rolls = [], context = {}) {
    const activity = context?.subject ?? null;
    const safeRolls = Array.isArray(rolls) ? rolls : [rolls].filter(Boolean);
    let pending = activity ? this._pendingEmpoweredDamage.get(activity) : null;
    if (!pending) {
      const record = this.#rollUsageRecord(safeRolls)?.damageReroll;
      const selectedDamageDice = record && activity
        ? normalizedDamageDice(activity, record.selectedDamageDice)
        : null;
      if (selectedDamageDice?.length) {
        pending = { actor: actorFrom(activity), selectedDamageDice, used: false };
        this._pendingEmpoweredDamage.set(activity, pending);
      }
    }
    if (!pending || pending.used) {
      return true;
    }
    const selections = pending.selectedDamageDice.filter((choice) => choice && typeof choice === "object");
    if (!selections.length) {
      return true;
    }

    const diceFor = (roll) => {
      const dice = [];
      const collect = (terms = []) => {
        for (const term of terms) {
          if (Array.isArray(term?.results)) dice.push(term);
          if (Array.isArray(term?.dice)) collect(term.dice);
        }
      };
      collect(roll?.terms ?? []);
      return dice;
    };
    let rerolled = false;
    for (const selection of selections) {
      const roll = safeRolls[selection.partIndex];
      const die = diceFor(roll).flatMap((term) => term.results.map((result, index) => ({ term, result, index })))[selection.dieIndex];
      if (!die?.result?.active || typeof die.term.roll !== "function") {
        continue;
      }
      die.result.active = false;
      die.result.rerolled = true;
      await die.term.roll({ reroll: true });
      if (typeof roll?._evaluateTotal === "function") {
        roll._total = roll._evaluateTotal();
      }
      rerolled = true;
    }
    if (rerolled) {
      pending.used = true;
      const message = safeRolls.find((roll) => roll?.parent)?.parent;
      if (typeof message?.update === "function") {
        await message.update({ rolls: safeRolls.map((roll) => roll.toJSON?.() ?? roll) });
      }
    }
    return true;
  }

  async #applyVirtualSlotPayment(activity, usageConfig = {}, dialogConfig = {}, messageConfig = {}) {
    const actor = actorFrom(activity);
    return this.#withActorPaymentLock(actor, () => this.#applyVirtualSlotPaymentLocked(
      activity,
      usageConfig,
      dialogConfig,
      messageConfig
    ));
  }

  async #withActorPaymentLock(actor, operation) {
    if (!actor || typeof actor !== "object") {
      return operation();
    }
    const previous = this._paymentLocks.get(actor) ?? Promise.resolve();
    let release;
    const next = new Promise((resolve) => { release = resolve; });
    this._paymentLocks.set(actor, previous.catch(() => undefined).then(() => next));
    await previous.catch(() => undefined);
    try {
      return await operation();
    }
    finally {
      release();
    }
  }

  async #applyVirtualSlotPaymentLocked(activity, usageConfig = {}, dialogConfig = {}, messageConfig = {}) {
    if (!isSorcererSpellActivity(activity)) {
      return null;
    }

    const plan = await this.#prepareCastPlan(activity, usageConfig, dialogConfig);
    if (!plan) {
      return null;
    }

    const {
      actor,
      baseLevel,
      choice,
      castingMode,
      usesSorcerySlot,
      metamagic,
      totalCost,
      override,
      cooldowns,
      highLevelCasts,
      key,
      activeCooldown,
      highLevelRepeat
    } = plan;
    const cooldownCard = usesSorcerySlot
      && choice.spellLevel <= 5
      && !(activeCooldown && override)
      ? cooldownCardMetadata(actor, key, choice.spellLevel)
      : null;
    const points = pointsFeature(actor);
    const uses = points?.system?.uses ?? {};
    const spent = Math.max(0, toInteger(uses.spent, 0));

    const exhaustion = override ? 1 : 0;
    const state = {
      actor,
      points,
      spent,
      cooldowns: deepClone(cooldowns),
      highLevelCasts: deepClone(highLevelCasts),
      exhaustion: exhaustionLevel(actor),
      pointsChanged: false,
      cooldownsChanged: false,
      highLevelCastsChanged: false,
      exhaustionChanged: false,
      actorUpdatesChanged: false,
      actorRollbackUpdates: {},
      metamagicEffects: [],
      rolledBack: false
    };

    this.#persistResolvedPlan(usageConfig, plan);
    const metamagicConfig = this.#applyMetamagicConfig(activity, usageConfig, plan, messageConfig);
    const passiveConfig = this.#applyPassiveSorcererFeatureConfig(activity, plan, messageConfig);
    try {
      if (totalCost > 0) {
        await updateDocument(points, { "system.uses.spent": spent + totalCost });
        state.pointsChanged = true;
      }
      if (usesSorcerySlot && choice.spellLevel <= 5) {
        cooldowns[key] = { remaining: choice.spellLevel };
        await setActorFlag(actor, COOLDOWNS_FLAG, cooldowns);
        state.cooldownsChanged = true;
      }
      if (usesSorcerySlot && choice.spellLevel >= 6) {
        highLevelCasts[String(choice.spellLevel)] = true;
        await setActorFlag(actor, HIGH_LEVEL_CASTS_FLAG, highLevelCasts);
        state.highLevelCastsChanged = true;
      }
      if (exhaustion) {
        await updateDocument(actor, { "system.attributes.exhaustion": state.exhaustion + exhaustion });
        state.exhaustionChanged = true;
      }
      if (Object.keys(metamagicConfig.actorUpdates ?? {}).length) {
        for (const path of Object.keys(metamagicConfig.actorUpdates)) {
          state.actorRollbackUpdates[path] = deepClone(getProperty(actor, path));
        }
        await updateDocument(actor, metamagicConfig.actorUpdates);
        state.actorUpdatesChanged = true;
      }
      state.metamagicEffects = await createActorEffects(actor, metamagicConfig.actorEffects);
      if (metamagic.ids.includes("empowered-spell") && metamagic.rerollDamage) {
        await metamagic.rerollDamage(metamagic.selectedDamageDice);
      }
    }
    catch (error) {
      await this.#rollbackVirtualSlotPayment(state);
      throw error;
    }

    this.#applyCooldownCardConfig(messageConfig, cooldownCard);

    if (usesSorcerySlot) {
      const consume = usageConfig.consume && typeof usageConfig.consume === "object"
        ? usageConfig.consume
        : (usageConfig.consume = {});
      consume.spellSlot = false;
      consume.resources = false;
      if (usageConfig.cause && typeof usageConfig.cause === "object") {
        usageConfig.cause.resources = false;
      }
      usageConfig.spell ??= {};
      usageConfig.spell.slot = `spell${choice.spellLevel}`;
      usageConfig.scaling = Math.max(0, choice.spellLevel - baseLevel);
    }
    usageConfig.spellCast = {
      spellLevel: choice.spellLevel,
      castingMode,
      components: metamagicConfig.components,
      payment: {
        resource: "sorcery-points",
        cost: totalCost
      },
      metamagic: metamagicSummary(metamagic, choice.spellLevel),
      modifiers: {
        cooldownOverride: activeCooldown && override,
        exhaustion,
        highLevelOverride: highLevelRepeat && override,
        ...metamagicConfig.modifiers,
        ...passiveConfig.modifiers
      }
    };
    if (plan.range) {
      usageConfig.spellCast.range = deepClone(plan.range);
    }
    if (plan.duration) {
      usageConfig.spellCast.duration = deepClone(plan.duration);
    }
    if (plan.activation) {
      usageConfig.spellCast.activation = deepClone(plan.activation);
    }
    if (metamagic.ids.length) {
      usageConfig.flags ??= {};
      usageConfig.flags[MODULE_ID] ??= {};
      usageConfig.flags[MODULE_ID].spellCast = deepClone(usageConfig.spellCast);
    }
    this.#applySpellCastMessageConfig(messageConfig, usageConfig.spellCast);
    return state;
  }

  async #resolvePreflightDnd5eUse(activity, usageConfig, dialogConfig, messageConfig) {
    try {
      if (typeof activity?.use !== "function") {
        return;
      }

      const plan = await this.#prepareCastPlan(activity, usageConfig, dialogConfig);
      if (!plan) {
        return;
      }
      const preflightUsageConfig = {
        ...usageConfig,
        [MODULE_ID]: {
          ...(usageConfig?.[MODULE_ID] ?? {})
        }
      };
      this.#persistResolvedPlan(preflightUsageConfig, plan);
      const metamagicConfig = this.#applyMetamagicConfig(activity, preflightUsageConfig, plan, messageConfig);
      preflightUsageConfig.spellCast = {
        spellLevel: plan.choice.spellLevel,
        castingMode: plan.castingMode,
        components: metamagicConfig.components,
        payment: { resource: "sorcery-points", cost: plan.totalCost },
        metamagic: metamagicSummary(plan.metamagic, plan.choice.spellLevel),
        modifiers: metamagicConfig.modifiers
      };
      if (plan.range) preflightUsageConfig.spellCast.range = deepClone(plan.range);
      if (plan.duration) preflightUsageConfig.spellCast.duration = deepClone(plan.duration);
      if (plan.activation) preflightUsageConfig.spellCast.activation = deepClone(plan.activation);
      preflightUsageConfig.flags ??= {};
      preflightUsageConfig.flags[MODULE_ID] ??= {};
      preflightUsageConfig.flags[MODULE_ID].spellCast = deepClone(preflightUsageConfig.spellCast);
      this.#applySpellCastMessageConfig(messageConfig, preflightUsageConfig.spellCast);
      await activity.use(
        preflightUsageConfig,
        this.#resumeDialogConfig(dialogConfig),
        messageConfig
      );
    }
    catch (error) {
      console.error(`${MODULE_ID} | Failed to resume Sorcerer spell preflight.`, error);
    }
    finally {
      this._deferredActivities.delete(activity);
    }
  }

  async #resolveFinalDnd5eUse(activity, usageConfig, dialogConfig, messageConfig) {
    try {
      if (typeof activity?.use !== "function") {
        return;
      }
      await this.#withActorPaymentLock(actorFrom(activity), async () => {
        const payment = await this.#applyVirtualSlotPaymentLocked(
          activity,
          usageConfig,
          dialogConfig,
          messageConfig
        );
        if (!payment) {
          return;
        }
        try {
          const result = await activity.use(
            this.#resumeUsageConfig(usageConfig),
            this.#resumeDialogConfig(dialogConfig),
            messageConfig
          );
          if (!result) {
            await this.#rollbackVirtualSlotPayment(payment);
          }
        }
        catch (error) {
          await this.#rollbackVirtualSlotPayment(payment);
          throw error;
        }
      });
    }
    catch (error) {
      console.error(`${MODULE_ID} | Failed to resume paid Sorcerer spell use.`, error);
    }
    finally {
      this._finalizingActivities.delete(activity);
    }
  }

  async #rollbackVirtualSlotPayment(state) {
    if (!state || state.rolledBack) {
      return;
    }
    state.rolledBack = true;

    const updates = [];
    if (state.pointsChanged) {
      updates.push(updateDocument(state.points, { "system.uses.spent": state.spent }));
    }
    if (state.cooldownsChanged) {
      updates.push(setActorFlag(state.actor, COOLDOWNS_FLAG, state.cooldowns));
    }
    if (state.highLevelCastsChanged) {
      updates.push(setActorFlag(state.actor, HIGH_LEVEL_CASTS_FLAG, state.highLevelCasts));
    }
    if (state.exhaustionChanged) {
      updates.push(updateDocument(state.actor, { "system.attributes.exhaustion": state.exhaustion }));
    }
    if (state.actorUpdatesChanged) {
      updates.push(updateDocument(state.actor, state.actorRollbackUpdates));
    }
    if (state.metamagicEffects?.length) {
      updates.push(deleteActorEffects(state.actor, state.metamagicEffects));
    }
    const results = await Promise.allSettled(updates);
    for (const result of results) {
      if (result.status === "rejected") {
        console.error(`${MODULE_ID} | Failed to roll back Sorcerer virtual-slot payment.`, result.reason);
      }
    }
  }

  #resumeUsageConfig(usageConfig = {}) {
    return {
      ...usageConfig,
      [MODULE_ID]: {
        ...(usageConfig?.[MODULE_ID] ?? {}),
        [FINAL_BYPASS_FLAG]: true
      }
    };
  }

  #resumeDialogConfig(dialogConfig = {}) {
    return {
      ...dialogConfig,
      configure: false
    };
  }

  #isFinalDnd5eUse(usageConfig) {
    return usageConfig?.[MODULE_ID]?.[FINAL_BYPASS_FLAG] === true;
  }
}
