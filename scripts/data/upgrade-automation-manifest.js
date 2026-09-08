const DECISIONS = new Set(["existing-curse", "simple-candidate", "simple-implemented", "unavailable-complex", "unavailable-no-rule"]);
export const UPGRADE_UNAVAILABLE_LABEL = "Усовершенствования нет в реализации";
const fail = (code, id) => { throw new Error(`upgrade-manifest: ${code}: ${id ?? ""}`); };

function indexRows(rows, field) {
  if (!Array.isArray(rows)) fail("invalid-catalog", field);
  const index = new Map();
  for (const row of rows) {
    const id = row?.[field];
    if (typeof id !== "string" || !id.trim() || index.has(id)) fail("duplicate-or-missing-id", id);
    index.set(id, row);
  }
  return index;
}

export function buildUpgradeAutomationManifest(upgrades, gear, decisions) {
  const sources = indexRows(upgrades, "productId"), gearById = indexRows(gear, "id"), decisionById = indexRows(decisions, "productId");
  for (const productId of decisionById.keys()) if (!sources.has(productId)) fail("orphan-decision", productId);
  return [...sources.keys()].sort().map(productId => {
    const source = sources.get(productId), decision = decisionById.get(productId);
    if (!gearById.has(productId)) fail("missing-gear", productId);
    if (!decision || !DECISIONS.has(decision.decision) || !decision.reason || !Array.isArray(decision.owner)
      || !Array.isArray(decision.tests) || !Array.isArray(decision.capabilities)) fail("invalid-decision", productId);
    if (["existing-curse", "simple-implemented"].includes(decision.decision)
      && (!decision.owner.length || !decision.tests.some(test => test.status === "existing"))) fail("missing-evidence", productId);
    if (!source.upgrade || typeof source.upgrade !== "object") fail("missing-profile", productId);
    return structuredClone({ ...decision, gearId: productId, type: source.upgrade.type, profile: source.upgrade,
      ruleSource: { file: "data/upgrades.json", productId, sourceSheet: source.upgrade.sourceSheet, sourceSheetRow: source.upgrade.sourceSheetRow } });
  });
}

export function getUpgradeAvailability(productId, manifest = []) {
  const row = manifest.find(row => row.productId === productId);
  const decision = row?.decision ?? "unavailable-no-rule";
  const available = ["existing-curse", "simple-implemented"].includes(decision);
  return { decision, available, label: available ? "Доступно" : UPGRADE_UNAVAILABLE_LABEL,
    reason: row?.reason ?? "Нет проверенного правила для этого stable ID." };
}

let manifestPromise;
/** Static source catalogs are read-only; failed loads can be retried on the next request. */
export function loadUpgradeAutomationManifest() {
  manifestPromise ??= Promise.all(["upgrades", "gear", "upgrade-automation-manifest"].map(async name => {
    const response = await fetch(`modules/rebreya-main/data/${name}.json?v=1.4.254`, { cache: "no-store" });
    if (!response.ok) throw new Error(`upgrade-manifest: load ${name}: ${response.status}`);
    return response.json();
  })).then(([upgrades, gear, decisions]) => buildUpgradeAutomationManifest(upgrades, gear, decisions))
    .catch(error => { manifestPromise = undefined; throw error; });
  return manifestPromise;
}
