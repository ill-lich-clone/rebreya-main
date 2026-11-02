import { grappleItems } from "./grapple-items.js";
import { genericUtils } from "./genericUtils.js";
export const compendiumUtils = {
    async getItemFromCompendium(key, name, { identifier, translate } = {}) {
        if (key !== "local-grapple" || !Object.hasOwn(grappleItems, name)) return;
        const data = foundry.utils.deepClone(grappleItems[name]);
        if (translate) data.name = genericUtils.translate(translate);
        if (identifier) foundry.utils.setProperty(data, "flags.chris-premades.info.identifier", identifier);
        return data;
    }
};
