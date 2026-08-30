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
} from "./magic-item-embedded-sync.js?v=1.4.187-full-magic-item-catalog";
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
const MAGIC_ITEM_AUTOMATION_VERSION = 1;
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
    spells: [spell24("Scorching Ray", "phbsplScorchingR", 2, { uses: { max: 1 } })]
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
    activities: [{
      key: "comet-flight",
      name: "Звёздный полёт",
      activation: "bonus",
      cost: 1,
      chatFlavor: "На 10 минут получите скорость полёта, равную скорости ходьбы, и способность парить."
    }]
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
  }
};
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
  ["амулет-благочестия", { dc: true, partial: true }],
  ["барабан-задающего-ритм", { dc: true, partial: false }],
  ["лунный-серп", { dc: true, partial: true }],
  ["универсальный-инструмент", { dc: true, partial: true }],
  ["жезл-хранителя-договора", { dc: true, partial: true }],
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
      { key: "system.attributes.ac.bonus", mode: EFFECT_MODE_ADD, value: "+1", priority: 20 },
      { key: "system.bonuses.abilities.save", mode: EFFECT_MODE_ADD, value: "+1", priority: 20 },
      { key: "system.attributes.init.roll.mode", mode: EFFECT_MODE_ADD, value: "1", priority: 20 },
      { key: "system.skills.prc.roll.mode", mode: EFFECT_MODE_ADD, value: "1", priority: 20 }
    ]
  }],
  ["жезл-бдительности-2", {
    suffix: "vigilance",
    label: "Бдительность",
    partial: true,
    changes: [
      { key: "system.attributes.ac.bonus", mode: EFFECT_MODE_ADD, value: "+1", priority: 20 },
      { key: "system.bonuses.abilities.save", mode: EFFECT_MODE_ADD, value: "+1", priority: 20 },
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
  ["посох-магов", 2], ["посох-силы", 2], ["посох-ударов", 3], ["солнечный-посох", 1]
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
  ["посох-костяного-когтя", {
    suffix: "bone-claw-spell-attack", label: "Атака заклинанием", partial: true,
    changes: spellcastingChanges(1, { dc: false })
  }],
  ["посох-ослепляющий-небеса", {
    suffix: "sky-blinder-spell-attack", label: "Атака заклинанием", partial: true,
    changes: spellcastingChanges(1, { dc: false })
  }]
])) {
  PASSIVE_MAGIC_ITEM_CHANGE_DEFINITIONS.set(id, definition);
}
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
  "корона-несущего-гнев",
  "мантия-мистраля",
  "обруч-сжигания",
  "плащ-летучей-мыши",
  "плащ-паука",
  "посох-лечения",
  "посох-мороза",
  "посох-огня",
  "сокрушитель-сумерек",
  "тиара-кружащихся-комет",
  "штормовой-пояс"
]);
const ACTIVITY_AUTOMATION_NOTES = new Map([
  ["аметистовый-магнетит", "Заклинание и два простых действия автоматизированы; преимущество на спасброски Силы и остальные свойства остаются ручными."],
  ["посох-огня", "Заклинания и общий пул зарядов автоматизированы; проверка уничтожения после расхода последнего заряда остаётся ручной."],
  ["посох-мороза", "Заклинания и общий пул зарядов автоматизированы; проверка уничтожения после расхода последнего заряда остаётся ручной."],
  ["посох-лечения", "Заклинания и общий пул зарядов автоматизированы; проверка уничтожения после расхода последнего заряда остаётся ручной."]
]);
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
const NATIVE_MAGIC_BONUS_AUDIT_IDS = new Set(NATIVE_MAGIC_ITEM_BONUSES.keys());

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
  if (definition.recovery) {
    return buildFormulaRecovery(definition.max, definition.recovery);
  }
  return {
    spent: 0,
    max: String(definition.max),
    recovery: [{
      period: "dawn",
      type: "recoverAll",
      formula: ""
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
    type: "utility",
    name: definition.name,
    activation: {
      type: definition.activation,
      value: definition.activation === "special" ? null : 1,
      condition: "",
      override: false
    },
    consumption: {
      scaling: { allowed: false, max: "" },
      spellSlot: false,
      targets: definition.cost === null
        ? []
        : [itemUseConsumptionTarget(String(definition.cost))]
    },
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
        targets: sharedUses
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
        challenge: spell.saveDc
          ? { attack: null, save: spell.saveDc, override: true }
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

    if (NATIVE_MAGIC_BONUS_AUDIT_IDS.has(id)) {
      const isWeapon = item?.itemType === "Оружие" || id.startsWith("оружие-");
      return {
        id,
        name,
        existingAutomation: "Нет в managed-проекции",
        proposedAutomation: isWeapon
          ? "Native dnd5e system.magicalBonus"
          : "Native dnd5e system.armor.magicalBonus",
        status: "full",
        reason: "Однозначный native dnd5e бонус +1/+2/+3; Active Effect не создаётся."
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
