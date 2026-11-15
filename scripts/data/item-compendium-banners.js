import { GEAR_COMPENDIUM_NAME, MAGIC_ITEMS_COMPENDIUM_NAME, MODULE_ID } from "../constants.js";

export const ITEM_COMPENDIUM_BANNERS = Object.freeze({
  [`world.${GEAR_COMPENDIUM_NAME}`]: `modules/${MODULE_ID}/assets/ui/rebreya-party-inventory-workshop.webp`,
  [`world.${MAGIC_ITEMS_COMPENDIUM_NAME}`]: `modules/${MODULE_ID}/assets/icon-badges/magic-items.png`
});

export function applyItemCompendiumBanners(packs = globalThis.game?.packs, sidebar = globalThis.ui?.compendium) {
  let changed = false;
  for (const [id, banner] of Object.entries(ITEM_COMPENDIUM_BANNERS)) {
    const metadata = packs?.get(id)?.metadata;
    if (metadata?.type !== "Item" || metadata.banner !== undefined) continue;
    // Foundry accepts banners on pack creation. Existing packs keep their stored metadata.
    metadata.banner = banner;
    changed = true;
  }
  if (changed && sidebar?.rendered) sidebar.render();
}
