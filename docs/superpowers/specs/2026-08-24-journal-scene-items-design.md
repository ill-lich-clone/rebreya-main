# Journal-записи как предметы на сцене

## Наблюдаемый результат

Перетаскивание `JournalEntry` на canvas сохраняет нативное поведение Foundry VTT 13 только при активном слое заметок (`canvas.activeLayer === canvas.notes`). При любом другом активном слое, включая инструменты токенов, Rebreya перехватывает drop и создаёт либо пополняет наземное хранилище с read-only Journal-ссылкой.

Одиночная Journal-ссылка на земле выглядит как физическая заметка и носит исходное имя Journal. Две или более Journal-ссылки без обычных предметов выглядят как `Куча заметок`. Journal-ссылки не превращают лежащий рядом обычный предмет или контейнер в кучу. После первого успешного чтения одиночная заметка получает суффикс `(прочитано)`, а в общий чат публикуется имя читателя и название записи.

## Границы задачи

В задачу входят:

- выбор между нативной Foundry Note и Journal-предметом по активному canvas layer;
- отдельный authoritative drop-контракт для `JournalEntry`;
- presentation одиночной заметки и кучи заметок;
- обновление scene token и открытых Storage UI после первого чтения;
- одно публичное ChatMessage при первом чтении;
- два module-owned PNG-ассета с прозрачным фоном;
- focused-тесты, README и паспорт функций.

В задачу не входят:

- возможность забрать Journal-ссылку в инвентарь или групповое хранилище;
- изменение ownership, имени, страниц или flags исходного Journal;
- поддержка `JournalEntryPage` как самостоятельного drop-источника;
- новый Application, storage owner, canvas hook или отдельная модель world-state;
- миграция существующих нативных Foundry Notes в Journal-предметы.

## Владельцы и компоненты

- `scripts/integrations/storage-transfer-drop.js` остаётся единственным владельцем Rebreya drop-перехвата на canvas.
- `scripts/data/storage-command-service.js` владеет exact payload validation, sender authorization, повторным разрешением Journal и authoritative scene mutation.
- Существующие `resolveStorageDepositSource()` и canonical Journal row builder в `scripts/data/storage-deposit-source.js` переиспользуются; второй Journal resolver запрещён.
- `scripts/data/storage-ground-pile-service.js` остаётся единственным владельцем создания, merge и refresh наземной кучи.
- `scripts/data/storage-pile-presentation.js` владеет именем, иконкой и category key наземного токена.
- `StorageService.markJournalRead()` остаётся единственным владельцем общего `readJournalRowIds`.
- `scripts/main.js` остаётся composition root, владельцем public API и typed socket registration.

## Canvas drop

`handleStorageCanvasDrop()` получает новую ветку для drag data с точным `type: "JournalEntry"` и непустым `uuid`.

1. Если `canvas.activeLayer === canvas.notes`, handler возвращает `true` синхронно и не запускает Rebreya API. Foundry полностью владеет созданием нативной Note.
2. Иначе handler синхронно возвращает `false` и асинхронно вызывает новый integration helper для Journal drop.
3. Helper требует валидные `sceneId`, `x`, `y` и вызывает новый public API `dropStorageJournalToScene(journalUuid, request)`.
4. `JournalEntryPage`, неизвестные типы и drag data без UUID не перехватываются этой веткой.

Проверка active layer инъецируется или изолируется так, чтобы focused-тест не зависел от DOM Scene Controls. DOM-классы и подписи русской локализации не используются как контракт.

## Authoritative Journal drop

Вводится отдельная typed command `storage.journal.drop-to-scene`, а не расширение `storage.drop-item-to-scene`. Exact payload содержит только:

```text
{ journalUuid, mutationId, sceneId, x, y }
```

Операция разрешена только sender с `isGM === true`, что сохраняет действующую Journal deposit policy. Command service:

1. валидирует exact keys, trimmed IDs, finite coordinates и stable mutation ID;
2. сериализует операцию по Journal source и target scene;
3. повторно разрешает `{ kind: "journal", journalUuid }` через существующий `resolveStorageDepositSource()`;
4. требует canonical source `kind: "journal"`, `mode: "copy"`, `available: 1` и валидную Journal row;
5. вызывает `consume(1)`, который не меняет Journal;
6. передаёт detached canonical row в `StorageGroundPileService.transferToScene()` с quantity `1` и owner sender ID;
7. при ошибке scene transfer вызывает существующий `restore(receipt)`; copy-receipt остаётся безопасным no-op;
8. возвращает compact result без Journal UUID и raw document data.

Retry с тем же mutation ID не создаёт вторую строку. Новый command path передаёт в существующий `#runMutation()` fingerprint из exact `journalUuid`, `sceneId`, `x`, `y` и sender ID; повторное использование mutation ID с другим Journal, scene, point или sender отвергается.

## Presentation

Сигнатура расширяется до `deriveGroundPilePresentation(rows, { coins, preserveEmptyCoinPile, readJournalRowIds })`. Сам marker не записывается в row и не меняет исходное имя.

Приоритет presentation:

1. Если есть хотя бы одна незабранная обычная строка, действуют прежние single/category/mixed правила только по обычным строкам. Journal-ссылки не влияют на имя и иконку.
2. Если обычных строк нет, но есть положительные монеты, сохраняются прежние coin presentation rules; Journal-ссылки не маскируют физическую валюту.
3. Если обычных строк и монет нет, а доступна ровно одна canonical Journal row, результат:
   - `name`: исходное имя строки; при marker текущего `rowId` — `<имя> (прочитано)`;
   - `img`: module-owned иконка одиночной заметки;
   - стабильный `categoryKey: "journal-note"`.
4. Если доступны две или более canonical Journal rows, результат — `Куча заметок`, module-owned pile icon и `categoryKey: "journal-notes"`.
5. Существующая preserved empty coin pile policy сохраняет приоритет над Journal-only fallback только для токена, помеченного как coin pile.

Таким образом, книга и соседняя Journal-ссылка показываются как книга. После выдачи книги оставшаяся Journal-ссылка показывается как одиночная заметка; если исходное имя — `Заметки Гартара` и marker уже установлен, название становится `Заметки Гартара (прочитано)`, а не `Куча предметов`.

## Чтение, refresh и ChatMessage

`StorageCommandService.readJournal()` сохраняет действующий порядок access check → authoritative row lookup → safe reader → marker write. Возвращаемый viewer snapshot не расширяется source identifiers.

После успешного reader:

1. результат `StorageService.markJournalRead()` сохраняется;
2. если `changed === true`, command service вызывает `StorageGroundPileService.refreshAfterStorageMutation()` с актуальным root state; это пересчитывает token name/icon и инициирует обычные `updateToken`/`storageUpdated` refresh-сигналы для открытых Storage UI;
3. после committed marker и scene refresh публикуется одно non-whisper ChatMessage: `<имя sender> прочитал запись «<имя строки>».`;
4. имена экранируются существующим Foundry-safe presentation helper; UUID, flags и содержимое страниц в сообщение не попадают;
5. ошибка ChatMessage логируется как presentation failure и не откатывает marker;
6. повторное чтение с `changed === false` не публикует сообщение и не выполняет лишний presentation write;
7. ошибка reader не ставит marker, не refresh-ит pile и не публикует сообщение.

Для nested Journal path refresh применяется к корневому scene token. Пока на земле остаётся обычный контейнер, его presentation не меняется; marker при этом доступен всем клиентам через authoritative snapshot.

## Ассеты

Нужно создать built-in image generation tool два квадратных raster asset с реальным alpha channel:

- одиночная физическая заметка/сложенный лист или небольшой набор страниц — `assets/storage/piles/journal-note.png`;
- небольшая куча нескольких заметок и листов — `assets/storage/piles/journal-notes.png`.

Стиль должен совпадать по читаемости и масштабу с существующими `assets/storage/piles/*.png`: предмет занимает центр, различим на маленьком scene token, без текста, рамки, фона, логотипа и watermark. Финальные файлы сохраняются в module-owned storage asset directory под стабильными описательными именами; generated output вне workspace не используется runtime-кодом.

## Ошибки и безопасность

- Rebreya не перехватывает нативный NotesLayer drop.
- Non-GM Journal drop отвергается authoritative command даже при прямом вызове API или forged socket payload.
- Journal UUID никогда не берётся из уже созданной client row; active GM повторно разрешает исходный document.
- Journal row остаётся reference-only, quantity-one и не участвует в claim, bulk claim, Item materialization, durability или stacking.
- Source Journal не удаляется и не обновляется при drop/read/retry/rollback.
- Chat и public command results не раскрывают UUID, ownership, flags, secret HTML или raw page content.

## Focused-тесты

Минимальный RED/GREEN набор:

- `tests/storage-transfer-drop.test.mjs`
  - NotesLayer пропускает `JournalEntry` в Foundry;
  - Token/другой layer перехватывает тот же drag и вызывает только Journal scene API;
  - `JournalEntryPage` и malformed payload не перехватываются.
- `tests/storage-socket.test.mjs`
  - exact Journal drop payload validation;
  - GM-only authorization и authoritative Journal re-resolution;
  - quantity-one copy transfer, rollback и duplicate mutation;
  - Item/coin commands не принимают Journal source;
  - первое чтение ставит marker, refresh-ит ground token и публикует один sanitized public chat;
  - repeat read не публикует второй chat;
  - reader failure не пишет marker/chat/refresh.
- `tests/storage-pile-presentation.test.mjs`
  - одна unread/read Journal row;
  - две Journal rows → `Куча заметок`;
  - ordinary item + Journal сохраняет ordinary single presentation;
  - после удаления ordinary row остаётся Journal presentation;
  - coins + Journal сохраняет coin presentation;
  - оба новых asset path существуют и являются PNG.
- `tests/storage-ground-pile-service.test.mjs`
  - Journal drop создаёт pile и повторный drop в его bounds merge-ит вторую Journal row;
  - refresh после marker обновляет scene token name/icon без удаления Journal-only pile.
- `tests/storage-main-registration.test.mjs`
  - typed command, validator и public API собраны только в `scripts/main.js`.
- `tests/storage-app.test.mjs`
  - внешний token/storageUpdated hook отображает общий `(прочитано)` без локальной подмены row name.

Каждый production behavior сначала получает focused-тест, который падает по ожидаемой причине. После GREEN выполняются профильные тесты владельцев, затем один полный прогон из `AGENTS.md` на неизменившемся HEAD.

## Документация и критерии готовности

Нужно обновить:

- профильный раздел `docs/function-passport.md`: новый API/command, drop data flow, presentation signature/priority, read refresh и ChatMessage;
- раздел Storage API/поведения в `README.md`;
- `module.json` и versioned forwarder только если проектный version/cache-bust процесс требует новую версию; forwarder остаётся единственным импортом `scripts/main.js`.

Готово, когда:

- нативный NotesLayer drop не изменён;
- тот же Journal drop из Token/другого layer создаёт Journal-only ground storage;
- одну заметку нельзя забрать и она получает общий read status;
- две заметки показываются как `Куча заметок`;
- обычный предмет рядом сохраняет свою presentation;
- первый read обновляет scene/UI и создаёт ровно одно безопасное публичное ChatMessage;
- focused и полные проверки проходят;
- новые/изменённые методы отражены в паспорте;
- изменения закоммичены и отправлены только в `lich_branch` без force push.
