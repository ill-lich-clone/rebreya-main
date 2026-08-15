import { MODULE_ID } from "../constants.js";

const IGNORED_FACES = new Set([20, 100]);
const PATCH_STATE = Symbol.for(`${MODULE_ID}.mechanusRollPatch`);
const ROLL_APPLIED = Symbol.for(`${MODULE_ID}.mechanusAverageApplied`);
const ROLL_EVALUATE_TARGET = "Roll.prototype.evaluate";
const ROLL_EVALUATE_SYNC_TARGET = "Roll.prototype.evaluateSync";

function toFiniteNumber(value, fallback = NaN) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function toPositiveInteger(value, fallback = 0) {
  const numeric = Math.floor(toFiniteNumber(value, fallback));
  return Number.isFinite(numeric) && numeric > 0 ? numeric : fallback;
}

function toNonNegativeInteger(value, fallback = 0) {
  const numeric = Math.floor(toFiniteNumber(value, fallback));
  return Number.isFinite(numeric) && numeric >= 0 ? numeric : fallback;
}

function diceTermPattern() {
  return /(^|[^\w.])(\d*)d(\d+)((?:k[hl]|d[hl])\d*)?(?![\w])/giu;
}

function finalizeMechanusTotal(value) {
  const numeric = toFiniteNumber(value);
  if (!Number.isFinite(numeric)) {
    return null;
  }

  return Number.isInteger(numeric) ? numeric : Math.floor(numeric);
}

function isSafeArithmeticFormula(formula) {
  return /^[\d+\-*/().\s]+$/u.test(String(formula ?? ""));
}

function evaluateSafeFormula(formula) {
  if (!isSafeArithmeticFormula(formula)) {
    return null;
  }

  try {
    const result = Function(`"use strict"; return (${formula});`)();
    return finalizeMechanusTotal(result);
  }
  catch (_error) {
    return null;
  }
}

function hasRemainingDice(formula) {
  return diceTermPattern().test(String(formula ?? ""));
}

function getTermFaces(term) {
  return toPositiveInteger(term?.faces ?? term?._faces, 0);
}

function getTermNumber(term) {
  return toNonNegativeInteger(term?.number ?? term?._number, 1);
}

function getResultValue(result) {
  return toFiniteNumber(result?.result ?? result?.value, NaN);
}

function isResultActive(result) {
  return result?.active !== false && result?.discarded !== true;
}

function getTermTotal(term) {
  const directTotal = toFiniteNumber(term?.total, NaN);
  if (Number.isFinite(directTotal)) {
    return directTotal;
  }

  if (!Array.isArray(term?.results)) {
    return NaN;
  }

  return term.results.reduce((sum, result) => {
    if (!isResultActive(result)) {
      return sum;
    }

    const value = getResultValue(result);
    return Number.isFinite(value) ? sum + value : sum;
  }, 0);
}

function getTermModifiers(term) {
  if (Array.isArray(term?.modifiers)) {
    return term.modifiers.map((modifier) => String(modifier ?? "").trim().toLowerCase()).filter(Boolean);
  }

  if (term?.modifiers instanceof Set) {
    return Array.from(term.modifiers, (modifier) => String(modifier ?? "").trim().toLowerCase()).filter(Boolean);
  }

  const rawModifiers = String(term?.modifiers ?? "").trim().toLowerCase();
  return rawModifiers ? [rawModifiers] : [];
}

function getDiceSelectionModifier(term) {
  return getTermModifiers(term).find((modifier) => /^(?:k[hl]|d[hl])\d*$/u.test(modifier)) ?? "";
}

function getSelectedDiceNumber(number, modifier = "") {
  const diceNumber = Math.max(0, Math.floor(toFiniteNumber(number, 0)));
  const normalizedModifier = String(modifier ?? "").trim().toLowerCase();
  const match = normalizedModifier.match(/^([kd][hl])(\d*)$/u);
  if (!match) {
    return diceNumber;
  }

  const requested = match[2] ? Math.max(0, Math.floor(toFiniteNumber(match[2], 0))) : 1;
  const count = Math.min(diceNumber, requested);
  return match[1].startsWith("k") ? count : Math.max(0, diceNumber - count);
}

function getTermSelectedNumber(term) {
  if (Array.isArray(term?.results) && term.results.length > 0) {
    return term.results.reduce((count, result) => count + (isResultActive(result) ? 1 : 0), 0);
  }

  return getSelectedDiceNumber(getTermNumber(term), getDiceSelectionModifier(term));
}

function getD20KeepModifier(term) {
  return getTermModifiers(term).find((modifier) => modifier.startsWith("kh") || modifier.startsWith("kl")) ?? "";
}

function getD20KeepModifierFromFormula(term, roll) {
  for (const formula of [term?.expression, term?.formula, term?._formula, roll?.formula]) {
    const match = String(formula ?? "").toLowerCase().match(/(?:^|[^\w])(?:\d+\s*)?d\s*20\s*(k[hl]\d*)/u);
    if (match?.[1]) {
      return match[1];
    }
  }

  return "";
}

function getFirstResult(term) {
  if (!Array.isArray(term?.results) || term.results.length === 0) {
    return NaN;
  }

  return getResultValue(term.results[0]);
}

function getD20AdvantageMode(term, roll) {
  const keepModifier = getD20KeepModifier(term);
  if (keepModifier.startsWith("kh")) {
    return 1;
  }
  if (keepModifier.startsWith("kl")) {
    return -1;
  }

  const explicitMode = toFiniteNumber(term?.options?.advantageMode ?? roll?.options?.advantageMode, NaN);
  if (explicitMode > 0) {
    return 1;
  }
  if (explicitMode < 0) {
    return -1;
  }

  const formulaModifier = getD20KeepModifierFromFormula(term, roll);
  if (formulaModifier.startsWith("kh")) {
    return 1;
  }
  if (formulaModifier.startsWith("kl")) {
    return -1;
  }

  const hasAdvantage = term?.options?.advantage === true || roll?.options?.advantage === true || roll?.hasAdvantage === true;
  const hasDisadvantage = term?.options?.disadvantage === true || roll?.options?.disadvantage === true || roll?.hasDisadvantage === true;
  if (hasAdvantage && !hasDisadvantage) {
    return 1;
  }
  if (hasDisadvantage && !hasAdvantage) {
    return -1;
  }

  return 0;
}

function getMechanusD20AdvantageBonus(term, roll) {
  if (getTermFaces(term) !== 20 || getTermNumber(term) < 2) {
    return null;
  }

  const mode = getD20AdvantageMode(term, roll);
  if (!mode) {
    return null;
  }

  return mode > 0 ? 2 : -2;
}

function refreshRollFormulaFromTerms(roll) {
  if (!Array.isArray(roll?.terms)) {
    return false;
  }

  const formulaParts = roll.terms.map((term) => {
    if (typeof term === "string") {
      return term;
    }
    return typeof term?.formula === "string" ? term.formula : null;
  });
  if (formulaParts.some((part) => part === null)) {
    return false;
  }

  const formula = formulaParts.join("");
  try {
    roll._formula = formula;
  }
  catch (_error) {
    return false;
  }
  return roll._formula === formula;
}

function insertD20AdvantageBonusTerm(roll, term, bonus) {
  const termIndex = Array.isArray(roll?.terms) ? roll.terms.indexOf(term) : -1;
  const NumericTerm = globalThis.foundry?.dice?.terms?.NumericTerm;
  const OperatorTerm = globalThis.foundry?.dice?.terms?.OperatorTerm;
  if (termIndex < 0 || typeof NumericTerm !== "function" || typeof OperatorTerm !== "function") {
    return false;
  }

  const operator = new OperatorTerm({ operator: bonus >= 0 ? "+" : "-" });
  const numeric = new NumericTerm({
    number: Math.abs(bonus),
    options: { rebreyaMechanusAdvantageBonus: bonus }
  });
  roll.terms.splice(termIndex + 1, 0, operator, numeric);
  refreshRollFormulaFromTerms(roll);
  return true;
}

function replaceD20AdvantageWithFlatBonus(roll, term, firstResult, replacementTotal, bonus) {
  setObjectNumberProperty(term, "number", 1);
  setObjectNumberProperty(term, "_number", 1);

  if (Array.isArray(term.modifiers)) {
    term.modifiers = term.modifiers.filter((modifier) => {
      const normalized = String(modifier ?? "").trim().toLowerCase();
      return !normalized.startsWith("kh") && !normalized.startsWith("kl");
    });
  }

  if (Array.isArray(term.results)) {
    term.results.forEach((result, index) => {
      result.active = index === 0;
      result.discarded = index !== 0;
      if (index === 0) {
        result.result = firstResult;
        result.value = firstResult;
      }
    });
  }

  term.options ??= {};
  term.options.rebreyaMechanusAdvantageBonus = bonus;
  if (!insertD20AdvantageBonusTerm(roll, term, bonus)) {
    setObjectNumberProperty(term, "_total", replacementTotal);
    setObjectNumberProperty(term, "total", replacementTotal);
  }
}

function setObjectNumberProperty(object, key, value) {
  if (!object || typeof object !== "object") {
    return;
  }

  try {
    object[key] = value;
  }
  catch (_error) {
    // Readonly roll getters are overridden below when assignment is not enough.
  }

  if (toFiniteNumber(object[key], NaN) === value) {
    return;
  }

  try {
    Object.defineProperty(object, key, {
      value,
      writable: true,
      configurable: true
    });
  }
  catch (_error) {
    // Some Foundry internals are intentionally sealed; the roll total is still best-effort.
  }
}

function setRollTotal(roll, total) {
  setObjectNumberProperty(roll, "_total", total);
  setObjectNumberProperty(roll, "total", total);
}

function markRollApplied(roll) {
  try {
    Object.defineProperty(roll, ROLL_APPLIED, {
      value: true,
      configurable: true
    });
  }
  catch (_error) {
    roll[ROLL_APPLIED] = true;
  }
}

function collectDiceTerms(roll) {
  const terms = [];
  const seen = new Set();
  const candidates = [
    ...(Array.isArray(roll?.terms) ? roll.terms : []),
    ...(Array.isArray(roll?.dice) ? roll.dice : [])
  ];

  for (const term of candidates) {
    if (!term || typeof term !== "object" || seen.has(term)) {
      continue;
    }

    const faces = getTermFaces(term);
    if (!faces) {
      continue;
    }

    seen.add(term);
    terms.push(term);
  }

  return terms;
}

function replaceTermResultsWithAverage(term, averageTotal, selectedNumber = getTermNumber(term)) {
  const faces = getTermFaces(term);
  const activeNumber = Math.max(0, Math.floor(toFiniteNumber(selectedNumber, 0)));
  const perDieAverage = faces > 0 ? ((faces + 1) / 2) : averageTotal;

  if (Array.isArray(term.results) && term.results.length > 0) {
    let activeIndex = 0;
    for (const result of term.results) {
      const wasActive = isResultActive(result);
      result.result = perDieAverage;
      result.value = perDieAverage;

      if (!wasActive || activeIndex >= activeNumber) {
        result.active = false;
        result.discarded = true;
        continue;
      }

      result.active = true;
      result.discarded = false;
      activeIndex += 1;
    }

    while (activeIndex < activeNumber) {
      term.results.push({ result: perDieAverage, value: perDieAverage, active: true });
      activeIndex += 1;
    }
  }
  else {
    term.results = Array.from(
      { length: activeNumber },
      () => ({ result: perDieAverage, value: perDieAverage, active: true })
    );
  }

  setObjectNumberProperty(term, "_total", averageTotal);
  setObjectNumberProperty(term, "total", averageTotal);
}

function adjustActiveResultBy(term, delta) {
  if (!Array.isArray(term?.results)) {
    return false;
  }

  const result = [...term.results].reverse().find((entry) => isResultActive(entry));
  if (!result) {
    return false;
  }

  const current = getResultValue(result);
  if (!Number.isFinite(current)) {
    return false;
  }

  const next = current + delta;
  result.result = next;
  result.value = next;
  return true;
}

function applyFinalTotalCorrectionToTerms(terms, correction) {
  const safeCorrection = toFiniteNumber(correction, 0);
  if (!Number.isFinite(safeCorrection) || safeCorrection <= 0) {
    return false;
  }

  const targetTerm = [...terms].reverse().find((term) => {
    const total = getTermTotal(term);
    return Number.isFinite(total) && !Number.isInteger(total);
  });
  if (!targetTerm) {
    return false;
  }

  const currentTotal = getTermTotal(targetTerm);
  const nextTotal = currentTotal - safeCorrection;
  adjustActiveResultBy(targetTerm, -safeCorrection);
  setObjectNumberProperty(targetTerm, "_total", nextTotal);
  setObjectNumberProperty(targetTerm, "total", nextTotal);
  return true;
}

export function getMechanusDieAverage(number, faces) {
  const diceNumber = toNonNegativeInteger(number, 1);
  const diceFaces = toPositiveInteger(faces, 0);
  if (!diceFaces || IGNORED_FACES.has(diceFaces)) {
    return null;
  }

  return diceNumber * ((diceFaces + 1) / 2);
}

export function buildMechanusAverageFormula(formula) {
  let changed = false;
  const averaged = String(formula ?? "").replace(diceTermPattern(), (match, prefix, rawNumber, rawFaces, rawModifier = "") => {
    const number = rawNumber ? Number(rawNumber) : 1;
    const selectedNumber = getSelectedDiceNumber(number, rawModifier);
    const average = getMechanusDieAverage(selectedNumber, Number(rawFaces));
    if (average === null) {
      return match;
    }

    changed = true;
    return `${prefix}${average}`;
  });

  return { formula: averaged, changed };
}

export function computeMechanusAverageFormulaTotal(formula) {
  const averaged = buildMechanusAverageFormula(formula);
  if (!averaged.changed || hasRemainingDice(averaged.formula)) {
    return null;
  }

  return evaluateSafeFormula(averaged.formula);
}

export function applyMechanusAveragesToRoll(roll, { enabled = true } = {}) {
  if (!enabled || !roll || roll[ROLL_APPLIED]) {
    return false;
  }

  const currentRollTotal = toFiniteNumber(roll.total ?? roll._total, NaN);
  const diceTerms = collectDiceTerms(roll);
  const averagedTerms = [];
  let delta = 0;
  let changed = false;

  for (const term of diceTerms) {
    const d20AdvantageBonus = getMechanusD20AdvantageBonus(term, roll);
    if (d20AdvantageBonus !== null) {
      const currentTermTotal = getTermTotal(term);
      const firstResult = getFirstResult(term);
      if (Number.isFinite(currentTermTotal) && Number.isFinite(firstResult)) {
        const replacementTotal = firstResult + d20AdvantageBonus;
        delta += replacementTotal - currentTermTotal;
        changed = true;
        replaceD20AdvantageWithFlatBonus(roll, term, firstResult, replacementTotal, d20AdvantageBonus);
      }
      continue;
    }

    const selectedNumber = getTermSelectedNumber(term);
    const average = getMechanusDieAverage(selectedNumber, getTermFaces(term));
    if (average === null) {
      continue;
    }

    const currentTermTotal = getTermTotal(term);
    if (!Number.isFinite(currentTermTotal)) {
      continue;
    }

    delta += average - currentTermTotal;
    changed = true;
    replaceTermResultsWithAverage(term, average, selectedNumber);
    averagedTerms.push(term);
  }

  if (changed && Number.isFinite(currentRollTotal)) {
    const exactNextTotal = currentRollTotal + delta;
    const nextTotal = finalizeMechanusTotal(exactNextTotal);
    if (nextTotal !== null) {
      applyFinalTotalCorrectionToTerms(averagedTerms, exactNextTotal - nextTotal);
      setRollTotal(roll, nextTotal);
      markRollApplied(roll);
      return true;
    }
  }

  const formulaTotal = computeMechanusAverageFormulaTotal(roll.formula);
  if (formulaTotal !== null) {
    setRollTotal(roll, formulaTotal);
    markRollApplied(roll);
    return true;
  }

  return false;
}

function createMechanusAverageApplier(isEnabled) {
  return (rollContext, result) => {
    const roll = result && typeof result === "object" ? result : rollContext;
    try {
      applyMechanusAveragesToRoll(roll, { enabled: isEnabled() === true });
    }
    catch (error) {
      console.warn(`${MODULE_ID} | Failed to apply Mechanus roll averages.`, error);
    }
    return result;
  };
}

function createMechanusEvaluateWrapper(isEnabled) {
  const applyAverage = createMechanusAverageApplier(isEnabled);
  return function evaluateWithMechanusAverages(wrapped, ...args) {
    const result = wrapped(...args);
    if (typeof result?.then === "function") {
      return result.then((resolved) => applyAverage(this, resolved));
    }

    return applyAverage(this, result);
  };
}

function createMechanusEvaluateSyncWrapper(isEnabled) {
  const applyAverage = createMechanusAverageApplier(isEnabled);
  return function evaluateSyncWithMechanusAverages(wrapped, ...args) {
    const result = wrapped(...args);
    return applyAverage(this, result);
  };
}

function canUseLibWrapperForRollClass(RollClass) {
  return RollClass
    && RollClass === globalThis.Roll
    && typeof globalThis.libWrapper?.register === "function";
}

function registerMechanusLibWrapperPatch(prototype, isEnabled) {
  const targets = [];

  try {
    if (typeof prototype.evaluate === "function") {
      globalThis.libWrapper.register(
        MODULE_ID,
        ROLL_EVALUATE_TARGET,
        createMechanusEvaluateWrapper(isEnabled),
        "WRAPPER"
      );
      targets.push(ROLL_EVALUATE_TARGET);
    }

    if (typeof prototype.evaluateSync === "function") {
      globalThis.libWrapper.register(
        MODULE_ID,
        ROLL_EVALUATE_SYNC_TARGET,
        createMechanusEvaluateSyncWrapper(isEnabled),
        "WRAPPER"
      );
      targets.push(ROLL_EVALUATE_SYNC_TARGET);
    }

    Object.defineProperty(prototype, PATCH_STATE, {
      value: { mode: "libWrapper", targets },
      configurable: true
    });
    return true;
  }
  catch (error) {
    unregisterMechanusLibWrapperTargets(targets);
    throw error;
  }
}

function unregisterMechanusLibWrapperTargets(targets) {
  if (typeof globalThis.libWrapper?.unregister !== "function") {
    return;
  }

  for (const target of targets ?? []) {
    try {
      globalThis.libWrapper.unregister(MODULE_ID, target);
    }
    catch (error) {
      console.warn(`${MODULE_ID} | Failed to unregister Mechanus libWrapper patch for ${target}.`, error);
    }
  }
}

export function patchMechanusRollClass(RollClass = globalThis.Roll, { isEnabled = () => false } = {}) {
  const prototype = RollClass?.prototype;
  if (!prototype || (typeof prototype.evaluate !== "function" && typeof prototype.evaluateSync !== "function")) {
    return false;
  }

  if (prototype[PATCH_STATE]) {
    return false;
  }

  if (canUseLibWrapperForRollClass(RollClass)) {
    try {
      return registerMechanusLibWrapperPatch(prototype, isEnabled);
    }
    catch (error) {
      unregisterMechanusLibWrapperTargets(prototype[PATCH_STATE]?.targets);
      delete prototype[PATCH_STATE];
      console.warn(`${MODULE_ID} | Failed to register Mechanus libWrapper patch; falling back to direct patch.`, error);
    }
  }

  const applyAverage = createMechanusAverageApplier(isEnabled);

  const originalEvaluate = prototype.evaluate;
  const originalEvaluateSync = prototype.evaluateSync;

  if (typeof originalEvaluate === "function") {
    prototype.evaluate = function evaluateWithMechanusAverages(...args) {
      const result = originalEvaluate.apply(this, args);
      if (typeof result?.then === "function") {
        return result.then((resolved) => applyAverage(this, resolved));
      }

      return applyAverage(this, result);
    };
  }

  if (typeof originalEvaluateSync === "function") {
    prototype.evaluateSync = function evaluateSyncWithMechanusAverages(...args) {
      const result = originalEvaluateSync.apply(this, args);
      return applyAverage(this, result);
    };
  }

  Object.defineProperty(prototype, PATCH_STATE, {
    value: { mode: "direct", originalEvaluate, originalEvaluateSync },
    configurable: true
  });
  return true;
}

export function resetMechanusRollClassPatch(RollClass = globalThis.Roll) {
  const prototype = RollClass?.prototype;
  const state = prototype?.[PATCH_STATE];
  if (!prototype || !state) {
    return false;
  }

  if (state.mode === "libWrapper") {
    unregisterMechanusLibWrapperTargets(state.targets);
    delete prototype[PATCH_STATE];
    return true;
  }

  if (typeof state.originalEvaluate === "function") {
    prototype.evaluate = state.originalEvaluate;
  }

  if (typeof state.originalEvaluateSync === "function") {
    prototype.evaluateSync = state.originalEvaluateSync;
  }

  delete prototype[PATCH_STATE];
  return true;
}

export function registerMechanusRollHooks(moduleApi = globalThis.game?.rebreyaMain) {
  const RollClass = globalThis.Roll ?? globalThis.CONFIG?.Dice?.Roll ?? null;
  return patchMechanusRollClass(RollClass, {
    isEnabled: () => moduleApi?.isMechanusEnabled?.() === true
  });
}
