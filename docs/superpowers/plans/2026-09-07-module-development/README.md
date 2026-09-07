# Подробные планы развития Rebreya Main

База планирования: 652ba859efe0cf186236fd245a5aaa348e27958f, module 1.4.245. R0 реализован в 1.4.246; результаты проверок и ограничение серверной metadata записаны в его плане. R1–R10 ещё не реализованы, R11 отложен. Пользователь явно попросил подробные планы всех этапов; работу продолжаем в текущей задаче без смены модели.

## Содержание и порядок

| Этап | Подробный план | Зависимость / статус |
|---|---|---|
| R0 | [Отмена и drop в папки](r0-folder-behavior.md) | Первый исполняемый этап |
| R1 | [Popover и UI куклы](r1-overlays-hero-ui.md) | Независимый UI после R0 |
| R2 | [Цвета папок](r2-folder-colors.md) | R0 |
| R3 | [Частичный перенос и экземпляры](r3-item-instances.md) | R0; UI R1 не владеет quantity |
| R4 | [Правила upgrades и value](r4-upgrade-rules-value.md) | Основа R7–R9 |
| R5 | [Слава и дурная слава](r5-reputation.md) | Под Механусом; UI-варианты описаны |
| R6 | [Обезоруживание](r6-disarm.md) | R3; допущения броска явно указаны |
| R7 | [Простые усовершенствования](r7-simple-upgrades.md) | R4; сложные исключены |
| R8 | [Улучшенный лут](r8-upgraded-loot.md) | R3/R4; existing curses либо готовое подмножество R7 |
| R9 | [Заполненные контейнеры](r9-nested-loot.md) | R8 |
| R10 | [Окно десятиминутной сцены](r10-scene-window.md) | Только окно/список, без resources/calendar writes |
| R11 | [Условный план восстановления](r11-rest-extension-deferred.md) | Подробный план на будущее; исполнение не разрешено текущим scope |

Спецификации: [общая](../../specs/2026-09-07-module-development-design.md), профильные документы перечислены в каждом плане. R11 расписан, чтобы покрыть «до конца», но прежнее решение пользователя «пока только окно и список действий» остаётся действующим.

## Как исполнять

Один чекбокс — отдельное действие. Задача объединяет только изменения с общей проверяемой поставкой. Нельзя отмечать задачу сделанной по одному написанному helper или зелёному pure test: интеграционные/сбойные/UI критерии тоже обязательны.

Работать последовательно здесь, без автоматического переключения модели или создания новых задач. Сначала согласованные готовые части; вопросы отдельного этапа не блокируют остальные. Если новое пользовательское уточнение меняет контракт, обновить его спецификацию, соответствующий план и зависимые DTO до реализации.

Новые файлы в планах явно обозначены. Существующие функции сначала находить через rg в docs/function-passport.md и исходниках. Не читать весь main.js/inventory-service.js/архитектурный HTML. Одновременные независимые reads/checks — Promise.allSettled внутри одного functions.exec; edits, approvals и зависимые проверки — по порядку.

## Общая граница мутаций

Typed request → authenticated sender → validate exact schema → authorize на живых Actor/group/token → active GM → fresh state внутри queue → write/receipt → результат → один scoped refresh. Нельзя доверять caller ItemData/price/roll total или звать outer world queue из executor повторно.

Existing owners: PrivilegedMutationGateway, WorldMutationCoordinator, DurableMutationJournal, WorldSettingMutationRepository; InventoryService и StorageCommandService сохраняют свои области. Новые workflow helpers получают repositories/guards от владельца и не заводят вторую settings/journal систему.

Replay: receipt ищется до проверки существования уже списанного source; fingerprint конфликтует при изменённом payload. Lost acknowledgement требует readback. Любой ambiguous write оставляет manual-review, а не новый operation ID. World lock не удерживается во время диалога/броска человека.

## Сквозные интерфейсы

### Item instance (R3 → R6/R8)

ItemInstanceWorkflow.run(intent,context) — внутренний application worker R3, без public socket.
intent:
{operationId,sourceActorUuid,sourceItemId,destinationActorUuid,quantity,targetFolderId,heroSlotId,expectedSourceQuantity}.
targetFolderId/heroSlotId: null либо ID. Оба сразу non-null запрещены. Операция folder остаётся у InventoryService; equip — у HeroDollService. Возвращает {operationId,itemId,sourceRemaining,changed,replayed}.
Worker не принимает цену и ItemData клиента; читает source через injected owner adapter.
Для обычных caller опциональное expectedSourceQuantity добавляет optimistic guard; source свежо проверяется всегда.

### Составной descriptor (R4/R8/R9)

Neutral generated Item descriptor v2:
{version:2,instanceKey,sourceType,sourceId,quantity,isBroken,upgrades,container}.
upgrades:[{instanceKey,sourceId,slotIndex,choices}].
container:null либо существующий StorageContainerSnapshot v1.
Обычный stack без upgrades/container может иметь quantity>1; составной instance всегда quantity1.
Descriptor не содержит произвольных пользовательских effects/macros/ItemData. trusted ItemData строится active GM из source IDs и checked choices.

Catalog reader R4: {resolveValueComponent,readContainerValueNodes}.
resolveValueComponent({sourceType,sourceId}) →
{unitValue,priceKnown,includedUpgradeSourceIds,rank,upgradeProfile,availability}.
Это detached результат существующего model/catalog, не новый каталог. unitValue — safe integer copper-equivalent. priceKnown отличает explicit0 от unknown.
Для upgrade component sourceType="gear". readContainerValueNodes=null до R9; затем readContainerValueNodes(snapshot) → {containerId,entries,currencyValue}, где entries — readonly descriptors оставшихся children, без root shell и отдельно установленных upgrade children. Currency — только оставшаяся валюта внутри этого snapshot. Вложенность хранится исключительно в existing row.container; projection не сериализуется вторым деревом.

evaluateItemValue(descriptor,catalogReader) →
{baseValue,upgradeValue,contentsValue,totalValue,diagnostics}.
R4 поддерживает container:null и объявляет traversal adapter; R9 добавляет существующий snapshot traversal, не второе дерево.

Materialization R8:
buildCompositeItemGraph(descriptor,{buildBase,buildUpgrade,createDocumentId}) →
{rootItemId,documents,links}.
buildBase(sourceType,sourceId) / buildUpgrade(sourceId,choices) возвращают trusted detached ItemData; callback может быть async, весь graph builder async.
links:[{hostItemId,upgradeItemId,slotIndex}]. Ключи document IDs локально назначаются до create. Повтор workflow использует сохранённые IDs.

## Согласованные ограничения продукта

- Проклятья сохраняются. 42 простых кандидата проходят техническую проверку; 38 исключены. Кандидат, требующий нового сложного механизма, тоже исключается с причиной.
- Слава/дурная слава — два счётчика под Механусом; размещение под XP отменено.
- R10 — окно и список намерений. Без shortRest, rollHitDie, HP/uses, календаря и реального countdown.
- R11 — план, не разрешение вернуть автоматический отдых в R10.
- Правило обезоруживания: размер не более +1, weapon attack без temporary/quality, save STR/DEX выбирает защитник, failure drop, two-handed disadvantage и меньший attacker → advantage только STR save.

## Git и проверка

Перед началом правок каждого этапа:
```powershell
git status --short --branch
git branch --show-current
git fetch origin
git rev-list --left-right --count HEAD...origin/main
git log --oneline HEAD..origin/main
git rev-list --left-right --count HEAD...origin/lich_branch
```
Если основной remote master — проверить его аналогично. Чужие незакоммиченные изменения, ушедший вперёд origin/lich_branch или конфликт основной ветки требуют остановки и сообщения. Все writes только lich_branch; не force push; stage только scope.

Полная проверка один раз перед commit этапа, после focused и последних code changes:
```powershell
node --test tests/*.test.mjs
git diff --check
$files = git ls-files '*.js' '*.mjs'
foreach ($file in $files) { node --check $file }
$json = git ls-files '*.json'
foreach ($file in $json) { Get-Content -Raw -Encoding UTF8 $file | ConvertFrom-Json | Out-Null }
git diff --stat
git diff
```
Новые runtime/test файлы включить в syntax check, даже если они пока untracked. Сохранить exit code каждого check, не скрывать ранний failure за последним успешным shell command. Затем stage конкретного списка, содержательный commit, git push -u origin lich_branch.

Отчёт: фактические commands/passed/failed, реальные ошибки, live matrix, version, commit. Исходная проверенная база 652ba859: 3618 passed/0 failed, 689 JS/MJS и 45 JSON без ошибок. Это baseline, не будущий результат новых тестов.

## Самопроверка комплекта планов

- Каждый R0–R11 имеет файл, цель, owner/files, interfaces, последовательность, test code, failure cases и завершение.
- Новые функции не объявлены существующими. Все межэтапные сигнатуры совпадают с этим разделом.
- Каждому исходному пункту соответствует этап в общей спецификации.
- Не включать готовые будущие методы в текущий паспорт до реализации.
