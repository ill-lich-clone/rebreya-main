# Производительность переходов группового боя

Исправление регрессии существующего утверждённого [контракта](2026-10-20-grouped-combat-start-design.md). Сохраняются отдельные start/end каждого существа, native workflows, persistent receipts, rewind/recovery, настройки, ресурсы и авторские формулы.

## Подтверждённые причины

- `runPipeline` сохраняет running и done для каждого шага. Repository каждый раз клонирует и заменяет весь groupedCombat flag, включая историю всех предыдущих ходов.
- Foundry 13.351 `Combat._onUpdate` безусловно вызывает `updateCombatantActors`, который вызывает actor.render для каждого участника, независимо от render:false. dnd5e 5.2.5 `_onUpdate` также обновляет rings при отличии current/previous, сохраняющемся при промежуточных flag writes.
- Native Times Up updateCombat callback сканирует durations даже при flag-only updates. Наш guard пропускал такие writes, хотя логические phases уже обрабатывает grouped adapter. Это лишние scans и возможная обработка native flattened clock между шагами.

Gemini независимо подтвердил amplification и рост snapshot costs. Его предложение подавить обычные native position commits не принимается: реальные игровые границы должны сохранять native hooks/визуальные обновления. Повторные linear scans пока не оптимизируются: приоритет — доказанные Document/render/serialization costs.

## Наблюдаемый результат и минимальное изменение

1. Во время служебного progress-only write не перерисовывать Actor sheets и token rings. Прочая Document lifecycle, updateCombat hooks и получение новых flags остаются. Native position, финальный commit, blocked state и обычные бои обновляются штатно.
2. Записывать отдельный receipt + revision маленьким native patch; полный snapshot сохранять на phase/checkpoint и финальных границах. Running остаётся durable до workflow, done — после него. Metadata/anchors/memberStarts/checkpoints и все исторические receipts сохраняются, без нового retention ceiling.
3. Guard идентифицированных native turn-provider callbacks для managed active/blocked Combat не пропускает flag-only writes. Фазы выполняет только существующий adapter; pending/ordinary Combat сохраняет native callback.
4. Не менять текущий пользовательский бой, не перебрасывать инициативу, не отключать effects или camera и не заменять provider workflow прямыми HP writes.

## Evidence и пределы

Регрессии измеряют число sheet/ring refreshes, размер receipt payload при большой истории и сохранность flags через настоящие Foundry expandObject/mergeObject. Сравнить до/после на одинаковой fixture. Это не измерение реального FPS.

Live bridge сейчас отвечает module not connected. Пользователь ранее разрешил обходиться без живых тестов; улучшение FPS в его мире без подключения не заявляется. Source baseline: module 1.5.1, Foundry 13.351/dnd5e 5.2.5; release — 1.5.2.
