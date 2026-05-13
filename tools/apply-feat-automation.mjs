import crypto from "node:crypto"
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const MODULE_ID = "rebreya-main"
const VERSION = "0.8-dnd5e-5.2.5"
const AUTOMATION_FLAG = { [MODULE_ID]: { automation: true } }
const MODE_ADD = 2
const MODE_UPGRADE = 4
const MODE_OVERRIDE = 5

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const ROOT_DIR = path.resolve(__dirname, "..")
const PACK_DIR = path.join(ROOT_DIR, "cherty-v08-foundry-2014-import-pack")
const ITEMS_PATH = path.join(PACK_DIR, "cherty-v08-foundry-2014-items.json")
const BUNDLE_PATH = path.join(PACK_DIR, "cherty-v08-foundry-2014-bundle.json")
const REPORT_PATH = path.join(ROOT_DIR, "docs", "feat-automation-report.md")

const SKILLS = {
    acr: "Акробатика",
    ani: "Уход за животными",
    arc: "Магия",
    ath: "Атлетика",
    dec: "Обман",
    his: "История",
    ins: "Проницательность",
    itm: "Запугивание",
    inv: "Расследование",
    med: "Медицина",
    nat: "Природа",
    prc: "Восприятие",
    prf: "Выступление",
    per: "Убеждение",
    rel: "Религия",
    slt: "Ловкость рук",
    ste: "Скрытность",
    sur: "Выживание"
}

const TOOLS = {
    alchemist: "инструменты алхимика",
    calligrapher: "инструменты каллиграфа",
    cartographer: "инструменты картографа",
    cook: "инструменты повара",
    disguise: "набор для грима",
    painter: "инструменты художника",
    poisoner: "набор отравителя",
    tinker: "инструменты жестянщика"
}

const SKILL_PROFICIENCIES = {
    akrobat: ["acr"],
    voditel: ["ani"],
    diplomat: ["per"],
    dressirovschik: ["ani"],
    smekalistost: ["inv"],
    teolog: ["rel"],
    empat: ["ins"],
    "drug-dlya-vseh": ["per", "dec"],
    "torgovaya-hvatka": ["per"],
    "rebenok-surovyh-zim": ["sur"],
    "kochevoe-proshloe": ["sur"],
    "obostrennye-chuvstva": ["prc"],
    "ugrozhayuschie-manery": ["itm"],
    "gorodskoy-iskatel": ["inv"],
    "potomstvennyy-shahter": ["nat"],
    "kollektsioner-spleten": ["ins"],
    "vkus-k-roskoshi": ["prf"],
    "kochevoy-govor": ["dec"],
    religioznost: ["rel"],
    "zhizn-v-strahe": ["ste"],
    "blizost-s-pleteniem": ["arc"],
    "nam-ne-privykat": ["slt"],
    "pervaya-pomosch": ["med"],
    "zakon-sily": ["ath"],
    "lovkie-dvizheniya": ["acr"]
}

const TOOL_PROFICIENCIES = {
    "alhimik-praktikant": [{ tool: "alchemist", mode: MODE_UPGRADE }],
    gurman: [{ tool: "cook", mode: MODE_UPGRADE }],
    "shef-povar": [{ tool: "cook", mode: MODE_ADD }],
    mehanizator: [{ tool: "tinker", mode: MODE_ADD }],
    "umelyy-zhestyanschik": [{ tool: "tinker", mode: MODE_UPGRADE }],
    "goblinskaya-maskirovka": [{ tool: "disguise", mode: MODE_UPGRADE }],
    "illyuziya-zhizni": [
        { tool: "painter", mode: MODE_UPGRADE, value: "2" },
        { tool: "calligrapher", mode: MODE_UPGRADE }
    ],
    "duh-avantyurizma": [{ tool: "cartographer", mode: MODE_UPGRADE }],
    otravitel: [{ tool: "poisoner", mode: MODE_UPGRADE }]
}

const CULTURAL_WEAPON_PROFICIENCIES = {
    "trenirovka-s-kuroviyskim-oruzhiem": [
        ["quarterstaff", "Боевой посох"],
        ["lightcrossbow", "Арбалет, легкий"],
        ["estok", "Эсток"],
        ["rapier", "Рапира"],
        ["heavycrossbow", "Арбалет, тяжелый"]
    ],
    "trenirovka-s-gudadskim-oruzhiem": [
        ["handaxe", "Ручной топор"],
        ["sling", "Праща"],
        ["warhammer", "Боевой молот"],
        ["boevaya-kosa", "Боевая коса"],
        ["longbow", "Длинный лук"]
    ],
    "trenirovka-s-oruzhiem-menega-dvarfiyskim": [
        ["lighthammer", "Лёгкий молот"],
        ["dart", "Дротик"],
        ["maul", "Молот"],
        ["warpick", "Боевая кирка"],
        ["heavycrossbow", "Арбалет, тяжелый"]
    ],
    "trenirovka-s-oruzhiem-maytena": [
        ["greatclub", "Палица"],
        ["shortbow", "Короткий лук"],
        ["sablya", "Сабля"],
        ["spear", "Копьё"],
        ["kompozitnyy-luk", "Композитный лук"]
    ],
    "trenirovka-s-esharskim-oruzhiem": [
        ["dagger", "Кинжал"],
        ["sling", "Праща"],
        ["shamshir", "Шамшир"],
        ["whip", "Кнут"],
        ["luk-vsadnika", "Лук всадника"]
    ],
    "trenirovka-s-zomarskim-oruzhiem": [
        ["mace", "Булава"],
        ["lightcrossbow", "Арбалет, легкий"],
        ["shortsword", "Короткий меч"],
        ["warhammer", "Боевой молот"],
        ["handcrossbow", "Арбалет, ручной"]
    ],
    "trenirovka-s-oruzhiem-teblina": [
        ["dagger", "Кинжал"],
        ["sling", "Праща"],
        ["scimitar", "Скимитар"],
        ["sablya", "Сабля"],
        ["blowgun", "Духовая трубка"]
    ],
    "trenirovka-s-azadranskim-oruzhiem": [
        ["greatclub", "Палица"],
        ["dart", "Дротик"],
        ["longsword", "Длинный меч"],
        ["kavaleriyskaya-pika", "Кавалерийская пика"],
        ["kompozitnyy-luk", "Композитный лук"]
    ],
    "trenirovka-s-umeliluanskim-oruzhiem": [
        ["spear", "Копье"],
        ["shortbow", "Короткий лук"],
        ["longsword", "Длинный меч"],
        ["greatsword", "Двуручный меч"],
        ["heavycrossbow", "Арбалет, тяжелый"]
    ],
    "trenirovka-s-nirianskim-oruzhiem": [
        ["sickle", "Серп"],
        ["dart", "Дротик"],
        ["katana", "Катана"],
        ["kinzhal-na-tsepi", "Кинжал на цепи"],
        ["mnogozaryadnyy-arbalet", "Многозарядный арбалет"]
    ],
    "trenirovka-s-oruzhiem-teokratii": [
        ["club", "Дубинка"],
        ["shortbow", "Короткий лук"],
        ["shamshir", "Шамшир"],
        ["flail", "Цеп"],
        ["heavycrossbow", "Арбалет, тяжелый"]
    ],
    "trenirovka-s-oruzhiem-yultan-glasta-elfiyskim": [
        ["spear", "Копье"],
        ["shortbow", "Короткий лук"],
        ["estok", "Эсток"],
        ["longbow", "Длинный лук"],
        ["kompozitnyy-luk", "Композитный лук"]
    ],
    "trenirovka-s-oruzhiem-ilduina": [
        ["sickle", "Серп"],
        ["lightcrossbow", "Арбалет, легкий"],
        ["glaive", "Глефа"],
        ["morningstar", "Моргенштерн"],
        ["luk-vsadnika", "Лук всадника"]
    ],
    "trenirovka-s-pontvantskim-oruzhiem": [
        ["kostyanoy-topor", "Костяной топор"],
        ["sling", "Праща"],
        ["scimitar", "Скимитар"],
        ["whip", "Кнут"],
        ["longbow", "Длинный лук"]
    ],
    "trenirovka-s-oruzhiem-golkranda-orochim": [
        ["shortsword", "Короткий меч"],
        ["spear", "Копье"],
        ["dlinnaya-bulava", "Длинная булава"],
        ["tsepnoy-serp", "Цепной серп"],
        ["longbow", "Длинный лук"]
    ]
}

const STATUS_EFFECTS = {
    prone: {
        label: "Лежащий ничком",
        icon: "systems/dnd5e/icons/svg/statuses/prone.svg"
    },
    "rebreya-clumsy": {
        label: "Неуклюжий",
        icon: "icons/svg/falling.svg"
    },
    "rebreya-entangled-mind": {
        label: "Запутанный",
        icon: "icons/svg/daze.svg"
    },
    "rebreya-frightened": {
        label: "Испуг",
        icon: "systems/dnd5e/icons/svg/statuses/frightened.svg"
    },
    "rebreya-provoked": {
        label: "Спровоцированный",
        icon: "icons/svg/target.svg"
    },
    "rebreya-restrained": {
        label: "Сдержанный",
        icon: "systems/dnd5e/icons/svg/statuses/restrained.svg"
    },
    "rebreya-surrounded": {
        label: "Окружённый",
        icon: "icons/svg/target.svg"
    },
    "rebreya-charged": {
        label: "Заряженный",
        icon: "icons/svg/lightning.svg"
    },
    "rebreya-twisted": {
        label: "Скрученный",
        icon: "icons/svg/net.svg"
    }
}

const ABILITY_ALIASES = [
    { key: "str", label: "Сила", pattern: /сил(ы|а|е|у|ой)?/iu },
    { key: "dex", label: "Ловкость", pattern: /ловкост(и|ь|ью)?/iu },
    { key: "con", label: "Телосложение", pattern: /телосложени(я|е|ю|ем)?/iu },
    { key: "int", label: "Интеллект", pattern: /интеллект(а|у|ом|е)?/iu },
    { key: "wis", label: "Мудрость", pattern: /мудрост(и|ь|ью)?/iu },
    { key: "cha", label: "Харизма", pattern: /харизм(ы|а|е|у|ой)?/iu }
]

const SKILL_PATTERNS = {
    acr: /акробатик/iu,
    ani: /уход(?:а|ом)? за животными|животн/iu,
    arc: /магии|магия|магическ/iu,
    ath: /атлетик/iu,
    dec: /обман/iu,
    his: /истори/iu,
    ins: /проницательн/iu,
    itm: /запугиван|запугив/iu,
    inv: /расследован/iu,
    med: /медицин/iu,
    nat: /природ/iu,
    prc: /восприяти/iu,
    prf: /выступлен/iu,
    per: /убеждени/iu,
    rel: /религи/iu,
    slt: /ловкост[ьи] рук/iu,
    ste: /скрытн/iu,
    sur: /выживан/iu
}

const TOOL_PATTERNS = {
    alchemist: /инструмент[а-я\s-]{0,24}алхимик|алхимическ[а-я\s-]{0,20}инструмент/iu,
    calligrapher: /инструмент[а-я\s-]{0,24}каллиграф|каллиграфическ[а-я\s-]{0,20}инструмент/iu,
    cartographer: /инструмент[а-я\s-]{0,24}картограф|картографическ[а-я\s-]{0,20}инструмент/iu,
    cook: /инструмент[а-я\s-]{0,24}повар|поварск[а-я\s-]{0,20}инструмент/iu,
    disguise: /набор[а-я\s-]{0,20}грима|инструмент[а-я\s-]{0,20}грима/iu,
    painter: /инструмент[а-я\s-]{0,24}художник|художественн[а-я\s-]{0,20}инструмент/iu,
    poisoner: /набор[а-я\s-]{0,20}отравител|инструмент[а-я\s-]{0,20}отравител/iu,
    tinker: /инструмент[а-я\s-]{0,24}жестянщик|жестянщицк[а-я\s-]{0,20}инструмент/iu
}

const ARMOR_PROFICIENCIES = [
    { value: "lgt", label: "лёгкими доспехами", pattern: /легк(ими|их|ие|ой|ую)\s+доспех|лёгк(ими|их|ие|ой|ую)\s+доспех/iu },
    { value: "med", label: "средними доспехами", pattern: /средн(ими|их|ие|ей|юю)\s+доспех/iu },
    { value: "hvy", label: "тяжёлыми доспехами", pattern: /тяжел(ыми|ых|ые|ой|ую)\s+доспех|тяжёл(ыми|ых|ые|ой|ую)\s+доспех/iu },
    { value: "shl", label: "щитами", pattern: /щит(ами|ы|ов|ом)?/iu }
]

const DAMAGE_TYPES = [
    { value: "acid", label: "кислотой", pattern: /кислот/iu },
    { value: "cold", label: "холодом", pattern: /холод/iu },
    { value: "fire", label: "огнём", pattern: /огн|плам/iu },
    { value: "force", label: "силовым уроном", pattern: /силов/iu },
    { value: "lightning", label: "электричеством", pattern: /электр|молни/iu },
    { value: "necrotic", label: "некротической энергией", pattern: /некрот/iu },
    { value: "poison", label: "ядом", pattern: /яд(ом|а|у|овит)|отрав/iu },
    { value: "psychic", label: "психической энергией", pattern: /психич/iu },
    { value: "radiant", label: "излучением", pattern: /излучен|лучист/iu },
    { value: "thunder", label: "громом", pattern: /гром/iu },
    { value: "bludgeoning", label: "дробящим уроном", pattern: /дробящ/iu },
    { value: "piercing", label: "колющим уроном", pattern: /колющ/iu },
    { value: "slashing", label: "рубящим уроном", pattern: /рубящ/iu }
]

const CONDITION_IMMUNITIES = [
    { value: "blinded", label: "Ослеплённый", pattern: /ослеплен|ослеплён/iu },
    { value: "charmed", label: "Очарованный", pattern: /очарован/iu },
    { value: "deafened", label: "Оглохший", pattern: /оглохш|глух/iu },
    { value: "diseased", label: "болезни", pattern: /болезн/iu },
    { value: "frightened", label: "Испуганный", pattern: /испуг|испуган|страх/iu },
    { value: "grappled", label: "Схваченный", pattern: /схвачен|захвачен/iu },
    { value: "paralyzed", label: "Парализованный", pattern: /парализ/iu },
    { value: "poisoned", label: "Отравленный", pattern: /отравлен/iu },
    { value: "prone", label: "Лежащий ничком", pattern: /ничком/iu },
    { value: "restrained", label: "Сдержанный", pattern: /сдержан/iu },
    { value: "stunned", label: "Ошеломлённый", pattern: /ошеломл|ошеломлён/iu },
    { value: "unconscious", label: "Без сознания", pattern: /без сознания/iu }
]

const STATUS_KEYWORDS = [
    { statusId: "rebreya-frightened", value: 1, pattern: /испуг|испуган|страх/iu },
    { statusId: "rebreya-restrained", value: null, pattern: /сдержан/iu },
    { statusId: "rebreya-entangled-mind", value: null, pattern: /запутан/iu },
    { statusId: "rebreya-clumsy", value: 1, pattern: /неуклюж/iu },
    { statusId: "rebreya-slowed", value: null, pattern: /замедлен/iu },
    { statusId: "rebreya-weakened", value: 1, pattern: /ослаблен/iu },
    { statusId: "prone", value: null, pattern: /ничком|сбит[а-я\s]{0,12}с ног/iu }
]

const WEAPON_PROFICIENCY_VALUES = new Map([
    ["алебарда", "halberd"],
    ["арбалет, легкий", "lightcrossbow"],
    ["арбалет легкий", "lightcrossbow"],
    ["легкий арбалет", "lightcrossbow"],
    ["арбалет, ручной", "handcrossbow"],
    ["ручной арбалет", "handcrossbow"],
    ["арбалет, тяжелый", "heavycrossbow"],
    ["тяжелый арбалет", "heavycrossbow"],
    ["боевая кирка", "warpick"],
    ["боевой молот", "warhammer"],
    ["боевой посох", "quarterstaff"],
    ["боевой топор", "battleaxe"],
    ["булава", "mace"],
    ["глефа", "glaive"],
    ["двуручный меч", "greatsword"],
    ["длинный лук", "longbow"],
    ["длинный меч", "longsword"],
    ["дротик", "dart"],
    ["дубинка", "club"],
    ["духовая трубка", "blowgun"],
    ["кинжал", "dagger"],
    ["кистень", "flail"],
    ["кнут", "whip"],
    ["копье", "spear"],
    ["копьё", "spear"],
    ["короткий лук", "shortbow"],
    ["короткий меч", "shortsword"],
    ["легкий молот", "lighthammer"],
    ["лёгкий молот", "lighthammer"],
    ["молот", "maul"],
    ["моргенштерн", "morningstar"],
    ["палица", "greatclub"],
    ["пика", "pike"],
    ["праща", "sling"],
    ["рапира", "rapier"],
    ["ручной топор", "handaxe"],
    ["секира", "greataxe"],
    ["серп", "sickle"],
    ["скимитар", "scimitar"],
    ["сеть", "net"],
    ["трезубец", "trident"],
    ["цеп", "flail"],
    ["шпага", "rapier"],
    ["палаша", "palash"],
    ["палаш", "palash"],
    ["сабля", "sablya"],
    ["катана", "katana"],
    ["эсток", "estok"],
    ["коса", "kosa"],
    ["кастет", "kastet"],
    ["боевая коса", "boevaya-kosa"],
    ["двусторонний топор", "dvustoronniy-topor"],
    ["костяной топор", "kostyanoy-topor"],
    ["молот всадника", "molot-vsadnika"],
    ["двусторонний молот", "dvustoronniy-molot"],
    ["кинжал на цепи", "kinzhal-na-tsepi"],
    ["длинная булава", "dlinnaya-bulava"],
    ["цепной серп", "tsepnoy-serp"],
    ["меч палача", "mech-palacha"],
    ["металлическая перчатка", "metallicheskaya-perchatka"],
    ["шамшир", "shamshir"],
    ["лук всадника", "luk-vsadnika"],
    ["композитный лук", "kompozitnyy-luk"],
    ["многозарядный арбалет", "mnogozaryadnyy-arbalet"],
    ["кавелерийская пика", "kavaleriyskaya-pika"],
    ["кавалерийская пика", "kavaleriyskaya-pika"]
])

const STATIC_EFFECTS = {
    ...Object.fromEntries(Object.entries(CULTURAL_WEAPON_PROFICIENCIES).map(([identifier, weapons]) => [
        identifier,
        weapons.map(([value, label]) => weaponProficiency(value, label))
    ])),
    aristokratichnost: [
        skillBonus("ins", "2", "Бонус +2 к Проницательности"),
        skillBonus("inv", "2", "Бонус +2 к Расследованию"),
        skillBonus("his", "2", "Бонус +2 к Истории")
    ],
    atletichnyy: [
        change("Скорость лазания", "system.attributes.movement.climb", "@attributes.movement.walk", MODE_UPGRADE, "Скорость лазания не ниже скорости ходьбы")
    ],
    bditelnyy: [
        change("Инициатива", "system.attributes.init.bonus", "@prof", MODE_ADD, "Бонус мастерства к инициативе")
    ],
    "bystraya-noga": [
        change("Скорость ходьбы", "system.attributes.movement.walk", "5", MODE_ADD, "+5 футов к скорости ходьбы")
    ],
    vnimatelnyy: [
        passiveBonus("prc", "@prof", "Бонус мастерства к пассивному Восприятию"),
        passiveBonus("inv", "@prof", "Бонус мастерства к пассивному Расследованию")
    ],
    "hrustalnyy-glaz": [
        change("Темное зрение", "system.attributes.senses.darkvision", "30", MODE_ADD, "+30 футов темного зрения")
    ],
    "infernalnoe-teloslozhenie": [
        resistance("cold", "Сопротивление холоду"),
        resistance("poison", "Сопротивление яду")
    ],
    "magiya-pepla": [
        conditionImmunity("diseased", "Иммунитет к болезням"),
        conditionImmunity("poisoned", "Иммунитет к состоянию Отравленный")
    ],
    "neozhidannoe-primenenie": [
        change("Скорость", "system.attributes.movement.walk", "5", MODE_ADD, "+5 футов к скорости ходьбы")
    ],
    "pensiya-veterana": [
        change("Максимум хитов", "system.attributes.hp.bonuses.overall", "-1", MODE_ADD, "-1 к максимуму хитов")
    ],
    "pervye-shagi-v-kriminale": [
        skillBonus("ste", "2", "Бонус +2 к Скрытности"),
        skillBonus("ins", "2", "Бонус +2 к Проницательности"),
        skillBonus("prc", "2", "Бонус +2 к Восприятию")
    ],
    podvizhnyy: [
        change("Скорость", "system.attributes.movement.walk", "10", MODE_ADD, "+10 футов к скорости ходьбы")
    ],
    "shipastaya-shkura": [
        change("Запугивание", "system.skills.itm.value", "1", MODE_ADD, "Владение Запугиванием; если уже владеет, повышает до компетентности")
    ],
    "srazhenie-vslepuyu": [
        change("Слепое зрение", "system.attributes.senses.blindsight", "10", MODE_UPGRADE, "Слепое зрение 10 футов")
    ],
    strelba: [
        change("Дальнобойные атаки", "system.bonuses.rwak.attack", "floor(@prof / 2)", MODE_ADD, "Половина БМ к атакам дальнобойным оружием")
    ],
    "ukrotivshiy-zarazu": [
        change("Скорость лазания", "system.attributes.movement.climb", "@attributes.movement.walk", MODE_UPGRADE, "Скорость лазания не ниже скорости ходьбы")
    ],
    "yarost-gruumsha": [
        resistance("fire", "Сопротивление огню")
    ],
    "demonicheskoe-pirshestvo": [
        resistance("fire", "Сопротивление огню")
    ],
    "dampirovo-prevraschenie": [
        resistance("necrotic", "Сопротивление некротической энергии")
    ],
    "atakuyuschiy-zaklinatel": [
        change("Скорость", "system.attributes.movement.walk", "5", MODE_ADD, "+5 футов к скорости ходьбы")
    ],
    "schitovaya-trenirovka": [
        change("Владение щитами", "system.traits.armorProf.value", "shl", MODE_ADD, "Владение щитами")
    ]
}

const CURATED_ACTIVITIES = {
    "agressivnyy-provokator": [
        {
            type: "utility",
            name: "Провоцировать",
            activation: "action",
            targetType: "creature",
            appliedEffects: [
                statusEffect("rebreya-provoked", null, "Состояние Спровоцированный добавлено к действию Провоцировать; цель выбирается в workflow")
            ],
            note: "Действие Провоцировать добавлено как activity со статусом Спровоцированный; замена атаки применяется вручную"
        },
        {
            type: "utility",
            name: "Провоцировать",
            activation: "bonus",
            targetType: "creature",
            appliedEffects: [
                statusEffect("rebreya-provoked", null, "Состояние Спровоцированный добавлено к бонусному действию Провоцировать; цель выбирается в workflow")
            ],
            note: "Бонусное действие Провоцировать добавлено как activity со статусом Спровоцированный; лимит один раз в ход отслеживается вручную"
        }
    ],
    akrobat: [
        { type: "check", name: "Акробатический маневр", activation: "bonus", ability: "dex", skill: "acr", dc: "15", note: "Бонусная проверка Акробатики Сл 15 добавлена" },
        { type: "check", name: "Работа ног", activation: "reaction", ability: "dex", skill: "acr", dc: "15", note: "Реакция с проверкой Акробатики Сл 15 добавлена" },
        { type: "save", name: "Мельница", activation: "reaction", saveAbility: "dex", dc: "12 + @prof", damage: { number: 1, denomination: 6, types: ["bludgeoning"] }, note: "Реакция Мельница со спасброском Ловкости и уроном 1к6 добавлена" }
    ],
    dressirovschik: [
        { type: "utility", name: "Команда зверю", activation: "bonus", range: 60, note: "Бонусное действие команды зверю добавлено; действие и перемещение зверя применяются вручную" }
    ],
    smekalistost: [
        { type: "utility", name: "Поиск", activation: "bonus", note: "Поиск бонусным действием добавлен как activity" }
    ],
    "parnyy-taktik": [
        { type: "utility", name: "Помощь", activation: "bonus", range: 10, note: "Помощь бонусным действием добавлена как activity" }
    ],
    "krepkiy-duh": [
        { type: "utility", name: "Боевая закалка", activation: "bonus", uses: { max: "1", period: "lr" }, note: "Бонусное действие 1/длительный отдых добавлено; количество исцеления бросается вручную" }
    ],
    "voodushevlyayuschiy-lider": [
        { type: "utility", name: "Воодушевляющая речь", activation: "minute", activationValue: 10, uses: { max: "@prof", period: "lr" }, note: "Воодушевляющая речь БМ/длительный отдых добавлена как activity; временные хиты применяются вручную" }
    ],
    "dar-metallicheskogo-drakona": [
        { type: "utility", name: "Защитные крылья", activation: "reaction", range: 5, uses: { max: "@prof", period: "lr" }, note: "Реакция с расходом БМ/длительный отдых добавлена; бонус к КД цели применяется вручную" }
    ],
    "dar-samotsvetnogo-drakona": [
        { type: "utility", name: "Телекинетическое возмездие", activation: "reaction", range: 10, uses: { max: "@prof", period: "lr" }, note: "Реакция с расходом БМ/длительный отдых добавлена; перемещение цели применяется вручную" }
    ],
    "dar-tsvetnogo-drakona": [
        { type: "utility", name: "Цветная инфузия", activation: "bonus", uses: { max: "1", period: "lr" }, note: "Бонусное действие 1/длительный отдых добавлено; тип урона и дополнительный урон применяются вручную" },
        { type: "utility", name: "Мгновенное сопротивление", activation: "reaction", uses: { max: "@prof", period: "lr" }, note: "Реакция с расходом БМ/длительный отдых добавлена; тип сопротивления выбирается вручную" }
    ],
    "drakoniy-strah": [
        {
            type: "save",
            name: "Драконий страх",
            activation: "action",
            saveAbility: "wis",
            dc: "12 + @prof",
            range: 30,
            area: true,
            appliedEffects: [
                statusEffect("rebreya-frightened", 2, "Испуг 2 на 1 минуту добавлен на провал спасброска; повтор спасброска при получении урона ведется вручную", { duration: seconds(60) })
            ],
            note: "Спасбросок Мудрости Сл 12 + БМ добавлен; расход Дыхания и повтор спасброска при уроне требуют ручной проверки"
        }
    ],
    "ustrashayuschiy-ryk": [
        {
            type: "save",
            name: "Устрашающий рык",
            activation: "action",
            saveAbility: "wis",
            dc: "@attributes.spell.dc",
            range: 30,
            area: true,
            uses: { max: "@prof", period: "lr" },
            appliedEffects: [
                statusEffect("rebreya-frightened", 3, "Испуг 3 до конца следующего хода добавлен на провал спасброска", { duration: rounds(1) }),
                statusEffect("rebreya-frightened", 1, "Испуг 1 добавлен на успех спасброска", { duration: rounds(1), onSave: true })
            ],
            note: "Действие с массовым спасброском Мудрости, расходом БМ/длительный отдых и состоянием Испуг 3/1 добавлено"
        }
    ],
    "rytsar-mecha": [
        {
            type: "save",
            name: "Деморализующий удар",
            activation: "special",
            saveAbility: "wis",
            dc: "@attributes.spell.dc",
            targetType: "creature",
            uses: { max: "@prof", period: "lr" },
            appliedEffects: [
                statusEffect("rebreya-frightened", 3, "Испуг 3 до конца следующего хода владельца добавлен на провал спасброска", { duration: rounds(1), specialDuration: "turnEndSource" }),
                statusEffect("rebreya-frightened", 1, "Испуг 1 добавлен на успех спасброска", { duration: rounds(1), onSave: true, specialDuration: "turnEndSource" })
            ],
            note: "Спасбросок Мудрости после попадания оружием и состояния Испуг 3/1 добавлены; триггер «один раз за ход после попадания» выбирается вручную"
        }
    ],
    "otkaz-ot-bozhestvennosti": [
        {
            type: "save",
            name: "Почерневшая священная сила",
            activation: "bonus",
            saveAbility: "wis",
            dc: "@attributes.spell.dc",
            range: 30,
            targetType: "creature",
            uses: { max: "@prof", period: "lr" },
            appliedEffects: [
                statusEffect("rebreya-frightened", 2, "Испуг 2 на 1 минуту добавлен на провал спасброска", { duration: seconds(60) }),
                statusEffect("rebreya-restrained", null, "Сдержанный на 1 минуту добавлен на провал спасброска", { duration: seconds(60) }),
                statusEffect("rebreya-restrained", null, "Сдержанный на 1 минуту добавлен на успех спасброска", { duration: seconds(60), onSave: true })
            ],
            note: "Бонусное действие со спасброском Мудрости, расходом БМ/длительный отдых и состояниями Испуг/Сдержанный добавлено; повторные спасброски в конце хода ведутся вручную"
        }
    ],
    "bezdonnaya-udacha": [
        { type: "utility", name: "Ведро удачи", activation: "reaction", range: 30, note: "Реакция переброса добавлена; проверка триггера и блокировка Удачливого применяются вручную" }
    ],
    "master-maskirovki": [
        {
            type: "save",
            name: "Сорвать маску",
            activation: "action",
            saveAbility: "wis",
            dc: "@attributes.spell.dc",
            range: 30,
            area: true,
            appliedEffects: [
                statusEffect("rebreya-clumsy", 3, "Неуклюжий 3 на 1 минуту добавлен на провал спасброска", { duration: seconds(60) })
            ],
            note: "Действие Сорвать маску со спасброском Мудрости и состоянием Неуклюжий 3 добавлено; урон 2d6 психической энергией на успех и повторные спасброски ведутся вручную"
        },
        {
            type: "save",
            name: "Сбить с толку",
            activation: "bonus",
            saveAbility: "wis",
            dc: "@attributes.spell.dc",
            range: 30,
            targetType: "creature",
            appliedEffects: [
                statusEffect("rebreya-entangled-mind", null, "Запутанный до конца следующего хода добавлен на провал спасброска", { duration: rounds(1) })
            ],
            note: "Бонусное действие со спасброском Мудрости и состоянием Запутанный добавлено"
        },
        {
            type: "utility",
            name: "Сбить с толку",
            activation: "reaction",
            range: 30,
            targetType: "creature",
            appliedEffects: [
                statusEffect("rebreya-entangled-mind", null, "Запутанный до конца следующего хода добавлен к реакции", { duration: rounds(1) })
            ],
            note: "Реакция наложения Запутанного добавлена; триггер успешной проверки против маскировки отслеживается вручную"
        }
    ],
    "master-grubogo-oruzhiya": [
        {
            type: "utility",
            name: "Дезориентация",
            activation: "bonus",
            targetType: "creature",
            appliedEffects: [
                statusEffect("rebreya-entangled-mind", null, "Запутанный до конца следующего хода цели добавлен к Дезориентации", { duration: rounds(1), specialDuration: "turnEnd" })
            ],
            note: "Бонусное действие Дезориентация со статусом Запутанный добавлено; триггер критического попадания Грубым оружием проверяется вручную"
        },
        {
            type: "utility",
            name: "Защитная стойка",
            activation: "bonus",
            note: "Бонусное действие Защитная стойка добавлено; переменный бонус к КД зависит от оружия и характеристики, поэтому применяется вручную"
        }
    ],
    "master-vypadov": [
        {
            type: "utility",
            name: "Активная оборона",
            activation: "special",
            targetType: "self",
            appliedEffects: [
                statusEffect("rebreya-surrounded", null, "Окружённый до начала следующего хода добавлен к Активной обороне", { duration: rounds(1), specialDuration: "turnStartSource" })
            ],
            note: "Наложение состояния Окружённый добавлено; +5 футов досягаемости до конца текущего хода применяется вручную"
        }
    ],
    "reaktivnyy-provokator": [
        {
            type: "utility",
            name: "Заряженный толчок",
            activation: "special",
            targetType: "self",
            uses: { max: "1", period: "sr" },
            appliedEffects: [
                statusEffect("rebreya-charged", null, "Заряженный до конца текущего хода добавлен к толчку", { duration: rounds(1), specialDuration: "turnEndSource", statusMeta: { subtype: "shove" } })
            ],
            note: "Состояние Заряженный (Толчок) и расход 1/короткий отдых добавлены; дополнительное действие атаки Толчок и провокация от перемещения обрабатываются вручную"
        }
    ],
    "tochnyy-razrez": [
        {
            type: "utility",
            name: "Разрез сухожилия",
            activation: "special",
            targetType: "creature",
            appliedEffects: [
                statusEffect("rebreya-restrained", null, "Сдержанный добавлен к Разрезу сухожилия; снятие через исцеление, проверку Медицины или 24 часа ведется вручную")
            ],
            note: "Наложение состояния Сдержанный добавлено; штраф без БМ/замена 2d6 скрытой атаки, иммунитет существ без ног и условия снятия проверяются вручную"
        }
    ],
    "silnyy-udar": [
        {
            type: "utility",
            name: "Сильный удар: сдержать",
            activation: "special",
            targetType: "creature",
            appliedEffects: [
                statusEffect("rebreya-restrained", 10, "Сдержанный 10 до конца следующего хода добавлен как вариант Сильного удара", { duration: rounds(1), specialDuration: "turnEnd" })
            ],
            note: "Вариант Сильного удара со статусом Сдержанный 10 добавлен; расход Выносливости камня и выбор альтернативного эффекта остаются за игроком"
        },
        {
            type: "utility",
            name: "Сильный удар: альтернативный эффект",
            activation: "special",
            targetType: "creature",
            note: "Отдельный вариант для штрафа к следующей атаке, помехи спасброску или бонуса к атаке добавлен как напоминание; конкретный выбор применяется вручную"
        }
    ],
    "master-proklyatiy": [
        {
            type: "utility",
            name: "Глубокое проклятье: Харизма",
            activation: "special",
            targetType: "creature",
            appliedEffects: [
                statusEffect("rebreya-restrained", 10, "Сдержанный 10 добавлен к вторичному эффекту проклятья Харизмы")
            ],
            note: "Вторичный эффект проклятья Харизмы со статусом Сдержанный 10 добавлен; выбор проклятой характеристики и срабатывание на 8 на кости Сглаза отслеживаются вручную"
        }
    ],
    "master-telekineza": [
        {
            type: "save",
            name: "Телекинетический напор",
            activation: "action",
            saveAbility: "str",
            dc: "@attributes.spell.dc",
            range: 60,
            targetType: "creature",
            targetCount: "10",
            uses: { max: "1", period: "lr" },
            appliedEffects: [
                statusEffect("prone", null, "Падение ничком добавлено на провал спасброска", { duration: seconds(60) }),
                statusEffect("prone", null, "Падение ничком добавлено на успех спасброска", { onSave: true })
            ],
            note: "Действие со спасброском Силы, до 10 целей, расходом 1/длительный отдых и падением ничком добавлено; запрет подняться, концентрация и повторные спасброски ведутся вручную"
        }
    ],
    perehvat: [
        { type: "utility", name: "Перехват", activation: "reaction", note: "Реакция Перехват добавлена; уменьшение урона применяется вручную" }
    ],
    "yarost-gruumsha": [
        { type: "utility", name: "Ярость Груумша", activation: "bonus", duration: { value: "1", units: "minute" }, note: "Бонусное действие ярости добавлено; случайная таблица эффектов и число применений ведутся вручную" }
    ],
    "demonicheskoe-pirshestvo": [
        {
            type: "save",
            name: "Топот",
            activation: "bonus",
            saveAbility: "str",
            dc: "12 + @prof",
            range: 10,
            area: true,
            appliedEffects: [
                statusEffect("prone", null, "Состояние Лежащий ничком добавлено на провал спасброска")
            ],
            note: "Топот со спасброском Силы Сл 12 + БМ и падением ничком добавлен; труднопроходимая область на 1 час отмечается вручную"
        }
    ],
    "ukrotivshiy-zarazu": [
        {
            type: "utility",
            name: "Подавить заразу",
            activation: "bonus",
            uses: { max: "1", period: "lr" },
            duration: { value: "1", units: "minute" },
            note: "Бонусное действие Подавить заразу 1/длительный отдых на 1 минуту добавлено; отключение преимуществ заразы применяется вручную"
        },
        {
            type: "utility",
            name: "Захват лозой",
            activation: "action",
            targetType: "creature",
            appliedEffects: [
                statusEffect("rebreya-twisted", 10, "Скрученный 10 добавлен к успешному захвату лозой")
            ],
            note: "Действие Захват лозой со статусом Скрученный 10 добавлено; проверка успешного захвата и урон ядом в начале хода цели ведутся вручную"
        },
        {
            type: "utility",
            name: "Точная атака лозой",
            activation: "special",
            uses: { max: "@prof", period: "lr" },
            note: "Расход БМ/длительный отдых для точной атаки лозой добавлен; выбор +5 футов досягаемости или +2 к атаке и урону применяется вручную"
        }
    ],
    "master-tsepi": [
        {
            type: "utility",
            name: "Захват цепью",
            activation: "reaction",
            range: 10,
            targetType: "creature",
            appliedEffects: [
                statusEffect("rebreya-twisted", null, "Скрученный добавлен к Захвату цепью; значение равно досягаемости цепи")
            ],
            note: "Реакция Захват цепью со статусом Скрученный добавлена; сложенное состояние цепи, бросок атаки и ограничения цели отслеживаются вручную"
        }
    ],
    "master-tsepnogo-oruzhiya": [
        {
            type: "utility",
            name: "Захват цепным оружием",
            activation: "special",
            targetType: "creature",
            appliedEffects: [
                statusEffect("rebreya-twisted", null, "Скрученный добавлен к успешному захвату цепным оружием; значение равно досягаемости оружия")
            ],
            note: "Наложение Скрученного после попадания цепным оружием добавлено; выбор свойства, успешность захвата и увеличение значения при провокации ведутся вручную"
        }
    ],
    "master-klinkov": [
        {
            type: "utility",
            name: "Сдерживающая провоцированная атака",
            activation: "reaction",
            targetType: "creature",
            appliedEffects: [
                statusEffect("rebreya-restrained", 15, "Сдержанный 15 до конца следующего хода цели добавлен к провоцированной атаке Мечом", { duration: rounds(1), specialDuration: "turnEnd" })
            ],
            note: "Реакция со статусом Сдержанный 15 добавлена; попадание провоцированной атакой Мечом и отказ от дополнительного урона МУ 1 проверяются вручную"
        }
    ],
    "ottalkivayuschiy-vozglas": [
        {
            type: "save",
            name: "Возглас в душу",
            activation: "action",
            saveAbility: "con",
            dc: "@attributes.spell.dc",
            range: 30,
            area: true,
            templateType: "cone",
            appliedEffects: [
                statusEffect("rebreya-entangled-mind", null, "Запутанный до конца следующего хода добавлен на провал, если цель не отступила", { duration: rounds(1) })
            ],
            note: "Конус 30 футов со спасброском Телосложения и возможным Запутанным добавлен; выбор цели отступить на 10 футов ведется вручную"
        },
        {
            type: "save",
            name: "Слабый возглас",
            activation: "bonus",
            saveAbility: "con",
            dc: "@attributes.spell.dc",
            range: 5,
            area: true,
            note: "Бонусное действие со спасброском Телосложения в 5 футах добавлено; добровольное отступление целей на 5 футов применяется вручную"
        }
    ],
    "dampirovo-prevraschenie": [
        { type: "utility", name: "Облик летучей мыши", activation: "action", note: "Переключение облика добавлено как activity; изменение размера и скоростей применяется вручную" }
    ],
    borets: [
        {
            type: "utility",
            name: "Скрутить захваченное существо",
            activation: "action",
            targetType: "creature",
            appliedEffects: [
                statusEffect("rebreya-twisted", null, "Скрученный до конца следующего хода добавлен к успешной повторной атаке Захват", { duration: rounds(1), specialDuration: "turnEndSource" })
            ],
            note: "Действие скручивания добавлено со статусом Скрученный; проверка успешного Захвата и скорость владельца 0 применяются вручную"
        }
    ],
    "gluhaya-oborona": [
        {
            type: "utility",
            name: "Глухая оборона",
            activation: "special",
            targetType: "self",
            appliedEffects: [
                multiChange("Глухая оборона", [
                    { key: "system.attributes.ac.bonus", value: "@abilities.str.mod" },
                    { key: "system.bonuses.mwak.attack", value: "-@abilities.str.mod" },
                    { key: "system.bonuses.rwak.attack", value: "-@abilities.str.mod" },
                    { key: "system.bonuses.msak.attack", value: "-@abilities.str.mod" },
                    { key: "system.bonuses.rsak.attack", value: "-@abilities.str.mod" }
                ], "Бонус к КД и штраф к атакам до начала следующего хода добавлены как self-effect; предел 5 и момент включения проверяются вручную", {
                    transfer: false,
                    duration: rounds(1),
                    specialDuration: "turnStartSource"
                })
            ],
            note: "Self-effect для обмена атаки на КД добавлен; предел модификатора Силы до 5 и включение перед Атакой проверяются вручную"
        }
    ],
    "master-srednih-dospehov": [
        {
            type: "utility",
            name: "Средний доспех: максимум Ловкости",
            activation: "special",
            targetType: "self",
            appliedEffects: [
                temporarySelfChange("Средний доспех: +1 КД", "system.attributes.ac.bonus", "1", "+1 КД отражает повышение предела Ловкости среднего доспеха с 2 до 3; носимый доспех и Ловкость 16+ проверяются вручную")
            ],
            note: "Тоггл +1 КД для среднего доспеха добавлен; отсутствие помехи к Скрытности и условия доспеха проверяются вручную"
        }
    ],
    "master-ognestrelnogo-oruzhiya": [
        {
            type: "utility",
            name: "Настроить огнестрельное оружие",
            activation: "minute",
            activationValue: 10,
            targetType: "self",
            appliedEffects: [
                temporarySelfChange("Настройка огнестрела", "system.bonuses.rwak.attack", "1", "+1 к атаке огнестрельным оружием на 1 минуту добавлен как self-effect; выбранное оружие и первый выстрел проверяются вручную", { duration: seconds(60) })
            ],
            note: "10-минутная настройка огнестрела и +1 к атаке добавлены; конкретный ствол, первый выстрел и обвесы остаются ручной частью"
        }
    ],
    "poisk-slabostey-vraga": [
        {
            type: "utility",
            name: "Поиск слабостей",
            activation: "action",
            range: 60,
            targetType: "creature",
            note: "Действие анализа цели добавлено; преимущество и РКУ 2 для следующей атаки до конца следующего хода применяются в workflow вручную"
        },
        {
            type: "utility",
            name: "Наводка на слабости",
            activation: "special",
            targetType: "creature",
            note: "Вариант Помощи с РКУ 1 добавлен как activity; сама атака союзника выбирается вручную"
        }
    ],
    "metkie-zaklinaniya": [
        {
            type: "utility",
            name: "Надёжность заклинателя",
            activation: "special",
            uses: { max: "@prof", period: "lr" },
            note: "Расход БМ/длительный отдых для замены d20 на 10 добавлен; выбор атаки заклинанием и укрытие цели проверяются вручную"
        }
    ],
    lekar: [
        {
            type: "heal",
            name: "Стабилизация комплектом целителя",
            activation: "action",
            targetType: "creature",
            healing: { formula: "1", types: ["healing"] },
            note: "Исцеление 1 хита при стабилизации комплектом целителя добавлено; расход комплекта и состояние цели проверяются вручную"
        },
        {
            type: "check",
            name: "Боевая медицина",
            activation: "action",
            ability: "wis",
            skill: "med",
            dc: "15",
            targetType: "creature",
            note: "Проверка Медицины для Боевой медицины добавлена; выбранная Сл, количество исцеления, расход комплекта и иммунитет цели на 1 день применяются вручную"
        }
    ],
    lovets: [
        {
            type: "utility",
            name: "Метка охотника",
            activation: "bonus",
            uses: { max: "1", period: "lr" },
            targetType: "creature",
            note: "Наложение Метки охотника 1/длительный отдых добавлено; само заклинание выбирается/накладывается вручную"
        }
    ],
    vyzhivalschik: [
        {
            type: "utility",
            name: "Сигнал тревоги",
            activation: "minute",
            activationValue: 1,
            uses: { max: "1", period: "lr" },
            note: "Наложение Сигнала тревоги 1/длительный отдых добавлено; область и параметры заклинания применяются вручную"
        }
    ],
    uvorotlivyy: [
        {
            type: "utility",
            name: "Уворотливость против ближних врагов",
            activation: "special",
            targetType: "self",
            appliedEffects: [
                multiChange("Уворотливость", [
                    { key: "system.attributes.ac.bonus", value: "1" },
                    { key: "system.bonuses.abilities.save", value: "1" }
                ], "+1 к КД и спасброскам добавлен как self-effect; наличие врага в 10 футах проверяется вручную", {
                    transfer: false
                })
            ],
            note: "Тоггл +1 к КД и спасброскам добавлен; условие врага в пределах 10 футов проверяется вручную"
        }
    ],
    duelyant: [
        {
            type: "utility",
            name: "Дуэлянт",
            activation: "special",
            targetType: "self",
            appliedEffects: [
                temporarySelfChange("Дуэлянт: +2 урона", "system.bonuses.mwak.damage", "2", "+2 к урону рукопашным оружием добавлено как self-effect; оружие в одной руке и свободная вторая рука проверяются вручную")
            ],
            note: "Тоггл +2 к урону рукопашным оружием добавлен; условие одной руки проверяется вручную"
        }
    ],
    "srazhenie-metatelnym-oruzhiem": [
        {
            type: "utility",
            name: "Сражение метательным оружием",
            activation: "special",
            targetType: "self",
            appliedEffects: [
                temporarySelfChange("Метательное оружие: +2 урона", "system.bonuses.rwak.damage", "2", "+2 к урону дальнобойной атакой добавлено как self-effect; применять только для метательного оружия")
            ],
            note: "Тоггл +2 к урону добавлен; Foundry не отличает все метательные атаки стандартным полем, поэтому применять только для метательного оружия"
        }
    ],
    "srazhenie-v-legkom-dospehe": [
        {
            type: "utility",
            name: "Сражение в лёгком доспехе",
            activation: "special",
            targetType: "self",
            appliedEffects: [
                temporarySelfChange("Лёгкий доспех: скорость", "system.attributes.movement.walk", "5", "+5 футов скорости при лёгком доспехе добавлено как self-effect")
            ],
            note: "Тоггл +5 футов скорости добавлен; ношение лёгкого доспеха проверяется вручную"
        }
    ],
    "srazhenie-v-massivnyh-dospehah": [
        {
            type: "utility",
            name: "Сражение в массивных доспехах",
            activation: "special",
            targetType: "self",
            appliedEffects: [
                temporarySelfChange("Массивный доспех: +1 КД", "system.attributes.ac.bonus", "1", "+1 КД при среднем или тяжёлом доспехе добавлено как self-effect")
            ],
            note: "Тоггл +1 КД добавлен; ношение среднего или тяжёлого доспеха проверяется вручную"
        }
    ],
    "ubiytsa-magov": [
        {
            type: "utility",
            name: "Ломающий заклинания",
            activation: "reaction",
            targetType: "creature",
            note: "Реакция на начало наложения заклинания в досягаемости добавлена; атака, проверка базовой характеристики и потеря ячейки ведутся вручную"
        },
        {
            type: "utility",
            name: "Легендарный убийца",
            activation: "special",
            uses: { max: "1", period: "lr" },
            note: "Расход 1/длительный отдых для превращения проваленного спасброска Интеллекта/Мудрости/Харизмы в успех добавлен"
        }
    ],
    vezunchik: [
        {
            type: "utility",
            name: "Единица удачи",
            activation: "special",
            uses: { max: "3", period: "lr" },
            note: "Три единицы удачи с восстановлением на длительном отдыхе добавлены; выбор d20 после броска и отмена чужой удачи применяются вручную"
        }
    ],
    "dvarfiyskaya-stoykost": [
        {
            type: "utility",
            name: "Дварфийская стойкость",
            activation: "action",
            targetType: "self",
            note: "Исцеление при Уклонении через кость хитов добавлено; расход конкретной кости хитов и минимальное значение проверяются вручную"
        }
    ],
    "devyat-zhizney": [
        {
            type: "save",
            name: "Кошачья устойчивость",
            activation: "special",
            saveAbility: "con",
            dc: "15 - @prof",
            targetType: "self",
            uses: { max: "1", period: "lr" },
            note: "Спасбросок Телосложения Сл 15 - БМ и расход 1/длительный отдых добавлены; срабатывание при падении до 0 хитов проверяется вручную"
        }
    ],
    "drakonya-shkura": [
        {
            type: "utility",
            name: "Драконья шкура",
            activation: "special",
            targetType: "self",
            note: "Напоминание для природного КД 13 + Ловкость и когтей добавлено; формула КД, щит и естественное оружие настраиваются вручную на актёре"
        }
    ],
    medik: [
        {
            type: "check",
            name: "Золотые руки",
            activation: "special",
            ability: "wis",
            skill: "med",
            dc: "20",
            targetType: "creature",
            note: "Проверка Медицины Сл 20 во время короткого отдыха добавлена; выбор до шести существ и итог лечения применяются вручную"
        }
    ],
    "drakoni-krylya": [
        {
            type: "utility",
            name: "Драконьи крылья",
            activation: "special",
            targetType: "self",
            appliedEffects: [
                temporarySelfChange("Драконьи крылья", "system.attributes.movement.fly", "@attributes.movement.walk", "Скорость полёта не ниже скорости ходьбы добавлена как self-effect; тяжёлая броня и грузоподъёмность проверяются вручную", { mode: MODE_UPGRADE })
            ],
            note: "Тоггл скорости полёта равной скорости ходьбы добавлен; тяжёлая броня и перегруз проверяются вручную"
        }
    ],
    zaschita: [
        {
            type: "utility",
            name: "Защита щитом",
            activation: "special",
            range: 5,
            targetType: "creature",
            note: "Выбор существа в 5 футах для половинного укрытия добавлен как activity; само укрытие цели применяет мастер или игрок вручную"
        }
    ],
    "srazhenie-bolshim-oruzhiem": [
        {
            type: "utility",
            name: "Сражение большим оружием",
            activation: "special",
            note: "Напоминание для замены 1-2 на кости урона двуручного рукопашного оружия на 3 добавлено; пересчёт кости урона выполняется вручную"
        }
    ],
    "srazhenie-dvumya-oruzhiyami": [
        {
            type: "utility",
            name: "Сражение двумя оружиями",
            activation: "special",
            note: "Напоминание для добавления модификатора характеристики к урону второй атаки добавлено; конкретная вторая атака выбирается вручную"
        }
    ],
    "granichaschiy-potentsial": [
        {
            type: "utility",
            name: "Граничащий потенциал",
            activation: "special",
            targetType: "self",
            note: "Эффект после 5-футового шага добавлен как activity; преимущество и +5 футов досягаемости следующей рукопашной атаки применяются вручную"
        }
    ],
    "bezobidnyy-sharlatan": [
        {
            type: "check",
            name: "Скрыть компонент заклинания",
            activation: "special",
            ability: "cha",
            skill: "dec",
            dc: "@skills.inv.passive",
            targetType: "creature",
            note: "Проверка Обмана против пассивного Расследования добавлена; выбор вербального/соматического компонента и список наблюдателей применяются вручную"
        }
    ],
    artistichnyy: [
        {
            type: "check",
            name: "Подражание",
            activation: "special",
            ability: "cha",
            skill: "dec",
            dc: "@skills.ins.passive",
            targetType: "creature",
            note: "Противопоставленная проверка Обмана для подражания добавлена; преимущество к Выступлению/Обману в подходящей ситуации выбирается вручную"
        }
    ],
    "znanie-kamnya": [
        {
            type: "check",
            name: "Знание камня",
            activation: "special",
            ability: "int",
            skill: "his",
            dc: "",
            note: "Проверка Истории по происхождению каменной работы добавлена; компетентность в этой условной проверке применяется вручную"
        }
    ],
    "znanie-porod": [
        {
            type: "check",
            name: "Знание пород",
            activation: "special",
            ability: "int",
            skill: "his",
            dc: "",
            note: "Проверка Истории по происхождению работы по камню добавлена; владение/компетентность для этой условной проверки применяются вручную"
        }
    ],
    "adept-transmutatsii": [
        {
            type: "damage",
            name: "Ритуал трансмутации",
            activation: "minute",
            activationValue: 10,
            uses: { max: "1", period: "" },
            damage: { formula: "1d4", types: ["necrotic"] },
            note: "10-минутный ритуал, расход накопленного использования и 1d4 некротического урона добавлены; создаваемый предмет, стоимость и концентрация ведутся вручную"
        }
    ],
    "bolshoy-slovarnyy-zapas": [
        {
            type: "utility",
            name: "Сложная терминология: бонус",
            activation: "special",
            targetType: "self",
            appliedEffects: [
                temporarySelfChange("Сложная терминология: +2 Харизма", "system.abilities.cha.bonuses.check", "2", "+2 к проверкам Харизмы против менее умных существ добавлен как toggle")
            ],
            note: "Тоггл +2 к проверкам Харизмы добавлен; Интеллект собеседника и увеличение до +3 проверяются мастером"
        },
        {
            type: "utility",
            name: "Сложная терминология: штраф",
            activation: "special",
            targetType: "self",
            appliedEffects: [
                temporarySelfChange("Сложная терминология: -2 Харизма", "system.abilities.cha.bonuses.check", "-2", "-2 к проверкам Харизмы против не менее умных существ добавлен как toggle")
            ],
            note: "Тоггл -2 к проверкам Харизмы добавлен; Интеллект собеседника проверяется мастером"
        }
    ],
    "borets-s-titanami": [
        {
            type: "utility",
            name: "Захват/Толчок титана",
            activation: "special",
            targetType: "creature",
            note: "Возможность Захвата и Толчка существ на два размера больше добавлена как activity-напоминание; сама атака выполняется штатным действием Захват/Толчок"
        }
    ],
    "vtoraya-lichnost": [
        {
            type: "check",
            name: "Изменение личины",
            activation: "special",
            ability: "int",
            dc: "20",
            uses: { max: "1", period: "lr" },
            note: "Проверка Интеллекта Сл 20 и блокировка до длительного отдыха при провале добавлены; социальные связи и документы ведутся вручную"
        }
    ],
    "dalekiy-puteshestvennik": [
        {
            type: "check",
            name: "Сбор слухов",
            activation: "hour",
            activationValue: 4,
            ability: "cha",
            uses: { max: "1", period: "" },
            note: "4-часовой сбор слухов добавлен как activity с расходом; трёхдневный локальный кулдаун и содержание слухов ведутся вручную"
        }
    ],
    "dalnovidnyy-planirovschik": [
        {
            type: "utility",
            name: "Достать подготовленное снаряжение",
            activation: "special",
            uses: { max: "1", period: "" },
            note: "Расход подготовленного кармана снаряжения добавлен; покупка, лимит цены и конкретный предмет ведутся вручную"
        }
    ],
    "nachinayuschiy-remeslennik": [
        {
            type: "utility",
            name: "Заточка оружия",
            activation: "hour",
            activationValue: 2,
            targetType: "self",
            appliedEffects: [
                temporarySelfChange("Заточка: +1 урона", "system.bonuses.mwak.damage", "1", "+1 к урону заточенным рукопашным оружием добавлен как toggle до длительного отдыха")
            ],
            note: "2-часовая заточка и toggle +1 урона добавлены; выбор оружия/20 боеприпасов и перенос бонуса на конкретный предмет ведутся вручную"
        }
    ],
    "nachinayuschiy-tatuirovschik": [
        {
            type: "utility",
            name: "Создать или нанести татуировку",
            activation: "minute",
            activationValue: 10,
            uses: { max: "@prof", period: "lr" },
            note: "10-минутное создание/нанесение тату и лимит БМ добавлены; выбранный эффект тату, материалы и носитель ведутся вручную"
        },
        {
            type: "utility",
            name: "Тату: передвижение",
            activation: "special",
            targetType: "self",
            appliedEffects: [
                temporarySelfChange("Тату: +10 футов скорости", "system.attributes.movement.walk", "10", "+10 футов передвижения до конца хода добавлено как self-effect", { duration: rounds(1), specialDuration: "turnEndSource" })
            ],
            note: "Вариант тату на +10 футов передвижения добавлен; выбор преимущества/атаки/d4 остаётся за игроком"
        }
    ],
    "ugrozhayuschiy": [
        {
            type: "check",
            name: "Пугающий",
            activation: "special",
            ability: "cha",
            skill: "itm",
            dc: "@skills.wis.passive",
            range: 30,
            targetType: "creature",
            appliedEffects: [
                statusEffect("rebreya-frightened", 2, "Испуг 2 до конца следующего хода цели добавлен к успешной деморализации", { duration: rounds(1), specialDuration: "turnEnd" })
            ],
            note: "Состязание Запугивания против пассивной Мудрости и Испуг 2 добавлены; замена одной атаки выбирается вручную"
        }
    ],
    "dikiy-atakuyuschiy": [
        {
            type: "utility",
            name: "Переброс урона",
            activation: "special",
            note: "Один переброс костей урона оружием за ход добавлен как activity; выбор результата выполняется вручную в броске урона"
        }
    ],
    "master-gromozdkogo-oruzhiya": [
        {
            type: "damage",
            name: "Пожертвовать атаками",
            activation: "special",
            damage: { formula: "1d8", types: ["piercing"] },
            note: "Дополнительная кость урона за пожертвованную атаку добавлена как damage activity; число пожертвованных атак и кость оружия выбираются вручную"
        }
    ],
    "metkiy-strelok": [
        {
            type: "utility",
            name: "Меткий выстрел: без БМ",
            activation: "special",
            targetType: "self",
            appliedEffects: [
                multiChange("Меткий выстрел", [
                    { key: "system.bonuses.rwak.attack", value: "-@prof" },
                    { key: "system.bonuses.rwak.damage", value: "2 * @prof" }
                ], "Штраф без БМ к атаке и +2*БМ к урону дальнобойным оружием добавлены как toggle", {
                    transfer: false
                })
            ],
            note: "Тоггл штрафа к атаке и бонуса к урону добавлен; дальняя дистанция и уменьшение укрытия остаются правилами атаки"
        }
    ],
    "mnozhestvennyy-vystrel": [
        {
            type: "utility",
            name: "Множественный выстрел",
            activation: "special",
            targetType: "self",
            appliedEffects: [
                temporarySelfChange("Множественный выстрел: -2 атака", "system.bonuses.rwak.attack", "-2", "Базовый штраф -2 к следующей атаке луком добавлен как toggle")
            ],
            note: "Базовый штраф -2 добавлен; число стрел по уровню, отдельные цели и рост штрафа до -3/-4 ведутся вручную"
        }
    ],
    "neveroyatnaya-tochnost": [
        {
            type: "utility",
            name: "Максимальный критический урон",
            activation: "special",
            uses: { max: "1", period: "" },
            note: "Расход максимизации критического урона добавлен; восстановление после 10-минутного перерыва и отказ от доп. костей выполняются вручную"
        }
    ],
    "udushayuschaya-hvatka": [
        {
            type: "damage",
            name: "Удушающая хватка",
            activation: "special",
            targetType: "creature",
            damage: { formula: "1d10 + @abilities.str.mod", types: ["bludgeoning"] },
            note: "Урон 1d10 + модификатор Силы по захваченному существу добавлен; начало хода/освобождение и цель захвата проверяются вручную"
        },
        {
            type: "utility",
            name: "Рывок захвата",
            activation: "special",
            targetType: "self",
            appliedEffects: [
                temporarySelfChange("Рывок захвата: +10", "system.skills.ath.bonuses.check", "10", "+10 к проверке Захвата/Толчка добавлен как toggle")
            ],
            note: "Бонус +10 к проваленной проверке Захвата/Толчка добавлен; степень истощения и момент применения ведутся вручную"
        }
    ],
    "ekspert-v-dalekih-udarah": [
        {
            type: "utility",
            name: "Массивная атака",
            activation: "special",
            targetType: "creature",
            note: "Линейная повторная атака оружием с Досягаемостью добавлена как activity; область, цели и общий бросок атаки/урона ведутся вручную"
        },
        {
            type: "utility",
            name: "Цепляющие атаки",
            activation: "special",
            targetType: "creature",
            note: "Вариант Толкающего/притягивания добавлен как activity; наличие единственной цели в досягаемости проверяется вручную"
        }
    ],
    "ekspert-v-drobovikah": [
        {
            type: "utility",
            name: "Управление разбросом",
            activation: "special",
            targetType: "self",
            note: "Вариант добавления модификатора к урону Разброса и перенаправления разброса добавлен как activity; конкретная атака дробовиком ведётся вручную"
        }
    ],
    "plutovskaya-podgotovka": [
        {
            type: "damage",
            name: "Скрытая атака",
            activation: "special",
            damage: { formula: "1d6", types: [] },
            note: "Базовый урон Скрытой атаки 1d6 добавлен; рост каждые 4 уровня после взятия черты ведётся вручную"
        }
    ],
    "master-plut": [
        {
            type: "damage",
            name: "Скрытая атака: +1d6",
            activation: "special",
            damage: { formula: "1d6", types: [] },
            note: "Дополнительные 1d6 к ранее полученной Скрытой атаке добавлены; Невероятное Уклонение и Увёртливость добавляются отдельными умениями"
        }
    ],
    skrytnyy: [
        {
            type: "check",
            name: "Повторная Засада",
            activation: "special",
            ability: "dex",
            skill: "ste",
            dc: "",
            targetType: "self",
            appliedEffects: [
                temporarySelfChange("Повторная Засада: -5", "system.skills.ste.bonuses.check", "-5", "-5 к повторной Засаде добавлен как toggle")
            ],
            note: "Повторная Засада со штрафом -5 добавлена; условие скрытого перемещения и результат успеха/провала ведутся по описанию"
        }
    ],
    "sozdatel-patronov": [
        {
            type: "utility",
            name: "Создать патроны на отдыхе",
            activation: "minute",
            activationValue: 5,
            note: "Создание боеприпасов во время длительного отдыха с темпом 5 зм за 5 минут добавлено; стоимость, количество и материалы ведутся вручную"
        }
    ],
    stoykiy: [
        {
            type: "utility",
            name: "Минимум кости хитов",
            activation: "special",
            note: "Напоминание о минимуме восстановления от кости хитов добавлено; Foundry не умеет менять минимум броска Hit Dice стандартным Active Effect"
        }
    ],
    "ekspert-v-rabote-s-magicheskimi-predmetami": [
        {
            type: "utility",
            name: "Ускоренная настройка",
            activation: "minute",
            activationValue: 10,
            note: "10-минутная настройка на магический предмет добавлена; запрет делать это на коротком отдыхе проверяется вручную"
        },
        {
            type: "utility",
            name: "Множественная настройка",
            activation: "special",
            note: "Настройка на три магических предмета после короткого отдыха добавлена как activity; конкретные предметы выбираются вручную"
        }
    ],
    "umelyy-strelok": [
        {
            type: "utility",
            name: "Игнорировать ничком в дальнем бою",
            activation: "special",
            note: "Правило игнорирования помехи по лежащей ничком цели добавлено как activity; конкретная дальнобойная/огнестрельная атака проверяется workflow"
        }
    ],
    "ritualnyy-zaklinatel": [
        {
            type: "utility",
            name: "Переписать ритуал",
            activation: "hour",
            activationValue: 2,
            note: "Переписывание ритуала 2 часа за уровень добавлено; класс, книга, стоимость 50 зм/опыта и выбранные заклинания ведутся вручную"
        }
    ],
    "rasshirenie-istochnika": [
        {
            type: "utility",
            name: "Расширение источника",
            activation: "special",
            note: "Выбор увеличения маны или ячейки добавлен как activity; конкретный ресурс актёра и повторные взятия настраиваются вручную"
        }
    ],
    "put-tsi": [
        {
            type: "utility",
            name: "Очки Ци",
            activation: "special",
            uses: { max: "2", period: "sr" },
            note: "Пул 2 очка ци с восстановлением на коротком отдыхе добавлен как uses; сами умения Ци добавляются отдельными действиями"
        }
    ],
    "monasheskie-fokusy": [
        {
            type: "utility",
            name: "Очки Ци",
            activation: "special",
            uses: { max: "4", period: "sr" },
            note: "Пул ци увеличен до 4 как uses; Отражение снарядов, Медленное падение и Фокусировка на цели добавляются отдельными умениями"
        }
    ],
    "master-monah": [
        {
            type: "utility",
            name: "Очки Ци",
            activation: "special",
            uses: { max: "5", period: "sr" },
            note: "Пул ци увеличен до 5 как uses; Энергетические удары, Увёртливость и Спокойствие Разума добавляются отдельными умениями"
        }
    ],
    "prodolzhayuschiy-charodey": [
        {
            type: "utility",
            name: "Очки чародейства",
            activation: "special",
            uses: { max: "4", period: "lr" },
            note: "Запас очков чародейства увеличен до 4 как uses; Магическое Направление добавляется отдельным умением"
        }
    ],
    "elfiyskaya-tochnost": [
        {
            type: "utility",
            name: "Героическое преимущество",
            activation: "special",
            note: "Переключение преимущества в героическое преимущество добавлено как activity; наличие преимущества и подходящей характеристики атаки проверяется вручную"
        }
    ],
    "bystryy-polzun": [
        {
            type: "utility",
            name: "Ползти без штрафа",
            activation: "special",
            targetType: "self",
            note: "Состояние Лежащий ничком отслеживается Foundry, но отмена штрафа ползания не имеет штатного поля; добавлено activity-напоминание для применения нормальной скорости"
        }
    ],
    "takoy-sebe-rabotnik": [
        {
            type: "utility",
            name: "Пол-БМ к инструменту",
            activation: "special",
            note: "Добавлено activity для применения половины БМ к проверке инструмента; конкретный инструмент и отсутствие уже включённого БМ проверяются вручную"
        }
    ],
    "himik-lyubitel": [
        {
            type: "check",
            name: "Химический анализ",
            activation: "special",
            ability: "int",
            dc: "",
            targetType: "self",
            appliedEffects: [
                temporarySelfChange("Химия: +2", "system.abilities.int.bonuses.check", "2", "+2 к проверке опознания зелий/наркотиков добавлен как toggle")
            ],
            note: "Проверка химического анализа и toggle +2 добавлены; химическая область и половина БМ при владении проверяются вручную"
        }
    ],
    pronyra: [
        {
            type: "utility",
            name: "Спрятаться в слабом заслоне",
            activation: "special",
            note: "Возможность прятаться в слабом заслоне и не раскрывать позицию при промахе добавлена как activity; освещение и видимость проверяются вручную"
        }
    ],
    "master-bezoruzhnogo-boya": [
        {
            type: "utility",
            name: "Природное оружие",
            activation: "special",
            note: "Природное оружие как простое рукопашное оружие добавлено как activity-напоминание; конкретный предмет природного оружия и кость размера настраиваются на актёре вручную"
        }
    ],
    "ekspertnyy-boets": [
        {
            type: "utility",
            name: "Дополнительная атака",
            activation: "special",
            note: "Получение умения Дополнительная атака добавлено как activity-напоминание; классовая привязка и изменение числа атак на листе настраиваются вручную"
        }
    ],
    "ekspert-universalnogo-oruzhiya": [
        {
            type: "utility",
            name: "Универсальный хват",
            activation: "special",
            note: "Использование универсального урона одной рукой и смена оружейной группы добавлены как activity; конкретное оружие и группа выбираются вручную"
        }
    ],
    "prodolzhenie-ohoty": [
        {
            type: "utility",
            name: "Песнь свободы",
            activation: "special",
            targetType: "self",
            appliedEffects: [
                temporarySelfChange("Песнь свободы: +5 скорости", "system.attributes.movement.walk", "5", "+5 футов скорости до конца текущего хода добавлено как toggle", { duration: rounds(1), specialDuration: "turnEnd" })
            ],
            note: "Вариант боевой песни на +5 скорости добавлен; аура, союзники и выбранная песнь ведутся вручную"
        },
        {
            type: "utility",
            name: "Песнь заточения",
            activation: "special",
            targetType: "creature",
            appliedEffects: [
                temporarySelfChange("Песнь заточения: -5 скорости", "system.attributes.movement.walk", "-5", "-5 футов скорости добавлено как эффект; цель и аура проверяются вручную")
            ],
            note: "Вариант боевой песни на -5 скорости добавлен; враждебность, аура и начало хода проверяются вручную"
        }
    ],
    "boevoy-planirovschik": [
        {
            type: "utility",
            name: "Боевой план",
            activation: "special",
            uses: { max: "@prof", period: "lr" },
            note: "Расходы боевого планирования добавлены как activity; разведка, подготовка и выбранный бонус плана применяются вручную"
        }
    ]
}

const STATUS_OVERRIDES = {
    ...Object.fromEntries(Object.keys(CULTURAL_WEAPON_PROFICIENCIES).map((identifier) => [identifier, "automated"])),
    "bystraya-noga": "automated",
    "srazhenie-vslepuyu": "automated",
    "torgovaya-hvatka": "automated",
    "rebenok-surovyh-zim": "partial",
    "srazhenie-metatelnym-oruzhiem": "partial",
    "obostrennye-chuvstva": "automated",
    "ugrozhayuschie-manery": "automated",
    "gorodskoy-iskatel": "automated",
    "potomstvennyy-shahter": "automated",
    "kollektsioner-spleten": "automated",
    "vkus-k-roskoshi": "automated",
    "kochevoy-govor": "automated",
    religioznost: "automated",
    "zhizn-v-strahe": "automated",
    "blizost-s-pleteniem": "automated",
    "nam-ne-privykat": "automated",
    "pervaya-pomosch": "automated",
    "zakon-sily": "automated",
    "lovkie-dvizheniya": "automated"
}

const MANUAL_HINTS = [
    /на ваш выбор/iu,
    /по вашему выбору/iu,
    /на свой выбор/iu,
    /выберите/iu,
    /выбран/iu,
    /одобрение со стороны мастера/iu,
    /решает мастер/iu,
    /таблиц/iu,
    /один из/iu,
    /люб(ой|ую|ым|ая|ые)/iu,
    /если/iu,
    /когда/iu,
    /пока/iu,
    /социальн/iu,
    /ремесл/iu,
    /крафт/iu,
    /созда[её]те/iu
]

const MANUAL_REASON_PATTERNS = [
    { pattern: /на ваш выбор|на свой выбор|по вашему выбору|выберите|выбран|один из|таблиц/iu, reason: "есть выбор игрока или таблица вариантов" },
    { pattern: /одобрение со стороны мастера|решает мастер/iu, reason: "требуется решение мастера" },
    { pattern: /социальн|разговор|общени|репутац|интриг/iu, reason: "эффект зависит от социальной или нарративной ситуации" },
    { pattern: /ремесл|крафт|созда[её]те|материал|\bзм\b/iu, reason: "крафтовая часть требует ручного ведения" },
    { pattern: /если|когда|пока|до конца|до начала/iu, reason: "условие требует явного выбора момента, цели или включения эффекта в игре" }
]

const MECHANIC_LABELS = {
    effects: "Active Effects",
    activities: "Activities",
    skills: "владения/бонусы навыков",
    tools: "владения инструментами",
    weaponProficiencies: "владения оружием",
    movement: "скорость",
    senses: "чувства",
    resistance: "сопротивления",
    damageImmunity: "иммунитеты к урону",
    vulnerability: "уязвимости",
    conditionImmunity: "иммунитеты к состояниям",
    initiative: "инициатива",
    hp: "максимум хитов",
    armor: "владения доспехами/щитами",
    attacks: "бонусы к атаке",
    saves: "спасброски",
    damage: "урон",
    healing: "исцеление",
    uses: "ограничения использований",
    statuses: "состояния rebreya-main/dnd5e"
}

function change(label, key, value, mode, note, options = {}) {
    return {
        label,
        key,
        value,
        mode,
        note,
        mechanic: classifyKey(key),
        ...options
    }
}

function multiChange(label, changes, note, options = {}) {
    return {
        label,
        changes: changes.map((entry) => ({
            key: entry.key,
            mode: entry.mode ?? MODE_ADD,
            value: entry.value,
            priority: entry.priority ?? null
        })),
        note,
        mechanic: options.mechanic ?? "effects",
        ...options
    }
}

function skillBonus(skill, value, note) {
    return change(SKILLS[skill], `system.skills.${skill}.bonuses.check`, value, MODE_ADD, note)
}

function passiveBonus(skill, value, note) {
    return change(SKILLS[skill], `system.skills.${skill}.bonuses.passive`, value, MODE_ADD, note)
}

function resistance(value, note) {
    return change(note, "system.traits.dr.value", value, MODE_ADD, note)
}

function conditionImmunity(value, note) {
    return change(note, "system.traits.ci.value", value, MODE_ADD, note)
}

function damageImmunity(value, note) {
    return change(note, "system.traits.di.value", value, MODE_ADD, note)
}

function vulnerability(value, note) {
    return change(note, "system.traits.dv.value", value, MODE_ADD, note)
}

function weaponProficiency(value, label) {
    return change(label, "system.traits.weaponProf.value", value, MODE_ADD, `Владение оружием: ${label}`)
}

function temporarySelfChange(label, key, value, note, options = {}) {
    return change(label, key, value, options.mode ?? MODE_ADD, note, {
        transfer: false,
        ...options
    })
}

function midiAdvantage(label, key, note, options = {}) {
    return temporarySelfChange(label, key, "1", note, {
        mode: MODE_OVERRIDE,
        ...options
    })
}

function statusEffect(statusId, value, note, options = {}) {
    const config = STATUS_EFFECTS[statusId] ?? { label: statusId, icon: "icons/svg/aura.svg" }
    const valueSuffix = value === undefined || value === null ? "" : ` ${value}`
    return {
        label: options.label ?? `${config.label}${valueSuffix}`,
        img: config.icon,
        statusId,
        statusValue: value ?? null,
        statusMeta: options.statusMeta ?? {},
        note,
        duration: options.duration ?? null,
        specialDuration: options.specialDuration ?? null,
        transfer: false,
        onSave: options.onSave === true,
        changes: statusChanges(statusId, value),
        mechanic: "statuses"
    }
}

function statusChanges(statusId, value) {
    if (statusId === "rebreya-frightened") {
        const penalty = Math.max(1, Math.floor(Number(value ?? 1)))
        return ["mwak", "rwak", "msak", "rsak"].map((attackType) => ({
            key: `system.bonuses.${attackType}.attack`,
            mode: MODE_ADD,
            value: String(-penalty),
            priority: 20
        })).concat([
            {
                key: "system.bonuses.abilities.check",
                mode: MODE_ADD,
                value: String(-penalty),
                priority: 20
            }
        ])
    }

    return []
}

function rounds(value) {
    return { rounds: value }
}

function seconds(value) {
    return { seconds: value }
}

function classifyKey(key) {
    if (key.includes(".skills.")) return "skills"
    if (key.includes(".tools.")) return "tools"
    if (key.includes(".weaponProf.")) return "weaponProficiencies"
    if (key.includes(".movement.")) return "movement"
    if (key.includes(".senses.")) return "senses"
    if (key.includes(".dr.")) return "resistance"
    if (key.includes(".di.")) return "damageImmunity"
    if (key.includes(".dv.")) return "vulnerability"
    if (key.includes(".ci.")) return "conditionImmunity"
    if (key.includes(".init.")) return "initiative"
    if (key.includes(".hp.")) return "hp"
    if (key.includes(".armorProf.")) return "armor"
    if (key.includes(".ac.")) return "armor"
    if (key.includes(".bonuses.") && key.includes(".attack")) return "attacks"
    if (key.includes(".bonuses.") && key.includes(".damage")) return "damage"
    if (key.includes(".bonuses.abilities.save")) return "saves"
    if (key.includes(".abilities.") && key.includes(".bonuses.save")) return "saves"
    return "effects"
}

function stripHtml(value) {
    return String(value ?? "")
        .replace(/<br\s*\/?>/giu, " ")
        .replace(/<\/p>/giu, " ")
        .replace(/<[^>]+>/gu, " ")
        .replace(/&nbsp;/gu, " ")
        .replace(/\s+/gu, " ")
        .trim()
}

function normalizeAutomationText(value) {
    return stripHtml(value)
        .toLowerCase()
        .replace(/\u0451/gu, "\u0435")
        .replace(/[«»"“”'’`]/gu, "")
        .replace(/\s+/gu, " ")
        .trim()
}

function splitSentences(value) {
    return stripHtml(value)
        .split(/(?<=[.!?])\s+|[\n\r]+|;\s+/u)
        .map((entry) => entry.trim())
        .filter(Boolean)
}

function hasChoiceLanguage(value) {
    return /на ваш выбор|на свой выбор|по вашему выбору|выберите|выбираете|выбран|любой|любую|любые|любым|один из|одного из|одно из|несколько из|из списка|вариант/iu.test(value)
}

function hasConditionLanguage(value) {
    return /если|когда|пока|до конца|до начала|после того|в течение|при условии|только/iu.test(value)
}

function hasGrantLanguage(value) {
    return /получаете|приобретаете|владеете|получаешь|становитесь владельцем|да[её]т вам|добавляет/iu.test(value)
}

function sentenceHasSkill(sentence, skill) {
    return SKILL_PATTERNS[skill]?.test(sentence) === true
}

function maybeTemporaryChange(sentence, label, key, value, note, options = {}) {
    if (hasConditionLanguage(sentence)) {
        return temporarySelfChange(label, key, value, `${note}; условие включается игроком как временный эффект`, options)
    }

    return change(label, key, value, options.mode ?? MODE_ADD, note, options)
}

function addUniqueEffect(effects, effect) {
    const signature = effectSignature(effect)
    if (effects.some((entry) => effectSignature(entry) === signature)) {
        return
    }

    effects.push(effect)
}

function inferSkillEffects(sentences) {
    const effects = []

    for (const sentence of sentences) {
        const normalized = normalizeAutomationText(sentence)
        if (hasChoiceLanguage(normalized)) {
            continue
        }

        for (const skill of Object.keys(SKILL_PATTERNS)) {
            if (!sentenceHasSkill(normalized, skill)) {
                continue
            }

            if (/(получаете|приобретаете|да[её]т).{0,48}владени|владеете.{0,48}навык|владени.{0,48}навык/iu.test(normalized)) {
                const value = /компетентност|экспертиз|удваива/iu.test(normalized) ? "2" : "1"
                addUniqueEffect(effects, change(SKILLS[skill], `system.skills.${skill}.value`, value, MODE_UPGRADE, `Владение навыком ${SKILLS[skill]}`))
                continue
            }

            if (/компетентност|экспертиз|удваива.{0,40}бонус мастерства/iu.test(normalized) && !/если уже владеете|если вы владеете/iu.test(normalized)) {
                addUniqueEffect(effects, change(SKILLS[skill], `system.skills.${skill}.value`, "2", MODE_UPGRADE, `Компетентность в навыке ${SKILLS[skill]}`))
                continue
            }

            const numericBonus = normalized.match(/(?:бонус\s*)?\+(\d+)[^.!?]{0,40}(?:провер|навык|пассивн)/iu)
                ?? normalized.match(/(?:провер|навык|пассивн)[^.!?]{0,40}\+(\d+)/iu)
            if (numericBonus) {
                const value = numericBonus[1]
                if (/пассивн/iu.test(normalized)) {
                    addUniqueEffect(effects, maybeTemporaryChange(normalized, SKILLS[skill], `system.skills.${skill}.bonuses.passive`, value, `Бонус +${value} к пассивному навыку ${SKILLS[skill]}`))
                }
                else {
                    addUniqueEffect(effects, maybeTemporaryChange(normalized, SKILLS[skill], `system.skills.${skill}.bonuses.check`, value, `Бонус +${value} к проверкам ${SKILLS[skill]}`))
                }
                continue
            }

            if (/бонус мастерства|БМ/iu.test(sentence) && /провер|пассивн|навык/iu.test(normalized) && !/если уже владеете|если вы владеете/iu.test(normalized)) {
                if (/пассивн/iu.test(normalized)) {
                    addUniqueEffect(effects, maybeTemporaryChange(normalized, SKILLS[skill], `system.skills.${skill}.bonuses.passive`, "@prof", `Бонус мастерства к пассивному навыку ${SKILLS[skill]}`))
                }
                else {
                    addUniqueEffect(effects, maybeTemporaryChange(normalized, SKILLS[skill], `system.skills.${skill}.bonuses.check`, "@prof", `Бонус мастерства к проверкам ${SKILLS[skill]}`))
                }
            }

            if (/преимуществ/iu.test(normalized) && /провер|навык|способност/iu.test(normalized)) {
                addUniqueEffect(effects, midiAdvantage(SKILLS[skill], `flags.midi-qol.advantage.skill.${skill}`, `Преимущество к проверкам ${SKILLS[skill]} добавлено как midi-qol toggle`))
            }
        }
    }

    return effects
}

function inferAbilityAdvantageEffects(sentences) {
    const effects = []

    for (const sentence of sentences) {
        const normalized = normalizeAutomationText(sentence)
        if (hasChoiceLanguage(normalized) || !/преимуществ/iu.test(normalized) || !/провер/iu.test(normalized)) {
            continue
        }

        for (const ability of ABILITY_ALIASES) {
            if (!ability.pattern.test(normalized)) {
                continue
            }

            addUniqueEffect(effects, midiAdvantage(`Проверки ${ability.label}`, `flags.midi-qol.advantage.ability.check.${ability.key}`, `Преимущество к проверкам ${ability.label} добавлено как midi-qol toggle`))
        }
    }

    return effects
}

function inferToolEffects(sentences) {
    const effects = []

    for (const sentence of sentences) {
        const normalized = normalizeAutomationText(sentence)
        if (hasChoiceLanguage(normalized) || !hasGrantLanguage(normalized)) {
            continue
        }

        for (const [tool, pattern] of Object.entries(TOOL_PATTERNS)) {
            if (!pattern.test(normalized)) {
                continue
            }

            const value = /компетентност|экспертиз|удваива/iu.test(normalized) ? "2" : "1"
            addUniqueEffect(effects, change(TOOLS[tool], `system.tools.${tool}.value`, value, MODE_UPGRADE, `Владение: ${TOOLS[tool]}`))
        }
    }

    return effects
}

function inferArmorEffects(sentences) {
    const effects = []

    for (const sentence of sentences) {
        const normalized = normalizeAutomationText(sentence)
        if (hasChoiceLanguage(normalized) || !/(владени|владеете|получаете|приобретаете)/iu.test(normalized)) {
            continue
        }

        for (const entry of ARMOR_PROFICIENCIES) {
            if (!entry.pattern.test(normalized)) {
                continue
            }

            addUniqueEffect(effects, change(`Владение ${entry.label}`, "system.traits.armorProf.value", entry.value, MODE_ADD, `Владение ${entry.label}`))
        }
    }

    return effects
}

function inferWeaponEffects(sentences) {
    const effects = []

    for (const sentence of sentences) {
        const normalized = normalizeAutomationText(sentence)
        if (hasChoiceLanguage(normalized) || !/(владени|владеете|получаете|приобретаете)/iu.test(normalized)) {
            continue
        }

        for (const [weaponName, value] of WEAPON_PROFICIENCY_VALUES.entries()) {
            if (!normalized.includes(weaponName)) {
                continue
            }

            addUniqueEffect(effects, weaponProficiency(value, weaponName))
        }
    }

    return effects
}

function inferMovementEffects(sentences) {
    const effects = []

    for (const sentence of sentences) {
        const normalized = normalizeAutomationText(sentence)
        if (hasChoiceLanguage(normalized)) {
            continue
        }

        if (/скорост[ьи] лазан/iu.test(normalized) && /скорост[ьи] ходьбы|равна вашей скорости|не ниже/iu.test(normalized)) {
            addUniqueEffect(effects, maybeTemporaryChange(normalized, "Скорость лазания", "system.attributes.movement.climb", "@attributes.movement.walk", "Скорость лазания не ниже скорости ходьбы", { mode: MODE_UPGRADE }))
        }

        if (/скорост[ьи] плаван/iu.test(normalized) && /скорост[ьи] ходьбы|равна вашей скорости|не ниже/iu.test(normalized)) {
            addUniqueEffect(effects, maybeTemporaryChange(normalized, "Скорость плавания", "system.attributes.movement.swim", "@attributes.movement.walk", "Скорость плавания не ниже скорости ходьбы", { mode: MODE_UPGRADE }))
        }

        if (/скорост[ьи] пол[её]т/iu.test(normalized) && /скорост[ьи] ходьбы|равна вашей скорости|не ниже/iu.test(normalized)) {
            addUniqueEffect(effects, maybeTemporaryChange(normalized, "Скорость полёта", "system.attributes.movement.fly", "@attributes.movement.walk", "Скорость полёта не ниже скорости ходьбы", { mode: MODE_UPGRADE }))
        }

        const speedMatch = normalized.match(/(?:скорост[ьи]|перемещения)[^.]{0,70}(?:увеличивается|повышается|получаете бонус|бонус)[^.]{0,25}(?:на\s*)?(\d+)\s*(?:фут|фт)/iu)
            ?? normalized.match(/\+(\d+)\s*(?:фут|фт)[^.]{0,50}(?:скорост[ьи]|перемещения)/iu)
        if (speedMatch) {
            const value = speedMatch[1]
            addUniqueEffect(effects, maybeTemporaryChange(normalized, "Скорость ходьбы", "system.attributes.movement.walk", value, `+${value} футов к скорости ходьбы`))
        }
    }

    return effects
}

function inferNumericBonusEffects(sentences) {
    const effects = []

    for (const sentence of sentences) {
        const normalized = normalizeAutomationText(sentence)
        if (hasChoiceLanguage(normalized)) {
            continue
        }

        const acMatch = normalized.match(/\+(\d+)[^.]{0,30}(?:кд|классу доспеха)|(?:кд|классу доспеха)[^.]{0,30}\+(\d+)/iu)
        if (acMatch) {
            const value = acMatch[1] ?? acMatch[2]
            addUniqueEffect(effects, maybeTemporaryChange(normalized, "Класс Доспеха", "system.attributes.ac.bonus", value, `+${value} к КД`))
        }

        const initiativeMatch = normalized.match(/\+(\d+|бм|бонус мастерства)[^.]{0,45}инициатив|инициатив[а-я\s]{0,45}\+(\d+)/iu)
        if (initiativeMatch) {
            const value = /бм|бонус мастерства/iu.test(initiativeMatch[1] ?? "") ? "@prof" : (initiativeMatch[1] ?? initiativeMatch[2])
            addUniqueEffect(effects, maybeTemporaryChange(normalized, "Инициатива", "system.attributes.init.bonus", value, `Бонус ${value === "@prof" ? "мастерства" : `+${value}`} к инициативе`))
        }

        const saveBonusMatch = normalized.match(/\+(\d+)[^.]{0,45}спасброс/iu)
        if (saveBonusMatch) {
            const value = saveBonusMatch[1]
            const ability = ABILITY_ALIASES.find((entry) => entry.pattern.test(normalized))
            const key = ability ? `system.abilities.${ability.key}.bonuses.save` : "system.bonuses.abilities.save"
            const label = ability ? `Спасброски ${ability.label}` : "Спасброски"
            addUniqueEffect(effects, maybeTemporaryChange(normalized, label, key, value, `+${value} к ${ability ? `спасброскам ${ability.label}` : "спасброскам"}`))
        }

        const attackBonusMatch = normalized.match(/\+(\d+)[^.]{0,55}(?:атак|броскам атаки)|(?:атак|броскам атаки)[^.]{0,55}\+(\d+)/iu)
        if (attackBonusMatch && !/урон/iu.test(normalized)) {
            const value = attackBonusMatch[1] ?? attackBonusMatch[2]
            const key = /дальнобойн|стрел|лук|арбалет|огнестрел/iu.test(normalized)
                ? "system.bonuses.rwak.attack"
                : (/заклинан/iu.test(normalized) ? "system.bonuses.msak.attack" : "system.bonuses.mwak.attack")
            addUniqueEffect(effects, maybeTemporaryChange(normalized, "Броски атаки", key, value, `+${value} к броскам атаки`))
        }

        const damageBonusMatch = normalized.match(/\+(\d+)[^.]{0,55}урон|урон[а-я\s]{0,55}\+(\d+)/iu)
        if (damageBonusMatch) {
            const value = damageBonusMatch[1] ?? damageBonusMatch[2]
            const key = /дальнобойн|стрел|лук|арбалет|огнестрел|метатель/iu.test(normalized)
                ? "system.bonuses.rwak.damage"
                : (/заклинан/iu.test(normalized) ? "system.bonuses.msak.damage" : "system.bonuses.mwak.damage")
            addUniqueEffect(effects, maybeTemporaryChange(normalized, "Урон", key, value, `+${value} к урону`))
        }
    }

    return effects
}

function inferTraitEffects(sentences) {
    const effects = []

    for (const sentence of sentences) {
        const normalized = normalizeAutomationText(sentence)
        if (hasChoiceLanguage(normalized)) {
            continue
        }

        if (/сопротивлен/iu.test(normalized) && !/иммунитет/iu.test(normalized)) {
            for (const damageType of DAMAGE_TYPES) {
                if (damageType.pattern.test(normalized)) {
                    addUniqueEffect(effects, resistance(damageType.value, `Сопротивление ${damageType.label}`))
                }
            }
        }

        if (/иммунитет|невосприимчив/iu.test(normalized)) {
            for (const condition of CONDITION_IMMUNITIES) {
                if (condition.pattern.test(normalized)) {
                    addUniqueEffect(effects, conditionImmunity(condition.value, `Иммунитет к состоянию ${condition.label}`))
                }
            }

            for (const damageType of DAMAGE_TYPES) {
                if (damageType.pattern.test(normalized) && /урон|энерги|кислот|холод|огн|яд/iu.test(normalized)) {
                    addUniqueEffect(effects, damageImmunity(damageType.value, `Иммунитет к урону ${damageType.label}`))
                }
            }
        }

        if (/уязвим/iu.test(normalized)) {
            for (const damageType of DAMAGE_TYPES) {
                if (damageType.pattern.test(normalized)) {
                    addUniqueEffect(effects, vulnerability(damageType.value, `Уязвимость к урону ${damageType.label}`))
                }
            }
        }
    }

    return effects
}

function inferHpEffects(sentences) {
    const effects = []

    for (const sentence of sentences) {
        const normalized = normalizeAutomationText(sentence)
        if (hasChoiceLanguage(normalized) || !/максимум[а-я\s]{0,16}хит|максимальн[а-я\s]{0,16}хит/iu.test(normalized)) {
            continue
        }

        const valueMatch = normalized.match(/\+(\d+)[^.]{0,40}хит|хит[а-я\s]{0,40}\+(\d+)/iu)
        if (valueMatch) {
            const value = valueMatch[1] ?? valueMatch[2]
            addUniqueEffect(effects, change("Максимум хитов", "system.attributes.hp.bonuses.overall", value, MODE_ADD, `+${value} к максимуму хитов`))
            continue
        }

        if (/уровн/iu.test(normalized)) {
            addUniqueEffect(effects, change("Максимум хитов", "system.attributes.hp.bonuses.overall", "@details.level", MODE_ADD, "Максимум хитов увеличен на уровень персонажа"))
        }
    }

    return effects
}

function inferTextEffects(identifier, text) {
    void identifier
    const sentences = splitSentences(text)
    return [
        ...inferSkillEffects(sentences),
        ...inferAbilityAdvantageEffects(sentences),
        ...inferToolEffects(sentences),
        ...inferArmorEffects(sentences),
        ...inferWeaponEffects(sentences),
        ...inferMovementEffects(sentences),
        ...inferNumericBonusEffects(sentences),
        ...inferTraitEffects(sentences),
        ...inferHpEffects(sentences)
    ]
}

function readJson(filePath) {
    return JSON.parse(fs.readFileSync(filePath, "utf8"))
}

function writeJson(filePath, data) {
    fs.writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`, "utf8")
}

function clone(value) {
    return JSON.parse(JSON.stringify(value))
}

function getIdentifier(item) {
    return item.system?.identifier ?? item.flags?.teyvankal?.id ?? item.name
}

function effectId(item, label) {
    return deterministicId(`${getIdentifier(item)}:${label}`)
}

function effectSignature(effect) {
    if (effect.key) return effect.key + effect.value
    if (effect.statusId) return `${effect.statusId}:${effect.statusValue ?? ""}:${effect.label}`
    return effect.label
}

function effectDuration(effect) {
    return {
        startTime: null,
        seconds: null,
        combat: null,
        rounds: null,
        turns: null,
        startRound: null,
        startTurn: null,
        ...(effect.duration ?? {})
    }
}

function effectChanges(effect) {
    if (Array.isArray(effect.changes)) return effect.changes
    if (!effect.key) return []

    return [
        {
            key: effect.key,
            mode: effect.mode,
            value: effect.value,
            priority: effect.priority ?? null
        }
    ]
}

function effectFlags(effect) {
    const flags = clone(AUTOMATION_FLAG)

    if (effect.specialDuration) {
        flags.dae = {
            ...(flags.dae ?? {}),
            specialDuration: Array.isArray(effect.specialDuration) ? effect.specialDuration : [effect.specialDuration]
        }
    }

    if (!effect.statusId) return flags

    flags.core = {
        ...(flags.core ?? {}),
        statusId: effect.statusId
    }

    if (effect.statusId.startsWith("rebreya-")) {
        flags[MODULE_ID] = {
            ...(flags[MODULE_ID] ?? {}),
            statusId: effect.statusId,
            statusValue: effect.statusValue ?? null,
            statusMeta: effect.statusMeta ?? {}
        }
    }

    return flags
}

function deterministicId(value) {
    return crypto.createHash("sha1").update(value).digest("hex").slice(0, 16)
}

function createEffect(item, effect) {
    const statusId = effect.statusId ?? null

    return {
        _id: effectId(item, effectSignature(effect)),
        name: effect.label,
        type: "base",
        img: effect.img || item.img || "icons/svg/aura.svg",
        system: {},
        changes: effectChanges(effect),
        disabled: false,
        duration: effectDuration(effect),
        description: `<p>${effect.note}</p>`,
        origin: null,
        transfer: effect.transfer ?? true,
        statuses: statusId ? [statusId] : [],
        sort: 0,
        flags: effectFlags(effect)
    }
}

function createRollPart(part = {}) {
    const hasCustomFormula = typeof part.formula === "string" && part.formula.trim()

    return {
        number: hasCustomFormula ? null : (part.number ?? null),
        denomination: hasCustomFormula ? null : (part.denomination ?? null),
        bonus: part.bonus ?? "",
        types: part.types ?? [],
        custom: {
            enabled: Boolean(hasCustomFormula),
            formula: hasCustomFormula ? part.formula : ""
        },
        scaling: {
            mode: part.scaling?.mode ?? "",
            number: part.scaling?.number ?? 1,
            formula: part.scaling?.formula ?? ""
        }
    }
}

function createActivity(item, spec, index) {
    const id = deterministicId(`${getIdentifier(item)}:${spec.name}:${spec.activation}:${index}`)
    const rangeValue = spec.range ?? null
    const rangeUnits = spec.rangeUnits ?? (rangeValue ? "ft" : "self")
    const activity = {
        _id: id,
        type: spec.type,
        name: spec.name,
        img: activityImage(spec.type),
        sort: index * 100000,
        activation: {
            type: spec.activation,
            value: spec.activationValue ?? activationValue(spec.activation),
            condition: spec.condition ?? "",
            override: false
        },
        consumption: {
            scaling: {
                allowed: false,
                max: ""
            },
            spellSlot: false,
            targets: spec.uses ? [
                {
                    type: "activityUses",
                    target: "",
                    value: "1",
                    scaling: {
                        mode: "",
                        formula: ""
                    }
                }
            ] : []
        },
        description: {
            chatFlavor: spec.note ?? ""
        },
        duration: {
            value: spec.duration?.value ?? "",
            units: spec.duration?.units ?? "inst",
            special: "",
            concentration: false,
            override: false
        },
        effects: spec.effectRefs ?? [],
        flags: clone(AUTOMATION_FLAG),
        range: {
            value: rangeValue,
            units: rangeUnits,
            special: "",
            override: false
        },
        target: defaultTarget(spec),
        uses: {
            spent: 0,
            max: spec.uses?.max ?? "",
            recovery: spec.uses?.period ? [
                {
                    period: spec.uses.period,
                    type: "recoverAll",
                    formula: ""
                }
            ] : []
        }
    }

    if (spec.type === "check") {
        activity.check = {
            ability: spec.ability,
            associated: spec.skill ? [spec.skill] : [],
            dc: {
                calculation: "",
                formula: spec.dc
            }
        }
    }

    if (spec.type === "save") {
        activity.save = {
            ability: [spec.saveAbility],
            dc: {
                calculation: "",
                formula: spec.dc
            }
        }
        activity.damage = {
            onSave: spec.damage ? "none" : "",
            parts: spec.damage ? [createRollPart(spec.damage)] : []
        }
    }

    if (spec.type === "damage") {
        activity.damage = {
            onSave: "",
            parts: spec.damage ? [createRollPart(spec.damage)] : []
        }
    }

    if (spec.type === "heal") {
        activity.healing = createRollPart(spec.healing ?? { formula: "1", types: ["healing"] })
    }

    return activity
}

function activityImage(type) {
    if (type === "check") return "systems/dnd5e/icons/svg/activity/check.svg"
    if (type === "save") return "systems/dnd5e/icons/svg/activity/save.svg"
    if (type === "damage") return "systems/dnd5e/icons/svg/activity/damage.svg"
    if (type === "heal") return "systems/dnd5e/icons/svg/activity/heal.svg"
    return "systems/dnd5e/icons/svg/activity/utility.svg"
}

function activationValue(type) {
    return ["action", "bonus", "reaction", "minute", "hour", "day"].includes(type) ? 1 : null
}

function defaultTarget(spec) {
    const hasArea = spec.area === true || spec.template === true
    const templateSize = spec.templateSize ?? spec.range ?? ""
    const affectsType = spec.affectsType ?? spec.targetType ?? (hasArea ? "creature" : "")

    return {
        template: {
            contiguous: false,
            units: hasArea ? (spec.rangeUnits ?? "ft") : "",
            type: hasArea ? (spec.templateType ?? "circle") : "",
            size: hasArea ? String(templateSize) : "",
            count: ""
        },
        affects: {
            type: affectsType,
            count: spec.targetCount ?? "",
            choice: false,
            special: spec.targetSpecial ?? ""
        },
        prompt: spec.prompt ?? true,
        override: false
    }
}

function clearAutomation(item) {
    item.effects = Array.isArray(item.effects)
        ? item.effects.filter((effect) => effect.flags?.[MODULE_ID]?.automation !== true)
        : []

    if (!item.system) item.system = {}
    if (!item.system.activities || typeof item.system.activities !== "object" || Array.isArray(item.system.activities)) {
        item.system.activities = {}
    }

    for (const [key, activity] of Object.entries(item.system.activities)) {
        if (activity?.flags?.[MODULE_ID]?.automation === true) {
            delete item.system.activities[key]
        }
    }
}

function addEffects(item, identifier, text, notes, mechanics) {
    const effects = []

    for (const effect of STATIC_EFFECTS[identifier] ?? []) {
        effects.push(effect)
    }

    for (const skill of SKILL_PROFICIENCIES[identifier] ?? []) {
        effects.push(change(SKILLS[skill], `system.skills.${skill}.value`, "1", MODE_UPGRADE, `Владение навыком ${SKILLS[skill]}`))
    }

    for (const entry of TOOL_PROFICIENCIES[identifier] ?? []) {
        const value = entry.value ?? "1"
        effects.push(change(TOOLS[entry.tool], `system.tools.${entry.tool}.value`, value, entry.mode, `Владение: ${TOOLS[entry.tool]}`))
    }

    for (const effect of inferTextEffects(identifier, text)) {
        effects.push(effect)
    }

    const usedSignatures = new Set()
    for (const effect of effects) {
        const signature = effectSignature(effect)
        if (usedSignatures.has(signature)) {
            continue
        }
        usedSignatures.add(signature)
        item.effects.push(createEffect(item, effect))
        notes.push(effect.note)
        mechanics.add(effect.mechanic)
        mechanics.add("effects")
    }
}

function addActivities(item, identifier, text, notes, mechanics) {
    const activities = CURATED_ACTIVITIES[identifier] ? [...CURATED_ACTIVITIES[identifier]] : inferGenericActivities(identifier, text)
    const effectIds = new Set((item.effects ?? []).map((effect) => effect._id))
    let index = Object.keys(item.system.activities).length + 1

    for (const spec of activities) {
        const appliedEffects = spec.appliedEffects ?? []
        spec.effectRefs = appliedEffects.map((effect) => {
            const itemEffect = createEffect(item, effect)
            if (!effectIds.has(itemEffect._id)) {
                item.effects.push(itemEffect)
                effectIds.add(itemEffect._id)
            }
            notes.push(effect.note)
            mechanics.add("effects")
            mechanics.add(effect.mechanic)
            if (effect.statusId) mechanics.add("statuses")
            return spec.type === "save"
                ? { _id: itemEffect._id, onSave: effect.onSave === true }
                : { _id: itemEffect._id }
        })

        const activity = createActivity(item, spec, index)
        item.system.activities[activity._id] = activity
        notes.push(spec.note)
        mechanics.add("activities")
        if (spec.type === "save") mechanics.add("saves")
        if (spec.type === "damage" || spec.damage) mechanics.add("damage")
        if (spec.type === "heal" || spec.healing) mechanics.add("healing")
        if (spec.uses) mechanics.add("uses")
        index += 1
    }
}

function inferActivation(text) {
    if (/реакци(ей|я|ю|и)|⚡/iu.test(text)) return "reaction"
    if (/бонусн(ым|ое|ого|ую)\s+действ/iu.test(text)) return "bonus"
    if (/действием|действие/iu.test(text)) return "action"
    if (/минут/iu.test(text) && /накладываете|используете|можете/iu.test(text)) return "minute"
    return "special"
}

function inferRange(text) {
    const match = stripHtml(text).match(/(?:в пределах|радиус|конус|линия|дистанци[ия]|до)\s*(\d+)\s*(?:фут|фт)/iu)
    return match ? Number(match[1]) : null
}

function inferArea(text) {
    if (/конус/iu.test(text)) return { area: true, templateType: "cone" }
    if (/линия/iu.test(text)) return { area: true, templateType: "line" }
    if (/радиус|сфер|область|все существа|каждое существо/iu.test(text)) return { area: true, templateType: "circle" }
    return {}
}

function inferSaveAbility(text) {
    const saveSentence = splitSentences(text).find((sentence) => /спасброс/iu.test(sentence)) ?? text
    const ability = ABILITY_ALIASES.find((entry) => entry.pattern.test(saveSentence))
    return ability?.key ?? "dex"
}

function inferSaveDc(text) {
    const normalized = normalizeAutomationText(text)
    const direct = normalized.match(/сл\.?\s*(\d+)\s*([+-])?\s*(бм|бонус мастерства)?/iu)
    if (direct) {
        const [, dc, sign, prof] = direct
        if (prof) return `${dc} ${sign || "+"} @prof`
        return dc
    }

    if (/сложност[ьи].{0,60}заклинан|сл заклинан|вашей сл/iu.test(normalized)) {
        return "@attributes.spell.dc"
    }

    const formula = normalized.match(/8\s*\+\s*(?:ваш\s*)?(?:бонус мастерства|бм)\s*\+\s*(?:ваш\s*)?модификатор\s+([а-яё]+)/iu)
    if (formula) {
        const ability = ABILITY_ALIASES.find((entry) => entry.pattern.test(formula[1]))
        return `8 + @prof + @abilities.${ability?.key ?? "cha"}.mod`
    }

    return ""
}

function inferDuration(text) {
    const normalized = normalizeAutomationText(text)
    if (/до конца (?:вашего |своего |следующего |текущего )?хода/iu.test(normalized)) {
        return { duration: rounds(1), specialDuration: "turnEnd" }
    }

    if (/до начала (?:вашего |своего |следующего )?хода/iu.test(normalized)) {
        return { duration: rounds(1), specialDuration: "turnStartSource" }
    }

    const minuteMatch = normalized.match(/(?:на|в течение)\s*(\d+)\s*минут/iu)
    if (minuteMatch) {
        return { duration: seconds(Number(minuteMatch[1]) * 60) }
    }

    const hourMatch = normalized.match(/(?:на|в течение)\s*(\d+)\s*час/iu)
    if (hourMatch) {
        return { duration: seconds(Number(hourMatch[1]) * 3600) }
    }

    return {}
}

function inferDamageType(text) {
    const normalized = normalizeAutomationText(text)
    return DAMAGE_TYPES.find((entry) => entry.pattern.test(normalized))?.value ?? ""
}

function inferRollFormula(sentence, fallback = "") {
    const dice = String(sentence ?? "").match(/(\d*)\s*[кd]\s*(\d+)/iu)
    if (dice) {
        return `${dice[1] || 1}d${dice[2]}`
    }

    const numeric = String(sentence ?? "").match(/(?:на|равное|равный|получает)\s*(\d+)\s*(?:хит|урон|временн)/iu)
    if (numeric) {
        return numeric[1]
    }

    return fallback
}

function inferDamagePart(text) {
    const sentence = splitSentences(text).find((entry) => /урон/iu.test(entry) && /(\d*)\s*[кd]\s*(\d+)/iu.test(entry))
    if (!sentence) {
        return null
    }

    const formula = inferRollFormula(sentence)
    if (!formula) {
        return null
    }

    const damageType = inferDamageType(sentence)
    return {
        formula,
        types: damageType ? [damageType] : []
    }
}

function inferHealingPart(text) {
    const sentence = splitSentences(text).find((entry) => /исцел|восстанавлива|хит/iu.test(entry) && /(\d*)\s*[кd]\s*(\d+)|\b\d+\b/iu.test(entry))
    if (!sentence || /максимум|максимальн/iu.test(sentence)) {
        return null
    }

    const formula = inferRollFormula(sentence, /бонус мастерства|БМ/iu.test(sentence) ? "@prof" : "")
    if (!formula) {
        return null
    }

    return {
        formula,
        types: ["healing"]
    }
}

function inferAppliedStatusEffects(text) {
    const normalized = normalizeAutomationText(text)
    if (/иммунитет|сопротивлен|уязвим/iu.test(normalized)) {
        return []
    }

    const duration = inferDuration(text)
    const effects = []
    for (const entry of STATUS_KEYWORDS) {
        if (!entry.pattern.test(normalized)) {
            continue
        }

        addUniqueEffect(effects, statusEffect(entry.statusId, entry.value, `Состояние ${STATUS_EFFECTS[entry.statusId]?.label ?? entry.statusId} добавлено к activity; условия применения уточняются описанием`, duration))
    }

    return effects
}

function inferSaveActivity(text, uses) {
    if (!/спасброс/iu.test(text)) {
        return null
    }

    const damage = inferDamagePart(text)
    const range = inferRange(text)
    return {
        type: "save",
        name: "Спасбросок черты",
        activation: inferActivation(text),
        saveAbility: inferSaveAbility(text),
        dc: inferSaveDc(text),
        range,
        targetType: "creature",
        uses,
        damage,
        appliedEffects: inferAppliedStatusEffects(text),
        ...inferArea(text),
        note: "Спасбросок черты добавлен как activity; точный триггер, выбор целей и условные исключения применяются по описанию"
    }
}

function inferCheckSkill(sentence) {
    const normalized = normalizeAutomationText(sentence)
    return Object.keys(SKILL_PATTERNS).find((skill) => SKILL_PATTERNS[skill].test(normalized)) ?? null
}

function inferCheckAbility(sentence) {
    const ability = ABILITY_ALIASES.find((entry) => entry.pattern.test(sentence))
    return ability?.key ?? "int"
}

function inferCheckDc(sentence) {
    const direct = String(sentence ?? "").match(/сл\.?\s*(\d+)\s*([+-])?\s*(бм|бонус мастерства)?/iu)
    if (direct) {
        const [, dc, sign, prof] = direct
        if (prof) return `${dc} ${sign || "+"} @prof`
        return dc
    }

    const passiveSkill = Object.keys(SKILL_PATTERNS).find((skill) => /пассивн/iu.test(sentence) && SKILL_PATTERNS[skill].test(sentence))
    if (passiveSkill) {
        return `@skills.${passiveSkill}.passive`
    }

    return ""
}

function inferCheckActivity(text, uses) {
    const sentence = splitSentences(text).find((entry) => /проверк|состязани/iu.test(entry) && (/сл\.?\s*\d+/iu.test(entry) || /пассивн|против/iu.test(entry))) ?? null
    if (!sentence) {
        return null
    }

    return {
        type: "check",
        name: "Проверка черты",
        activation: inferActivation(text),
        ability: inferCheckAbility(sentence),
        skill: inferCheckSkill(sentence),
        dc: inferCheckDc(sentence),
        targetType: /цель|существ|против/iu.test(sentence) ? "creature" : "",
        uses,
        note: "Проверка черты добавлена как activity; точные условия, цель и последствия успеха/провала применяются по описанию"
    }
}

function inferHealActivity(text, uses) {
    const healing = inferHealingPart(text)
    if (!healing || !/исцел|восстанавлива|хит/iu.test(text)) {
        return null
    }

    return {
        type: "heal",
        name: "Исцеление черты",
        activation: inferActivation(text),
        targetType: "creature",
        uses,
        healing,
        note: "Исцеление черты добавлено как activity; цель, триггер и ограничения применяются по описанию"
    }
}

function inferGenericActivities(identifier, text) {
    if (CURATED_ACTIVITIES[identifier]) return []

    const activities = []
    const uses = inferUses(text)
    const saveActivity = inferSaveActivity(text, uses)
    const checkActivity = inferCheckActivity(text, uses)
    const healActivity = inferHealActivity(text, uses)

    if (saveActivity) {
        activities.push(saveActivity)
    }

    if (checkActivity && activities.length < 3) {
        activities.push(checkActivity)
    }

    if (healActivity && activities.length < 3) {
        activities.push(healActivity)
    }

    if (/реакци(ей|я|ю|и)|⚡/iu.test(text)) {
        activities.push({
            type: "utility",
            name: "Реакция черты",
            activation: "reaction",
            uses,
            note: "Реакция добавлена как utility activity; триггер и итоговый эффект применяются вручную по описанию"
        })
    }

    if (/бонусн(ым|ое|ого|ую)\s+действ/iu.test(text)) {
        activities.push({
            type: "utility",
            name: "Бонусное действие черты",
            activation: "bonus",
            uses,
            note: "Бонусное действие добавлено как utility activity; итоговый эффект применяется вручную по описанию"
        })
    }

    if (/действием|действие/iu.test(text) && activities.length < 2) {
        activities.push({
            type: "utility",
            name: "Действие черты",
            activation: "action",
            uses,
            note: "Действие добавлено как utility activity; итоговый эффект применяется вручную по описанию"
        })
    }

    if (/заклинан|накладываете|наложить|наложили/iu.test(text) && /без (траты|использования)?\s*ячейки|завершите продолжительный отдых|закончить продолжительный отдых|необходимо завершить продолжительный отдых/iu.test(text) && activities.length < 2) {
        activities.push({
            type: "utility",
            name: "Заклинание черты",
            activation: "action",
            uses: uses ?? { max: "1", period: "lr" },
            note: "Заклинание черты добавлено как activity с расходом; конкретное заклинание и выбор списка применяются вручную по описанию"
        })
    }

    if (uses && activities.length < 2) {
        activities.push({
            type: "utility",
            name: "Использование черты",
            activation: "special",
            uses,
            note: "Ограничение использований черты добавлено как activity; конкретный триггер и итоговый эффект применяются вручную по описанию"
        })
    }

    return activities.slice(0, 3)
}

function inferUses(text) {
    if (/количество раз[^.]{0,80}(бонусу мастерства|БМ)|равн(ое|о|ый|ым)?[^.]{0,40}(бонусу мастерства|БМ)|БМ и восстанавливаете/iu.test(text)) {
        return { max: "@prof", period: /коротк/iu.test(text) ? "sr" : "lr" }
    }

    const abilityUses = stripHtml(text).match(/количество раз[^.]{0,80}модификатор[а-я\s]{1,24}(Силы|Ловкости|Телосложения|Интеллекта|Мудрости|Харизмы)/iu)
        ?? stripHtml(text).match(/равн[а-я]*[^.]{0,40}модификатор[а-я\s]{1,24}(Силы|Ловкости|Телосложения|Интеллекта|Мудрости|Харизмы)/iu)
    if (abilityUses) {
        const ability = ABILITY_ALIASES.find((entry) => entry.pattern.test(abilityUses[1]))
        return { max: `@abilities.${ability?.key ?? "cha"}.mod`, period: /коротк/iu.test(text) ? "sr" : "lr" }
    }

    const explicitUses = stripHtml(text).match(/(\d+)\s+раз(?:а)?[^.]{0,80}(?:длительн|продолжительн|коротк)/iu)
    if (explicitUses) {
        return { max: explicitUses[1], period: /коротк/iu.test(explicitUses[0]) ? "sr" : "lr" }
    }

    if (/один раз.*продолжительн|1\/длительн|снова, пока не закончите продолжительн|восстанавливаете.*продолжительн/iu.test(text)) {
        return { max: "1", period: "lr" }
    }

    if (/один раз.*коротк|1\/коротк|восстанавливаете.*коротк/iu.test(text)) {
        return { max: "1", period: "sr" }
    }

    if (/использовав[^.]{0,80}один раз[^.]{0,120}новый уровень|использовать[^.]{0,80}повторно[^.]{0,80}новый уровень/iu.test(text)) {
        return { max: "1", period: "" }
    }

    if (/одно использование|одну единицу|один заряд/iu.test(text)) {
        return { max: "1", period: "" }
    }

    if (/модификатор\w* Ловкости.*продолжительн/iu.test(text)) {
        return { max: "@abilities.dex.mod", period: "lr" }
    }

    if (/модификатор\w* Харизмы.*продолжительн/iu.test(text)) {
        return { max: "@abilities.cha.mod", period: "lr" }
    }

    return null
}

function determineStatus(identifier, text, notes) {
    if (!notes.length) return "manual"
    if (STATUS_OVERRIDES[identifier]) return STATUS_OVERRIDES[identifier]
    if (MANUAL_HINTS.some((pattern) => pattern.test(text))) return "partial"
    if (notes.some((note) => /вручную|utility|треб|по описанию|уточняются описанием|напоминан|проверяется|добавляются отдельн|настраиваются/iu.test(note))) return "partial"
    return "automated"
}

function manualReason(text) {
    for (const entry of MANUAL_REASON_PATTERNS) {
        if (entry.pattern.test(text)) return entry.reason
    }

    if (/заклинан|мана|аура|призван|форма|облик|перемест|состояни/iu.test(text)) {
        return "эффект требует выбора момента, цели, формы, ресурса или отдельной сцены"
    }

    return "в описании нет однозначной числовой механики для Active Effect, Activity, состояния или расхода"
}

function noteText(status, notes, text) {
    if (notes.length) {
        const summary = [...new Set(notes)].slice(0, 5).join("; ")
        if (status === "automated") return summary
        return `${summary}. Остальное вручную: ${manualReason(text)}.`
    }

    return `Автоматизация не добавлена: ${manualReason(text)}.`
}

function automateItem(item, report) {
    clearAutomation(item)

    const identifier = getIdentifier(item)
    const text = stripHtml(item.system?.description?.value)
    const notes = []
    const mechanics = new Set()

    addEffects(item, identifier, text, notes, mechanics)
    addActivities(item, identifier, text, notes, mechanics)

    const status = determineStatus(identifier, text, notes)
    const automation = {
        version: VERSION,
        status,
        notes: noteText(status, notes, text)
    }

    item.flags ??= {}
    item.flags[MODULE_ID] = {
        ...(item.flags[MODULE_ID] ?? {}),
        automation
    }

    report.counts[status] += 1
    for (const mechanic of mechanics) report.mechanics.add(mechanic)

    report.items.push({
        name: item.name,
        identifier,
        section: item.flags?.teyvankal?.section ?? "Без раздела",
        subsection: item.flags?.teyvankal?.subsection ?? "",
        status,
        notes: automation.notes,
        mechanics: [...mechanics]
    })
}

function applyToItems(items) {
    const report = {
        counts: {
            automated: 0,
            partial: 0,
            manual: 0
        },
        mechanics: new Set(),
        items: []
    }

    for (const item of items) {
        automateItem(item, report)
    }

    return report
}

function writeReport(report) {
    const mechanics = [...report.mechanics]
        .map((key) => MECHANIC_LABELS[key] ?? key)
        .sort((a, b) => a.localeCompare(b, "ru"))

    const automated = report.items
        .filter((item) => item.status === "automated")
        .map((item) => `- ${item.name} (${item.section})`)

    const partial = report.items
        .filter((item) => item.status === "partial")
        .map((item) => `- ${item.name} (${item.section}) — ${item.notes}`)

    const manual = report.items
        .filter((item) => item.status === "manual")
        .map((item) => `- ${item.name} (${item.section}) — ${item.notes}`)

    const lines = [
        "# Автоматизация черт V0.8 для dnd5e 5.2.5",
        "",
        `Версия флага: ${VERSION}`,
        "",
        "## Итоги",
        "",
        `- Полностью автоматизировано: ${report.counts.automated}`,
        `- Частично автоматизировано: ${report.counts.partial}`,
        `- Оставлено ручными: ${report.counts.manual}`,
        "",
        "## Добавленные типы механик",
        "",
        ...mechanics.map((label) => `- ${label}`),
        "",
        "## Полностью автоматизированные",
        "",
        ...automated,
        "",
        "## Частично автоматизированные",
        "",
        ...partial,
        "",
        "## Требуют ручной проверки",
        "",
        ...manual
    ]

    fs.writeFileSync(REPORT_PATH, `${lines.join("\n")}\n`, "utf8")
}

const items = readJson(ITEMS_PATH)
const itemsReport = applyToItems(items)
writeJson(ITEMS_PATH, items)

const bundle = readJson(BUNDLE_PATH)
if (!Array.isArray(bundle.items)) {
    throw new Error("Bundle JSON does not contain an items array")
}

applyToItems(bundle.items)
writeJson(BUNDLE_PATH, bundle)
writeReport(itemsReport)

console.log(JSON.stringify({
    version: VERSION,
    counts: itemsReport.counts,
    mechanics: [...itemsReport.mechanics].sort(),
    report: path.relative(ROOT_DIR, REPORT_PATH)
}, null, 2))
