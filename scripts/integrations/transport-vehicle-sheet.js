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

function collectionValues(collection) {
  if (Array.isArray(collection)) return collection;
  if (Array.isArray(collection?.contents)) return collection.contents;
  if (typeof collection?.values === "function") return Array.from(collection.values());
  return [];
}

function resolveFuelContext(moduleApi, transport) {
  const groupActorId = cleanText(transport?.groupActorId);
  if (transport?.instance !== true || !groupActorId) return null;
  try {
    const context = moduleApi?.groupContextService?.resolveForGroup?.(groupActorId);
    if (!context?.groupActor) return null;
    return {
      groupActorId,
      canManage: context.canManage === true,
      items: collectionValues(context.groupActor.items)
        .filter((item) => cleanText(item?.id) && cleanText(item?.name))
        .sort((left, right) => cleanText(left.name).localeCompare(cleanText(right.name), "ru"))
    };
  }
  catch (_error) {
    return null;
  }
}

function appendFuelControl(ownerDocument, form, { labelText, control }) {
  const label = ownerDocument.createElement("label");
  const labelTextNode = ownerDocument.createElement("span");
  labelTextNode.textContent = labelText;
  label.append(labelTextNode, control);
  form.append(label);
}

function buildFuelForm(ownerDocument, actor, transport, moduleApi) {
  const context = resolveFuelContext(moduleApi, transport);
  if (!context) return null;
  const state = transport.instanceState ?? {};
  const selectedId = cleanText(state.fuelItemId);
  const selectedName = cleanText(state.fuelItemName);
  const form = ownerDocument.createElement("div");
  form.className = "rm-rebreya-transport-fuel";

  const heading = ownerDocument.createElement("h4");
  heading.textContent = "Топливо в пути";
  form.append(heading);

  const select = ownerDocument.createElement("select");
  select.setAttribute("name", "fuelItemId");
  const emptyOption = ownerDocument.createElement("option");
  emptyOption.value = "";
  emptyOption.textContent = "Не выбрано";
  select.append(emptyOption);
  let selectedExists = false;
  for (const item of context.items) {
    const option = ownerDocument.createElement("option");
    option.value = cleanText(item.id);
    option.textContent = cleanText(item.name);
    option.selected = option.value === selectedId;
    selectedExists ||= option.selected;
    select.append(option);
  }
  if (selectedId && !selectedExists) {
    const missingOption = ownerDocument.createElement("option");
    missingOption.value = selectedId;
    missingOption.textContent = `${selectedName || "Выбранный товар"} (нет на складе)`;
    missingOption.selected = true;
    select.append(missingOption);
  }
  select.value = selectedId;
  select.disabled = !context.canManage;
  appendFuelControl(ownerDocument, form, { labelText: "Товар со склада", control: select });

  const rate = ownerDocument.createElement("input");
  rate.setAttribute("name", "fuelPerMile");
  rate.setAttribute("type", "number");
  rate.setAttribute("min", "0");
  rate.setAttribute("step", "any");
  rate.value = String(Number(state.fuelPerMile) || 0);
  rate.disabled = !context.canManage;
  appendFuelControl(ownerDocument, form, { labelText: "Расход на 1 милю", control: rate });

  if (context.canManage) {
    const save = ownerDocument.createElement("button");
    save.setAttribute("type", "button");
    save.setAttribute("data-action", "save-transport-fuel");
    save.textContent = "Сохранить топливо";
    save.addEventListener("click", async () => {
      save.disabled = true;
      try {
        await moduleApi?.updateTransportFuelConfig?.({
          groupActorId: context.groupActorId,
          actorId: cleanText(actor?.id),
          fuelItemId: cleanText(select.value),
          fuelPerMile: Number(String(rate.value).replace(",", "."))
        });
        globalThis.ui?.notifications?.info?.("Настройка топлива сохранена.");
      }
      catch (error) {
        console.error(`${MODULE_ID} | Failed to save transport fuel configuration.`, error);
        globalThis.ui?.notifications?.error?.(error?.message || "Не удалось сохранить настройку топлива.");
      }
      finally {
        save.disabled = false;
      }
    });
    form.append(save);
  }
  return form;
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

export function injectTransportSpecifications(app, html, moduleApi = null) {
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

  const fuelForm = buildFuelForm(ownerDocument, actor, readTransportFlags(actor), moduleApi);
  if (fuelForm) section.append(fuelForm);
  if (!rows.length && !fuelForm) return false;

  (root.querySelector?.("aside") ?? root).append(section);
  return true;
}

export function registerTransportVehicleSheetHooks(_moduleApi, { Hooks = globalThis.Hooks } = {}) {
  if (!Hooks?.on || registeredHookSets.has(Hooks)) return false;
  registeredHookSets.add(Hooks);
  const render = (app, html) => injectTransportSpecifications(app, html, _moduleApi);
  Hooks.on("renderApplicationV2", render);
  Hooks.on("renderActorSheet", render);
  Hooks.on("renderActorSheet5eVehicle", render);
  return true;
}
