import { genericUtils } from "./genericUtils.js";
export const minSequencerVersion = '3.6.0';
export const shownSequencerWarning = false;
export function sequencerCheck() {
    let sequencer = game.modules.get('sequencer');
    if (!sequencer?.active) return false;
    if (genericUtils.isNewerVersion(minSequencerVersion, sequencer.version)) {
        if (!shownSequencerWarning) {
            shownSequencerWarning = true;
            let sequencerAlert = genericUtils.format('CHRISPREMADES.Error.OutdatedSequencer', {minSequencerVersion});
            genericUtils.notify(sequencerAlert, 'warn');
        }
        return false;
    }
    return true;
}
export function jb2aCheck() {
    let patreon = game.modules.get('jb2a_patreon')?.active;
    let free = game.modules.get('JB2A_DnD5e')?.active;
    if (patreon && free) {
        genericUtils.notify('CHRISPREMADES.Troubleshooter.BothJB2A', 'warn', {localize: true});
        return 'patreon';
    }
    if (patreon) return 'patreon';
    if (free) return 'free';
    // genericUtils.notify('CHRISPREMADES.Troubleshooter.MissingJB2A', 'warn', {localize: true});
    return false;
}
export function aseCheck() {
    let isActive = game.modules.get('animated-spell-effects-cartoon')?.active;
    return isActive;
}
export function simpleAttack(sourceToken, targetToken, animation, {sound, missed} = {missed: false}) {
    /* eslint-disable indent */
    new Sequence()
        .effect()
            .atLocation(sourceToken)
            .stretchTo(targetToken)
            .file(animation)
            .missed(missed)
        .sound()
            .playIf(sound)
            .file(sound)
        .play();
    /* eslint-enable indent */
}
export async function preloadAnimations(animations, showProgressBar = false) {
    return await Sequencer.Preloader.preloadForClients(animations, showProgressBar);
}
export const animationUtils = {
    sequencerCheck,
    jb2aCheck,
    aseCheck,
    simpleAttack,
    preloadAnimations
};
