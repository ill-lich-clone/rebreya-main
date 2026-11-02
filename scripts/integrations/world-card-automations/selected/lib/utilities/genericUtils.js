import { labels } from "./card-labels.js";
import { socket } from "../sockets.js";
import { sockets } from "../sockets.js";
import { socketUtils } from "./socketUtils.js";
export function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}
export function translate(key) {
    const value = game.i18n.localize(key);
    return value === key && Object.hasOwn(labels, key) ? labels[key] : value;
}
export function format(key, obj) {
    return translate(key).replace(/{([^}]+)}/g, (token, name) => obj[name] ?? token);
}
export function setProperty(object, key, value) {
    return foundry.utils.setProperty(object, key, value);
}
export function getProperty(object, key) {
    return foundry.utils.getProperty(object, key);
}
export function duplicate(object) {
    return foundry.utils.duplicate(object);
}
export function mergeObject(original, other, options={}) {
    return foundry.utils.mergeObject(original, other, options);
}
export async function update(entity, updates = {}, options = {}, forceGM = false) {
    let hasPermission = false;
    if (!forceGM) hasPermission = socketUtils.hasPermission(entity.documentName === 'Activity' ? entity.item : entity, game.user.id);
    if (hasPermission) return await entity.update(updates, options);
    return await socket.executeAsGM(sockets.updateEntity.name, entity.uuid, updates);
}
export async function setFlag(entity, scope, key, value) {
    let hasPermission = socketUtils.hasPermission(entity, game.user.id);
    if (hasPermission) return await entity.setFlag(scope, key, value);
    return await socket.executeAsGM(sockets.setFlag.name, entity.uuid, scope, key, value);
}
export async function remove(entity) {
    let hasPermission = socketUtils.hasPermission(entity, game.user.id);
    if (hasPermission) return await entity.delete();
    return await socket.executeAsGM(sockets.deleteEntity.name, entity.uuid);
}
export function decimalToFraction(decimal) {
    if (!decimal) return 0;
    if (Number(decimal) >= 1) return Number(decimal);
    return '1/' + 1 / Number(decimal);
}
// Read retained preferences without registering the discontinued module.
const defaults = {"hideNames": false, "epicRolls": false, "enableAnimations": true};
export function getCPRSetting(key) {
    const id = 'chris-premades.' + key;
    if (game.settings.settings?.has(id)) return game.settings.get('chris-premades', key);
    const stored = game.settings.storage?.get('world')?.getSetting?.(id)?.value;
    return typeof stored === 'boolean' ? stored : defaults[key];
}
export function isNewerVersion(v1, v0) {
    return foundry.utils.isNewerVersion(v1, v0);
}
export function notify(message, type = 'info', {localize = true, permanent = false} = {}) {
    ui.notifications[type](localize ? translate(message) : message, {permanent});
}
export async function createEmbeddedDocuments(entity, type, updates, options) {
    let hasPermission = socketUtils.hasPermission(entity, game.user.id);
    let documents;
    if (hasPermission) {
        documents = await entity.createEmbeddedDocuments(type, updates, options);
    } else {
        let documentUuids = await socket.executeAsGM(sockets.createEmbeddedDocuments.name, entity.uuid, type, updates, options);
        documents = await Promise.all(documentUuids.map(async i => await fromUuid(i)));
    }
    return documents;
}
export async function updateTargets(targets, user = game.user) {
    let targetIds = Array.from(targets).map(target => target.id ?? target);
    if (user === game.user) {
        canvas.tokens?.setTargets(targetIds);
    } else {
        await socket.executeAsUser(sockets.updateTargets.name, user.id, targetIds);
    }
}
export function getIdentifier(entity) {
    return entity.flags?.['chris-premades']?.info?.identifier;
}
export function getRules(entity) {
    if (entity.documentName === 'Item') return entity.system.source.rules === '' ? 'legacy' : entity.system.source.rules === '2014' ? 'legacy' : 'modern';
    return entity.flags['chris-premades']?.rules ?? 'legacy';
}
export const genericUtils = {
    sleep,
    translate,
    format,
    setProperty,
    duplicate,
    update,
    remove,
    setFlag,
    mergeObject,
    getCPRSetting,
    decimalToFraction,
    isNewerVersion,
    notify,
    createEmbeddedDocuments,
    getProperty,
    updateTargets,
    getIdentifier,
    getRules
};
