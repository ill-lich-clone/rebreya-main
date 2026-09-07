# Слава и дурная слава: под блоком Механуса

Общие ограничения: [основная спецификация](../2026-09-07-module-development-design.md). Запрос 6, этап R5.
Пользователь уточнил: «Два счётчика ПОД место где лежит механус». Это заменяет исходную привязку к полоске опыта.

## Визуальная привязка

Два отдельных счётчика «Слава» и «Дурная слава» располагаются непосредственно под местом Механуса. Не добавлять их под XP/уровень, не искать такую точку в character sheet.

В коде подтверждены два связанных UI места:

- scripts/ui/cosmology-app.js, CosmologyApp._prepareContext()/_onRender(), templates/cosmology-app.hbs: окно «Космология» с отдельной секцией Механуса;

- scripts/hooks.js, buildToolsRecord(): кнопка rebreya-main-cosmology, order35, в панели Rebreya.
При подготовке задан уточняющий вопрос о конкретной поверхности. Проектируемый вариант — карточка внутри окна Космологии сразу после секции Механуса. Если пользователь укажет панель, изменить только UI anchor, data owner останется прежним. Не считать это уточнение разрешением вернуть XP placement.

## Предлагаемое поведение и данные

Сохраняем два независимых значения character Actor, рост одного не уменьшает другое. Поскольку окно глобальное, карточка обязана явно показывать выбранного персонажа и выбор Actor; не писать данные случайно последнему выделенному token. Предложение initial selection: явный выбор GM, затем ранее выбранный Actor этого окна; отсутствие выбора — read-only пустое состояние.

Первый выпуск: неотрицательные safe integer, default0/0, изменение GM-only, без порогов/бонусов/фракций/групповой суммы. Это предлагаемые механические defaults, а не дополненные авторские правила. Set или delta с кратким основанием; отмена no-op; отрицательный результат отклоняется.

Текущая кнопка Космологии GM-only. Счётчики не должны незаметно открывать игрокам управление Механусом. Если требуется player display, он read-only для своего Actor и отдельно проверяется. Изменение UI не расширяет authority никакого cosmology command.

Проектируемые файлы:

- scripts/data/reputation-rules.js — pure validation/projection;

- scripts/application/reputation-service.js — один owner Actor flag/receipt;

- scripts/infrastructure/foundry/reputation-command-contract.js — exact payload.
UI расширяет CosmologyApp/template/styles; новой конкурирующей app для репутации нет. Если выбран panel anchor — небольшой view в existing scripts/hooks.js, без state writes. Паспорт: разделы2,16,19.

Actor flag flags.rebreya-main.reputation:
{version:1,fame:0,infamy:0,revision:0,recentChanges:[]}.
Read legacy Actor даёт default без mutation. История bounded50: operationId, authority timestamp, authenticated GM ID, old/new, reason. Массовая migration при ready не нужна.

Новые public getReputation(actorOrUuid), updateReputation({actorUuid,expectedRevision,change,reason,operationId}); change exact union set:{fame,infamy} либо delta:{fame,infamy}. reputation.update авторизует только authenticated GM, inactive GM идёт через gateway. Fresh revision проверяется в Actor queue; counters/revision/history — один Actor update.

Повтор ID с тем же payload возвращает результат; иной payload конфликтует. Beyond bounded history expectedRevision не позволяет повторно применить старую delta. Concurrent edits дают stale revision, не затирают друг друга. Refresh касается карточки выбранного Actor, не пересобирает весь inventory/economy.

## Проверки

Новые tests/reputation-service.test.mjs, reputation-socket.test.mjs, reputation-ui.test.mjs. Existing group-command-dispatch, main-composition-root; cosmology-mechanus-rolls и bg3-hotbar-compat при затронутом panel lifecycle.
Default no write; set/delta; zero/overflow/NaN/string rejection; independent counters; concurrency; retry/conflict; player denial; no active GM; bounded history; legacy data; text escaping; два Actor, переключение выбора во время формы.

Live: оба счётчика сразу под Механусом на согласованной поверхности; узкое окно, длинное имя, rerender/reload; редактируется явно названный Actor. Механус продолжает переключаться прежним GM маршрутом, сторонние клиенты не получают новые права.
