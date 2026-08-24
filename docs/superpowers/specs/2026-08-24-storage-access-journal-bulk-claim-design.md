# Storage Access, Journal Read Markers, and Bulk Claim Design

## Goal

Исправить четыре связанные проблемы существующего storage-потока без создания второго владельца состояния или обходного UI:

1. authoritative player access не зависит от transient `Token.object.visible` active-GM canvas;
2. удаление последней ordinary ground pile не вызывает последующий ложный snapshot error в открытом Storage UI;
3. первое успешное чтение Journal-ссылки оставляет общую для storage scope отметку и показывает исходное имя с суффиксом `(прочитана)`;
4. Storage UI выдаёт все доступные строки и монеты себе или в партийный инвентарь одной валидируемой, восстанавливаемой и идемпотентной typed command.

## Scope and ownership

Канонические владельцы остаются прежними:

- access policy и геометрия: `scripts/data/storage-access.js`;
- storage state и scoped container writes: `scripts/data/storage-service.js`;
- privileged validation, authorization, queueing и orchestration: `scripts/data/storage-command-service.js`;
- ordinary pile deletion/presentation: `scripts/data/storage-ground-pile-service.js`;
- Storage ApplicationV2: `scripts/ui/storage-app.js` и `templates/storage-app.hbs`;
- composition, typed routes и public API: `scripts/main.js`;
- inventory grants и их durable receipts: существующий `scripts/data/inventory-service.js`.

Новый app, hook, world setting или альтернативный socket bus не создаётся. Lootgen chat не меняется. Corpse materialization marker, token-scoped independence и portable-container identity не меняются.

## Authoritative access policy

`isStorageTokenVisible(storageToken)` становится детерминированной document policy:

- `TokenDocument.hidden === true` запрещает player access;
- любое другое значение `hidden` разрешает продолжить остальные проверки;
- `Token.object.visible`, текущая viewed scene active GM, canvas perception cache и наличие placeable object не участвуют в authoritative результате.

Эта policy используется и локальным preflight, и `StorageCommandService.#resolveAccess()`. Остальные условия не меняются:

- GM bypass сохраняется;
- non-GM должен передать принадлежащего ему Actor типа `character`;
- character Token и storage/dead-NPC Token должны быть на одной Scene;
- storage Token должен пройти document hidden policy;
- расстояние по token scene grid должно быть не больше 5 ft.

Hidden character Token не выбирается локальным preflight как доступный owned character. Authoritative command всё равно повторно проверяет sender ownership, scene, storage visibility и distance.

## Shared Journal read state

### State shape

`buildStorageTokenState()` нормализует новое поле:

```js
readJournalRowIds: string[]
```

Поле содержит уникальные trimmed row IDs только существующих canonical Journal rows текущего storage scope. Stale IDs удаляются при нормализации. Это world-state конкретного Token или конкретного nested container scope, а не user flag.

Container snapshot normalization сохраняет `readJournalRowIds` вместе с остальным state. Обновление nested path проходит через существующий `StorageService.#scopedToken()` и `updateStorageContainerPath()`, поэтому marker не теряется при capture, переносе, materialization или повторном snapshot build.

### Mutation

Новый метод:

```js
StorageService.markJournalRead(token, rowId, { path = [] } = {})
  -> { changed: boolean, rowId: string, state: StorageState }
```

Метод:

1. разрешает текущий scope через существующий path mechanism;
2. повторно находит unclaimed canonical Journal row;
3. возвращает общую unavailable error для отсутствующей или повреждённой строки;
4. не пишет state, если marker уже существует;
5. иначе добавляет row ID и выполняет один canonical storage write.

`StorageCommandService.readJournal()` сериализуется той же source queue, что claims и deposits. Сначала выполняется live access/path/row check и `journalReader.read(row.sourceId)`. Только после успешного reader result вызывается `markJournalRead()`. Reader failure не меняет world-state. Успешный marker write обязателен до возврата read-only Journal snapshot клиенту.

Сам JournalEntry, его страницы, ownership, flags и имя не обновляются. Исходное `row.name` также не переписывается.

### Snapshot and UI

`getStorageSnapshot()` добавляет к Journal row только presentation boolean:

```js
journalRead: true | false
```

UUID по-прежнему удаляется из player snapshot. `StorageApp._prepareContext()` строит отображаемое имя так:

- unread: `<исходное имя>`;
- read: `<исходное имя> (прочитана)`.

После успешного viewer open приложение запрашивает свежий snapshot, чтобы общий marker был виден всем открытым Storage UI. Journal row остаётся non-draggable и non-claimable.

## Bulk claim public contract

### Public API

Добавляется метод:

```js
claimStorageAll(tokenUuid, destination, mutationId, request = {})
```

Поддерживаются только существующие UI destinations:

- `destination: "self"` — полный лут получает authoritative access character;
- `destination: "party"` — полный лут получает exact managed group target.

`request` поддерживает существующие `path`, `characterTokenUuid` и party `target: { groupActorId, folderId }`. Public API при отсутствии явного party target разрешает текущий групповой Actor тем же способом, что `claimStorageRow()`.

### Typed command

Новая команда:

```text
storage.claim-all
```

Exact payload:

```js
{
  tokenUuid: string,
  characterTokenUuid: string,
  destination: "self" | "party",
  target: null | { groupActorId: string, folderId: string | null },
  mutationId: string,
  path?: string[]
}
```

`isValidStorageClaimAllPayload()` требует exact keys, trimmed bounded IDs, valid path, non-empty mutation ID и destination-specific target. Для `self` обязателен `characterTokenUuid` и `target === null`. Для `party` target обязателен.

Socket authorization сохраняет общий sender check и для party дополнительно вызывает существующий `#canSenderManageGroup(sender, groupActorId)`. Command service после входа в source queue повторно разрешает group Actor и folder до первой выдачи. Dead NPC проходит тот же `#resolveAccess()` и не получает отдельного authorization path.

## Bulk claim execution

`StorageCommandService.claimAll()` выполняет одну server-side operation внутри существующей per-storage/path queue. Клиент не отправляет цикл row commands.

Порядок выполнения:

1. нормализовать destination, target, path и mutation ID;
2. войти в source queue через общий bulk mutation key;
3. повторно выполнить `#resolveAccess()`;
4. live-read scoped state и отвергнуть `unopened`;
5. разрешить и заморозить self Actor либо exact party Actor/folder;
6. получить snapshot текущих unclaimed rows в стабильном порядке `manualRows`, затем `generatedRows`;
7. пропустить все canonical Journal rows без ошибки и без target call;
8. для каждой ordinary Item или container row выдать полную доступную quantity;
9. после подтверждённой target grant вызвать existing `StorageService.claim()` для этой строки;
10. после строк выдать все доступные unclaimed coins и вызвать coin claim;
11. один раз вызвать ground-pile refresh по итоговому root state;
12. вернуть aggregate result.

Portable container считается одной строкой и materialize-ится целиком через существующий `materializeToActorOnce()`. Для party его root получает выбранный folder через существующий `assignInventoryGrantFolder()`.

Ordinary rows проходят существующий durability preparation. Journal rows не проходят durability, Item build или container materialization. Монеты не превращаются в Item rows.

### Stable child mutation IDs

Каждая target mutation получает детерминированный дочерний ID из общего bulk mutation key:

```text
<bulk-key>:row:<row-id>
<bulk-key>:coins
```

Existing inventory mutation journal и container materialization receipts делают target grants идемпотентными. Source row помечается claimed только после успешной target grant.

Если операция завершилась ошибкой после части выдач, общий bulk result не кешируется как terminal success. Повтор с тем же payload и mutation ID:

- пропускает уже claimed source rows;
- повторяет незавершённую строку с тем же child ID;
- existing target receipt возвращает уже выполненный grant без дубликата;
- затем source claim завершается;
- продолжает оставшиеся строки и монеты.

Успешный aggregate result кешируется существующим bounded `claimResults`. Concurrent duplicate requests делят одну in-flight task.

### Party currency target

`InventoryService.addCurrencyToInventoryOnce()` получает optional exact `groupActorId`, аналогично item grant. Он re-resolve-ит этот Actor и связывает durable currency receipt с его Actor ID. Retry с тем же mutation ID и другим group target отклоняется, а не кредитует другой Actor.

Это минимальное расширение существующего inventory owner; StorageCommandService не пишет Actor currency напрямую.

### Result

Aggregate result содержит только presentation-safe данные:

```js
{
  changed: boolean,
  claimedRowCount: number,
  skippedJournalCount: number,
  coinsClaimed: boolean,
  sourceDeleted: boolean,
  state: "opened" | "empty"
}
```

Journal UUID, Item flags и internal receipts не возвращаются.

## Ground pile deletion and UI completion

`StorageGroundPileService.refreshAfterStorageMutation()` уже является владельцем решения удалить empty ordinary pile и возвращает `{ deleted, state }`. Command service перестаёт терять этот результат:

- `#refreshSource()` возвращает normalized refresh result;
- `claimRow()`, `claimCoins()` и `claimAll()` добавляют `sourceDeleted` в результат;
- bulk вызывает refresh один раз после всех source claims.

Storage UI после успешного claim:

- при `sourceDeleted === true` очищает local interaction state, закрывает приложение и не вызывает `scheduleSnapshotRefresh()`;
- иначе выполняет обычный refresh;
- deleteToken hook остаётся defensive close path и может безопасно сработать раньше ответа command.

Ошибки до успешного command result отображаются как раньше. После authoritative success отсутствие исходного Token не преобразуется в ложную notification error.

## UI

Для непустого текущего scope с хотя бы одной claimable non-Journal row или положительными монетами template показывает блок:

```text
Залутать всё
[Себе] [В группу]
```

Actions:

```text
storage-claim-all-self
storage-claim-all-party
```

Обе кнопки вызывают ровно один `moduleApi.claimStorageAll(...)` с новым mutation ID и текущим path/character context. Individual row и coin actions сохраняются.

Если scope содержит только Journal rows, bulk controls не показываются. Bulk не открывает quantity prompts: каждая eligible row забирается в полном доступном количестве.

## Error and recovery semantics

- Invalid payload отсекается до execute.
- Unauthorized party target отсекается socket authorize; command service повторно проверяет live target/folder.
- Ownership, scene, hidden policy и distance проверяются до первой target mutation.
- Journal rows всегда skipped и никогда не становятся Item.
- Failed target grant не claim-ит соответствующий source.
- Partial forward progress сохраняется; retry с тем же mutation ID завершает остаток без повторной выдачи.
- Ground pile удаляется только после отсутствия ordinary rows и unclaimed coins; Journal-only pile остаётся существующим storage Token.
- ChatMessage presentation не определяет commit. Bulk может публиковать существующие per-row/per-coin сообщения только после соответствующего source claim; retry не повторяет сообщения для уже claimed entries.

## Tests

TDD выполняется отдельными red-green циклами.

### `tests/storage-access.test.mjs`

- unhidden Token остаётся authoritative-visible при `object.visible === false` и чужой viewed canvas scene;
- `hidden === true` запрещает access независимо от `object.visible`;
- ownership, same-scene и 5 ft продолжают применяться.

### `tests/storage-socket.test.mjs`

- exact `storage.claim-all` payload validation для self/party/path и malformed extras;
- party authorization и live group/folder re-resolution;
- mixed ordinary rows, full stacks, portable container, Journal и coins;
- один command, Journal skip, correct self/party destinations;
- duplicate concurrent/sequential retry не повторяет grants;
- failure after target grant but before source completion resumes with stable child ID;
- dead NPC использует общий access и bulk path;
- first successful Journal read persists common marker; reader failure does not;
- nested path marker survives scoped write.

### `tests/storage-app.test.mjs`

- bulk block visibility and self/party actions;
- one API call per click with current path and character context;
- Journal-only scope hides bulk controls;
- `journalRead` adds `(прочитана)` without changing source name;
- successful claim result with `sourceDeleted:true` closes without snapshot request or error notification.

### `tests/storage-ground-pile-service.test.mjs`

- successful final ordinary-pile refresh returns `deleted:true`, deletes exactly once and leaves no Token;
- nonempty and Journal-only piles remain.

### State/container and inventory focused tests

- `tests/storage-service.test.mjs`: normalization, stale marker cleanup and idempotent `markJournalRead()`;
- `tests/storage-container-snapshot.test.mjs` and hierarchy tests: `readJournalRowIds` survives nested capture/update/materialization;
- `tests/inventory-mutation-recovery.test.mjs`: exact party currency target and target-conflict retry.

### Completion checks

```powershell
node --test tests/*.test.mjs
git diff --check

$files = git ls-files '*.js' '*.mjs'
foreach ($file in $files) { node --check $file }

$json = git ls-files '*.json'
foreach ($file in $json) { Get-Content -Raw -Encoding UTF8 $file | ConvertFrom-Json | Out-Null }
```

`README.md` документирует visibility policy, shared Journal read marker и `claimStorageAll()`/`storage.claim-all`. Раздел 8 `docs/function-passport.md` обновляется для всех новых и изменённых методов, payload, data flow, invariants и focused tests.

## Non-goals

- полноценный wall/LOS reconstruction на active GM;
- выдача Journal как Item;
- рекурсивное распаковывание содержимого portable container;
- all-or-nothing compensation уже committed inventory merges;
- изменение Lootgen chat claim-all;
- изменение corpse materialization marker или Actor/Token lifecycle;
- локальная player world-state mutation.
