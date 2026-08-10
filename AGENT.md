# Rebreya Main: руководство для агента

Этот файл — короткая карта проекта. Начинай работу отсюда; не читай весь репозиторий, большие исходные документы или исторические планы без прямой необходимости.

## Обязательный Git-процесс

- Репозиторий общий: код параллельно изменяют несколько человек.
- Перед любыми правками выполни `git status --short --branch`, `git branch --show-current` и `git fetch origin --prune`.
- Основная ветка — `main` (если в другом remote используется `master`, проверяй её аналогично).
- Все изменения вноси только в `lich_branch`. Никогда не коммить и не пушь напрямую в `main` или `master`.
- После fetch проверь расхождение: `git rev-list --left-right --count HEAD...origin/main` и `git log --oneline HEAD..origin/main`.
- Если есть чужие незакоммиченные изменения, remote `lich_branch` ушла вперёд или актуальная основная ветка конфликтует с работой — остановись и сообщи пользователю.
- Не используй `git add -A` в смешанной рабочей копии: добавляй только файлы текущей задачи.
- Перед commit проверь `git diff --check`, `git diff --stat` и содержательный `git diff`.
- После проверок сделай осмысленный commit и `git push -u origin lich_branch`. Force push запрещён без отдельного разрешения.

## Быстрый вход

- Среда: Foundry VTT 13, система dnd5e, обязательный модуль `statuscounter >= 3.0.4`.
- Источник версии и runtime-entrypoint — `module.json`. Не доверяй номеру версии в старых документах.
- Manifest загружает versioned forwarder `scripts/main-<version>.js`; он должен только импортировать `scripts/main.js`.
- `scripts/main.js` — единственный composition root. Он создаёт сервисы, регистрирует lifecycle/hooks/socket routes и публикует API как `game.rebreyaMain` и `game.modules.get("rebreya-main")?.api`.
- Полная обзорная документация — `README.md`. Открывай только нужный раздел по заголовку, а не весь файл.
- Сгенерированная карта — `docs/rebreya-module-architecture.html`; это snapshot, поэтому перед использованием сверяй `sourceCommit` и при необходимости запускай `node tools/generate-architecture-map.mjs`. Не загружай HTML целиком в контекст.

## Архитектурные слои

| Слой | Каноническое место | Назначение |
|---|---|---|
| Composition | `scripts/main.js` | lifecycle, сборка зависимостей, публичный API, socket dispatch |
| Application | `scripts/application/`, `scripts/features/trading/` | use cases, транзакции, recovery и идемпотентность |
| Domain/data | `scripts/data/`, `scripts/engine/`, `data/` | правила, каталоги, состояние и расчёты |
| Infrastructure | `scripts/infrastructure/` | Foundry repositories, active-GM, typed sockets, UI refresh |
| Automation | `scripts/combat/`, `scripts/automation/`, `scripts/cosmology/`, `scripts/rest/` | реакции на Foundry/dnd5e hooks и игровые автоматизации |
| Integration | `scripts/integrations/` | адаптеры dnd5e и сторонних модулей |
| UI | `scripts/ui/`, `templates/`, `styles/` | ApplicationV2, Handlebars и оформление |
| Shared | `scripts/shared/` | только действительно общие примитивы без доменной семантики |
| Verification | `tests/` | Node test runner; тесты названы по владельцу поведения |

Зависимости направляй к domain/application и инфраструктурным интерфейсам. UI не должен напрямую писать world settings или исполнять привилегированные мутации.

## Карта функций и владельцев

- Экономическая модель, города, товары, маршруты и цены: `scripts/data/repository.js`, `scripts/engine/economy-engine.js`, `scripts/engine/selectors.js`.
- Глобальные события и политики государств: `scripts/data/global-events-service.js`; публичная композиция и команды — `scripts/main.js`; UI — `scripts/ui/global-events-app.js`, `scripts/ui/states-app.js`.
- Торговцы, ассортимент и аудит: `scripts/data/trader-service.js`, `scripts/infrastructure/foundry/trader-state-repository.js`; транзакции и rollback — `scripts/features/trading/`; UI — `scripts/ui/trader-app-v2.js`.
- Группы и партийный контекст: `scripts/data/group-context-service.js`, `scripts/infrastructure/foundry/group-state-repository.js`, `scripts/ui/groups-app.js`.
- Инвентарь и предметные перемещения: `scripts/data/inventory-service.js`, `scripts/integrations/inventory-sync.js`, `scripts/ui/inventory-app.js`.
- Контейнеры, склады и наземные piles: `scripts/data/storage-*.js`, `scripts/integrations/storage-*.js`, `scripts/ui/storage-*.js`.
- Календарь и безопасные переходы дат: `scripts/data/calendar-service.js`, `scripts/data/calendar-transition-coordinator.js`.
- Простой и проекты персонажей: `scripts/data/downtime-service.js`, `scripts/data/character-downtime-service.js`, `scripts/data/downtime-scheduler.js`.
- Крафт и долговременные проекты: `scripts/data/crafting-service.js`, `scripts/data/craft-downtime-service.js`, `scripts/data/craft-project-processor.js`, `scripts/data/crafting-rules.js`.
- Путешествия, карта и транспорт: `scripts/data/travel-service.js`, `scripts/data/travel-map-service.js`, `scripts/data/transport-*.js`; интеграции — `scripts/integrations/transport-*.js`.
- Лутген и выдача из чата: `scripts/data/lootgen-*.js`, `scripts/ui/lootgen-app.js`, `scripts/ui/lootgen-chat.js`.
- Прочность, поломка и улучшение предметов: `scripts/data/durability-*.js`, `scripts/data/native-object-durability-service.js`, `scripts/data/item-upgrade-service.js`, соответствующие integrations.
- Managed-компендиумы: `scripts/data/*-compendium.js`; общий lifecycle — `scripts/data/managed-compendium-sync.js` и `scripts/data/compendium-utils.js`.
- Каталоги снаряжения и материалов: `data/gear.json`, `data/materials.json`; синхронизация — `gear-compendium.js`, `materials-compendium.js`, `material-catalog-sync.js`.
- Классы, расы, черты, заклинания, состояния и предыстории: одноимённые `scripts/data/*-compendium.js`; runtime-автоматизации — профильные `scripts/combat/*-automation-service.js`.
- Реакции, атаки и статусы: `scripts/combat/reaction-*.js`, `scripts/combat/attack-*.js`, `scripts/combat/status-*.js`; единая регистрация — `scripts/combat/hooks.js`.
- Долгий отдых: `scripts/rest/long-rest-pipeline-service.js` и `scripts/integrations/long-rest-hooks.js`.
- Quest Log, листы dnd5e и совместимость модулей: профильные файлы в `scripts/integrations/`.
- UI refresh принадлежит `scripts/infrastructure/ui/ui-refresh-coordinator.js`; не делай массовый `render()` в domain-коде.
- Привилегированные операции идут через `scripts/infrastructure/foundry/socket-command-bus.js` и active GM из `active-gm.js`.
- Magic items используют корневой `magicItem.js`; он импортируется runtime-кодом и не является мусорным документом.

## Как переходить к реализации

1. Сформулируй одно наблюдаемое поведение и предполагаемого владельца из карты выше.
2. Найди declaration, вызовы, flags, commands и hooks: `rg -n "термин|метод|flag|command|hook" scripts tests README.md`.
3. Открывай только найденные диапазоны. Большие `scripts/main.js`, `inventory-app.js`, `inventory-service.js`, PDF/XLSX и generated HTML целиком не читай.
4. Проверь, нет ли уже канонического сервиса, API-метода или socket command. Расширяй владельца; не создавай второй Trader/Inventory/Sheet app и не дублируй hook.
5. Для world-state используй repository/coordinator. Не пиши `game.settings` напрямую из UI.
6. Для операции игрока, требующей прав GM, добавляй валидируемую typed command и авторизацию отправителя; не доверяй payload клиента.
7. Сначала добавь или измени focused-тест `tests/<owner>.test.mjs`, затем внеси минимальную реализацию.
8. При изменении API, socket command, pack lifecycle или automation hook обнови соответствующий раздел `README.md`.
9. Сохраняй исходники, JSON, шаблоны и русские строки в UTF-8 без битой кириллицы.

Чтобы увидеть публичные методы composition root без чтения файла целиком:

```powershell
rg -n '^\s{2}(?:async\s+)?[A-Za-z_$][A-Za-z0-9_$]*\s*\(' scripts/main.js
```

## Проверки

Focused-тест выбирай по владельцу, например:

```powershell
node --test tests/trader-service.test.mjs
node --test tests/storage-service.test.mjs
node --test tests/calendar-transition-coordinator.test.mjs
```

Полная проверка перед завершением:

```powershell
node --test tests/*.test.mjs
git diff --check

$files = git ls-files '*.js' '*.mjs'
foreach ($file in $files) { node --check $file }

$json = git ls-files '*.json'
foreach ($file in $json) { Get-Content -Raw -Encoding UTF8 $file | ConvertFrom-Json | Out-Null }
```

Не вставляй в отчёт полный успешный вывод тестов: достаточно команды, числа passed/failed и текста реальных ошибок.

## Что не загружать без прямой необходимости

- `docs/**/*.pdf`, `*.xlsx`, большие исходные TXT/MD сеттинга;
- `docs/rebreya-module-architecture.html` целиком;
- `docs/superpowers/plans/` и исторические design-документы, если задача не продолжает конкретный план;
- трассы, Selenium-логи, `tmp/`, `tmp-*` и иные производные артефакты;
- весь `magicItem.js`: сначала ищи конкретное имя или export через `rg`.
