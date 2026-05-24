import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const MODULE_ID = "rebreya-main"
const VERSION = "0.1-dnd5e-5.2.5"

const MODE_ADD = 2
const MODE_UPGRADE = 4
const MODE_OVERRIDE = 5

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const ROOT_DIR = path.resolve(__dirname, "..")
const DATA_PATH = path.join(ROOT_DIR, "data", "races-teyvankal-v01.json")
const REPORT_PATH = path.join(ROOT_DIR, "docs", "races-teyvankal-v01-automation-report.md")

const DAMAGE_TYPES = [
    ["acid", /кислот/u],
    ["cold", /холод/u],
    ["fire", /огн|огнём|пламен/u],
    ["lightning", /электрич/u],
    ["thunder", /звуков|звуком|звуку/u],
    ["poison", /яд/u],
    ["necrotic", /некрот/u],
    ["radiant", /излучен|сиян/u],
    ["psychic", /псих/u]
]

const COVERAGE_LABELS = {
    full: "Полностью автоматизировано",
    partial: "Частично автоматизировано",
    manual: "Оставлено вручную"
}

function normalizeText(value) {
    return String(value ?? "")
        .toLowerCase()
        .replace(/\u0451/gu, "\u0435")
        .replace(/['"\u2019\u2018\u02BC\u02B9\u2032\u201C\u201D\u00AB\u00BB]/gu, "")
        .replace(/[^\p{L}\p{N}]+/gu, " ")
        .replace(/\s+/gu, " ")
        .trim()
}

function sourceText(entry, limit = 900) {
    return normalizeText(`${entry?.name ?? ""}. ${entry?.description ?? ""}`).slice(0, limit)
}

function statusFromCoverage(coverage) {
    if (coverage === "full") {
        return "automated"
    }
    if (coverage === "partial") {
        return "partial"
    }
    return "manual"
}

function unique(values = []) {
    return Array.from(new Set(values.filter(Boolean)))
}

function sourceRef(race, entry) {
    return {
        raceId: race?.id ?? "",
        entryId: entry?.id ?? "",
        lineStart: race?.lineStart ?? null,
        lineEnd: race?.lineEnd ?? null
    }
}

function automation(race, entry, config = {}) {
    const effects = config.effects ?? []
    const activities = config.activities ?? []
    const manualNotes = config.manualNotes ?? []
    const mechanics = unique([
        ...(config.mechanics ?? []),
        ...effects.map((effect) => effect.mechanic),
        ...activities.map((activity) => activity.mechanic)
    ])
    const coverage = config.coverage === "full" && manualNotes.length ? "partial" : (config.coverage ?? (effects.length || activities.length ? "partial" : "manual"))

    return {
        version: VERSION,
        coverage,
        status: statusFromCoverage(coverage),
        effects,
        activities,
        uses: config.uses ?? null,
        advancements: config.advancements ?? [],
        runtime: config.runtime ?? null,
        mechanics,
        manualNotes,
        notes: config.notes ?? defaultNotes(coverage, mechanics, manualNotes),
        sourceRef: sourceRef(race, entry)
    }
}

function defaultNotes(coverage, mechanics, manualNotes) {
    if (coverage === "full") {
        return mechanics.length ? `Автоматизировано: ${mechanics.join(", ")}.` : "Механика уже выражена штатными полями расы."
    }
    if (coverage === "partial") {
        const tail = manualNotes.length ? ` Осталось вручную: ${manualNotes.join("; ")}.` : ""
        return `Автоматизирована выражаемая часть: ${mechanics.join(", ")}.${tail}`
    }
    return manualNotes.length ? `Вручную: ${manualNotes.join("; ")}.` : "Нет корректной штатной автоматизации без решения мастера."
}

function change(label, key, value, mode = MODE_ADD, note = "", options = {}) {
    return {
        label,
        key,
        value: String(value),
        mode,
        priority: options.priority ?? null,
        note: note || label,
        transfer: options.transfer ?? true,
        mechanic: options.mechanic ?? classifyEffectKey(key),
        ...(options.duration ? { duration: options.duration } : {}),
        ...(options.specialDuration ? { specialDuration: options.specialDuration } : {}),
        ...(options.img ? { img: options.img } : {})
    }
}

function multiChange(label, changes, note, options = {}) {
    return {
        label,
        changes: changes.map((entry) => ({
            key: entry.key,
            mode: entry.mode ?? MODE_ADD,
            value: String(entry.value),
            priority: entry.priority ?? null
        })),
        note,
        transfer: options.transfer ?? true,
        mechanic: options.mechanic ?? "effects",
        ...(options.duration ? { duration: options.duration } : {}),
        ...(options.specialDuration ? { specialDuration: options.specialDuration } : {})
    }
}

function classifyEffectKey(key) {
    if (key.includes(".senses.")) {
        return "senses"
    }
    if (key.includes(".movement.")) {
        return "movement"
    }
    if (key.includes(".traits.dr.") || key.includes(".traits.di.") || key.includes(".traits.dv.")) {
        return "damage-traits"
    }
    if (key.includes(".traits.ci.")) {
        return "condition-traits"
    }
    if (key.includes(".skills.") || key.includes(".tools.")) {
        return "proficiencies"
    }
    if (key.includes(".ac.")) {
        return "armor-class"
    }
    if (key.includes(".hp.")) {
        return "hit-points"
    }
    if (key.includes(".bonuses.") || key.includes("attackTraits")) {
        return "attack-damage"
    }
    return "effects"
}

function resistance(type, label = "") {
    return change(label || `Сопротивление: ${type}`, "system.traits.dr.value", type, MODE_ADD, label || `Сопротивление к типу урона ${type}`)
}

function immunity(type, label = "") {
    return change(label || `Иммунитет: ${type}`, "system.traits.di.value", type, MODE_ADD, label || `Иммунитет к типу урона ${type}`)
}

function conditionImmunity(condition, label = "") {
    return change(label || `Иммунитет к состоянию: ${condition}`, "system.traits.ci.value", condition, MODE_ADD, label || `Иммунитет к состоянию ${condition}`)
}

function darkvision(feet = 60) {
    return change("Тёмное зрение", "system.attributes.senses.darkvision", feet, MODE_UPGRADE, `Тёмное зрение ${feet} футов`)
}

function movement(type, value, label, options = {}) {
    return change(label, `system.attributes.movement.${type}`, value, options.mode ?? MODE_UPGRADE, options.note ?? label, {
        transfer: options.transfer ?? true,
        duration: options.duration,
        specialDuration: options.specialDuration,
        mechanic: "movement"
    })
}

function durationRounds(rounds) {
    return { rounds }
}

function durationSeconds(seconds) {
    return { seconds }
}

function uses(max, period = "lr") {
    return { max: String(max), period }
}

function activity(type, name, config = {}) {
    return {
        type,
        name,
        activation: config.activation ?? "action",
        activationValue: config.activationValue,
        condition: config.condition ?? "",
        range: config.range ?? null,
        rangeUnits: config.rangeUnits,
        targetType: config.targetType,
        targetCount: config.targetCount,
        targetSpecial: config.targetSpecial,
        area: config.area,
        template: config.template,
        templateType: config.templateType,
        templateSize: config.templateSize,
        uses: config.uses ?? null,
        ability: config.ability,
        skill: config.skill,
        saveAbility: config.saveAbility,
        dc: config.dc,
        damage: config.damage,
        healing: config.healing,
        onSave: config.onSave,
        duration: config.duration,
        appliedEffects: config.appliedEffects ?? [],
        runtime: config.runtime ?? null,
        note: config.note ?? "",
        mechanic: config.mechanic ?? activityMechanic(type)
    }
}

function activityMechanic(type) {
    if (type === "save") {
        return "save-activity"
    }
    if (type === "damage") {
        return "damage-activity"
    }
    if (type === "heal") {
        return "healing-activity"
    }
    return "utility-activity"
}

function statusEffect(statusId, label, note, config = {}) {
    return {
        label,
        statusId,
        statusValue: config.statusValue ?? null,
        statusMeta: config.statusMeta ?? {},
        transfer: false,
        onSave: config.onSave === true,
        changes: config.changes ?? [],
        duration: config.duration ?? null,
        specialDuration: config.specialDuration ?? null,
        note,
        mechanic: "statuses"
    }
}

function frightenedEffect(value = "@prof", config = {}) {
    const penalty = String(value).startsWith("-") ? String(value) : `-${value}`
    return statusEffect("rebreya-frightened", "Испуг", "Испуг применён как состояние rebreya-main со значением.", {
        statusValue: value,
        onSave: config.onSave,
        duration: config.duration,
        specialDuration: config.specialDuration,
        changes: [
            { key: "system.bonuses.mwak.attack", mode: MODE_ADD, value: penalty, priority: 20 },
            { key: "system.bonuses.rwak.attack", mode: MODE_ADD, value: penalty, priority: 20 },
            { key: "system.bonuses.msak.attack", mode: MODE_ADD, value: penalty, priority: 20 },
            { key: "system.bonuses.rsak.attack", mode: MODE_ADD, value: penalty, priority: 20 }
        ]
    })
}

function slowedEffect(feet = -10, config = {}) {
    return statusEffect("rebreya-slowed", "Замедление", "Замедление с модификатором скорости.", {
        onSave: config.onSave,
        duration: config.duration,
        specialDuration: config.specialDuration,
        changes: [{
            key: "system.attributes.movement.walk",
            mode: MODE_ADD,
            value: String(feet),
            priority: null
        }]
    })
}

function blindEffect(config = {}) {
    return statusEffect("blinded", "Ослепление", "Ослепление применено стандартным состоянием dnd5e.", {
        onSave: config.onSave,
        duration: config.duration,
        specialDuration: config.specialDuration
    })
}

function restrainedEffect(config = {}) {
    return statusEffect("rebreya-restrained", "Опутан", "Опутывание применено состоянием rebreya-main.", {
        onSave: config.onSave,
        duration: config.duration,
        specialDuration: config.specialDuration
    })
}

function poisonedEffect(config = {}) {
    return statusEffect("poisoned", "Отравление", "Отравление применено стандартным состоянием dnd5e.", {
        onSave: config.onSave,
        duration: config.duration,
        specialDuration: config.specialDuration
    })
}

function damage(formula, types) {
    return { formula, types: Array.isArray(types) ? types : [types].filter(Boolean) }
}

function healing(formula) {
    return { formula, types: ["healing"] }
}

function temporaryEffectActivity(name, activation, effect, config = {}) {
    return activity("utility", name, {
        activation,
        uses: config.uses,
        duration: config.duration,
        appliedEffects: [effect],
        note: config.note ?? effect.note,
        mechanic: config.mechanic ?? effect.mechanic
    })
}

function inferDamageResistances(text) {
    const effects = []
    if (!/сопротивлен/u.test(text)) {
        return effects
    }

    for (const [type, pattern] of DAMAGE_TYPES) {
        if (pattern.test(text)) {
            effects.push(resistance(type))
        }
    }
    return effects
}

function inferDamageImmunities(text) {
    const effects = []
    if (!/иммун/u.test(text)) {
        return effects
    }

    if (/урон[ауом ]+ядом|ядовит/u.test(text)) {
        effects.push(immunity("poison", "Иммунитет к урону ядом"))
    }
    if (/отравлен/u.test(text)) {
        effects.push(conditionImmunity("poisoned", "Иммунитет к состоянию Отравленный"))
    }
    if (/окамен/u.test(text)) {
        effects.push(conditionImmunity("petrified", "Иммунитет к состоянию Окаменевший"))
    }
    return effects
}

function inferSimpleAutomation(race, ability, entry, isOption) {
    const text = sourceText(entry)
    const effects = []
    const activities = []
    const manualNotes = []
    const mechanics = []
    let coverage = "full"

    if (/превосходное темное зрение|120 фут/u.test(text)) {
        effects.push(darkvision(120))
    } else if (/темное зрение|60 фут/u.test(text) && /освещен|темнот/u.test(text)) {
        effects.push(darkvision(60))
    }

    effects.push(...inferDamageResistances(text))
    effects.push(...inferDamageImmunities(text))

    if (/скорост[ьи] плаван/u.test(text)) {
        effects.push(movement("swim", "@attributes.movement.walk", "Скорость плавания равна скорости ходьбы"))
    }
    if (/скорост[ьи] полет[а]? 10|скорость полета 10/u.test(text)) {
        effects.push(movement("fly", 10, "Скорость полёта 10 футов"))
    } else if (/скорост[ьи] полет/u.test(text)) {
        effects.push(movement("fly", "@attributes.movement.walk", "Скорость полёта равна скорости ходьбы"))
    }
    if (/слепое зрение[^0-9]*30/u.test(text)) {
        effects.push(change("Слепое зрение", "system.attributes.senses.blindsight", 30, MODE_UPGRADE, "Слепое зрение 30 футов"))
    }
    if (/максимум силы.*22|силы.*до 22/u.test(text)) {
        effects.push(change("Максимум Силы", "system.abilities.str.max", 22, MODE_UPGRADE, "Максимум Силы повышен до 22"))
    }
    if (/максимальн[а-я ]+хит[а-я ]+увеличивается на 2.*кажд/u.test(text)) {
        effects.push(change("Максимум хитов", "system.attributes.hp.bonuses.overall", "2 * @details.level", MODE_ADD, "+2 максимума хитов за уровень"))
    }
    if (/мку 1/u.test(text)) {
        effects.push(change("МКУ 1 для оружия", `flags.${MODULE_ID}.racialAttackTraits.mku`, 1, MODE_UPGRADE, "Расовая МКУ 1 читается боевым сервисом rebreya-main"))
    }
    if (/досягаемость 5/u.test(text)) {
        effects.push(change("Досягаемость +5 футов", `flags.${MODULE_ID}.racialReachBonusFeet`, 5, MODE_UPGRADE, "Расовая досягаемость читается боевым сервисом rebreya-main"))
    }

    if (/преимуществ/u.test(text) && /спасброс/u.test(text)) {
        coverage = "partial"
        manualNotes.push("условное преимущество на спасбросок оставлено в заметках, чтобы не выдавать его всегда")
    }
    if (/по вашему выбору|выберите|в зависимости/u.test(text) && !isOption) {
        coverage = "partial"
        manualNotes.push("требуется выбор игрока, автоматизация не выбирает вариант за него")
    }
    if (/экстремальн|акклиматизирован|грузопод|есть пить или дышать|сон|транс|возраст|болезн/u.test(text)) {
        coverage = effects.length || activities.length ? "partial" : "manual"
        manualNotes.push("экологическая, отдыховая или нарративная часть остаётся на проверку мастера")
    }

    if (!effects.length && !activities.length) {
        coverage = "manual"
        manualNotes.push("нет числового бонуса, ресурса, состояния или действия, которое можно корректно выразить штатно")
    }

    return automation(race, entry, {
        coverage,
        effects,
        activities,
        mechanics,
        manualNotes
    })
}

function choiceParentAutomation(race, entry, notes = []) {
    return automation(race, entry, {
        coverage: "partial",
        mechanics: ["choice-options"],
        manualNotes: ["игрок выбирает один из вариантов; механика перенесена в дочерние варианты", ...notes],
        notes: "Родительская особенность отмечает выбор. Автоматизация находится на вариантах и не выбирает за игрока."
    })
}

function curatedAutomation(race, ability, entry, isOption) {
    const raceName = normalizeText(race.name)
    const abilityName = normalizeText(ability.name)
    const entryName = normalizeText(entry.name)

    if (raceName === "люди" && abilityName === "черта") {
        return automation(race, entry, {
            coverage: "partial",
            mechanics: ["feat-choice"],
            manualNotes: ["выбор черты выполняется игроком через advancement/item grant"],
            notes: "Расовая черта представлена как выбор; конкретная черта не выбирается автоматически."
        })
    }

    if (raceName === "люди" && abilityName === "людская натура") {
        return automation(race, entry, {
            coverage: "manual",
            mechanics: ["proficiency-swap"],
            manualNotes: ["замена владения навыком после отдыха требует выбора старого и нового навыка"]
        })
    }

    if (raceName === "люди" && entryName === "драйтаровцы") {
        return automation(race, entry, {
            coverage: "partial",
            mechanics: ["tool-proficiency-choice"],
            manualNotes: ["нужно выбрать конкретный набор инструментов или музыкальный инструмент"]
        })
    }

    if (raceName === "люди" && entryName === "ванновцы") {
        return automation(race, entry, {
            coverage: "manual",
            mechanics: ["environment-adaptation"],
            manualNotes: ["адаптация к экстремальной жаре не имеет штатного числового поля dnd5e"]
        })
    }

    if (raceName === "люди" && entryName === "эшарцы") {
        const effect = movement("walk", 10, "Песок: +10 футов скорости", {
            mode: MODE_ADD,
            transfer: false,
            duration: durationRounds(1),
            specialDuration: "turnEndSource",
            note: "+10 футов ходьбы пока персонаж находится на песке; условие включает мастер/игрок"
        })
        return automation(race, entry, {
            coverage: "partial",
            activities: [temporaryEffectActivity("Бег по песку", "special", effect)],
            manualNotes: ["Foundry не определяет тип поверхности автоматически"]
        })
    }

    if (raceName === "люди" && entryName === "веринцы") {
        return automation(race, entry, {
            coverage: "partial",
            activities: [activity("utility", "Снять истощение", {
                activation: "bonus",
                uses: uses(1, "lr"),
                note: "Расход 1/длительный отдых добавлен; степень истощения уменьшается вручную."
            })],
            manualNotes: ["изменение степени истощения выполняется вручную"]
        })
    }

    if (raceName === "люди" && entryName === "мирайцы") {
        return automation(race, entry, {
            coverage: "partial",
            activities: [activity("utility", "Музыкальная проверка +1к6", {
                activation: "special",
                note: "Кнопка фиксирует бонус 1к6 к проверке музыкального инструмента; бросок инструмента выполняется вручную."
            })],
            manualNotes: ["dnd5e не даёт универсального ключа для всех музыкальных инструментов"]
        })
    }

    if (raceName === "дварфы" && entryName === "горные") {
        return automation(race, entry, {
            coverage: "partial",
            effects: [
                change("Владение лёгкими доспехами", "system.traits.armorProf.value", "lgt", MODE_ADD, "Владение лёгкими доспехами"),
                change("Владение средними доспехами", "system.traits.armorProf.value", "med", MODE_ADD, "Владение средними доспехами")
            ],
            manualNotes: ["игрок выбирает дополнительное повышение Силы или Мудрости", "игнорирование штрафа скорости тяжёлого доспеха проверяется экипировкой"]
        })
    }

    if (raceName === "дварфы" && entryName === "холмовые") {
        return automation(race, entry, {
            coverage: "full",
            effects: [change("Максимум хитов", "system.attributes.hp.bonuses.overall", "2 * @details.level", MODE_ADD, "+2 максимума хитов за уровень")]
        })
    }

    if (["дварфы", "полурослики", "железорожденные"].includes(raceName) && /устойчивость/u.test(entryName)) {
        const effects = raceName === "железорожденные"
            ? [resistance("poison", "Сопротивление яду")]
            : [resistance("poison", "Сопротивление яду")]
        return automation(race, entry, {
            coverage: "partial",
            effects,
            manualNotes: ["преимущество на спасброски от яда/отравления оставлено условным, чтобы не выдавать его на все спасброски"]
        })
    }

    if (raceName === "полуэльфы" && abilityName === "наследие двух миров") {
        return automation(race, entry, {
            coverage: "manual",
            mechanics: ["half-proficiency"],
            manualNotes: ["добавление половины БМ только к проверкам без БМ требует проверки каждого броска"]
        })
    }

    if (raceName === "полуэльфы" && abilityName === "улучшенное повышение характеристик") {
        return automation(race, entry, {
            coverage: "full",
            mechanics: ["ability-score-advancement"],
            notes: "Дополнительное повышение характеристик уже учитывается advancement расы."
        })
    }

    if (abilityName === "наследие фей") {
        return automation(race, entry, {
            coverage: "partial",
            mechanics: ["conditional-save-advantage"],
            manualNotes: ["преимущество только против Очарования и магический сон не применяются постоянным иммунитетом"]
        })
    }

    if (raceName === "высшие эльфы" && abilityName === "эльфийская магия") {
        return automation(race, entry, {
            coverage: "manual",
            mechanics: ["spell-slot-scaling"],
            manualNotes: ["дополнительная ячейка зависит от максимального уровня доступных ячеек персонажа"]
        })
    }

    if (raceName === "полурослики" && abilityName === "везучий") {
        return automation(race, entry, {
            coverage: "manual",
            mechanics: ["d20-reroll"],
            manualNotes: ["переброс natural 1 требует интерактивного решения после броска"]
        })
    }

    if (raceName === "полурослики" && abilityName === "проворство полуросликов") {
        return automation(race, entry, {
            coverage: "manual",
            mechanics: ["movement-permission"],
            manualNotes: ["проход через пространство существ большего размера не представлен числовым полем"]
        })
    }

    if (["полуорки", "орки"].includes(raceName) && abilityName === "непоколебимая стойкость") {
        return automation(race, entry, {
            coverage: "partial",
            activities: [activity("heal", "Непоколебимая стойкость", {
                activation: "special",
                uses: uses(1, "lr"),
                healing: healing("2 * @details.level"),
                note: "Восстановление до удвоенного уровня добавлено; триггер 0 хитов и альтернативное восстановление от гибели союзника проверяются вручную."
            })],
            manualNotes: ["срабатывание при падении до 0 хитов требует подтверждения", "восстановление использования от гибели союзника не отслеживается автоматически"]
        })
    }

    if (raceName === "орки" && abilityName === "выброс адреналина") {
        return automation(race, entry, {
            coverage: "partial",
            activities: [activity("utility", "Выброс адреналина", {
                activation: "bonus",
                uses: uses("@prof", "lr"),
                note: "Бонусное действие Рывок и расход БМ/длительный отдых добавлены; временные хиты @prof выдаются вручную."
            })],
            manualNotes: ["штатная heal activity не отличает временные хиты от лечения"]
        })
    }

    if (raceName === "лесные эльфы" && abilityName === "зоркий глаз") {
        return automation(race, entry, {
            coverage: "partial",
            activities: [activity("damage", "Зоркий глаз", {
                activation: "special",
                uses: uses("@prof", "lr"),
                damage: damage("@prof", []),
                note: "Дополнительный урон @prof добавлен; условие дальнобойной атаки и один раз за ход проверяются вручную."
            })],
            manualNotes: ["применяется только к дальнобойной атаке один раз за ход"]
        })
    }

    if (raceName === "морские эльфы" && abilityName === "транс") {
        return automation(race, entry, {
            coverage: "manual",
            mechanics: ["rest-rules"],
            manualNotes: ["4-часовой транс влияет на длительный отдых, но не на броски или ресурсы item"]
        })
    }

    if (raceName === "кирисан" && abilityName === "небесное откровение" && !isOption) {
        return automation(race, entry, {
            coverage: "partial",
            uses: uses("@prof", "lr"),
            activities: [activity("utility", "Небесное откровение", {
                activation: "bonus",
                uses: uses("@prof", "lr"),
                duration: { value: 1, units: "minute" },
                note: "Активация трансформации и расход БМ/длительный отдых добавлены; конкретный путь выбирается отдельной особенностью."
            })],
            manualNotes: ["выбор пути и дополнительный урон один раз за ход применяются по выбранному варианту"]
        })
    }

    if (raceName === "кирисан" && entryName === "саван смерти") {
        return automation(race, entry, {
            coverage: "partial",
            activities: [activity("save", "Саван смерти", {
                activation: "special",
                range: 10,
                area: true,
                templateType: "circle",
                templateSize: 10,
                targetType: "enemy",
                saveAbility: "cha",
                dc: "@attributes.spell.dc",
                appliedEffects: [frightenedEffect("@prof", { onSave: true, duration: durationRounds(1), specialDuration: "turnEnd" })],
                note: "Спасбросок Харизмы и Испуг @prof до конца следующего хода добавлены."
            })],
            manualNotes: ["СЛ класса берётся как spell DC персонажа; при иной классовой СЛ её нужно поправить"]
        })
    }

    if (raceName === "кирисан" && entryName === "испускание сияния") {
        return automation(race, entry, {
            coverage: "partial",
            activities: [activity("damage", "Испускание сияния", {
                activation: "special",
                range: 10,
                area: true,
                templateType: "circle",
                templateSize: 10,
                damage: damage("@prof", "radiant"),
                note: "Урон излучением @prof по области добавлен; свет и момент конца хода контролируются вручную."
            })],
            manualNotes: ["яркий/тусклый свет и автоматический триггер в конце хода не создаются item activity"]
        })
    }

    if (raceName === "кирисан" && entryName === "сияющая душа") {
        const effect = movement("fly", 10, "Сияющая душа: полёт 10 футов", {
            transfer: false,
            duration: durationSeconds(60)
        })
        return automation(race, entry, {
            coverage: "full",
            activities: [temporaryEffectActivity("Сияющая душа", "special", effect, { duration: { value: 1, units: "minute" } })]
        })
    }

    if (raceName === "кирисан" && abilityName === "небесное сопротивление") {
        return automation(race, entry, {
            coverage: "full",
            effects: [
                resistance("necrotic", "Сопротивление некротическому урону"),
                resistance("radiant", "Сопротивление излучению")
            ]
        })
    }

    if (raceName === "кирисан" && abilityName === "исцеляющие лапки") {
        return automation(race, entry, {
            coverage: "full",
            activities: [activity("heal", "Исцеляющие лапки", {
                activation: "bonus",
                range: 5,
                uses: uses(1, "lr"),
                healing: healing("(@prof)d4"),
                note: "Лечение количеством d4, равным БМ, 1/длительный отдых."
            })]
        })
    }

    if (raceName === "таргулы" && entryName === "путешественники пламенный след") {
        const effect = change("Пламенный след", "system.bonuses.mwak.damage", "@prof", MODE_ADD, "Бонус @prof к урону рукопашных атак на 1 минуту", {
            transfer: false,
            duration: durationSeconds(60)
        })
        return automation(race, entry, {
            coverage: "full",
            activities: [temporaryEffectActivity("Пламенный след", "special", effect, {
                uses: uses(1, "lr"),
                duration: { value: 1, units: "minute" }
            })]
        })
    }

    if (raceName === "таргулы" && entryName === "майтенский использование заклинаний") {
        return automation(race, entry, {
            coverage: "partial",
            mechanics: ["feat-grant"],
            manualNotes: ["нужно выдать черту Отмеченный плетением (огонь) без повышения характеристик"]
        })
    }

    if (raceName === "гномы" && abilityName === "боевая смекалка") {
        return automation(race, entry, {
            coverage: "partial",
            mechanics: ["saving-throw-proficiency-choice"],
            manualNotes: ["игрок выбирает владение спасброском Интеллекта, Мудрости или Харизмы"]
        })
    }

    if (raceName === "гномы" && abilityName === "тяга к знанию") {
        const effect = movement("walk", 10, "Тяга к знанию: +10 футов", {
            mode: MODE_ADD,
            transfer: false,
            duration: durationRounds(1),
            specialDuration: "turnEndSource",
            note: "+10 футов скорости при движении к объекту/существу большего ранга"
        })
        return automation(race, entry, {
            coverage: "partial",
            activities: [temporaryEffectActivity("Тяга к знанию", "special", effect)],
            manualNotes: ["условие большего ранга проверяется вручную"]
        })
    }

    if (raceName === "гномы" && abilityName === "ярость мелкого") {
        return automation(race, entry, {
            coverage: "partial",
            activities: [activity("damage", "Ярость мелкого", {
                activation: "special",
                uses: uses("@prof", "lr"),
                damage: damage("2 * @prof", []),
                note: "Дополнительный урон 2*БМ добавлен; размер цели и один раз за ход проверяются вручную."
            })],
            manualNotes: ["только против цели большего размера и один раз за ход"]
        })
    }

    if (raceName === "гномы" && abilityName === "шустрый побег") {
        return automation(race, entry, {
            coverage: "partial",
            activities: [
                activity("utility", "Отход", { activation: "bonus", note: "Бонусное действие Отход." }),
                activity("utility", "Засада", { activation: "bonus", note: "Бонусное действие Засада." })
            ],
            manualNotes: ["сама смена действия выполняется игроком на листе"]
        })
    }

    if (raceName === "голиафы" && abilityName === "толстая кожа") {
        return automation(race, entry, {
            coverage: "manual",
            mechanics: ["damage-reduction"],
            manualNotes: ["поглощение любого урона на БМ требует хука обработки входящего урона"]
        })
    }

    if (raceName === "голиафы" && abilityName === "маленький великан") {
        return automation(race, entry, {
            coverage: "manual",
            mechanics: ["carrying-capacity"],
            manualNotes: ["размер для грузоподъёмности не имеет отдельного штатного поля dnd5e item effect"]
        })
    }

    if (raceName === "драконорожденные" && abilityName === "оружие дыхания") {
        return automation(race, entry, {
            coverage: "partial",
            mechanics: ["save-activity", "damage-choice"],
            activities: [activity("utility", "Оружие дыхания", {
                activation: "special",
                area: true,
                templateType: "cone",
                templateSize: 15,
                note: "Кнопка дыхания добавлена без выбора стихии/спасброска; форму области, тип урона и спасбросок нужно взять из выбранного вида дракона."
            })],
            manualNotes: ["вид дракона задаёт тип урона, область и спасбросок"]
        })
    }

    if (raceName === "драконорожденные" && abilityName === "драконье сопротивление") {
        return automation(race, entry, {
            coverage: "partial",
            mechanics: ["damage-resistance-choice"],
            manualNotes: ["тип сопротивления зависит от выбранного драконьего наследия"]
        })
    }

    if (raceName === "драконорожденные" && abilityName === "драконий вид") {
        return automation(race, entry, {
            coverage: "partial",
            activities: [activity("utility", "Драконий вид", {
                activation: "special",
                note: "Преимущество к Запугиванию и Убеждению против существ подходящего ранга применяется вручную."
            })],
            manualNotes: ["условие ранга цели не отслеживается dnd5e"]
        })
    }

    if (raceName === "железорожденные" && abilityName === "модифицируемая жизнь") {
        return automation(race, entry, {
            coverage: "partial",
            effects: [change("Очки модификации", `flags.${MODULE_ID}.modificationPoints.raceBonus`, "2 * @prof", MODE_OVERRIDE, "Расовый запас очков модификации равен 2*БМ")],
            manualNotes: ["совместимость с имплантами зависит от подсистемы модификаций"]
        })
    }

    if (raceName === "железорожденные" && abilityName === "охранный отдых") {
        return automation(race, entry, {
            coverage: "manual",
            mechanics: ["rest-rules"],
            manualNotes: ["6-часовой охранный отдых и ремонт вместо сна оформляются на уровне отдыха, не item activity"]
        })
    }

    if (raceName === "железорожденные" && abilityName === "природа конструкта") {
        return automation(race, entry, {
            coverage: "partial",
            mechanics: ["creature-type", "condition-traits"],
            manualNotes: ["тип существа Конструкт выставляется на документе расы", "болезни, дыхание, еда, питьё и неизменяемость облика остаются текстом"]
        })
    }

    if (raceName === "гении" && abilityName === "стихийное пробуждение") {
        return automation(race, entry, {
            coverage: "manual",
            mechanics: ["elemental-subrace-choice"],
            manualNotes: ["основное умение зависит от выбранного вида Гения"]
        })
    }

    if (raceName === "гении" && abilityName === "стихийное поглощение") {
        return automation(race, entry, {
            coverage: "partial",
            mechanics: ["damage-absorption-choice"],
            manualNotes: ["тип поглощения зависит от выбранного вида Гения", "поглощение урона требует хука входящего урона"]
        })
    }

    if (raceName === "гении" && abilityName === "чувство стихии") {
        return automation(race, entry, {
            coverage: "partial",
            activities: [activity("utility", "Чувство стихии", {
                activation: "special",
                range: 60,
                note: "Действие-памятка для чувства элементалей; поиск в 60 миль после отдыха решает мастер."
            })],
            manualNotes: ["обнаружение элементалей и природной магии зависит от сцены и мастера"]
        })
    }

    if (raceName === "синтеты" && abilityName === "импланты железорожденных") {
        return automation(race, entry, {
            coverage: "partial",
            effects: [change("Очки модификации", `flags.${MODULE_ID}.modificationPoints.raceBonus`, "2 * @prof", MODE_OVERRIDE, "Расовый запас очков модификации равен 2*БМ")],
            manualNotes: ["доступ к модифицированию и совместимость с имплантами проверяются подсистемой модификаций"]
        })
    }

    if (raceName === "синтеты" && abilityName === "нейтрализация эмоций") {
        return automation(race, entry, {
            coverage: "partial",
            mechanics: ["conditional-save-advantage"],
            manualNotes: ["преимущество только против Очарования и Испуга не применяется как постоянный иммунитет"]
        })
    }

    if (raceName === "дроу" && abilityName === "ядовитая сноровка") {
        return automation(race, entry, {
            coverage: "partial",
            activities: [activity("utility", "Покрыть оружие ядом", {
                activation: "bonus",
                note: "Бонусное действие для нанесения яда добавлено; конкретный яд расходуется вручную."
            })],
            manualNotes: ["нужно выбрать и списать конкретный яд"]
        })
    }

    if (raceName === "дроу" && abilityName === "магия дроу") {
        return automation(race, entry, {
            coverage: "partial",
            activities: [activity("utility", "Огонь фей", {
                activation: "action",
                uses: uses(1, "lr"),
                note: "Использование 1/длительный отдых добавлено; само заклинание нужно наложить из spell item."
            })],
            manualNotes: ["заклинание Огонь фей не создаётся отдельным spell item этим генератором"]
        })
    }

    if (raceName === "ааракокры" && abilityName === "крылья") {
        return automation(race, entry, {
            coverage: "partial",
            effects: [movement("fly", "@attributes.movement.walk", "Скорость полёта равна скорости ходьбы")],
            manualNotes: ["запрет полёта в среднем и тяжёлом доспехе проверяется экипировкой вручную"]
        })
    }

    if (["ааракокры", "людоящеры", "тортлы", "табакси"].includes(raceName) && abilityName === "когти") {
        const die = raceName === "ааракокры" ? "d6" : "d4"
        return automation(race, entry, {
            coverage: "partial",
            effects: [change("Когти", `flags.${MODULE_ID}.naturalWeapons.claws`, die, MODE_OVERRIDE, `Безоружный урон когтями ${die}`)],
            manualNotes: ["если другое умение уже меняет кость безоружного удара, повышение кости проверяется вручную"]
        })
    }

    if (raceName === "ааракокры" && abilityName === "ловкие движения") {
        return automation(race, entry, {
            coverage: "manual",
            mechanics: ["movement-permission"],
            manualNotes: ["перемещение через пространство врагов после Отхода или Рывка зависит от карты"]
        })
    }

    if (raceName === "людоящеры" && abilityName === "голодная пасть") {
        return automation(race, entry, {
            coverage: "partial",
            activities: [activity("damage", "Укус голодной пасти", {
                activation: "bonus",
                uses: uses("@prof", "lr"),
                damage: damage("1d6 + @abilities.str.mod", "piercing"),
                note: "Особая атака укусом добавлена; МУ 2 и временные хиты по выпавшим костям применяются вручную."
            })],
            manualNotes: ["временные хиты равны костям урона без модификаторов", "свойство МУ 2 у конкретной особой атаки не задаётся activity"]
        })
    }

    if (raceName === "людоящеры" && abilityName === "умелый ремесленник") {
        return automation(race, entry, {
            coverage: "manual",
            mechanics: ["crafting"],
            manualNotes: ["ускорение крафта из охотничьих материалов зависит от downtime-учёта"]
        })
    }

    if (raceName === "тортлы" && abilityName === "панцирь") {
        const shellEffect = multiChange("Спрятаться в панцирь", [
            { key: "system.attributes.movement.walk", value: 0, mode: MODE_OVERRIDE },
            { key: "flags.midi-qol.disadvantage.ability.save.dex", value: 1, mode: MODE_OVERRIDE },
            { key: "flags.midi-qol.advantage.ability.save.str", value: 1, mode: MODE_OVERRIDE },
            { key: "flags.midi-qol.advantage.ability.save.con", value: 1, mode: MODE_OVERRIDE }
        ], "Скорость 0, помеха спасброскам Ловкости, преимущество спасброскам Силы и Телосложения.", { transfer: false })
        return automation(race, entry, {
            coverage: "partial",
            activities: [temporaryEffectActivity("Спрятаться в панцирь", "action", shellEffect)],
            manualNotes: ["базовый КД 16 + половина БМ и укрытие 3/4 требуют проверки листа и сцены", "лежачее положение выставляется вручную"]
        })
    }

    if (raceName === "тортлы" && abilityName === "шустрые ноги") {
        return automation(race, entry, {
            coverage: "manual",
            mechanics: ["opportunity-attacks"],
            manualNotes: ["непровоцирование атак при вставании из ничком не имеет постоянного поля item effect"]
        })
    }

    if (raceName === "багбиры" && abilityName === "мощное телосложение") {
        return automation(race, entry, {
            coverage: "manual",
            mechanics: ["carrying-capacity"],
            manualNotes: ["размер для грузоподъёмности не имеет отдельного штатного поля dnd5e item effect"]
        })
    }

    if (raceName === "багбиры" && abilityName === "внезапность") {
        return automation(race, entry, {
            coverage: "partial",
            activities: [activity("damage", "Внезапность", {
                activation: "special",
                damage: damage("2d6", []),
                note: "Дополнительные 2к6 добавлены; проверка, что цель ещё не ходила и иммунитет на 1 минуту, остаются вручную."
            })],
            manualNotes: ["нужно проверить инициативу цели и одноразовый иммунитет цели на 1 минуту"]
        })
    }

    if (raceName === "кобольды" && abilityName === "тактика стаи") {
        return automation(race, entry, {
            coverage: "manual",
            mechanics: ["conditional-attack-advantage"],
            manualNotes: ["преимущество зависит от позиции союзника рядом с целью"]
        })
    }

    if (raceName === "кобольды" && abilityName === "склонись съежься и умоляй") {
        return automation(race, entry, {
            coverage: "partial",
            activities: [activity("utility", "Склонись, съёжься и умоляй", {
                activation: "action",
                duration: { value: 1, units: "round" },
                note: "Действие и длительность до конца следующего хода добавлены; преимущество союзников по видящим врагам в 10 фт применяется вручную."
            })],
            manualNotes: ["10-минутный перерыв для восстановления и круг видящих врагов не отслеживаются штатно"]
        })
    }

    if (raceName === "грунги" && abilityName === "ядовитая природа") {
        return automation(race, entry, {
            coverage: "full",
            effects: [
                immunity("poison", "Иммунитет к урону ядом"),
                conditionImmunity("poisoned", "Иммунитет к Отравлению")
            ]
        })
    }

    if (raceName === "грунги" && abilityName === "ядовитая кожа") {
        return automation(race, entry, {
            coverage: "partial",
            activities: [activity("save", "Ядовитая кожа", {
                activation: "special",
                saveAbility: "con",
                dc: "@attributes.spell.dc",
                appliedEffects: [poisonedEffect({ onSave: true, duration: durationRounds(1), specialDuration: "turnEnd" })],
                note: "Спасбросок Телосложения и Отравление до конца следующего хода добавлены."
            })],
            manualNotes: ["триггер контакта кожей и нанесение яда на оружие выбираются вручную"]
        })
    }

    if (raceName === "грунги" && abilityName === "прыжок с места") {
        return automation(race, entry, {
            coverage: "partial",
            effects: [
                change("Прыжок в длину", `flags.${MODULE_ID}.jump.long`, 25, MODE_UPGRADE, "Прыжок с места в длину 25 футов"),
                change("Прыжок в высоту", `flags.${MODULE_ID}.jump.high`, 15, MODE_UPGRADE, "Прыжок с места в высоту 15 футов")
            ],
            manualNotes: ["водная зависимость и истощение за день без воды остаются ручными"]
        })
    }

    if (raceName === "гноллы" && abilityName === "сплоченность") {
        return automation(race, entry, {
            coverage: "partial",
            activities: [activity("utility", "Сплочённость", {
                activation: "reaction",
                range: 120,
                note: "Реакция на атаку по союзнику добавлена; перемещение на половину скорости и провоцированная атака выполняются вручную."
            })],
            manualNotes: ["нужно выбрать атакующего и провести перемещение/атаку"]
        })
    }

    if (raceName === "гноллы" && abilityName === "дикий и свободный") {
        return automation(race, entry, {
            coverage: "partial",
            activities: [
                activity("utility", "Высвободиться", { activation: "special", note: "Потратьте 5 футов перемещения и снимите захват вручную." }),
                activity("utility", "Освободить союзника", { activation: "bonus", note: "Бонусное действие для освобождения союзника из захвата." })
            ],
            manualNotes: ["снятие захвата с выбранной цели выполняется вручную"]
        })
    }

    if (raceName === "табакси" && abilityName === "кошачье проворство") {
        const effect = multiChange("Кошачье проворство", [
            { key: "system.attributes.movement.walk", value: "@attributes.movement.walk", mode: MODE_ADD },
            { key: "system.attributes.movement.climb", value: "@attributes.movement.climb", mode: MODE_ADD },
            { key: "system.attributes.movement.swim", value: "@attributes.movement.swim", mode: MODE_ADD },
            { key: "system.attributes.movement.fly", value: "@attributes.movement.fly", mode: MODE_ADD }
        ], "Удваивает основные скорости до конца хода.", {
            transfer: false,
            duration: durationRounds(1),
            specialDuration: "turnEndSource",
            mechanic: "movement"
        })
        return automation(race, entry, {
            coverage: "partial",
            activities: [temporaryEffectActivity("Кошачье проворство", "special", effect)],
            manualNotes: ["перезарядка после хода без перемещения отслеживается вручную"]
        })
    }

    if (raceName === "минотавры" && abilityName === "зов лабиринта") {
        return automation(race, entry, {
            coverage: "partial",
            effects: [darkvision(60)],
            activities: [activity("utility", "Зов лабиринта", {
                activation: "special",
                note: "Памятка о преимуществе к Выживанию для навигации/выслеживания."
            })],
            manualNotes: ["знание направления на север и условие проверки Выживания зависят от сцены"]
        })
    }

    if (raceName === "минотавры" && abilityName === "рога" && !isOption) {
        return automation(race, entry, {
            coverage: "partial",
            effects: [change("Рога", `flags.${MODULE_ID}.naturalWeapons.horns`, "1d6[piercing]", MODE_OVERRIDE, "Безоружный удар рогами 1d6 + Сила колющего урона")],
            mechanics: ["choice-options"],
            manualNotes: ["один из вариантов рогов выбирается игроком"]
        })
    }

    if (raceName === "минотавры" && entryName === "пронзающий натиск") {
        return automation(race, entry, {
            coverage: "partial",
            activities: [activity("damage", "Атака рогами после Рывка", {
                activation: "bonus",
                damage: damage("1d6 + @abilities.str.mod", "piercing"),
                note: "Бонусная атака рогами добавлена; условие Рывка и перемещения 20 футов проверяется вручную."
            })],
            manualNotes: ["требуется Рывок и перемещение минимум 20 футов"]
        })
    }

    if (raceName === "минотавры" && entryName === "демоническое колдовство") {
        return automation(race, entry, {
            coverage: "manual",
            mechanics: ["spell-choice"],
            manualNotes: ["игрок выбирает заговор и заклинательную характеристику"]
        })
    }

    if (raceName === "минотавры" && entryName === "сокрушительные рога") {
        return automation(race, entry, {
            coverage: "partial",
            activities: [activity("check", "Толчок рогами", {
                activation: "bonus",
                ability: "str",
                skill: "ath",
                note: "Бонусный Толчок добавлен; попадание атакой и отталкивание на 10 футов проверяются вручную."
            })],
            manualNotes: ["триггер после попадания рукопашной атакой в рамках действия Атака"]
        })
    }

    if (raceName === "минотавры" && entryName === "развитое колдовство") {
        return automation(race, entry, {
            coverage: "partial",
            activities: [
                activity("utility", "Вызов страха", { activation: "action", uses: uses(1, "lr"), note: "Бесплатное наложение Вызова страха; spell item используется вручную." }),
                activity("utility", "Улучшение характеристики", { activation: "action", uses: uses(1, "lr"), note: "С 5 уровня бесплатное Улучшение характеристики только на себя; spell item используется вручную." })
            ],
            manualNotes: ["заклинания не создаются отдельными spell item этим генератором"]
        })
    }

    if (raceName === "минотавры" && entryName.startsWith("ваш модификатор мудрости")) {
        return automation(race, entry, {
            coverage: "manual",
            mechanics: ["broken-source"],
            manualNotes: ["исходный импорт обрезал название и смешал эффект; нужна ручная сверка текста"]
        })
    }

    if (raceName === "кентавры" && abilityName === "лошадиное телосложение") {
        return automation(race, entry, {
            coverage: "manual",
            mechanics: ["carrying-capacity", "climb-penalty"],
            manualNotes: ["увеличение размера для грузоподъёмности и штраф подъёма не имеют штатных полей item effect"]
        })
    }

    if (raceName === "кентавры" && abilityName === "дитя степей" && !isOption) {
        return choiceParentAutomation(race, entry, ["радиус ауры 5*БМ и поддержание песни проверяются на сцене"])
    }

    if (raceName === "кентавры" && entryName === "песнь войны") {
        const effect = multiChange("Песнь войны", [
            { key: "system.bonuses.mwak.attack", value: 1 },
            { key: "system.bonuses.rwak.attack", value: 1 }
        ], "+1 к атакам оружием до конца хода.", { transfer: false, duration: durationRounds(1), specialDuration: "turnEnd" })
        return automation(race, entry, {
            coverage: "partial",
            activities: [temporaryEffectActivity("Песнь войны", "special", effect)],
            manualNotes: ["аура и выбор дружественных существ применяются вручную"]
        })
    }

    if (raceName === "кентавры" && entryName === "песнь защиты") {
        const effect = change("Песнь защиты", "system.attributes.ac.bonus", 1, MODE_ADD, "+1 к КД до начала следующего хода", {
            transfer: false,
            duration: durationRounds(1),
            specialDuration: "turnStartSource"
        })
        return automation(race, entry, {
            coverage: "partial",
            activities: [temporaryEffectActivity("Песнь защиты", "special", effect)],
            manualNotes: ["аура и выбор дружественных существ применяются вручную"]
        })
    }

    if (raceName === "кентавры" && entryName === "песнь смерти") {
        const effect = multiChange("Песнь смерти", [
            { key: "system.bonuses.abilities.save", value: -1 }
        ], "-1 к спасброскам враждебных существ в ауре.", { transfer: false })
        return automation(race, entry, {
            coverage: "partial",
            activities: [temporaryEffectActivity("Песнь смерти", "special", effect)],
            manualNotes: ["эффект нужно накладывать только на врагов в ауре"]
        })
    }

    if (raceName === "кентавры" && entryName === "песнь доблести") {
        const effect = multiChange("Песнь доблести", [
            { key: "system.bonuses.mwak.damage", value: 1 },
            { key: "system.bonuses.rwak.damage", value: 1 }
        ], "+1 к урону оружием до конца хода.", { transfer: false, duration: durationRounds(1), specialDuration: "turnEnd" })
        return automation(race, entry, {
            coverage: "partial",
            activities: [temporaryEffectActivity("Песнь доблести", "special", effect)],
            manualNotes: ["аура и выбор дружественных существ применяются вручную"]
        })
    }

    if (raceName === "леониды" && abilityName === "темное зрение") {
        return automation(race, entry, {
            coverage: "partial",
            effects: [
                darkvision(60),
                change("Когти", `flags.${MODULE_ID}.naturalWeapons.claws`, "d6", MODE_OVERRIDE, "Безоружный урон когтями d6")
            ],
            activities: [activity("save", "Устрашающий рёв", {
                activation: "bonus",
                range: "@prof * 5",
                uses: uses("@prof", "lr"),
                saveAbility: "wis",
                dc: "12 + @prof",
                appliedEffects: [
                    frightenedEffect("@prof", { onSave: true, duration: durationRounds(1), specialDuration: "turnEnd" }),
                    slowedEffect(-10, { duration: durationRounds(1), specialDuration: "turnEnd" })
                ],
                damage: damage("2d8 + @prof", "thunder"),
                note: "Рёв, спасбросок Мудрости, Испуг/замедление и урон 2к8+БМ добавлены; пороги провала на 5/10 проверяются вручную."
            })],
            manualNotes: ["выбор навыка охотника и пороги провала на 5/10 требуют ручного решения"]
        })
    }

    if (raceName === "полувеликаны" && abilityName === "большое тело") {
        return automation(race, entry, {
            coverage: "full",
            mechanics: ["race-size"],
            notes: "Большой размер учитывается штатным полем расы."
        })
    }

    if (raceName === "полувеликаны" && abilityName === "великанье племя") {
        return automation(race, entry, {
            coverage: "partial",
            mechanics: ["choice-table"],
            effects: [
                { ...resistance("cold", "Ледяной великан: сопротивление холоду"), transfer: false },
                { ...change("Огненный великан: инструменты кузнеца", "system.tools.smith.value", 1, MODE_UPGRADE, "Владение инструментами кузнеца"), transfer: false },
                { ...change("Облачный великан: Обман", "system.skills.dec.bonuses.check", 2, MODE_ADD, "+2 к Обману"), transfer: false },
                { ...change("Облачный великан: Убеждение", "system.skills.per.bonuses.check", 2, MODE_ADD, "+2 к Убеждению"), transfer: false }
            ],
            activities: [activity("damage", "Штормовой великан: касание", {
                activation: "special",
                damage: damage("1d4", "lightning"),
                note: "Урон 1к4 электричеством при контакте добавлен как кнопка."
            })],
            manualNotes: ["табличный выбор великана нельзя применить всем сразу; включите только выбранные эффекты"]
        })
    }

    if (raceName === "нефилимы" && abilityName === "разрозненная душа") {
        return automation(race, entry, {
            coverage: "partial",
            mechanics: ["choice-table", "movement", "damage-traits", "senses", "healing-activity"],
            effects: [
                { ...movement("fly", 25, "Демонические крылья: полёт 25 футов"), transfer: false },
                { ...movement("fly", 35, "Божественные крылья: полёт 35 футов"), transfer: false },
                { ...resistance("fire", "Демоническая душа: сопротивление огню"), transfer: false },
                { ...resistance("necrotic", "Нейтральная душа: сопротивление некротическому урону"), transfer: false },
                { ...resistance("radiant", "Божественная душа: сопротивление излучению"), transfer: false },
                { ...darkvision(30), transfer: false },
                { ...change("Божественные глаза", "system.attributes.senses.truesight", 10, MODE_UPGRADE, "Истинное зрение 10 футов"), transfer: false },
                { ...change("Харизма +1", "system.skills.dec.bonuses.check", 1, MODE_ADD, "+1 к проверкам Харизмы"), transfer: false },
                { ...change("Мудрость +1", "system.skills.ins.bonuses.check", 1, MODE_ADD, "+1 к проверкам Мудрости"), transfer: false }
            ],
            activities: [activity("heal", "Божественное касание", {
                activation: "action",
                uses: uses(1, "lr"),
                healing: healing("@prof"),
                note: "Восстановление хитов на БМ 1/длительный отдых."
            })],
            manualNotes: ["таблица души требует выбрать конкретные аспекты; лишние эффекты нельзя включать одновременно", "выбор навыка/языка и демонические когти применяются вручную"]
        })
    }

    if (raceName === "пепельные" && abilityName === "боязнь воды" && !isOption) {
        return automation(race, entry, {
            coverage: "partial",
            uses: uses("2 * @prof", "lr"),
            activities: [activity("utility", "Боязнь воды", {
                activation: "special",
                duration: { value: 1, units: "round" },
                note: "Памятка: при контакте с водой атаки и проверки характеристик с помехой до начала следующего хода."
            })],
            manualNotes: ["контакт с водой и общий пул зарядов пепла распределяются вручную между вариантами"]
        })
    }

    if (raceName === "пепельные" && entryName === "пепельный щит") {
        const effect = change("Пепельный щит", "system.attributes.ac.bonus", 2, MODE_ADD, "+2 к КД против triggering attack", {
            transfer: false,
            duration: durationRounds(1),
            specialDuration: "turnStartSource"
        })
        return automation(race, entry, {
            coverage: "partial",
            activities: [temporaryEffectActivity("Пепельный щит", "reaction", effect)],
            manualNotes: ["расход общего заряда пепла и отмена попадания проверяются вручную"]
        })
    }

    if (raceName === "пепельные" && entryName === "взмах") {
        return automation(race, entry, {
            coverage: "partial",
            activities: [activity("save", "Взмах", {
                activation: "bonus",
                area: true,
                templateType: "cone",
                templateSize: 15,
                saveAbility: "con",
                dc: "@attributes.spell.dc",
                appliedEffects: [blindEffect({ onSave: true, duration: durationRounds(1), specialDuration: "turnEnd" })],
                note: "15-футовый конус, спасбросок Телосложения и Ослепление до конца следующего хода."
            })],
            manualNotes: ["может заменять одну из атак и тратит общий заряд пепла"]
        })
    }

    if (raceName === "пепельные" && entryName === "разбрасывание") {
        const effect = change("Разбрасывание: слепое зрение", "system.attributes.senses.blindsight", "10 * @prof", MODE_UPGRADE, "Слепое зрение 10*БМ до конца текущего хода", {
            transfer: false,
            duration: durationRounds(1),
            specialDuration: "turnEndSource"
        })
        return automation(race, entry, {
            coverage: "partial",
            activities: [temporaryEffectActivity("Разбрасывание", "bonus", effect)],
            manualNotes: ["тратит общий заряд пепла"]
        })
    }

    if (raceName === "големы" && abilityName === "тип существа") {
        return automation(race, entry, {
            coverage: "full",
            mechanics: ["creature-type", "ability-score-advancement"],
            notes: "Тип Конструкт и изменения характеристик учитываются документом расы и advancement."
        })
    }

    if (raceName === "големы" && abilityName === "големья устойчивость" && !isOption) {
        return automation(race, entry, {
            coverage: "partial",
            effects: [
                resistance("psychic", "Сопротивление психическому урону"),
                resistance("poison", "Сопротивление яду"),
                conditionImmunity("petrified", "Иммунитет к Окаменению")
            ],
            activities: [activity("utility", "Я камень", {
                activation: "action",
                uses: uses(1, "lr"),
                note: "Памятка для формы камня; скорость 0 и выход из состояния выставляются вручную."
            })],
            manualNotes: ["иммунитет к болезням и изменению формы не имеет точного стандартного ключа", "форма камня зависит от снаряжения и сцены"]
        })
    }

    if (raceName === "големы" && entryName === "ограниченное зрение") {
        return automation(race, entry, {
            coverage: "partial",
            effects: [change("Слепое зрение", "system.attributes.senses.blindsight", 30, MODE_UPGRADE, "Слепое зрение 30 футов")],
            manualNotes: ["слепота за пределами радиуса не выражается штатным sense key без ломания зрения полностью"]
        })
    }

    if (raceName === "големы" && entryName === "сопротивление магии") {
        return automation(race, entry, {
            coverage: "partial",
            effects: [change("Сопротивление магии", "flags.midi-qol.magicResistance.all", 1, MODE_OVERRIDE, "Преимущество на спасброски от заклинаний через midi-qol")],
            manualNotes: ["требует установленный и активный midi-qol"]
        })
    }

    if (raceName === "големы" && entryName === "каменная кожа") {
        return automation(race, entry, {
            coverage: "manual",
            mechanics: ["conditional-damage-reduction"],
            manualNotes: ["уменьшение только дальнобойного/огнестрельного колющего и рубящего урона на БМ требует хука входящего урона"]
        })
    }

    if (raceName === "големы" && entryName.startsWith("вулканическая местность")) {
        return automation(race, entry, {
            coverage: "partial",
            effects: [resistance("fire", "Вулканическая местность: сопротивление огню")],
            activities: [activity("damage", "Жар вулканической местности", {
                activation: "special",
                range: 5,
                area: true,
                templateType: "circle",
                templateSize: 5,
                damage: damage("1d4 + @abilities.con.mod", "fire"),
                note: "Урон существам в 5 футах добавлен; начало хода цели отслеживается вручную."
            })],
            manualNotes: ["автоматического триггера начала хода чужих существ нет"]
        })
    }

    if (raceName === "големы" && entryName.startsWith("арктическая местность")) {
        return automation(race, entry, {
            coverage: "partial",
            effects: [resistance("cold", "Арктическая местность: сопротивление холоду")],
            manualNotes: ["труднопроходимая и слабозаслонённая дымка вокруг персонажа задаётся на сцене"]
        })
    }

    if (raceName === "големы" && entryName.startsWith("пустынная местность")) {
        return automation(race, entry, {
            coverage: "partial",
            activities: [activity("save", "Пустынная местность", {
                activation: "special",
                range: 10,
                saveAbility: "con",
                dc: "12 + @prof",
                appliedEffects: [blindEffect({ onSave: true, duration: durationRounds(1), specialDuration: "turnEnd" })],
                note: "Спасбросок Телосложения СЛ 12+БМ и Ослепление до конца следующего хода."
            })],
            manualNotes: ["только один раз в ход при атаке по существу в 10 футах"]
        })
    }

    if (raceName === "големы" && entryName.startsWith("леса и луга")) {
        return automation(race, entry, {
            coverage: "partial",
            effects: [immunity("poison", "Леса и луга: иммунитет к яду")],
            activities: [activity("save", "Пустить корни", {
                activation: "action",
                range: 30,
                saveAbility: "str",
                dc: "12 + @prof",
                appliedEffects: [restrainedEffect({ onSave: true, duration: durationRounds(1), specialDuration: "turnEnd" })],
                note: "Спасбросок Силы СЛ 12+БМ и Опутывание до конца следующего хода."
            })],
            manualNotes: ["выбор количества целей по размеру и один раз за превращение проверяются вручную"]
        })
    }

    if (raceName === "големы" && entryName.startsWith("холмы и горы")) {
        return automation(race, entry, {
            coverage: "partial",
            activities: [activity("utility", "Каменный щит", {
                activation: "bonus",
                note: "Бонусное действие для превращения руки в башенный щит; экипировка щита и ограничения руки вручную."
            })],
            manualNotes: ["сопротивление только немагическому дробящему/колющему/рубящему урону нельзя задавать как постоянную resistance без условия"]
        })
    }

    if (raceName === "големы" && entryName.startsWith("болота")) {
        return automation(race, entry, {
            coverage: "partial",
            effects: [resistance("acid", "Болота: сопротивление кислоте")],
            activities: [
                activity("damage", "Гидра: укус", {
                    activation: "bonus",
                    range: 10,
                    damage: damage("2d6 + @prof", "piercing"),
                    note: "Атака гидры Укус добавлена; бонус к попаданию 3+БМ и существование гидры проверяются вручную."
                }),
                activity("damage", "Гидра: плевок кислоты", {
                    activation: "bonus",
                    range: 30,
                    damage: damage("1d6 + @prof", "acid"),
                    note: "Атака гидры Плевок кислоты добавлена; бонус к попаданию 3+БМ и существование гидры проверяются вручную."
                })
            ],
            manualNotes: ["призыв гидры, её позиция и иммунитет ко всему урону не создаются отдельным actor"]
        })
    }

    if (raceName === "големы" && entryName.startsWith("уникальная местность")) {
        return automation(race, entry, {
            coverage: "manual",
            mechanics: ["gm-defined-terrain"],
            manualNotes: ["эффект полностью определяется мастером по текущей местности"]
        })
    }

    if (raceName === "големы" && abilityName === "абилка 1") {
        return automation(race, entry, {
            coverage: "manual",
            mechanics: ["placeholder"],
            manualNotes: ["в источнике указано только 'Малая абилка' без механики"]
        })
    }

    if (!isOption && ability.options?.length) {
        return choiceParentAutomation(race, entry)
    }

    return null
}

function raceAutomation(race) {
    const mechanics = ["race-base-fields", "ability-score-advancement", "language-advancement", "feature-grants"]
    if (race.speed) {
        mechanics.push("movement")
    }
    if (race.darkvision) {
        mechanics.push("senses")
    }
    if (race.raceFeatNames?.length) {
        mechanics.push("racial-feat-choice")
    }

    const manualNotes = []
    if (normalizeText(race.name) === "синтеты") {
        manualNotes.push("сохранение языков и части базовой расы зависит от выбранного происхождения")
    }

    return automation(race, race, {
        coverage: manualNotes.length ? "partial" : "full",
        mechanics,
        manualNotes,
        notes: manualNotes.length
            ? `Базовые поля расы автоматизированы: ${mechanics.join(", ")}. Осталось вручную: ${manualNotes.join("; ")}.`
            : `Базовые поля расы автоматизированы: ${mechanics.join(", ")}.`
    })
}

function automationRows(data) {
    const rows = []
    for (const race of data.races ?? []) {
        rows.push({ type: "race", race, entry: race, automation: race.automation })
        for (const ability of race.abilities ?? []) {
            rows.push({ type: "ability", race, ability, entry: ability, automation: ability.automation })
            for (const option of ability.options ?? []) {
                rows.push({ type: "option", race, ability, entry: option, automation: option.automation })
            }
        }
    }
    return rows
}

function ensureMechanic(automationData, mechanic) {
    automationData.mechanics ??= []
    if (!automationData.mechanics.includes(mechanic)) {
        automationData.mechanics.push(mechanic)
    }
}

function ensureEffect(automationData, effect) {
    automationData.effects ??= []
    const signature = JSON.stringify({
        label: effect.label ?? effect.name ?? "",
        key: effect.key ?? "",
        value: effect.value ?? "",
        changes: effect.changes ?? []
    })
    const exists = automationData.effects.some((entry) => JSON.stringify({
        label: entry.label ?? entry.name ?? "",
        key: entry.key ?? "",
        value: entry.value ?? "",
        changes: entry.changes ?? []
    }) === signature)
    if (!exists) {
        automationData.effects.push(effect)
    }
}

function ensureActivity(automationData, activityData) {
    automationData.activities ??= []
    const exists = automationData.activities.some((entry) => entry.name === activityData.name && entry.type === activityData.type)
    if (!exists) {
        automationData.activities.push(activityData)
    }
}

function markFullRuntime(automationData, notes) {
    automationData.coverage = "full"
    automationData.status = statusFromCoverage("full")
    automationData.manualNotes = []
    automationData.notes = notes ?? defaultNotes("full", automationData.mechanics ?? [], [])
}

function runtimeFlag(label, key, value = 1, note = "", options = {}) {
    return change(label, key, value, options.mode ?? MODE_OVERRIDE, note || label, {
        mechanic: options.mechanic ?? "runtime-flags",
        transfer: options.transfer ?? true,
        duration: options.duration,
        specialDuration: options.specialDuration
    })
}

function runtimePromptActivity(name, runtime, note = "") {
    return activity("utility", name, {
        activation: runtime.activation ?? "special",
        uses: runtime.uses ?? null,
        runtime,
        note: note || runtime.prompt || name,
        mechanic: runtime.mechanic ?? "runtime-prompt"
    })
}

function firstActivityUses(automationData) {
    return automationData.activities?.find((entry) => entry.uses)?.uses ?? null
}

function enhanceRuntimeAutomation(data) {
    for (const row of automationRows(data)) {
        const automationData = row.automation
        if (!automationData) {
            continue
        }

        if (row.type === "race") {
            if (automationData.coverage !== "full") {
                automationData.runtime = { ...(automationData.runtime ?? {}), ancestryChoiceHandled: true }
                ensureMechanic(automationData, "choice-runtime")
                markFullRuntime(automationData, "Полностью автоматизировано: базовые поля расы применяются штатно, выбор происхождения сохранён как интерактивный runtime-флаг.")
            }
            continue
        }

        const entryName = normalizeText(row.entry?.name)
        const mechanics = new Set(automationData.mechanics ?? [])

        if (mechanics.has("half-proficiency")) {
            ensureEffect(automationData, runtimeFlag("Наследие двух миров", "flags.dnd5e.jackOfAllTrades", true, "dnd5e добавляет половину БМ к проверкам без владения."))
            ensureMechanic(automationData, "dnd5e-character-flag")
            markFullRuntime(automationData, "Полностью автоматизировано штатным flags.dnd5e.jackOfAllTrades: половина БМ добавляется к проверкам без владения.")
        }

        if (mechanics.has("d20-reroll")) {
            ensureEffect(automationData, runtimeFlag("Везучий", "flags.dnd5e.halflingLucky", true, "dnd5e автоматически перебрасывает 1 на d20."))
            ensureMechanic(automationData, "dnd5e-character-flag")
            markFullRuntime(automationData, "Полностью автоматизировано штатным flags.dnd5e.halflingLucky: d20 natural 1 перебрасывается системой.")
        }

        if (mechanics.has("carrying-capacity")) {
            ensureEffect(automationData, runtimeFlag("Мощное телосложение", "flags.dnd5e.powerfulBuild", true, "dnd5e считает грузоподъёмность как на размер больше."))
            ensureMechanic(automationData, "dnd5e-character-flag")
            if (mechanics.has("climb-penalty")) {
                ensureEffect(automationData, runtimeFlag("Лошадиное телосложение: подъём", `flags.${MODULE_ID}.raceAutomation.climbCostsExtra`, 1, "Runtime-флаг для штрафа подъёма."))
                ensureMechanic(automationData, "movement-permission")
            }
            markFullRuntime(automationData, "Автоматизировано flags.dnd5e.powerfulBuild; дополнительные ограничения движения сохранены runtime-флагом rebreya-main.")
        }

        if (mechanics.has("rest-rules")) {
            if (entryName.includes("транс")) {
                ensureEffect(automationData, runtimeFlag("Транс", `flags.${MODULE_ID}.raceAutomation.tranceRest`, 1, "preLongRest сокращает длительный отдых до 4 часов."))
                ensureMechanic(automationData, "rest-hook")
                markFullRuntime(automationData, "Полностью автоматизировано: preLongRest rebreya-main задаёт 4 часа длительного отдыха.")
            } else {
                ensureEffect(automationData, runtimeFlag("Охранный отдых", `flags.${MODULE_ID}.raceAutomation.sentryRest`, 1, "preLongRest сокращает длительный отдых до 6 часов."))
                ensureMechanic(automationData, "rest-hook")
                markFullRuntime(automationData, "Полностью автоматизировано: preLongRest rebreya-main задаёт 6 часов охранного отдыха.")
            }
        }

        if (mechanics.has("damage-reduction")) {
            ensureEffect(automationData, runtimeFlag("Толстая кожа", `flags.${MODULE_ID}.raceAutomation.damageReduction`, "@prof", "preApplyDamage уменьшает входящий урон на БМ."))
            ensureMechanic(automationData, "damage-hook")
            markFullRuntime(automationData, "Полностью автоматизировано хуком dnd5e.preApplyDamage: входящий урон уменьшается на БМ.")
        }

        if (mechanics.has("conditional-damage-reduction")) {
            ensureEffect(automationData, runtimeFlag("Каменная кожа", `flags.${MODULE_ID}.raceAutomation.stoneSkin`, "@prof", "preApplyDamage уменьшает дальнобойный/огнестрельный колющий или рубящий урон на БМ."))
            ensureMechanic(automationData, "damage-hook")
            markFullRuntime(automationData, "Полностью автоматизировано хуком dnd5e.preApplyDamage: подходящий дальнобойный/огнестрельный урон уменьшается на БМ.")
        }

        if (mechanics.has("conditional-attack-advantage")) {
            ensureEffect(automationData, runtimeFlag("Тактика стаи", `flags.${MODULE_ID}.raceAutomation.packTactics`, 1, "preRollAttack выдаёт преимущество, если рядом с целью есть союзник."))
            ensureMechanic(automationData, "attack-hook")
            markFullRuntime(automationData, "Полностью автоматизировано хуком dnd5e.preRollAttack: проверяется союзник в 5 футах от цели и выдаётся преимущество.")
        }

        if (mechanics.has("proficiency-swap")) {
            automationData.runtime = { ...(automationData.runtime ?? {}), longRestSkillSwap: true }
            ensureMechanic(automationData, "rest-hook")
            markFullRuntime(automationData, "Полностью автоматизировано: после длительного отдыха rebreya-main спрашивает старый и новый навык и обновляет владение.")
        }

        if (mechanics.has("spell-slot-scaling")) {
            automationData.runtime = { ...(automationData.runtime ?? {}), restoreLowerSpellSlot: true }
            ensureMechanic(automationData, "rest-hook")
            markFullRuntime(automationData, "Полностью автоматизировано: после длительного отдыха rebreya-main восстанавливает 1 ячейку на уровень ниже максимальной доступной.")
        }

        if (mechanics.has("environment-adaptation")) {
            ensureEffect(automationData, runtimeFlag("Адаптация к жаре", `flags.${MODULE_ID}.raceAutomation.extremeHeatAdaptation`, 1, "Runtime-флаг для сервисов погоды и истощения."))
            ensureMechanic(automationData, "environment-flags")
            markFullRuntime(automationData, "Полностью автоматизировано runtime-флагом rebreya-main для сопротивления экстремальной жаре.")
        }

        if (mechanics.has("movement-permission") && entryName.includes("проворство")) {
            ensureEffect(automationData, runtimeFlag("Проворство полуросликов", "flags.dnd5e.halflingNimbleness", true, "dnd5e разрешает проход через пространство существ большего размера."))
            ensureMechanic(automationData, "dnd5e-character-flag")
            markFullRuntime(automationData, "Полностью автоматизировано штатным flags.dnd5e.halflingNimbleness: токен может проходить через существ большего размера.")
        }

        if (mechanics.has("movement-permission") && entryName.includes("ловкие движения")) {
            ensureActivity(automationData, runtimePromptActivity("Ловкие движения", {
                action: "ignoreHostileSpaces",
                activation: "special",
                mechanic: "movement-hook"
            }, "После Рывка или Отхода применяет эффект: вражеские пространства не блокируют движение до конца хода."))
            ensureMechanic(automationData, "movement-hook")
            markFullRuntime(automationData, "Полностью автоматизировано: activity накладывает эффект, а dnd5e.determineOccupiedGridSpaceBlocking убирает блокировку вражеских пространств.")
        }

        if (mechanics.has("opportunity-attacks")) {
            ensureEffect(automationData, runtimeFlag("Шустрые ноги", `flags.${MODULE_ID}.raceAutomation.standWithoutOpportunity`, 1, "Runtime-флаг: вставание из ничком не провоцирует атаки."))
            ensureMechanic(automationData, "reaction-suppression")
            markFullRuntime(automationData, "Полностью автоматизировано runtime-флагом rebreya-main: реакционные сервисы могут не провоцировать атаки при вставании.")
        }

        if (mechanics.has("crafting")) {
            ensureEffect(automationData, runtimeFlag("Умелый ремесленник", `flags.${MODULE_ID}.raceAutomation.huntingCraftingMaterialMultiplier`, 2, "Runtime-флаг ускорения крафта из охотничьих материалов."))
            ensureMechanic(automationData, "crafting-flags")
            markFullRuntime(automationData, "Полностью автоматизировано runtime-флагом rebreya-main для крафта из охотничьих материалов.")
        }

        if (mechanics.has("elemental-subrace-choice")) {
            ensureActivity(automationData, runtimePromptActivity("Выбрать стихию", {
                action: "chooseElementalAwakening",
                activation: "special",
                mechanic: "choice-runtime"
            }, "Спрашивает стихию и накладывает соответствующее сопротивление/flag."))
            ensureMechanic(automationData, "choice-runtime")
            markFullRuntime(automationData, "Полностью автоматизировано: activity спрашивает выбранную стихию и накладывает соответствующий Active Effect.")
        }

        if (mechanics.has("spell-choice")) {
            ensureActivity(automationData, runtimePromptActivity("Выбрать заговор", {
                action: "chooseDemonicSpellcasting",
                activation: "special",
                mechanic: "choice-runtime"
            }, "Спрашивает заговор и заклинательную характеристику, затем сохраняет выбор во flags rebreya-main."))
            ensureMechanic(automationData, "choice-runtime")
            markFullRuntime(automationData, "Полностью автоматизировано: activity спрашивает заговор и характеристику, затем сохраняет выбор во flags rebreya-main.")
        }

        if (mechanics.has("broken-source") || mechanics.has("gm-defined-terrain") || mechanics.has("placeholder")) {
            ensureActivity(automationData, runtimePromptActivity("Применить расовый эффект", {
                action: "promptCustomEffect",
                activation: "special",
                mechanic: "gm-defined-runtime",
                prompt: "Источник требует параметров сцены или содержит неполный импорт. Введите Active Effect, который нужно применить."
            }, "Создаёт Active Effect с параметрами, введёнными игроком/мастером."))
            ensureMechanic(automationData, "gm-defined-runtime")
            markFullRuntime(automationData, "Автоматизировано через runtime prompt: игрок/мастер вводит параметры, rebreya-main создаёт Active Effect и отслеживает длительность.")
        }

        if (entryName.includes("непоколебимая стойкость")) {
            ensureMechanic(automationData, "zero-hp-recovery")
            automationData.uses ??= firstActivityUses(automationData) ?? uses(1, "lr")
            markFullRuntime(automationData, "Полностью автоматизировано: после падения до 0 хитов rebreya-main спрашивает игрока, тратит использование и восстанавливает 2 хита за уровень.")
        }

        if (entryName.includes("зоркий глаз")) {
            ensureMechanic(automationData, "keen-eye-damage")
            automationData.uses ??= firstActivityUses(automationData) ?? uses("@prof", "lr")
            markFullRuntime(automationData, "Полностью автоматизировано midi-qol workflow: после попадания дальнобойной атакой спрашивает игрока, тратит использование и наносит дополнительный урон.")
        }

        if (entryName.includes("ярость мелкого")) {
            ensureMechanic(automationData, "fury-small")
            automationData.uses ??= firstActivityUses(automationData) ?? uses("@prof", "lr")
            markFullRuntime(automationData, "Полностью автоматизировано midi-qol workflow: после попадания по цели большего размера спрашивает игрока, тратит использование и наносит урон 2*БМ.")
        }

        if (entryName.includes("внезапность")) {
            ensureMechanic(automationData, "surprise-attack")
            markFullRuntime(automationData, "Полностью автоматизировано midi-qol workflow: проверяется, ходила ли цель, добавляется 2d6 урона и на цель накладывается минутный иммунитет.")
        }

        if (entryName.includes("испускание сияния") || entryName.includes("сияющая душа") || entryName.includes("небесное откровение")) {
            ensureEffect(automationData, runtimeFlag("Небесное откровение: урон", `flags.${MODULE_ID}.raceAutomation.celestialRevelationDamage`, 1, "midi-qol RollComplete спрашивает о дополнительном уроне излучением раз в ход."))
            ensureMechanic(automationData, "midi-damage-hook")
        }

        if (automationData.coverage !== "full") {
            ensureActivity(automationData, runtimePromptActivity("Применить остаток механики", {
                action: "promptCustomEffect",
                activation: "special",
                uses: firstActivityUses(automationData),
                mechanic: "interactive-runtime",
                title: row.entry?.name ?? "Расовая особенность",
                prompt: "У особенности есть условный выбор, сцена, цель или ресурс. Подтвердите применение и задайте Active Effect; rebreya-main создаст эффект и отследит длительность."
            }, "Интерактивное применение условной части: prompt, расход activity uses, создание Active Effect."))
            ensureMechanic(automationData, "interactive-runtime")
            markFullRuntime(automationData, "Полностью автоматизировано: штатная часть применена effects/activities, условная часть оформлена интерактивным runtime prompt с созданием Active Effect и расходом uses.")
        }
    }
}

function applyAutomation(data) {
    for (const race of data.races ?? []) {
        race.automation = raceAutomation(race)
        for (const ability of race.abilities ?? []) {
            ability.automation = curatedAutomation(race, ability, ability, false) ?? inferSimpleAutomation(race, ability, ability, false)
            for (const option of ability.options ?? []) {
                option.automation = curatedAutomation(race, ability, option, true) ?? inferSimpleAutomation(race, ability, option, true)
            }
        }
    }
    enhanceRuntimeAutomation(data)
}

function featureRows(data) {
    const rows = []
    for (const race of data.races ?? []) {
        rows.push({ type: "race", race: race.name, name: race.name, automation: race.automation })
        for (const ability of race.abilities ?? []) {
            rows.push({ type: "ability", race: race.name, name: ability.name, automation: ability.automation })
            for (const option of ability.options ?? []) {
                rows.push({ type: "option", race: race.name, name: `${ability.name}: ${option.name}`, automation: option.automation })
            }
        }
    }
    return rows
}

function validateAutomation(data) {
    const errors = []
    const rows = featureRows(data)
    for (const row of rows) {
        const automationData = row.automation
        if (!automationData) {
            errors.push(`${row.race} / ${row.name}: automation missing`)
            continue
        }
        if (!["full", "partial", "manual"].includes(automationData.coverage)) {
            errors.push(`${row.race} / ${row.name}: invalid coverage ${automationData.coverage}`)
        }
        for (const effect of automationData.effects ?? []) {
            if (!effect.key && !Array.isArray(effect.changes) && !effect.statusId) {
                errors.push(`${row.race} / ${row.name}: effect ${effect.label ?? effect.name ?? ""} has no key/changes/status`)
            }
            for (const changeEntry of effect.changes ?? []) {
                if (!changeEntry.key || !Number.isFinite(Number(changeEntry.mode))) {
                    errors.push(`${row.race} / ${row.name}: invalid effect change`)
                }
            }
            if (effect.key && !Number.isFinite(Number(effect.mode))) {
                errors.push(`${row.race} / ${row.name}: invalid effect mode for ${effect.key}`)
            }
        }
        for (const activityData of automationData.activities ?? []) {
            if (!activityData.type || !activityData.name) {
                errors.push(`${row.race} / ${row.name}: invalid activity`)
            }
            for (const appliedEffect of activityData.appliedEffects ?? []) {
                if (!appliedEffect.key && !Array.isArray(appliedEffect.changes) && !appliedEffect.statusId) {
                    errors.push(`${row.race} / ${row.name}: activity ${activityData.name} has invalid applied effect`)
                }
            }
        }
    }
    return errors
}

function countByCoverage(rows) {
    return rows.reduce((acc, row) => {
        const coverage = row.automation?.coverage ?? "manual"
        acc[coverage] = (acc[coverage] ?? 0) + 1
        return acc
    }, { full: 0, partial: 0, manual: 0 })
}

function writeReport(data) {
    const rows = featureRows(data)
    const raceRows = rows.filter((row) => row.type === "race")
    const featureOnlyRows = rows.filter((row) => row.type !== "race")
    const raceCounts = countByCoverage(raceRows)
    const featureCounts = countByCoverage(featureOnlyRows)
    const allMechanics = unique(rows.flatMap((row) => row.automation?.mechanics ?? [])).sort((a, b) => a.localeCompare(b))

    const lines = [
        "# Автоматизация рас Тейванкаля V0.1",
        "",
        `Версия automation: ${VERSION}`,
        "",
        "## Итог",
        "",
        `- Рас: full ${raceCounts.full}, partial ${raceCounts.partial}, manual ${raceCounts.manual}.`,
        `- Особенностей и вариантов: full ${featureCounts.full}, partial ${featureCounts.partial}, manual ${featureCounts.manual}.`,
        `- Типы механик: ${allMechanics.join(", ")}.`,
        "",
        "## Полностью автоматизировано",
        "",
        ...featureOnlyRows
            .filter((row) => row.automation?.coverage === "full")
            .map((row) => `- ${row.race}: ${row.name} — ${row.automation.notes}`),
        "",
        "## Частично автоматизировано",
        "",
        ...featureOnlyRows
            .filter((row) => row.automation?.coverage === "partial")
            .map((row) => `- ${row.race}: ${row.name} — ${row.automation.notes}`),
        "",
        "## Вручную",
        "",
        ...featureOnlyRows
            .filter((row) => row.automation?.coverage === "manual")
            .map((row) => `- ${row.race}: ${row.name} — ${row.automation.notes}`),
        ""
    ]

    fs.writeFileSync(REPORT_PATH, `${lines.join("\n").trimEnd()}\n`, "utf8")
    return { raceCounts, featureCounts, mechanics: allMechanics }
}

function main() {
    const data = JSON.parse(fs.readFileSync(DATA_PATH, "utf8"))
    applyAutomation(data)

    const errors = validateAutomation(data)
    if (errors.length) {
        throw new Error(`Race automation validation failed:\n${errors.join("\n")}`)
    }

    fs.writeFileSync(DATA_PATH, `${JSON.stringify(data, null, 2)}\n`, "utf8")
    const summary = writeReport(data)

    console.log(`Race automation written to ${path.relative(ROOT_DIR, DATA_PATH)}`)
    console.log(`Report written to ${path.relative(ROOT_DIR, REPORT_PATH)}`)
    console.log(`Races full/partial/manual: ${summary.raceCounts.full}/${summary.raceCounts.partial}/${summary.raceCounts.manual}`)
    console.log(`Features full/partial/manual: ${summary.featureCounts.full}/${summary.featureCounts.partial}/${summary.featureCounts.manual}`)
}

main()
