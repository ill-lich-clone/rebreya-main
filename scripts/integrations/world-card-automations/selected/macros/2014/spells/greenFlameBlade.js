import { actorUtils } from "../../../lib/utilities/actorUtils.js";
import { genericUtils } from "../../../lib/utilities/genericUtils.js";
import { itemUtils } from "../../../lib/utilities/itemUtils.js";
import { workflowUtils } from "../../../lib/utilities/workflowUtils.js";
import { tokenUtils } from "../../../lib/utilities/tokenUtils.js";
import { activityUtils } from "../../../lib/utilities/activityUtils.js";
import { constants } from "../../../lib/constants.js";
import { dialogUtils } from "../../../lib/utilities/dialogUtils.js";
export async function use({workflow}) {
    if (workflow.targets.size !== 1) return;
    let weapons = workflow.actor.items.filter(i => i.type === 'weapon' && i.system.equipped && constants.meleeWeaponTypes.includes(i.system.type?.value));
    if (!weapons.length) {
        genericUtils.notify('CHRISPREMADES.Macros.GreenFlameBlade.NoWeapons', 'warn');
        return;
    }
    let selectedWeapon;
    if (weapons.length === 1) {
        selectedWeapon = weapons[0];
    } else {
        selectedWeapon = await dialogUtils.selectDocumentDialog(workflow.item.name, 'CHRISPREMADES.Macros.GreenFlameBlade.SelectWeapon', weapons);
    }
    if (!selectedWeapon) return;
    let level = actorUtils.getLevelOrCR(workflow.actor);
    let diceNumber = Math.floor((level + 1) / 6);
    let weaponData = genericUtils.duplicate(selectedWeapon.toObject());
    let damageType = itemUtils.getConfig(workflow.item, 'damageType');
    if (diceNumber) {
        for (let activity of selectedWeapon.system.activities.getByType('attack')) {
            let attackId = activity.id;
            if (!attackId) return;
            weaponData.system.activities[attackId].damage.parts.push({
                number: diceNumber,
                denomination: 8,
                types: [damageType]
            });
        }
    }
    genericUtils.setProperty(weaponData, 'flags.chris-premades.bladeCantrip', workflow.item.name);
    let attackWorkflow = await workflowUtils.syntheticItemDataRoll(weaponData, workflow.actor, [workflow.targets.values().next().value]);
    if (!attackWorkflow) return;
    if (!attackWorkflow.hitTargets.size) return;
    let nearbyTargets = tokenUtils.findNearby(workflow.targets.values().next().value, 5, 'ally');
    if (!nearbyTargets.length) return;
    let target = nearbyTargets[0];
    if (nearbyTargets.length > 1) {
        let targetSelect = await dialogUtils.selectTargetDialog(workflow.item.name, 'CHRISPREMADES.Macros.GreenFlameBlade.Leap', nearbyTargets);
        if (targetSelect) target = targetSelect[0];
    }
    if (!target) return;
    let feature = activityUtils.getActivityByIdentifier(workflow.item, 'greenFlameBladeLeap', {strict: true});
    if (!feature) return;
    await workflowUtils.syntheticActivityRoll(feature, [target]);
}
export const greenFlameBlade = {
    name: 'Green-Flame Blade',
    version: '1.2.28',
    midi: {
        item: [
            {
                pass: 'rollFinished',
                macro: use,
                priority: 50,
                activities: ['greenFlameBlade']
            }
        ]
    },
    config: [
        {
            value: 'damageType',
            label: 'CHRISPREMADES.Config.DamageType',
            type: 'select',
            default: 'fire',
            options: constants.damageTypeOptions,
            homebrew: true,
            category: 'homebrew'
        }
    ]
};
