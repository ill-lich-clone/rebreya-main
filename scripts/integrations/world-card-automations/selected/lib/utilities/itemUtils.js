import { genericUtils } from "./genericUtils.js";
import { animationUtils } from "./animationUtils.js";
import { custom } from "../../events/custom.js";
import { socketUtils } from "./socketUtils.js";
import { actorUtils } from "./actorUtils.js";
import { effectUtils } from "./effectUtils.js";
export function getSaveDC(item) {
    if (item.hasSave) return item.system.activities.getByType('save')[0].save.dc.value;
    let spellChanges = item.effects.get('dnd5espellchange');
    if (spellChanges) {
        let value = (spellChanges.system?.changes ?? spellChanges.changes).find(i => i.key === 'activities[save].save.dc.formula')?.value;
        if (value) return Number(value);
    }
    return item.actor?.system?.abilities?.[item.abilityMod]?.dc ?? item?.actor?.system?.attributes?.spell?.dc ?? 10;
}
export async function createItems(actor, updates, {favorite, section, parentEntity, identifier, castData} = {}) {
    let hasPermission = socketUtils.hasPermission(actor, game.user.id);
    if (section) updates.forEach(i => genericUtils.setProperty(i, 'flags.tidy5e-sheet.section', section));
    if (identifier) updates.forEach(i => genericUtils.setProperty(i, 'flags.chris-premades.info.identifier', identifier));
    if (castData) updates.forEach(i => genericUtils.setProperty(i, 'flags.chris-premades.castData', castData));
    let items;
    if (hasPermission) {
        items = await actor.createEmbeddedDocuments('Item', updates);
    } else {
        items = await genericUtils.createEmbeddedDocuments(actor, 'Item', updates);
    }
    if (favorite) await actorUtils.addFavorites(actor, items);
    if (parentEntity) await effectUtils.addDependent(parentEntity, items);
    return items;
}
export function getItemDescription(name) {
    let journal = game.journal.getName('CPR - Descriptions');
    if (!journal) {
        genericUtils.notify('CHRISPREMADES.Error.MissingDescriptionJournal', 'warn');
        return '';
    }
    let page = journal.pages.getName(name);
    if (!page) {
        genericUtils.notify('CHRISPREMADES.Error.MissingDescriptionPage', 'warn');
        return '';
    }
    return page.text.content;
}
export function getConfig(item, key) {
    if (key === 'playAnimation' && (!genericUtils.getCPRSetting('enableAnimations') || !animationUtils.sequencerCheck())) return false;
    if (key === 'animation'     && (!genericUtils.getCPRSetting('enableAnimations') || !animationUtils.sequencerCheck())) return 'none';
    let flagValue = item.flags['chris-premades']?.config?.[key];
    if (flagValue !== undefined) return flagValue;
    let identifier = genericUtils.getIdentifier(item);
    if (!identifier) return;
    let value = custom.getMacro(identifier, genericUtils.getRules(item))?.config?.find(i => i.value === key)?.default;
    return value === '' ? false : value;
}
export function getItemByIdentifier(actor, identifier) {
    return actor.items.find(i => genericUtils.getIdentifier(i) === identifier);
}
export function getAllItemsByIdentifier(actor, identifier) {
    return actor.items.filter(i => genericUtils.getIdentifier(i) === identifier);
}
export async function syntheticItem(itemData, actor) {
    let item = new CONFIG.Item.documentClass(itemData, {parent: actor});
    item.prepareData();
    item.prepareFinalAttributes();
    item.applyActiveEffects();
    return item;
}
export function convertDuration(entity) {
    if (entity.documentName === 'Item') {
        return DAE.convertDuration(entity.system.duration);
    } else if (entity.documentName === 'Activity') {
        return DAE.convertDuration(entity.duration);
    }
}
export const itemUtils = {
    getSaveDC,
    createItems,
    getItemDescription,
    getConfig,
    getItemByIdentifier,
    getAllItemsByIdentifier,
    syntheticItem,
    convertDuration
};
