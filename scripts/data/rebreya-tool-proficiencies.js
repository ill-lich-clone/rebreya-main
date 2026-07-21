import {
  GEAR_COMPENDIUM_NAME,
  REBREYA_TOOLS
} from "../constants.js";
import { createStableGearDocumentId } from "./gear-document-ids.js";

const ARTISAN_TOOL_METADATA = Object.freeze({
  alchemy: { ability: "int", dnd5eId: "rebreyaAlchemy", gearId: "instrumenty-alkhimicheskie-0-y-rang" },
  smith: { ability: "str", dnd5eId: "rebreyaSmith", gearId: "instrumenty-kuznetsa-0-y-rang" },
  calligrapher: { ability: "dex", dnd5eId: "rebreyaCalligrapher", gearId: "instrumenty-kalligrafa-0-y-rang" },
  forgery: { ability: "dex", dnd5eId: "rebreyaForgery", gearId: "instrumenty-poddelshchika-0-y-rang" },
  disguise: { ability: "cha", dnd5eId: "rebreyaDisguise", gearId: "instrumenty-grimyora-0-y-rang" },
  artisan: { ability: "wis", dnd5eId: "rebreyaArtisan", gearId: "instrumenty-khudozhestvennye-0-y-rang" },
  investigator: { ability: "int", dnd5eId: "rebreyaInvestigator", gearId: "instrumenty-issledovatelya-0-y-rang" },
  tinker: { ability: "dex", dnd5eId: "rebreyaTinker", gearId: "instrumenty-zhestyanshchika-0-y-rang" },
  mason: { ability: "str", dnd5eId: "rebreyaMason", gearId: "instrumenty-kamneloma-0-y-rang" },
  leatherworker: { ability: "dex", dnd5eId: "rebreyaLeatherworker", gearId: "instrumenty-kozhedela-0-y-rang" },
  brewer: { ability: "int", dnd5eId: "rebreyaBrewer", gearId: "instrumenty-pivovara-0-y-rang" },
  woodcarver: { ability: "dex", dnd5eId: "rebreyaWoodcarver", gearId: "instrumenty-derevyanshchika-0-y-rang" },
  cook: { ability: "wis", dnd5eId: "rebreyaCook", gearId: "instrumenty-povara-0-y-rang" },
  jeweler: { ability: "int", dnd5eId: "rebreyaJeweler", gearId: "instrumenty-yuvelira-0-y-rang" }
});

export const REBREYA_ARTISAN_TOOL_PROFICIENCIES = Object.freeze(
  REBREYA_TOOLS.flatMap((tool) => {
    const metadata = ARTISAN_TOOL_METADATA[tool.id];
    return metadata ? [Object.freeze({ ...tool, ...metadata })] : [];
  })
);

const ARTISAN_TOOL_BY_GEAR_ID = new Map(
  REBREYA_ARTISAN_TOOL_PROFICIENCIES.map((tool) => [tool.gearId, tool])
);

export function getRebreyaArtisanToolByGearId(gearId) {
  return ARTISAN_TOOL_BY_GEAR_ID.get(String(gearId ?? "").trim()) ?? null;
}

export function buildRebreyaArtisanToolConfig() {
  return Object.fromEntries(REBREYA_ARTISAN_TOOL_PROFICIENCIES.map((tool) => [
    tool.dnd5eId,
    {
      ability: tool.ability,
      id: `Compendium.world.${GEAR_COMPENDIUM_NAME}.Item.${createStableGearDocumentId(tool.gearId)}`
    }
  ]));
}
