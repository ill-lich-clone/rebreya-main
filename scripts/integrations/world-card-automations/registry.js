import { faerieFireOutlined } from "./selected/macros/2014/spells/faerieFire.js";
import { detectMagicDetecting } from "./selected/macros/2014/spells/detectMagic.js";
import { removeTemplate as removeTemplateLocal } from "./selected/macros/2014/generic/removeTemplate.js";
import { grapplerPin as grapplerPinLocal } from "./selected/macros/2014/feats/grappler.js";
import { cleanFinishCombatTurn as cleanFinishCombatTurnLocal } from "./selected/macros/2024/classFeatures/pugilist/squaredCircle/cleanFinish.js";
import { antagonize } from "../../combat/antagonize.js?v=1.5.59";
import { absorbElements as absorbElements_legacy } from "./selected/macros/2014/spells/absorbElements.js";
import { bless as bless_legacy } from "./selected/macros/2014/spells/bless.js";
import { boomingBlade as boomingBlade_legacy } from "./selected/macros/2014/spells/boomingBlade.js";
import { boomingBladeMoved as boomingBladeMoved_legacy } from "./selected/macros/2014/spells/boomingBlade.js";
import { brandingSmite as brandingSmite_legacy } from "./selected/macros/2014/spells/brandingSmite.js";
import { brandingSmiteDamage as brandingSmiteDamage_legacy } from "./selected/macros/2014/spells/brandingSmite.js";
import { chillTouch as chillTouch_legacy } from "./selected/macros/2014/spells/chillTouch.js";
import { chillTouchChilled as chillTouchChilled_legacy } from "./selected/macros/2014/spells/chillTouch.js";
import { darkness as darkness_legacy } from "./selected/macros/2014/spells/darkness.js";
import { dash as dash_legacy } from "./selected/macros/2014/actions/dash.js";
import { disengage as disengage_legacy } from "./selected/macros/2014/actions/disengage.js";
import { divineSmite as divineSmite_legacy } from "./selected/macros/2014/classFeatures/paladin/divineSmite.js";
import { dodge as dodge_legacy } from "./selected/macros/2014/actions/dodge.js";
import { eldritchSmite as eldritchSmite_legacy } from "./selected/macros/2014/classFeatures/warlock/invocations/eldritchSmite.js";
import { findSteed as findSteed_legacy } from "./selected/macros/2014/spells/findSteed.js";
import { findSteedActive as findSteedActive_legacy } from "./selected/macros/2014/spells/findSteed.js";
import { grapple as grapple_legacy } from "./selected/macros/2014/actions/grapple.js";
import { grappleEscape as grappleEscape_legacy } from "./selected/macros/2014/actions/grapple.js";
import { greenFlameBlade as greenFlameBlade_legacy } from "./selected/macros/2014/spells/greenFlameBlade.js";
import { hex as hex_legacy } from "./selected/macros/2014/spells/hex.js";
import { hexAttack as hexAttack_legacy } from "./selected/macros/2014/spells/hex.js";
import { hexbladesCurse as hexbladesCurse_legacy } from "./selected/macros/2014/classFeatures/warlock/hexblade/hexbladesCurse.js";
import { hexbladesCurseSource as hexbladesCurseSource_legacy } from "./selected/macros/2014/classFeatures/warlock/hexblade/hexbladesCurse.js";
import { hexbladesCurseTarget as hexbladesCurseTarget_legacy } from "./selected/macros/2014/classFeatures/warlock/hexblade/hexbladesCurse.js";
import { holdPerson as holdPerson_legacy } from "./selected/macros/2014/spells/holdPerson.js";
import { hypnoticPattern as hypnoticPattern_legacy } from "./selected/macros/2014/spells/hypnoticPattern.js";
import { hypnoticPatternRemove as hypnoticPatternRemove_legacy } from "./selected/macros/2014/spells/hypnoticPattern.js";
import { magicMissile as magicMissile_legacy } from "./selected/macros/2014/spells/magicMissile.js";
import { mistyStep as mistyStep_legacy } from "./selected/macros/2014/spells/mistyStep.js";
import { quickenedSpell as quickenedSpell_legacy } from "./selected/macros/2014/classFeatures/sorcerer/metamagic.js";
import { rayOfEnfeeblement as rayOfEnfeeblement_legacy } from "./selected/macros/2014/spells/rayOfEnfeeblement.js";
import { rayOfEnfeeblementEnfeebled as rayOfEnfeeblementEnfeebled_legacy } from "./selected/macros/2014/spells/rayOfEnfeeblement.js";
import { rimesBindingIce as rimesBindingIce_legacy } from "./selected/macros/2014/spells/rimesBindingIce.js";
import { rimesBindingIceFrozen as rimesBindingIceFrozen_legacy } from "./selected/macros/2014/spells/rimesBindingIce.js";
import { scorchingRay as scorchingRay_legacy } from "./selected/macros/2014/spells/scorchingRay.js";
import { shield as shield_legacy } from "./selected/macros/2014/spells/shield.js";
import { shockingGrasp as shockingGrasp_legacy } from "./selected/macros/2014/spells/shockingGrasp.js";
import { shove as shove_legacy } from "./selected/macros/2014/actions/shove.js";
import { spiritShroud as spiritShroud_legacy } from "./selected/macros/2014/spells/spiritShroud.js";
import { spiritShroudShrouded as spiritShroudShrouded_legacy } from "./selected/macros/2014/spells/spiritShroud.js";
import { tashasCausticBrew as tashasCausticBrew_legacy } from "./selected/macros/2014/spells/tashasCausticBrew.js";
import { vortexWarp as vortexWarp_legacy } from "./selected/macros/2014/spells/vortexWarp.js";
import { wardingBond as wardingBond_legacy } from "./selected/macros/2014/spells/wardingBond.js";
import { wardingBondTarget as wardingBondTarget_legacy } from "./selected/macros/2014/spells/wardingBond.js";
import { wardingBondSource as wardingBondSource_legacy } from "./selected/macros/2014/spells/wardingBond.js";
import { wrathfulSmite as wrathfulSmite_legacy } from "./selected/macros/2014/spells/wrathfulSmite.js";
import { wrathfulSmiteDamage as wrathfulSmiteDamage_legacy } from "./selected/macros/2014/spells/wrathfulSmite.js";
import { bane as bane_modern } from "./selected/macros/2024/spells/bane.js";
import { bless as bless_modern } from "./selected/macros/2024/spells/bless.js";
import { blur as blur_modern } from "./selected/macros/2024/spells/blur.js";
import { blurEffect as blurEffect_modern } from "./selected/macros/2024/spells/blur.js";
import { compelledDuel as compelledDuel_modern } from "./selected/macros/2024/spells/compelledDuel.js";
import { compelledDuelCompelled as compelledDuelCompelled_modern } from "./selected/macros/2024/spells/compelledDuel.js";
import { compelledDuelSource as compelledDuelSource_modern } from "./selected/macros/2024/spells/compelledDuel.js";
import { detectMagic as detectMagic_modern } from "./selected/macros/2024/spells/detectMagic.js";
import { eldritchBlast as eldritchBlast_modern } from "./selected/macros/2024/spells/eldritchBlast.js";
import { faerieFire as faerieFire_modern } from "./selected/macros/2024/spells/faerieFire.js";
import { heatMetal as heatMetal_modern } from "./selected/macros/2024/spells/heatMetal.js";
import { magicMissile as magicMissile_modern } from "./selected/macros/2024/spells/magicMissile.js";
import { mistyStep as mistyStep_modern } from "./selected/macros/2024/spells/mistyStep.js";
import { scorchingRay as scorchingRay_modern } from "./selected/macros/2024/spells/scorchingRay.js";
import { shield as shield_modern } from "./selected/macros/2024/spells/shield.js";
import { shieldOfFaith as shieldOfFaith_modern } from "./selected/macros/2024/spells/shieldOfFaith.js";

export const definitions = Object.freeze({
  legacy: Object.freeze({
    faerieFireOutlined,
    detectMagicDetecting,
    cleanFinishCombatTurn: cleanFinishCombatTurnLocal,
    grapplerPin: grapplerPinLocal,
    removeTemplate: removeTemplateLocal,
    absorbElements: absorbElements_legacy,
    bless: bless_legacy,
    boomingBlade: boomingBlade_legacy,
    boomingBladeMoved: boomingBladeMoved_legacy,
    brandingSmite: brandingSmite_legacy,
    brandingSmiteDamage: brandingSmiteDamage_legacy,
    chillTouch: chillTouch_legacy,
    chillTouchChilled: chillTouchChilled_legacy,
    darkness: darkness_legacy,
    dash: dash_legacy,
    disengage: disengage_legacy,
    divineSmite: divineSmite_legacy,
    dodge: dodge_legacy,
    eldritchSmite: eldritchSmite_legacy,
    findSteed: findSteed_legacy,
    findSteedActive: findSteedActive_legacy,
    grapple: grapple_legacy,
    grappleEscape: grappleEscape_legacy,
    greenFlameBlade: greenFlameBlade_legacy,
    hex: hex_legacy,
    hexAttack: hexAttack_legacy,
    hexbladesCurse: hexbladesCurse_legacy,
    hexbladesCurseSource: hexbladesCurseSource_legacy,
    hexbladesCurseTarget: hexbladesCurseTarget_legacy,
    holdPerson: holdPerson_legacy,
    hypnoticPattern: hypnoticPattern_legacy,
    hypnoticPatternRemove: hypnoticPatternRemove_legacy,
    magicMissile: magicMissile_legacy,
    mistyStep: mistyStep_legacy,
    quickenedSpell: quickenedSpell_legacy,
    rayOfEnfeeblement: rayOfEnfeeblement_legacy,
    rayOfEnfeeblementEnfeebled: rayOfEnfeeblementEnfeebled_legacy,
    rimesBindingIce: rimesBindingIce_legacy,
    rimesBindingIceFrozen: rimesBindingIceFrozen_legacy,
    scorchingRay: scorchingRay_legacy,
    shield: shield_legacy,
    shockingGrasp: shockingGrasp_legacy,
    shove: shove_legacy,
    spiritShroud: spiritShroud_legacy,
    spiritShroudShrouded: spiritShroudShrouded_legacy,
    tashasCausticBrew: tashasCausticBrew_legacy,
    vortexWarp: vortexWarp_legacy,
    wardingBond: wardingBond_legacy,
    wardingBondSource: wardingBondSource_legacy,
    wardingBondTarget: wardingBondTarget_legacy,
    wrathfulSmite: wrathfulSmite_legacy,
    wrathfulSmiteDamage: wrathfulSmiteDamage_legacy,
    antagonize
  }),
  modern: Object.freeze({
    faerieFireOutlined,
    detectMagicDetecting,
    removeTemplate: removeTemplateLocal,
    bane: bane_modern,
    bless: bless_modern,
    blur: blur_modern,
    blurEffect: blurEffect_modern,
    compelledDuel: compelledDuel_modern,
    compelledDuelCompelled: compelledDuelCompelled_modern,
    compelledDuelSource: compelledDuelSource_modern,
    detectMagic: detectMagic_modern,
    eldritchBlast: eldritchBlast_modern,
    faerieFire: faerieFire_modern,
    heatMetal: heatMetal_modern,
    magicMissile: magicMissile_modern,
    mistyStep: mistyStep_modern,
    scorchingRay: scorchingRay_modern,
    shield: shield_modern,
    shieldOfFaith: shieldOfFaith_modern
  })
});
