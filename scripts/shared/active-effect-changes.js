const types = ["custom", "multiply", "add", "downgrade", "upgrade", "override"];

// Read persisted data first: dnd5e initializes serialized conditions as Filter instances on a live effect.
export function activeEffectChanges(effect) {
  return effect?._source?.system?.changes ?? effect?.system?.changes ?? effect?.changes ?? [];
}

function nativeRow(change) {
  if (typeof change.type === "string") return { ...change };
  const {mode, ...row} = change;
  row.type = mode == null ? "add" : types[mode] ?? `custom.${mode}`;
  // Foundry v14 migrates JSON-formatted legacy strings to native values. Formulas stay strings.
  while (typeof row.value === "string" && row.value !== "") {
    try { row.value = JSON.parse(row.value); } catch { break; }
  }
  return row;
}

export function comparableEffectChanges(effect) {
  return Array.from(activeEffectChanges(effect), change => {
    const row = nativeRow(change);
    let conditions = row.conditions ?? {};
    if (typeof conditions === "string") {
      try { conditions = JSON.parse(conditions); } catch { /* Keep malformed authored filters distinguishable. */ }
    }
    return {
      key: row.key, type: row.type, value: row.value, priority: row.priority ?? null,
      phase: row.phase ?? "initial", replacement: row.replacement ?? "", conditions
    };
  });
}

export function nativeEffectUpdate(data, existing) {
  const {changes: legacyChanges, system, ...rest} = data ?? {};
  const changes = legacyChanges ?? system?.changes;
  if (!Array.isArray(changes)) return data;
  if (!(globalThis.game?.release?.generation >= 14 || existing?.system?.changes)) {
    if (Array.isArray(legacyChanges)) return data;
    const {changes: nativeChanges, ...systemData} = system;
    return {
      ...rest,
      ...(Object.keys(systemData).length ? {system: systemData} : {}),
      changes: nativeChanges.map(({type, value, key, priority}) => ({
        key, mode: types.indexOf(type), value: typeof value === "string" ? value : JSON.stringify(value), priority
      }))
    };
  }
  const old = Array.from(activeEffectChanges(existing));
  const rows = changes.map(change => {
    const row = nativeRow(change);
    const i = old.findIndex(prior => row._id ? prior._id === row._id : prior.key === row.key);
    if (i >= 0) {
      const [prior] = old.splice(i, 1);
      if (!row._id && prior._id) row._id = prior._id;
    }
    return row;
  });
  return { ...rest, system: { ...system, changes: rows } };
}
