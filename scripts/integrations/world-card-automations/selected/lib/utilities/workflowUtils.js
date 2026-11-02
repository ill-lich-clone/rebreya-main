import { genericUtils } from "./genericUtils.js";
import { socketUtils } from "./socketUtils.js";
import { itemUtils } from "./itemUtils.js";
import { socket } from "../sockets.js";
import { sockets } from "../sockets.js";
import { actorUtils } from "./actorUtils.js";
import { constants } from "../constants.js";
import { rollUtils } from "./rollUtils.js";
import { effectUtils } from "./effectUtils.js";
export async function bonusDamage(workflow, formula, {ignoreCrit = false, damageType}={}) {
    formula = String(formula);
    if (workflow.isCritical && !ignoreCrit) formula = await rollUtils.getCriticalFormula(formula, workflow.activity.getRollData());
    let roll = await new CONFIG.Dice.DamageRoll(formula, workflow.activity.getRollData()).evaluate();
    if (damageType) {
        genericUtils.setProperty(roll, 'options.type', damageType);
    } else {
        genericUtils.setProperty(roll, 'options.type', roll.terms[0].flavor);
    }
    workflow.damageRolls.push(roll);
    await workflow.setDamageRolls(workflow.damageRolls);
}
export async function completeActivityUse(activity, config = {}, dialog = {}, message = {}) {
    let fixSets = false;
    if (!config.midiOptions?.asUser && !socketUtils.hasPermission(activity.actor, game.userId)) {
        if (!config.midiOptions) config.midiOptions = {};
        config.midiOptions.asUser = socketUtils.firstOwner(activity.actor, true);
        config.midiOptions.checkGMStatus = true;
        config.midiOptions.workflowData = true;
        fixSets = true;
    } else if (config.midiOptions?.asUser && config.midiOptions?.asUser !== game.userId) {
        config.midiOptions.workflowData = true;
        fixSets = true;
    }
    let workflow = await MidiQOL.completeActivityUse(activity, config, dialog, message);
    if (!workflow) return workflow;
    workflow = workflow.workflow ?? workflow;
    if (fixSets) {
        if (workflow.failedSaves) workflow.failedSaves = new Set(workflow.failedSaves);
        if (workflow.hitTargets) workflow.hitTargets = new Set(workflow.hitTargets);
        if (workflow.targets) workflow.targets = new Set(workflow.targets);
    }
    return workflow;
}
export async function completeItemUse(item, config = {}, options = {}) {
    let fixSets = false;
    if (!options.asUser && !socketUtils.hasPermission(item.actor, game.userId)) {
        options.asUser = socketUtils.firstOwner(item.actor, true);
        options.checkGMStatus = true;
        options.workflowData = true;
        fixSets = true;
    } else if (options.asUser && options.asUser !== game.userId) {
        options.workflowData = true;
        fixSets = true;
    }
    config.midiOptions = genericUtils.mergeObject(config.midiOptions ?? {}, options);
    let workflow = await MidiQOL.completeItemUse(item, config);
    if (!workflow) return workflow;
    if (fixSets) {
        if (workflow.failedSaves) workflow.failedSaves = new Set(workflow.failedSaves);
        if (workflow.hitTargets) workflow.hitTargets = new Set(workflow.hitTargets);
        if (workflow.targets) workflow.targets = new Set(workflow.targets);
    }
    return workflow;
}
export async function syntheticActivityRoll(activity, targets = [], {options = {}, config = {}, userId, atLevel = undefined, consumeUsage = false, consumeResources = false, spellSlot = false, dialog = {}, message = {}} = {}) {
    activity = syntheticCardActivity(activity);
    let defaultConfig = {
        consumeUsage,
        consume: {
            resources: consumeResources,
            spellSlot
        }
    };
    let autoRollDamage = MidiQOL.configSettings().autoRollDamage;
    if (!['always', 'onHit'].includes(autoRollDamage)) autoRollDamage = 'onHit';
    let defaultOptions = {
        targetUuids: targets.map(i => i.document.uuid),
        configureDialog: false,
        //ignoreUserTargets: true,
        workflowOptions: {
            autoRollDamage,
            autoFastDamage: true,
            autoRollAttack: true
        }
    };
    if (atLevel) {
        let spellLabel = actorUtils.getEquivalentSpellSlotName(activity.actor, atLevel);
        if (spellLabel) defaultConfig.spell = {slot: spellLabel};
    }
    if (userId) options.asUser ||= userId;
    options = genericUtils.mergeObject(defaultOptions, options);
    config = genericUtils.mergeObject(defaultConfig, config);
    config.midiOptions = options;
    return await completeActivityUse(activity, config, dialog, message);
}
export async function syntheticItemRoll(item, targets, {options = {}, config = {}, userId, consumeUsage = false, consumeResources = false, spellSlot = false} = {}) {
    let defaultConfig = {
        consumeUsage,
        consume: {
            resources: consumeResources,
            spellSlot
        }
    };
    let autoRollDamage = MidiQOL.configSettings().autoRollDamage;
    if (!['always', 'onHit'].includes(autoRollDamage)) autoRollDamage = 'onHit';
    let defaultOptions = {
        targetUuids: targets.map(i => i.document.uuid),
        configureDialog: false,
        //ignoreUserTargets: true,
        workflowOptions: {
            autoRollDamage,
            autoFastDamage: true,
            autoRollAttack: true
        }
    };
    options = genericUtils.mergeObject(defaultOptions, options);
    config = genericUtils.mergeObject(defaultConfig, config);
    if (userId) genericUtils.setProperty(options, 'asUser', userId);
    return await completeItemUse(item, config, options);
}
export async function syntheticItemDataRoll(itemData, actor, targets, {options = {}, config = {}, killAnim = false} = {}) {
    if (killAnim) genericUtils.mergeObject(itemData, {'flags.autoanimations': {
        isEnabled: false,
        isCustomized: false,
        fromAmmo: false,
        version: 5
    }});
    let hasPermission = socketUtils.hasPermission(actor, game.user.id);
    if (hasPermission) {
        let item = await itemUtils.syntheticItem(itemData, actor);
        return await syntheticItemRoll(item, targets, {options, config});
    } else {
        let workflowData = await socket.executeAsGM(sockets.syntheticItemDataRoll.name, itemData, actor.uuid, targets.map(i => i.document.uuid), {options, config});
        if (workflowData.failedSaves) workflowData.failedSaves = new Set(workflowData.failedSaves);
        if (workflowData.hitTargets) workflowData.hitTargets = new Set(workflowData.hitTargets);
        if (workflowData.targets) workflowData.targets = new Set(workflowData.targets);
        return workflowData;
    }
}
export async function syntheticActivityDataRoll(activityData, item, actor, targets, {options = {}, config = {}, atLevel = undefined, consumeUsage = false, consumeResources = false} = {}) {
    let itemData = genericUtils.duplicate(item.toObject());
    itemData.system.activities[activityData._id] = activityData;
    let newItem = await itemUtils.syntheticItem(itemData, actor);
    let newActivity = newItem.system.activities.get(activityData._id);
    return await syntheticActivityRoll(newActivity, targets, {options, config, atLevel, consumeUsage, consumeResources});
}
export async function handleInstantTemplate(workflow) {
    if (!workflow.template) return;
    let templateEffectName = genericUtils.format('CHRISPREMADES.GenericEffects.TemplateEffect', {itemName: workflow.item.name});
    let templateEffect = workflow.actor.effects.getName(templateEffectName);
    if (templateEffect) {
        await genericUtils.setFlag(templateEffect, 'chris-premades', 'macros.combat', ['removeTemplate']);
    } else {
        let effectData = {
            name: templateEffectName,
            img: workflow.item.img,
            origin: workflow.item.uuid
        };
        effectUtils.addMacro(effectData, 'combat', ['removeTemplate']);
        let effect = await effectUtils.createEffect(workflow.actor, effectData);
        await effectUtils.addDependent(effect, [workflow.template]);
    }
}
export function getCastLevel(workflow) {
    return Math.max(workflow.castData.castLevel, workflow.castData.baseLevel);
}
export async function updateTargets(workflow, targets, {userId} = {}) {
    workflow.targets = new Set(targets);
    await genericUtils.updateTargets(targets, userId);
}
export function getActionType(workflow) {
    return workflow.activity.getActionType(workflow.attackMode);
}
export function isAttackType(workflow, type = 'attack') {
    if (!workflow.activity) return;
    let field;
    switch (type) {
        case 'attack': field = 'attacks'; break;
        case 'meleeAttack': field = 'meleeAttacks'; break;
        case 'rangedAttack': field = 'rangedAttacks'; break;
        case 'weaponAttack': field = 'weaponAttacks'; break;
        case 'spellAttack': field = 'spellAttacks'; break;
        case 'rangedWeaponAttack': field = 'rangedWeaponAttacks'; break;
        case 'meleeWeaponAttack': field = 'meleeWeaponAttacks'; break;
        default: return;
    }
    return constants[field].includes(getActionType(workflow));
}
export const workflowUtils = {
    bonusDamage,
    completeItemUse,
    syntheticActivityRoll,
    syntheticItemRoll,
    syntheticItemDataRoll,
    handleInstantTemplate,
    getCastLevel,
    syntheticActivityDataRoll,
    updateTargets,
    isAttackType,
    getActionType
};
import { syntheticCardActivity } from "../../../effect-data.js";
