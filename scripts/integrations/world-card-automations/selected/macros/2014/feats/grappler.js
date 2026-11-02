import { workflowUtils } from "../../../lib/utilities/workflowUtils.js";
import { effectUtils } from "../../../lib/utilities/effectUtils.js";
import { socketUtils } from "../../../lib/utilities/socketUtils.js";
import { dialogUtils } from "../../../lib/utilities/dialogUtils.js";
import { genericUtils } from "../../../lib/utilities/genericUtils.js";
import { rollUtils } from "../../../lib/utilities/rollUtils.js";
export async function early({trigger: {entity: item}, workflow}) {
    if (!workflowUtils.isAttackType(workflow, 'attack')) return;
    if (!workflow.targets.size) return;
    let grapplingEffects = effectUtils.getAllEffectsByIdentifier(workflow.actor, 'grappling');
    if (!grapplingEffects.length) return;
    if (!grapplingEffects.some(i => i.flags['chris-premades'].grapple.tokenId === workflow.targets.values().next().value?.id)) return;
    workflow.tracker.advantage.add(item.name, item.name);
}
export async function use({workflow}) {
    if (!workflow.token || workflow.targets.size !== 1) return;
    let targetToken = workflow.targets.values().next().value;
    let grapplingEffects = effectUtils.getAllEffectsByIdentifier(workflow.actor, 'grappling');
    if (!grapplingEffects.length) return;
    let grapplingEffect = grapplingEffects.find(i => i.flags['chris-premades'].grapple.tokenId === targetToken.id);
    if (!grapplingEffect) return;
    let inputs = [[CONFIG.DND5E.skills.ath.label, 'ath'], [CONFIG.DND5E.skills.acr.label, 'acr'], ['CHRISPREMADES.Generic.Uncontested', 'skip']];
    let targetUser = socketUtils.firstOwner(targetToken);
    let selection = await dialogUtils.buttonDialog(workflow.item.name, 'CHRISPREMADES.Macros.Grapple.ChooseSkill', inputs, {displayAsRows: true, userId: targetUser.id});
    if (!selection) return;
    if (selection != 'skip') {
        let result = await rollUtils.contestedRoll({
            sourceToken: workflow.token,
            targetToken,
            sourceRollType: 'skill',
            targetRollType: 'skill',
            sourceAbilities: ['ath'],
            targetAbilities: [selection]
        });
        if (result <= 0) return;
    }
    let effectData = {
        name: genericUtils.format('CHRISPREMADES.Macros.Grappler.Pinning', {tokenName: targetToken.name}),
        img: workflow.item.img,
        origin: workflow.item.uuid,
        flags: {
            dae: {
                showIcon: true
            },
            'chris-premades': {
                conditions: ['restrained']
            }
        }
    };
    let sourceEffect = await effectUtils.createEffect(workflow.actor, effectData, {parentEntity: grapplingEffect, strictlyInterdependent: true});
    effectData.name = genericUtils.format('CHRISPREMADES.Macros.Grappler.Pinned', {tokenName: workflow.token.name});
    await effectUtils.createEffect(targetToken.actor, effectData, {parentEntity: sourceEffect, strictlyInterdependent: true});
}
export const grappler = {
    name: 'Grappler',
    version: '1.1.0',
    midi: {
        actor: [
            {
                pass: 'preAttackRollConfig',
                macro: early,
                priority: 50
            }
        ]
    },
    ddbi: {
        removedItems: {
            Grappler: [
                'Grappling Pin'
            ]
        }
    }
};
export const grapplerPin = {
    name: 'Grappler: Pin',
    version: grappler.version,
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
