import { genericUtils } from "./utilities/genericUtils.js";
export function missingPack() {
    genericUtils.notify('CHRISPREMADES.Error.CompendiumNotFound', 'warn');
}
export function missingPackItem(key, name) {
    if (!key || !name) return;
    genericUtils.notify(genericUtils.translate('CHRISPREMADES.Error.CompendiumItemNotFound') + ' ' + key + ': ' + name, 'warn');
}
export function missingActivity(identifier) {
    genericUtils.notify(genericUtils.format('CHRISPREMADES.Error.ActivityNotFound', {identifier}), 'warn');
}
export const errors = {
    missingPack,
    missingPackItem,
    missingActivity
};
