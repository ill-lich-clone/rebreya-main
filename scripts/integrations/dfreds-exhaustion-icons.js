import { isActiveGmClient } from "../infrastructure/foundry/active-gm.js";

const DFREDS = "dfreds-convenient-effects";
const LEGACY_ICON = /^modules\/dfreds-convenient-effects\/images\/exhaustion([2-5])\.svg$/u;

export async function repairDfredsExhaustionIcons(game) {
  if (!isActiveGmClient(game) || game.system?.id !== "dnd5e" || !(Number.parseInt(game.system.version, 10) >= 6)) return;

  for (const item of game.items?.contents ?? []) {
    if (item.getFlag?.(DFREDS, "isConvenient") !== true || item.getFlag(DFREDS, "isBackup") !== false) continue;
    const updates = [];
    for (const effect of item.effects?.contents ?? []) {
      const level = LEGACY_ICON.exec(effect.img)?.[1];
      if (!level || effect.getFlag?.(DFREDS, "isConvenient") !== true || effect.getFlag(DFREDS, "isBackup") !== false) continue;
      updates.push({ _id: effect.id, img: `systems/dnd5e/icons/svg/statuses/exhaustion-${level}.svg` });
    }
    if (updates.length) await item.updateEmbeddedDocuments("ActiveEffect", updates);
  }
}
