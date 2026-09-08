# R6 — обезоруживание одной атакой

> **Для исполнения:** использовать superpowers:executing-plans последовательно в текущей задаче. Пользователь явно выбрал продолжение здесь; перенос в новый чат, смена модели и subagents не требуются. Чекбоксы отмечаются только после выполнения, а не при чтении плана.

**Tech Stack:** JavaScript ES modules, Node test runner, Foundry VTT 13.351 / dnd5e 5.2.5, ApplicationV2, Handlebars, существующие typed gateway/coordinator/journal.

## Общие ограничения

- Прочитать [общий контракт исполнения](README.md) и профильную спецификацию до правок.
- Foundry minimum/verified 13; обязательный statuscounter >= 3.0.4.
- Единственный composition root — scripts/main.js; без второго владельца данных или raw socket bypass.
- Только lich_branch; до правок status/branch/fetch и сравнения с origin/main и origin/lich_branch.
- UI не пишет world settings; привилегированное действие валидируется и авторизуется у active GM.
- Все клиентские изменения: новая module.json version и синхронный scripts/main-<version>.js/esmodules.
- Методы/контракты документировать в docs/function-passport.md; public API — в README.md.
- UTF-8. Сначала failing focused test, затем минимальная реализация, focused green, live QA, полная проверка и commit/push.
- Приведённый JS — конкретные контракты/ядро тестов для планируемой реализации, а не код, уже добавленный в runtime. Новые символы определяются в задачах ниже; существующие названы с владельцем.

**Результат:** рядом с захватом появляется один managed macro «Обезоруживание»; защитник выбирает Силу/Ловкость, а при провале одна удерживаемая вещь оказывается рядом без потери её состояния.

**Зависимости:** R3 для выделения экземпляра и recovery. Прочитать [спецификацию обезоруживания](../../specs/2026-09-07-module-development/disarm.md), паспорт разделы 2, 8, 16; declarations искать в grapple-macro-service.js, attack-service.js, held-items.js и storage-command-service.js. Весь combat/main не читать.

**Граница:** без damage, проверки AC, обычных on-hit effects и нового универсального счётчика атак. Карточка явно показывает расход одной доступной атаки. Правило не даёт дополнительную атаку.

## Задача R6.1 — чистые правила и явная формула

**Файлы:** создать scripts/combat/disarm-rules.js, scripts/integrations/disarm-roll-adapter.js, tests/disarm-rules.test.mjs, tests/disarm-roll-adapter.test.mjs; существующие scripts/combat/attack-service.js и scripts/integrations/held-items.js читать/расширять только в точке общего адаптера.

- [x] Q2 уточнён пользователем 2026-09-08: только характеристика и владение, без бонусов черт; случайная допустимая точка с исключением стен до броска; после падения убрать предмет из рук. Неясный baseline требует GM. Обычная дистанция выбранного оружия остаётся рабочим допущением.
- [x] Ввести чистые функции:
  - evaluateDisarmRules({attackerSize,targetSize,heldHands,saveAbility,attackAdvantage,attackDisadvantage,saveAdvantage,saveDisadvantage}) → {allowed,reason,attackMode,saveMode}; size — canonical tiny/sm/med/lg/huge/grg, mode — normal/advantage/disadvantage.
  - resolveDisarmOutcome({attackTotal,saveTotal}) → {dc,success,dropped}; success означает успешное обезоруживание.
  - calculateDisarmDropCell({tokenBounds,gridSize,direction}) → {x,y}; direction — integer 1..8, x/y — центр внешней клетки квадратной сетки. Bounds в canvas coordinates; не CSS pixels.
  - buildDisarmAttackFormula({abilityModifier,proficiencyContribution}) → строка формулы; вход только из проверенного baseline adapter.
- [x] Сначала тесты размера +1/+2, фактических двух рук, выбора str/dex, отмены advantage/disadvantage и равенства Сл. Конкретное ядро:

```js
assert.deepEqual(resolveDisarmOutcome({ attackTotal: 17, saveTotal: 17 }),
  { dc: 17, success: false, dropped: false });
assert.equal(resolveDisarmOutcome({ attackTotal: 17, saveTotal: 16 }).dropped, true);
const rules = evaluateDisarmRules({
  attackerSize: "sm", targetSize: "med", heldHands: 2, saveAbility: "str",
  attackAdvantage: false, attackDisadvantage: false,
  saveAdvantage: false, saveDisadvantage: false
});
assert.equal(rules.attackMode, "disadvantage");
assert.equal(rules.saveMode, "advantage");
assert.equal(evaluateDisarmRules({
  attackerSize: "sm", targetSize: "lg", heldHands: 1, saveAbility: "dex"
}).allowed, false);
assert.deepEqual(calculateDisarmDropCell({
  tokenBounds: { x: 100, y: 100, width: 100, height: 100 },
  gridSize: 100, direction: 1
}), { x: 150, y: 50 });
```

- [x] Отсутствующие булевы modifier flags нормализовать false. Неизвестный size, нечисловой total, направление вне 1..8 и некорректная сетка — typed error, не бросок с угаданными данными.
- [x] Карта к8: С, СВ, В, ЮВ, Ю, ЮЗ, З, СЗ. Для большого footprint использовать внешнюю клетку соответствующего края; при чётной ширине выбрать одну из двух центральных клеток детерминированно и показать её GM. Не возвращать точку внутри крупного токена.
- [x] Adapter экспортирует buildDisarmRollPlan({actor,weapon,mode,context}) → {formula,ability,proficiencyContribution,excludedModifiers,unresolvedModifiers}. Контекст содержит только проверенные текущие условия и согласованный baseline; чтение уже derived attack bonus не подходит.
- [ ] Отдельные fixtures: finesse, непрофильное оружие, половинная/двойная proficiency, magical +N, Bless, временная прибавка ability, постоянный feat override. Нельзя пропускать временный бонус через buffed ability modifier. Сложный provenance переводит операцию на видимое GM-решение до roll.
- [x] Атака задаёт только DC. Nat1/20 сохраняются для отображения, не дают автоуспех/автопровал. Save использует разрешённые обычные модификаторы спасброска; запрет временных бонусов относится к броску атаки из правила.

**Проверка:** node --test tests/disarm-rules.test.mjs tests/disarm-roll-adapter.test.mjs tests/held-items.test.mjs tests/combat-attack-service.test.mjs.

## Задача R6.2 — один владелец операции, ролей и бросков

**Файлы:** создать scripts/combat/disarm-service.js, scripts/infrastructure/foundry/disarm-command-contract.js, tests/disarm-service.test.mjs, tests/disarm-socket.test.mjs; изменить scripts/main.js; journal/repository подключать существующими владельцами.

- [ ] Сервис DisarmService({journal,coordinator,resolveDocuments,rollAdapter,storageCommands,refresh}) с методами start(intent,context), chooseSave(intent,context), resume(operationId,context), cancel(operationId,context). Context несёт authenticated sender и assertAuthority. UI только public disarm({sourceTokenUuid?,targetTokenUuid?}) и presentation.
- [x] Команды exact:
  - disarm.start: {operationId,sourceTokenUuid,targetTokenUuid,weaponItemUuid,targetItemUuid,weaponMode};
  - disarm.resolve-save: {operationId,saveAbility}, только str/dex от назначенного OWNER цели или GM.
  - Если нужен manual baseline/total: отдельная GM-only command с reason и сохранённым решением, а не необязательное player поле total.
- [ ] Gateway валидирует типы/длины/лишние поля; authority повторно разрешает документы и проверяет source ownership, одну сцену, допустимую дистанцию/видимость, weapon mode, размер и текущие held hands. Список target items — разрешённая публичная проекция удерживаемого; скрытое содержимое инвентаря не отправлять игроку.
- [ ] Для v1 computation обоих бросков исполняет active GM через roll adapter после выбора человека. Игрок выбирает save ability, но не передаёт total или формулу. Result публикуется от имени соответствующего Actor. Это сохраняет выбор защитника и закрывает произвольный player total.
- [x] Зафиксировать responderUserId при начале ожидания: один online OWNER; при отсутствии — GM. Смена responder только явным GM решением с записью причины. Несколько владельцев не получают право на несколько бросков.
- [x] Phases: prepared → attack-rolling → attack-rolled → awaiting-save → save-rolling → save-resolved → drop-prepared → drop-committed → completed; cancelled/conflict/manual-review терминальны.
- [x] В journal хранить fingerprint, sender/responder, token/item identities, roll plan и serialized rolls, выбранный save, d8 и destination. Roll оценивается без отправки chat; результат сохраняется до публикации карточки. Если процесс оборвался между фактическим roll и его receipt, не бросать автоматически повторно: ambiguous phase → manual-review.
- [x] Replay искать до fresh source lookup, поскольку успешная операция могла уже удалить source Item. Совпадающий ID возвращает сохранённый результат; другой fingerprint с тем же ID отклоняется.
- [x] Не держать coordinator lock, пока человек выбирает оружие, save или точку. Каждая phase — короткая queued mutation. Guard active GM проверяется перед каждой privileged записью.
- [x] Карточка chat получает operationId; повторная доставка обновляет/находит единственную карточку. Roll JSON и trusted operation определяют результат, не произвольные message flags клиента.
- [x] Отмена до первого roll ничего не расходует; после roll — видимый cancellation/conflict, без отката выпавшей кости и без скрытого возврата атаки. Истечение ожидания не выбирает save и не создаёт результат.
- [ ] Tests: hostile extra fields, чужая цель/источник, sender без Actor ownership, spoofed GM, два active GM, повтор выбора, disconnect, no GM, смена held item после roll, конфликт с новым operationId.

**Проверка:** node --test tests/disarm-service.test.mjs tests/disarm-socket.test.mjs tests/group-command-dispatch.test.mjs tests/durable-mutation-journal.test.mjs.

## Задача R6.3 — выброшенная вещь с полным состоянием

**Файлы:** scripts/data/storage-command-service.js, scripts/data/storage-container-item-service.js, scripts/data/hero-doll-service.js, scripts/integrations/held-items.js; расширить tests/disarm-service.test.mjs, tests/storage-socket.test.mjs, tests/storage-container-item-service.test.mjs и профиль recovery существующего storage owner.

- [x] Выделить внутри StorageCommandService метод dropDisarmedItem(intent,context), доступный только internal вызову DisarmService. Intent содержит operationId, trusted source/item identity, quantity=1, destination и уже разрешённую authority capability; capability создаётся внутри composition/service, не принимается из typed payload.
- [x] Повторно проверить провал save и соответствие item/рук сохранённой атаке. Обычный dropItemToScene сохраняет прежнюю ACL; игрок не получает общий способ перемещать чужие вещи.
- [ ] Создать подготовленный snapshot одной физической вещи. Использовать R3 для plain stack и существующий storage graph/snapshot для host с upgrades или контейнера. Содержимое, durability и пользовательские flags не восстанавливать из каталога.
- [x] До source debit сохранить destination/IDs и transfer receipt. Ground pile создаётся/находится по operation ID. Снятие held/equipped и HeroDoll slot проходит через их владельцев в той же recoverable операции; прямое редактирование flags из карточки запрещено.
- [x] Успешный save вызывает ноль storage writes. По уточнению пользователя стены и границы исключаются до случайного выбора. Восемь вариантов — к8, иначе кость по числу вариантов. Hex использует соседние offsets, gridless — восемь направлений. Без допустимых точек списания нет.
- [ ] Fault injection после destination create, source debit, release hands, doll state, journal commit и потерянного acknowledgement. Во всех recoverable случаях один экземпляр, один ground receipt; неоднозначный конфликт не чинить вторым drop.
- [ ] Проверить upgraded weapon, quantity>1, full container, synthetic token Actor, удаление уже выданной ground вещи до retry. Завершённый replay никогда не создаёт её заново.
- [x] После commit один scoped refresh источника/куклы/storage; failure refresh не превращается в повтор world mutation.

## Задача R6.4 — macro, диалоги и интеграционная приёмка

**Файлы:** scripts/combat/grapple-macro-service.js; новый scripts/ui/disarm-dialog.js, tests/disarm-dialog.test.mjs; templates/disarm-dialog.hbs при необходимости template; styles/main.css; tests/grapple-macro-service.test.mjs; composition в scripts/main.js, hooks только при реальной необходимости в scripts/combat/hooks.js.

- [x] Добавить buildDisarmMacroData(folderId) и stable sourceId в существующий GrappleMacroService.syncManagedDocuments(). Не переименовывать владельца и не создавать второго folder lifecycle.
- [x] Скрипт macro вызывает только game.rebreyaMain.disarm(); sync на active GM создаёт третий managed macro один раз в exact папке Macro/Ребрея. Одноимённый пользовательский macro не трогать.
- [ ] Диалоги показывают источник/цель, предмет, формулу, excluded/unresolved modifiers, помеху, «Расход: 1 атака». Save dialog показывает str/dex и преимущество только у str при меньшем атакующем. Текст/имена экранировать.
- [ ] Tests на zero/multiple tokens/targets, cancel каждого шага, focus/keyboard, повтор клика и снятие listeners при close. Срок жизни UI не является сроком жизни journal operation.
- [ ] Live GM+player: выполнить все size/hand/save ветки, отключить владельца, проверить pickup выбитой вещи, reload и повтор macro. Обычная атака, захват и перемещение схваченного сохраняют поведение.
- [x] Обновить паспорт 2/8/16/19 и публичный disarm API в README. Зафиксировать, как учитывается одна атака; не заявлять автоматический attack budget, которого нет.

## Выпуск этапа

- [x] Выполнить полный профиль focused-тестов этого плана; записать фактические passed/failed.
- [ ] Пройти перечисленные live-сценарии в выделенном тестовом Foundry-мире. Сохранить viewport, версии, GM/player и console result. Если live недоступен, оставить этот пункт открытым.
- [x] Обновить профильные методы паспорта и README при изменении public contract.
- [x] Поднять актуальную patch version в module.json; создать/переименовать versioned forwarder с единственным import "./main.js"; обновить esmodules. Проверить отсутствие старых runtime-entrypoint ссылок.
- [ ] Выполнить один полный цикл команд из README этого комплекта, проверить содержательный diff, stat и diff --check.
- [ ] Stage только перечисленных файлов текущего этапа и обязательных manifest/docs; осмысленный commit; git push -u origin lich_branch. Проверить чистую рабочую копию и HEAD...origin/lich_branch = 0/0. Не включать чужие изменения.

**Предлагаемый commit:** feat: add authoritative disarm workflow and managed macro.

## Реализация и проверка — 2026-09-08, 1.4.252

Реализованы pure rules, dnd5e adapter, DisarmDocuments, durable DisarmService, exact typed commands, internal StorageCommandService drop и managed macro/диалоги. Текущие методы и data flow: [паспорт R6](../../../disarm-function-passport.md).

Физический перенос использует R3 split rules и bounded transport snapshot реальных Item Documents (`storageRow.runtimeGraph`). Это не генерируемый loot descriptor и не второй world repository. Снимок содержит native container children и installed upgrades; при подборе весь граф получает новые согласованные IDs. Корневой предмет освобождает руки/equipped и ячейки куклы, включая остаток plain stack. Усовершенствованный предмет или наполненный контейнер нельзя частично выделить из неоднозначного стака. На земле контейнер представлен одной подбираемой вещью; его native содержимое восстанавливается при подборе целиком.

Автотесты: профиль R6 с ingress/recovery/storage/HeroDoll/macro/composition — **251 passed / 0 failed**. Дополнительно manifest/storage-registration — **43 passed / 0 failed** после обновления ожидаемых cache keys. Полный первый запуск: 3753 passed / 2 failed — обе ошибки были устаревшими ожидаемыми import URL в тестах. Проверка синтаксиса: **740 JS/MJS, 46 JSON, 0 ошибок**.

Повторный полный запуск после исправления тестовых cache keys: `node --test tests/*.test.mjs` — **3755 passed / 0 failed**. `git diff --check` — без ошибок; main runtime references соответствуют 1.4.252.

Live QA: testovyj3, Foundry 13.351 / dnd5e 5.2.5, CODEX (GM), viewport 1292×920. Проверено: выбор удерживаемого оружия; baseline `1d20 + 3 + 2`; две руки → помеха; native STR save с преимуществом; восемь точек без стен → только направления 1/5/6/7/8 после тестовой восточной стены. Исправлен выявленный в браузере конфликт HTMLFormControlsCollection.item; проверены переход «Далее» к видимой формуле и «Нет» → null без запуска операции. Удалены оба QA Actor, оба Token и временная Wall.

**Приёмка остаётся открыта:** Gamemaster до обновления сессии отвечает `Unknown socket command: disarm.preview`; сквозное start/save/drop через native GM socket и отдельная player-сессия ещё не пройдены. Тестовая сеть реального gateway проверяет direct active GM, второй GM, player, запрет player baseline/лишней формулы и отсутствие GM. Node tests проверяют оба save outcomes, retry, stale intent, interrupted roll, no legal point, stack, контейнер с upgraded child, party/character pickup, faults вокруг source debit/куклы. Live-матрицу размеров/рук, synthetic Actor и обычного боя нельзя считать пройденной по этим тестам.

Открытые чекбоксы выше остаются для перечисленной полной приёмки и более широкой fault/UI-матрицы; они не означают отсутствия уже описанного runtime.

## R6 — восстановление terminal receipt и native preview (1.4.273)

Закрыт воспроизведённый разрыв между сохранённой final phase и terminal marker журнала: при lost acknowledgement после completed checkpoint или ошибке перед journal.finish повтор resume оставлял terminal=false, сохранял временную ошибку и блокировал следующее обезоруживание как operation-pending. Теперь resume завершает только журнал для completed/cancelled/conflict/manual-review, без новых attack/save/drop; completed очищает временную ошибку, остальные исходные объяснения сохраняются. Семь regression cases: checkpoint/terminal receipt before/after, завершение отмены/конфликта/manual-review. Два теста воспроизводили ошибку до исправления; после него новый disarm не блокируется.

Профиль disarm-service/storage + module-manifest/group-command-dispatch **114 passed / 0 failed**. Полный `node --test tests/*.test.mjs` **3997 passed / 0 failed**; `node --check`796 JS/MJS и JSON parse46 —0 ошибок. Diff проверен. Main импортирует service с cache273, manifest/forwarder273; неизменённые rules/adapter/UI сохраняют свои cache keys.

Native testovyj3, Foundry13.351/dnd5e5.2.5, CODEX→active Gamemaster: disarm.preview теперь успешно проходит настоящий typed socket (прежний Unknown command снят). Удерживаемое оружие +3 возвращает baseline1d20+3+1 (native proficiency QA Actor без классов1), magical +3 исключён. MED→LG: STR advantage, DEX normal; один хват normal attack, две руки disadvantage. MED→HUGE отклонён target-too-large для обоих хватов; MED→SM не даёт save advantage. Варианты проверены через native Documents.prepare и pure rules, не как шесть исполненных атак. Восточная Wall оставила случайные направления1/5/6/7/8. Native preview также разрешил exact synthetic Item UUID двух unlinked tokens; эти дополнительные tokens удалены. Ни атаки, ни journal operation, ни Chat card пока не создавались.

Подготовленная native проверка ждёт явного разрешения на автоматическую публикацию тестовой Chat card (ограничение инструментов на отправку сообщений другим участникам). Оставлены только QA Actor ATHADGodbbAuH3HJ/sch0XoCclKZI8MCU, hidden Tokens oDY4ZvoIr44FrKHN/NxfgR51olJu9Qufv и Wall QEmShhAgcodFVUhT на scene pvwFhQy1zFBcPIji. Weapon LjR34n8t5eTEgpnv; target item Ui5MWe0TycYly3V4, quantity3/two hands, QA heroDoll left/right. OperationId qa-r6-native-ATHADGodbbAuH3HJ ещё отсутствует в журнале. После разрешения выполнить start→STR save→падение→retry→pickup, затем удалить только созданные QA объекты/карточку. Target имеет тестовый save bonus−100 для гарантированного failed save; он не принадлежит игроку. Полная native/player/обычный бой и остальная fault матрица остаются открыты.

## R6 — явная смена отвечающего (1.4.276)

Добавлен GM-only typed command reassign-responder и метод существующего DisarmService. Назначение только до save, с живой проверкой подключённого OWNER/GM, expectedResponderRevision и причиной. Legacy record начинает с revision0. Guarded journal checkpoint хранит responder и историю до64 решений; последний exact retry после lost ack/terminal не повторяет запись. Неназначенный GM больше не обходит выбор владельца: сначала явное назначение с причиной. Очередь общая с save; оба порядка гонки не допускают второго броска. Отозванное OWNER право проверяется снова перед save.

Карточка содержит GM кнопку и последнюю причину. Native DialogV2 в testovyj3/CODEX, Foundry13.351/dnd5e5.2.5, viewport1292×920: читаемый диалог, active users CODEX/Gamemaster, отмена возвращает false, причина и revision3 сохраняются в локальном результате. Воспроизведён обход HTML required штатной кнопкой DialogV2; теперь пустой/пробельный ввод блокирует «Назначить». Проверка выполнялась без отправки команды, публикации ChatMessage и записи world state; это проверка формы, не native reassignment socket. Игровая карточка QA R6 по-прежнему не публиковалась без ответа на ранее заданный вопрос.

Focused disarm owners + main-composition-root + module-manifest: **85 passed / 0 failed** до исправления native required; изменённый dialog после исправления **6/0**. Service/socket regressions покрывают причины, GM identity, forged/player payload, offline/non-owner target, stale revision, lost ack, replay после завершения, оба порядка save/reassign и отзыв OWNER. Native multiuser/смена GM остаются открытыми.
`node --test tests/*.test.mjs`: **4013 passed / 0 failed**; синтаксис796 JS/MJS и JSON46 —0 ошибок. `git diff --check` чисто. После native формы dialogs0, временный результат удалён; новых ошибок модуля в console нет.
