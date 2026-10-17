export function applyUpdate(target, patch) {
  for (const [path, value] of Object.entries(patch)) {
    const parts = path.split(".");
    let node = target;
    for (const part of parts.slice(0, -1)) node = node[part] ??= {};
    const key = parts.at(-1);
    if (key.startsWith("-=")) delete node[key.slice(2)];
    else if (value && typeof value === "object" && !Array.isArray(value) && !(value instanceof Set)) {
      applyUpdate(node[key] ??= {}, value);
    }
    else node[key] = structuredClone(value);
  }
  return target;
}

export const damage = (faces = 8, bonus = "") => ({
  number: 1, denomination: faces, bonus, types: ["slashing"], custom: { enabled: false, formula: "" }
});

export function makeEquipment({ type = "weapon", flags = {}, system = {}, id = "sword" } = {}) {
  const data = { _id: id, name: "Длинный меч", type, flags: { "rebreya-main": structuredClone(flags) }, system: {
    quantity: 3, weight: { value: 3, units: "lb" }, price: { value: 15, denomination: "gp" },
    damage: { base: damage(8), versatile: damage(10) }, properties: ["ver"], ...structuredClone(system)
  } };
  return {
    ...data, id, uuid: `Actor.hero.Item.${id}`, isOwner: true, updates: [],
    getFlag(scope, key) { return this.flags?.[scope]?.[key]; },
    toObject() { return structuredClone({ _id: this.id, name: this.name, type: this.type, flags: this.flags, system: this.system }); },
    async update(patch, options = {}) { this.updates.push({ patch: structuredClone(patch), options }); applyUpdate(this, patch); return this; }
  };
}
