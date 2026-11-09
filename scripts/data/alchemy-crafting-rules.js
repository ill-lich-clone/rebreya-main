import { MODULE_ID } from "../constants.js";
import { canonicalCatalogId } from "../shared/canonical-catalog-id.js";

const ASPECT_NAMES = {
  fire: "О", water: "Вд", earth: "З", air: "Вз", positive: "Пэ", negative: "Нэ"
};
const ASPECT_BY_CODE = new Map(Object.entries(ASPECT_NAMES).map(([kind, code]) => [code.toLowerCase(), kind]));
const BASE_ID = "material-4";
const STOCK_PRECISION = 12;

const nameKey = (value) => String(value ?? "").trim().toLocaleLowerCase("ru-RU").replaceAll("ё", "е");
const familyKey = (value) => nameKey(value).replace(/\s+\d+[-–](?:й|го)\s+ранга?$/u, "");
const roundStock = (quantity) => Number(quantity.toFixed(STOCK_PRECISION));
const stackKey = ({ actorId, itemId }) => JSON.stringify([actorId, itemId]);
const count = (values) => Object.values(values).reduce((sum, value) => sum + value, 0);
const isRank = (value) => Number.isSafeInteger(value) && value >= 0;
const isGold = (value) => Number.isFinite(value) && value >= 0
  && Number.isSafeInteger(Math.round(value * 100)) && Math.abs(value - Math.round(value * 100) / 100) < 1e-9;

export function readAlchemyAspect(name) {
  return ASPECT_BY_CODE.get(nameKey(name).match(/^аспект\s+(о|вд|з|вз|пэ|нэ)$/u)?.[1]) ?? null;
}

export function canUseCraftedPotion(item, worldTime) {
  const craft = item?.flags?.[MODULE_ID]?.alchemyCraft;
  return !craft?.pending && (!Number.isFinite(craft?.expiresAt) || worldTime < craft.expiresAt);
}

export function resolveAlchemyToolRank(item) {
  const flags = item?.flags?.[MODULE_ID] ?? {};
  if (item?.type !== "tool" || !(Number(item.system?.quantity) > 0)
    || ["broken", "destroyed"].includes(flags.durability?.state)) return null;
  const baseItem = item.system?.type?.baseItem;
  if (baseItem !== "rebreyaAlchemy" && flags.rebreyaToolId !== "alchemy") return null;
  const rank = Number(flags.rank ?? 0);
  if (rank === 0 && baseItem === "rebreyaAlchemy" && flags.managed === true
    && flags.gearId === "instrumenty-alkhimicheskie-0-y-rang") {
    const legacyRank = nameKey(item.name).match(/^инструменты алхимические ([1-9])-й ранг$/u)?.[1];
    if (legacyRank) return Number(legacyRank);
  }
  return isRank(rank) ? rank : null;
}

function universalCatalyst(material) {
  const effect = String(material.applications?.alchemy ?? "").trim();
  if (!/^катализатор /iu.test(effect) || ["glina", "selitra"].includes(material.id)) return null;
  return {
    materialId: material.id,
    effect,
    universal: true,
    ...(material.id === "sol" ? { fieldOnly: true, fieldDcBonus: 5, lifetimeSeconds: 7 * 86400 } : {}),
    ...(material.id === "olovo" ? { fieldOnly: true, failureFraction: 0 } : {})
  };
}

export function normalizePotionRecipeCatalog(rows, { products, materials }) {
  const materialById = new Map(materials.map((material) => [canonicalCatalogId(material.id), material]));
  const universal = materials.map(universalCatalyst).filter(Boolean);
  const normalizeMaterial = (entry) => {
    const materialId = entry.materialId ?? materials.find((row) => entry.materialName && nameKey(row.name) === nameKey(entry.materialName))?.id;
    return materialId ? { ...entry, materialId: canonicalCatalogId(materialId) } : entry;
  };
  const recipes = new Map();
  for (const product of products) {
    if (product.productType !== "Зелье") continue;
    const source = (rows.recipes ?? rows)[product.id];
    const row = source ? {
      ...source,
      options: source.options.map((option) => ({ ...option, components: option.components.map(normalizeMaterial) })),
      catalysts: [...source.catalysts, ...universal].map(normalizeMaterial)
    } : null;
    if (!row?.options?.length) throw new Error(`Missing potion recipe: ${product.id}`);
    for (const entry of [...row.options.flatMap((option) => option.components), ...row.catalysts]) {
      if (entry.materialId && !materialById.has(entry.materialId)) {
        throw new Error(`Unknown potion ingredient: ${product.id} / ${entry.materialId}`);
      }
    }
    recipes.set(product.id, { ...row, materialById });
  }
  return recipes;
}

export function describePotionOption(option, recipe) {
  return [
    ...Object.entries(option.aspects).map(([kind, quantity]) => `${quantity} ${ASPECT_NAMES[kind]}`),
    ...(option.anyAspects ? [`${option.anyAspects} любых аспектов`] : []),
    ...option.components.map((component) => recipe.materialById.get(component.materialId)?.name
      ?? component.materialName ?? "Зелье лёгкого искажения"),
    ...(option.goldGp !== undefined ? [`${option.goldGp} зм`] : [])
  ].join(", ");
}

export function resolveCraftedPotionProduct(product, catalyst) {
  if (!catalyst) return product;
  const variant = { ...product };
  if (catalyst.ingredientAspect && ["alchemy-10", "alchemy-11"].includes(product.id)) variant.duration = "10 минут";
  if (catalyst.materialId === "material-132" && product.id === "alchemy-15") variant.duration = "1 час";
  if (catalyst.materialId === "material-141" && product.id === "alchemy-44") variant.duration = "1 час";
  if (catalyst.materialId === "material-134" && product.id === "alchemy-53") {
    variant.duration = "1 минута";
    variant.reagentLevel = 4;
  }
  if (catalyst.materialId === "material-80" && Number.isInteger(variant.reagentLevel)) {
    variant.reagentLevel = Math.max(0, variant.reagentLevel - 2);
  }
  if (catalyst.materialId === "material-142" && product.id === "alchemy-31") variant.activation = "Бонусное действие";
  return variant;
}

export function applyCraftedPotionHealing(activity, catalyst) {
  if (catalyst?.materialId === "ugol" && activity.healing?.custom?.enabled) {
    activity.healing.custom.formula += " + 2";
  }
  return activity;
}

function matchesMaterial(row, rule, materialById, allowFamily = false) {
  if (rule.productId) return row.productId === rule.productId && row.unmodified === true;
  if (rule.materialName && !rule.materialId) return false;
  if (row.materialId && canonicalCatalogId(row.materialId) === rule.materialId) return true;
  const reference = materialById.get(rule.materialId);
  const material = materialById.get(canonicalCatalogId(row.materialId));
  return allowFamily && reference && material && familyKey(material.name) === familyKey(reference.name);
}

function matchesCatalyst(row, rule, materialById) {
  if (!rule.ingredientAspect) return matchesMaterial(row, rule, materialById);
  const code = ASPECT_NAMES[rule.ingredientAspect].toLowerCase();
  const aspectText = String(materialById.get(canonicalCatalogId(row.materialId))?.alchemyAspects ?? "").toLowerCase();
  const matching = [...aspectText.matchAll(/(\d+)\s*(о|вд|з|вз|пэ|нэ)(?![а-я])/gu)];
  return matching.some(([, amount, kind]) => kind === code && Number(amount) > rule.greaterThan);
}

export function planPotionStock({ recipe, stock, optionIndex = 0, catalystKey, mode }) {
  const option = recipe?.options[optionIndex];
  if (!option) return { stockOptions: [], catalysts: [], items: [] };
  const { materialById } = recipe;
  const catalysts = recipe.catalysts.flatMap((rule, index) => {
    if (rule.fieldOnly && mode !== "field") return [];
    if (rule.aspects) return [{ index, key: String(index), name: describePotionOption({ aspects: rule.aspects, components: [] }, recipe), effect: rule.effect }];
    return stock.filter((row) => row.quantity >= 1 && matchesCatalyst(row, rule, materialById)).map((row) => ({
      index, key: `${index}:${row.actorId}:${row.itemId}`, name: `${row.name} · ${row.actorName}`,
      effect: rule.effect, item: { actorId: row.actorId, itemId: row.itemId, quantity: 1, role: "catalyst" }
    }));
  });
  const catalyst = catalysts.find(({ key }) => key === catalystKey);
  const catalystRule = catalyst ? recipe.catalysts[catalyst.index] : null;
  const selected = new Map();
  if (catalyst?.item) selected.set(stackKey(catalyst.item), 1);
  const stockOptions = [];
  const items = [];
  function allocate(rows, role, amount, valueOf = () => 1) {
    for (const row of rows) {
      const key = stackKey(row);
      const maximum = roundStock(Math.max(0, row.quantity - (selected.get(key) ?? 0)));
      const unitValue = valueOf(row);
      const quantity = unitValue > 0 ? roundStock(Math.min(maximum, Math.max(0, amount / unitValue))) : 0;
      amount -= quantity * unitValue;
      selected.set(key, roundStock((selected.get(key) ?? 0) + quantity));
      const item = { actorId: row.actorId, itemId: row.itemId, role, quantity };
      const existing = stockOptions.find((entry) => entry.role === role && stackKey(entry) === key);
      if (existing) existing.quantity = roundStock(existing.quantity + quantity);
      else stockOptions.push({ ...item, maximum: row.quantity, name: row.name, actorName: row.actorName, fractional: role === "component" && row.isMaterial });
    }
  }
  if (option.goldGp === undefined) allocate(stock.filter((row) => matchesMaterial(row, { materialId: BASE_ID }, materialById, true)), "base", 1);
  for (const component of option.components) {
    const reference = materialById.get(component.materialId);
    const rows = stock.filter((row) => matchesMaterial(row, component, materialById, true))
      .sort((a, b) => Number(canonicalCatalogId(b.materialId) === component.materialId) - Number(canonicalCatalogId(a.materialId) === component.materialId));
    const price = reference?.priceGold;
    if (price > 0) allocate(rows, "component", price, (row) => materialById.get(canonicalCatalogId(row.materialId))?.priceGold ?? 0);
    else allocate(rows, "component", 1);
  }
  const aspects = { ...option.aspects };
  for (const [kind, amount] of Object.entries(catalystRule?.aspects ?? {})) aspects[kind] = (aspects[kind] ?? 0) + amount;
  for (const [kind, amount] of Object.entries(aspects)) allocate(stock.filter((row) => row.aspect === kind), "aspect", amount);
  if (option.anyAspects) allocate(stock.filter((row) => row.aspect), "aspect", option.anyAspects);
  for (const { actorId, itemId, quantity, role } of stockOptions) if (quantity > 0) items.push({ actorId, itemId, quantity, role });
  if (catalyst?.item) items.push(catalyst.item);
  return { stockOptions, items, catalysts, catalystIndex: catalyst?.index };
}

function gatherDebits(stock, items, addError) {
  const stockById = new Map(stock.map((row) => [stackKey(row), row]));
  const spent = new Map();
  const debits = [];
  for (const item of items) {
    const key = stackKey(item);
    const row = stockById.get(key);
    const quantity = item.quantity;
    if (!row || !Number.isFinite(quantity) || quantity <= 0
      || roundStock(quantity) !== quantity || !["base", "aspect", "component", "catalyst"].includes(item.role)) {
      addError("invalid-stock", "Выбранный запас недоступен.");
      continue;
    }
    const total = roundStock((spent.get(key) ?? 0) + quantity);
    spent.set(key, total);
    if (total > row.quantity) addError("stock-shortage", `Недостаточно: ${row.name ?? row.itemId}.`);
    debits.push({ ...row, quantity, role: item.role });
  }
  return debits;
}

function validateComponents(required, chosen, materialById, addError) {
  const unmatched = new Set(chosen);
  for (const component of required) {
    if (component.materialName && !component.materialId) {
      addError("material-unavailable", `В каталоге мира нет материала «${component.materialName}».`);
      continue;
    }
    const matching = [...unmatched].filter((row) => matchesMaterial(row, component, materialById, true));
    for (const row of matching) unmatched.delete(row);
    const reference = materialById.get(component.materialId);
    const expected = reference?.priceGold;
    const differentRank = matching.some((row) => canonicalCatalogId(row.materialId) !== component.materialId);
    const label = reference?.name ?? component.materialName ?? "Зелье лёгкого искажения";
    if (reference && expected > 0 && (differentRank || matching.some(({ quantity }) => !Number.isInteger(quantity)))) {
      const total = matching.reduce((sum, row) => sum + (materialById.get(canonicalCatalogId(row.materialId))?.priceGold ?? 0) * row.quantity, 0);
      if (Math.abs(total - expected) > 1e-7) addError("component-value", `Нужно ${label} на ${expected} зм.`);
    } else if (matching.reduce((sum, row) => sum + row.quantity, 0) !== 1) {
      addError("component-required", `Нужна одна порция: ${label}.`);
    }
  }
  if (unmatched.size) addError("extra-component", "В выбранной ветке есть лишние компоненты.");
}

function calculateFailureDebits(aspectRows, totals, fraction) {
  const remaining = Object.fromEntries(Object.entries(totals).map(([kind, amount]) => [kind, Math.floor(amount * fraction)]));
  const failureDebits = [];
  for (const row of aspectRows) {
    const quantity = Math.min(remaining[row.aspect] ?? 0, row.quantity);
    remaining[row.aspect] -= quantity;
    if (quantity > 0) failureDebits.push({ ...row, quantity });
  }
  return failureDebits;
}

export function buildPotionCraftQuote({ recipe, product, mode, selection = {}, stock = [], tool, laboratory = [] }) {
  const errors = [];
  const addError = (code, message) => errors.push({ code, message });
  const field = mode === "field";
  const rank = product?.rank;
  const option = recipe?.options?.[selection.optionIndex ?? 0];
  const result = { errors, debits: [], failureDebits: [], goldGp: 0, weeks: null, dc: null, catalyst: null, output: null };
  if (!option || !product || !isRank(rank) || (!field && mode !== "laboratory")) {
    addError("recipe-unavailable", "Рецепт недоступен.");
    return result;
  }
  if (!isRank(tool?.rank) || tool.rank < rank) addError("tool-rank", `Нужны алхимические инструменты ранга ${rank}.`);
  if (field && rank > 5) addError("field-rank-limit", "В поле доступны зелья до 5-го ранга.");
  if (field && !["int", "wis"].includes(selection.ability)) addError("field-ability", "Выберите Интеллект или Мудрость.");

  const materialById = recipe.materialById ?? new Map();
  const debits = gatherDebits(stock, selection.items ?? [], addError);
  result.debits = debits;
  const catalystRows = debits.filter((row) => row.role === "catalyst");
  const eligible = (rule) => rule && (field || !rule.fieldOnly);
  let catalyst = null;
  if (selection.catalystIndex !== undefined) {
    catalyst = recipe.catalysts[selection.catalystIndex];
  } else if (catalystRows.length === 1) {
    catalyst = recipe.catalysts.find((rule) => eligible(rule) && matchesCatalyst(catalystRows[0], rule, materialById));
  }
  if (catalyst?.aspects) {
    if (catalystRows.length || !eligible(catalyst)) addError("catalyst-invalid", "Выберите один катализатор.");
  } else if (catalystRows.length || selection.catalystIndex !== undefined) {
    if (!eligible(catalyst) || catalystRows.length !== 1 || catalystRows[0].quantity !== 1
      || !matchesCatalyst(catalystRows[0], catalyst, materialById)) {
      addError("catalyst-invalid", "Выберите одну порцию подходящего катализатора.");
    }
  }
  if (catalyst) {
    const materialId = canonicalCatalogId(catalystRows[0]?.materialId ?? catalyst.materialId) || undefined;
    result.catalyst = {
      ...catalyst,
      materialId,
      name: materialById.get(materialId)?.name ?? catalystRows[0]?.name ?? "Аспекты",
      rank: materialById.get(materialId)?.rank ?? catalystRows[0]?.rank ?? 0
    };
  }

  const simplified = option.goldGp !== undefined;
  const bases = debits.filter((row) => row.role === "base");
  if (simplified ? bases.length : bases.length !== 1 || bases[0].quantity !== 1
    || !matchesMaterial(bases[0], { materialId: BASE_ID }, materialById, true)) {
    addError("potion-base", simplified ? "Золото заменяет основу зелья." : "Нужна одна порция крови чудовища.");
  }
  validateComponents(option.components, debits.filter((row) => row.role === "component"), materialById, addError);

  const requiredAspects = { ...option.aspects };
  for (const [kind, amount] of Object.entries(catalyst?.aspects ?? {})) {
    requiredAspects[kind] = (requiredAspects[kind] ?? 0) + amount;
  }
  const aspectRows = debits.filter((row) => row.role === "aspect");
  const totals = {};
  for (const row of aspectRows) {
    if (!Object.hasOwn(ASPECT_NAMES, row.aspect) || !Number.isSafeInteger(row.quantity)) {
      addError("invalid-aspect", "Аспекты расходуются целыми единицами.");
      continue;
    }
    totals[row.aspect] = (totals[row.aspect] ?? 0) + row.quantity;
  }
  for (const [kind, amount] of Object.entries(requiredAspects)) {
    if ((totals[kind] ?? 0) < amount) addError("aspect-shortage", `Нужно ${amount} ${ASPECT_NAMES[kind]}.`);
  }
  if (count(totals) !== count(requiredAspects) + (option.anyAspects ?? 0)) {
    addError("aspect-total", `Нужно аспектов: ${count(requiredAspects) + (option.anyAspects ?? 0)}.`);
  }

  if (field) {
    result.dc = 10 + rank + (catalyst?.fieldDcBonus ?? result.catalyst?.rank ?? 0) + (catalyst?.dcModifier ?? 0);
    result.failureDebits = calculateFailureDebits(aspectRows, totals, catalyst?.failureFraction ?? 0.25);
    result.goldGp = option.goldGp ?? 0;
  } else if (simplified) {
    result.weeks = selection.manualWeeks ?? null;
    result.goldGp = selection.manualGoldGp ?? option.goldGp;
    if (!Number.isSafeInteger(result.weeks) || result.weeks < 1 || !isGold(result.goldGp)) {
      addError("manual-laboratory-cost", "Укажите целое число недель и сумму в золотых.");
    }
  } else {
    const term = laboratory.find((row) => row.rank === rank);
    result.weeks = term?.weeks ?? null;
    result.goldGp = term?.baseCost ?? 0;
    if (!term) addError("laboratory-rank", "В таблице простоя нет этого ранга.");
  }
  result.output = { productId: product.id, catalyst: result.catalyst, lifetimeSeconds: field ? (catalyst?.lifetimeSeconds ?? 86400) : null };
  return result;
}
