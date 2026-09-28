# Door Trigger Target Design

Дата: 2026-08-31

Статус: утверждено пользователем, готово к планированию реализации

Базовая ветка: `lich_branch`

Базовая runtime-версия на момент проектирования: `1.4.196`

## 1. Наблюдаемый результат

Мастер может подключить к любой Foundry-двери механику триггеров Rebreya и настроить для неё замок, ловушки, проверки, урон и Macro тем же редактором и исполнителем, которыми пользуются хранилища.

Для включённой двери Rebreya:

- ЛКМ игрока или мастера по закрытой либо запертой двери показывает компактный canvas-overlay с одной кнопкой `Открыть`;
- нажатие `Открыть` выполняет authoritative `beforeOpen` и открывает дверь только при разрешающем результате;
- после committed открытия выполняется `afterOpen`;
- `Ctrl + ПКМ` мастера открывает редактор триггеров двери;
- обычный ПКМ мастера остаётся штатным Foundry-действием `CLOSED ↔ LOCKED`;
- ЛКМ по открытой двери остаётся штатным Foundry-действием и закрывает её;
- неотмеченная или отключённая дверь сохраняет штатные ЛКМ и обычный ПКМ; GM `Ctrl + ПКМ` остаётся конфигурационным chord.

## 2. Подтверждённое поведение Foundry 13

Установленная среда — Foundry VTT 13 build 351, dnd5e 5.2.5. В точном установленном source `DoorControl`:

- protected `_onMouseDown(event)` обрабатывает только ЛКМ;
- для `LOCKED` ЛКМ проигрывает локальный звук проверки и не меняет документ;
- для `CLOSED`/`OPEN` ЛКМ обновляет `WallDocument.ds`;
- protected `_onRightDown(event)` доступен только GM, ничего не делает для `OPEN` и переключает `CLOSED ↔ LOCKED`;
- `CONFIG.Canvas.doorControlClass` является выбираемым классом canvas-контрола двери.

Реализация расширяет настраиваемый класс и документированные protected handlers, а не подменяет PIXI-listeners после каждого `draw()`.

## 3. Границы задачи

### Входит

- versioned trigger-флаг на embedded `WallDocument`;
- общий target descriptor и coordinator для storage/door trigger targets;
- door persistence adapter без loot-состояния;
- GM-only read/save/reset конфигурации двери;
- player/GM authoritative попытка открытия;
- canvas-overlay с одной кнопкой;
- `Ctrl + ПКМ` для настройки;
- расстояние 10 футов до ближайшей точки дверного отрезка;
- существующие trigger steps, lock/trap templates и dnd5e adapter;
- focused unit/integration tests и live Foundry QA.

### Не входит

- предметы, монеты, генерация Lootgen, texture modes или состояния `unopened/opened/empty` для двери;
- отдельный door inventory;
- новые действия `Взломать`, `Осмотреть`, `Обезвредить` или выбор способа взаимодействия;
- автоматическое обнаружение секретных дверей;
- новая система cooldown;
- изменение core permissions Foundry;
- автоматическое закрытие двери;
- миграция всех существующих дверей мира.

## 4. Архитектура

### 4.1. Нейтральная цель триггеров

Канонический descriptor имеет форму:

```js
{
  kind: "storage" | "door",
  uuid: "Scene.<sceneId>.Token.<tokenId>" | "Scene.<sceneId>.Wall.<wallId>",
  path: []
}
```

`path` сохраняется для root/nested storage и обязан быть пустым для двери.

Новый общий coordinator маршрутизирует операции к target adapter:

- read trigger state;
- revision-checked save definitions;
- reset execution state;
- atomic runtime update;
- execute event with target-specific allowed events and queue key.

Storage adapter делегирует существующим владельцам `StorageService` и container path. Door adapter работает только с флагом `WallDocument`. `StorageCommandService` и публичные storage API сохраняют прежние сигнатуры и используют coordinator через storage descriptor; не создаётся второй storage owner.

### 4.2. Общий trigger engine и редактор

Существующие schema, validation, execution receipts, repeat modes и dnd5e adapter остаются единственным владельцем логики шагов. Storage продолжает поддерживать:

- `beforeOpen`;
- `afterOpen`;
- `afterClaim`;
- `emptied`.

Door target разрешает только:

- `beforeOpen`;
- `afterOpen`.

Persisted door state сохраняет совместимую v1 `chainsByEvent`; `afterClaim` и `emptied` нормализуются в пустые массивы. Door save отвергает непустые цепочки в запрещённых событиях. Редактор получает `targetKind` и `availableEvents`, показывает две вкладки и переиспользует существующие inspector, step catalog, Item/Token/Macro drop и lock/trap templates. Storage UI и четыре storage-вкладки не меняются.

Если класс редактора получает нейтральное имя, прежний `StorageTriggerEditor` остаётся compatibility export либо тонкой специализацией; существующие импорты и тестовые контракты нельзя молча удалить.

## 5. Persisted state двери

Единственный persisted owner:

```js
flags.rebreya-main.doorTriggerTarget = {
  version: 1,
  enabled: true,
  triggers: {
    version: 1,
    revision: 0,
    chainsByEvent: {
      beforeOpen: [],
      afterOpen: [],
      afterClaim: [],
      emptied: []
    },
    executionState: {}
  }
}
```

Точная внутренняя нормализованная форма `triggers` должна совпадать с текущим trigger schema; пример выше показывает принадлежность данных, а не отменяет существующие поля runtime ledger.

Правила:

- чтение unconfigured двери возвращает detached default без eager write;
- первое успешное сохранение создаёт versioned flag;
- `enabled:false` сохраняет definitions/runtime и возвращает native ЛКМ/обычный ПКМ; GM `Ctrl + ПКМ` остаётся доступным для повторного включения;
- unknown future version не исполняется и показывается GM как unsupported/read-only;
- обычный player snapshot не получает definitions, DC, UUID, branches, variables или receipts;
- флаг принадлежит конкретной Scene Wall, поэтому копии стены независимы.

## 6. Canvas interaction

### 6.1. Регистрация

На ранней подходящей lifecycle-фазе модуль один раз захватывает текущий `CONFIG.Canvas.doorControlClass`, создаёт tagged subclass и возвращает его в config. Повторная регистрация определяется module-owned marker и ничего не оборачивает второй раз. Subclass расширяет уже установленный класс, чтобы сохранить поведение расширения, зарегистрированного раньше Rebreya.

Реализация не должна повторно навешивать listeners на каждый `drawDoorControl` и не должна обращаться к private полям DoorControl.

### 6.2. ЛКМ

Handler обязан:

1. Передать управление родителю при non-left click, unconfigured/disabled target или `ds === OPEN`.
2. Для enabled target в `CLOSED`/`LOCKED` остановить событие и выполнить client preflight.
3. Показать anchored overlay с одной кнопкой `Открыть`; никакой privileged mutation при показе overlay не выполняется.
4. Кнопкой вызвать публичный door-attempt API с exact wall UUID, выбранным character token UUID и stable mutation ID.

### 6.3. ПКМ

- `Ctrl + ПКМ` и `game.user.isGM === true`: остановить событие и открыть редактор exact Wall target;
- любое другое ПКМ: вызвать родительский handler без изменения аргументов;
- игрок не получает конфигурационное действие даже при удержании Ctrl.

Ctrl определяется по нормализованному Foundry keyboard modifier или исходному pointer event; тест закрепляет exact runtime-вариант для build 351.

### 6.4. Overlay

Door overlay переиспользует presentation/feedback primitives storage overlay, но не притворяется Token и не передаёт DoorControl в token-only geometry API. Общий anchor adapter обязан уметь получить viewport/canvas position DoorControl.

Overlay:

- содержит ровно одну кнопку `Открыть`;
- закрывается при canvas pan/tear-down, удалении или relevant update стены;
- показывает локальные `Подойдите ближе`, отсутствие выбранного персонажа и authoritative deny;
- не создаёт красный global toast для уже обработанного deny/distance error;
- не остаётся привязанным к уничтоженному DoorControl после redraw.

## 7. Preflight и authoritative access

### 7.1. Выбор персонажа

Игрок и мастер, использующие игровой маршрут двери, должны иметь выбранный scene Token персонажа, которым текущий пользователь владеет. Это необходимо для ключей, спасбросков, урона и `oncePerCharacter`. GM без выбранного персонажа получает понятное сообщение и может воспользоваться штатным ручным управлением дверью.

Алгоритм выбора и OWNER-проверка переиспользуют storage access policy; новая конкурирующая политика выбора персонажа не создаётся.

### 7.2. Расстояние

Граница — `10 ft`, включительно. Distance helper:

1. строит центры фактически занятых клеток character token, включая fractional/off-grid geometry;
2. для каждого центра находит ближайшую точку конечного wall segment `[x1,y1] → [x2,y2]`;
3. измеряет Foundry grid distance до этой точки;
4. выбирает минимальное finite значение.

Использование только midpoint запрещено: длинная или диагональная дверь не должна ошибочно считаться далёкой возле своего края.

Client preflight даёт быстрый feedback, но active GM повторяет exact same-scene, ownership и distance validation перед любым trigger execution.

### 7.3. Door validation

Active GM повторно разрешает exact `Scene.<sceneId>.Wall.<wallId>` и проверяет:

- документ существует и принадлежит Scene;
- `door !== CONST.WALL_DOOR_TYPES.NONE`;
- для player дверь не является `SECRET`;
- door target имеет supported version и `enabled:true`;
- character token существует на той же Scene и принадлежит sender;
- current `ds` равен `CLOSED` или `LOCKED`;
- расстояние не превышает 10 футов.

Player-side видимость DoorControl используется только как UX preflight. Authoritative политика не зависит от canvas active GM, аналогично существующей storage visibility policy; security гарантируют exact UUID, non-secret type, ownership, same-scene и distance.

## 8. Authoritative open transaction

Typed command:

```js
door.open {
  wallUuid,
  characterTokenUuid,
  mutationId
}
```

Payload имеет exact-key validation и size/trim limits. Команда выполняется active GM; сокет не предоставляет полномочия сам по себе.

Порядок внутри единой queue стены:

1. live resolve и access validation;
2. bind mutation fingerprint к sender, wall, character и текущей операции;
3. load latest trigger state;
4. проверить специальное правило `LOCKED`;
5. выполнить `beforeOpen` и persist runtime receipt;
6. при deny вернуть typed отказ, не меняя `ds`;
7. при allow повторно проверить, что дверь всё ещё `CLOSED`/`LOCKED`;
8. выполнить единственный `WallDocument.update({ ds: OPEN }, { sound: true, ...moduleBypass })`;
9. выполнить `afterOpen` и persist runtime;
10. вернуть compact result без definitions/runtime.

Queue key принадлежит exact wall UUID. Concurrent double-clicks сериализуются. Cached/in-flight retry с тем же fingerprint возвращает прежний compact result и не повторяет key consume, roll, damage, Macro, sound или door update. Повтор mutation ID с другим sender/wall/character отклоняется.

### 8.1. Семантика `LOCKED`

- `CLOSED` + ноль active `beforeOpen` chains: дверь открывается штатно через authoritative route;
- `LOCKED` + ноль active `beforeOpen` chains: дверь остаётся запертой;
- `LOCKED` + одна или более active `beforeOpen` chains: открыть можно только после terminal allowed результата всех применимых цепочек;
- disabled/unsupported chains не считаются активным способом открыть запертую дверь;
- GM всегда может вручную изменить native state обычным ПКМ и затем штатным/модульным действием.

Core `ds` остаётся физическим/presentation состоянием Foundry; trigger state не создаёт вторую копию `open/closed/locked`.

### 8.2. Post-commit ошибки

После успешного wall update ошибка во время `afterOpen` — в Macro, persistence либо presentation/ChatMessage — не закрывает дверь обратно. Ошибка логируется и возвращается как post-commit diagnostic по существующей storage-модели. Retry должен продолжить/завершить durable receipt без повторного открытия и урона.

## 9. Trigger context

Common executor получает нейтральный context:

```js
{
  targetKind: "door",
  targetUuid: wall.uuid,
  sceneId: wall.parent.id,
  characterActorUuid,
  characterTokenUuid,
  senderId,
  runId,
  fingerprint
}
```

Door context не содержит storage rows, coins, template, source IDs или mutable Foundry documents. Macro получает прежний deep-frozen whitelist, расширенный нейтральными `targetKind/targetUuid`. Storage Macro compatibility сохраняется.

Текущий dnd5e trigger adapter продолжает authoritative re-resolve Actor/Item и выполняет conditionItem, ability/save, consume и damage. Generic core не читает `actor.system` напрямую.

## 10. GM configuration commands и API

Публичные методы:

- `openDoorTriggerEditor(wallUuid)`;
- `openDoorInteraction({ wallUuid, anchorToDoor = true })` либо эквивалентный module-owned entrypoint canvas handler;
- `attemptDoorOpen(wallUuid, mutationId, { characterTokenUuid })`.

Typed GM commands:

- `door.triggers.read`;
- `door.triggers.save`;
- `door.triggers.reset`.

Read/save/reset принимают exact wall identity, не принимают storage path и требуют authenticated GM. Save использует revision и stable operation ID; reset очищает execution ledger, сохраняя definitions и `enabled`. Editor checkbox меняет `enabled` в том же revision-checked save, чтобы definitions и enable-state не расходились между параллельными GM.

Public storage API не меняется и не начинает принимать Wall UUID.

## 11. Ошибки и feedback

Пользовательские случаи имеют стабильные коды и русские сообщения:

- нет выбранного персонажа;
- персонаж недоступен или не принадлежит sender;
- другая сцена;
- больше 10 футов;
- дверь секретная;
- дверь удалена или больше не является дверью;
- механика Rebreya выключена;
- дверь уже открыта/изменила state;
- штатная `LOCKED` без активного способа открытия;
- trigger deny с очищенным сообщением.

Handled distance/deny отображаются door-local feedback без дублирующего global error toast. Validation details не раскрывают игроку secret door, trigger definitions, DC, item UUID или Macro UUID.

## 12. Совместимость и инварианты

- Foundry minimum/verified остаётся 13; реализация тестируется на build 351.
- dnd5e-specific steps остаются за существующим adapter; module load не получает новых top-level зависимостей от `CONFIG.DND5E`.
- Storage trigger persisted state, socket commands, public API и четыре вкладки сохраняются.
- Unconfigured/disabled doors не получают eager flags и сохраняют native ЛКМ/обычный ПКМ; исключение — GM `Ctrl + ПКМ` для настройки.
- Ordinary right-click никогда не используется для открытия Rebreya UI.
- Door feature не создаёт Actor, Token, Item или world setting.
- Все world writes выполняет `WallDocument.update/setFlag` через authoritative owner/coordinator, не UI.
- Player не пишет Wall flag/runtime/ds локально.
- Новые/изменённые методы и data flow добавляются в `docs/function-passport.md` в implementation commit.
- Любые client-facing файлы реализации требуют следующей версии `module.json`, нового versioned forwarder и синхронных browser cache keys.

## 13. Focused testing

### Pure/domain

- door flag default, normalization, enabled toggle и future-version behavior;
- allowed events и rejection непустых `afterClaim/emptied`;
- nearest-segment distance: short, long, diagonal, fractional/off-grid, exact 10 и greater than 10;
- `LOCKED` с нулём/disabled/active chains;
- compact result и mutation fingerprint.

### Command/application

- exact payload validators;
- player/GM authorization, OWNER, same-scene, secret door и distance;
- `CLOSED`, `LOCKED`, state change between validation and commit;
- beforeOpen allow/deny, conditionItem, savingThrow, damage, Macro;
- afterOpen post-commit failure;
- `onceGlobal`, `oncePerCharacter`, double-click, cached retry, conflicting mutation ID и active-GM restart;
- no local player Wall mutation.

### Canvas/UI

- subclass registration idempotence and preservation of an existing base class;
- unconfigured/disabled/OPEN left-click delegates to parent;
- configured CLOSED/LOCKED left-click opens exactly one overlay;
- ordinary right-click delegates unchanged;
- GM `Ctrl + ПКМ` opens exact editor, player chord does not;
- editor exposes only `beforeOpen/afterOpen`, templates and enabled toggle;
- save/cancel/dirty close/revision conflict;
- pan, redraw, wall update/delete и canvas teardown cleanup;
- feedback and no duplicate toast.

### Regression

- existing storage trigger service/editor/socket tests remain green unchanged in behavior;
- ordinary Foundry doors retain native open/close/lock behavior;
- module loads without dnd5e globals where generic trigger steps are sufficient;
- all current repository tests, JS/MJS syntax checks, JSON parsing and `git diff --check` pass.

## 14. Live Foundry QA

Обязательная матрица на Foundry 13 build 351, dnd5e 5.2.5:

1. GM настраивает обычную дверь через `Ctrl + ПКМ`, сохраняет lock и trap.
2. Player рядом видит один `Открыть`, вдали получает `Подойдите ближе`.
3. Player без ключа получает deny без открытия; с ключом открывает дверь один раз.
4. Trap/roll/damage не повторяются при double-click/retry.
5. GM обычным ПКМ сохраняет native lock toggle; открытая дверь закрывается штатным ЛКМ.
6. Secret door не доступна player.
7. Длинная и диагональная дверь доступны у ближайшего края.
8. Reload/reconnect не дублирует canvas wrapper и сохраняет flags/runtime.
9. Console не получает новых exceptions, failed templates или deprecation warnings.

Для live QA нужна заранее авторизованная вкладка тестового мира. Страница `/join` без входа не является подтверждением runtime/UI поведения.

## 15. Критерии готовности

Задача завершена, когда:

- вся UX-модель раздела 1 работает для GM и player;
- authoritative route и правило `LOCKED` подтверждены focused tests;
- storage triggers не имеют регрессий;
- ordinary doors полностью сохраняют native behavior;
- version/cache/passport требования выполнены;
- полный suite и статические проверки зелёные;
- live QA выполнен либо явно отмечен как заблокированный отсутствием авторизованной тестовой сессии.
