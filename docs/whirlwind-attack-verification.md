# Круговая атака 1.5.1: проверка

Дата: 2026-10-24. Ветка: `lich_branch`.

## Результат

У melee-оружия с `lchWhirl` добавляется activity «Круговая атака». Одна атака по всем существам в текущей досягаемости, включая союзников, кроме атакующего; половина урона. Поддержанные дополнительные эффекты ограничены одной выбранной hit target; Sneak Attack также получает половину урона. Новый once-turn tracker не создаётся. Обычные активности, authored formulas, расходы и собственные лимиты способностей сохраняются.

Spec: [2026-10-24-whirlwind-attack-design.md](superpowers/specs/2026-10-24-whirlwind-attack-design.md).

Plan: [2026-10-24-whirlwind-attack.md](superpowers/plans/2026-10-24-whirlwind-attack.md).

Владельцы/сигнатуры: [паспорт](whirlwind-attack-function-passport.md).

## Выполненные проверки

- До изменений: `node --test tests/combat-attack-service.test.mjs tests/gear-compendium.test.mjs tests/rogue-automation-service.test.mjs` — 132 passed, 0 failed.
- Новые focused regressions наблюдались RED→GREEN: проекция и idempotent repair, authored/native defaults, все фракции/reach/blocked distance, отсутствие нового лимита, один total против разных КД, адресные пакеты и shared Actor tokens, native tray Actor contract, исходный activity resource, сохранение MIDI checked hits/EC и autoCheckHit=none, damage-card snapshot без сброса workflow, Sneak Attack/Fury/Fire Rune.
- `node --test tests/*.test.mjs` — **4986 tests: 4985 passed, 0 failed, 1 skipped**. Первый полный прогон обнаружил два partial-service hook fixture несовпадения и два stale release/cache assertion; причины устранены без удаления assertions, затронутые suites повторно прошли, затем полный прогон стал зелёным.
- `node --check` всех tracked JS/MJS и новых JS/MJS — **1055 checked, 0 failed**. После последних правок повторно проверены 22 изменённых/новых JS/MJS — 0 failed.
- `Get-Content -Raw -Encoding UTF8 <tracked-json> | ConvertFrom-Json` — **58 checked, 0 failed**.
- `git diff --check` — passed.
- Новый forwarder `scripts/main-1.5.1.js` импортирует только `scripts/main.js`; manifest и README согласованы, прежние опубликованные forwarders сохранены для кэшированных manifests. Cache URLs изменённых владельцев обновлены, общий named-icon cache contract сохранён.

## Независимое ревью

Отдельный reviewer нашёл три Important проблемы: Actor/Token contract native tray, refund cloned activity resource и перезапись MIDI hits через raw AC. Все исправлены с failing regression до исправления и green после. Дополнительно исправлена потеря prepared melee defaults при `toObject()`. Critical findings и отложенных Minor замечаний нет.

Antigravity Gemini первоначально не смог выполнить read-only exploration: headless command permission denied. Продолжение локально разрешено AGENTS.md; независимый review выполнен Codex subagent.

## Границы подтверждения

Установлена dnd5e **5.2.5**. Тесты запускают её настоящий native damage calculator из локального source map и подтверждают mixed/odd damage, критические totals, resistance/immunity, native token scope и MIDI property aggregation contract.

**Live world workflow не проверен.** Экран локального Foundry показывает **13 build 351**; оба GM на join screen заняты, отдельной доступной GM-сессии для QA нет, MCP Bridge возвращает `Foundry VTT module not connected`. Чужие сессии не отключались, игровые документы для QA не создавались. Не подтверждены live GM/player, reload/duplicate-hook UI, фактический native damage tray и полный MIDI attack/damage workflow. Node/source tests не заменяют эти проверки.

Native tray adapter опирается на установленную dnd5e 5.2.5; при обновлении системы его следует повторно проверить в живом мире. Непроверенные версии других систем не заявлены поддержанными этой автоматизацией.
