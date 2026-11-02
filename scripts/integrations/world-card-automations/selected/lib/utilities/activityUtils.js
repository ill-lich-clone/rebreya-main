import { errors } from "../errors.js";
import { cardActivityRole } from "../../../activity-role.js";
import { genericUtils } from "./genericUtils.js";
export function getActivityByIdentifier(item, identifier, {strict = false} = {}) {
    let activity = item.system.activities.find(i => getIdentifier(i) === identifier);
    if (!activity && strict) {
        errors.missingActivity(identifier);
    }
    return activity;
}
export function getIdentifier(activity) {
    return cardActivityRole(activity);
}
export function withChangedDamage(activity, formulaOrObj, types=[], {specificIndex = 0} = {}) {
    let activityData = genericUtils.duplicate(activity.toObject());
    let isHeal = activityData.type === 'heal';
    let isFormula = foundry.utils.getType(formulaOrObj) !== 'Object';
    let magicalBonus = activity.item?.system.properties.has('mgc') ? activity.item?.system.magicalBonus || '' : '';
    let formula, number, denomination, bonus;
    if (isFormula) {
        formula = formulaOrObj;
    } else {
        number = formulaOrObj.number;
        denomination = formulaOrObj.denomination;
        bonus = formulaOrObj.bonus ?? '';
        formula = '';
        if (number && denomination) formula += number + 'd' + denomination;
        if (bonus) formula += ' + ' + bonus;
    }
    if (isHeal) {
        let isCustom = activityData.healing.custom.enabled;
        if (isCustom || isFormula) {
            if (formula?.toString()?.length) activityData.healing.custom = {
                enabled: true,
                formula: formula.toString()
            };
        } else {
            activityData.healing.number = number;
            activityData.healing.denomination = denomination;
            activityData.healing.bonus = bonus;
        }
        if (types.length) activityData.healing.types = new Set(types);
    } else {
        // Dealing with activities on weapons whose damage includes the base damage is a bit of a headache; we'll probably discover more cases
        // as time goes on that we'll want to account for, but this should be an okay start.
        if (activityData.damage.includeBase && !activityData.damage.parts[specificIndex]) {
            activityData.damage.includeBase = false;
            activityData.damage.parts[specificIndex] = {
                number: number,
                denomination: denomination,
                bonus: bonus + ' + @mod ' + (magicalBonus ? '+ ' + magicalBonus : '')
            };
        }
        else if (activityData.damage.parts[specificIndex]) {
            let isCustom = activityData.damage.parts[specificIndex].custom.enabled;
            if (isCustom || isFormula) {
                if (formula?.toString()?.length) activityData.damage.parts[specificIndex].custom = {
                    enabled: true,
                    formula: formula.toString()
                };
            } else {
                activityData.damage.parts[specificIndex].number = number;
                activityData.damage.parts[specificIndex].denomination = denomination;
                activityData.damage.parts[specificIndex].bonus = bonus;
            }
        }
        if (types.length) activityData.damage.parts[specificIndex].types = new Set(types);
    }
    return activityData;
}
export const activityUtils = {
    getActivityByIdentifier,
    withChangedDamage
};
