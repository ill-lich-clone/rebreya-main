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
  return fn.name === "lL" && ["legendaryActionsUsed", "resources.legact.value", "identifiedItems", "lastPrompt", "CHRISPREMADES.Combat.LegendaryActions.Prompt.Title", "togglePause()", ".nextTurn()"].every(text => source.includes(text));
}

function patchEntries(hooks) {
  const entries = hooks?.events?.preUpdateCombat;
  if (!Array.isArray(entries)) return 0;
  let count = 0;
  for (const entry of entries) {
    const original = entry?.fn;
    if (!isVulnerableHook(original)) continue;
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
  if (module.version !== "1.5.44") {
    console.warn(`${MODULE_ID} | Unsupported CPR version for legendary-action compatibility: ${module.version}.`);
    return false;
  }
  const setting = game?.settings?.settings?.get?.(`${CPR_ID}.legendaryActionsPrompt`);
  if (!setting || typeof setting.onChange !== "function" || !hooks?.events) {
    console.warn(`${MODULE_ID} | CPR legendary-action compatibility could not identify its hook or setting.`);
    return false;
  }
  if (!setting[INSTALLED]) {
    const onChange = setting.onChange;
    setting.onChange = function (...args) {
      for (const entry of hooks.events.preUpdateCombat ?? []) if (entry.fn?.[ORIGINAL]) entry.fn = entry.fn[ORIGINAL];
      const result = onChange.apply(this, args);
      patchEntries(hooks);
      return result;
    };
    Object.defineProperty(setting, INSTALLED, { value: true });
  }
  const patched = patchEntries(hooks) > 0 || Boolean(hooks.events.preUpdateCombat?.some(entry => Boolean(entry.fn?.[ORIGINAL])));
  if (!patched && game.settings.get?.(CPR_ID, "legendaryActionsPrompt")) {
    console.warn(`${MODULE_ID} | CPR legendary-action hook was not recognized.`);
  }
  return patched;
}
