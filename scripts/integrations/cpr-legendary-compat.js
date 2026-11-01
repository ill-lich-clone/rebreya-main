const MODULE_ID = "rebreya-main";
const CPR_ID = "chris-premades";
const ORIGINAL = Symbol("rebreyaCprOriginal");
const INSTALLED = Symbol("rebreyaCprSettingInstalled");

function hasLegendaryAction(combatant) {
  const actor = combatant?.actor;
  const remaining = actor?.system?.resources?.legact?.value;
  if (!remaining || typeof actor?.identifiedItems?.forEach !== "function") return false;
  let found = false;
  actor.identifiedItems.forEach(group => group?.forEach?.(item => {
    if (item?.system?.activities?.find?.(activity => (
      (activity?.consumption?.targets?.[0]?.target === "resources.legact.value" || activity?.activation?.type === "legendary")
      && remaining >= activity?.activation?.value
    ))) found = true;
  }));
  return found;
}

function isVulnerableHook(fn) {
  if (typeof fn !== "function" || fn[ORIGINAL]) return false;
  const source = Function.prototype.toString.call(fn);
  return ["legendaryActionsUsed", "resources.legact.value", "identifiedItems", "lastPrompt"].every(text => source.includes(text))
    && /\[\s*0\s*\]\s*\.\s*actor\b/u.test(source);
}

function patchEntries(hooks) {
  const entries = hooks?.events?.preUpdateCombat;
  if (!Array.isArray(entries)) return 0;
  const candidates = entries.filter(entry => isVulnerableHook(entry?.fn));
  if (candidates.length !== 1) return 0;
  let count = 0;
  for (const entry of candidates) {
    const original = entry?.fn;
    const wrapped = function (combat, ...args) {
      if (!combat?.combatants || typeof combat.combatants.filter !== "function") return original.call(this, combat, ...args);
      const combatants = new Proxy(combat.combatants, { get(target, key) {
        if (key === "filter") return (...filterArgs) => target.filter(...filterArgs).filter(hasLegendaryAction);
        const value = Reflect.get(target, key, target);
        return typeof value === "function" ? value.bind(target) : value;
      } });
      const safeCombat = new Proxy(combat, { get(target, key) {
        if (key === "combatants") return combatants;
        const value = Reflect.get(target, key, target);
        return typeof value === "function" ? value.bind(target) : value;
      } });
      return original.call(this, safeCombat, ...args);
    };
    Object.defineProperty(wrapped, ORIGINAL, { value: original });
    entry.fn = wrapped;
    count++;
  }
  return count;
}

export function installCprLegendaryActionCompat({ hooks = globalThis.Hooks, game = globalThis.game } = {}) {
  const module = game?.modules?.get?.(CPR_ID);
  if (!module?.active) return false;
  const setting = game?.settings?.settings?.get?.(`${CPR_ID}.legendaryActionsPrompt`);
  if (!setting || typeof setting.onChange !== "function" || !hooks?.events) {
    console.warn(`${MODULE_ID} | CPR legendary-action compatibility could not identify its hook or setting.`);
    return false;
  }
  const originalOnChange = setting[INSTALLED] ?? setting.onChange;
  const registration = Function.prototype.toString.call(originalOnChange).match(/Hooks\s*\.\s*on\s*\(\s*["\x27]preUpdateCombat["\x27]\s*,\s*([\w$.]+)/u);
  if (!registration) {
    console.warn(`${MODULE_ID} | CPR legendary-action callback could not be identified.`);
    return false;
  }
  const entries = hooks.events.preUpdateCombat ?? [];
  const vulnerable = entries.filter(entry => isVulnerableHook(entry?.fn));
  const alreadyPatched = entries.some(entry => Boolean(entry.fn?.[ORIGINAL]));
  const enabled = Boolean(game.settings.get?.(CPR_ID, "legendaryActionsPrompt"));
  if (enabled && !vulnerable.length && !alreadyPatched) {
    const fixed = entries.some(entry => {
      const source = typeof entry.fn === "function" ? Function.prototype.toString.call(entry.fn) : "";
      return ["legendaryActionsUsed", "identifiedItems", "lastPrompt"].every(text => source.includes(text))
        && /\[\s*0\s*\]\s*\?\.\s*actor\b/u.test(source);
    });
    if (!fixed) console.warn(`${MODULE_ID} | CPR legendary-action hook was not recognized.`);
    return false;
  }
  if (vulnerable.length > 1) {
    console.warn(`${MODULE_ID} | CPR legendary-action hook is ambiguous.`);
    return false;
  }
  if (!setting[INSTALLED]) {
    const onChange = setting.onChange;
    setting.onChange = function (...args) {
      for (const entry of hooks.events.preUpdateCombat ?? []) if (entry.fn?.[ORIGINAL]) entry.fn = entry.fn[ORIGINAL];
      const result = onChange.apply(this, args);
      if (result && typeof result.then === "function") return result.then(value => { patchEntries(hooks); return value; });
      patchEntries(hooks);
      return result;
    };
    Object.defineProperty(setting, INSTALLED, { value: onChange });
  }
  return patchEntries(hooks) > 0 || alreadyPatched;
}
