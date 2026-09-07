# R11 — условный подробный план восстановления КО и костей хитов

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

**Статус:** отложено. Пользователь ограничил текущую сцену окном и списком действий. Этот файл отвечает на просьбу расписать программу до конца; он не разрешает писать runtime-код R11 и не расширяет R10.

**Будущий результат:** только после нового запроса участник сможет выполнить согласованное восстановление и потратить выбранную кость хитов, с проверкой права и защитой от повторного применения.

**Зависимости:** законченный R10; отдельное решение о правилах восстановления. Исходная [спецификация сцены](../../specs/2026-09-07-module-development/ten-minute-scene.md), паспорт 2/18. Проверенные точки dnd5e5.2.5: actor.shortRest(config), actor.rollHitDie(config,dialog,message). Их вызов уже меняет игровые ресурсы.

## Задача R11.0 — зафиксировать будущий игровой контракт

**Файлы при отдельном разрешении:** создать docs/superpowers/specs/2026-09-07-module-development/short-rest-extension.md; синхронно уточнить этот план и ten-minute-scene.md. Сейчас эти правки и функции не выполнять.

- [ ] Убедиться, что новый пользовательский запрос действительно разрешает восстановление, а не только оформление списка.
- [ ] Выбрать один режим: полный штатный short rest либо явно выбранные восстанавливаемые умения. Full shortRest восстанавливает больше списка; его нельзя использовать внутри selected mode.
- [ ] Определить доступность КО за10минут, участие занятого героя, повторный отдых, требования расходников/энергии и отмену после уже выполненного действия. Не брать правила long rest по сходству названия.
- [ ] Определить, какие ресурсы входят в список: native uses.recovery с периодом short rest и зарегистрированные модульные providers, manual-only строки. Для неизвестного cadence показать описание, не присваивать КО автоматически.
- [ ] Решить применение HD: одна выбранная кость за раз, выбор класса/размера dice у multiclass, CON/healing modifiers, ограничение HP max и остатка HD. Сохранять native правила согласованной версии.
- [ ] Решить момент времени: R11 по умолчанию тоже не продвигает календарь; если это отдельно запрошено, выделить единственного time owner и отдельный receipt. Нельзя одновременно двигать часы native rest и module scene finish.
- [ ] Записать privacy/visibility результатов, GM/OWNER authority и поведение disconnected player. До фиксации этих решений законченной считается только документация, код R11 не начинается.

## Задача R11.1 — каталог доступных действий без мутаций

**Предлагаемые новые файлы:** scripts/rest/scene-rest-actions.js, tests/scene-rest-actions.test.mjs; scripts/ui/scene-activity-app.js и template расширять только после R11.0.

- [ ] Pure buildSceneRestActions({actorSnapshot,mode,providers}) → rows. Row: {actionId,kind,sourceUuid,label,available,maxSelections,reason,resourceFingerprint}; kind short-rest/recover-resource/hit-die/manual.
- [ ] Actor snapshot читает текущие native ресурсы, классы/HD и declared recovery; providers имеют whitelist стабильных ID и read-only preview. Не извлекать код/формулы из пользовательского label.
- [ ] В full mode показать одну явную операцию «Короткий отдых» с перечнем затрагиваемого; HD отдельным действием только если native full-rest config позволяет не потратить их второй раз.
- [ ] В selected mode показать конкретные resource rows и HD; каждую строку без поддержанного безопасного provider оставить manual, без активной кнопки.
- [ ] До реализации tests на multiclass HD, полные/пустые uses, отсутствующий recovery period, manual provider, ресурс другого Actor и неизменность входного snapshot.
- [ ] Конкретный отрицательный тест для списка:

```js
const before = structuredClone(actorSnapshot);
const actions = buildSceneRestActions({
  actorSnapshot, mode: "selected", providers: new Map()
});
assert.deepEqual(actorSnapshot, before);
assert.equal(actions.some(a => a.kind === "short-rest"), false);
assert.ok(actions.filter(a => a.kind === "manual").every(a => a.available === false));
```

actorSnapshot задаётся реальным fixture dnd5e5.2.5 в tests/fixtures/scene-rest-actor.mjs: два класса с различными HD, feature с short-rest recovery, feature с long-rest recovery и неизвестным модульным recharge.

## Задача R11.2 — адаптер native rest и отдельные поддержанные providers

**Предлагаемые новые файлы:** scripts/integrations/dnd5e-scene-rest-adapter.js, tests/dnd5e-scene-rest-adapter.test.mjs; найденные профильные native/module resource providers расширять у их владельца.

- [ ] Проверить на установленной версии точные options/hooks actor.shortRest/rollHitDie через локальный dnd5e source и официальную документацию соответствующего release. Не выдумывать config ключи по API другой версии.
- [ ] Adapter contract preview(action,actor), execute(action,actor,context), inspectReceipt(action,actor,context). execute вызывается только authority workflow; он не повторяет себя при сетевой ошибке.
- [ ] Full mode делегирует actor.shortRest один раз с проверенными options, исключающими незапрошенные диалоги/повтор HD/продвижение времени. Если native API не позволяет согласованный scope, изменить дизайн до реализации, а не откатывать лишние изменения post-factum.
- [ ] Selected mode никогда не вызывает shortRest. Для каждого поддержанного recovery provider применять только его объявленные field mutations/recovery hooks. Нельзя подменить восстановление всех ресурсов циклами по строкам с похожим названием.
- [ ] Hit-die action делегирует actor.rollHitDie с валидированным class/die selection. Native owner считает лечение/модификаторы и списывает HD; модуль не делает дополнительный actor.update(HP) и не уменьшает HD вторично.
- [ ] Разделить presentation cancel до execute и native отказ/ошибку после начала. Если native dialog содержит подтверждение, его завершение должно предшествовать переходу executing либо быть надёжно распознано adapter; закрытие UI не означает успешное восстановление.
- [ ] LongRestPipelineService и его providers не запускать для КО. Подключать существующие healing modifiers только к одному каноническому native pipeline.
- [ ] Tests проверяют точные forwarded options, native call count1, no double healing, selected no shortRest, full no extra per-resource writes, class-specific HD, maxHP и отмену.

## Задача R11.3 — авторизованная операция и recovery без повторного лечения

**Предлагаемые новые файлы:** scripts/application/scene-rest-workflow.js, scripts/infrastructure/foundry/scene-rest-command-contract.js, tests/scene-rest-workflow.test.mjs, tests/scene-rest-socket.test.mjs; composition scripts/main.js.

- [ ] SceneRestWorkflow({journal,coordinator,readContext,adapter,refresh}) с prepare(intent,context), execute(operationId,context), resume(operationId,context). Prepared intent: {operationId,sessionId,actorUuid,actionId,selection,expectedResourceFingerprint}.
- [ ] Typed request содержит только whitelist action/selection refs, session/Actor/operation IDs; client не присылает новое HP/uses, формулу, rolled total или ItemData.
- [ ] Проверить open session/participant, OWNER Actor либо GM, свежие ресурсы и выбранный режим. Один actor/action sequence сериализуется через канонический coordinator; world lock не удерживается во время решения человека.
- [ ] Одна намеренная трата HD — отдельный operation ID. Повтор того же клика/reconnect использует его повторно; следующий осознанный HD roll получает новый ID после свежего preview.
- [ ] Phases prepared → executing → result-recorded → completed; cancelled/conflict/manual-review. До executing сохранить native action fingerprint, relevant resource baseline и identity, а не весь Actor для последующего полного rollback.
- [ ] После native изменения хранить результат и проверяемый receipt в journal. Если native API поддерживает correlated operation metadata, использовать её и проверить реальное сохранение; отсутствие поддержки нельзя заменить воображаемой транзакцией.
- [ ] Самое опасное окно: native mutation произошла, receipt не записался. Resume сначала inspectReceipt. При недостаточных доказательствах manual-review; автоматический второй shortRest/HD roll запрещён. Нельзя восстанавливать старые HP/uses поверх урона/лечения, случившихся позже.
- [ ] GM resolution неоднозначного outcome содержит решение/reason и текущую проверку ресурсов. Оно завершает старую operation, не генерирует новую кость скрыто.
- [ ] Идемпотентное завершение R10 session не запускает новые rest actions. Уже применённое лечение не откатывается от закрытия окна/отмены сцены; это фиксируется правилами R11.0.
- [ ] Fault tests: до native, после native до receipt, после receipt до reply, native частично изменил разные resources, новый GM, смена Actor ownership, другая сессия, double click и две намеренные последовательные HD траты.
- [ ] Concrete workflow assertion: в fixture native adapter повышает HP и уменьшает HD, затем теряется acknowledgement; повтор operation обязан дать nativeCallCount1 при подтверждённом receipt либо manual-review при неизвестном outcome. Test, разрешающий второй вызов ради успешного ответа, недопустим.

## Задача R11.4 — UI и регрессия R10

**Файлы:** scripts/ui/scene-activity-app.js, templates/scene-activity-app.hbs, styles/main.css; tests/scene-activity-app.test.mjs, новый tests/scene-rest-app.test.mjs.

- [ ] Список показывает доступность, остались/максимум и конкретно восстанавливаемый ресурс. Action button отражает idle/pending/completed/manual-review; строки с ручным правилом — описание.
- [ ] UI подтверждает выбранное действие перед единственной mutation. Ресурс обновляется из результата/refresh, не optimistic увеличением HP.
- [ ] Сохранить режим R10: если расширение не включено для session, остаётся прежний список заявок и ноль rest writes. Режим session фиксируется при start, не меняется незаметно у уже открытых игроков.
- [ ] Native result/chat receipt связан с operation; повтор render не создаёт второе сообщение. Закрытие окна не отменяет продолжающийся authoritative recovery.
- [ ] Live GM+player: полные/пустые ресурсы, multiclass, несколько HD по одному, full против selected, reconnect после native action и manual-review. Сверить HP/HD/uses и ноль незапрошенных calendar writes.
- [ ] Обновить точные методы паспорта18/2/19, публичный API README, профильные tests native integration. Существующий long rest и R10-only tests остаются зелёными.

**Будущие focused:** node --test tests/scene-rest-actions.test.mjs tests/dnd5e-scene-rest-adapter.test.mjs tests/scene-rest-workflow.test.mjs tests/scene-rest-socket.test.mjs tests/scene-rest-app.test.mjs tests/scene-activity-service.test.mjs tests/scene-activity-app.test.mjs tests/long-rest-pipeline-service.test.mjs tests/long-rest-hooks.test.mjs.

## Будущая готовность и Git

Этот раздел выполняется только после нового разрешённого scope и R11.0. Применить общий Git/verification процесс README комплекта: lich_branch, status/branch/fetch/remote comparisons, focused и live, passport, новая client version/forwarder, полный test/syntax/JSON/diff цикл, stage только scope, commit и push без force.

**Предлагаемый будущий commit:** feat: execute supported scene rest actions with recovery receipts.

**Текущая готовность R11:** подробный условный план записан; никакого кода восстановления в текущую поставку документов и R10 не входит.
