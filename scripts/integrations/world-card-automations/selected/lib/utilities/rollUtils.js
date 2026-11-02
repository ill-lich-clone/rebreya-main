import { genericUtils } from "./genericUtils.js";
import { epicRolls } from "../../integrations/epicRolls.js";
import { socketUtils } from "./socketUtils.js";
export async function getCriticalFormula(formula, rollData) {
    return new CONFIG.Dice.DamageRoll(formula, rollData, {isCritical: true}).formula;
}
export async function contestedRoll({sourceToken, targetToken, sourceRollType, targetRollType, sourceAbilities, targetAbilities, sourceRollOptions={}, targetRollOptions={}}) {
    // TODO: add some checks in here to error gracefully
    let bestSourceAbility = sourceAbilities[0];
    let bestTargetAbility = targetAbilities[0];
    let bestSourceScore = 0;
    let bestTargetScore = 0;
    for (let abil of sourceAbilities) {
        let currTotal;
        if (sourceRollType === 'skill') {
            currTotal = sourceToken.actor.system.skills[abil].total;
        } else if (sourceRollType === 'check') {
            currTotal = sourceToken.actor.system.abilities[abil].mod;
        } else if (sourceRollType === 'save') {
            currTotal = sourceToken.actor.system.abilities[abil].save;
        }
        if (currTotal > bestSourceScore) {
            bestSourceScore = currTotal;
            bestSourceAbility = abil;
        }
    }
    for (let abil of targetAbilities) {
        let currTotal;
        if (targetRollType === 'skill') {
            currTotal = targetToken.actor.system.skills[abil].total;
        } else if (targetRollType === 'check') {
            currTotal = targetToken.actor.system.abilities[abil].mod;
        } else if (targetRollType === 'save') {
            currTotal = targetToken.actor.system.abilities[abil].save;
        }
        if (currTotal > bestTargetScore) {
            bestTargetScore = currTotal;
            bestTargetAbility = abil;
        }
    }

    if (genericUtils.getCPRSetting('epicRolls') && game.modules.get('epic-rolls-5e')?.active) {
        let results = await epicRolls.contestedCheck(sourceToken.actor, targetToken.actor, sourceRollType + '.' + bestSourceAbility, targetRollType + '.' + bestTargetAbility);
        if (results.canceled) return 0;
        let sourceRoll = results.results[0].value;
        let targetRoll = results.results[1].value;
        return sourceRoll - targetRoll;
    } else {
        let contestedData = {
            source: {
                token: sourceToken,
                rollType: sourceRollType,
                ability: bestSourceAbility,
                rollOptions: sourceRollOptions
            },
            target: {
                token: targetToken,
                rollType: targetRollType,
                ability: bestTargetAbility,
                rollOptions: targetRollOptions
            }
        };
        return (await MidiQOL.contestedRoll(contestedData)).result;
    }
}
export async function requestRoll(token, request, ability, options = {}) {
    let userID = socketUtils.firstOwner(token, true);
    let data = {
        saveDetails: {
            actorUuid: token.document.uuid,
            rollType: request,
            rollAbilities: [ability],
            rollDC: options.target,
            advantage: options.advantage,
            disadvantage: options.disadvantage,
            displayOptions: options
        }
    };
    switch(request) {
        case 'abil':
        case 'check':
        case 'save':
        case 'test':
            genericUtils.setProperty(data.saveDetails, 'rollAbilities', [ability]);
            break;
        case 'skill':
            genericUtils.setProperty(data.saveDetails, 'rollSkills', [ability]);
            break;
        case 'tool':
            genericUtils.setProperty(data.saveDetails, 'rollTools', [ability]);
            break;
        case 'deathSave':
            break;
    }
    return await MidiQOL.socket().executeAsUser('rollAbility', userID, data);
}
export const rollUtils = {
    getCriticalFormula,
    contestedRoll,
    requestRoll
};
