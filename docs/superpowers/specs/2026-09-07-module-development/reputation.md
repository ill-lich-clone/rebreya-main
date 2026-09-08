# Слава и дурная слава: инвентарь → Группа

Общие ограничения: [основная спецификация](../2026-09-07-module-development-design.md). Запрос 6, этап R5.
Окончательное размещение уточнено пользователем 2026-09-08: «внутрь инвентаря на страницу группа».

## Размещение — окончательное уточнение пользователя 2026-09-08

«Засунь её внутрь инвентаря на страницу группа». Панель репутации находится только в партийном инвентаре, на странице «Группа», над списком участников. Cosmos/Механус и XP не содержат счётчиков. Это заменяет прежний вариант размещения под секцией Механуса в Космологии.

Владелец поверхности — `scripts/ui/inventory-app.js`, шаблоны `inventory-app.hbs` и `reputation-panel.hbs`; read-only presentation/controller — `scripts/ui/reputation-panel.js`. Отдельного Application нет. Выбор ограничен доступными character-участниками текущей группы; выделенные токены не используются. При смене группы недопустимый выбор очищается.

## Предлагаемое поведение и данные

Сохраняем два независимых значения character Actor, рост одного не уменьшает другое. Карточка обязана явно показывать выбранного участника группы и выбор Actor; не писать данные случайно последнему выделенному token. Предложение initial selection: явный выбор GM, затем ранее выбранный Actor этого окна; отсутствие выбора — read-only пустое состояние.

Первый выпуск: неотрицательные safe integer, default0/0, изменение GM-only, без порогов/бонусов/фракций/групповой суммы. Это предлагаемые механические defaults, а не дополненные авторские правила. Set или delta с кратким основанием; отмена no-op; отрицательный результат отклоняется.

Игрок видит только доступных ему участников (не ниже OBSERVER) и read-only счётчики. Изменения — только authenticated GM. Репутация не расширяет права управления Механусом.

Проектируемые файлы:

- scripts/data/reputation-rules.js — pure validation/projection;

- scripts/application/reputation-service.js — один owner Actor flag/receipt;

- scripts/infrastructure/foundry/reputation-command-contract.js — exact payload.
UI расширяет существующую страницу «Группа». `InventoryApp.refreshReputationPanel()` перерисовывает только собственную секцию по escaped Handlebars template; не собирает весь inventory/economy. Паспорт: разделы2/9/16 и `docs/reputation-function-passport.md`.

Actor flag flags.rebreya-main.reputation:
{version:1,fame:0,infamy:0,revision:0,recentChanges:[]}.
Read legacy Actor даёт default без mutation. История bounded50: operationId, authority timestamp, authenticated GM ID, old/new, reason. Массовая migration при ready не нужна.

Новые public getReputation(actorOrUuid), updateReputation({actorUuid,expectedRevision,change,reason,operationId}); change exact union set:{fame,infamy} либо delta:{fame,infamy}. reputation.update авторизует только authenticated GM, inactive GM идёт через gateway. Fresh revision проверяется в Actor queue; counters/revision/history — один Actor update.

Повтор ID с тем же payload возвращает результат; иной payload конфликтует. Beyond bounded history expectedRevision не позволяет повторно применить старую delta. Concurrent edits дают stale revision, не затирают друг друга. Refresh касается карточки выбранного Actor, не пересобирает весь inventory/economy.

## Проверки

Новые tests/reputation-service.test.mjs, reputation-socket.test.mjs, reputation-ui.test.mjs. Existing group-command-dispatch, main-composition-root; cosmology-mechanus-rolls и bg3-hotbar-compat при затронутом panel lifecycle.
Default no write; set/delta; zero/overflow/NaN/string rejection; independent counters; concurrency; retry/conflict; player denial; no active GM; bounded history; legacy data; text escaping; два Actor, переключение выбора во время формы.

Live: оба счётчика на странице «Группа» партийного инвентаря; узкое окно, длинное имя, rerender/reload; редактируется явно названный Actor. Механус продолжает переключаться прежним GM маршрутом, сторонние клиенты не получают новые права.

Transport request ID — SHA-256 канонического payload/actor/GM/operation ID: altered payload не скрывается gateway replay cache. Durable receipt остаётся на Actor вместе с обоими счётчиками в одном update. Write response содержит только version/fame/infamy/revision, чтобы 50 длинных Unicode причин не переполняли typed envelope. Полная история читается через getReputation.
