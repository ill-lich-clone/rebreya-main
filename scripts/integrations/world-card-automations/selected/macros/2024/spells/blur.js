import { itemUtils } from "../../../lib/utilities/itemUtils.js";
import { effectUtils } from "../../../lib/utilities/effectUtils.js";
import { workflowUtils } from "../../../lib/utilities/workflowUtils.js";
import { tokenUtils } from "../../../lib/utilities/tokenUtils.js";
export async function attacked({trigger, workflow}) {
    if (!workflow.targets.size || !workflowUtils.isAttackType(workflow, 'attack') || !workflow.token) return;
    if (tokenUtils.canSense(workflow.token, workflow.targets.values().next().value, ['blindsight', 'seeAll'])) return;
    workflow.tracker.disadvantage.add(trigger.entity.name, trigger.entity.name);
}
export async function use({trigger, workflow}) {
    let effectData = {
        name: workflow.item.name,
        img: workflow.item.img,
        origin: workflow.item.uuid,
        duration: itemUtils.convertDuration(workflow.item)
    };
    await effectUtils.createEffect(workflow.actor, effectData, {
        identifier: 'blurEffect',
        concentrationItem: workflow.item,
        interdependent: true,
        rules: 'modern',
        macros: [{type: 'midi.actor', macros: ['blurEffect']}]
    });
}
export const blur = {
    name: 'Blur',
    version: '1.1.17',
    rules: 'modern',
    midi: {
        item: [
            {
                pass: 'rollFinished',
                macro: use,
                priority: 50
            }
        ]
    }
};
export const blurEffect = {
    name: blur.name,
    version: blur.version,
    rules: blur.rules,
    midi: {
        actor: [
            {
                pass: 'targetPreAttackRollConfig',
                macro: attacked,
                priority: 50
            }
        ]
    }
};
