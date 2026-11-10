import { MODULE_ID } from "../constants.js";
import { createStableGearDocumentId } from "./gear-document-ids.js";

export const ALCHEMY_ASPECTS = Object.freeze({
  fire: Object.freeze({ code: "О", name: "Огонь", icon: "icons/svg/fire.svg" }),
  water: Object.freeze({ code: "Вд", name: "Вода", icon: "icons/svg/waterfall.svg" }),
  earth: Object.freeze({ code: "З", name: "Земля", icon: "icons/svg/mountain.svg" }),
  air: Object.freeze({ code: "Вз", name: "Воздух", icon: "icons/svg/windmill.svg" }),
  positive: Object.freeze({ code: "Пэ", name: "Позитивная энергия", icon: "icons/svg/sun.svg" }),
  negative: Object.freeze({ code: "Нэ", name: "Негативная энергия", icon: "icons/svg/skull.svg" })
});
const byCode = new Map(Object.entries(ALCHEMY_ASPECTS).map(([kind, aspect]) => [aspect.code.toLowerCase(), kind]));

export function readAlchemyAspect(name) {
  return byCode.get(String(name ?? "").trim().toLowerCase().match(/^аспект\s+(о|вд|з|вз|пэ|нэ)$/u)?.[1]) ?? null;
}

export function getAlchemyAspectKind(item) {
  if (item?.type !== "loot") return null;
  const flags = item.flags?.[MODULE_ID] ?? {};
  if (Object.hasOwn(flags, "alchemyAspect")) return Object.hasOwn(ALCHEMY_ASPECTS, flags.alchemyAspect) ? flags.alchemyAspect : null;
  if (flags.materialId || flags.gearId || flags.magicItemId) return null;
  return readAlchemyAspect(item.name);
}

export function createAlchemyAspectItemData(kind, quantity = 1) {
  if (!Object.hasOwn(ALCHEMY_ASPECTS, kind) || !Number.isSafeInteger(quantity) || quantity < 1) {
    throw new RangeError("Неверный вид или количество аспектов.");
  }
  const { code, name, icon } = ALCHEMY_ASPECTS[kind];
  const sourceId = `alchemy-aspect-${kind}`;
  return {
    _id: createStableGearDocumentId(sourceId),
    name: `Аспект: ${name}`,
    type: "loot",
    img: icon,
    system: {
      quantity, type: { value: "resource" },
      weight: { value: 0, units: "lb" },
      price: { value: 0, denomination: "gp" },
      description: { value: `<p>${name} (${code}). Одна единица равна одному алхимическому аспекту.</p>` }
    },
    flags: { [MODULE_ID]: { managed: true, sourceType: "alchemyAspect", sourceId, alchemyAspect: kind } }
  };
}

export function readPlantAspectYield(material) {
  if (material?.type?.trim().toLowerCase() !== "растение") return null;
  const entries = String(material.alchemyAspects ?? "").trim().toLowerCase().split(/\s*[,;]\s*/u);
  const result = {};
  for (const entry of entries) {
    const match = /^(\d+)\s*(о|вд|з|вз|пэ|нэ)$/u.exec(entry);
    if (!match) return null;
    const quantity = Number(match[1]);
    const kind = byCode.get(match[2]);
    if (!Number.isSafeInteger(quantity) || quantity < 1 || Object.hasOwn(result, kind)) return null;
    result[kind] = quantity;
  }
  return result;
}

export function calculateAspectExtraction({ baseYield, portionCount, total, d6 }) {
  const needsDie = (total >= 10 && total <= 14) || total >= 25;
  if (!Number.isFinite(total) || !Number.isSafeInteger(portionCount) || portionCount < 1
    || (needsDie && (!Number.isInteger(d6) || d6 < 1 || d6 > 6))) {
    throw new RangeError("Неверный результат извлечения аспектов.");
  }
  const result = {};
  for (const [kind, quantity] of Object.entries(baseYield)) {
    if (!Object.hasOwn(ALCHEMY_ASPECTS, kind) || !Number.isSafeInteger(quantity) || quantity < 1) continue;
    const yieldQuantity = total < 10 ? (portionCount > 1 ? Math.floor(quantity / 2) : 0)
      : total <= 14 ? Math.max(0, quantity - d6) : total < 25 ? quantity : quantity + d6;
    if (yieldQuantity > 0) result[kind] = yieldQuantity;
  }
  return result;
}
