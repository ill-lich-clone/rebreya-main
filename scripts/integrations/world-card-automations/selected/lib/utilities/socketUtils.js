import { genericUtils } from "./genericUtils.js";
export function gmID() {
    let gmID = game.users.activeGM?.id;
    let preferredGMId = game.settings.get('midi-qol', 'PreferredGM');
    if (preferredGMId !== '') {
        let preferredGM = game.users.get(preferredGMId);
        if (preferredGM?.active && preferredGM.isGM) gmID = preferredGM.id;
    }
    return gmID;
}
export function hasPermission(entity, userId) {
    let user = game.users.get(userId);
    if (!user) return false;
    return entity.testUserPermission(user, 'OWNER');
}
export function firstOwner(document, useId) {
    if (!document) return;
    document = document.documentName === 'Token' ? document.actor : document.document?.documentName === 'Token' ? document.document.actor : document;
    let permissions = genericUtils.getProperty(document ?? {}, 'ownership') ?? {};
    let playerOwners = Object.entries(permissions).filter(([id, level]) => !game.users.get(id)?.isGM && game.users.get(id)?.active && level === 3).map(([id]) => id);
    if (playerOwners.length > 0) {
        let playerId = document.documentName === 'Actor' ?
            playerOwners.find(id => game.users.get(id)?.character?.uuid === document.uuid) ?? playerOwners[0] :
            playerOwners[0];
        return useId ? playerId : game.users.get(playerId);
    }
    return useId ? gmID() : game.users.get(gmID());
}
export const socketUtils = {
    gmID,
    hasPermission,
    firstOwner
};
