import { genericUtils } from "../../../lib/utilities/genericUtils.js";
export async function removeTemplateFunc({trigger: {entity: effect}}) {
    if (effect) await genericUtils.remove(effect);
}
export const removeTemplate = {
    name: 'Remove Template',
    version: '0.12.0',
    combat: [
        {
            pass: 'everyTurn',
            macro: removeTemplateFunc,
            priority: 250
        }
    ]
};
