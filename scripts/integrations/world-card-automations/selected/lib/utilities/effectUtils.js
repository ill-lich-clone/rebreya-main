import { socketUtils } from "./socketUtils.js";
import { genericUtils } from "./genericUtils.js";
import { socket } from "../sockets.js";
import { sockets } from "../sockets.js";
import { actorUtils } from "./actorUtils.js";
import { attachGrappleStatuses, prepareCardEffect, sourceItemOf } from "../../../effect-data.js";
import { rememberCardDependent } from "../../../effect-lifecycle.js?v=1.5.59";
export async function createEffect(entity, effectData, {concentrationItem, parentEntity, identifier, vae, interdependent, strictlyInterdependent, unhideActivities, rules, macros, conditions, animate = true, tokenImg, avatarImg, tokenImgPriority = 50, avatarImgPriority = 50, keepId = false} = {}, {animationPath, animationSize = 1, animationFadeIn = 300, animationFadeOut = 300, animationSound} = {}) {
    effectData = foundry.utils.deepClone(effectData);
    let hasPermission = socketUtils.hasPermission(entity, game.user.id);
    let concentrationEffect;
    if (concentrationItem) concentrationEffect = getConcentrationEffect(concentrationItem.actor, concentrationItem);
    const originItem = concentrationItem ?? await sourceItemOf(parentEntity)
        ?? (effectData.origin ? await sourceItemOf(await fromUuid(effectData.origin)) : null);
    prepareCardEffect(effectData, {item: originItem, parent: parentEntity, concentration: concentrationEffect, rules, generation: game.release.generation});
    if (concentrationEffect) effectData.origin = concentrationEffect.uuid;
    if (identifier) genericUtils.setProperty(effectData, 'flags.chris-premades.info.identifier', identifier);
    if (unhideActivities) genericUtils.setProperty(effectData, 'flags.chris-premades.unhideActivities', unhideActivities);
    if (parentEntity) genericUtils.setProperty(effectData, 'flags.chris-premades.parentEntityUuid', parentEntity.uuid);
    if (concentrationEffect) genericUtils.setProperty(effectData, 'flags.chris-premades.concentrationEffectUuid', concentrationEffect.uuid);
    if (interdependent && (parentEntity || concentrationItem)) genericUtils.setProperty(effectData, 'flags.chris-premades.interdependent', true);
    if (vae) genericUtils.setProperty(effectData, 'flags.chris-premades.vae.buttons', vae);
    if (macros) macros.forEach(i => addMacro(effectData, i.type, i.macros));
    if (conditions) genericUtils.setProperty(effectData, 'flags.chris-premades.conditions', conditions);
    if (!animate) genericUtils.setProperty(effectData, 'flags.chris-premades.effect.noAnimation', true);
    if (tokenImg) {
        genericUtils.setProperty(effectData, 'flags.chris-premades.image.token.value', tokenImg);
        genericUtils.setProperty(effectData, 'flags.chris-premades.image.token.priority', tokenImgPriority);
    }
    if (avatarImg) {
        genericUtils.setProperty(effectData, 'flags.chris-premades.image.actor.value', avatarImg);
        genericUtils.setProperty(effectData, 'flags.chris-premades.image.actor.priority', avatarImgPriority);
    }
    attachGrappleStatuses(effectData, entity.system?.traits?.ci?.value);
    const dependency = parentEntity ?? concentrationEffect;
    if (dependency) genericUtils.setProperty(effectData, 'flags.dnd5e.dependentOn', dependency.uuid);
    let effects;
    if (hasPermission) {
        effects = await entity.createEmbeddedDocuments('ActiveEffect', [effectData], {keepId});
    } else {
        effects = [await socket.executeAsGM(sockets.createEffect.name, entity.uuid, effectData, {concentrationItemUuid: concentrationItem?.uuid, parentEntityUuid: parentEntity?.uuid, keepId})];
        effects = await Promise.all(effects.map(async i => await fromUuid(i)));
    }
    if ((interdependent || strictlyInterdependent) && dependency && effects[0]) await rememberCardDependent(dependency, effects[0], game.user);
    if (strictlyInterdependent && dependency && effects[0]) {
        const existing = dependency.flags?.dnd5e?.dependentOn;
        if (!existing) await genericUtils.setFlag(dependency, 'dnd5e', 'dependentOn', effects[0].uuid);
    }
    if ((animationPath || animationSound) && effects.length) {
        let token = actorUtils.getFirstToken(effects[0].parent);
        if (token) {
            /* eslint-disable indent */
            new Sequence()
                .effect()
                    .playIf(animationPath)
                    .file(animationPath)
                    .size(animationSize, {gridUnits: true})
                    .attachTo(token)
                    .persist()
                    .fadeIn(animationFadeIn)
                    .fadeOut(animationFadeOut)
                    .tieToDocuments([token.document, effects[0]])
                .sound()
                    .playIf(animationSound)
                    .file(animationSound)
                .play();
            /* eslint-enable indent */
        }
    }
    if (effects?.length) return effects[0];
}
export async function addDependent(entity, dependents, forceGM = false) {
    let hasPermission = false;
    if (!forceGM) hasPermission = !dependents.some(i => !socketUtils.hasPermission(i, game.user.id));
    if (hasPermission) {
        await Promise.all(dependents.map(i => i.setFlag('dnd5e', 'dependentOn', entity.uuid)));
    } else {
        await socket.executeAsGM(sockets.addDependent.name, entity.uuid, dependents.map(i => i.uuid));
    }
}
export function addMacro(effectData, type, macroList) {
    let currentMacroList = genericUtils.getProperty(effectData, 'flags.chris-premades.macros.' + type) ?? [];
    return genericUtils.setProperty(effectData, 'flags.chris-premades.macros.' + type, currentMacroList.concat(macroList));
}
export function getConcentrationEffect(actor, item) {
    return MidiQOL.getConcentrationEffect(actor, item);
}
export function getEffectByIdentifier(actor, name) {
    return actorUtils.getEffects(actor).find(i => genericUtils.getIdentifier(i) === name);
}
export function getAllEffectsByIdentifier(actor, name) {
    return actorUtils.getEffects(actor).filter(i => genericUtils.getIdentifier(i) === name);
}
export function getEffectByStatusID(actor, statusID) {
    return actorUtils.getEffects(actor).find(effect => effect.active !== false && !effect.disabled && !effect.isSuppressed
        && !effect.duration?.expired && effect.statuses?.has?.(statusID));
}
export async function applyConditions(actor, conditions, {overlay = false} = {}) {
    let updates = [];
    await Promise.all(conditions.map(async i => {
        if (actorUtils.checkTrait(actor, 'ci', i) || actor.statuses?.has(i)) return;
        let cEffect = getEffectByStatusID(actor, i);
        if (cEffect) return;
        let effectImplementation = await ActiveEffect.implementation.fromStatusEffect(i);
        if (!effectImplementation) return;
        let effectData = effectImplementation.toObject();
        if (overlay) genericUtils.setProperty(effectData, 'flags.core.overlay', true);
        updates.push(effectData);
    }));
    if (updates.length) return await genericUtils.createEmbeddedDocuments(actor, 'ActiveEffect', updates, {keepId: true});
}
export async function getOriginItem(effect) {
    return sourceItemOf(effect);
}
export const effectUtils = {
    createEffect,
    addDependent,
    addMacro,
    getConcentrationEffect,
    getEffectByIdentifier,
    getAllEffectsByIdentifier,
    getEffectByStatusID,
    applyConditions,
    getOriginItem
};
