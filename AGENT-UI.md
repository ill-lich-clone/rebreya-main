# Rebreya UI Agent Guide

Этот документ предназначен для агента, который меняет интерфейс модуля Rebreya Main. Цель: позволить перерабатывать внешний вид и компоновку окон, не затрагивая игровую логику, данные, сокеты и автоматизацию персонажей.

## Границы задачи

Для обычного редизайна работай только с:

- `templates/*.hbs` - Handlebars-разметка окон;
- `styles/main.css` - общие и локальные стили;
- `scripts/ui/*.js` - только когда требуется изменить поведение интерфейса, подготовленный контекст или обработчик действия;
- `scripts/integrations/dnd5e-sheet-extensions.js` - только для вкладок, встроенных в лист персонажа.

Не меняй ради дизайна:

- `scripts/data/**`;
- `scripts/combat/**`;
- сокетные сообщения и обработчики в `scripts/main.js`;
- сервисы экономики, инвентаря, календаря и простоя;
- `module.json`, если задача не связана с выпуском новой версии;
- `scripts/main-1.4.*.js` вручную: это копии entrypoint для cache busting;
- структуру данных, флаги Foundry, UUID и права пользователей.

## Слои UI

Каждое основное окно состоит из трех частей:

1. Шаблон в `templates/*.hbs` определяет DOM и отображаемые блоки.
2. Класс в `scripts/ui/*-app.js` готовит контекст, размеры окна и события.
3. `styles/main.css` оформляет элементы через классы `rebreya-*` и `rm-*`.

Точки открытия окон находятся в `scripts/main.js`, начиная примерно с методов `openLootgenApp`, `openTrader`, `openEconomyApp` и `openInventoryApp`. Для визуальных изменений эти методы трогать не нужно.

## Карта окон

| Интерфейс | Шаблон | Контроллер | Корневые CSS-классы |
| --- | --- | --- | --- |
| Экономика | `templates/economy-app.hbs` | `scripts/ui/economy-app.js` | `.rebreya-economy-app`, `.rm-economy-shell` |
| Город | `templates/city-app.hbs` | `scripts/ui/city-app.js` | `.rebreya-city-app`, `.rm-city-shell` |
| Государства | `templates/states-app.hbs` | `scripts/ui/states-app.js` | `.rebreya-states-app`, `.rm-state-*` |
| Глобальные события | `templates/global-events-app.hbs` | `scripts/ui/global-events-app.js` | `.rebreya-global-events-app`, `.rm-global-event-*` |
| Группы | `templates/groups-app.hbs` | `scripts/ui/groups-app.js` | `.rebreya-groups-app` и общие `.rm-*` |
| Партийный инвентарь | `templates/inventory-app.hbs` | `scripts/ui/inventory-app.js` | `.rebreya-inventory-app`, `.rm-inventory-*`, `.rm-party-*` |
| Лутген | `templates/lootgen-app.hbs` | `scripts/ui/lootgen-app.js` | `.rebreya-lootgen-app`, `.rm-lootgen-*` |
| Старая торговля | `templates/trader-app.hbs` | `scripts/ui/trader-app.js` | `.rebreya-trader-app`, `.rm-trader-*` |
| Новая торговля | `templates/trader-app-v2.hbs` | `scripts/ui/trader-app-v2.js` | `.rebreya-trader-app-v2`, `.rm-trader-v2-*` |
| Мировые связи | `templates/trade-routes-app.hbs` | `scripts/ui/trade-routes-app.js` | `.rebreya-world-trade-routes-app`, `.rm-route-*` |
| Одна торговая связь | `templates/trade-route-app.hbs` | `scripts/ui/trade-route-app.js` | `.rebreya-trade-route-app`, `.rm-route-*` |
| Справочное окно | `templates/reference-info-app.hbs` | `scripts/ui/reference-info-app.js` | `.rebreya-reference-app` и общие `.rm-*` |
| Простой в листе персонажа | `templates/character-downtime-tab.hbs` | `scripts/integrations/dnd5e-sheet-extensions.js` | `.rm-character-downtime-*` |
| Кукла героя | `templates/hero-doll-tab.hbs` | `scripts/integrations/dnd5e-sheet-extensions.js` | `.rm-hero-doll-*` |

Чат-карточки лутгена формируются в `scripts/ui/lootgen-chat.js`, а не отдельным HBS-шаблоном.

## Безопасные изменения шаблонов

Можно:

- менять порядок визуальных секций;
- добавлять контейнеры и новые CSS-классы;
- менять заголовки и поясняющий текст;
- заменять текстовые кнопки иконками, если сохраняется действие и доступное имя;
- добавлять декоративные элементы, не участвующие в логике.

Нельзя удалять или переименовывать без проверки JS:

- `data-action`;
- `data-*` с идентификаторами актера, предмета, группы, вкладки или записи;
- `name`, `value`, `type` у полей формы;
- Handlebars-переменные `{{...}}`;
- блоки `{{#if}}`, `{{#each}}`, `{{#unless}}`, если не проверена подготовка контекста;
- классы, по которым JS ищет элементы через `querySelector`, `closest` или делегирование событий;
- drag-and-drop атрибуты и dropzone-контейнеры.

Перед переименованием класса ищи его использование:

```powershell
rg -n "имя-класса" templates scripts styles tests
```

## Безопасные изменения CSS

Общая серо-золотая тема объявлена в начале `styles/main.css` через semantic custom properties:

- `--rm-surface-*` - поверхности;
- `--rm-border-*` - границы;
- `--rm-text-*` - уровни текста;
- `--rm-color-gold*` и `--rm-accent*` - акценты;
- `--rm-positive`, `--rm-negative`, `--rm-warning` - смысловые состояния.

Предпочитай эти токены жестко заданным цветам. Общие классы `.rm-shell`, `.rm-hero`, `.rm-panel`, `.rm-button`, `.rm-field`, `.rm-row` и `.rm-tab` влияют сразу на несколько окон.

Для локального изменения обязательно ограничивай селектор классом приложения:

```css
.rebreya-states-app .rm-hero {
  /* Только окно государств. */
}
```

Не добавляй глобальный override в конец файла, если правило можно исправить в существующем тематическом блоке. Не меняй размеры и позиционирование общих компонентов ради одного окна.

## Исключение: Trader v2

Новая торговля имеет собственную законченную бумажно-винную тему и не наследует общую серо-золотую палитру.

Не перекрашивай и не централизуй без отдельного требования:

- `.rebreya-trader-app-v2`;
- `.rm-trader-v2-*`;
- `templates/trader-app-v2.hbs`;
- `templates/texture/shop.webp`;
- локальные переменные `--rm-trader-v2-paper`, `--rm-trader-v2-wine`, `--rm-trader-v2-gold`;
- светлую `color-scheme` элементов торговли.

Тест `tests/style-theme.test.mjs` специально проверяет, что Trader v2 сохраняет автономную parchment-тему.

## Когда разрешено менять JS окна

Меняй `scripts/ui/*-app.js`, только если задача требует:

- нового интерактивного элемента;
- нового `data-action`;
- нового значения в контексте шаблона;
- изменения размеров или параметров ApplicationV2;
- новой вкладки, фильтра, состояния или диалога;
- изменения drag-and-drop поведения.

В классах окон важны следующие участки:

- `DEFAULT_OPTIONS` - CSS-классы, заголовок, размеры и действия;
- `PARTS` - путь к HBS-шаблону;
- `_prepareContext` - данные, доступные шаблону;
- `_onRender` - привязка событий после рендера;
- обработчики действий и drag-and-drop.

Не меняй методы, вызывающие сервисы, пока задача не требует изменения поведения. UI не должен напрямую обновлять Actor, Item или world settings в обход существующего API и сокетов.

`scripts/ui/inventory-app.js` и `scripts/ui/global-events-app.js` также создают несколько модальных окон непосредственно из JS. Их разметку можно менять только вместе с соответствующими обработчиками и тестами.

## Изображения и ассеты

UI-ассеты находятся преимущественно в:

- `templates/texture/**`;
- `templates/icons/**`;
- корне `templates` для отдельных изображений счетчиков и оверлеев.

Не переименовывай и не перемещай ассет без поиска всех ссылок на старый путь. Используй абсолютные Foundry-пути вида:

```text
/modules/rebreya-main/templates/texture/shop.webp
```

## Проверка после изменений

Минимальный набор:

```powershell
git diff --check
node --test tests/style-theme.test.mjs
node --test tests\*.test.mjs
```

Для партийного инвентаря дополнительно проверь:

```powershell
node --test tests/inventory-app-context.test.mjs
```

Для вкладок листа персонажа:

```powershell
node --test tests/dnd5e-sheet-downtime-tab.test.mjs
```

После значительных изменений открой соответствующее окно в Foundry и проверь:

- GM и игрока, если окно доступно обоим;
- desktop-размер и уменьшенное окно;
- hover, focus, active, disabled и empty states;
- длинные русские названия;
- прокрутку;
- drag-and-drop;
- диалоги подтверждения;
- отсутствие ошибок в консоли.

## Git-правила проекта

- Перед работой проверить `git status`, текущую ветку и выполнить `git fetch origin`.
- Работать только в `lich_branch`.
- Не коммитить и не пушить напрямую в `main` или `master`.
- Не перезаписывать чужие незакоммиченные изменения.
- Не использовать force push без отдельного разрешения.
- Перед коммитом проверить diff и запустить доступные тесты.

## Короткий чек-лист для UI-агента

1. Определи конкретное окно по таблице выше.
2. Найди его HBS, JS-класс и корневой CSS-класс.
3. Для чистого редизайна начни с HBS и CSS.
4. Сохрани все контракты `data-*`, `name`, Handlebars и drag-and-drop.
5. Ограничь новые стили корневым классом окна.
6. Не затрагивай Trader v2 при общей переработке темы.
7. Не редактируй versioned `scripts/main-1.4.*.js` вручную.
8. Запусти тесты и проверь окно в Foundry.
