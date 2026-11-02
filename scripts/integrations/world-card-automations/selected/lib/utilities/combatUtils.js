export function inCombat() {
    return !!game.combat;
}
export async function setTurnCheck(entity, name, reset) {
    let turn = '';
    if (combatUtils.inCombat() && !reset) turn = game.combat.round + '-' + game.combat.turn;
    await entity.setFlag('chris-premades', name + '.turn', turn);
}
export function getCurrentCombatantToken() {
    let currCombatant = game.combat?.combatants.get(game.combat?.current?.combatantId);
    return game.scenes.get(currCombatant?.sceneId)?.tokens.get(currCombatant?.tokenId)?.object;
}
export const combatUtils = {
    inCombat,
    setTurnCheck,
    getCurrentCombatantToken
};
