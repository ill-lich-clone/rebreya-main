const types = ["custom", "multiply", "add", "downgrade", "upgrade", "override"];

export function attachGrappleStatuses(data, immunities) {
  const flags = data.flags?.["chris-premades"];
  if (flags?.info?.identifier !== "grappled" || !Array.isArray(flags.conditions)) return;
  const granted = flags.conditions.filter((id) => (id === "grappled" || id === "restrained") && !immunities?.has(id));
  data.statuses = [...new Set([...(data.statuses ?? []), ...granted])];
}

export async function sourceItemOf(document, resolve = (uuid) => globalThis.fromUuid(uuid)) {
  const seen = new Set();
  while (document && !seen.has(document) && seen.size < 6) {
    if (document.documentName === "Item") return document;
    if (document.documentName !== "ActiveEffect") return null;
    if (document.parent?.documentName === "Item") return document.parent;
    if (document.statuses?.has?.("concentrating")) {
      const item = document.parent?.items?.get(document.flags?.dnd5e?.item?.id);
      if (item) return item;
    }
    seen.add(document);
    document = document.origin ? await resolve(document.origin) : null;
  }
  return null;
}

// dnd5e refuses normal uses of rider activities. Only the private secondary roll
// needs this actor-owned clone; the item on the sheet stays hidden and unmodified.
export function syntheticCardActivity(activity) {
  const item = activity.item,
    data = item?.flags?.["chris-premades"];
  const riders = item?.flags?.dnd5e?.riders?.activity ?? [];
  if (
    !riders.includes(activity.id) ||
    !data?.hiddenActivities?.some((key) => data.activityIdentifiers?.[key] === activity.id)
  )
    return activity;
  if (item.effects?.some?.((effect) => effect.riders?.activity?.has?.(activity.id))) return activity;
  const copy = item.clone(
    { "flags.dnd5e.riders.activity": riders.filter((id) => id !== activity.id) },
    { keepId: true }
  );
  return copy.system.activities.get(activity.id);
}

export function prepareCardEffect(data, { item, parent, concentration, rules, generation }) {
  const flags = ((data.flags ??= {})["chris-premades"] ??= {});
  const sourceRules = item?.system?.source?.rules;
  const inherited = parent?.flags?.["chris-premades"] ?? {};
  const edition = rules ?? { 2014: "legacy", 2024: "modern" }[sourceRules] ?? inherited.rules;
  if (edition && !flags.rules) flags.rules = edition;
  const castData = inherited.castData ?? concentration?.flags?.["midi-qol"]?.castData;
  if (!flags.castData && castData) flags.castData = foundry.utils.deepClone(castData);

  const changes = data.system?.changes ?? data.changes ?? [];
  if (
    changes.some(
      (change) =>
        /^(?:macro\.|flags\.(?:itemacro|effectmacro)\.)|onUseMacroName|macroToCall/i.test(change.key) ||
        (change.key === "flags.midi-qol.OverTime" && /(?:^|,)\s*macro(?:ToCall)?\s*=/i.test(change.value))
    ) ||
    data.flags.effectmacro ||
    data.flags.itemacro ||
    data.flags["midi-qol"]?.onUseMacroName
  ) {
    throw new Error("World card effect contains an executable macro");
  }
  if (generation < 14) return data;
  if (data.changes) {
    (data.system ??= {}).changes = changes.map(({ mode, ...change }) => {
      if (typeof change.value === "string" && change.value !== "") {
        try {
          change.value = JSON.parse(change.value);
        } catch {
          /* Formulas and identifiers stay as strings. */
        }
      }
      return { ...change, type: change.type ?? types[mode] ?? "custom" };
    });
    delete data.changes;
  }
  if (data.duration && !data.duration.units) {
    const unit = ["seconds", "rounds", "turns"].find((key) => Number.isFinite(data.duration[key]));
    data.duration = unit
      ? { value: Math.max(0, Math.ceil(data.duration[unit])), units: unit }
      : { value: null, units: "seconds" };
  }
  return data;
}
