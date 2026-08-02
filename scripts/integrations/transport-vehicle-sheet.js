import { MODULE_ID } from "../constants.js";

const registeredHookSets = new WeakSet();
const MISSING_VALUES = new Set(["", "-", "—", "–", "--"]);

function cleanText(value) {
  return typeof value === "string" ? value.trim() : String(value ?? "").trim();
}

function optionalText(value) {
  const text = cleanText(value);
  return MISSING_VALUES.has(text) ? "" : text;
}

function formatRentalPrice(value) {
  const raw = optionalText(value?.raw);
  if (raw) return raw;
  const amount = Number(value?.value);
  if (!Number.isFinite(amount)) return "";
  const denomination = optionalText(value?.denomination);
  return denomination ? `${amount} ${denomination}` : String(amount);
}

function formatFeet(value) {
  const amount = Number(value);
  return Number.isFinite(amount) && amount > 0 ? `${amount} фт.` : "";
}

function readTransportFlags(actor) {
  return actor?.getFlag?.(MODULE_ID, "transport")
    ?? actor?.flags?.[MODULE_ID]?.transport
    ?? null;
}

export function buildTransportSpecifications(actor) {
  const transport = readTransportFlags(actor);
  if (!transport || typeof transport !== "object") return [];
  const candidates = [
    ["Год изобретения", optionalText(transport.inventionYear)],
    ["Цена аренды", formatRentalPrice(transport.rentalPrice)],
    ["Ранг", optionalText(transport.rank)],
    ["Разгон", formatFeet(transport.accelerationFt)],
    [
      "Скорость в бою (режимы)",
      transport.combatSpeed?.secondaryFt != null ? optionalText(transport.combatSpeed?.raw) : ""
    ],
    ["Граница поломки", optionalText(transport.breakdownThreshold)],
    ["Расход топлива или корма", optionalText(transport.consumption?.raw ?? transport.consumption)],
    ["Исходная грузоподъёмность", optionalText(transport.raw?.cargoCapacity)]
  ];
  return candidates
    .filter(([, value]) => value)
    .map(([label, value]) => ({ label, value }));
}

export function injectTransportSpecifications(app, html) {
  const actor = app?.actor ?? app?.document;
  const root = html?.querySelector?.(".window-content") ?? html?.[0] ?? html;
  if (actor?.type !== "vehicle" || !readTransportFlags(actor) || !root) return false;
  if (root.querySelector?.(".rm-rebreya-transport-specs")) return true;

  const rows = buildTransportSpecifications(actor);
  const ownerDocument = root.ownerDocument ?? globalThis.document;
  if (!ownerDocument?.createElement) return false;

  const section = ownerDocument.createElement("section");
  section.className = "rm-rebreya-transport-specs";
  const heading = ownerDocument.createElement("h3");
  heading.textContent = "Характеристики Ребреи";
  section.append(heading);
  for (const row of rows) {
    const line = ownerDocument.createElement("p");
    const label = ownerDocument.createElement("span");
    const value = ownerDocument.createElement("strong");
    label.textContent = row.label;
    value.textContent = row.value;
    line.append(label, value);
    section.append(line);
  }

  if (!rows.length) return false;

  (root.querySelector?.("aside") ?? root).append(section);
  return true;
}

export function registerTransportVehicleSheetHooks(_moduleApi, { Hooks = globalThis.Hooks } = {}) {
  if (!Hooks?.on || registeredHookSets.has(Hooks)) return false;
  registeredHookSets.add(Hooks);
  const render = (app, html) => injectTransportSpecifications(app, html);
  Hooks.on("renderApplicationV2", render);
  Hooks.on("renderActorSheet", render);
  Hooks.on("renderActorSheet5eVehicle", render);
  return true;
}
