import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

export async function optionalModule(path) {
  try { return await import(path); }
  catch (error) { if (error.code === "ERR_MODULE_NOT_FOUND") return {}; throw error; }
}
export const required = (module, name) => module[name] ?? (() => assert.fail(`Missing production behavior: ${name}`));
const read = async name => {
  try { return JSON.parse(await readFile(new URL(`../../data/${name}.json`, import.meta.url))); }
  catch (error) { if (error.code === "ENOENT") return []; throw error; }
};
export const [gear, ruleDefinitions, hostDefinitions] = await Promise.all([read("gear"), read("weapon-mod-rules"), read("weapon-mod-hosts")]);
const catalogModule = await optionalModule(new URL("../../scripts/data/weapon-mod-catalog.js", import.meta.url));
export const buildCatalog = required(catalogModule, "buildWeaponModCatalog");
export const getCandidate = required(catalogModule, "getWeaponModCandidate");
export const getHost = required(catalogModule, "getWeaponModHostDescriptor");
export function makeItem(gearId, overrides = {}) {
  const row = gear.find(row => row.id === gearId);
  return { id: `item-${gearId}`, type: row?.equipmentType === "Обвес" ? "loot" : "weapon", name: row?.name,
    system: { quantity: 1, properties: new Set(row?.weapon?.properties ?? []), type: { value: row?.firearmClass ? `firearm${row.firearmClass === "primitive" ? "Primitive" : "Advanced"}` : "martialR" } },
    flags: { "rebreya-main": { gearId, firearmClass: row?.firearmClass ?? "", ...(row?.attachment ? { attachment: structuredClone(row.attachment) } : {}) } }, ...overrides };
}
export const makeCatalog = () => buildCatalog(gear, ruleDefinitions, hostDefinitions);
export const makeHost = (gearId, overrides = {}) => ({ ...getHost(makeItem(gearId), makeCatalog()), ...overrides });
export const makeCandidate = (sourceId, overrides = {}) => ({ ...getCandidate(makeItem(sourceId), makeCatalog()), ...overrides });
export const makeInstalled = (sourceId, itemId, mountIds = []) => ({ itemId, sourceId, mountIds, profile: makeCandidate(sourceId).profile });
