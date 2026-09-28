import { REBREYA_TOOLS } from "../constants.js";

const BASE_RAW_NAME_PREFIX = "Базовое сырье для Инструменты ";
const BASE_RAW_APPLICATION_PREFIX = "Создание и ремонт инструментов:";

function cleanIdentifier(value) {
  return String(value ?? "").replace(/\s+/gu, " ").trim();
}

function normalizeMatchText(value) {
  return cleanIdentifier(value).toLocaleLowerCase("ru-RU");
}

export function buildBaseRawMaterialIndex(materials) {
  const toolIdByLabel = new Map(REBREYA_TOOLS.map((tool) => [normalizeMatchText(tool.label), tool.id]));
  const index = new Map();

  for (const material of Array.isArray(materials) ? materials : []) {
    if (!cleanIdentifier(material?.name).startsWith(BASE_RAW_NAME_PREFIX)) continue;
    const application = cleanIdentifier(material?.applications?.crafting);
    if (!application.startsWith(BASE_RAW_APPLICATION_PREFIX)) continue;

    const label = application.slice(BASE_RAW_APPLICATION_PREFIX.length);
    const toolId = toolIdByLabel.get(normalizeMatchText(label));
    const materialId = cleanIdentifier(material?.id);
    if (!toolId || !materialId) continue;
    if (index.has(toolId)) throw new Error(`Multiple base raw materials map to tool '${toolId}'.`);
    index.set(toolId, materialId);
  }

  return index;
}
