import { MODULE_ID } from "../constants.js";

let rationFoodConversionHookRegistered = false;

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/gu, "&amp;")
    .replace(/</gu, "&lt;")
    .replace(/>/gu, "&gt;")
    .replace(/"/gu, "&quot;")
    .replace(/'/gu, "&#39;");
}

function cleanId(value) {
  return String(value ?? "").trim();
}

function isCurrentUserHook(userId) {
  const currentUserId = cleanId(globalThis.game?.user?.id);
  const hookUserId = cleanId(userId);
  return !hookUserId || !currentUserId || hookUserId === currentUserId;
}

function isCharacterOwnedItem(item) {
  const actor = item?.parent ?? item?.actor ?? null;
  return actor?.type === "character";
}

function shouldSkipConversion(options = {}) {
  return options?.[MODULE_ID]?.skipRationFoodConversion === true
    || options?.skipRationFoodConversion === true;
}

function getPromptableRationConversion(item, options = {}, userId = "", moduleApi = globalThis.game?.rebreyaMain) {
  if (!isCurrentUserHook(userId) || shouldSkipConversion(options) || !isCharacterOwnedItem(item)) {
    return null;
  }

  const inventoryService = moduleApi?.inventoryService;
  if (!inventoryService?.getRationFoodConversion) {
    return null;
  }

  try {
    if (inventoryService.canManagePartyInventory?.() === false) {
      return null;
    }
  }
  catch (_error) {
    return null;
  }

  return inventoryService.getRationFoodConversion(item);
}

export async function confirmRationFoodConversion(conversion) {
  const itemName = escapeHtml(conversion?.itemName || "предмет");
  const foodLb = escapeHtml(conversion?.foodLb ?? 0);
  const content = `
    <p>Превратить «${itemName}» в еду Rebreya?</p>
    <p>В склад группы будет добавлено <strong>${foodLb} фнт.</strong> еды, а предмет в чарнике будет удалён.</p>
  `;
  const dialogV2 = globalThis.foundry?.applications?.api?.DialogV2;
  if (typeof dialogV2?.confirm === "function") {
    return dialogV2.confirm({
      window: {
        title: "Превратить в еду"
      },
      content
    });
  }

  if (typeof globalThis.Dialog?.confirm === "function") {
    return globalThis.Dialog.confirm({
      title: "Превратить в еду",
      content,
      yes: () => true,
      no: () => false,
      defaultYes: false
    });
  }

  return false;
}

export async function handleCreatedRationItem(
  item,
  options = {},
  userId = "",
  moduleApi = globalThis.game?.rebreyaMain,
  { confirm = confirmRationFoodConversion } = {}
) {
  const conversion = getPromptableRationConversion(item, options, userId, moduleApi);
  if (!conversion) {
    return false;
  }

  const confirmed = await confirm(conversion, item);
  if (!confirmed) {
    return false;
  }

  const result = await moduleApi.inventoryService.convertRationItemToFoodSupply(item);
  globalThis.ui?.notifications?.info?.(`Добавлено ${result.foodLb} фнт. еды группы из «${result.itemName}».`);
  moduleApi.inventoryApp?.render?.({ force: true });
  return true;
}

export function registerRationFoodConversionHook(moduleApi, { Hooks = globalThis.Hooks } = {}) {
  if (rationFoodConversionHookRegistered || typeof Hooks?.on !== "function") {
    return false;
  }

  rationFoodConversionHookRegistered = true;
  Hooks.on("createItem", (item, options, userId) => {
    handleCreatedRationItem(item, options, userId, moduleApi).catch((error) => {
      console.error(`${MODULE_ID} | Failed to convert ration item into party food.`, error);
      globalThis.ui?.notifications?.error?.(error.message || "Не удалось превратить предмет в еду группы.");
    });
  });
  return true;
}
