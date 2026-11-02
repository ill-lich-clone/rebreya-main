import { effectUtils } from "../../../lib/utilities/effectUtils.js";
import { workflowUtils } from "../../../lib/utilities/workflowUtils.js";
import { genericUtils } from "../../../lib/utilities/genericUtils.js";
export async function use({workflow}) {
    let concentrationEffect = effectUtils.getConcentrationEffect(workflow.actor, workflow.item);
    if (!workflow.failedSaves.size) {
        if (concentrationEffect) await genericUtils.remove(concentrationEffect);
        return;
    }
    await workflowUtils.handleInstantTemplate(workflow);
}
export const tashasCausticBrew = {
    name: 'Tasha\'s Caustic Brew',
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
