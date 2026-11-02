import { itemUtils } from "../../../lib/utilities/itemUtils.js";
import { effectUtils } from "../../../lib/utilities/effectUtils.js";
import { genericUtils } from "../../../lib/utilities/genericUtils.js";
import { constants } from "../../../lib/constants.js";
import { workflowUtils } from "../../../lib/utilities/workflowUtils.js";
import { activityUtils } from "../../../lib/utilities/activityUtils.js";
export async function use({workflow}) {
    let effectData = {
        name: workflow.item.name,
        img: workflow.item.img,
        origin: workflow.item.uuid,
        duration: itemUtils.convertDuration(workflow.item),
        flags: {
            'chris-premades': {
                wrathfulSmite: {
                    used: false,
                    damageType: itemUtils.getConfig(workflow.item, 'damageType')
                }
            }
        }
    };
    effectUtils.addMacro(effectData, 'midi.actor', ['wrathfulSmiteDamage']);
    await effectUtils.createEffect(workflow.actor, effectData, {concentrationItem: workflow.item, strictlyInterdependent: true, identifier: 'wrathfulSmite'});
    let concentrationEffect = effectUtils.getConcentrationEffect(workflow.actor, workflow.item);
    if (concentrationEffect) await genericUtils.update(concentrationEffect, {duration: effectData.duration});
}
export async function damage({trigger: {entity: effect}, workflow}) {
    if (!workflow.hitTargets.size) return;
    if (workflowUtils.getActionType(workflow) !== 'mwak') return;
    if (effect.flags['chris-premades'].wrathfulSmite.used) return;
    await genericUtils.setFlag(effect, 'chris-premades', 'wrathfulSmite.used', true);
    let damageType = effect.flags['chris-premades'].wrathfulSmite.damageType;
    let formula = '1d6';
    await workflowUtils.bonusDamage(workflow, formula, {damageType: damageType});
    let feature = activityUtils.getActivityByIdentifier(await effectUtils.getOriginItem(effect), 'wrathfulSmiteFrighten', {strict: true});
    if (!feature) return;
    let featureWorkflow = await workflowUtils.syntheticActivityRoll(feature, [workflow.hitTargets.values().next().value]);
    if (!featureWorkflow || featureWorkflow.aborted) return;
    let targetEffect = featureWorkflow.failedSaves.values().next().value?.actor?.appliedEffects?.find(currEffect => currEffect.origin === featureWorkflow.item.uuid);
    if (!targetEffect) {
        await genericUtils.remove(effect);
        return;
    }
    let updates = {
        origin: effect.origin
    };
    await genericUtils.update(targetEffect, updates);
    await effectUtils.addDependent(effect, [targetEffect]);
    await effectUtils.addDependent(targetEffect, [effect]);
}
export const wrathfulSmite = {
    name: 'Wrathful Smite',
    version: '1.2.28',
    midi: {
        item: [
            {
                pass: 'rollFinished',
                macro: use,
                priority: 50,
                activities: ['wrathfulSmite']
            }
        ]
    },
    config: [
        {
            value: 'damageType',
            label: 'CHRISPREMADES.Config.DamageType',
            type: 'select',
            default: 'psychic',
            options: constants.damageTypeOptions,
            homebrew: true,
            category: 'homebrew'
        }
    ]
};
export const wrathfulSmiteDamage = {
    name: 'Wrathful Smite: Damage',
    version: wrathfulSmite.version,
    midi: {
        actor: [
            {
                pass: 'damageRollComplete',
                macro: damage,
                priority: 250
            }
        ]
    }
};
