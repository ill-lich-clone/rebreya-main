import { upcastTargets } from "../../generic/upcastTargets.js";
import { genericUtils } from "../../../lib/utilities/genericUtils.js";
import { itemUtils } from "../../../lib/utilities/itemUtils.js";
import { effectUtils } from "../../../lib/utilities/effectUtils.js";
export async function use({trigger, workflow}) {
    let sourceEffect = workflow.activity.effects[0]?.effect;
    if (!sourceEffect) return;
    let effectData = genericUtils.duplicate(sourceEffect.toObject());
    effectData.origin = sourceEffect.uuid;
    effectData.duration = itemUtils.convertDuration(workflow.activity);
    let heliodsDevotee = itemUtils.getItemByIdentifier(workflow.actor, 'heliodsDevotee');
    if (heliodsDevotee) {
        let uuid = workflow.item.flags.dnd5e?.cachedFor;
        if (uuid) {
            let activity = await fromUuid(uuid, {relative: workflow.actor});
            if (activity) {
                let identifier = genericUtils.getIdentifier(activity.item);
                if (identifier === 'heliodsDevotee') {
                    let heliodsDevoteeEffect = heliodsDevotee.effects?.contents?.[0];
                    if (heliodsDevoteeEffect) {
                        let heliodsDevoteeEffectData = genericUtils.duplicate(heliodsDevoteeEffect.toObject());
                        (effectData.system?.changes ?? effectData.changes).push(...(heliodsDevoteeEffectData.system?.changes ?? heliodsDevoteeEffectData.changes));
                    }
                }
            }
        }
    }
    await Promise.all(workflow.targets.map(async token => {
        await effectUtils.createEffect(token.actor, effectData, {concentrationItem: workflow.item});
    }));
}
export const bless = {
    name: 'Bless',
    version: '1.3.153',
    midi: {
        item: [
            {
                pass: 'preambleComplete',
                macro: upcastTargets.plusThree,
                priority: 50
            },
            {
                pass: 'rollFinished',
                macro: use,
                priority: 50
            }
        ]
    }
};
