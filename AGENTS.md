# Rebreya Main: инструкции для агента

Этот файл — короткая обязательная точка входа. Не читай весь репозиторий или большие документы целиком: сначала выбери слой и владельца изменения.

## Когда читать паспорт функций

Если для задачи нужны конкретные функции, методы, владельцы данных, маршруты вызовов, точки расширения или профильные тесты, открой `docs/function-passport.md` и прочитай только относящийся к задаче раздел.

- Для поиска раздела сначала используй `rg -n "термин|метод|файл" docs/function-passport.md`.
- Не загружай паспорт целиком без прямой необходимости.
- Любые новые или изменённые методы записывай в соответствующий раздел паспорта в том же commit.
- Обновляй сигнатуры, назначение, владельца, data flow, ограничения и профильные тесты. Удалённую функцию удаляй или заменяй в паспорте.
- Паспорт описывает текущее состояние проекта, а не историю изменений.

## Обязательный Git-процесс

- Репозиторий общий: код параллельно изменяют несколько человек.
- Перед правками выполни `git status --short --branch`, `git branch --show-current` и `git fetch origin`.
- Основная ветка — `main`; если remote использует `master`, проверяй её аналогично.
- Все изменения вноси только в `lich_branch`. Никогда не коммить и не пушь напрямую в `main` или `master`.
- После fetch выполни `git rev-list --left-right --count HEAD...origin/main` и `git log --oneline HEAD..origin/main`.
- Если есть чужие незакоммиченные изменения, remote `lich_branch` ушла вперёд или актуальная основная ветка конфликтует с работой — остановись и сообщи пользователю.
- Не используй `git add -A` в смешанной рабочей копии; добавляй только файлы текущей задачи.
- Перед commit проверь `git diff --check`, `git diff --stat` и содержательный `git diff`.
- После проверок сделай осмысленный commit и `git push -u origin lich_branch`.
- Force push запрещён без отдельного разрешения.

## Быстрый вход

- Среда: Foundry VTT 13, система dnd5e, обязательный модуль `statuscounter >= 3.0.4`.
- Источник версии и runtime-entrypoint — `module.json`.
- Versioned forwarder `scripts/main-<version>.js` должен только импортировать `scripts/main.js`.
- `scripts/main.js` — единственный composition root; он собирает сервисы, hooks и socket routes и публикует `game.rebreyaMain` и `game.modules.get("rebreya-main")?.api`.
- Обзор пользовательского API находится в `README.md`; открывай нужный раздел по заголовку.
- `docs/rebreya-module-architecture.html` — generated snapshot. Перед использованием сверяй `sourceCommit`; для обновления запускай `node tools/generate-architecture-map.mjs`.

## Архитектурные слои

| Слой | Каноническое место | Назначение |
|---|---|---|
| Composition | `scripts/main.js` | lifecycle, зависимости, API, socket dispatch |
| Application | `scripts/application/`, `scripts/features/trading/` | use cases, транзакции, recovery, идемпотентность |
| Domain/data | `scripts/data/`, `scripts/engine/`, `data/` | правила, каталоги, состояние, расчёты |
| Infrastructure | `scripts/infrastructure/` | repositories, active GM, typed sockets, UI refresh |
| Automation | `scripts/combat/`, `scripts/automation/`, `scripts/cosmology/`, `scripts/rest/` | Foundry/dnd5e hooks и игровые автоматизации |
| Integration | `scripts/integrations/` | адаптеры dnd5e и сторонних модулей |
| UI | `scripts/ui/`, `templates/`, `styles/` | ApplicationV2, Handlebars, оформление |
| Shared | `scripts/shared/` | общие примитивы без доменной семантики |
| Verification | `tests/` | Node test runner и focused-тесты владельцев поведения |

Направляй зависимости к domain/application и инфраструктурным интерфейсам. UI не должен напрямую писать world settings или исполнять привилегированные мутации.

## Как переходить к реализации

1. Сформулируй одно наблюдаемое поведение и предполагаемого владельца по архитектурной карте.
2. Если нужны функции или точный data flow, найди соответствующий раздел в `docs/function-passport.md`.
3. Найди declaration, вызовы, flags, commands и hooks через `rg`; открывай только найденные диапазоны.
4. Расширяй существующий канонический сервис, API-метод или socket command. Не создавай второго владельца, app или hook.
5. World-state изменяй через repository/coordinator, не через прямой `game.settings` из UI.
6. Player-операцию с правами GM маршрутизируй через валидируемую typed command с авторизацией отправителя.
7. Сначала добавь или измени focused-тест владельца, затем внеси минимальную реализацию.
8. При изменении публичного контракта обнови соответствующий раздел `README.md`.
9. При изменении или добавлении методов обнови `docs/function-passport.md` в том же commit.
10. Сохраняй исходники, JSON, шаблоны и русские строки в UTF-8 без повреждённой кириллицы.

## Проверки

Focused-тест выбирай по владельцу из паспорта. Полная проверка перед завершением:

```powershell
node --test tests/*.test.mjs
git diff --check

$files = git ls-files '*.js' '*.mjs'
foreach ($file in $files) { node --check $file }

$json = git ls-files '*.json'
foreach ($file in $json) { Get-Content -Raw -Encoding UTF8 $file | ConvertFrom-Json | Out-Null }
```

В отчёте укажи команды, число passed/failed и реальные ошибки; полный успешный вывод не вставляй.

## Что не загружать без прямой необходимости

- `docs/**/*.pdf`, `*.xlsx`, большие исходные TXT/MD сеттинга;
- `docs/rebreya-module-architecture.html` целиком;
- `docs/superpowers/plans/` и исторические design-документы, если задача не продолжает конкретный план;
- трассы, Selenium-логи, `tmp/`, `tmp-*` и иные производные артефакты;
- большие `scripts/main.js`, `scripts/ui/inventory-app.js`, `scripts/data/inventory-service.js` и `magicItem.js` целиком: сначала ищи имя, export или узкий диапазон через `rg`.
