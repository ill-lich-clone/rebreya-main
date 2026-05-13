import crypto from "node:crypto"
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const MODULE_ID = "rebreya-main"
const VERSION = "0.8-dnd5e-5.2.5"
const AUTOMATION_FLAG = { [MODULE_ID]: { automation: true } }
const MODE_ADD = 2
const MODE_UPGRADE = 4

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
    ]
}

const STATUS_OVERRIDES = {
    ...Object.fromEntries(Object.keys(CULTURAL_WEAPON_PROFICIENCIES).map((identifier) => [identifier, "automated"])),
    "bystraya-noga": "automated",
    "srazhenie-vslepuyu": "automated",
    "torgovaya-hvatka": "automated",
    "rebenok-surovyh-zim": "partial",
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
    /выберите/iu,
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
    { pattern: /на ваш выбор|по вашему выбору|выберите|один из|таблиц/iu, reason: "есть выбор игрока или таблица вариантов" },
    { pattern: /одобрение со стороны мастера|решает мастер/iu, reason: "требуется решение мастера" },
    { pattern: /социальн|разговор|общени|репутац|интриг/iu, reason: "эффект зависит от социальной или нарративной ситуации" },
    { pattern: /ремесл|крафт|созда[её]те|материал|\bзм\b/iu, reason: "крафтовая часть требует ручного ведения" },
    { pattern: /если|когда|пока|до конца|до начала/iu, reason: "есть условный или временный эффект, который dnd5e не отслеживает надежно" }
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
    conditionImmunity: "иммунитеты к состояниям",
    initiative: "инициатива",
    hp: "максимум хитов",
    armor: "владения доспехами/щитами",
    attacks: "бонусы к атаке",
    saves: "спасброски",
    damage: "урон",
    uses: "ограничения использований",
    statuses: "состояния rebreya-main/dnd5e"
}

function change(label, key, value, mode, note) {
    return {
        label,
        key,
        value,
        mode,
        note,
        mechanic: classifyKey(key)
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

function weaponProficiency(value, label) {
    return change(label, "system.traits.weaponProf.value", value, MODE_ADD, `Владение оружием: ${label}`)
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
    if (key.includes(".ci.")) return "conditionImmunity"
    if (key.includes(".init.")) return "initiative"
    if (key.includes(".hp.")) return "hp"
    if (key.includes(".armorProf.")) return "armor"
    if (key.includes(".bonuses.rwak.attack")) return "attacks"
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
            recovery: spec.uses ? [
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
            associated: [spec.skill],
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
            parts: spec.damage ? [
                {
                    number: spec.damage.number,
                    denomination: spec.damage.denomination,
                    bonus: "",
                    types: spec.damage.types,
                    custom: {
                        enabled: false,
                        formula: ""
                    },
                    scaling: {
                        mode: "",
                        number: 1,
                        formula: ""
                    }
                }
            ] : []
        }
    }

    return activity
}

function activityImage(type) {
    if (type === "check") return "systems/dnd5e/icons/svg/activity/check.svg"
    if (type === "save") return "systems/dnd5e/icons/svg/activity/save.svg"
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

function addEffects(item, identifier, notes, mechanics) {
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

    for (const effect of effects) {
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
        if (spec.damage) mechanics.add("damage")
        if (spec.uses) mechanics.add("uses")
        index += 1
    }
}

function inferGenericActivities(identifier, text) {
    if (CURATED_ACTIVITIES[identifier]) return []

    const activities = []
    const uses = inferUses(text)

    if (/реакци(ей|я|ю)|⚡/iu.test(text)) {
        activities.push({
            type: "utility",
            name: "Реакция черты",
            activation: "reaction",
            uses,
            note: "Реакция добавлена как utility activity; триггер и итоговый эффект применяются вручную по описанию"
        })
    }

    if (/бонусн(ым|ое|ого)\s+действ/iu.test(text)) {
        activities.push({
            type: "utility",
            name: "Бонусное действие черты",
            activation: "bonus",
            uses,
            note: "Бонусное действие добавлено как utility activity; итоговый эффект применяется вручную по описанию"
        })
    }

    if (/\bдействием\b|\bдействие\b/iu.test(text) && activities.length < 2) {
        activities.push({
            type: "utility",
            name: "Действие черты",
            activation: "action",
            uses,
            note: "Действие добавлено как utility activity; итоговый эффект применяется вручную по описанию"
        })
    }

    return activities.slice(0, 2)
}

function inferUses(text) {
    if (/количество раз равн\w* (вашему )?бонусу мастерства|равное бонусу мастерства|БМ и восстанавливаете/iu.test(text)) {
        return { max: "@prof", period: /коротк/iu.test(text) ? "sr" : "lr" }
    }

    if (/один раз.*продолжительн|1\/длительн|снова, пока не закончите продолжительн|восстанавливаете.*продолжительн/iu.test(text)) {
        return { max: "1", period: "lr" }
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
    if (notes.some((note) => /вручную|utility|треб/iu.test(note))) return "partial"
    return "automated"
}

function manualReason(text) {
    for (const entry of MANUAL_REASON_PATTERNS) {
        if (entry.pattern.test(text)) return entry.reason
    }

    if (/заклинан|мана|аура|призван|форма|облик|перемест|состояни/iu.test(text)) {
        return "эффект требует нестандартного поведения, состояния или отдельного ресурса"
    }

    return "нет надежного стандартного поля dnd5e 5.2.5 для полной автоматизации"
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

    addEffects(item, identifier, notes, mechanics)
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

    const manualOrPartial = report.items
        .filter((item) => item.status !== "automated")
        .map((item) => `- ${item.name} (${item.section}) — ${item.status}: ${item.notes}`)

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
        "## Требуют ручной проверки",
        "",
        ...manualOrPartial
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
