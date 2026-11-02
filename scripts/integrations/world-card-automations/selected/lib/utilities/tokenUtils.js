import { movementReceiptPatch } from "../../../movement-receipts.js";
import { releaseMovedCardGrapples } from "../../../grapple-release.js";
import { genericUtils } from "./genericUtils.js";
import { actorUtils } from "./actorUtils.js";
import { effectUtils } from "./effectUtils.js";
import { itemUtils } from "./itemUtils.js";
import { compendiumUtils } from "./compendiumUtils.js";
import { constants } from "../constants.js";
import { socketUtils } from "./socketUtils.js";
import { dialogUtils } from "./dialogUtils.js";
import { rollUtils } from "./rollUtils.js";
import { errors } from "../errors.js";
import { workflowUtils } from "./workflowUtils.js";
export function getDistance(sourceToken, targetToken, {wallsBlock, checkCover} = {}) {
    return MidiQOL.computeDistance(sourceToken, targetToken, {wallsBlock, includeCover: checkCover});
}
export function checkCover(sourceToken, targetToken, {activity, item, displayName}) {
    // TODO replace the following with MidiQOL.getCoverBonus when that becomes available
    let statusCover = targetToken.actor?.statuses.has('coverTotal') ? 999 :
        (targetToken.actor?.system.attributes.ac.cover ?? 0);
    // still passing in item to send midi's deprecation warning to macro writers
    let moduleCover = MidiQOL.computeCoverBonus(sourceToken, targetToken, activity ?? item);
    let cover = Math.max(moduleCover, statusCover);
    if (!displayName) return cover;
    switch (cover) {
        case 0:
            return genericUtils.translate('CHRISPREMADES.Cover.No');
        case 2:
            return genericUtils.translate('CHRISPREMADES.Cover.Half');
        case 5:
            return genericUtils.translate('CHRISPREMADES.Cover.ThreeQuarters');
        case 999:
            return genericUtils.translate('CHRISPREMADES.Cover.Full');
        default:
            return genericUtils.translate('CHRISPREMADES.Cover.Unknown');
    }
}
export async function moveTokenAlongRay(targetToken, origRay, distance, receipt) {
    let bulwark = itemUtils.getItemByIdentifier(targetToken.actor, 'bulwark');
    if (bulwark && !actorUtils.hasUsedReaction(targetToken.actor)) {
        let useBulwark = await dialogUtils.confirm(bulwark.name, 'CHRISPREMADES.Macros.Bulwark.Use', {userId: socketUtils.firstOwner(targetToken.actor, true)});
        if (useBulwark) {
            await workflowUtils.completeItemUse(bulwark);
            return;
        }
    }
    let knockBackFactor;
    let newCenter;
    let hitsWall = true;
    let oldDistance;
    let ray = foundry.canvas.geometry.Ray.fromAngle(targetToken.center.x, targetToken.center.y, origRay.angle, origRay.distance);
    if (ray.distance === 0) {
        genericUtils.notify('CHRISPREMADES.Movement.UnableToBeMoved', 'info');
        return;
    }
    while (hitsWall) {
        knockBackFactor = distance / canvas.dimensions.distance;
        newCenter = ray.project((canvas.dimensions.size * knockBackFactor) / ray.distance);
        hitsWall = targetToken.checkCollision(newCenter, {origin: ray.A, type: 'move', mode: 'any'});
        if (hitsWall) {
            oldDistance = distance;
            distance += distance > 0 ? -5 : 5;
            if (distance === 0 || (Math.sign(oldDistance) !== Math.sign(distance))) {
                genericUtils.notify('CHRISPREMADES.Movement.UnableToBeMoved', 'info');
                return;
            }
        }
    }
    newCenter = canvas.grid.getSnappedPoint({x: newCenter.x - targetToken.w / 2, y: newCenter.y - targetToken.h / 2}, {mode: 0xFF0});
    await genericUtils.update(targetToken.document, {
        x: newCenter.x,
        y: newCenter.y,
        ...movementReceiptPatch(targetToken.document, receipt)
    });
    return true;
}
export async function pushToken(sourceToken, targetToken, distance, receipt) {
    const ray = new foundry.canvas.geometry.Ray(sourceToken.center, targetToken.center);
    if (!await moveTokenAlongRay(targetToken, ray, distance, receipt)) return false;
    if (await releaseMovedCardGrapples(targetToken)) await genericUtils.sleep(250);
    return true;
}
export function findNearby(token, range, disposition, {includeIncapacitated = false, includeToken = false} = {}) {
    let dispositionValue;
    switch (disposition) {
        case 'ally':
            dispositionValue = 1;
            break;
        case 'neutral':
            dispositionValue = 0;
            break;
        case 'enemy':
            dispositionValue = -1;
            break;
        default:
            dispositionValue = null;
    }
    return MidiQOL.findNearby(dispositionValue, token, range, {includeIncapacitated, includeToken}).filter(i => !i.document.hidden);
}
export function canSee(sourceToken, targetToken) {
    return MidiQOL.canSee(sourceToken, targetToken);
}
export function canSense(sourceToken, targetToken, senseModes = ['all']) {
    return MidiQOL.canSense(sourceToken, targetToken, senseModes);
}
export async function attachToToken(token, uuidsToAttach) {
    let currAttached = new Set(token.document.flags?.['chris-premades']?.attached?.attachedEntityUuids ?? []);
    uuidsToAttach.forEach(uuid => currAttached.add(uuid));
    await genericUtils.update(token.document, {
        flags: {
            'chris-premades': {
                attached: {
                    attachedEntityUuids: Array.from(currAttached)
                }
            }
        }
    });
}
export async function grappleHelper(sourceToken, targetToken, item, {noContest = false, flatDC = false, escapeDisadvantage = false, sourceEffect, targetEffect, restrained = false, ignoreSizeLimit = false}={}) {
    let sourceActor = sourceToken.actor;
    if (actorUtils.checkTrait(targetToken.actor, 'ci', 'grappled')) {
        genericUtils.notify('CHRISPREMADES.Macros.Grapple.Immune', 'info');
        return;
    }
    if (!ignoreSizeLimit) {
        let heavy = !!itemUtils.getItemByIdentifier(sourceActor, 'heavyweight');
        if (actorUtils.getSize(targetToken.actor) > (actorUtils.getSize(sourceActor) + 1 + heavy)) {
            genericUtils.notify('CHRISPREMADES.Macros.Grapple.Size', 'info');
            return;
        }
    }
    if (!noContest) {
        let inputs = [[CONFIG.DND5E.skills.ath.label, 'ath'], [CONFIG.DND5E.skills.acr.label, 'acr'], ['CHRISPREMADES.Generic.Uncontested', 'skip']];
        let targetUser = socketUtils.firstOwner(targetToken);
        let selection = await dialogUtils.buttonDialog(item.name, 'CHRISPREMADES.Macros.Grapple.ChooseSkill', inputs, {displayAsRows: true, userId: targetUser.id});
        if (!selection) return;
        // TODO: more generic version of this? Does it come up elsewhere?
        let sourceRollOptions, targetRollOptions;
        if (itemUtils.getItemByIdentifier(sourceActor, 'amorphous')) {
            sourceRollOptions = {
                advantage: true
            };
        }
        if (selection != 'skip') {
            let result = await rollUtils.contestedRoll({
                sourceToken,
                targetToken,
                sourceRollType: 'skill',
                targetRollType: 'skill',
                sourceAbilities: ['ath'],
                targetAbilities: [selection],
                sourceRollOptions,
                targetRollOptions
            });
            if (result <= 0) return;
        }
    }
    let sourceEffectData = {
        name: genericUtils.format('CHRISPREMADES.Macros.Actions.Grappling', {tokenName: targetToken.name}),
        img: item.img,
        origin: sourceActor.uuid,
        flags: {
            dae: {
                showIcon: true
            },
            'chris-premades': {
                grapple: {
                    tokenId: targetToken.id
                }
            }
        }
    };
    let targetEffectName = genericUtils.format('CHRISPREMADES.Macros.Actions.GrappledBy', {tokenName: sourceToken.name});
    let targetEffectData = {
        name: targetEffectName,
        img: 'icons/environment/traps/net.webp',
        origin: sourceActor.uuid,
        changes: [
            {
                key: 'flags.Rideable.RegisteredActorEffectsFlag.grapple',
                mode: 2,
                value: targetEffectName,
                priority: 20
            }
        ],
        flags: {
            dae: {
                showIcon: true
            },
            'chris-premades': {
                conditions: ['grappled'],
                grapple: {
                    tokenId: sourceToken.id
                }
            }
        }
    };
    if (restrained && !actorUtils.checkTrait(targetToken.actor, 'ci', 'restrained')) {
        targetEffectData.flags['chris-premades'].conditions.push('restrained');
    }
    for (const effect of [sourceEffectData, targetEffectData]) {
        genericUtils.setProperty(effect, 'flags.rebreya-main.worldCardSource', item.uuid);
    }
    effectUtils.addMacro(sourceEffectData, 'death', ['grapple']);
    effectUtils.addMacro(targetEffectData, 'death', ['grapple']);
    let cleanFinish = itemUtils.getItemByIdentifier(sourceActor, 'cleanFinish');
    if (cleanFinish) {
        genericUtils.setProperty(targetEffectData, 'flags.chris-premades.cleanFinish', cleanFinish.uuid);
        effectUtils.addMacro(targetEffectData, 'combat', ['cleanFinishCombatTurn']);
    }
    let grappler = itemUtils.getItemByIdentifier(sourceActor, 'grappler');
    let pinData = itemUtils.getItemByIdentifier(sourceActor, 'grapplerPin');
    if (grappler && genericUtils.getRules(grappler) === 'modern') grappler = undefined;
    if (grappler && !pinData) {
        pinData = await compendiumUtils.getItemFromCompendium(constants.featurePacks.featFeatures, 'Grappler: Pin', {object: true, getDescription: true, translate: 'CHRISPREMADES.Macros.Grappler.Pin', identifier: 'grapplerPin'});
        if (!pinData) {
            errors.missingPackItem();
            return;
        }
    }
    let escapeData = await compendiumUtils.getItemFromCompendium(constants.featurePacks.miscellaneousItems, 'Grapple: Escape', {object: true, translate: 'CHRISPREMADES.Macros.Actions.GrappleEscape', identifier: 'grappleEscape'});
    if (!escapeData) return;
    if (flatDC || escapeDisadvantage) {
        genericUtils.setProperty(escapeData, 'flags.chris-premades.grapple.' + sourceToken.id, {
            dc: flatDC,
            disadvantage: escapeDisadvantage
        });
    }
    let sourceOptions = {identifier: 'grappling'};
    if (grappler) sourceOptions.vae = [{type: 'use', name: pinData.name, identifier: 'grapplerPin'}];
    if (!sourceEffect) {
        sourceEffect = await effectUtils.createEffect(sourceActor, sourceEffectData, sourceOptions);
    } else {
        await genericUtils.update(sourceEffect, {
            flags: {
                'chris-premades': {
                    vae: sourceOptions.vae,
                    grapple: {
                        tokenId: targetToken.id
                    },
                    info: {
                        identifier: 'grappling'
                    }
                }
            }
        });
    }
    if (grappler) await itemUtils.createItems(sourceActor, [pinData], {favorite: true, parentEntity: sourceEffect});
    if (!targetEffect) {
        targetEffect = await effectUtils.createEffect(targetToken.actor, targetEffectData, {identifier: 'grappled', parentEntity: sourceEffect, strictlyInterdependent: true, vae: [{type: 'use', name: escapeData.name, identifier: 'grappleEscape'}]});
    } else {
        await genericUtils.update(targetEffect, {
            flags: {
                'chris-premades': {
                    parentEntityUuid: sourceEffect.uuid,
                    vae: [
                        {
                            type: 'use',
                            name: escapeData.name,
                            identifier: 'grappleEscape'
                        }
                    ],
                    info: {
                        identifier: 'grappled'
                    },
                    grapple: {
                        tokenId: sourceToken.id
                    }
                }
            }
        });
        await effectUtils.addDependent(targetEffect, [sourceEffect]);
        await effectUtils.addDependent(sourceEffect, [targetEffect]);
    }
    let escapeItem = itemUtils.getItemByIdentifier(targetToken.actor, 'grappleEscape');
    if (!escapeItem) {
        await itemUtils.createItems(targetToken.actor, [escapeData], {favorite: true, parentEntity: targetEffect});
    } else {
        await genericUtils.update(escapeItem, {
            flags: {
                'chris-premades': {
                    grapple: {
                        [sourceToken.id]: {
                            dc: flatDC,
                            disadvantage: escapeDisadvantage
                        }
                    }
                }
            }
        });
    }
    let grappledEffect = effectUtils.getEffectByStatusID(targetToken.actor, 'grappled');
    let timePassed = 0;
    while (!grappledEffect && timePassed < 1000) {
        await genericUtils.sleep(100);
        grappledEffect = effectUtils.getEffectByStatusID(targetToken.actor, 'grappled');
        timePassed += 100;
    }
    if (grappledEffect) await effectUtils.addDependent(grappledEffect, [targetEffect]);
    if (game.modules.get('Rideable')?.active) game.Rideable.Mount([targetToken.document], sourceToken.document, {Grappled: true, MountingEffectsOverride: ['Grappled']});
}
export const tokenUtils = {
    getDistance,
    checkCover,
    pushToken,
    findNearby,
    canSee,
    canSense,
    attachToToken,
    grappleHelper
};
