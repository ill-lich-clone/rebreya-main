import { itemUtils } from "../../../lib/utilities/itemUtils.js";
import { actorUtils } from "../../../lib/utilities/actorUtils.js";
import { effectUtils } from "../../../lib/utilities/effectUtils.js";
import { tokenUtils } from "../../../lib/utilities/tokenUtils.js";
import { genericUtils } from "../../../lib/utilities/genericUtils.js";
import { socketUtils } from "../../../lib/utilities/socketUtils.js";
import { dialogUtils } from "../../../lib/utilities/dialogUtils.js";
import { rollUtils } from "../../../lib/utilities/rollUtils.js";
export async function use({trigger, workflow}) {
    if (workflow.targets.size != 1) return;
    let skipCheck = false;
    let targetToken = workflow.targets.values().next().value;
    if (workflow.actor.uuid === targetToken.actor.uuid) return;
    let heavy = !!itemUtils.getItemByIdentifier(workflow.actor, 'heavyweight');
    if ((actorUtils.getSize(targetToken.actor)) > (actorUtils.getSize(workflow.actor) + 1 + heavy)) {
        genericUtils.notify('CHRISPREMADES.Macros.Shove.Big', 'info');
        return;
    }
    if (effectUtils.getEffectByIdentifier(targetToken.actor, 'incapacitated')) skipCheck = true;
    if (!skipCheck) {
        let inputs = [[CONFIG.DND5E.skills.ath.label, 'ath'], [CONFIG.DND5E.skills.acr.label, 'acr'], ['CHRISPREMADES.Generic.Uncontested', 'skip']];
        let targetUser = socketUtils.firstOwner(targetToken);
        let selection = await dialogUtils.buttonDialog(workflow.item.name, 'CHRISPREMADES.Macros.Shove.ChooseSkill', inputs, {displayAsRows: true, userId: targetUser.id});
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
    }
    let selection = 'move';
    if (!effectUtils.getEffectByStatusID(targetToken.actor, 'prone')) {
        let inputs = [['CHRISPREMADES.Macros.Shove.Shove', 'move'], ['CHRISPREMADES.Macros.Shove.KnockProne', 'prone']];
        selection = await dialogUtils.buttonDialog(workflow.item.name, 'CHRISPREMADES.Macros.Shove.MoveOrProne', inputs, {displayAsRows: true});
        if (!selection) return;
    }
    if (!targetToken.document.isOwner) {
        const {requestCardAuthority} = await import("../../../lib/sockets.js");
        await requestCardAuthority("pushCardToken", {message:workflow.itemCardUuid, source:workflow.token.document.uuid, target:targetToken.document.uuid, result:selection});
        return;
    }
    if (selection === 'prone') {
        if (actorUtils.checkTrait(targetToken.actor, 'ci', 'prone')) return;
        await effectUtils.applyConditions(targetToken.actor, ['prone']);
        return;
    }
    await tokenUtils.pushToken(workflow.token, targetToken, 5);
}
export const shove = {
    name: 'Shove',
    version: '1.1.0',
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
