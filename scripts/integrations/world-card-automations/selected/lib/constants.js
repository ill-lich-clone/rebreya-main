export const attacks = [
    'msak',
    'rsak',
    'mwak',
    'rwak'
];
export const meleeAttacks = [
    'mwak',
    'msak'
];
export const rangedAttacks = [
    'rwak',
    'rsak'
];
export const weaponAttacks = [
    'mwak',
    'rwak'
];
export const spellAttacks = [
    'msak',
    'rsak'
];
export const rangedWeaponAttacks = [
    'rwak'
];
export const meleeWeaponAttacks = [
    'mwak'
];
export const unarmedAttacks = [
    'unarmedStrike',
    'monkUnarmedStrike',
    'tavernBrawlerUnarmedStrike',
    'fightingStyleUnarmedFightingUnarmedStrike',
    'predatoryStrike',
    'unarmedFightingUnarmedStrike',
    'formOfTheBeast',
    'pugilistUnarmedStrike'
];
export const meleeWeaponTypes = [
    'martialM',
    'simpleM'
];
export const damageTypeOptions = () => Object.entries(CONFIG.DND5E.damageTypes).map(i => ({label: i[1].label, value: i[0]}));
export const tempConditionIcon = 'icons/magic/time/arrows-circling-green.webp';
export const featurePacks = { miscellaneousItems: "local-grapple", featFeatures: "local-grapple" };
export const summonAnimationOptions = [
    {
        value: 'default',
        label: 'CHRISPREMADES.Config.Animations.Default',
        requiredModules: ['jb2a_patreon', 'animated-spell-effects-cartoon']
    },
    {
        value: 'celestial',
        label: 'CHRISPREMADES.Config.Animations.Celestial',
        requiredModules: ['jb2a_patreon', 'animated-spell-effects-cartoon']
    },
    {
        value: 'fiend',
        label: 'CHRISPREMADES.Config.Animations.Fiend',
        requiredModules: ['jb2a_patreon', 'animated-spell-effects-cartoon']
    },
    {
        value: 'fire',
        label: 'CHRISPREMADES.Config.Animations.Fire',
        requiredModules: ['jb2a_patreon']
    },
    {
        value: 'water',
        label: 'CHRISPREMADES.Config.Animations.Water',
        requiredModules: ['jb2a_patreon']
    },
    {
        value: 'air',
        label: 'CHRISPREMADES.Config.Animations.Air',
        requiredModules: ['jb2a_patreon', 'animated-spell-effects-cartoon']
    },
    {
        value: 'earth',
        label: 'CHRISPREMADES.Config.Animations.Earth',
        requiredModules: ['jb2a_patreon', 'animated-spell-effects-cartoon']
    },
    {
        value: 'nature',
        label: 'CHRISPREMADES.Config.Animations.Nature',
        requiredModules: ['jb2a_patreon']
    },
    {
        value: 'shadow',
        label: 'CHRISPREMADES.Config.Animations.Shadow',
        requiredModules: ['jb2a_patreon']
    },
    {
        value: 'smoke',
        label: 'CHRISPREMADES.Config.Animations.Smoke',
        requiredModules: []
    },
    {
        value: 'future',
        label: 'CHRISPREMADES.Config.Animations.Future',
        requiredModules: ['jb2a_patreon']
    },
    {
        value: 'none',
        label: 'CHRISPREMADES.Config.Animations.None',
        requiredModules: []
    }
];

export const constants = { attacks, meleeAttacks, rangedAttacks, weaponAttacks, spellAttacks, rangedWeaponAttacks, meleeWeaponAttacks, unarmedAttacks, meleeWeaponTypes, damageTypeOptions, tempConditionIcon, featurePacks, summonAnimationOptions };
