import { MAGIC_ITEMS_COMPENDIUM_LABEL, MAGIC_ITEMS_COMPENDIUM_NAME, MODULE_ID } from "../constants.js";
import {
  buildNamedIconLookup,
  ensureCompendiumFolders,
  ensurePackSidebarFolder,
  normalizeFolderPath,
  resolveNamedIcon
} from "./compendium-utils.js";
import { syncManagedDocumentsOnActiveGm } from "./managed-compendium-sync.js";
import {
  buildEmbeddedMagicItemPatch,
  buildMagicItemAutomationProjection,
  buildMagicItemIdentityIndex,
  resolveEmbeddedMagicItemIdentity
} from "./magic-item-embedded-sync.js?v=1.4.189-expanded-magic-item-automation";
import { isActiveGmClient } from "../infrastructure/foundry/active-gm.js";
import {
  buildSlug,
  classifyMagicItem,
  inferHeroDollSlotGroupFromSlots,
  mapSlotGroupToHeroDollSlots,
  normalizeHeroDollSlotGroup
} from "./item-classification.js";
import { MAGIC_ITEMS } from "../../magicItem.js";
import {
  escapeFoundryHtml as escapeHtml,
  finiteNumber as toNumber
} from "../shared/foundry-values.js";

const PACK_ID = `world.${MAGIC_ITEMS_COMPENDIUM_NAME}`;
const DND5E_SYSTEM_ID = "dnd5e";
const COMPENDIUM_SIDEBAR_FOLDER = ["Ребрея"];
const EFFECT_MODE_CUSTOM = 0;
const EFFECT_MODE_ADD = 2;
const EFFECT_MODE_UPGRADE = 4;
const DEFAULT_MAGIC_ITEM_ICON = "systems/dnd5e/icons/svg/items/loot.svg";
const MAGIC_TEMPLATE_VERSION = 5;
const MAGIC_ITEM_AUTOMATION_VERSION = 3;
const NATIVE_INSTRUMENT_SPELL_ACTIVITY_VERSION = 1;
const spell24 = (name, id, level, options = {}) => ({
  name,
  id,
  level,
  pack: "spells24",
  ...options
});
const NATIVE_INSTRUMENT_SPELLS = {
  "бандура-фоклучан": [
    { name: "Дубинка", id: "VzgFzcmocr1X1cp4", level: 0 },
    { name: "Защита от зла и добра", id: "xmDBqZhRVrtLP8h2", level: 1 },
    { name: "Левитация", id: "MRxldJd6C4bsBo3O", level: 2 },
    { name: "Невидимость", id: "1N8dDMMgZ1h1YJ3B", level: 2 },
    { name: "Огонь фей", id: "nqBDWkVOfcGZt4YU", level: 1 },
    { name: "Опутывание", id: "gMrWeG8fMDPRFiVe", level: 1 },
    { name: "Полёт", id: "yfbK8gZqESlaoY5t", level: 3 },
    { name: "Разговор с животными", id: "aL1F8fvYLtNzUbKu", level: 1 }
  ],
  "лира-кли": [
    { name: "Защита от зла и добра", id: "xmDBqZhRVrtLP8h2", level: 1 },
    { name: "Изменение формы камня", id: "QvGcdRUSNRKEQJlK", level: 4 },
    { name: "Левитация", id: "MRxldJd6C4bsBo3O", level: 2 },
    { name: "Невидимость", id: "1N8dDMMgZ1h1YJ3B", level: 2 },
    { name: "Огненная стена", id: "X3DrXgxjwI2dvkD6", level: 4 },
    { name: "Полёт", id: "yfbK8gZqESlaoY5t", level: 3 },
    { name: "Стена ветров", id: "ew6GA8dJy2spQmFW", level: 3 }
  ],
  "лютня-досс": [
    { name: "Дружба с животными", id: "hDOENzjuj5WpLq7B", level: 1 },
    { name: "Защита от энергии (только огонь)", id: "j8NtLXOOJ3GAKF8I", level: 3 },
    { name: "Защита от яда", id: "MAxM77CDUu8dgIRQ", level: 2 },
    { name: "Защита от зла и добра", id: "xmDBqZhRVrtLP8h2", level: 1 },
    { name: "Левитация", id: "MRxldJd6C4bsBo3O", level: 2 },
    { name: "Невидимость", id: "1N8dDMMgZ1h1YJ3B", level: 2 },
    { name: "Полёт", id: "yfbK8gZqESlaoY5t", level: 3 }
  ],
  "арфа-анструт": [
    spell24("Control Weather", "phbsplControlWea", 8),
    spell24("Protection from Evil and Good", "phbEvilAndGoodPr", 1),
    spell24("Levitate", "phbsplLevitate00", 2),
    spell24("Cure Wounds", "phbsplCureWounds", 5),
    spell24("Invisibility", "phbsplInvisibili", 2),
    spell24("Fly", "phbsplFly0000000", 3),
    spell24("Wall of Thorns", "phbsplWallofThor", 6)
  ],
  "арфа-оллава": [
    spell24("Control Weather", "phbsplControlWea", 8),
    spell24("Protection from Evil and Good", "phbEvilAndGoodPr", 1),
    spell24("Levitate", "phbsplLevitate00", 2),
    spell24("Invisibility", "phbsplInvisibili", 2),
    spell24("Fire Storm", "phbsplFireStorm0", 7),
    spell24("Confusion", "phbsplConfusion0", 4),
    spell24("Fly", "phbsplFly0000000", 3)
  ],
  "мандолина-канаит": [
    spell24("Protection from Evil and Good", "phbEvilAndGoodPr", 1),
    spell24("Protection from Energy", "phbProtectionFro", 3),
    spell24("Levitate", "phbsplLevitate00", 2),
    spell24("Cure Wounds", "phbsplCureWounds", 3),
    spell24("Dispel Magic", "phbsplDispelMagi", 3),
    spell24("Invisibility", "phbsplInvisibili", 2),
    spell24("Fly", "phbsplFly0000000", 3)
  ],
  "цитра-мак-фуирми": [
    spell24("Barkskin", "phbsplBarkskin00", 2),
    spell24("Protection from Evil and Good", "phbEvilAndGoodPr", 1),
    spell24("Levitate", "phbsplLevitate00", 2),
    spell24("Cure Wounds", "phbsplCureWounds", 1),
    spell24("Invisibility", "phbsplInvisibili", 2),
    spell24("Fly", "phbsplFly0000000", 3),
    spell24("Fog Cloud", "phbsplFogCloud00", 1)
  ]
};
const CHARGED_MAGIC_ITEM_SPELLS = {
  "печатка-гильдии-азориус": {
    uses: { max: 3, recovery: "1d3" },
    spells: [spell24("Ensnaring Strike", "phbsplEnsnaringS", 1, { cost: 1, saveDc: 13 })]
  },
  "печатка-гильдии-бороса": {
    uses: { max: 3, recovery: "1d3" },
    spells: [spell24("Heroism", "phbsplHeroism000", 1, { cost: 1 })]
  },
  "печатка-гильдии-голгари": {
    uses: { max: 3, recovery: "1d3" },
    spells: [spell24("Entangle", "phbsplEntangle00", 1, { cost: 1, saveDc: 13 })]
  },
  "печатка-гильдии-димир": {
    uses: { max: 3, recovery: "1d3" },
    spells: [spell24("Disguise Self", "phbsplDisguiseSe", 1, { cost: 1, saveDc: 13 })]
  },
  "печатка-гильдии-орзова": {
    uses: { max: 3, recovery: "1d3" },
    spells: [spell24("Command", "phbsplCommand000", 1, { cost: 1, saveDc: 13 })]
  },
  "печатка-гильдии-ракдоса": {
    uses: { max: 3, recovery: "1d3" },
    spells: [
      spell24("Hellish Rebuke", "phbsplHellishReb", 1, {
        cost: 1,
        activation: "reaction"
      })
    ]
  },
  "печатка-гильдии-селезнии": {
    uses: { max: 3, recovery: "1d3" },
    spells: [spell24("Charm Person", "phbsplCharmPerso", 1, { cost: 1, saveDc: 13 })]
  },
  "печатка-гильдии-симиков": {
    uses: { max: 3, recovery: "1d3" },
    spells: [spell24("Expeditious Retreat", "phbsplExpeditiou", 1, { cost: 1 })]
  },
  "ушной-червь": {
    uses: { max: 4, recovery: "1d4" },
    spells: [
      {
        name: "Detect Thoughts",
        id: "phbsplDetectThou",
        level: 2,
        cost: 2,
        activation: "action",
        pack: "spells24",
        saveDc: 15
      },
      {
        name: "Dissonant Whispers",
        id: "phbsplDissonantW",
        level: 1,
        cost: 1,
        activation: "action",
        pack: "spells24",
        saveDc: 15
      }
    ]
  },
  "посох-огня": {
    uses: { max: 10, recovery: "1d6 + 4" },
    spells: [
      spell24("Burning Hands", "phbsplBurningHan", 1, { cost: 1 }),
      spell24("Fireball", "phbsplFireball00", 3, { cost: 3 }),
      spell24("Wall of Fire", "phbsplWallofFire", 4, { cost: 4 })
    ]
  },
  "посох-мороза": {
    uses: { max: 10, recovery: "1d6 + 4" },
    spells: [
      spell24("Cone of Cold", "phbsplConeofCold", 5, { cost: 5 }),
      spell24("Fog Cloud", "phbsplFogCloud00", 1, { cost: 1 }),
      spell24("Ice Storm", "phbsplIceStorm00", 4, { cost: 4 }),
      spell24("Wall of Ice", "phbsplWallofIce0", 6, { cost: 4 })
    ]
  },
  "волшебная-палочка-сковывания": {
    uses: { max: 7, recovery: "1d6 + 1" },
    spells: [
      spell24("Hold Monster", "phbsplHoldMonste", 5, { cost: 5, saveDc: 17 }),
      spell24("Hold Person", "phbsplHoldPerson", 2, { cost: 2, saveDc: 17 })
    ]
  },
  "волшебная-палочка-огненных-шаров": {
    uses: { max: 7, recovery: "1d6 + 1" },
    spells: [spell24("Fireball", "phbsplFireball00", 3, {
      cost: 1,
      saveDc: 15,
      scalingMax: "min(@item.uses.value,3)"
    })]
  },
  "волшебная-палочка-обнаружения-магии": {
    uses: { max: 3, recovery: "1d3" },
    spells: [spell24("Detect Magic", "phbsplDetectMagi", 1, { cost: 1 })]
  },
  "волшебная-палочка-молний": {
    uses: { max: 7, recovery: "1d6 + 1" },
    spells: [spell24("Lightning Bolt", "phbsplLightningB", 3, {
      cost: 1,
      saveDc: 15,
      scalingMax: "min(@item.uses.value,3)"
    })]
  },
  "волшебная-палочка-паутины": {
    uses: { max: 7, recovery: "1d6 + 1" },
    spells: [spell24("Web", "phbsplWeb0000000", 2, { cost: 1, saveDc: 15 })]
  },
  "волшебная-палочка-превращения": {
    uses: { max: 7, recovery: "1d6 + 1" },
    spells: [spell24("Polymorph", "phbsplPolymorph0", 4, { cost: 1, saveDc: 15 })]
  },
  "волшебная-палочка-снарядов": {
    uses: { max: 7, recovery: "1d6 + 1" },
    spells: [spell24("Magic Missile", "phbsplMagicMissi", 1, {
      cost: 1,
      scalingMax: "min(@item.uses.value,3)"
    })]
  },
  "посох-лечения": {
    uses: { max: 10, recovery: "1d6 + 4" },
    spells: [
      spell24("Cure Wounds", "phbsplCureWounds", 1, { cost: 1, scalingMax: "4" }),
      spell24("Lesser Restoration", "phbsplLesserRest", 2, { cost: 2 }),
      spell24("Mass Cure Wounds", "phbsplMassCureWo", 5, { cost: 5 })
    ]
  },
  "трезубец-командования-рыбами": {
    uses: { max: 3, recovery: "1d3" },
    spells: [spell24("Dominate Beast", "phbsplDominateBe", 4, { cost: 1, saveDc: 15 })]
  },
  "медальон-мыслей": {
    uses: { max: 3, recovery: "1d3" },
    spells: [spell24("Detect Thoughts", "phbsplDetectThou", 2, { cost: 1, saveDc: 13 })]
  },
  "кольцо-затуманивания": {
    uses: { max: 3, recovery: "1d3" },
    spells: [spell24("Fog Cloud", "phbsplFogCloud00", 1, { cost: 1 })]
  },
  "трезубец-зова-приливов": {
    uses: { max: 3, recovery: "1d3" },
    spells: [
      spell24("Control Water", "phbsplControlWat", 4, { cost: 1, saveDc: 15 }),
      spell24("Tsunami", "phbsplTsunami000", 8, { cost: 3, saveDc: 15 })
    ]
  },
  "шлем-телепортации": {
    uses: { max: 3, recovery: "1d3" },
    spells: [spell24("Teleport", "phbsplTeleport00", 7, { cost: 1 })]
  },
  "шлем-телепатии": {
    spells: [
      spell24("Detect Thoughts", "phbsplDetectThou", 2, { saveDc: 13 }),
      spell24("Suggestion", "phbsplSuggestion", 2, { saveDc: 13, uses: { max: 1 } })
    ]
  },
  "шлем-понимания-языков": {
    spells: [spell24("Comprehend Languages", "phbsplComprehend", 1)]
  },
  "игла-починки": {
    spells: [spell24("Mending", "phbsplMending000", 0)]
  },
  "шапка-маскировки": {
    spells: [spell24("Disguise Self", "phbsplDisguiseSe", 1)]
  },
  "татуировка-маскарада": {
    spells: [spell24("Disguise Self", "phbsplDisguiseSe", 1, { saveDc: 13, uses: { max: 1 } })]
  },
  "сапоги-странника": {
    spells: [spell24("Expeditious Retreat", "phbsplExpeditiou", 1, {
      activation: "bonus",
      uses: { max: 1 }
    })]
  },
  "плащ-шарлатана": {
    spells: [spell24("Dimension Door", "phbsplDimensionD", 4, { uses: { max: 1 } })]
  },
  "аметистовый-магнетит": {
    uses: { max: 6, recovery: "1d6" },
    spells: [spell24("Reverse Gravity", "phbsplReverseGra", 7, { cost: 3, saveDc: 18 })]
  },
  "амулет-святилища": {
    spells: [spell24("Spare the Dying", "phbsplSparetheDy", 0)]
  },
  "боевая-кирка-камнетворца": {
    spells: [spell24("Meld into Stone", "phbsplMeldintoSt", 3, { uses: { max: 1 } })]
  },
  "ветвь-с-колокольчиками": {
    uses: { max: 3, recovery: "1d3" },
    spells: [spell24("Protection from Evil and Good", "phbEvilAndGoodPr", 1, { cost: 1 })]
  },
  "визор-данота": {
    spells: [spell24("Antimagic Field", "phbsplAntimagicF", 8, { uses: { max: 1 } })]
  },
  "доспех-антимагии": {
    spells: [spell24("Antimagic Field", "phbsplAntimagicF", 8, { uses: { max: 1 } })]
  },
  "доспех-защиты": {
    spells: [spell24("Beacon of Hope", "phbsplBeaconofHo", 3, { uses: { max: 1 } })]
  },
  "доспех-зефира": {
    spells: [spell24("Wind Wall", "phbsplWindWall00", 3, { saveDc: 15, uses: { max: 1 } })]
  },
  "доспехи-мрака": {
    uses: { max: 3, recovery: "1d3" },
    spells: [spell24("Calm Emotions", "phbsplCalmEmotio", 2, { cost: 1, saveDc: 15 })]
  },
  "доспехи-фей": {
    uses: { max: 3, recovery: "1d3" },
    spells: [spell24("Compulsion", "phbsplCompulsion", 4, { cost: 1, saveDc: 15 })]
  },
  "жезл-адского-пламени": {
    spells: [spell24("Hellish Rebuke", "phbsplHellishReb", 4, {
      activation: "reaction",
      saveDc: 16,
      uses: { max: 1 }
    })]
  },
  "камни-послания": {
    spells: [spell24("Sending", "phbsplSending000", 3, { uses: { max: 1 } })]
  },
  "кираса-баланса": {
    uses: { max: 4, recovery: "1d4" },
    spells: [spell24("Lesser Restoration", "phbsplLesserRest", 2, {
      activation: "bonus",
      cost: 2
    })]
  },
  "кираса-камнелома": {
    spells: [spell24("Wall of Stone", "phbsplWallofSton", 5, { saveDc: 14, uses: { max: 1 } })]
  },
  "книга-фокусов": {
    uses: { max: 7, recovery: "1d6 + 1" },
    spells: [spell24("Prestidigitation", "phbsplPrestidigi", 0, { cost: 1 })]
  },
  "книга-чудотворства": {
    uses: { max: 7, recovery: "1d6 + 1" },
    spells: [spell24("Thaumaturgy", "phbsplThaumaturg", 0, { cost: 1 })]
  },
  "колода-оракула": {
    spells: [spell24("Divination", "phbsplDivination", 4, { uses: { max: 1 } })]
  },
  "корона-несущего-гнев": {
    spells: [spell24("Fear", "phbsplFear000000", 3, { saveDc: 15, uses: { max: 1 } })]
  },
  "мантия-мистраля": {
    spells: [spell24("Sleet Storm", "phbsplSleetStorm", 3, { saveDc: 14, uses: { max: 1 } })]
  },
  "обруч-сжигания": {
    spells: [spell24("Scorching Ray", "phbsplScorchingR", 2, { attackBonus: 5, uses: { max: 1 } })]
  },
  "очки-распознавания-объектов": {
    spells: [spell24("Identify", "phbsplIdentify00", 1, { uses: { max: 1 } })]
  },
  "плащ-летучей-мыши": {
    spells: [spell24("Polymorph", "phbsplPolymorph0", 4, { uses: { max: 1 } })]
  },
  "плащ-паука": {
    spells: [spell24("Web", "phbsplWeb0000000", 2, { saveDc: 13, uses: { max: 1 } })]
  },
  "сокрушитель-сумерек": {
    spells: [spell24("Sunbeam", "phbsplSunbeam000", 6, { saveDc: 15, uses: { max: 1 } })]
  },
  "тиара-кружащихся-комет": {
    uses: { max: 6, recovery: "1d6" },
    spells: [spell24("Ice Storm", "phbsplIceStorm00", 4, { cost: 3, saveDc: 16 })]
  },
  "штормовой-пояс": {
    spells: [spell24("Control Weather", "phbsplControlWea", 8, { uses: { max: 1 } })]
  },
  "веер-ветра": {
    spells: [spell24("Gust of Wind", "phbsplGustofWind", 2, { saveDc: 13 })]
  },
  "доспехи-невесомости": {
    uses: { max: 5, recovery: "1d4 + 1" },
    spells: [
      spell24("Jump", "phbsplJump000000", 1, { activation: "bonus", cost: 1 }),
      spell24("Levitate", "phbsplLevitate00", 2, { activation: "bonus", cost: 2, saveDc: 13 })
    ]
  },
  "доспехи-падшего": {
    uses: { max: 1 },
    spells: [
      spell24("Speak with Dead", "phbsplSpeakwithD", 3, { cost: 1 }),
      spell24("Animate Dead", "phbsplAnimateDea", 3, { cost: 1 })
    ]
  },
  "кольцо-прыжков": {
    spells: [spell24("Jump", "phbsplJump000000", 1, { activation: "bonus" })]
  },
  "очки-очарования": {
    uses: { max: 3 },
    spells: [spell24("Charm Person", "phbsplCharmPerso", 1, { cost: 1, saveDc: 13 })]
  },
  "парящая-сфера": {
    spells: [
      spell24("Light", "phbsplLight00000", 0),
      spell24("Daylight", "phbsplDaylight00", 3, { uses: { max: 1 } })
    ]
  },
  "жаровня-командования-огненными-элементалями": {
    spells: [spell24("Conjure Elemental", "phbsplConjureEle", 5, { uses: { max: 1 } })]
  },
  "кадило-контролирования-воздушных-элементалей": {
    spells: [spell24("Conjure Elemental", "phbsplConjureEle", 5, { uses: { max: 1 } })]
  },
  "камень-контролирования-земляных-элементалей": {
    spells: [spell24("Conjure Elemental", "phbsplConjureEle", 5, { uses: { max: 1 } })]
  },
  "чаша-командования-водяными-элементалями": {
    spells: [spell24("Conjure Elemental", "phbsplConjureEle", 5, { uses: { max: 1 } })]
  },
  "кольцо-влияния-на-животных": {
    uses: { max: 3, recovery: "1d3" },
    spells: [
      spell24("Animal Friendship", "phbsplAnimalFrie", 1, { cost: 1, saveDc: 13 }),
      spell24("Fear", "phbsplFear000000", 3, { cost: 1, saveDc: 13 }),
      spell24("Speak with Animals", "phbsplSpeakwithA", 1, { cost: 1 })
    ]
  },
  "концертина-гуляки": {
    spells: [spell24("Irresistible Dance", "phbsplOttosIrres", 6, { uses: { max: 1 } })]
  },
  "лира-песни-сирен": {
    spells: [
      spell24("Suggestion", "phbsplSuggestion", 2, { saveDc: 15, uses: { max: 1 } }),
      spell24("Animal Friendship", "phbsplAnimalFrie", 1, { saveDc: 15, uses: { max: 1 } }),
      spell24("Charm Person", "phbsplCharmPerso", 1, { saveDc: 15, uses: { max: 1 } }),
      spell24("Enthrall", "phbsplEnthrall00", 2, { saveDc: 15, uses: { max: 1 } })
    ]
  },
  "лира-строительства": {
    spells: [
      spell24("Mending", "phbsplMending000", 0),
      spell24("Move Earth", "phbsplMoveEarth0", 6, { uses: { max: 1 } }),
      spell24("Fabricate", "phbsplFabricate0", 4, { uses: { max: 1 } }),
      spell24("Passwall", "phbsplPasswall00", 5, { uses: { max: 1 } })
    ]
  },
  "отмычка-воителя": {
    spells: [spell24("Knock", "phbsplKnock00000", 2)]
  },
  "сапоги-левитации": {
    spells: [spell24("Levitate", "phbsplLevitate00", 2)]
  },
  "посох-очарования": {
    uses: { max: 10, recovery: "1d8 + 2" },
    spells: [
      spell24("Charm Person", "phbsplCharmPerso", 1, { cost: 1, saveDc: 17 }),
      spell24("Comprehend Languages", "phbsplComprehend", 1, { cost: 1 }),
      spell24("Command", "phbsplCommand000", 1, { cost: 1, saveDc: 17 })
    ]
  },
  "посох-роя-насекомых": {
    uses: { max: 10, recovery: "1d6 + 4" },
    spells: [
      spell24("Giant Insect", "phbsplGiantInsec", 4, { cost: 4, saveDc: 17 }),
      spell24("Insect Plague", "phbsplInsectPlag", 5, { cost: 5, saveDc: 17 })
    ]
  },
  "посох-путешественника": {
    uses: { max: 10, recovery: "1d6 + 4" },
    spells: [
      spell24("Banishment", "phbsplBanishment", 4, { cost: 4, saveDc: 17 }),
      spell24("Blink", "phbsplBlink00000", 3, { cost: 3 }),
      spell24("Misty Step", "phbsplMistyStep0", 2, { activation: "bonus", cost: 2 }),
      spell24("Passwall", "phbsplPasswall00", 5, { cost: 5 }),
      spell24("Teleport", "phbsplTeleport00", 7, { cost: 7 })
    ]
  },
  "кольцо-падающих-звезд": {
    uses: { max: 6, recovery: "1d6" },
    spells: [
      spell24("Faerie Fire", "phbsplFaerieFire", 1, { cost: 1, saveDc: 15 }),
      spell24("Dancing Lights", "phbsplDancingLig", 0, { useSharedUses: false }),
      spell24("Light", "phbsplLight00000", 0, { useSharedUses: false })
    ]
  },
  "слизь-кирзина": {
    spells: [
      spell24("Dancing Lights", "phbsplDancingLig", 0),
      spell24("Sunbeam", "phbsplSunbeam000", 6, { saveDc: 17, uses: { max: 1 } })
    ]
  },
  "арфа-позолоченного-изобилия": {
    spells: [spell24("Calm Emotions", "phbsplCalmEmotio", 2, { saveDc: 19, uses: { max: 5 } })]
  },
  "жезл-воскрешения": {
    uses: { max: 5, recovery: "1" },
    spells: [
      spell24("Heal", "phbsplHeal000000", 6, { cost: 1 }),
      spell24("Resurrection", "phbsplResurrecti", 7, { cost: 5 })
    ]
  },
  "ключ-лазутчика": {
    spells: [
      spell24("Pass without Trace", "phbsplPasswithou", 2, { uses: { max: 1 } }),
      spell24("Invisibility", "phbsplInvisibili", 2, { uses: { max: 1 } }),
      spell24("Knock", "phbsplKnock00000", 2, { uses: { max: 1 } }),
      spell24("Alter Self", "phbsplAlterSelf0", 2, { uses: { max: 1 } }),
      spell24("Gaseous Form", "phbsplGaseousFor", 3, { uses: { max: 1 } }),
      spell24("Dimension Door", "phbsplDimensionD", 4, { uses: { max: 1 } }),
      spell24("Mislead", "phbsplMislead000", 5, { uses: { max: 1 } })
    ]
  },
  "корона-бехолдеров-белаширры": {
    uses: { max: 10, recovery: "1d6 + 3" },
    spells: [
      spell24("Slow", "phbsplSlow000000", 3, { cost: 3, saveDc: 16 }),
      spell24("Ray of Enfeeblement", "phbsplRayofEnfee", 2, { cost: 2, saveDc: 16 }),
      spell24("Flesh to Stone", "phbsplFleshtoSto", 6, { cost: 6, saveDc: 16 }),
      spell24("Charm Person", "phbsplCharmPerso", 1, { cost: 1, saveDc: 16 }),
      spell24("Finger of Death", "phbsplFingerofDe", 7, { cost: 7, saveDc: 16 }),
      spell24("Disintegrate", "phbsplDisintegra", 6, { cost: 6, saveDc: 16 }),
      spell24("Telekinesis", "phbsplTelekinesi", 5, { cost: 5, saveDc: 16 }),
      spell24("Hold Person", "phbsplHoldPerson", 2, { cost: 2, saveDc: 16 }),
      spell24("Fear", "phbsplFear000000", 3, { cost: 3, saveDc: 16 }),
      spell24("Sleep", "phbsplSleep00000", 1, { cost: 1, saveDc: 16 })
    ]
  },
  "куб-врат": {
    uses: { max: 3, recovery: "1d3" },
    spells: [
      spell24("Gate", "phbsplGate000000", 9, { cost: 1 }),
      spell24("Plane Shift", "phbsplPlaneShift", 7, { cost: 1, saveDc: 17 })
    ]
  },
  "кольцо-трех-желаний": {
    uses: { max: 3, noRecovery: true },
    spells: [spell24("Wish", "phbsplWish000000", 9, { cost: 1 })]
  },
  "покров-вредителей": {
    spells: [
      spell24("Polymorph", "phbsplPolymorph0", 4, { uses: { max: 1 } }),
      spell24("Insect Plague", "phbsplInsectPlag", 5, { saveDc: 15, uses: { max: 1 } })
    ]
  },
  "жезл-бдительности": {
    spells: [
      spell24("See Invisibility", "phbsplSeeInvisib", 2),
      spell24("Detect Poison and Disease", "phbsplDetectPois", 1),
      spell24("Detect Evil and Good", "phbsplDetectEvil", 1),
      spell24("Detect Magic", "phbsplDetectMagi", 1)
    ]
  },
  "жезл-бдительности-2": {
    spells: [
      spell24("See Invisibility", "phbsplSeeInvisib", 2),
      spell24("Detect Poison and Disease", "phbsplDetectPois", 1),
      spell24("Detect Evil and Good", "phbsplDetectEvil", 1),
      spell24("Detect Magic", "phbsplDetectMagi", 1)
    ]
  },
  "мантия-звезд": {
    uses: { max: 6, noRecovery: true },
    spells: [spell24("Magic Missile", "phbsplMagicMissi", 5, { cost: 1 })]
  },
  "амулет-планов": {
    spells: [spell24("Plane Shift", "phbsplPlaneShift", 7)]
  },
  "волшебная-палочка-страха": {
    uses: { max: 7, recovery: "1d6 + 1" },
    spells: [spell24("Command", "phbsplCommand000", 1, { cost: 1, saveDc: 15 })]
  },
  "эгида-эвриаллы": {
    spells: [
      spell24("Lesser Restoration", "phbsplLesserRest", 2, { uses: { max: 1 } }),
      spell24("Locate Creature", "phbsplLocateCrea", 4, { uses: { max: 1 } }),
      spell24("Transport via Plants", "phbsplTransportv", 6, { uses: { max: 1 } })
    ]
  }
};
const MAGIC_ITEM_UTILITY_DEFINITIONS = {
  "кинжал-яда": {
    uses: { max: 1, recovery: null },
    activities: [{
      key: "coat-blade-with-poison",
      name: "Покрыть клинок ядом",
      activation: "action",
      cost: 1,
      chatFlavor: "Клинок покрывается ядом на 1 минуту или до следующего попадания. После попадания используйте отдельную activity спасброска яда."
    }]
  },
  "механистический-амулет": {
    uses: { max: 1, recovery: null },
    activities: [{
      key: "take-ten-on-attack",
      name: "Принять 10 на броске атаки",
      activation: "special",
      cost: 1,
      chatFlavor: "Вместо броска к20 выберите значение 10 на кости для текущего броска атаки."
    }]
  },
  "таранный-щит": {
    uses: { max: 3, recovery: "1d3" },
    activities: [{
      key: "battering-shove",
      name: "Усиленный толчок",
      activation: "special",
      cost: 1,
      chatFlavor: "После успешного обычного толчка выберите: оттолкнуть цель ещё на 10 футов, сбить её с ног или применить оба результата."
    }]
  },
  "развевающийся-плащ": {
    activities: [{
      key: "billow-cloak",
      name: "Драматично развеять плащ",
      activation: "bonus",
      cost: null,
      chatFlavor: "Плащ драматично развевается."
    }]
  },
  "трубка-дымных-чудовищ": {
    activities: [{
      key: "exhale-smoke-creature",
      name: "Выдохнуть дымное существо",
      activation: "action",
      cost: null,
      chatFlavor: "Облако дыма принимает форму существа размером не более 1-футового куба и через несколько секунд рассеивается."
    }]
  },
  "фонарь-обнаружения": {
    activities: [
      {
        key: "open-lantern",
        name: "Открыть фонарь",
        activation: "action",
        cost: null,
        chatFlavor: "Откройте фонарь. Свет и обнаружение невидимого применяются вручную к текущему Token."
      },
      {
        key: "lower-lantern-hood",
        name: "Опустить козырёк",
        activation: "action",
        cost: null,
        chatFlavor: "Опустите козырёк: фонарь оставляет тусклый свет в пределах 5 футов. Состояние Token изменяется вручную."
      }
    ]
  },
  "универсальный-инструмент-1": {
    uses: { max: 1, recovery: null },
    activities: [
      {
        key: "transform-tool",
        name: "Изменить форму инструмента",
        activation: "action",
        cost: null,
        chatFlavor: "Выберите форму одного вида инструментов ремесленника."
      },
      {
        key: "choose-cantrip",
        name: "Выбрать заговор",
        activation: "action",
        cost: 1,
        chatFlavor: "Выберите неизвестный заговор из списка любого класса; в течение 8 часов он считается для вас заговором изобретателя."
      }
    ]
  },
  "амулет-благочестия-1": {
    uses: { max: 1, recovery: null },
    activities: [{
      key: "free-channel-divinity",
      name: "Божественный канал без расхода",
      activation: "special",
      cost: 1,
      chatFlavor: "Используйте Божественный канал без расхода его actor-resource."
    }]
  },
  "барабан-задающего-ритм-1": {
    uses: { max: 1, recovery: null },
    activities: [{
      key: "restore-bardic-inspiration",
      name: "Восстановить Бардовское вдохновение",
      activation: "action",
      cost: 1,
      chatFlavor: "Восстановите одну израсходованную кость Бардовского вдохновения."
    }]
  },
  "аметистовый-магнетит": {
    activities: [
      {
        key: "amethyst-flight",
        name: "Звёздный полёт",
        activation: "bonus",
        cost: 1,
        chatFlavor: "На 10 минут получите скорость полёта, равную скорости ходьбы, и способность парить."
      },
      {
        key: "gravity-throw",
        name: "Гравитационный бросок",
        activation: "action",
        cost: 1,
        chatFlavor: "Выбранная цель в пределах 60 футов совершает спасбросок Силы Сл 18; при провале переместите её на 20 футов в выбранном направлении."
      }
    ]
  },
  "амулет-святилища": {
    uses: { max: 1, recovery: null },
    activities: [{
      key: "awaken-sanctuary-rune",
      name: "Пробудить руну",
      activation: "reaction",
      cost: 1,
      chatFlavor: "Когда видимое в пределах 60 футов существо должно упасть до 0 хитов от урона, вместо этого оставьте ему 1 хит."
    }]
  },
  "ветвь-с-колокольчиками": {
    activities: [{
      key: "detect-creatures",
      name: "Обнаружить существ",
      activation: "bonus",
      cost: 1,
      chatFlavor: "Обнаружьте присутствие перечисленных в описании типов существ в пределах 60 футов; вид существа определяется тоном колокольчиков."
    }]
  },
  "волшебная-палочка-сковывания": {
    activities: [{
      key: "assisted-escape",
      name: "Помощь в освобождении",
      activation: "reaction",
      cost: 1,
      chatFlavor: "Получите преимущество на спасбросок против паралича/опутывания или на проверку для освобождения из захвата."
    }]
  },
  "доспех-антимагии": {
    uses: { max: 1, recovery: null },
    activities: [{
      key: "spell-save-advantage",
      name: "Защита от заклинания",
      activation: "reaction",
      cost: 1,
      chatFlavor: "Получите преимущество на текущий спасбросок от заклинания. Этот отдельный ресурс восстанавливается на рассвете."
    }]
  },
  "тиара-кружащихся-комет": {
    activities: [
      {
        key: "comet-flight",
        name: "Звёздный полёт",
        activation: "bonus",
        cost: 1,
        chatFlavor: "На 10 минут получите скорость полёта, равную скорости ходьбы, и способность парить."
      },
      {
        key: "star-strike",
        name: "Звёздный удар: один снаряд",
        activation: "action",
        cost: 1,
        chatFlavor: "Один снаряд автоматически попадает и наносит 2к4 урона холодом; повторите activity для каждого дополнительного заряда и распределите цели вручную."
      }
    ]
  },
  "сокрушитель-сумерек": {
    activities: [
      {
        key: "ignite-dusk-crusher",
        name: "Зажечь навершие",
        activation: "bonus",
        cost: null,
        chatFlavor: "Навершие излучает яркий солнечный свет в радиусе 15 футов и тусклый ещё на 15 футов. Состояние света Token изменяется вручную."
      },
      {
        key: "extinguish-dusk-crusher",
        name: "Погасить навершие",
        activation: "action",
        cost: null,
        chatFlavor: "Погасите солнечный свет навершия. Состояние света Token изменяется вручную."
      }
    ]
  },
  "амулет-темного-осколка": {
    activities: [{
      key: "attempt-warlock-cantrip", name: "Попытаться наложить заговор колдуна", activation: "action", cost: 1,
      uses: { max: 1, period: "lr" },
      chatFlavor: "Выберите неизвестный заговор колдуна и совершите проверку Интеллекта (Магия) Сл 10; заклинание и результат проверки применяются вручную."
    }]
  },
  "дирижерская-палочка": {
    uses: { max: 3 },
    activities: [{
      key: "conduct-music", name: "Зазвучать оркестром", activation: "action", cost: 1,
      chatFlavor: "Палочка воспроизводит оркестровую музыку в течение 1 минуты."
    }]
  },
  "доспех-быстрого-снятия": {
    activities: [{
      key: "doff-armor", name: "Быстро снять доспех", activation: "action", cost: null,
      chatFlavor: "Снимите этот доспех действием; состояние экипировки изменяется вручную."
    }]
  },
  "защитная-сфера": {
    activities: [{
      key: "reduce-variant-damage", name: "Ослабить урон сферы", activation: "reaction", cost: null,
      chatFlavor: "Уменьшите на 1к4 урон того типа, который соответствует варианту сферы; тип варианта и итоговый урон применяются вручную."
    }]
  },
  "изменяющаяся-ткань": {
    activities: [{
      key: "change-outfit", name: "Изменить наряд", activation: "bonus", cost: null,
      chatFlavor: "Выберите внешний вид одежды; механическая экипировка не изменяется."
    }]
  },
  "инструмент-надписей": {
    uses: { max: 3 },
    activities: [{
      key: "inscribe-message", name: "Оставить надпись", activation: "action", cost: 1,
      chatFlavor: "Напишите видимое сообщение на выбранной поверхности согласно описанию предмета."
    }]
  },
  "очищающий-камень": {
    activities: [{
      key: "clean-object", name: "Очистить предмет", activation: "action", cost: null,
      chatFlavor: "Очистите одежду или иной предмет размером не больше 1 кубического фута."
    }]
  },
  "палочка-пиротехники": {
    uses: { max: 7, recovery: "1d6 + 1" },
    activities: [{
      key: "pyrotechnic-flash", name: "Пиротехническая вспышка", activation: "action", cost: 1,
      chatFlavor: "Создайте безвредную вспышку света, цвета или звука согласно описанию палочки."
    }]
  },
  "палочка-улыбок": {
    uses: { max: 3 },
    activities: [{
      key: "force-smile", type: "save", name: "Вызвать улыбку", activation: "action", cost: 1,
      ability: "wis", dc: 10,
      chatFlavor: "При провале цель на 1 минуту не может перестать улыбаться; превращение палочки при последнем заряде отслеживается вручную."
    }]
  },
  "палочка-хмурых-взглядов": {
    uses: { max: 3 },
    activities: [{
      key: "force-scowl", type: "save", name: "Вызвать хмурый взгляд", activation: "action", cost: 1,
      ability: "wis", dc: 10,
      chatFlavor: "При провале цель на 1 минуту не может перестать хмуриться; превращение палочки при последнем заряде отслеживается вручную."
    }]
  },
  "плащ-множества-стилей": {
    activities: [{
      key: "change-cloak-style", name: "Изменить стиль плаща", activation: "bonus", cost: null,
      chatFlavor: "Измените цвет, стиль и качество плаща."
    }]
  },
  "посох-птичьего-щебета": {
    uses: { max: 10, recovery: "1d6 + 4" },
    activities: [{
      key: "bird-call", name: "Птичий щебет", activation: "action", cost: 1,
      chatFlavor: "Посох издаёт один из птичьих криков в пределах слышимости."
    }]
  },
  "посох-цветов": {
    uses: { max: 10, recovery: "1d6 + 4" },
    activities: [{
      key: "grow-flower", name: "Вырастить цветок", activation: "action", cost: 1,
      chatFlavor: "На выбранном участке земли или почвы вырастает безвредный цветок."
    }]
  },
  "рог-беззвучного-сигнала": {
    uses: { max: 4, recovery: "1d4" },
    activities: [{
      key: "silent-signal", name: "Беззвучный сигнал", activation: "action", cost: 1,
      chatFlavor: "Одно выбранное существо в пределах 600 футов слышит сигнал рога."
    }]
  },
  "складной-шест": {
    activities: [{
      key: "toggle-pole", name: "Сложить или разложить шест", activation: "action", cost: null,
      chatFlavor: "Шест складывается до 1 фута или возвращается к полной длине."
    }]
  },
  "срастающаяся-веревка": {
    activities: [{
      key: "mend-rope", name: "Срастить верёвку", activation: "action", cost: null,
      chatFlavor: "Две части верёвки магически срастаются; положение и длина отслеживаются вручную."
    }]
  },
  "сфера-времени": {
    activities: [{
      key: "tell-time", name: "Узнать время", activation: "action", cost: null,
      chatFlavor: "Узнайте точное время суток в текущем месте."
    }]
  },
  "сфера-направления": {
    activities: [{
      key: "find-north", name: "Определить север", activation: "action", cost: null,
      chatFlavor: "Определите направление на север, если в текущем месте существует магнитный север."
    }]
  },
  "татуировка-просветителя": {
    activities: [{
      key: "invisible-writing", name: "Невидимая надпись", activation: "action", cost: 1,
      uses: { max: 1 },
      chatFlavor: "Напишите сообщение, видимое только выбранному существу; текст и получатель фиксируются вручную."
    }]
  },
  "трость-ветерана": {
    activities: [{
      key: "transform-cane", name: "Превратить трость", activation: "bonus", cost: null,
      chatFlavor: "Трость необратимо превращается в обычный длинный меч; замена предмета выполняется вручную."
    }]
  },
  "удобный-мешочек-специй-хеварда": {
    uses: { max: 10, recovery: "1d6 + 4" },
    activities: [{
      key: "season-food", name: "Приправить пищу", activation: "action", cost: 1,
      chatFlavor: "Добавьте выбранную безвредную приправу к одной порции еды."
    }]
  },
  "шляпа-волшебства": {
    activities: [{
      key: "attempt-wizard-cantrip", name: "Попытаться наложить заговор волшебника", activation: "action", cost: 1,
      uses: { max: 1, period: "lr" },
      chatFlavor: "Выберите неизвестный заговор волшебника и совершите проверку Интеллекта (Магия) Сл 10; заклинание и результат проверки применяются вручную."
    }]
  },
  "шляпа-вредителей": {
    uses: { max: 3 },
    activities: [{
      key: "summon-vermin", name: "Достать вредителя", activation: "action", cost: 1,
      chatFlavor: "Выберите допустимого вредителя и определите случайный результат призыва вручную."
    }]
  },
  "щит-экспрессии": {
    activities: [{
      key: "change-expression", name: "Изменить выражение щита", activation: "bonus", cost: null,
      chatFlavor: "Лицо на щите принимает выбранное выражение."
    }]
  },
  "взрывные-очки": {
    uses: { max: 3, recovery: "1d3" },
    activities: [{
      key: "blazing-ray", type: "save", name: "Пылающий луч", activation: "action", cost: 1,
      ability: "dex", dc: 15, damage: { number: 3, denomination: 6, types: ["fire"], onSave: "none" },
      chatFlavor: "Проклятие и ослепление владельца при натуральной 20 цели отслеживаются вручную."
    }]
  },
  "жезл-возмездия": {
    uses: { max: 3 },
    activities: [{
      key: "lightning-reprisal", type: "save", name: "Электрическое возмездие", activation: "reaction", cost: 1,
      ability: "dex", dc: 13, damage: { number: 2, denomination: 10, types: ["lightning"], onSave: "half" },
      condition: "После того как видимое в пределах 60 футов существо нанесло вам урон",
      chatFlavor: "Цель получает урон электричеством; при успешном спасброске урон уменьшается вдвое."
    }]
  },
  "доспех-грибковых-спор": {
    activities: [{
      key: "release-spores", type: "save", name: "Выпустить ядовитые споры", activation: "bonus", cost: 1,
      uses: { max: 1 }, ability: "con", dc: 15,
      chatFlavor: "При провале существо в 10-футовой сфере отравлено до конца вашего следующего хода; состояние применяется вручную."
    }]
  },
  "графин-бесконечной-воды": {
    activities: [{
      key: "geyser", type: "save", name: "Гейзер", activation: "bonus", cost: null,
      ability: "str", dc: 13, damage: { number: 1, denomination: 4, types: ["bludgeoning"], onSave: "none" },
      chatFlavor: "При провале цель получает 1к4 дробящего урона и сбивается с ног; поток воды и состояние применяются вручную."
    }]
  },
  "свирель-ужаса": {
    uses: { max: 3, recovery: "1d3" },
    activities: [{
      key: "frightful-tune", type: "save", name: "Жуткая мелодия", activation: "action", cost: 1,
      ability: "wis", dc: 15,
      chatFlavor: "Провалившие спасбросок существа испуганы на 1 минуту; повторные спасброски, союзники и иммунитет на 24 часа отслеживаются вручную."
    }]
  },
  "пирослияние": {
    activities: [{
      key: "pyroconverger-flame", type: "save", name: "Струя пламени", activation: "action", cost: null,
      ability: "dex", dc: 13, damage: { number: 4, denomination: 6, types: ["fire"], onSave: "half" },
      chatFlavor: "После атаки бросьте к10 и прибавьте число использований после продолжительного отдыха; неисправность при 11+ отслеживается вручную."
    }]
  },
  "порошок-сухости": {
    activities: [{
      key: "desiccate-water-elemental", type: "save", name: "Осушить водяного элементаля", activation: "action", cost: null,
      ability: "con", dc: 13, damage: { number: 10, denomination: 6, types: ["necrotic"], onSave: "half" },
      chatFlavor: "Действует только на водяного элементаля; случайное число щепоток и расход количества предмета отслеживаются вручную."
    }]
  },
  "порошок-чихания-и-удушья": {
    activities: [{
      key: "sneeze-and-choke", type: "save", name: "Чихание и удушье", activation: "action", cost: null,
      ability: "con", dc: 15,
      chatFlavor: "Провалившее спасбросок существо недееспособно и задыхается; повторные спасброски и состояния применяются вручную."
    }]
  },
  "татуировка-обвивающей-хватки": {
    activities: [{
      key: "grasping-tendrils", type: "save", name: "Хватательные усики", activation: "action", cost: null,
      ability: "str", dc: 14, damage: { number: 3, denomination: 6, types: ["force"], onSave: "none" },
      chatFlavor: "При провале цель получает урон и становится схваченной; поддержание и освобождение из захвата отслеживаются вручную."
    }]
  },
  "перчатки-ловли-снарядов": {
    activities: [{
      key: "catch-missile", name: "Поймать снаряд", activation: "reaction", cost: null,
      chatFlavor: "Уменьшите урон дальнобойной атаки оружием на 1к10 + модификатор Ловкости; условия свободной руки и итог атаки проверяются вручную."
    }]
  },
  "алхимический-сосуд": {
    activities: [{
      key: "produce-liquid", name: "Создать жидкость", activation: "action", cost: 1, uses: { max: 1 },
      chatFlavor: "Выберите одну жидкость и создайте указанное в описании количество; выбор и полученный запас фиксируются вручную."
    }]
  },
  "волшебный-горшочек-пельменей": {
    activities: [{
      key: "produce-dumplings", name: "Приготовить пельмени", activation: "action", cost: 1, uses: { max: 1 },
      chatFlavor: "Создайте пельмени согласно описанию; отдельные порции, лечение и срок хранения отслеживаются вручную."
    }]
  },
  "драгоценный-камень-баснописца": {
    activities: [
      {
        key: "create-coin", name: "Создать монету", activation: "action", cost: 1, uses: { max: 1 },
        chatFlavor: "Создайте одну немагическую монету; её добавление в инвентарь выполняется вручную."
      },
      {
        key: "change-fashion", name: "Изменить моду", activation: "bonus", cost: null,
        chatFlavor: "Измените внешний вид своей одежды согласно описанию камня."
      }
    ]
  },
  "неподвижный-жезл": {
    activities: [
      { key: "lock-rod", name: "Зафиксировать жезл", activation: "action", cost: null, chatFlavor: "Зафиксируйте жезл в пространстве." },
      { key: "unlock-rod", name: "Освободить жезл", activation: "action", cost: null, chatFlavor: "Освободите зафиксированный жезл." }
    ]
  },
  "кольцо-защиты-разума": {
    activities: [{
      key: "toggle-invisibility", name: "Сделать кольцо видимым или невидимым", activation: "action", cost: null,
      chatFlavor: "Измените видимость кольца; защита мыслей и хранение души работают по описанию."
    }]
  },
  "плащ-ската": {
    activities: [
      { key: "raise-manta-hood", name: "Поднять капюшон", activation: "action", cost: null, chatFlavor: "Поднимите капюшон; подводное дыхание и скорость плавания применяются вручную." },
      { key: "lower-manta-hood", name: "Опустить капюшон", activation: "action", cost: null, chatFlavor: "Опустите капюшон и окончите его подводные свойства." }
    ]
  },
  "шапка-подводного-дыхания": {
    activities: [
      { key: "create-air-bubble", name: "Создать воздушный пузырь", activation: "action", cost: null, chatFlavor: "Создайте вокруг головы воздушный пузырь для дыхания под водой." },
      { key: "dismiss-air-bubble", name: "Убрать воздушный пузырь", activation: "action", cost: null, chatFlavor: "Окончите действие воздушного пузыря." }
    ]
  },
  "шпионский-шепот": {
    activities: [{
      key: "share-hearing", name: "Поделиться слухом", activation: "bonus", cost: null,
      chatFlavor: "Выберите существо, которое будет слышать через предмет; связь и дистанция отслеживаются вручную."
    }]
  },
  "эмблема-стража": {
    uses: { max: 3 },
    activities: [{
      key: "negate-critical", name: "Отменить критическое попадание", activation: "reaction", cost: 1,
      chatFlavor: "Превратите критическое попадание по видимому существу в пределах 30 футов в обычное попадание."
    }]
  },
  "жезл-правления": {
    activities: [{
      key: "rule-creatures", type: "save", name: "Повелевать существами", activation: "action", cost: 1,
      uses: { max: 1 }, ability: "wis", dc: 15,
      chatFlavor: "Провалившие спасбросок существа очарованы на 8 часов; область, повторные спасброски и окончание эффекта отслеживаются вручную."
    }]
  },
  "булава-ужаса": {
    uses: { max: 3, recovery: "1d3" },
    activities: [{
      key: "wave-of-terror", type: "save", name: "Волна ужаса", activation: "action", cost: 1,
      ability: "wis", dc: 15,
      chatFlavor: "Провалившие спасбросок существа испуганы; область, повторные спасброски и перемещение отслеживаются вручную."
    }]
  },
  "кольцо-уклонения": {
    uses: { max: 3, recovery: "1d3" },
    activities: [{
      key: "turn-dex-save-success", name: "Уклониться", activation: "reaction", cost: 1,
      chatFlavor: "Превратите проваленный спасбросок Ловкости в успешный."
    }]
  },
  "колокольчик-открывания": {
    uses: { max: 10, noRecovery: true },
    activities: [{
      key: "open-lock", name: "Открыть замок", activation: "action", cost: 1,
      chatFlavor: "Откройте один замок, засов или запертую крышку в пределах 120 футов согласно описанию предмета."
    }]
  },
  "куб-силового-поля": {
    uses: { max: 36, recovery: "1d20" },
    activities: [
      { key: "force-face-1", name: "Грань 1: газы и неживое", activation: "action", cost: 1, chatFlavor: "Создайте барьер грани 1; перемещение и взаимодействия отслеживаются вручную." },
      { key: "force-face-2", name: "Грань 2: неживое", activation: "action", cost: 2, chatFlavor: "Создайте барьер грани 2; перемещение и взаимодействия отслеживаются вручную." },
      { key: "force-face-3", name: "Грань 3: живое", activation: "action", cost: 3, chatFlavor: "Создайте барьер грани 3; перемещение и взаимодействия отслеживаются вручную." },
      { key: "force-face-4", name: "Грань 4: заклинания", activation: "action", cost: 4, chatFlavor: "Создайте барьер грани 4; заклинания и эффекты отслеживаются вручную." },
      { key: "force-face-5", name: "Грань 5: всё", activation: "action", cost: 5, chatFlavor: "Создайте барьер грани 5; перемещение и взаимодействия отслеживаются вручную." },
      { key: "force-face-6", name: "Грань 6: отключить", activation: "action", cost: null, chatFlavor: "Отключите активную грань куба." }
    ]
  },
  "плащ-уклонения": {
    uses: { max: 7, recovery: "1d6 + 1" },
    activities: [{
      key: "cloak-dodge", name: "Уклонение плаща", activation: "bonus", cost: 1,
      chatFlavor: "Совершите действие Уклонение бонусным действием."
    }]
  },
  "рог-взрыва": {
    activities: [{
      key: "horn-blast", type: "save", name: "Взрыв рога", activation: "action", cost: null,
      ability: "con", dc: 15, damage: { number: 5, denomination: 6, types: ["thunder"], onSave: "half" },
      chatFlavor: "Хрупкие предметы, особый стеклянный вариант рога и риск его уничтожения отслеживаются вручную."
    }]
  },
  "метательное-копье-молнии": {
    activities: [{
      key: "lightning-line", type: "save", name: "Линия молнии", activation: "special", cost: 1,
      uses: { max: 1 }, ability: "dex", dc: 13,
      damage: { number: 4, denomination: 6, types: ["lightning"], onSave: "half" },
      condition: "При метательной атаке этим копьём",
      chatFlavor: "Обычная атака копьём и её урон выполняются отдельно; activity разрешает только однозначную линию молнии."
    }]
  },
  "посох-иссушения": {
    uses: { max: 3, recovery: "1d3" },
    activities: [{
      key: "withering-strike", type: "save", name: "Иссушающий удар", activation: "special", cost: 1,
      ability: "con", dc: 15, damage: { number: 2, denomination: 10, types: ["necrotic"], onSave: "none" },
      condition: "После попадания рукопашной атакой этим посохом",
      chatFlavor: "При провале цель также совершает с помехой проверки и спасброски Силы и Телосложения на 1 час; эффект применяется вручную."
    }]
  },
  "посох-очарования": {
    activities: [{
      key: "turn-charm-save-success", name: "Отвергнуть очарование", activation: "reaction", cost: 1,
      uses: { max: 1 },
      chatFlavor: "Превратите проваленный спасбросок против очарования в успешный; отражение заклинания определяется вручную."
    }]
  },
  "посох-роя-насекомых": {
    activities: [{
      key: "insect-cloud", name: "Облако насекомых", activation: "action", cost: 1,
      chatFlavor: "Создайте вокруг себя 30-футовое облако насекомых; помеха Восприятию, освещение и длительность отслеживаются вручную."
    }]
  },
  "заводные-доспехи": {
    uses: { max: 4, recovery: "1d4" },
    activities: [{
      key: "take-ten-on-d20", name: "Заводная определённость", activation: "special", cost: 1,
      chatFlavor: "Замените результат текущего броска к20 на 10 до определения результата."
    }]
  },
  "колода-измерений": {
    uses: { max: 6, recovery: "1d6" },
    activities: [
      { key: "dimensional-step", name: "Измерительный шаг", activation: "bonus", cost: 1, chatFlavor: "Телепортируйтесь согласно выбранной карте; пункт назначения и ограничения применяются вручную." },
      { key: "dimensional-rescue", name: "Измерительное спасение", activation: "reaction", cost: 1, chatFlavor: "Используйте защитное перемещение карты; цель и пункт назначения применяются вручную." }
    ]
  },
  "кольцо-дружелюбия": {
    activities: [{
      key: "ally-critical", name: "Подарить критическое попадание", activation: "reaction", cost: 1,
      uses: { max: 1 },
      chatFlavor: "Когда союзник в пределах действия попадает атакой, превратите попадание в критическое."
    }]
  },
  "кольцо-телекинеза": {
    activities: [{
      key: "telekinesis-objects-only", name: "Телекинез предметов", activation: "action", cost: null,
      chatFlavor: "Используйте только варианты заклинания «Телекинез» для предметов, которые никто не несёт и не носит; воздействие на существ недоступно."
    }]
  },
  "клубящийся-венок": {
    activities: [
      { key: "wreath-teleport", name: "Телепортироваться в туман", activation: "bonus", cost: null, chatFlavor: "Телепортируйтесь в видимое свободное пространство согласно описанию венка." },
      { key: "cloud-form", name: "Принять облачную форму", activation: "action", cost: 1, uses: { max: 1 }, chatFlavor: "Примите облачную форму; временные сопротивления, полёт и окончание формы применяются вручную." }
    ]
  },
  "мантия-сияющих-цветов": {
    uses: { max: 3, recovery: "1d3" },
    activities: [
      { key: "dazzling-colors", type: "save", name: "Ослепительные цвета", activation: "action", cost: 1, ability: "wis", dc: 15, chatFlavor: "Провалившие спасбросок существа ошеломлены до конца вашего следующего хода; состояние применяется вручную." },
      { key: "disadvantage-colors", type: "save", name: "Сбивающие цвета", activation: "action", cost: 1, ability: "wis", dc: 15, chatFlavor: "Провалившие спасбросок существа совершают атаки по вам с помехой; длительность и эффект применяются вручную." }
    ]
  },
  "маска-шута": {
    activities: [
      { key: "wondrous-escape", name: "Чудесный побег", activation: "reaction", cost: 1, uses: { max: 1 }, chatFlavor: "Отмените урон попавшей атаки и телепортируйтесь до 30 футов; позиция Token изменяется вручную." },
      { key: "invert-fate", name: "Перевернуть судьбу", activation: "special", cost: 1, uses: { max: 1 }, chatFlavor: "Замените натуральную 1 на текущем к20 на натуральную 20." }
    ]
  },
  "маяк-люксона": {
    activities: [{
      key: "grant-fragment", name: "Даровать частицу возможностей", activation: "minute", cost: 1,
      uses: { max: 1 },
      chatFlavor: "После 1 минуты концентрации цель получает частицу возможностей на 8 часов; её применение к броску отслеживается вручную."
    }]
  },
  "платиновый-шарф": {
    uses: { max: 3 },
    activities: [
      { key: "breath-of-life", name: "Чешуйка: дыхание жизни", activation: "action", cost: 1, chatFlavor: "Вы или существо, которого вы касаетесь, восстанавливает 10к4 хитов; лечение применяется вручную." },
      { key: "platinum-shield", name: "Чешуйка: платиновый щит", activation: "action", cost: 1, chatFlavor: "Создайте на 1 час щит +1 с иммунитетом к урону излучением; временный предмет создаётся вручную." },
      { key: "radiant-hammer", name: "Чешуйка: сияющий молот", activation: "action", cost: 1, chatFlavor: "Создайте на 1 час сияющий лёгкий молот; временный предмет создаётся вручную." }
    ]
  },
  "скарабей-защиты": {
    uses: { max: 12, noRecovery: true },
    activities: [{
      key: "turn-necromancy-save-success", name: "Защита скарабея", activation: "reaction", cost: 1,
      chatFlavor: "Превратите проваленный спасбросок от заклинания Некромантии или вредоносного эффекта нежити в успешный; уничтожьте скарабея после последнего заряда вручную."
    }]
  },
  "доспех-неуязвимости": {
    activities: [{
      key: "nonmagical-immunity", name: "Иммунитет к немагическому урону", activation: "action", cost: 1,
      uses: { max: 1 },
      chatFlavor: "Получите иммунитет к немагическому урону на 10 минут или до снятия доспеха; временный эффект применяется вручную."
    }]
  },
  "латный-доспех-эфирности": {
    activities: [{
      key: "ten-minute-etherealness", name: "Эфирность доспеха", activation: "action", cost: 1,
      uses: { max: 1 },
      chatFlavor: "Получите эффект «Эфирности» ровно на 10 минут либо до снятия доспеха или повторного командного слова; состояние применяется вручную."
    }]
  },
  "жезл-величественной-мощи": {
    activities: [
      { key: "life-drain", type: "save", name: "Вытягивание жизни", activation: "special", cost: 1, uses: { max: 1 }, ability: "con", dc: 17, damage: { number: 4, denomination: 6, types: ["necrotic"], onSave: "none" }, condition: "После попадания рукопашной атакой этим жезлом", chatFlavor: "При провале нанесите урон и восстановите половину нанесённого некротического урона; лечение применяется вручную." },
      { key: "paralyzing-strike", type: "save", name: "Паралич", activation: "special", cost: 1, uses: { max: 1 }, ability: "str", dc: 17, condition: "После попадания рукопашной атакой этим жезлом", chatFlavor: "При провале цель парализована на 1 минуту; повторные спасброски и состояние применяются вручную." },
      { key: "frightening-rod", type: "save", name: "Испуг", activation: "action", cost: 1, uses: { max: 1 }, ability: "wis", dc: 17, chatFlavor: "Провалившие спасбросок существа испуганы на 1 минуту; область, повторные спасброски и состояния применяются вручную." }
    ]
  },
  "кольцо-невидимости": {
    activities: [
      { key: "become-invisible", name: "Стать невидимым", activation: "action", cost: null, chatFlavor: "Станьте невидимым; состояние, атаки и заклинания отслеживаются вручную." },
      { key: "become-visible", name: "Стать видимым", activation: "bonus", cost: null, chatFlavor: "Окончите невидимость кольца." }
    ]
  },
  "веретено-судьбы": {
    uses: { max: 6, recovery: "1d6" },
    activities: [
      { key: "battle-foresight", name: "Предвидение битвы", activation: "special", cost: 1, chatFlavor: "Добавьте или вычтите бонус мастерства из текущего броска инициативы." },
      { key: "foretold-end", name: "Предсказанный конец", activation: "action", cost: 2, chatFlavor: "Отметьте цель на 1 час; направление, движение и дополнительный урон 1к6 отслеживаются вручную." },
      { key: "twist-fate", name: "Поворот судьбы", activation: "reaction", cost: 3, chatFlavor: "Превратите попадание в промах, промах в попадание либо проваленный спасбросок в успешный." }
    ]
  },
  "покров-вредителей": {
    activities: [{
      key: "vermin-bite", type: "save", name: "Укус вредителя", activation: "bonus", cost: null,
      ability: "con", dc: 17,
      chatFlavor: "После попадания природным оружием цель при провале отравлена на 1 минуту; доступность возвышенного состояния и повторные спасброски отслеживаются вручную."
    }]
  },
  "жезл-бдительности": {
    activities: [{
      key: "protective-aura", name: "Защитная аура", activation: "action", cost: 1,
      uses: { max: 1 },
      chatFlavor: "Воткните жезл в землю и создайте на 10 минут защитную ауру; свет, союзные +1 КД/спасброски и обнаружение невидимых применяются вручную."
    }]
  },
  "жезл-бдительности-2": {
    activities: [{
      key: "protective-aura", name: "Защитная аура", activation: "action", cost: 1,
      uses: { max: 1 },
      chatFlavor: "Воткните жезл в землю и создайте на 10 минут защитную ауру; свет, союзные +1 КД/спасброски и обнаружение невидимых применяются вручную."
    }]
  },
  "кираса-баланса": {
    activities: [{
      key: "cancel-advantage-disadvantage", name: "Уравнять бросок", activation: "reaction", cost: 1,
      chatFlavor: "Уберите преимущество или помеху у выбранного броска к20 до его совершения."
    }]
  },
  "клинок-удачи": {
    activities: [{
      key: "luck-reroll", name: "Удача клинка", activation: "special", cost: 1,
      uses: { max: 1 },
      chatFlavor: "Перебросьте один свой бросок атаки, проверку характеристики или спасбросок и используйте второй результат."
    }]
  },
  "мантия-мистраля": {
    activities: [{
      key: "mistral-wind", type: "save", name: "Удар холодного ветра", activation: "special", cost: null,
      ability: "dex", dc: 14, damage: { number: 1, denomination: 6, types: ["cold"], onSave: "none" },
      condition: "Когда вы впервые в ход проходите в пределах 5 футов от существа",
      chatFlavor: "При провале цель также падает ничком; ограничение один раз за ход и prone применяются вручную."
    }]
  },
  "посох-ослепляющий-небеса": {
    activities: [{
      key: "sky-blinding-flash", type: "save", name: "Ослепляющая вспышка", activation: "reaction", cost: null,
      ability: "con", dc: 15,
      condition: "Когда видимое летающее существо в пределах 30 футов атакует вас",
      chatFlavor: "Атака совершается с помехой; при провале цель ослеплена до начала своего следующего хода. Помеха и состояние применяются вручную."
    }]
  },
  "эгида-эвриаллы": {
    activities: [{
      key: "petrifying-heraldry", type: "save", name: "Окаменевшая геральдика", activation: "bonus", cost: 1,
      uses: { max: 1 }, ability: "con", dc: 20,
      chatFlavor: "При провале цель опутана и повторяет спасбросок в начале следующего хода; окаменение на 24 часа и оба состояния применяются вручную."
    }]
  },
  "мантия-звезд": {
    activities: [
      { key: "enter-astral-plane", name: "Перейти на Астральный План", activation: "action", cost: null, chatFlavor: "Перейдите на Астральный План; положение и переносимые предметы отслеживаются вручную." },
      { key: "leave-astral-plane", name: "Вернуться с Астрального Плана", activation: "action", cost: null, chatFlavor: "Вернитесь в прежнее или ближайшее свободное пространство; Token перемещается вручную." }
    ]
  },
  "мантия-плута": {
    activities: [{
      key: "shadow-step", name: "Движение в тенях", activation: "bonus", cost: null,
      chatFlavor: "Телепортируйтесь на 30 футов между тускло освещёнными или тёмными пространствами; Token и преимущество первой рукопашной атаки применяются вручную."
    }]
  },
  "волшебная-палочка-секретов": {
    uses: { max: 3, recovery: "1d3" },
    activities: [{
      key: "detect-secret", name: "Обнаружить ближайший секрет", activation: "action", cost: 1,
      chatFlavor: "Определите направление к ближайшей потайной двери или ловушке в пределах 30 футов; наличие подходящей цели проверяет Мастер."
    }]
  },
  "вечнодымящаяся-бутылка": {
    activities: [
      { key: "open-bottle", name: "Открыть бутылку", activation: "action", cost: null, chatFlavor: "Откройте бутылку и создайте облако дыма; радиус, ветер и заслонение отслеживаются вручную." },
      { key: "close-bottle", name: "Закрыть бутылку", activation: "action", cost: null, chatFlavor: "Произнесите командное слово и закройте бутылку; рассеивание дыма отслеживается вручную." }
    ]
  },
  "татуировка-жутких-когтей": {
    uses: { max: 1 },
    activities: [{
      key: "eldritch-maul", name: "Жуткие удары", activation: "bonus", cost: 1,
      chatFlavor: "На 1 минуту активируйте досягаемость 15 футов и дополнительный 1к6 урона силовым полем; изменения конкретных атак применяются вручную."
    }]
  },
  "свирель-канализации": {
    uses: { max: 3, recovery: "1d3" },
    activities: [1, 2, 3].map((cost) => ({
      key: `summon-rat-swarms-${cost}`,
      name: `Призвать рои крыс (${cost})`,
      activation: "bonus",
      cost,
      chatFlavor: `Призовите ${cost} ${cost === 1 ? "рой" : "роя"} крыс, если Мастер подтверждает их наличие в пределах полумили; Token и контроль остаются ручными.`
    }))
  },
  "волшебная-палочка-обнаружения-врагов": {
    uses: { max: 7, recovery: "1d6 + 1" },
    activities: [{
      key: "detect-enemy", name: "Обнаружить ближайшего врага", activation: "action", cost: 1,
      chatFlavor: "На 1 минуту определяйте направление к ближайшему враждебному существу в пределах 60 футов; выбор существа и удержание палочки проверяются вручную."
    }]
  },
  "волшебная-палочка-паралича": {
    uses: { max: 7, recovery: "1d6 + 1" },
    activities: [{
      key: "paralyzing-ray", type: "save", name: "Парализующий луч", activation: "action", cost: 1,
      ability: "con", dc: 15,
      chatFlavor: "При провале цель парализована на 1 минуту и повторяет спасбросок в конце каждого своего хода; состояние и повторы применяются вручную."
    }]
  },
  "волшебная-палочка-страха": {
    activities: [{
      key: "fear-cone", type: "save", name: "Конус страха", activation: "action", cost: 2,
      ability: "wis", dc: 15,
      chatFlavor: "Существа в 60-футовом конусе при провале испуганы на 1 минуту; область, вынужденное перемещение, ограничения действий и повторные спасброски применяются вручную."
    }]
  },
  "камень-сияния": {
    uses: { max: 50, noRecovery: true },
    activities: [
      { key: "toggle-light", name: "Включить или выключить свет", activation: "action", cost: null, chatFlavor: "Переключите яркий и тусклый свет 30/30 футов; Token light изменяется вручную." },
      { key: "blinding-ray", type: "save", name: "Ослепляющий луч", activation: "action", cost: 1, ability: "con", dc: 15, chatFlavor: "При провале цель ослеплена на 1 минуту и повторяет спасбросок в конце каждого хода; состояние применяется вручную." },
      { key: "blinding-cone", type: "save", name: "Ослепляющий конус", activation: "action", cost: 5, ability: "con", dc: 15, chatFlavor: "Все существа в 30-футовом конусе совершают спасбросок; область, ослепление и повторные спасброски применяются вручную." }
    ]
  },
  "крылья-полета": {
    activities: [
      { key: "deploy-wings", name: "Развернуть крылья", activation: "action", cost: null, chatFlavor: "На 1 час получите скорость полёта 60 футов; movement Token и момент окончания отслеживаются вручную." },
      { key: "dismiss-wings", name: "Убрать крылья", activation: "action", cost: null, chatFlavor: "Досрочно уберите крылья; перезарядка 1к12 часов отслеживается вручную." }
    ]
  },
  "солнечный-клинок": {
    activities: [
      { key: "toggle-sun-blade", name: "Проявить или скрыть клинок", activation: "bonus", cost: null, chatFlavor: "Переключите сияющий клинок; finesse, тип урона и дополнительный урон нежити применяются в карточке атаки вручную." },
      { key: "adjust-sunlight", name: "Изменить радиус света", activation: "action", cost: null, chatFlavor: "Увеличьте или уменьшите яркий и тусклый солнечный свет на 5 футов в пределах 10–30 футов; Token light изменяется вручную." }
    ]
  },
  "язык-пламени": {
    activities: [{
      key: "toggle-flame-tongue", name: "Зажечь или погасить клинок", activation: "bonus", cost: null,
      chatFlavor: "Переключите пламя и свет меча; дополнительные 2к6 урона огнём добавляются к попаданиям вручную только пока клинок горит."
    }]
  },
  "плащ-невидимости": {
    uses: { max: 120, noRecovery: true },
    activities: [
      { key: "raise-hood", name: "Надеть капюшон", activation: "action", cost: null, chatFlavor: "Наденьте капюшон и станьте невидимым; состояние применяется вручную." },
      { key: "lower-hood", name: "Снять капюшон", activation: "action", cost: null, chatFlavor: "Снимите капюшон и окончите невидимость; состояние снимается вручную." },
      { key: "spend-invisibility-minute", name: "Израсходовать минуту невидимости", activation: "special", cost: 1, chatFlavor: "Отметьте одну накопленную минуту невидимости. Восстановление 60 минут за каждые 12 часов простоя выполняется вручную." }
    ]
  },
  "сапоги-скорости": {
    uses: { max: 10, period: "lr" },
    activities: [
      { key: "toggle-speed-boots", name: "Щёлкнуть каблуками", activation: "bonus", cost: null, chatFlavor: "Включите или выключите удвоение скорости ходьбы и помеху провоцированным атакам; эффекты применяются вручную." },
      { key: "spend-speed-minute", name: "Израсходовать минуту скорости", activation: "special", cost: 1, chatFlavor: "Отметьте одну минуту суммарной работы сапог. Все 10 минут восстанавливаются после продолжительного отдыха." }
    ]
  },
  "татуировка-поглощения": {
    uses: { max: 1 },
    activities: [{
      key: "absorb-damage", name: "Поглотить выбранный урон", activation: "reaction", cost: 1,
      chatFlavor: "Получите иммунитет к выбранному при создании татуировки типу текущего урона и восстановите половину предотвращённого урона; тип и лечение применяются вручную."
    }]
  },
  "татуировка-призрачных-шагов": {
    uses: { max: 3 },
    activities: [{
      key: "ghostly-form", name: "Призрачная форма", activation: "bonus", cost: 1,
      chatFlavor: "До конца следующего хода активируйте призрачную форму; сопротивления, запрет захвата и проход через объекты применяются вручную."
    }]
  },
  "железная-фляга": {
    activities: [
      { key: "imprison-outsider", type: "save", name: "Заточить существо", activation: "action", cost: null, ability: "wis", dc: 17, chatFlavor: "Внепланарная цель при провале заточена; происхождение, преимущество повторно заточённой цели и состояние фляги отслеживаются вручную." },
      { key: "release-creature", name: "Выпустить существо", activation: "action", cost: null, chatFlavor: "Выпустите заточённое существо; дружественность, команды и часовая длительность отслеживаются вручную." }
    ]
  },
  "кольцо-призыва-джинна": {
    uses: { max: 1, noRecovery: true },
    activities: [{
      key: "summon-djinni", name: "Призвать джинна", activation: "action", cost: 1,
      chatFlavor: "Призовите связанного джинна в пределах 120 футов на время концентрации, максимум на 1 час; Token, команды и восстановление через 24 часа отслеживаются вручную."
    }]
  },
  "щит-пылающего-дредноута": {
    uses: { max: 1 },
    activities: [
      { key: "activate-burning-shield", name: "Активировать щит", activation: "bonus", cost: 1, chatFlavor: "Активируйте щит на 1 минуту; временный иммунитет к огню и доступность остальных свойств применяются вручную." },
      { key: "cleansing-fire", name: "Очищающий огонь", activation: "action", cost: null, chatFlavor: "Окончите у видимой цели в пределах 30 футов одну болезнь либо состояние blinded, charmed, deafened или poisoned; выбор удаляется вручную." },
      { key: "shield-strike", type: "save", name: "Удар щитом", activation: "special", cost: null, ability: "str", dc: "8 + @prof + @abilities.str.mod", chatFlavor: "Замените одну атаку: при провале цель получает 3к6 дробящего и 3к6 огненного урона и падает ничком, при успехе — половину урона; урон и prone применяются вручную." }
    ]
  }
};

for (const itemId of ["амулет-благочестия-2", "амулет-благочестия-3"]) {
  MAGIC_ITEM_UTILITY_DEFINITIONS[itemId] = {
    uses: { max: 1 },
    activities: [{
      key: "free-channel-divinity",
      name: "Божественный канал без расхода",
      activation: "special",
      cost: 1,
      chatFlavor: "Используйте Божественный канал без расхода его actor-resource."
    }]
  };
}

for (const itemId of ["барабан-задающего-ритм-2", "барабан-задающего-ритм-3"]) {
  MAGIC_ITEM_UTILITY_DEFINITIONS[itemId] = {
    uses: { max: 1 },
    activities: [{
      key: "restore-bardic-inspiration",
      name: "Восстановить Бардовское вдохновение",
      activation: "action",
      cost: 1,
      chatFlavor: "Восстановите одну израсходованную кость Бардовского вдохновения."
    }]
  };
}

for (const itemId of ["универсальный-инструмент-2", "универсальный-инструмент-3"]) {
  MAGIC_ITEM_UTILITY_DEFINITIONS[itemId] = {
    uses: { max: 1 },
    activities: [
      {
        key: "transform-tool",
        name: "Изменить форму инструмента",
        activation: "action",
        cost: null,
        chatFlavor: "Выберите форму одного вида инструментов ремесленника."
      },
      {
        key: "choose-cantrip",
        name: "Выбрать заговор",
        activation: "action",
        cost: 1,
        chatFlavor: "Выберите неизвестный заговор из списка любого класса; в течение 8 часов он считается для вас заговором изобретателя."
      }
    ]
  };
}

for (const itemId of [
  "жезл-хранителя-договора-1",
  "жезл-хранителя-договора-2",
  "жезл-хранителя-договора-3"
]) {
  MAGIC_ITEM_UTILITY_DEFINITIONS[itemId] = {
    uses: { max: 1, period: "lr" },
    activities: [{
      key: "restore-warlock-slot",
      name: "Восстановить ячейку колдуна",
      activation: "action",
      cost: 1,
      chatFlavor: "Восстановите одну израсходованную ячейку заклинания колдуна; выбор actor-resource выполняется вручную."
    }]
  };
}
const MODULE_ICONS_BASE_PATH = `modules/${MODULE_ID}/templates/icons`;
const MAGIC_ICON_SEARCH_PATHS = [`${MODULE_ICONS_BASE_PATH}/Magic Items`, MODULE_ICONS_BASE_PATH];
const BELLMAN_POWER_ITEM_NAME = "Жемчужина силы";
const HOARDING_POUCH_ITEM_NAME = "Сумка хранения";
const WATCHER_SHIELD_ITEM_NAME = "Щит часового";
const RING_BONUS_ITEM_PREFIX = "Кольцо характеристики";
const RING_BONUS_VARIANTS = [
  { id: "легендарное", bonus: 2, maxAbilityScore: 26 },
  { id: "необычное", bonus: 2, maxAbilityScore: 12 },
  { id: "очень редкое", bonus: 2, maxAbilityScore: 20 },
  { id: "редкое", bonus: 1, maxAbilityScore: 16 },
  { id: "обычное", bonus: 1, maxAbilityScore: 10 }
];
const RING_BONUS_VARIANTS_NORMALIZED = RING_BONUS_VARIANTS
  .map((entry) => ({ ...entry, normalizedId: normalizeMatchText(entry.id) }));
const PASSIVE_MAGIC_ITEM_CHANGE_DEFINITIONS = new Map([
  ["амулет-благочестия-1", {
    suffix: "devout-spellcasting",
    label: "Благочестие",
    changes: [
      { key: "system.bonuses.msak.attack", mode: EFFECT_MODE_ADD, value: "+1", priority: 20 },
      { key: "system.bonuses.rsak.attack", mode: EFFECT_MODE_ADD, value: "+1", priority: 20 },
      { key: "system.bonuses.spell.dc", mode: EFFECT_MODE_ADD, value: "+1", priority: 20 }
    ]
  }],
  ["барабан-задающего-ритм-1", {
    suffix: "rhythm-maker-spellcasting",
    label: "Ритм заклинаний",
    changes: [
      { key: "system.bonuses.msak.attack", mode: EFFECT_MODE_ADD, value: "+1", priority: 20 },
      { key: "system.bonuses.rsak.attack", mode: EFFECT_MODE_ADD, value: "+1", priority: 20 },
      { key: "system.bonuses.spell.dc", mode: EFFECT_MODE_ADD, value: "+1", priority: 20 }
    ]
  }],
  ["лунный-серп-1", {
    suffix: "moon-sickle-spellcasting",
    label: "Лунная магия",
    changes: [
      { key: "system.bonuses.msak.attack", mode: EFFECT_MODE_ADD, value: "+1", priority: 20 },
      { key: "system.bonuses.rsak.attack", mode: EFFECT_MODE_ADD, value: "+1", priority: 20 },
      { key: "system.bonuses.spell.dc", mode: EFFECT_MODE_ADD, value: "+1", priority: 20 }
    ]
  }],
  ["универсальный-инструмент-1", {
    suffix: "all-purpose-tool-spellcasting",
    label: "Универсальная магия",
    changes: [
      { key: "system.bonuses.msak.attack", mode: EFFECT_MODE_ADD, value: "+1", priority: 20 },
      { key: "system.bonuses.rsak.attack", mode: EFFECT_MODE_ADD, value: "+1", priority: 20 },
      { key: "system.bonuses.spell.dc", mode: EFFECT_MODE_ADD, value: "+1", priority: 20 }
    ]
  }],
  ["обруч-заклинателя-2", {
    suffix: "spellcaster-circlet-arcana",
    label: "Знание магии",
    changes: [
      { key: "system.skills.arc.bonuses.check", mode: EFFECT_MODE_ADD, value: "+2", priority: 20 }
    ]
  }],
  ["пояс-атлета-1", {
    suffix: "athlete-belt-athletics",
    label: "Атлетизм",
    changes: [
      { key: "system.skills.ath.bonuses.check", mode: EFFECT_MODE_ADD, value: "+1", priority: 20 }
    ]
  }],
  ["камень-удачи", {
    suffix: "luck-stone",
    label: "Удача",
    changes: [
      { key: "system.bonuses.abilities.check", mode: EFFECT_MODE_ADD, value: "+1", priority: 20 },
      { key: "system.bonuses.abilities.save", mode: EFFECT_MODE_ADD, value: "+1", priority: 20 }
    ]
  }],
  ["пояс-силы-холмового-великана", {
    suffix: "hill-giant-strength",
    label: "Сила холмового великана",
    changes: [
      { key: "system.abilities.str.value", mode: EFFECT_MODE_ADD, value: "+3", priority: 20 },
      { key: "system.abilities.str.max", mode: EFFECT_MODE_UPGRADE, value: "21", priority: 20 }
    ]
  }],
  ["очки-орлиного-зрения", {
    suffix: "eagle-eyes-perception",
    label: "Орлиное зрение",
    changes: [
      { key: "flags.midi-qol.advantage.skill.prc", mode: EFFECT_MODE_CUSTOM, value: "1", priority: 20 }
    ]
  }]
]);
const SKILL_BONUS_MAGIC_ITEM_FAMILIES = new Map([
  ["амулет-натуралиста", ["nat", "Природа"]],
  ["брошь-дипломата", ["per", "Убеждение"]],
  ["линзы-сыщика", ["inv", "Расследование"]],
  ["маска-лжеца", ["dec", "Обман"]],
  ["медальон-религиозности", ["rel", "Религия"]],
  ["обруч-заклинателя", ["arc", "Магия"]],
  ["очки-летописца", ["his", "История"]],
  ["очки-наблюдателя", ["prc", "Восприятие"]],
  ["очки-проницательности", ["ins", "Проницательность"]],
  ["перчатки-виртуоза", ["prf", "Выступление"]],
  ["перчатки-лекаря", ["med", "Медицина"]],
  ["перчатки-ловкача", ["slt", "Ловкость рук"]],
  ["перчатки-укротителя", ["ani", "Уход за животными"]],
  ["плащ-лазутчика", ["ste", "Скрытность"]],
  ["пояс-атлета", ["ath", "Атлетика"]],
  ["сапоги-акробата", ["acr", "Акробатика"]],
  ["сапоги-следопыта", ["sur", "Выживание"]],
  ["угрожающий-амулет", ["itm", "Запугивание"]]
]);
for (const [family, [skillId, label]] of SKILL_BONUS_MAGIC_ITEM_FAMILIES) {
  for (const bonus of [1, 2, 3]) {
    PASSIVE_MAGIC_ITEM_CHANGE_DEFINITIONS.set(`${family}-${bonus}`, {
      suffix: `${skillId}-skill-${bonus}`,
      label,
      changes: [{
        key: `system.skills.${skillId}.bonuses.check`,
        mode: EFFECT_MODE_ADD,
        value: `+${bonus}`,
        priority: 20
      }]
    });
  }
}

function spellcastingChanges(bonus, { dc = true } = {}) {
  return [
    { key: "system.bonuses.msak.attack", mode: EFFECT_MODE_ADD, value: `+${bonus}`, priority: 20 },
    { key: "system.bonuses.rsak.attack", mode: EFFECT_MODE_ADD, value: `+${bonus}`, priority: 20 },
    ...(dc ? [{ key: "system.bonuses.spell.dc", mode: EFFECT_MODE_ADD, value: `+${bonus}`, priority: 20 }] : [])
  ];
}

function effectChange(key, value, mode = EFFECT_MODE_ADD) {
  return { key, mode, value, priority: 20 };
}

function flatPassive(suffix, label, key, value, partial = false, mode = EFFECT_MODE_ADD) {
  return {
    suffix,
    label,
    partial,
    changes: [effectChange(key, value, mode)]
  };
}

function abilityIncrease(ability, bonus, maximum, suffix, partial = false) {
  return {
    suffix,
    label: "Повышение характеристики",
    partial,
    changes: [
      effectChange(`system.abilities.${ability}.value`, `+${bonus}`),
      effectChange(`system.abilities.${ability}.max`, String(maximum), EFFECT_MODE_UPGRADE)
    ]
  };
}

function traitChange(trait, value) {
  return effectChange(`system.traits.${trait}.value`, value);
}

function traitPassive(suffix, label, trait, values, partial = false) {
  return {
    suffix,
    label,
    partial,
    changes: values.map((value) => traitChange(trait, value))
  };
}

for (const [family, options] of [
  ["волшебная-палочка-боевого-мага", { dc: false, partial: true }]
]) {
  for (const bonus of [1, 2, 3]) {
    PASSIVE_MAGIC_ITEM_CHANGE_DEFINITIONS.set(`${family}-${bonus}`, {
      suffix: `${family}-spellcasting-${bonus}`,
      label: "Магия предмета",
      partial: options.partial,
      changes: spellcastingChanges(bonus, { dc: options.dc })
    });
  }
}

for (const family of [
  "амулет-благочестия",
  "барабан-задающего-ритм",
  "лунный-серп",
  "универсальный-инструмент",
  "жезл-хранителя-договора"
]) {
  for (const bonus of [1, 2, 3]) {
    PASSIVE_MAGIC_ITEM_CHANGE_DEFINITIONS.delete(`${family}-${bonus}`);
  }
}

for (const bonus of [1, 2, 3]) {
  PASSIVE_MAGIC_ITEM_CHANGE_DEFINITIONS.set(`кольцо-защиты-${bonus}`,
    flatPassive(`protection-ring-ac-${bonus}`, "Защита", "system.attributes.ac.bonus", `+${bonus}`));
}

for (const [id, definition] of new Map([
  ["амулет-здоровья", {
    suffix: "constitution",
    label: "Здоровье",
    changes: [
      { key: "system.abilities.con.value", mode: EFFECT_MODE_ADD, value: "+4", priority: 20 },
      { key: "system.abilities.con.max", mode: EFFECT_MODE_UPGRADE, value: "19", priority: 20 }
    ]
  }],
  ["сапоги-странника", {
    suffix: "traveler",
    label: "Странник",
    changes: [
      { key: "system.attributes.movement.walk", mode: EFFECT_MODE_ADD, value: "+10", priority: 20 },
      { key: "system.skills.sur.roll.mode", mode: EFFECT_MODE_ADD, value: "1", priority: 20 }
    ]
  }],
  ["брошь-защиты", {
    suffix: "force-resistance",
    label: "Защита от силового поля",
    partial: true,
    changes: [{ key: "system.traits.dr.value", mode: EFFECT_MODE_ADD, value: "force", priority: 20 }]
  }],
  ["татуировка-с-клеймом-царства-теней", {
    suffix: "shadow-realm",
    label: "Царство Теней",
    changes: [
      { key: "system.attributes.senses.darkvision", mode: EFFECT_MODE_UPGRADE, value: "60", priority: 20 },
      { key: "system.skills.ste.roll.mode", mode: EFFECT_MODE_ADD, value: "1", priority: 20 }
    ]
  }],
  ["жезл-бдительности", {
    suffix: "vigilance",
    label: "Бдительность",
    partial: true,
    changes: [
      { key: "system.attributes.init.roll.mode", mode: EFFECT_MODE_ADD, value: "1", priority: 20 },
      { key: "system.skills.prc.roll.mode", mode: EFFECT_MODE_ADD, value: "1", priority: 20 }
    ]
  }],
  ["жезл-бдительности-2", {
    suffix: "vigilance",
    label: "Бдительность",
    partial: true,
    changes: [
      { key: "system.attributes.init.roll.mode", mode: EFFECT_MODE_ADD, value: "1", priority: 20 },
      { key: "system.skills.prc.roll.mode", mode: EFFECT_MODE_ADD, value: "1", priority: 20 }
    ]
  }]
])) {
  PASSIVE_MAGIC_ITEM_CHANGE_DEFINITIONS.set(id, definition);
}

const NATIVE_MAGIC_ITEM_BONUSES = new Map([
  ["оружие-1", 1], ["оружие-2", 2], ["оружие-3", 3],
  ["доспех-1", 1], ["доспех-2", 2], ["доспех-3", 3],
  ["щит-1", 1], ["щит-2", 2], ["щит-3", 3],
  ["боевая-кирка-камнетворца", 1], ["булава-кары", 1], ["волна", 3],
  ["вор-девяти-жизней", 2], ["дварфийский-метатель", 3], ["двуручный-серебряный-меч", 3],
  ["демонический-доспех", 1], ["длинный-лук-исцеляющего-очага", 3], ["охотничье-пальто", 1],
  ["доспех-из-драконьей-чешуи", 1], ["доспех-истовости-3", 1],
  ["доспех-последней-битвы", 1], ["драконье-копье", 3], ["живой-доспех", 1],
  ["защитник", 3], ["зловещий-коготь", 1], ["игла-починки", 1], ["кинжал-яда", 1],
  ["клинок-ахерона", 1], ["клинок-удачи", 1], ["кольчуга-ифритов", 3],
  ["красивый-проклепанный-кожаный-доспех", 1], ["крик-жнеца", 2], ["кровавый-топор", 2],
  ["латы-дварфов", 2], ["ледяной-кинжал", 2], ["меч-головоруб", 3], ["меч-мести", 1],
  ["меч-ответа", 3], ["меч-отцов", 1], ["меч-плановых-измерений", 3], ["молот-грома", 1],
  ["молот-рунного-фокуса", 3], ["оружие-драконьего-гнева-восходящий", 1],
  ["оружие-драконьего-гнева-пробуждающийся", 1], ["оружие-драконьего-гнева-пробужденный", 1],
  ["оружие-повеления-трона", 1], ["оружие-разрушения-силы", 2],
  ["охраняющий-доспех-1", 2], ["охраняющий-доспех-2", 3], ["последний-рассвет", 2],
  ["праща-двух-зайцев", 1], ["разрушающий-цеп", 1], ["ритуальный-нож-ракдосов", 1],
  ["сверкающий-лунный-лук", 1], ["святой-мститель", 3], ["секира-кровавой-ярости", 2],
  ["сокрушитель", 3], ["солнечный-молот", 2], ["таранный-щит", 1],
  ["топор-берсерка", 1], ["трезубец-зова-приливов", 2], ["убийца-великанов", 1],
  ["убийца-драконов", 1], ["убийца-мертвецов", 1], ["хватающий-кнут", 1],
  ["цеп-тиамат", 3], ["черный-клинок", 3], ["щит-черепахи", 1],
  ["эльфийская-кольчуга", 1], ["эльфийский-метатель", 3],
  ["посох-грома-и-молнии", 2], ["посох-корневых-холмов", 1], ["посох-леса", 2],
  ["посох-ослепляющий-небеса", 1],
  ["посох-магов", 2], ["посох-силы", 2], ["посох-ударов", 3], ["солнечный-посох", 1],
  ["непенте", 3], ["солнечный-клинок", 2],
  ["лунный-серп-1", 1], ["лунный-серп-2", 2], ["лунный-серп-3", 3]
]);
const NON_CONSUMABLE_MAGIC_ITEM_IDS = new Set(["доспех-последней-битвы"]);
const MAGIC_STAFF_WEAPON_IDS = new Set([
  "посох-грома-и-молнии",
  "посох-корневых-холмов",
  "посох-леса",
  "посох-ослепляющий-небеса",
  "посох-магов",
  "посох-ударов",
  "солнечный-посох"
]);

for (const [id, definition] of new Map([
  ["адамантитовый-щит", flatPassive("saving-throws-1", "Спасброски", "system.bonuses.abilities.save", "+1")],
  ["доспех-истовости-1", flatPassive("saving-throws-2", "Спасброски", "system.bonuses.abilities.save", "+2")],
  ["доспех-истовости-2", flatPassive("saving-throws-3", "Спасброски", "system.bonuses.abilities.save", "+3")],
  ["доспех-истовости-3", flatPassive("guarding-saves-1", "Охрана", "system.bonuses.abilities.save", "+1")],
  ["охраняющий-доспех-1", flatPassive("guarding-saves-2", "Охрана", "system.bonuses.abilities.save", "+2")],
  ["охраняющий-доспех-2", flatPassive("guarding-saves-3", "Охрана", "system.bonuses.abilities.save", "+3")],
  ["клинок-удачи", flatPassive("luck-save", "Удача", "system.bonuses.abilities.save", "+1", true)],
  ["мантия-звезд", flatPassive("star-save", "Звёздная защита", "system.bonuses.abilities.save", "+1", true)],
  ["укус-харкона", {
    suffix: "harkon-luck", label: "Удача Харкона", partial: true, changes: [
      effectChange("system.bonuses.abilities.check", "+1"),
      effectChange("system.bonuses.abilities.save", "+1")
    ]
  }],
  ["великая-повязка-интеллекта", abilityIncrease("int", 3, 25, "great-intellect")],
  ["повязка-интеллекта", abilityIncrease("int", 3, 19, "intellect")],
  ["пояс-силы-громового-великана", abilityIncrease("str", 7, 29, "storm-giant-strength")],
  ["пояс-силы-каменного-великана", abilityIncrease("str", 4, 23, "stone-giant-strength")],
  ["пояс-силы-облачного-великана", abilityIncrease("str", 7, 27, "cloud-giant-strength")],
  ["пояс-силы-огненного-великана", abilityIncrease("str", 5, 25, "fire-giant-strength")],
  ["рукавицы-силы-огра", abilityIncrease("str", 4, 16, "ogre-strength")],
  ["пояс-дварфов", abilityIncrease("con", 2, 20, "dwarven-constitution", true)],
  ["сфера-вуали", {
    suffix: "veil-sphere", label: "Сфера вуали", partial: true, changes: [
      effectChange("system.abilities.wis.value", "+2"),
      effectChange("system.abilities.wis.max", "+2"),
      effectChange("system.attributes.senses.darkvision", "+60")
    ]
  }],
  ["амулет-молниеносного-движения", flatPassive("lightning-movement", "Молниеносное движение", "system.attributes.movement.walk", "+15", true)],
  ["кольцо-плавания", flatPassive("swimming", "Плавание", "system.attributes.movement.swim", "40", false, EFFECT_MODE_UPGRADE)],
  ["сапоги-ходьбы-и-прыжков", flatPassive("walking", "Ходьба", "system.attributes.movement.walk", "30", true, EFFECT_MODE_UPGRADE)],
  ["мантия-плута", flatPassive("rogue-darkvision", "Тёмное зрение", "system.attributes.senses.darkvision", "+60", true)],
  ["светящийся-рунический-пигмент", flatPassive("rune-darkvision", "Тёмное зрение", "system.attributes.senses.darkvision", "+30")],
  ["амулет-святилища", traitPassive("sanctuary-necrotic", "Некротическая защита", "dr", ["necrotic"], true)],
  ["двуручный-серебряный-меч", {
    suffix: "silver-mind", label: "Серебряный разум", partial: true, changes: [
      traitChange("dr", "psychic"), traitChange("ci", "charmed")
    ]
  }],
  ["живой-доспех", traitPassive("living-armor", "Живая защита", "dr", ["necrotic", "psychic", "poison"], true)],
  ["кольчуга-ифритов", traitPassive("efreet-fire", "Иммунитет к огню", "di", ["fire"], true)],
  ["кираса-камнелома", {
    suffix: "stonebreaker", label: "Каменная защита", partial: true, changes: [
      traitChange("dr", "bludgeoning"), traitChange("dr", "piercing"),
      traitChange("dr", "slashing"), traitChange("ci", "prone")
    ]
  }],
  ["жезл-адского-пламени", traitPassive("hellfire", "Адское сопротивление", "dr", ["fire"], true)],
  ["мантия-мистраля", traitPassive("mistral", "Сопротивление холоду", "dr", ["cold"], true)],
  ["морозный-клинок", traitPassive("frost-brand", "Сопротивление огню", "dr", ["fire"], true)],
  ["посох-мороза", traitPassive("frost-staff", "Сопротивление холоду", "dr", ["cold"], true)],
  ["посох-огня", traitPassive("fire-staff", "Сопротивление огню", "dr", ["fire"], true)],
  ["шлем-череп", traitPassive("skull-helm", "Защита шлема", "dr", ["cold", "poison", "necrotic"], true)],
  ["эгида-эвриаллы", {
    suffix: "euryale-blessing", label: "Благословение Эвриалы", partial: true, changes: [
      traitChange("dr", "poison"), traitChange("ci", "petrified")
    ]
  }],
  ["перчатки-воровства", flatPassive("thievery", "Воровство", "system.skills.slt.bonuses.check", "+5", true)],
  ["очки-орлиного-зрения", flatPassive("eagle-eyes-perception", "Орлиное зрение", "system.skills.prc.roll.mode", "1", true)],
  ["плащ-летучей-мыши", flatPassive("bat-stealth", "Скрытность летучей мыши", "system.skills.ste.roll.mode", "1", true)],
  ["плащ-паука", traitPassive("spider-poison", "Сопротивление яду", "dr", ["poison"], true)],
  ["посох-костяного-когтя", {
    suffix: "bone-claw-spell-attack", label: "Атака заклинанием", partial: true,
    changes: spellcastingChanges(1, { dc: false })
  }],
  ["посох-ослепляющий-небеса", {
    suffix: "sky-blinder-spell-attack", label: "Атака заклинанием", partial: true,
    changes: spellcastingChanges(1, { dc: false })
  }],
  ["заполярные-сапоги", traitPassive("polar-cold", "Сопротивление холоду", "dr", ["cold"], true)],
  ["кольцо-тепла", traitPassive("warmth-cold", "Сопротивление холоду", "dr", ["cold"], true)],
  ["мантия-глаз", flatPassive(
    "eyes-darkvision",
    "Тёмное зрение",
    "system.attributes.senses.darkvision",
    "120",
    true,
    EFFECT_MODE_UPGRADE
  )],
  ["медальон-защиты-от-яда", {
    suffix: "poison-protection", label: "Защита от яда", partial: true, changes: [
      traitChange("di", "poison"), traitChange("ci", "poisoned")
    ]
  }],
  ["медальон-здоровья", traitPassive("disease-immunity", "Иммунитет к болезням", "ci", ["diseased"])],
  ["расплавленная-бронзовая-кожа", traitPassive("molten-fire", "Сопротивление огню", "dr", ["fire"], true)],
  ["брошь-арканиста", flatPassive("arcanist-ac", "Защита арканиста", "system.attributes.ac.bonus", "+1", true)],
  ["маска-сокола", {
    suffix: "falcon-flight", label: "Полёт сокола", changes: [
      effectChange("system.attributes.movement.fly", "60", EFFECT_MODE_UPGRADE),
      effectChange("system.attributes.init.roll.mode", "1")
    ]
  }],
  ["татуировка-жизненной-энергии", traitPassive(
    "life-energy-necrotic",
    "Сопротивление некротической энергии",
    "dr",
    ["necrotic"],
    true
  )],
  ["сфера-скориуса", flatPassive(
    "skoraeus-darkvision",
    "Божественное зрение",
    "system.attributes.senses.darkvision",
    "120",
    true,
    EFFECT_MODE_UPGRADE
  )]
])) {
  PASSIVE_MAGIC_ITEM_CHANGE_DEFINITIONS.set(id, definition);
}
PASSIVE_MAGIC_ITEM_CHANGE_DEFINITIONS.delete("очки-орлиного-зрения");
const PARTIAL_PASSIVE_MAGIC_ITEM_IDS = new Set([
  "амулет-благочестия-1",
  "лунный-серп-1",
  "очки-орлиного-зрения",
  "универсальный-инструмент-1"
]);
const PARTIAL_ACTIVITY_MAGIC_ITEM_IDS = new Set([
  "аметистовый-магнетит",
  "боевая-кирка-камнетворца",
  "визор-данота",
  "волшебная-палочка-молний",
  "волшебная-палочка-огненных-шаров",
  "волшебная-палочка-паутины",
  "волшебная-палочка-превращения",
  "волшебная-палочка-сковывания",
  "волшебная-палочка-снарядов",
  "доспех-антимагии",
  "доспех-защиты",
  "жезл-адского-пламени",
  "кираса-баланса",
  "кираса-камнелома",
  "книга-фокусов",
  "книга-чудотворства",
  "кинжал-яда",
  "корона-несущего-гнев",
  "мантия-мистраля",
  "плащ-летучей-мыши",
  "плащ-паука",
  "посох-лечения",
  "посох-мороза",
  "посох-огня",
  "сокрушитель-сумерек",
  "тиара-кружащихся-комет",
  "штормовой-пояс",
  "амулет-благочестия-2",
  "амулет-благочестия-3",
  "барабан-задающего-ритм-1",
  "барабан-задающего-ритм-2",
  "барабан-задающего-ритм-3",
  "универсальный-инструмент-2",
  "универсальный-инструмент-3",
  "жезл-хранителя-договора-1",
  "жезл-хранителя-договора-2",
  "жезл-хранителя-договора-3",
  "амулет-темного-осколка",
  "дирижерская-палочка",
  "доспех-быстрого-снятия",
  "защитная-сфера",
  "палочка-пиротехники",
  "палочка-улыбок",
  "палочка-хмурых-взглядов",
  "посох-птичьего-щебета",
  "посох-цветов",
  "срастающаяся-веревка",
  "татуировка-просветителя",
  "трость-ветерана",
  "шляпа-волшебства",
  "шляпа-вредителей",
  "веер-ветра",
  "доспехи-невесомости",
  "доспехи-падшего",
  "кольцо-прыжков",
  "парящая-сфера",
  "взрывные-очки",
  "доспех-грибковых-спор",
  "графин-бесконечной-воды",
  "свирель-ужаса",
  "пирослияние",
  "порошок-сухости",
  "порошок-чихания-и-удушья",
  "татуировка-обвивающей-хватки",
  "перчатки-ловли-снарядов",
  "алхимический-сосуд",
  "волшебный-горшочек-пельменей",
  "драгоценный-камень-баснописца",
  "кольцо-защиты-разума",
  "плащ-ската",
  "шпионский-шепот",
  "жаровня-командования-огненными-элементалями",
  "кадило-контролирования-воздушных-элементалей",
  "камень-контролирования-земляных-элементалей",
  "чаша-командования-водяными-элементалями",
  "кольцо-влияния-на-животных",
  "концертина-гуляки",
  "лира-строительства",
  "отмычка-воителя",
  "сапоги-левитации",
  "посох-очарования",
  "посох-роя-насекомых",
  "жезл-правления",
  "булава-ужаса",
  "колокольчик-открывания",
  "куб-силового-поля",
  "рог-взрыва",
  "метательное-копье-молнии",
  "посох-иссушения",
  "заводные-доспехи",
  "кольцо-телекинеза",
  "посох-путешественника",
  "колода-измерений",
  "кольцо-падающих-звезд",
  "мантия-сияющих-цветов",
  "клубящийся-венок",
  "слизь-кирзина",
  "арфа-позолоченного-изобилия",
  "доспех-неуязвимости",
  "жезл-величественной-мощи",
  "жезл-воскрешения",
  "ключ-лазутчика",
  "корона-бехолдеров-белаширры",
  "куб-врат",
  "кольцо-трех-желаний",
  "латный-доспех-эфирности",
  "маска-шута",
  "маяк-люксона",
  "платиновый-шарф",
  "покров-вредителей",
  "кольцо-невидимости",
  "скарабей-защиты",
  "веретено-судьбы",
  "волшебная-палочка-секретов",
  "вечнодымящаяся-бутылка",
  "татуировка-жутких-когтей",
  "свирель-канализации",
  "волшебная-палочка-обнаружения-врагов",
  "волшебная-палочка-паралича",
  "волшебная-палочка-страха",
  "камень-сияния",
  "крылья-полета",
  "солнечный-клинок",
  "язык-пламени",
  "амулет-планов",
  "плащ-невидимости",
  "сапоги-скорости",
  "татуировка-поглощения",
  "татуировка-призрачных-шагов",
  "железная-фляга",
  "кольцо-призыва-джинна",
  "щит-пылающего-дредноута"
]);
const ACTIVITY_AUTOMATION_NOTES = new Map([
  ["аметистовый-магнетит", "Заклинание и два простых действия автоматизированы; преимущество на спасброски Силы и остальные свойства остаются ручными."],
  ["посох-огня", "Заклинания и общий пул зарядов автоматизированы; проверка уничтожения после расхода последнего заряда остаётся ручной."],
  ["посох-мороза", "Заклинания и общий пул зарядов автоматизированы; проверка уничтожения после расхода последнего заряда остаётся ручной."],
  ["посох-лечения", "Заклинания и общий пул зарядов автоматизированы; проверка уничтожения после расхода последнего заряда остаётся ручной."],
  ["боевая-кирка-камнетворца", "Магический бонус +1 и Meld into Stone раз в рассвет автоматизированы; ограничение заклинания только владельцем кирки и её прочие оружейные свойства остаются ручными."],
  ["кинжал-яда", "Магический бонус +1, покрытие клинка раз в рассвет и спасбросок Телосложения Сл 15 с уроном 2к10 ядом автоматизированы; состояние poisoned, повторные спасброски и условие попадания остаются ручными."],
  ["амулет-темного-осколка", "Независимый ресурс продолжительного отдыха и запуск попытки автоматизированы; выбор неизвестного заговора, проверка Магии Сл 10 и само заклинание остаются ручными."],
  ["дирижерская-палочка", "Оркестровое действие и три заряда с восстановлением на рассвете автоматизированы; исчезновение палочки после расхода последнего заряда остаётся ручным."],
  ["доспех-быстрого-снятия", "Действие быстрого снятия автоматизировано; фактическое переключение equipped остаётся ручным."],
  ["защитная-сфера", "Реакция уменьшения урона автоматизирована; вариант сферы, допустимый тип урона и вычитание 1к4 остаются ручными."],
  ["палочка-пиротехники", "Вспышка, семь зарядов и восстановление 1к6 + 1 автоматизированы; проверка уничтожения после последнего заряда остаётся ручной."],
  ["палочка-улыбок", "Спасбросок Мудрости Сл 10 и три заряда автоматизированы; состояние улыбки и превращение палочки после последнего заряда остаются ручными."],
  ["палочка-хмурых-взглядов", "Спасбросок Мудрости Сл 10 и три заряда автоматизированы; состояние хмурого взгляда и превращение палочки после последнего заряда остаются ручными."],
  ["посох-птичьего-щебета", "Действие, десять зарядов и восстановление 1к6 + 4 автоматизированы; выбор звука и уничтожение после последнего заряда остаются ручными."],
  ["посох-цветов", "Действие, десять зарядов и восстановление 1к6 + 4 автоматизированы; размещение цветка и уничтожение после последнего заряда остаются ручными."],
  ["срастающаяся-веревка", "Действие сращивания автоматизировано; длина, положение и физическое состояние верёвки остаются ручными."],
  ["татуировка-просветителя", "Одно использование на рассвет и действие надписи автоматизированы; текст, поверхность и выбранный читатель остаются ручными."],
  ["трость-ветерана", "Бонусное действие превращения автоматизировано; необратимая замена трости обычным длинным мечом остаётся ручной."],
  ["шляпа-волшебства", "Независимый ресурс продолжительного отдыха и запуск попытки автоматизированы; выбор неизвестного заговора, проверка Магии Сл 10 и само заклинание остаются ручными."],
  ["шляпа-вредителей", "Действие и три заряда автоматизированы; выбор вида, случайный успех призыва, Token существа и его поведение остаются ручными."],
  ["веер-ветра", "Gust of Wind со Сл 13 автоматизирован; накопительный 20-процентный риск уничтожения при повторных использованиях в тот же день остаётся ручным."],
  ["доспехи-невесомости", "Jump, Levitate и общий пул 5 зарядов автоматизированы; ограничение обеих целей только владельцем доспеха остаётся ручным."],
  ["доспехи-падшего", "Speak with Dead, Animate Dead и общее одно использование на рассвет автоматизированы; выбор заклинания при смерти владельца и уничтожение доспеха остаются ручными."],
  ["кольцо-прыжков", "Бонусное действие Jump автоматизировано; ограничение цели только владельцем кольца остаётся ручным."],
  ["парящая-сфера", "Light без ограничений и независимый Daylight раз в рассвет автоматизированы; режим парения сферы и её перемещение остаются ручными."],
  ["взрывные-очки", "Спасбросок Ловкости Сл 15, урон 3к6 огнём и общий пул зарядов автоматизированы; проклятие и ослепление владельца при натуральной 20 цели остаются ручными."],
  ["доспех-грибковых-спор", "Бонусное действие и спасбросок Телосложения Сл 15 раз в рассвет автоматизированы; область и состояние отравления остаются ручными."],
  ["графин-бесконечной-воды", "Спасбросок Силы Сл 13 и урон гейзера автоматизированы; выбор режима воды, толчок, prone и воздействие на предметы остаются ручными."],
  ["свирель-ужаса", "Спасбросок Мудрости Сл 15 и общий пул зарядов автоматизированы; выбор союзников, frightened, повторные спасброски и иммунитет на 24 часа остаются ручными."],
  ["пирослияние", "Спасбросок Ловкости Сл 13 и урон 4к6 огнём пополам автоматизированы; счёт использований, бросок неисправности и обратный урон остаются ручными."],
  ["порошок-сухости", "Спасбросок Телосложения Сл 13 и урон 10к6 некротической энергией пополам автоматизированы; ограничение водяным элементалем, случайное число щепоток и расход количества остаются ручными."],
  ["порошок-чихания-и-удушья", "Спасбросок Телосложения Сл 15 автоматизирован; область, недееспособность, удушье и повторные спасброски остаются ручными."],
  ["татуировка-обвивающей-хватки", "Спасбросок Силы Сл 14 и урон 3к6 силовым полем автоматизированы; grapple, дистанция, освобождение и окончание захвата остаются ручными."],
  ["перчатки-ловли-снарядов", "Реакция и формула уменьшения урона обозначены activity; свободная рука, допустимость снаряда и фактическое вычитание урона остаются ручными."],
  ["алхимический-сосуд", "Одно использование на рассвет и действие создания автоматизированы; выбор жидкости и добавление её количества в инвентарь остаются ручными."],
  ["волшебный-горшочек-пельменей", "Одно создание на рассвет автоматизировано; число порций, предметы еды, лечение и срок хранения остаются ручными."],
  ["драгоценный-камень-баснописца", "Независимое создание монеты раз в рассвет и изменение внешнего вида автоматизированы; монета и визуальные изменения инвентаря остаются ручными."],
  ["кольцо-защиты-разума", "Переключение видимости кольца автоматизировано; защита мыслей, телепатическая связь и хранение души остаются ручными."],
  ["плащ-ската", "Действия поднятия и опускания капюшона автоматизированы; условные подводное дыхание и скорость плавания остаются ручными."],
  ["шпионский-шепот", "Бонусное действие передачи слуха автоматизировано; выбранное существо, дистанция, продолжительность и прекращение связи остаются ручными."],
  ["жаровня-командования-огненными-элементалями", "Conjure Elemental раз в рассвет автоматизирован; допустим только огненный элементаль, его Token и управление остаются ручными."],
  ["кадило-контролирования-воздушных-элементалей", "Conjure Elemental раз в рассвет автоматизирован; допустим только воздушный элементаль, его Token и управление остаются ручными."],
  ["камень-контролирования-земляных-элементалей", "Conjure Elemental раз в рассвет автоматизирован; допустим только земляной элементаль, его Token и управление остаются ручными."],
  ["чаша-командования-водяными-элементалями", "Conjure Elemental раз в рассвет автоматизирован; допустим только водяной элементаль, его Token и управление остаются ручными."],
  ["кольцо-влияния-на-животных", "Три заклинания со Сл 13 и общий пул зарядов автоматизированы; Fear допустим только против зверей с Интеллектом 3 или ниже, и это ограничение остаётся ручным."],
  ["концертина-гуляки", "Irresistible Dance раз в рассвет автоматизирован; условный бонус +2 к Сл заклинаний барда не автоматизируется."],
  ["лира-строительства", "Mending, Move Earth, Fabricate и Passwall автоматизированы как независимые свойства; отсутствующий в установленных packs Summon Construct и защита строений остаются ручными."],
  ["отмычка-воителя", "Knock без ограничений автоматизирован; превращение отмычки в меч и обратно остаётся ручным."],
  ["сапоги-левитации", "Levitate без расхода автоматизирован; ограничение цели только владельцем сапог остаётся ручным."],
  ["посох-очарования", "Три заклинания, общий пул зарядов и независимая реакция против очарования автоматизированы; отражение заклинания и уничтожение посоха после последнего заряда остаются ручными."],
  ["посох-роя-насекомых", "Заклинания, облако насекомых и общий пул зарядов автоматизированы; параметры облака и уничтожение посоха после последнего заряда остаются ручными."],
  ["жезл-правления", "Спасбросок Мудрости Сл 15 и одно использование на рассвет автоматизированы; область, charm, повторные спасброски и окончание эффекта остаются ручными."],
  ["булава-ужаса", "Спасбросок Мудрости Сл 15 и общий пул зарядов автоматизированы; область, frightened, перемещение и повторные спасброски остаются ручными."],
  ["колокольчик-открывания", "Десять невосстанавливаемых использований и действие открытия автоматизированы; выбор подходящего запора и уничтожение после последнего использования остаются ручными."],
  ["куб-силового-поля", "Шесть граней, их стоимость и общий пул 36 зарядов автоматизированы; активный барьер, столкновения, рассеивание и внешняя потеря зарядов от заклинаний остаются ручными."],
  ["рог-взрыва", "Спасбросок Телосложения Сл 15 и урон 5к6 звуком пополам автоматизированы; хрупкие предметы, стеклянный вариант, увеличенный урон и риск уничтожения остаются ручными."],
  ["метательное-копье-молнии", "Линия молнии, спасбросок Ловкости Сл 13 и урон 4к6 пополам раз в рассвет автоматизированы; сама метательная атака и её оружейный урон остаются ручными."],
  ["посох-иссушения", "Спасбросок Телосложения Сл 15, урон 2к10 некротической энергией и общий пул зарядов автоматизированы; условие попадания посохом и часовой debuff остаются ручными."],
  ["заводные-доспехи", "Замена результата к20 на 10 и общий пул зарядов автоматизированы; прочие заводные свойства доспеха остаются ручными."],
  ["кольцо-телекинеза", "Activity автоматизирует только телекинез предметов, которые никто не несёт и не носит; перемещение, проверки и запрет воздействия на существ остаются ручными."],
  ["посох-путешественника", "Пять заклинаний и общий пул зарядов автоматизированы; проверка уничтожения после расхода последнего заряда остаётся ручной."],
  ["колода-измерений", "Два простых перемещения и общий пул зарядов автоматизированы; отсутствующий в установленных packs Arcane Gate, выбор карт, точки назначения и побочные эффекты остаются ручными."],
  ["кольцо-падающих-звезд", "Faerie Fire, Light, Dancing Lights и общий пул зарядов автоматизированы; ограничения освещения, шаровая молния и падающие звёзды остаются ручными."],
  ["мантия-сияющих-цветов", "Два спасброска Мудрости Сл 15 и общий пул зарядов автоматизированы; области, состояния и длительность эффектов остаются ручными."],
  ["клубящийся-венок", "Телепортация без расхода и независимая облачная форма раз в рассвет автоматизированы; Token-перемещение, полёт, сопротивления и окончание формы остаются ручными."],
  ["слизь-кирзина", "Dancing Lights и Sunbeam раз в рассвет со Сл 17 автоматизированы; source-карточка не является native weapon Item, поэтому бонус +1, тип оружейного урона, отсутствие боеприпасов и свойства перезарядки остаются ручными."],
  ["арфа-позолоченного-изобилия", "Calm Emotions со Сл 19 и пять независимых использований на рассвет автоматизированы; Heroes’ Feast с восстановлением через 1к10 + 10 дней и минимум броска Харизмы остаются ручными."],
  ["доспех-неуязвимости", "Активация иммунитета раз в рассвет автоматизирована; сопротивление только немагическому урону и временный иммунитет на 10 минут остаются ручными, чтобы не расширять их на магический урон."],
  ["жезл-величественной-мощи", "Три независимых свойства раз в рассвет автоматизированы; волшебная палочка не превращается в native weapon Item, поэтому бонус +3 и формы шести кнопок, лечение, состояния и повторные спасброски остаются ручными."],
  ["жезл-воскрешения", "Heal, Resurrection и общий пул зарядов автоматизированы; проверка исчезновения жезла после расхода последнего заряда остаётся ручной."],
  ["ключ-лазутчика", "Семь независимых заклинаний раз в рассвет автоматизированы; состояние реликвии, условные преимущества, превращение в кинжал и создание прохода остаются ручными."],
  ["корона-бехолдеров-белаширры", "Десять заклинаний со Сл 16 и общий пул зарядов автоматизированы; симбиотическая настройка, невозможность снять корону и наблюдение Белаширры остаются ручными."],
  ["куб-врат", "Gate, Plane Shift со Сл 17 и общий пул зарядов автоматизированы; связь граней с выбранными планами и выбор грани остаются ручными."],
  ["кольцо-трех-желаний", "Wish и три невосстанавливаемых заряда автоматизированы; превращение кольца в немагическое после последнего заряда остаётся ручным."],
  ["латный-доспех-эфирности", "Активация раз в рассвет автоматизирована отдельной utility activity; эффект Etherealness ровно на 10 минут и его досрочное окончание остаются ручными."],
  ["маска-шута", "Два независимых свойства раз в рассвет автоматизированы; телепортация Token и условный бонус +3 только для заклинаний Харизмы остаются ручными."],
  ["маяк-люксона", "Дарование частицы раз в рассвет автоматизировано; её восьмичасовой эффект, расход на бросок и ловля душ остаются ручными."],
  ["платиновый-шарф", "Три варианта чешуек и общий пул трёх использований автоматизированы; лечение и временные щит или молот создаются и применяются вручную."],
  ["покров-вредителей", "Polymorph, Insect Plague и укус со спасброском автоматизированы; состояние реликвии, разрешённые формы, пассивные свойства, природное оружие и poison остаются ручными."],
  ["кольцо-невидимости", "Действия включения и выключения невидимости автоматизированы; состояние невидимости и его окончание при атаке, заклинании или снятии кольца остаются ручными."],
  ["скарабей-защиты", "Реакция и 12 невосстанавливаемых зарядов автоматизированы; проверка источника эффекта и уничтожение после последнего заряда остаются ручными."],
  ["веретено-судьбы", "Три свойства и общий пул зарядов автоматизированы; модификация инициативы, отмеченная цель, направление, дополнительный урон и замена результатов бросков применяются вручную."],
  ["волшебная-палочка-секретов", "Действие, три заряда и восстановление 1к3 автоматизированы; наличие и выбор ближайшей потайной двери или ловушки подтверждаются вручную."],
  ["вечнодымящаяся-бутылка", "Действия открытия и закрытия автоматизированы; область дыма, её рост, заслонение и рассеивание ветром остаются ручными."],
  ["татуировка-жутких-когтей", "Бонусное действие и одно использование на рассвет автоматизированы; временная досягаемость и дополнительный урон применяются вручную только к подходящим рукопашным атакам."],
  ["свирель-канализации", "Три варианта расхода и общий пул зарядов автоматизированы; наличие крыс, Token роёв, состязания и управление остаются ручными."],
  ["волшебная-палочка-обнаружения-врагов", "Действие, семь зарядов и восстановление 1к6 + 1 автоматизированы; выбор ближайшего враждебного существа, направление, удержание палочки и уничтожение после последнего заряда остаются ручными."],
  ["волшебная-палочка-паралича", "Спасбросок Телосложения Сл 15, семь зарядов и восстановление 1к6 + 1 автоматизированы; состояние paralyzed, повторные спасброски и уничтожение после последнего заряда остаются ручными."],
  ["волшебная-палочка-страха", "Command со Сл 15, спасбросок конуса страха и общий пул зарядов автоматизированы; область, frightened, вынужденное перемещение, ограничения действий, повторные спасброски и уничтожение палочки остаются ручными."],
  ["камень-сияния", "Свет, два спасброска Телосложения Сл 15 и невосстанавливаемый пул 50 зарядов автоматизированы; Token light, область конуса, blinded, повторные спасброски и превращение в немагическую драгоценность остаются ручными."],
  ["крылья-полета", "Действия разворачивания и убирания крыльев автоматизированы; скорость Token, часовая длительность и перезарядка 1к12 часов остаются ручными."],
  ["солнечный-клинок", "Native бонус +2 и действия клинка и света автоматизированы; finesse, тип оружейного урона, дополнительный урон нежити и Token light остаются ручными."],
  ["язык-пламени", "Бонусное действие включения и выключения пламени автоматизировано; свет и дополнительные 2к6 огненного урона только активного клинка применяются вручную."],
  ["амулет-планов", "Plane Shift автоматизирован как native spell activity; предварительная проверка Интеллекта Сл 15 и случайное направление при провале остаются ручными."],
  ["плащ-невидимости", "Действия капюшона и невосстанавливаемый счётчик 120 минут автоматизированы; состояние invisible и восстановление 60 минут за 12 часов простоя применяются вручную."],
  ["сапоги-скорости", "Действие переключения и счётчик десяти минут с восстановлением после продолжительного отдыха автоматизированы; удвоение текущей скорости и помеха провоцированным атакам остаются ручными."],
  ["татуировка-поглощения", "Реакция и одно использование на рассвет автоматизированы; выбранный тип урона, временный иммунитет и лечение половины предотвращённого урона применяются вручную."],
  ["татуировка-призрачных-шагов", "Бонусное действие и три заряда на рассвет автоматизированы; временные сопротивления, запрет захвата, проход через объекты, выталкивание и урон остаются ручными."],
  ["железная-фляга", "Спасбросок Мудрости Сл 17 и действие выпуска автоматизированы; план происхождения, преимущество повторно заточённой цели, содержимое, Token, команды и длительность остаются ручными."],
  ["кольцо-призыва-джинна", "Действие и невосстанавливаемое native использование автоматизированы; Token джинна, концентрация, команды, восстановление через 24 часа и потеря магии после смерти остаются ручными."],
  ["щит-пылающего-дредноута", "Активация раз в рассвет, очищающий огонь и спасбросок Удара щитом автоматизированы; минутная доступность, иммунитет к огню, снятие выбранного состояния, урон и prone применяются вручную."],
  ["заполярные-сапоги", "Сопротивление холоду автоматизировано; игнорирование холодной местности и переносимость температуры остаются ручными."],
  ["кольцо-тепла", "Сопротивление холоду автоматизировано; переносимость низкой температуры остаётся ручной."],
  ["мантия-глаз", "Тёмное зрение 120 футов автоматизировано; видение во всех направлениях, преимущества Восприятия и состояние ослепления от света остаются ручными."],
  ["медальон-защиты-от-яда", "Иммунитет к урону ядом и состоянию poisoned автоматизированы; остальные проверки и взаимодействия с ядом остаются ручными."],
  ["расплавленная-бронзовая-кожа", "Сопротивление огню автоматизировано; прочие свойства и форма доспеха остаются ручными."],
  ["брошь-арканиста", "Постоянный бонус +1 к КД автоматизирован; поглощение заклинаний и манипуляции магической энергией остаются ручными."],
  ["татуировка-жизненной-энергии", "Сопротивление некротической энергии автоматизировано; свойство Death Ward раз в рассвет и его временный эффект остаются ручными."],
  ["сфера-скориуса", "Тёмное зрение 120 футов автоматизировано; игнорирование компонентов и бонус только к спасброскам концентрации остаются ручными."]
]);

for (const [itemId, note] of [
  ["амулет-благочестия-1", "Божественный канал без расхода раз в рассвет автоматизирован; бонус +1 только к заклинаниям жреца не проецируется как глобальный spell bonus, а actor-resource канала изменяется вручную."],
  ["амулет-благочестия-2", "Божественный канал без расхода раз в рассвет автоматизирован; бонус +2 только к заклинаниям жреца не проецируется как глобальный spell bonus, а actor-resource канала изменяется вручную."],
  ["амулет-благочестия-3", "Божественный канал без расхода раз в рассвет автоматизирован; бонус +3 только к заклинаниям жреца не проецируется как глобальный spell bonus, а actor-resource канала изменяется вручную."],
  ["барабан-задающего-ритм-1", "Восстановление Бардовского вдохновения раз в рассвет автоматизировано; бонус +1 только к заклинаниям барда не проецируется как глобальный spell bonus, а actor-resource вдохновения изменяется compatibility-service."],
  ["барабан-задающего-ритм-2", "Восстановление Бардовского вдохновения раз в рассвет автоматизировано; бонус +2 только к заклинаниям барда не проецируется как глобальный spell bonus, а actor-resource вдохновения изменяется compatibility-service."],
  ["барабан-задающего-ритм-3", "Восстановление Бардовского вдохновения раз в рассвет автоматизировано; бонус +3 только к заклинаниям барда не проецируется как глобальный spell bonus, а actor-resource вдохновения изменяется compatibility-service."],
  ["лунный-серп-1", "Native оружейный бонус +1 автоматизирован; бонус +1 только к заклинаниям друида и следопыта и дополнительное лечение 1к4 не проецируются как глобальные эффекты и остаются ручными."],
  ["лунный-серп-2", "Native оружейный бонус +2 автоматизирован; бонус +2 только к заклинаниям друида и следопыта и дополнительное лечение 1к4 не проецируются как глобальные эффекты и остаются ручными."],
  ["лунный-серп-3", "Native оружейный бонус +3 автоматизирован; бонус +3 только к заклинаниям друида и следопыта и дополнительное лечение 1к4 не проецируются как глобальные эффекты и остаются ручными."],
  ["универсальный-инструмент-1", "Изменение формы и выбор заговора раз в рассвет автоматизированы; бонус +1 только к заклинаниям изобретателя, владение выбранным инструментом и сам выбранный заговор остаются ручными."],
  ["универсальный-инструмент-2", "Изменение формы и выбор заговора раз в рассвет автоматизированы; бонус +2 только к заклинаниям изобретателя, владение выбранным инструментом и сам выбранный заговор остаются ручными."],
  ["универсальный-инструмент-3", "Изменение формы и выбор заговора раз в рассвет автоматизированы; бонус +3 только к заклинаниям изобретателя, владение выбранным инструментом и сам выбранный заговор остаются ручными."],
  ["жезл-хранителя-договора-1", "Восстановление одной ячейки колдуна раз в продолжительный отдых автоматизировано; бонус +1 только к заклинаниям колдуна не проецируется как глобальный spell bonus, а выбранная ячейка изменяется вручную."],
  ["жезл-хранителя-договора-2", "Восстановление одной ячейки колдуна раз в продолжительный отдых автоматизировано; бонус +2 только к заклинаниям колдуна не проецируется как глобальный spell bonus, а выбранная ячейка изменяется вручную."],
  ["жезл-хранителя-договора-3", "Восстановление одной ячейки колдуна раз в продолжительный отдых автоматизировано; бонус +3 только к заклинаниям колдуна не проецируется как глобальный spell bonus, а выбранная ячейка изменяется вручную."],
  ["амулет-молниеносного-движения", "Постоянные +15 футов скорости автоматизированы; бонусное ускорение, проход через врагов, Lightning Bolt по пересечённым существам и общий пул зарядов остаются ручными."],
  ["амулет-святилища", "Сопротивление некротической энергии, Spare the Dying и реакция оставить цели 1 хит раз в рассвет автоматизированы; бонусный вариант активации заговора и фактическое изменение хитов остаются ручными."],
  ["брошь-защиты", "Сопротивление урону силовым полем автоматизировано; иммунитет только к урону конкретного заклинания Magic Missile не проецируется как общий иммунитет и остаётся ручным."],
  ["визор-данота", "Antimagic Field раз в рассвет автоматизирован; состояние реликвии, магическое зрение, зрение сквозь материю, подзорная труба и обнаружение иллюзий остаются ручными."],
  ["волшебная-палочка-боевого-мага-1", "Безусловный бонус +1 к атакам заклинаниями автоматизирован; игнорирование укрытия на половину остаётся ручным."],
  ["волшебная-палочка-боевого-мага-2", "Безусловный бонус +2 к атакам заклинаниями автоматизирован; игнорирование укрытия на половину остаётся ручным."],
  ["волшебная-палочка-боевого-мага-3", "Безусловный бонус +3 к атакам заклинаниями автоматизирован; игнорирование укрытия на половину остаётся ручным."],
  ["волшебная-палочка-молний", "Lightning Bolt со Сл 15, масштабируемый расход и восстановление 1к6 + 1 автоматизированы; проверка уничтожения после последнего заряда остаётся ручной."],
  ["волшебная-палочка-огненных-шаров", "Fireball со Сл 15, масштабируемый расход и восстановление 1к6 + 1 автоматизированы; проверка уничтожения после последнего заряда остаётся ручной."],
  ["волшебная-палочка-паутины", "Web со Сл 15 и общий пул зарядов автоматизированы; проверка уничтожения после последнего заряда остаётся ручной."],
  ["волшебная-палочка-превращения", "Polymorph со Сл 15 и общий пул зарядов автоматизированы; проверка уничтожения после последнего заряда остаётся ручной."],
  ["волшебная-палочка-сковывания", "Hold Monster, Hold Person, реакция помощи и общий пул зарядов автоматизированы; фактическое преимущество реакции и проверка уничтожения после последнего заряда остаются ручными."],
  ["волшебная-палочка-снарядов", "Magic Missile, масштабируемый расход и восстановление 1к6 + 1 автоматизированы; проверка уничтожения после последнего заряда остаётся ручной."],
  ["двуручный-серебряный-меч", "Native бонус +3, сопротивление психической энергии и иммунитет к charm автоматизированы; преимущество только на ментальные спасброски и обрыв серебряной нити при критическом попадании остаются ручными."],
  ["доспех-антимагии", "Antimagic Field и независимая реакция раз в рассвет автоматизированы; преимущество на конкретный спасбросок от заклинания применяется вручную."],
  ["доспех-защиты", "Beacon of Hope раз в рассвет автоматизирован; увеличение максимума хитов на 10 + уровень и отсутствие концентрации у минутного заклинания остаются ручными."],
  ["жезл-адского-пламени", "Сопротивление огню и Hellish Rebuke 4-го уровня со Сл 16 раз в рассвет автоматизированы; максимизация урона огнём или некротической энергией раз в рассвет остаётся ручной."],
  ["жезл-бдительности", "Преимущество инициативы и Восприятия, четыре unlimited-заклинания и активация ауры раз в рассвет автоматизированы; размещение жезла, свет, союзные +1 КД/спасброски и обнаружение невидимых остаются ручными."],
  ["жезл-бдительности-2", "Преимущество инициативы и Восприятия, четыре unlimited-заклинания и активация ауры раз в рассвет автоматизированы; размещение жезла, свет, союзные +1 КД/спасброски и обнаружение невидимых остаются ручными."],
  ["живой-доспех", "Native бонус +1 и сопротивления некротической, психической энергии и яду автоматизированы; симбиотическая настройка, невозможность снять доспех, кормление костями хитов и истощение остаются ручными."],
  ["кираса-баланса", "Lesser Restoration, реакция уравнивания и общий пул четырёх зарядов автоматизированы; фактическое снятие преимущества или помехи с выбранного броска остаётся ручным."],
  ["кираса-камнелома", "Native бонус +1, три физических сопротивления, иммунитет к prone и Wall of Stone со Сл 14 автоматизированы; преимущество только на концентрацию этого заклинания остаётся ручным."],
  ["клинок-удачи", "Native бонус +1, бонус +1 к спасброскам и переброс раз в рассвет автоматизированы; применение второго результата, случайные заряды Wish и потеря свойства после последнего заряда остаются ручными."],
  ["книга-фокусов", "Prestidigitation и общий пул семи зарядов автоматизированы; проверка уничтожения книги после последнего заряда остаётся ручной."],
  ["книга-чудотворства", "Thaumaturgy и общий пул семи зарядов автоматизированы; проверка уничтожения книги после последнего заряда остаётся ручной."],
  ["кольчуга-ифритов", "Native бонус +3 и иммунитет к огню автоматизированы; Первичный язык и хождение по расплавленному камню остаются ручными."],
  ["корона-несущего-гнев", "Fear со Сл 15 раз в рассвет автоматизирован; трата Кости Хитов для дополнительного психического урона и отсутствие концентрации у минутного заклинания остаются ручными."],
  ["мантия-звезд", "Бонус +1 к спасброскам, шесть невосстанавливаемых в системе звёзд, Magic Missile 5-го уровня и астральные действия автоматизированы; восстановление 1к6 звёзд на закате и фактический планарный переход остаются ручными."],
  ["мантия-мистраля", "Сопротивление холоду, Sleet Storm со Сл 14 и спасбросок ветра с уроном 1к6 автоматизированы; prone, ограничение раз за ход и особые преимущества владельца внутри метели остаются ручными."],
  ["мантия-плута", "Добавочные 60 футов тёмного зрения и бонусное теневое перемещение автоматизированы; условия освещения, Token-телепортация, преимущество атаки и отсутствующий в official packs Antagonize остаются ручными."],
  ["морозный-клинок", "Сопротивление огню автоматизировано; дополнительный урон 1к6 холодом только этим оружием, температурный свет и тушение немагического огня раз в час остаются ручными."],
  ["перчатки-воровства", "Безусловный бонус +5 к Ловкости рук автоматизирован; отдельный бонус +5 только к проверкам Ловкости для вскрытия замков остаётся ручным."],
  ["плащ-летучей-мыши", "Преимущество Скрытности и Polymorph раз в рассвет автоматизированы; условия тусклого света, занятые руки, скорость полёта 40 футов и ограничение формы летучей мышью остаются ручными."],
  ["плащ-паука", "Сопротивление яду и Web со Сл 13 раз в рассвет автоматизированы; скорость лазания, движение по стенам/паутине и удвоенная область Web остаются ручными."],
  ["посох-костяного-когтя", "Безусловный бонус +1 к атакам заклинаниями автоматизирован; дополнительные 3к6 излучением только при критической атаке заклинанием остаются ручными."],
  ["посох-ослепляющий-небеса", "Native оружейный бонус +1, бонус +1 к атакам заклинаниями и спасбросок вспышки Сл 15 автоматизированы; условие летающего атакующего, помеха атаке и blinded остаются ручными."],
  ["пояс-дварфов", "Повышение Телосложения на 2 с максимумом 20 автоматизировано; дварфские проверки, рост бороды и преимущества только для не-дварфов остаются ручными."],
  ["сапоги-ходьбы-и-прыжков", "Минимальная скорость ходьбы 30 футов автоматизирована; игнорирование перегрузки и тяжёлого доспеха и утроенная дальность прыжка остаются ручными."],
  ["сокрушитель-сумерек", "Sunbeam со Сл 15 раз в рассвет и действия света автоматизированы; условные +2 оружию только при свете, замена типа урона, дополнительный урон нежити и Token-свет остаются ручными."],
  ["сфера-вуали", "Мудрость и её максимум +2 и добавочные 60 футов тёмного зрения автоматизированы; поиск скрытых проходов и все эффекты проклятия остаются ручными."],
  ["тиара-кружащихся-комет", "Ice Storm со Сл 16, полёт, один снаряд звёздного удара и общий пул зарядов автоматизированы; временная скорость/свечение, несколько снарядов и применение их урона остаются ручными."],
  ["укус-харкона", "Бонус +1 ко всем проверкам характеристик и спасброскам автоматизирован; проклятие, невозможность снять ожерелье и ликантропия до полнолуния остаются ручными."],
  ["шлем-череп", "Сопротивления холоду, яду и некротической энергии автоматизированы; Spirit of Death раз в рассвет остаётся ручным, потому что заклинание отсутствует в установленных official packs."],
  ["штормовой-пояс", "Control Weather раз в рассвет автоматизирован; состояние реликвии, значения Силы, сопротивления, трансформация, полёт, замена типов оружейного урона и удар молнии остаются ручными."],
  ["эгида-эвриаллы", "Сопротивление яду, иммунитет к petrified, три независимых заклинания и спасбросок геральдики Сл 20 раз в рассвет автоматизированы; restrained, повторный спасбросок и petrified на 24 часа остаются ручными."]
]) {
  ACTIVITY_AUTOMATION_NOTES.set(itemId, note);
}
const DEFERRED_MAGIC_ITEM_AUDIT_NAMES = new Set([
  "особый кинжал телепортации",
  "зелье заживления ран",
  "зелье лечения 1-го уровня"
]);
const CONDITIONAL_MAGIC_ITEM_AUDIT_REASONS = new Map([
  ["амулет-естественной-брони-1", "Бонус к КД условен: действует только без доспеха; постоянный effect был бы неверным."],
  ["амулет-естественной-брони-2", "Бонус к КД условен: действует только без доспеха; постоянный effect был бы неверным."],
  ["амулет-естественной-брони-3", "Бонус к КД условен: действует только без доспеха; постоянный effect был бы неверным."],
  ["печатка-гильдии-груул", "Compelled Duel отсутствует в установленных dnd5e compendium; создавать неподтверждённый UUID нельзя."],
  ["печатка-гильдии-иззет", "Chaos Bolt отсутствует в установленных dnd5e compendium; создавать неподтверждённый UUID нельзя."]
]);
const MAGIC_ITEM_AUDIT_RARITIES = [
  "Обычный",
  "Необычный",
  "Редкий",
  "Очень редкий",
  "Легендарный",
  "Артефакт",
  "Без редкости"
];
const MANUAL_AUTOMATION_SIGNAL_PATTERNS = [
  ["spells", /заклин|\bspell\b|заговор/iu],
  ["resource", /заряд|рассвет|коротк\S* отдых|продолжительн\S* отдых|длительн\S* отдых|раз в день|один раз/iu],
  ["flatBonus", /бонус\S*\s+(?:\+\d+\s+)?к\s+(?:КД|спасброс|проверк|характеристик|атак\S* заклин|Сл\S* спас)|увеличива\S*\s+(?:ваш\S*\s+)?(?:КД|сил|ловк|телосл|интеллект|мудрост|харизм)/iu],
  ["traits", /сопротивлен|иммунитет|скорост(?:ь|и)|зрени|чувств/iu],
  ["action", /(?:бонусным\s+)?действием|реакци\S*|соверш\S*\s+(?:спасбросок|атаку|действие)/iu]
];
const NATIVE_MAGIC_BONUS_AUDIT_IDS = new Set(NATIVE_MAGIC_ITEM_BONUSES.keys());
const PARTIAL_NATIVE_MAGIC_ITEM_IDS = new Set([
  "лунный-серп-1",
  "лунный-серп-2",
  "лунный-серп-3"
]);

function stableHashId(seed, scope = "id") {
  const source = `${scope}:${seed}`;
  let hashA = 0x811c9dc5;
  let hashB = 0x9e3779b9;

  for (const char of source) {
    const code = char.codePointAt(0) ?? 0;
    hashA = Math.imul(hashA ^ code, 0x01000193) >>> 0;
    hashB = Math.imul(hashB + code + ((hashB << 6) >>> 0) + (hashB >>> 2), 0x85ebca6b) >>> 0;
  }

  const token = `${hashA.toString(36)}${hashB.toString(36)}`.replace(/[^a-z0-9]/gu, "");
  return token.padEnd(16, "0").slice(0, 16);
}

function buildMagicItemEffectId(item, suffix) {
  return stableHashId(`magic-item:${String(item?.id ?? "").trim()}:${suffix}`, "magic-item-effect");
}

function resolveNativeInstrumentSpellDefinition(item) {
  return NATIVE_INSTRUMENT_SPELLS[String(item?.id ?? "").trim()] ?? null;
}

function itemUseConsumptionTarget(value = "1") {
  return {
    type: "itemUses",
    target: "",
    value,
    scaling: {
      mode: "",
      formula: ""
    }
  };
}

function buildFormulaRecovery(max, formula) {
  return {
    spent: 0,
    max: String(max),
    recovery: [{
      period: "dawn",
      type: "formula",
      formula
    }]
  };
}

function buildDawnUses(definition) {
  if (!definition) {
    return null;
  }
  if (definition.noRecovery === true) {
    return {
      spent: 0,
      max: String(definition.max),
      recovery: []
    };
  }
  if (definition.recovery) {
    const uses = buildFormulaRecovery(definition.max, definition.recovery);
    uses.recovery[0].period = definition.period ?? "dawn";
    return uses;
  }
  return {
    spent: 0,
    max: String(definition.max),
    recovery: [{
      period: definition.period ?? "dawn",
      type: "recoverAll",
      formula: ""
    }]
  };
}

function buildActivityDamage(definition) {
  if (!definition?.damage) {
    return { onSave: "none", parts: [] };
  }
  return {
    onSave: definition.damage.onSave ?? "none",
    parts: [{
      number: definition.damage.number,
      denomination: definition.damage.denomination,
      bonus: definition.damage.bonus ?? "",
      types: definition.damage.types ?? [],
      custom: { enabled: false, formula: "" },
      scaling: { mode: "", number: 1, formula: "" }
    }]
  };
}

function buildUtilityActivity(item, definition) {
  const activityId = stableHashId(
    `magic-item:${item.id}:activity:${definition.key}`,
    "magic-item-activity"
  );
  return [activityId, {
    _id: activityId,
    type: definition.type ?? "utility",
    name: definition.name,
    activation: {
      type: definition.activation,
      value: definition.activation === "special" ? null : 1,
      condition: definition.condition ?? "",
      override: false
    },
    consumption: {
      scaling: { allowed: false, max: "" },
      spellSlot: false,
      targets: definition.cost === null
        ? []
        : definition.uses
          ? [{ type: "activityUses", value: String(definition.cost ?? 1) }]
          : [itemUseConsumptionTarget(String(definition.cost))]
    },
    ...(definition.uses ? { uses: buildDawnUses(definition.uses) } : {}),
    ...(definition.type === "save" ? {
      save: {
        ability: [definition.ability],
        dc: { calculation: "", formula: String(definition.dc) }
      },
      damage: buildActivityDamage(definition)
    } : {}),
    description: {
      chatFlavor: definition.chatFlavor
    },
    flags: {
      [MODULE_ID]: {
        magicItemAutomation: true
      }
    }
  }];
}

function buildPoisonDaggerSaveActivity(item) {
  const activityId = stableHashId(
    `magic-item:${item.id}:activity:poison-save`,
    "magic-item-activity"
  );
  return [activityId, {
    _id: activityId,
    type: "save",
    name: "Яд: спасбросок после попадания",
    activation: {
      type: "special",
      value: null,
      condition: "После попадания отравленным клинком",
      override: false
    },
    consumption: {
      scaling: { allowed: false, max: "" },
      spellSlot: false,
      targets: []
    },
    save: {
      ability: ["con"],
      dc: { calculation: "", formula: "15" }
    },
    damage: {
      onSave: "none",
      parts: [{
        number: 2,
        denomination: 10,
        bonus: "",
        types: ["poison"],
        custom: { enabled: false, formula: "" },
        scaling: { mode: "", number: 1, formula: "" }
      }]
    },
    description: {
      chatFlavor: "При провале цель получает 2к10 урона ядом и становится отравленной на 1 минуту."
    },
    flags: {
      [MODULE_ID]: {
        magicItemAutomation: true
      }
    }
  }];
}

function buildMagicItemActivities(item) {
  const itemId = String(item?.id ?? "").trim();
  const instrumentSpells = resolveNativeInstrumentSpellDefinition(item);
  const chargedDefinition = CHARGED_MAGIC_ITEM_SPELLS[itemId] ?? null;
  const sharedUses = chargedDefinition?.uses ?? null;
  const spells = instrumentSpells ?? chargedDefinition?.spells ?? [];
  const entries = spells.map((spell) => {
    const activityId = stableHashId(
      `magic-item:${item.id}:spell:${spell.id}`,
      "magic-item-activity"
    );
    return [activityId, {
      _id: activityId,
      type: "cast",
      name: spell.name,
      activation: {
        type: spell.activation ?? "action",
        value: 1,
        condition: ""
      },
      consumption: {
        scaling: {
          allowed: Boolean(spell.scalingMax),
          max: spell.scalingMax ?? ""
        },
        spellSlot: false,
        targets: sharedUses && spell.useSharedUses !== false
          ? [{
            ...itemUseConsumptionTarget(String(spell.cost ?? 1)),
            ...(spell.scalingMax ? { scaling: { mode: "amount", formula: "" } } : {})
          }]
          : instrumentSpells || spell.uses ? [{
            type: "activityUses",
            value: "1"
          }] : []
      },
      ...(instrumentSpells || spell.uses
        ? { uses: buildDawnUses(spell.uses ?? { max: 1 }) }
        : {}),
      spell: {
        ability: "",
        challenge: spell.saveDc || spell.attackBonus
          ? {
            attack: spell.attackBonus ?? null,
            save: spell.saveDc ?? null,
            override: true
          }
          : { override: false },
        level: spell.level,
        properties: ["vocal", "somatic", "material"],
        spellbook: true,
        uuid: `Compendium.dnd5e.${spell.pack ?? "spells"}.Item.${spell.id}`
      },
      flags: {
        [MODULE_ID]: {
          magicItemAutomation: true
        }
      }
    }];
  });
  const utilityDefinition = MAGIC_ITEM_UTILITY_DEFINITIONS[itemId];
  for (const definition of utilityDefinition?.activities ?? []) {
    entries.push(buildUtilityActivity(item, definition));
  }
  if (itemId === "кинжал-яда") {
    entries.push(buildPoisonDaggerSaveActivity(item));
  }
  return entries.length ? Object.fromEntries(entries) : null;
}

function buildPassiveMagicItemEffect({
  id,
  name,
  description = "",
  changes = [],
  transfer = true,
  flags = {}
}) {
  return {
    _id: id,
    name,
    type: "base",
    img: DEFAULT_MAGIC_ITEM_ICON,
    system: {},
    changes,
    disabled: false,
    duration: {
      startTime: null,
      seconds: null,
      combat: null,
      rounds: null,
      turns: null,
      startRound: null,
      startTurn: null
    },
    description,
    origin: null,
    transfer,
    statuses: [],
    sort: 0,
    flags: {
      [MODULE_ID]: {
        managed: true,
        magicItemAutomation: true
      },
      ...flags
    }
  };
}

function parseItemBonusFromName(itemName) {
  const match = String(itemName ?? "").match(/\+(\d+)/u);
  return match ? Number(match[1]) : 0;
}

function resolveMagicItemAutomationDefinition(item) {
  const itemId = String(item?.id ?? "").trim();
  const normalizedName = normalizeMatchText(item?.name);
  const normalizedPoweName = normalizeMatchText(BELLMAN_POWER_ITEM_NAME);
  const normalizedPouchName = normalizeMatchText(HOARDING_POUCH_ITEM_NAME);
  const normalizedWatcherShieldName = normalizeMatchText(WATCHER_SHIELD_ITEM_NAME);
  const normalizedRingPrefix = normalizeMatchText(RING_BONUS_ITEM_PREFIX);
  const passiveDefinition = PASSIVE_MAGIC_ITEM_CHANGE_DEFINITIONS.get(itemId) ?? null;
  const chargedDefinition = CHARGED_MAGIC_ITEM_SPELLS[itemId] ?? null;
  const utilityDefinition = MAGIC_ITEM_UTILITY_DEFINITIONS[itemId] ?? null;

  if (passiveDefinition || chargedDefinition || utilityDefinition) {
    const uses = chargedDefinition?.uses ?? utilityDefinition?.uses ?? null;
    return {
      version: MAGIC_ITEM_AUTOMATION_VERSION,
      kind: passiveDefinition && (chargedDefinition || utilityDefinition)
        ? "passive-and-activities"
        : passiveDefinition ? "passive" : "activities",
      coverage: passiveDefinition?.partial === true
        || PARTIAL_PASSIVE_MAGIC_ITEM_IDS.has(itemId)
        || PARTIAL_ACTIVITY_MAGIC_ITEM_IDS.has(itemId)
        ? "partial"
        : "full",
      sharedUses: buildDawnUses(uses),
      note: ACTIVITY_AUTOMATION_NOTES.get(itemId)
        ?? (itemId === "лунный-серп-1"
          ? "Бонус к лечению заклинаниями остаётся ручным: native healing bonus расширил бы механику на другие источники лечения."
          : "Автоматизируется managed effects и native activities предмета.")
    };
  }

  if (normalizedName === normalizedPouchName) {
    return {
      kind: "bagOfHolding",
      coverage: "partial",
      note: "Native container capacity 500 фунтов / 64 кубических фута, постоянный вес 15 фунтов и weightless contents автоматизированы; разрыв, выворачивание, запас воздуха и межпространственная катастрофа требуют ручной обработки.",
      capacity: {
        count: null,
        volume: { value: 64, units: "ft3" },
        weight: { value: 500, units: "lb" },
        note: "В модуле контейнерная модель для мешка хранения применена через метаданные и требует ручной верификации."
      }
    };
  }

  if (normalizedName === normalizedPoweName) {
    return {
      kind: "pearlOfPower",
      coverage: "manual",
      note: "Требуется ручной выбор и восстановление ячейки заклинания после использования."
    };
  }

  if (normalizedName.startsWith(normalizedWatcherShieldName)) {
    return {
      kind: "itemAbility",
      coverage: "full",
      note: "Автоматизируется статическим эффектом в разделe `effects`."
    };
  }

  if (normalizedName.startsWith(normalizedRingPrefix)) {
    const variant = RING_BONUS_VARIANTS_NORMALIZED
      .find((entry) => normalizedName.includes(entry.normalizedId));
    if (!variant) {
      return null;
    }

    return {
      kind: "abilityRing",
      coverage: "manual-choice",
      bonus: variant.bonus,
      maxAbilityScore: variant.maxAbilityScore,
      note: `Выберите одну характеристику для повышения на ${variant.bonus} (максимум ${variant.maxAbilityScore}).`
    };
  }

  return null;
}

function summarizeManagedAutomation(effects, activities) {
  const parts = [];
  if (effects.length) {
    parts.push(`managed effect (${effects.length})`);
  }
  const activityCount = Object.keys(activities ?? {}).length;
  if (activityCount) {
    parts.push(`managed activity (${activityCount})`);
  }
  return parts.length ? parts.join(" + ") : "Нет в managed-проекции";
}

/**
 * Build a detached, deterministic audit row for every supplied magic item.
 * The manifest describes the current projection and the approved next action;
 * it does not infer automation from prose at runtime.
 *
 * @param {object[]} items Catalog rows with stable `id` and `name`.
 * @returns {object[]} Detached audit rows in catalog order.
 */
export function buildMagicItemAutomationManifest(items = MAGIC_ITEMS) {
  return (Array.isArray(items) ? items : []).map((item) => {
    const id = String(item?.id ?? "").trim();
    const name = String(item?.name ?? "").trim();
    const normalizedName = normalizeMatchText(name);
    if (DEFERRED_MAGIC_ITEM_AUDIT_NAMES.has(normalizedName)) {
      return {
        id,
        name,
        existingAutomation: "Не изменяется",
        proposedAutomation: "Отложено",
        status: "deferred",
        reason: "Требуется отдельное решение; текущая итерация не изменяет эту world-карточку."
      };
    }

    const definition = resolveMagicItemAutomationDefinition(item);
    const effects = buildMagicItemAutomationEffects(item);
    const activities = buildMagicItemActivities(item);
    const existingAutomation = summarizeManagedAutomation(effects, activities);
    if (definition || effects.length || activities) {
      const declaredCoverage = String(definition?.coverage ?? "full");
      const status = declaredCoverage === "partial"
        ? "partial"
        : declaredCoverage === "full" ? "full" : "manual";
      return {
        id,
        name,
        existingAutomation,
        proposedAutomation: status === "manual"
          ? "Сохранить существующую механику; выбор остаётся ручным"
          : "Сохранить и расширять только подтверждённую managed-автоматизацию",
        status,
        reason: String(definition?.note ?? "Текущая managed-проекция однозначно выражена средствами dnd5e.")
      };
    }

    if (NATIVE_MAGIC_BONUS_AUDIT_IDS.has(id)) {
      const isWeapon = item?.itemType === "Оружие" || id.startsWith("оружие-");
      const partial = PARTIAL_NATIVE_MAGIC_ITEM_IDS.has(id);
      return {
        id,
        name,
        existingAutomation: "Нет в managed-проекции",
        proposedAutomation: isWeapon
          ? "Native dnd5e system.magicalBonus"
          : "Native dnd5e system.armor.magicalBonus",
        status: partial ? "partial" : "full",
        reason: partial
          ? String(ACTIVITY_AUTOMATION_NOTES.get(id))
          : "Однозначный native dnd5e бонус +1/+2/+3; Active Effect не создаётся."
      };
    }

    return {
      id,
      name,
      existingAutomation,
      proposedAutomation: "Не добавлять без отдельного явного определения",
      status: "manual",
      reason: CONDITIONAL_MAGIC_ITEM_AUDIT_REASONS.get(id)
        ?? "Каталожное описание требует выбора, условия или сложной механики; безопасная простая автоматизация пока не утверждена."
    };
  });
}

/**
 * Group the current manifest by authored rarity and identify manual rows whose
 * prose merits a full-description review. Signals are audit hints only and are
 * never used to build runtime automation.
 *
 * @param {object[]} items Catalog rows with stable identity and source prose.
 * @returns {{total:number,rarities:object[]}} Rarity counts and manual candidates.
 */
export function buildMagicItemAutomationGapReport(items = MAGIC_ITEMS) {
  const sourceItems = Array.isArray(items) ? items : [];
  const manifest = buildMagicItemAutomationManifest(sourceItems);
  const groups = new Map(MAGIC_ITEM_AUDIT_RARITIES.map((rarity) => [rarity, {
    rarity,
    total: 0,
    full: 0,
    partial: 0,
    manual: 0,
    manualCandidates: []
  }]));

  for (const [index, row] of manifest.entries()) {
    const item = sourceItems[index] ?? {};
    const normalizedRarity = normalizeMatchText(item.rarity);
    const rarity = MAGIC_ITEM_AUDIT_RARITIES
      .find((entry) => entry !== "Без редкости" && normalizeMatchText(entry) === normalizedRarity)
      ?? "Без редкости";
    const group = groups.get(rarity);
    group.total += 1;
    if (row.status === "full" || row.status === "partial" || row.status === "manual") {
      group[row.status] += 1;
    }
    if (row.status !== "manual") {
      continue;
    }

    const description = String(item?.description ?? "");
    const signals = MANUAL_AUTOMATION_SIGNAL_PATTERNS
      .filter(([, pattern]) => pattern.test(description))
      .map(([signal]) => signal);
    if (signals.length) {
      group.manualCandidates.push({ id: row.id, name: row.name, signals });
    }
  }

  return {
    total: manifest.length,
    rarities: [...groups.values()]
  };
}

function buildMagicItemAutomationEffects(item) {
  const normalizedName = normalizeMatchText(item?.name);
  const itemBonuses = parseItemBonusFromName(item?.name);
  const passiveDefinition = PASSIVE_MAGIC_ITEM_CHANGE_DEFINITIONS.get(String(item?.id ?? "").trim());

  if (passiveDefinition) {
    return [
      buildPassiveMagicItemEffect({
        id: buildMagicItemEffectId(item, passiveDefinition.suffix),
        name: `${item?.name}: ${passiveDefinition.label}`,
        description: item?.description,
        changes: passiveDefinition.changes
      })
    ];
  }

  if (normalizedName === normalizeMatchText("Ночные очки")) {
    return [
      buildPassiveMagicItemEffect({
        id: buildMagicItemEffectId(item, "night-goggles"),
        name: `${item?.name}: Темное зрение`,
        description: item?.description,
        changes: [{
          key: "system.attributes.senses.darkvision",
          mode: EFFECT_MODE_ADD,
          value: "+60",
          priority: 20
        }]
      })
    ];
  }

  if (normalizedName.startsWith(normalizeMatchText("Плащ защиты"))) {
    if (!itemBonuses) {
      return [];
    }

    return [
      buildPassiveMagicItemEffect({
        id: buildMagicItemEffectId(item, `cloak-of-protection-${itemBonuses}`),
        name: `${item?.name}: Защита`,
        description: item?.description,
        changes: [{
          key: "system.bonuses.abilities.save",
          mode: EFFECT_MODE_ADD,
          value: `+${itemBonuses}`,
          priority: 20
        }]
      })
    ];
  }

  if (normalizedName === normalizeMatchText("Щит часового")) {
    return [
      buildPassiveMagicItemEffect({
        id: buildMagicItemEffectId(item, "watcher-shield"),
        name: `${item?.name}: Боевая подготовка`,
        description: item?.description,
        changes: [
          {
            key: "system.attributes.init.roll.mode",
            mode: EFFECT_MODE_ADD,
            value: "1",
            priority: 20
          },
          {
            key: "system.skills.prc.roll.mode",
            mode: EFFECT_MODE_ADD,
            value: "1",
            priority: 20
          }
        ]
      })
    ];
  }

  return [];
}

function normalizeMatchText(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/['\u2019\u2018\u02BC\u02B9\u2032"\u201C\u201D\u00AB\u00BB]/gu, "")
    .replace(/\s+/gu, " ");
}

function isDnd5eWorld() {
  return game.system?.id === DND5E_SYSTEM_ID;
}

function clampRank(value) {
  return Math.max(0, Math.min(10, Math.round(toNumber(value, 0))));
}

function normalizeBoolean(value) {
  if (typeof value === "boolean") {
    return value;
  }

  const text = String(value ?? "").trim().toLowerCase();
  return ["true", "1", "yes", "y", "да"].includes(text);
}

function isQuestionPlaceholder(value) {
  return /^\?+(?:\s+\?+)*$/u.test(String(value ?? "").trim());
}

function normalizeOptionalMagicText(value) {
  const text = String(value ?? "").trim();
  return isQuestionPlaceholder(text) ? "" : text;
}

function normalizeMagicSourceType(value) {
  return normalizeOptionalMagicText(value) || "Магический предмет";
}

function normalizeMagicItemType(value) {
  const text = normalizeOptionalMagicText(value);
  if (normalizeMatchText(text) === normalizeMatchText("Чудестный предмет")) {
    return "Чудесный предмет";
  }

  return text;
}

function normalizeRarity(value) {
  switch (normalizeMatchText(value)) {
    case "обычный":
      return "common";
    case "необычный":
      return "uncommon";
    case "редкий":
      return "rare";
    case "очень редкий":
      return "veryRare";
    case "легендарный":
      return "legendary";
    case "артефакт":
      return "artifact";
    default:
      return "";
  }
}

function restoresBardicInspiration(item) {
  return normalizeMatchText(item?.name).startsWith(normalizeMatchText("Барабан задающего ритм"))
    && normalizeMatchText(item?.description).includes(normalizeMatchText("восстановить одну кость бардовского вдохновения"));
}

function resolveItemSlotGroup(item, classification) {
  const explicitSlot = normalizeHeroDollSlotGroup(item.itemSlot ?? "", "");
  if (explicitSlot) {
    return explicitSlot;
  }

  return inferHeroDollSlotGroupFromSlots(classification.heroDollSlots, "");
}

function goldToDnd5ePrice(priceGoldEquivalent) {
  const totalCopper = Math.max(0, Math.round(Number(priceGoldEquivalent ?? 0) * 100));
  if (totalCopper >= 100) {
    return {
      value: Math.round(((totalCopper / 100) + Number.EPSILON) * 100) / 100,
      denomination: "gp"
    };
  }

  if (totalCopper % 10 !== 0) {
    return { value: totalCopper, denomination: "cp" };
  }

  return { value: totalCopper / 10, denomination: "sp" };
}

export function parseFixedPriceTextToGold(value) {
  const text = String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/,/gu, ".")
    .replace(/\s+/gu, " ");

  if (!text || text === "—" || text === "-") {
    return null;
  }

  const match = text.match(/^(\d[\d ]*(?:\.\d+)?)\s*(пм|pp|эм|ep|зм|gp|см|sp|мм|cp)$/iu);
  if (!match) {
    return null;
  }

  const numericValue = Number(match[1].replace(/\s+/gu, ""));
  if (!Number.isFinite(numericValue) || numericValue < 0) {
    return null;
  }

  switch (match[2].toLowerCase()) {
    case "пм":
    case "pp":
      return numericValue * 10;
    case "эм":
    case "ep":
      return numericValue * 0.5;
    case "зм":
    case "gp":
      return numericValue;
    case "см":
    case "sp":
      return numericValue * 0.1;
    case "мм":
    case "cp":
      return numericValue * 0.01;
    default:
      return null;
  }
}

function getNativeMagicItemPrice(item) {
  const parsedCostGold = parseFixedPriceTextToGold(item?.costText);
  if (parsedCostGold === null) {
    return {
      value: null,
      denomination: "gp"
    };
  }

  return goldToDnd5ePrice(parsedCostGold);
}

export function normalizeMagicItems(rawItems = MAGIC_ITEMS) {
  const usedIds = new Set();
  return (Array.isArray(rawItems) ? rawItems : [])
    .filter(Boolean)
    .map((rawItem, index) => {
      const name = String(rawItem.name ?? rawItem.Name ?? `Магический предмет ${index + 1}`).trim();
      const baseId = buildSlug(rawItem.id ?? name, "magic-item");
      let id = baseId;
      let duplicateIndex = 2;
      while (usedIds.has(id)) {
        id = `${baseId}-${duplicateIndex}`;
        duplicateIndex += 1;
      }
      usedIds.add(id);

      return {
        id,
        name,
        type: normalizeMagicSourceType(rawItem.type ?? rawItem.Type),
        rarity: normalizeOptionalMagicText(rawItem.rarity ?? rawItem.itemRarity),
        itemType: MAGIC_STAFF_WEAPON_IDS.has(id)
          ? "Оружие"
          : normalizeMagicItemType(rawItem.itemType ?? rawItem.ItemType),
        itemSubtype: MAGIC_STAFF_WEAPON_IDS.has(id)
          ? "Боевой посох"
          : normalizeOptionalMagicText(rawItem.itemSubtype),
        itemSlot: normalizeOptionalMagicText(rawItem.itemSlot),
        source: String(rawItem.source ?? rawItem.itemSourse ?? "").trim(),
        rank: clampRank(rawItem.rank),
        materials: normalizeOptionalMagicText(rawItem.materials ?? rawItem.item_materials),
        bargaining: normalizeOptionalMagicText(rawItem.bargaining ?? rawItem.itemBargaining),
        costText: normalizeOptionalMagicText(rawItem.costText ?? rawItem.itemCost),
        impact: normalizeOptionalMagicText(rawItem.impact ?? rawItem.item_impact),
        attunement: normalizeOptionalMagicText(rawItem.attunement ?? rawItem.itemAttunementDetails),
        isConsumable: NON_CONSUMABLE_MAGIC_ITEM_IDS.has(id)
          ? false
          : normalizeBoolean(rawItem.isConsumable),
        description: String(rawItem.description ?? rawItem.Desc ?? "").trim(),
        priceGold: toNumber(rawItem.priceGold ?? rawItem.value, 0),
        heroDollSlots: rawItem.heroDollSlots ?? null
      };
    });
}

function buildFolderPath(classification) {
  return normalizeFolderPath(classification.folderPath);
}

function buildMagicSignature(item) {
  const classification = classifyMagicItem(item);
  const itemSlot = resolveItemSlotGroup(item, classification);
  const heroDollSlots = mapSlotGroupToHeroDollSlots(itemSlot, classification.heroDollSlots);
  const magicItemActivities = buildMagicItemActivities(item);
  const nativeInstrumentSpellActivities = resolveNativeInstrumentSpellDefinition(item)
    ? magicItemActivities
    : null;
  const magicItemAutomation = resolveMagicItemAutomationDefinition(item);
  const magicItemAutomationEffects = buildMagicItemAutomationEffects(item);
  return JSON.stringify({
    templateVersion: MAGIC_TEMPLATE_VERSION,
    id: item.id,
    name: item.name,
    type: item.type,
    rarity: item.rarity,
    itemType: item.itemType,
    itemSubtype: item.itemSubtype,
    itemSlot,
    source: item.source,
    rank: clampRank(item.rank),
    materials: item.materials,
    bargaining: item.bargaining,
    costText: item.costText,
    impact: item.impact,
    attunement: item.attunement,
    isConsumable: item.isConsumable,
    description: item.description,
    priceGold: item.priceGold,
    foundryType: classification.documentType,
    foundrySubtype: classification.systemTypeValue,
    foundrySubtypeExtra: classification.systemTypeSubtype,
    foundryBaseItem: classification.baseItem,
    folderPath: buildFolderPath(classification),
    heroDollSlots,
    firearmClass: classification.firearmClass,
    ...(magicItemAutomation || magicItemAutomationEffects.length ? {
      magicItemAutomation: {
        version: MAGIC_ITEM_AUTOMATION_VERSION,
        definition: magicItemAutomation,
        effects: magicItemAutomationEffects,
        activities: magicItemActivities
      }
    } : {}),
    ...(nativeInstrumentSpellActivities ? {
      nativeInstrumentSpellActivities: {
        version: NATIVE_INSTRUMENT_SPELL_ACTIVITY_VERSION,
        activities: nativeInstrumentSpellActivities
      }
    } : {})
  });
}

function getMagicItemIcon(item, _classification, iconLookup = null) {
  return resolveNamedIcon(item?.name, iconLookup, DEFAULT_MAGIC_ITEM_ICON);
}

function buildMetadataRows(item, classification) {
  return [
    ["Материалы", item.materials || null],
    ["Торг", item.bargaining || null],
    ["Цена", item.costText || null],
    ["Вэлью", item.priceGold ? `${item.priceGold} зм` : null],
    ["Влиятельность", item.impact || null]
  ].filter(([, value]) => value !== null && value !== undefined && value !== "");
}

function buildDescriptionHtml(item, classification) {
  const metadataRows = buildMetadataRows(item, classification);
  return `
    <section class="rebreya-gear-item">
      ${item.description
        ? `<p>${escapeHtml(item.description)}</p>`
        : "<p>Описание магического предмета пока не заполнено.</p>"}
      ${metadataRows.length ? `
        <ul>
          ${metadataRows.map(([label, value]) => `<li><strong>${escapeHtml(label)}:</strong> ${escapeHtml(value)}</li>`).join("")}
        </ul>
      ` : ""}
    </section>
  `.trim();
}

export function buildSystemData(item, classification, descriptionHtml) {
  const price = getNativeMagicItemPrice(item);
  const baseData = {
    description: {
      value: descriptionHtml,
      chat: ""
    },
    unidentified: {
      description: ""
    },
    quantity: 1,
    price: {
      value: price.value,
      denomination: price.denomination
    },
    weight: {
      value: 0,
      units: "lb"
    },
    rarity: normalizeRarity(item.rarity),
    properties: ["mgc"]
  };

  switch (classification.documentType) {
    case "weapon":
      baseData.type = {
        value: classification.systemTypeValue || "martialM",
        baseItem: classification.baseItem || ""
      };
      break;

    case "equipment":
      baseData.type = {
        value: classification.systemTypeValue || "wondrous",
        baseItem: classification.baseItem || ""
      };
      break;

    case "tool":
      baseData.type = {
        value: classification.systemTypeValue || "art",
        baseItem: classification.baseItem || ""
      };
      break;

    case "consumable":
      baseData.type = {
        value: classification.systemTypeValue || "potion",
        subtype: classification.systemTypeSubtype || ""
      };
      break;

    case "loot":
    default:
      baseData.type = {
        value: classification.systemTypeValue || "gear",
        subtype: classification.systemTypeSubtype || ""
      };
      break;
  }

  return baseData;
}

export function createMagicItemData(item, folderIdByPath, iconLookup = null) {
  const classification = classifyMagicItem(item);
  const itemSlot = resolveItemSlotGroup(item, classification);
  const heroDollSlots = mapSlotGroupToHeroDollSlots(itemSlot, classification.heroDollSlots);
  const rank = clampRank(item.rank);
  const folderPath = buildFolderPath(classification).join("/");
  const descriptionHtml = buildDescriptionHtml(item, classification);
  const magicItemAutomation = resolveMagicItemAutomationDefinition(item);
  const systemData = buildSystemData(item, classification, descriptionHtml);
  const magicItemActivities = buildMagicItemActivities(item);

  const nativeMagicBonus = NATIVE_MAGIC_ITEM_BONUSES.get(String(item?.id ?? "").trim());
  if (nativeMagicBonus) {
    if (classification.documentType === "weapon") {
      systemData.magicalBonus = nativeMagicBonus;
    }
    else if (classification.documentType === "equipment") {
      systemData.armor ??= {};
      systemData.armor.magicalBonus = nativeMagicBonus;
    }
  }

  if (magicItemActivities) {
    systemData.activities = magicItemActivities;
  }

  const itemId = String(item?.id ?? "").trim();
  const sharedUses = CHARGED_MAGIC_ITEM_SPELLS[itemId]?.uses
    ?? MAGIC_ITEM_UTILITY_DEFINITIONS[itemId]?.uses;
  if (sharedUses) {
    systemData.uses = buildDawnUses(sharedUses);
  }

  if (magicItemAutomation?.kind === "bagOfHolding") {
    systemData.capacity = magicItemAutomation.capacity ?? {
      count: null,
      volume: { value: 64, units: "ft3" },
      weight: { value: 500, units: "lb" }
    };
    systemData.weight = { value: 15, units: "lb" };
    systemData.properties = ["mgc", "weightlessContents"];
    systemData.type.value = "backpack";
  }
  const documentType = magicItemAutomation?.kind === "bagOfHolding"
    ? "container"
    : classification.documentType;

  return {
    name: item.name,
    type: documentType,
    img: getMagicItemIcon(item, classification, iconLookup),
    folder: folderIdByPath.get(folderPath) ?? null,
    effects: buildMagicItemAutomationEffects(item),
    ownership: {
      default: CONST.DOCUMENT_OWNERSHIP_LEVELS.OBSERVER
    },
    system: systemData,
    flags: {
      [MODULE_ID]: {
        managed: true,
        sourceType: "magicItem",
        magicItemId: item.id,
        signature: buildMagicSignature(item),
        rarity: item.rarity,
        itemType: item.itemType,
        itemSubtype: item.itemSubtype,
        itemSlot,
        heroDollSlots,
        rank,
        foundryType: documentType,
        foundrySubtype: classification.systemTypeValue ?? "",
        foundrySubtypeExtra: classification.systemTypeSubtype ?? "",
        foundryBaseItem: classification.baseItem ?? "",
        foundryFolder: folderPath,
        firearmClass: classification.firearmClass ?? "",
        magical: true,
        magicItemAutomation,
        restoreBardicInspiration: restoresBardicInspiration(item),
        attunement: item.attunement,
        bargaining: item.bargaining,
        itemBargaining: item.bargaining,
        isConsumable: item.isConsumable,
        value: Math.max(1, Math.round(toNumber(item.priceGold, 0))),
        priceGold: item.priceGold,
        source: item.source
      }
    }
  };
}

function getDesiredPackMetadata() {
  return {
    label: MAGIC_ITEMS_COMPENDIUM_LABEL,
    type: "Item",
    name: MAGIC_ITEMS_COMPENDIUM_NAME,
    system: game.system.id,
    ownership: {
      PLAYER: "OBSERVER",
      ASSISTANT: "OWNER"
    },
    flags: {
      dnd5e: {
        sourceBook: "Rebreya",
        types: ["loot", "weapon", "equipment", "tool", "consumable", "container"]
      }
    }
  };
}

async function ensurePack() {
  const desired = getDesiredPackMetadata();
  let pack = game.packs.get(PACK_ID);

  if (pack && pack.documentName !== desired.type) {
    if (typeof pack.deleteCompendium === "function") {
      await pack.deleteCompendium();
    }
    pack = null;
  }

  if (pack && desired.system && pack.metadata.system !== desired.system) {
    if (typeof pack.deleteCompendium === "function") {
      await pack.deleteCompendium();
    }
    pack = null;
  }

  if (!pack) {
    pack = await foundry.documents.collections.CompendiumCollection.createCompendium(desired);
  }

  try {
    await ensurePackSidebarFolder(pack, COMPENDIUM_SIDEBAR_FOLDER);
  }
  catch (error) {
    console.warn(`${MODULE_ID} | Failed to assign magic items compendium to sidebar folder '${COMPENDIUM_SIDEBAR_FOLDER.join("/")}'.`, error);
  }

  return pack;
}

async function getPackDocuments(pack) {
  const documents = await pack.getDocuments();
  return Array.isArray(documents) ? documents : [];
}

async function findMagicItemDocument(pack, magicItemId, fallbackName = "") {
  const normalizedId = String(magicItemId ?? "").trim();
  const normalizedFallbackName = normalizeMatchText(fallbackName);
  const index = await pack.getIndex({
    fields: [`flags.${MODULE_ID}.magicItemId`]
  });
  const indexEntry = index.find((entry) => {
    const entryMagicItemId = String(foundry.utils.getProperty(entry, `flags.${MODULE_ID}.magicItemId`) ?? "").trim();
    if (normalizedId && entryMagicItemId === normalizedId) {
      return true;
    }

    return normalizedFallbackName && normalizeMatchText(entry.name) === normalizedFallbackName;
  });

  if (indexEntry) {
    return pack.getDocument(indexEntry._id ?? indexEntry.id);
  }

  const documents = await pack.getDocuments();
  return documents.find((entry) => {
    const entryMagicItemId = String(entry.getFlag(MODULE_ID, "magicItemId") ?? "").trim();
    if (normalizedId && entryMagicItemId === normalizedId) {
      return true;
    }

    return normalizedFallbackName && normalizeMatchText(entry.name) === normalizedFallbackName;
  }) ?? null;
}

export class MagicItemsCompendiumService {
  constructor({
    gameProvider = () => globalThis.game,
    consoleProvider = () => globalThis.console,
    diffObject = null,
    isActiveGm = isActiveGmClient
  } = {}) {
    this.gameProvider = gameProvider;
    this.consoleProvider = consoleProvider;
    this.diffObject = diffObject;
    this.isActiveGm = isActiveGm;
  }

  async sync(items = MAGIC_ITEMS) {
    if (!game.user?.isGM || !isDnd5eWorld()) {
      return null;
    }

    const normalizedItems = normalizeMagicItems(items);
    const pack = await ensurePack();
    const documents = await getPackDocuments(pack);
    const iconLookup = await buildNamedIconLookup(MAGIC_ICON_SEARCH_PATHS, { forceRefresh: true });
    let folderIdByPath = new Map();
    await syncManagedDocumentsOnActiveGm(game, {
      pack,
      entries: normalizedItems,
      documents,
      sourceIdOfEntry: (item) => item.id,
      sourceIdOfDocument: (document) => document.getFlag(MODULE_ID, "managed")
        ? document.getFlag(MODULE_ID, "magicItemId")
        : "",
      signatureOfEntry: (item) => JSON.stringify([
        buildMagicSignature(item),
        resolveNamedIcon(item.name, iconLookup, DEFAULT_MAGIC_ITEM_ICON)
      ]),
      signatureOfDocument: (document) => JSON.stringify([
        document.getFlag(MODULE_ID, "signature"),
        String(document.img ?? "").trim() || DEFAULT_MAGIC_ITEM_ICON
      ]),
      prepareFolders: async () => {
        try {
          folderIdByPath = await ensureCompendiumFolders(
            pack,
            normalizedItems.map((item) => buildFolderPath(classifyMagicItem(item)))
          );
        }
        catch (error) {
          console.warn(`${MODULE_ID} | Failed to prepare compendium folders for magic pack.`, error);
        }
      },
      createData: (item) => createMagicItemData(item, folderIdByPath, iconLookup),
      updateData: (_document, item) => {
        const data = createMagicItemData(item, folderIdByPath, iconLookup);
        delete data._id;
        return data;
      }
    });
    return game.packs.get(PACK_ID) ?? pack;
  }

  async syncEquippedMagicItems(options = {}) {
    return this.syncOwnedMagicItems(options);
  }

  async syncOwnedMagicItems({ dryRun = false, reportToConsole = true } = {}) {
    const foundryGame = this.gameProvider?.() ?? globalThis.game;
    const report = {
      dryRun: dryRun === true,
      actorsScanned: 0,
      itemsScanned: 0,
      updated: [],
      unchanged: [],
      unresolved: [],
      unresolvedChoices: [],
      skipped: [],
      errors: []
    };
    const emptyRow = (reason) => ({
      actorId: "",
      actorName: "",
      itemId: "",
      itemName: "",
      reason
    });

    if (foundryGame?.system?.id !== DND5E_SYSTEM_ID) {
      report.errors.push(emptyRow("not-dnd5e-world"));
      return report;
    }
    if (!this.isActiveGm?.(foundryGame)) {
      report.errors.push(emptyRow("not-active-gm"));
      return report;
    }

    const syncedPack = await this.sync();
    const pack = foundryGame.packs?.get?.(PACK_ID) ?? syncedPack;
    if (!pack) {
      throw new Error(`Magic items compendium '${PACK_ID}' is unavailable after sync.`);
    }
    const packDocuments = await getPackDocuments(pack);
    const packSources = packDocuments.map((document) => {
      const source = typeof document?.toObject === "function" ? document.toObject() : foundry.utils.deepClone(document);
      source.uuid = String(document?.uuid ?? source?.uuid ?? "");
      return source;
    });
    const index = buildMagicItemIdentityIndex(MAGIC_ITEMS, packSources);
    const projections = new Map(packDocuments
      .map((document) => buildMagicItemAutomationProjection(document))
      .filter((projection) => projection.magicItemId)
      .map((projection) => [projection.magicItemId, projection]));
    const actors = Array.isArray(foundryGame.actors?.contents)
      ? foundryGame.actors.contents
      : Array.from(foundryGame.actors?.values?.() ?? []);

    for (const actor of actors) {
      const actorId = String(actor?.id ?? actor?._id ?? "");
      const actorName = String(actor?.name ?? "");
      if (actor?.type !== "character") {
        report.skipped.push({ actorId, actorName, itemId: "", itemName: "", reason: "unsupported-actor-type" });
        continue;
      }

      report.actorsScanned += 1;
      const items = Array.isArray(actor.items?.contents)
        ? actor.items.contents
        : Array.from(actor.items?.values?.() ?? []);
      report.itemsScanned += items.length;
      const updates = [];
      const plannedRows = [];

      for (const item of items) {
        const row = {
          actorId,
          actorName,
          itemId: String(item?.id ?? item?._id ?? ""),
          itemName: String(item?.name ?? ""),
          reason: ""
        };
        const resolution = resolveEmbeddedMagicItemIdentity(item, index);
        if (resolution.status === "deferred") {
          report.skipped.push({ ...row, reason: resolution.reason });
          continue;
        }
        if (resolution.status === "native") {
          report.skipped.push({ ...row, reason: resolution.reason });
          continue;
        }
        if (resolution.status === "unresolved-choice") {
          report.unresolvedChoices.push({ ...row, reason: resolution.reason });
          continue;
        }
        if (resolution.status !== "resolved") {
          report.unresolved.push({ ...row, reason: resolution.reason });
          continue;
        }

        const projection = projections.get(resolution.magicItemId);
        if (!projection) {
          report.unresolved.push({ ...row, reason: "automation-projection-not-found" });
          continue;
        }
        const merge = buildEmbeddedMagicItemPatch(item, projection, resolution);
        if (merge.status === "unresolved") {
          report.unresolved.push({ ...row, reason: merge.reason });
          continue;
        }
        if (merge.status === "unchanged") {
          report.unchanged.push({ ...row, reason: "already-current" });
          continue;
        }
        const diffObject = this.diffObject ?? globalThis.foundry?.utils?.diffObject;
        if (typeof diffObject === "function" && typeof item?.toObject === "function") {
          const documentDiff = diffObject(item.toObject(), merge.update);
          if (documentDiff && typeof documentDiff === "object" && Object.keys(documentDiff).length === 0) {
            report.unchanged.push({ ...row, reason: "already-current" });
            continue;
          }
        }
        updates.push(merge.update);
        plannedRows.push({ ...row, reason: report.dryRun ? "dry-run-update" : "updated" });
      }

      if (!updates.length) {
        continue;
      }
      if (report.dryRun) {
        report.updated.push(...plannedRows);
        continue;
      }
      try {
        await actor.updateEmbeddedDocuments("Item", updates);
        report.updated.push(...plannedRows);
      }
      catch (error) {
        report.errors.push({
          actorId,
          actorName,
          itemId: "",
          itemName: "",
          reason: "actor-update-failed"
        });
        this.consoleProvider?.()?.warn?.(`${MODULE_ID} | Failed to sync owned magic items for '${actorName}'.`, error);
      }
    }

    const tableRows = [
      ...report.updated.map((row) => ({ status: "updated", ...row })),
      ...report.unchanged.map((row) => ({ status: "unchanged", ...row })),
      ...report.unresolved.map((row) => ({ status: "unresolved", ...row })),
      ...report.unresolvedChoices.map((row) => ({ status: "unresolved-choice", ...row })),
      ...report.skipped.map((row) => ({ status: "skipped", ...row })),
      ...report.errors.map((row) => ({ status: "error", ...row }))
    ];
    if (reportToConsole === true) {
      this.consoleProvider?.()?.table?.(tableRows);
    }
    return report;
  }

  async getMagicItemDocument(magicItemId, fallbackName = "") {
    const pack = game.packs.get(PACK_ID);
    if (!pack) {
      return null;
    }

    return findMagicItemDocument(pack, magicItemId, fallbackName);
  }

  async openMagicItem(magicItemId, fallbackName = "") {
    const document = await this.getMagicItemDocument(magicItemId, fallbackName);
    if (!document) {
      ui.notifications?.warn("Запись магического предмета не найдена в компендиуме.");
      return null;
    }

    await document.sheet?.render?.(true);
    const app = document.sheet;
    if (typeof app?.bringToFront === "function") {
      app.bringToFront();
    }
    return document;
  }
}
