import { itemUtils } from "../../../lib/utilities/itemUtils.js";
import { animationUtils } from "../../../lib/utilities/animationUtils.js";
import { actorUtils } from "../../../lib/utilities/actorUtils.js";
import { activityUtils } from "../../../lib/utilities/activityUtils.js";
import { dialogUtils } from "../../../lib/utilities/dialogUtils.js";
import { workflowUtils } from "../../../lib/utilities/workflowUtils.js";
import { genericUtils } from "../../../lib/utilities/genericUtils.js";
export async function use({trigger, workflow}) {
    if (!workflow.targets.size) return;
    let level = actorUtils.getLevelOrCR(workflow.actor);
    let bolts = 1 + Math.floor((level + 1) * (1/6)); //Todo: Make this work with twinned spell somehow.
    let feature = activityUtils.getActivityByIdentifier(workflow.item, 'eldritchBlastBeam', {strict: true});
    if (!feature) return;
    let boltsLeft = bolts;
    while (boltsLeft) {
        let selection, skip;
        if (workflow.targets.size > 1) {
            let choice = await dialogUtils.selectTargetDialog(workflow.item.name, 'CHRISPREMADES.Macros.EldritchBlast.Target', Array.from(workflow.targets), {type: 'selectAmount', skipDeadAndUnconscious: true, coverToken: workflow.token, maxAmount: boltsLeft});
            if (!choice) return;
            [selection, skip] = choice;
            if (!selection) return;
        } else {
            selection = [{document: workflow.targets.values().next().value, value: 1}];
        }
        for (let i of selection) {
            for (let j = 0; j < i.value; j++) {
                let hp = i.document.actor?.system?.attributes?.hp?.value;
                if (!hp && skip) continue;
                await workflowUtils.syntheticActivityRoll(feature, [i.document], {options: {targetConfirmation: 'none', 'chris-premades': {multiWorkflowAttack: bolts - boltsLeft}}});
                boltsLeft -= 1;
            }
        }
    }
}
export async function beam({trigger, workflow}) {
    let playAnimation = itemUtils.getConfig(workflow.item, 'playAnimation');
    if (!playAnimation) return;
    let color = itemUtils.getConfig(workflow.item, 'color');
    let sound = itemUtils.getConfig(workflow.item, 'sound');
    if (color === 'random') {
        let colors = eldritchBlast.config.find(i => i.value === 'color').options.map(j => j.value).filter(k => k !== 'random');
        color = colors[Math.floor(Math.random() * colors.length)];
    }
    if (!color) return;
    let animation = 'jb2a.eldritch_blast.' + color;
    animationUtils.simpleAttack(workflow.token, workflow.targets.values().next().value, animation, {sound: sound, missed: !workflow.hitTargets.has(workflow.targets.values().next().value)});
}
export async function damage({trigger, workflow}) {
    let agonizingBlast = itemUtils.getItemByIdentifier(workflow.actor, 'agonizingBlast');
    if (!agonizingBlast) return;
    if (genericUtils.getRules(agonizingBlast) === 'modern') return;
    await workflowUtils.bonusDamage(workflow, String(workflow.actor.system.abilities.cha.mod), {ignoreCrit: true, damageType: workflow.defaultDamageType});
}
export const eldritchBlast = {
    name: 'Eldritch Blast',
    version: '1.2.28',
    hasAnimation: true,
    midi: {
        item: [
            {
                pass: 'attackRollComplete',
                macro: beam,
                priority: 50,
                activities: ['eldritchBlastBeam']
            },
            {
                pass: 'rollFinished',
                macro: use,
                priority: 50,
                activities: ['eldritchBlast']
            },
            {
                pass: 'damageRollComplete',
                macro: damage,
                priority: 50,
                activities: ['eldritchBlastBeam']
            }
        ]
    },
    config: [
        {
            value: 'playAnimation',
            label: 'CHRISPREMADES.Config.PlayAnimation',
            type: 'checkbox',
            default: true,
            category: 'animation'
        },
        {
            value: 'color',
            label: 'CHRISPREMADES.Config.Color',
            type: 'select',
            default: 'purple',
            category: 'animation',
            options: [
                {
                    value: 'purple',
                    label: 'CHRISPREMADES.Config.Colors.Purple'
                },
                {
                    value: 'dark_green',
                    label: 'CHRISPREMADES.Config.Colors.DarkGreen',
                    requiredModules: ['jb2a_patreon']
                },
                {
                    value: 'dark_pink',
                    label: 'CHRISPREMADES.Config.Colors.DarkPink',
                    requiredModules: ['jb2a_patreon']
                },
                {
                    value: 'dark_purple',
                    label: 'CHRISPREMADES.Config.Colors.DarkPurple',
                    requiredModules: ['jb2a_patreon']
                },
                {
                    value: 'dark_red',
                    label: 'CHRISPREMADES.Config.Colors.DarkRed',
                    requiredModules: ['jb2a_patreon']
                },
                {
                    value: 'green',
                    label: 'CHRISPREMADES.Config.Colors.Green',
                    requiredModules: ['jb2a_patreon']
                },
                {
                    value: 'lightblue',
                    label: 'CHRISPREMADES.Config.Colors.LightBlue',
                    requiredModules: ['jb2a_patreon']
                },
                {
                    value: 'lightgreen',
                    label: 'CHRISPREMADES.Config.Colors.LightGreen',
                    requiredModules: ['jb2a_patreon']
                },
                {
                    value: 'orange',
                    label: 'CHRISPREMADES.Config.Colors.Orange',
                    requiredModules: ['jb2a_patreon']
                },
                {
                    value: 'pink',
                    label: 'CHRISPREMADES.Config.Colors.Pink',
                    requiredModules: ['jb2a_patreon']
                },
                {
                    value: 'yellow',
                    label: 'CHRISPREMADES.Config.Colors.Yellow',
                    requiredModules: ['jb2a_patreon']
                },
                {
                    value: 'rainbow',
                    label: 'CHRISPREMADES.Config.Colors.Rainbow',
                    requiredModules: ['jb2a_patreon']
                },
                {
                    value: 'random',
                    label: 'CHRISPREMADES.Config.Colors.Random',
                    requiredModules: ['jb2a_patreon']
                }
            ]
        },
        {
            value: 'sound',
            label: 'CHRISPREMADES.Config.Sound',
            type: 'file',
            default: '',
            category: 'sound'
        }
    ]
};
