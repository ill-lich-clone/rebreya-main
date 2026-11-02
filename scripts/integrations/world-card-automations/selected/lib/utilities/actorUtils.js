import { socketUtils } from "./socketUtils.js";
import { socket } from "../sockets.js";
import { sockets } from "../sockets.js";
export function getEffects(actor, {includeItemEffects = false} = {}) {
    let effects = Array.from(actor.allApplicableEffects());
    if (!includeItemEffects) return effects;
    let enchantmentEffects = actor.items.contents.flatMap(item => item.effects.contents).filter(effect => effect.type === 'enchantment' && effect.isAppliedEnchantment);
    return effects.concat(enchantmentEffects);
}
export async function addFavorites(actor, entities) {
    if (!actor.system.addFavorite) return;
    let hasPermission = socketUtils.hasPermission(actor, game.user.id);
    if (hasPermission) {
        for (let entity of entities) {
            const entityType = entity.documentName;
            if (entityType === 'Item') {
                await actor.system.addFavorite({
                    id: entity.getRelativeUUID(entity.actor),
                    type: 'item'
                });
            } else if (entityType === 'Activity') {
                await actor.system.addFavorite({
                    id: entity.relativeUUID,
                    type: 'activity'
                });
            }
        }
    } else {
        await socket.executeAsGM(sockets.addFavorites.name, actor.uuid, entities.map(e => e.uuid));
    }
}
export function getFirstToken(actor) {
    let tokens = actor.getActiveTokens();
    if (tokens.length) return tokens[0];
}
export function getLevelOrCR(actor) {
    return actor.type === 'character' ? actor.system.details.level : actor.system.details.cr ?? 0;
}
export function checkTrait(actor, type, trait) {
    return actor.system.traits?.[type]?.value?.has(trait);
}
export function typeOrRace(actor) {
    return MidiQOL.typeOrRace(actor);
}
export function getSize(actor, returnString) {
    switch(actor.system.traits.size) {
        case 'tiny':
            return returnString ? 'tiny' : 0;
        case 'sm':
            return returnString ? 'sm' : 1;
        case 'med':
            return returnString ? 'med' : 2;
        case 'lg':
            return returnString ? 'lg' : 3;
        case 'huge':
            return returnString ? 'huge': 4;
        case 'grg':
            return returnString ? 'grg' : 5;
    }
}
export function hasUsedReaction(actor) {
    return MidiQOL.hasUsedReaction(actor);
}
export async function setReactionUsed(actor, sourceItem) {
    let hasPermission = socketUtils.hasPermission(actor, game.user.id);
    if (hasPermission) {
        return MidiQOL.setReactionUsed(actor);
    } else {
        return await socket.executeAsGM(sockets.setReactionUsed.name, actor.uuid, sourceItem?.uuid);
    }
}
export function hasSpellSlots(actor, atLeast = 0) {
    return Object.values(actor.system.spells).filter(i => i.value && i.level >= atLeast).length > 0;
}
export function getCastableSpells(actor) {
    let maxSlot = Math.max(...Object.values(actor.system.spells).filter(i => i.value).map(j => j.level), 0);
    let validSpells = actor.items.filter(i => i.type === 'spell');
    // If "prepared" mode, keep only prepared
    validSpells = validSpells.filter(i => i.system.method != 'spell' || i.system.level === 0 || i.system.prepared);
    // If limited use, has uses remaining
    validSpells = validSpells.filter(i => !i.system.hasLimitedUses || i.system.uses.value);
    // If no spell slot (and requires), remove
    validSpells = validSpells.filter(i => ['atwill', 'innate'].includes(i.system.method) || maxSlot >= i.system.level);
    // Cast activity shenanigans
    validSpells = validSpells.filter(i => {
        let linkedActivity = i.system.linkedActivity;
        if (!linkedActivity) return true;
        for (let target of linkedActivity.consumption.targets ?? []) {
            if (target.type === 'itemUses') {
                let targetItem;
                if (!target.target?.length) {
                    targetItem = linkedActivity.item;
                } else {
                    targetItem = actor.items.get(target.target);
                }
                if (Number(targetItem?.system.uses.value ?? 0) < Number(target.value ?? 0)) return false;
            } else if (target.type === 'activityUses') {
                if (Number(linkedActivity.uses.value ?? 0) < Number(target.value ?? 0)) return false;
            } else if (target.type === 'material') {
                if (Number(actor.items.get(target.target)?.system.quantity ?? 0) < Number(target.value ?? 0)) return false;
            }
        }
        return true;
    });
    return validSpells;
}
export function getEquivalentSpellSlotName(actor, level, {canCast = false} = {}) {
    if (!canCast) {
        return Object.entries(actor.system.spells)?.find(i => i[1].level == level)?.[0];
    } else {
        return Object.entries(actor.system.spells)?.find(i => i[1].level >= level && i[1].value)?.[0];
    }
}
export const actorUtils = {
    getEffects,
    addFavorites,
    getFirstToken,
    getLevelOrCR,
    checkTrait,
    typeOrRace,
    getSize,
    hasUsedReaction,
    setReactionUsed,
    hasSpellSlots,
    getCastableSpells,
    getEquivalentSpellSlotName
};
