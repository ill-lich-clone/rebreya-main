import { workflowUtils } from "../../../lib/utilities/workflowUtils.js";
import { dialogUtils } from "../../../lib/utilities/dialogUtils.js";
import { genericUtils } from "../../../lib/utilities/genericUtils.js";
import { activityUtils } from "../../../lib/utilities/activityUtils.js";
import { itemUtils } from "../../../lib/utilities/itemUtils.js";
import { animationUtils } from "../../../lib/utilities/animationUtils.js";
import { errors } from "../../../lib/errors.js";
import { hasShieldEffect } from "../../../../../../data/shield-spell-item.js?v=1.5.59";
export async function use({workflow}) {
    if (!workflow.targets.size) return;
    let maxMissiles = 2 + workflowUtils.getCastLevel(workflow);
    let selection = await dialogUtils.selectTargetDialog(workflow.item.name, genericUtils.format('CHRISPREMADES.Macros.MagicMissile.Select', {maxMissiles}), workflow.targets, {
        type: 'selectAmount',
        maxAmount: maxMissiles
    });
    if (!selection) return;
    selection = selection[0];
    if (!selection || !selection.length) return;
    if (selection.some(({document, value}) => !workflow.targets.has(document) || !Number.isInteger(Number(value)) || Number(value) < 0)
        || selection.reduce((total, entry) => total + Number(entry.value), 0) > maxMissiles) return;
    let feature = activityUtils.getActivityByIdentifier(workflow.item, 'magicMissileBolt');
    let featureFlat = activityUtils.getActivityByIdentifier(workflow.item, 'magicMissileFlat');
    let rollEach = itemUtils.getConfig(workflow.item, 'rollEach');
    if (!feature) {
        errors.missingActivity('magicMissileBolt');
        return;
    } else if (!featureFlat && !rollEach) {
        errors.missingActivity('magicMissileFlat');
        return;
    }
    let damageFormula = feature.damage.parts[0].formula;
    let damageType = Array.from(feature.damage.parts[0].types)[0];
    let activityData;
    if (!rollEach) {
        let damageRoll = await new CONFIG.Dice.DamageRoll(damageFormula, workflow.activity.getRollData(), {type: damageType}).evaluate();
        await MidiQOL.displayDSNForRoll(damageRoll);
        activityData = activityUtils.withChangedDamage(featureFlat, damageRoll.total.toString(), [damageType]);
    }
    let playAnimation = itemUtils.getConfig(workflow.item, 'playAnimation') && animationUtils.jb2aCheck();
    let colors = [ 'grey', 'dark_red', 'orange', 'yellow', 'green', 'blue', 'purple'];
    let lastColor = Math.floor((Math.random() * colors.length));
    let colorSelection = itemUtils.getConfig(workflow.item, 'color');
    let sound = itemUtils.getConfig(workflow.item, 'sound');
    if (playAnimation && (colorSelection === 'random' || colorSelection === 'cycle')) await animationUtils.preloadAnimations('jb2a.magic_missile');
    for (let {document: targetToken, value: numBolts} of selection) {
        if (isNaN(numBolts) || numBolts == 0) continue;
        for (let i = 0; i < numBolts; i++) {
            if (playAnimation) {
                let path = 'jb2a.magic_missile.';
                if (colorSelection === 'random') {
                    path += colors[Math.floor(Math.random() * colors.length)];
                } else if (colorSelection === 'cycle') {
                    path += colors[lastColor];
                    lastColor++;
                    if (lastColor >= colors.length) lastColor = 0;
                } else {
                    path += colorSelection;
                }
                new Sequence()
                    .effect()
                    .file(path)
                    .atLocation(workflow.token)
                    .stretchTo(targetToken)
                    .randomizeMirrorY()
                    .missed(hasShieldEffect(targetToken.actor))

                    .sound()
                    .playIf(sound)
                    .file(sound)

                    .play();
            }
            // Each target may react to the cast once. The native damage hook protects every bolt.
            const options = {workflowOptions: {targetConfirmation: 'none', rebreyaMissileShieldPrompt: i === 0}};
            if (rollEach) await workflowUtils.syntheticActivityRoll(feature, [targetToken], {options});
            else await workflowUtils.syntheticActivityDataRoll(activityData, workflow.item, workflow.actor, [targetToken], {options});
        }
    }
}
export const magicMissile = {
    name: 'Magic Missile',
    version: '1.2.28',
    midi: {
        item: [
            {
                pass: 'rollFinished',
                macro: use,
                priority: 50,
                activities: ['magicMissile']
            }
        ]
    },
    config: [
        {
            value: 'rollEach',
            label: 'CHRISPREMADES.Macros.MagicMissile.RollEach',
            type: 'checkbox',
            default: false,
            category: 'homebrew',
            homebrew: true
        },
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
                    value: 'blue',
                    label: 'CHRISPREMADES.Config.Colors.Blue',
                    requiredModules: ['jb2a_patreon']
                },
                {
                    value: 'green',
                    label: 'CHRISPREMADES.Config.Colors.Green',
                    requiredModules: ['jb2a_patreon']
                },
                {
                    value: 'purple',
                    label: 'CHRISPREMADES.Config.Colors.Purple'
                },
                {
                    value: 'yellow',
                    label: 'CHRISPREMADES.Config.Colors.Yellow',
                    requiredModules: ['jb2a_patreon']
                },
                {
                    value: 'dark_red',
                    label: 'CHRISPREMADES.Config.Colors.DarkRed',
                    requiredModules: ['jb2a_patreon']
                },
                {
                    value: 'orange',
                    label: 'CHRISPREMADES.Config.Colors.Orange',
                    requiredModules: ['jb2a_patreon']
                },
                {
                    value: 'grey',
                    label: 'CHRISPREMADES.Config.Colors.Grey',
                    requiredModules: ['jb2a_patreon']
                },
                {
                    value: 'random',
                    label: 'CHRISPREMADES.Config.Colors.Random',
                    requiredModules: ['jb2a_patreon']
                },
                {
                    value: 'cycle',
                    label: 'CHRISPREMADES.Config.Colors.Cycle',
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
