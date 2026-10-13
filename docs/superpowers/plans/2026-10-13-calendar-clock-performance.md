# Calendar Clock Performance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking. Recommended execution: native implementation in this session, with an independent review before the final runtime commit.

**Goal:** Облегчить часы SmallTime и календарные переходы, сохранив игровое поведение и recovery contracts.

**Architecture:** Узкие свежие projections в существующем GroupStateRepository и ссылки на Group Actor в GroupContextService. CalendarService и guards используют эти методы; полные контексты и persisted schema сохраняются. Мутации остаются в прежней очереди, с нормализацией на входе и перед commit.

**Tech Stack:** Foundry VTT 13+, JavaScript ESM, Node test runner, PowerShell; без новых зависимостей.

**Spec:** `docs/superpowers/specs/2026-10-13-calendar-clock-performance-design.md` — подтверждена пользователем 2026-10-13.

План подтверждён пользователем 2026-10-13. Выполнено native в текущем `lich_branch` с независимым Gemini review. Полная проверка: 4565 passed, 0 failed, 1 skipped; 959 JS/MJS и 55 JSON без ошибок. Live browser QA недоступна без авторизованного сеанса; результаты Node benchmark приведены в спецификации. Финальный runtime commit/push выполняются после staged diff review.

## Global Constraints

- Сохранить весь существующий `groupState`, неизвестные поля календаря, журналы переходов и downtime history; persisted migration и сокращение истории не выполняются.
- Сохранить API/settings/flags/socket schemas, detached full reads, GM/player selection, explicit/captured group и world fallback.
- Сохранить guards до/после await и write, queued fresh reads, claims/checkpoints/precommit, failover/retry/resume/idempotency и число durable checkpoint writes.
- Обрабатывать каждый сдвиг и пересечённый день; backward не запускает downtime, припасы или monthly reset. Не менять нормы, формулы, energy, budgets, craft, trader/global event rules.
- Править и пушить только `lich_branch`, без force push. Выполнить полные runtime checks перед единым runtime commit; промежуточные runtime commits не публиковать.
- Повысить текущую версию `1.4.374` до `1.4.375`, если она остаётся свободной при release check; сохранить старые forwarders для cached manifests.

## Review Focus

1. Смена активной группы и raw setting между чтениями: следующий snapshot должен видеть свежие значения, а начатый переход — прежний captured scope.
2. Player membership, trimmed legacy registry keys и отсутствующий календарь: узкий путь повторяет выбор/ошибки полного пути и world fallback.
3. Исключение mutator или смена active GM: source cache и журналы не меняются; новая попытка использует свежий queued read.
4. Последовательные переходы через полночь вперёд/назад и self-sync: не терять delta, prompt или suppression, не повторять игровые последствия.
5. Legacy injected context без новых методов: существующие CalendarService/coordinator fixtures и consumers сохраняют поддерживаемый fallback; runtime imports изменённых владельцев используют один новый cache key.

---

### Task 1: Узкие контексты и устранение повторной обработки черновика

**Files:** `scripts/infrastructure/foundry/group-state-repository.js`, `scripts/data/group-context-service.js`, `scripts/data/calendar-service.js`, `scripts/data/calendar-transition-coordinator.js`; тесты тех же четырёх владельцев в `tests/`.

**Interfaces:**
- Produces: `GroupStateRepository.readGroupIndex() -> { activeGroupActorId: string, groupActorIds: string[] }`; `readCalendarState(groupActorId: string) -> detached { version?, isoDate?, timeOfDaySeconds? }`.
- Produces: `GroupContextService.resolveReferenceForGroup(groupActorId)` / `resolveReferenceForCurrentUser()` возвращают прежние groupActor/groupId/members/memberActorIds/canManage без groupState; `getCalendarContext({ groupActorId = "" } = {}) -> reference + calendarState`.
- Full `read()`, `resolveForGroup()` и `resolveForCurrentUser()` сохраняют форму и detached normalized data. Выбор текущей группы выделяется в private `#resolveCurrentGroupActorId()` и использует repository index.
- CalendarService предпочитает `getCalendarContext`; coordinator guard — `resolveReferenceForGroup`. Если injected service не содержит нового метода, используется прежний путь. Если injected repository содержит только прежний `read()`, GroupContextService получает index/calendar projection из этого detached read, сохраняя старый dependency-injection contract.

- [x] **1. Написать падающие regression tests до runtime edits.**
  - `readGroupIndex and readCalendarState never traverse archives or unrelated groups`: accessor на journal/downtime/посторонней группе бросает; index содержит только очищенные ID, clock возвращает `1200-01-10` и `49025`, archive accesses равны `0`.
  - `narrow reads are detached and fresh`: изменение результата не меняет source; следующий read видит новые seconds и active group.
  - `reference resolution preserves GM/player selection and canonical errors`: registered managed group + OWNER exact character; unregistered flag-only group отвергается; explicit Actor неверного типа/отсутствующий Actor дают прежние errors; пробелы в registry keys обрабатываются как при normalizeGroupRegistry, при совпадении очищенных ключей побеждает последняя запись.
  - `calendar snapshot does not read archived group state`: настоящий GroupContextService + raw-setting stub с throwing archives; прежние cells/moon/date/time и explicit-group/world-fallback результаты; legacy context fallback проходит.
  - `calendar guards use references without materializing full state`: spy на полный resolve запрещает вызов из guard; сохранить существующие deletion, wrong execution user, active-GM failover и captured-group проверки.
  - `group mutation normalizes only at canonical boundaries`: existing group не вызывает дополнительный injected group normalizer до/после mutator; registry normalizer вызывается дважды; create получает defaults; journal/custom calendar fields равны исходным после time patch; rejected mutator не меняет source; queued date/time updates сохраняют оба поля.

  Ключевые assertions в соответствующих fixtures:
  ```js
  assert.deepEqual(repository.readGroupIndex(), { activeGroupActorId: "group-a", groupActorIds: ["group-a", "group-b"] });
  assert.deepEqual(repository.readCalendarState("group-a"), { version: 1, isoDate: "1200-01-10", timeOfDaySeconds: 49025 });
  assert.equal(archiveAccesses, 0);
  assert.equal(registryNormalizations, 2);
  assert.equal(existingGroupNormalizations, 0);
  assert.deepEqual(afterJournal, beforeJournal);
  ```
- [x] **2. Запустить новые tests и подтвердить целевые failures.** `node --test tests/group-state-repository.test.mjs tests/group-context-service.test.mjs tests/calendar-service.test.mjs tests/calendar-transition-coordinator.test.mjs` — новые structural assertions должны падать на текущем коде, существующие контракты оставаться passing.
- [x] **3. Реализовать указанные interfaces.** Читать только index и clock fields, не отдавать raw setting references. Канонические правила выборки legacy keys/Actor/membership/ошибок переиспользовать внутри GroupContextService. Полные context methods используют тот же selection/reference owner. Все guard call sites сохранить.
- [x] **4. Упростить обработку мутации.** В mutateGroupState переиспользовать уже normalized detached existing group; create отдельно нормализовать default. Выходную нормализацию оставить mutateRegistry. В calendar patch сохранять journal/custom fields через spread detached draft без его повторного deepClone.
- [x] **5. Проверить владельцев и авторизацию.** Предыдущая команда плюс `node --test tests/group-command-dispatch.test.mjs tests/group-inventory-migration.test.mjs tests/inventory-app-context.test.mjs`; ожидается 0 failed. Существующие regression assertions не ослаблять ради нового кода.

### Task 2: Повторная синхронизация SmallTime

**Files:** `scripts/integrations/smalltime-compat.js`, `tests/smalltime-compat.test.mjs`.

**Interfaces:** `refreshSmallTimeDateDisplay({ refreshSunTimes = true } = {})`; `syncSmallTimeToCalendarTime(moduleApi, { refreshSmallTimeDateDisplay = existing helper, refreshSmallTimeSunTimes = existing helper } = {})`. Остальные API и hook registrations сохраняются.

- [x] **1. Написать падающие tests.** `updateDate skips unchanged current-date persistence but updates the DOM`; `clock sync calculates sun once and passes refreshSunTimes false to the date refresh`; `explicit date refresh can skip the sun helper`; последовательные time events `+60`, `+86400`, `-86400` сохраняют все вызовы set time/shift и исходные forward/backward options, подтверждение forward supplies и self-sync suppression.
  ```js
  assert.equal(dateElement.textContent, "Moonday, 5 Frostfall 1200");
  assert.deepEqual(settingsWrites, []); // persisted date already equals the displayed date
  assert.equal(sunRefreshCalls, 1);
  assert.deepEqual(dateRefreshOptions, { refreshSunTimes: false });
  assert.deepEqual(dayDeltas, [1, -1]);
  assert.equal(supplyPromptCalls, 1);
  ```
- [x] **2. Подтвердить целевые failures.** `node --test tests/smalltime-compat.test.mjs` — новые проверки должны падать; существующие 11 cases остаются passing.
- [x] **3. Реализовать равенство persisted date и один sun refresh.** Сравнение через optional `settings.get` сохраняет compatibility со старыми fixtures. Clock sync await sun helper остаётся перед timeTransition; последующий date refresh получает `{ refreshSunTimes: false }`. Не добавлять общий кэш, debounce или фильтрацию time events.
- [x] **4. Проверить.** `node --test tests/smalltime-compat.test.mjs tests/calendar-service.test.mjs tests/calendar-transition-coordinator.test.mjs` — 0 failed, сохранены prompts/options и стадийность.

### Task 3: Cache version, паспорт, измерения и выпуск

**Files:** `module.json`, новый `scripts/main-1.4.375.js`, `tests/module-manifest.test.mjs`, `tests/main-composition-root.test.mjs`, `tests/character-downtime-service.test.mjs`, `docs/function-passport.md`, spec/plan status. Cache import edits: `scripts/main.js`, `scripts/data/group-context-service.js`, `scripts/data/calendar-service.js`, `scripts/data/travel-service.js`, `scripts/data/character-downtime-service.js`, `scripts/data/inventory-service.js`, `scripts/integrations/transport-group-drop.js`, `scripts/integrations/inventory-sync.js`, `scripts/ui/inventory-app.js`.

Execution ruling: cached InventorySync consumers также получают новый URL; иначе клиенты могут сохранить старую цепочку зависимостей. Строгая constructor-identity проверка CharacterDowntimeService использует тот же canonical URL, что и main; её assertion не ослаблен.

- [x] **1. Добавить cache regression.** Manifest/forwarder ожидают `1.4.375`; все runtime importers пяти изменённых владельцев используют один `?v=1.4.375`. Существующие old-forwarder compatibility assertions сохранить.
  ```js
  assert.equal(manifest.version, "1.4.375");
  assert.deepEqual(manifest.esmodules, ["scripts/main-1.4.375.js"]);
  assert.equal(forwarder.trim(), 'import "./main.js";');
  assert.deepEqual(new Set(runtimeImportCacheKeys), new Set(["1.4.375"]));
  ```
- [x] **2. Обновить release graph.** Forwarder содержит только `import "./main.js";`; manifest esmodules указывает новую версию. Перечисленные imports GroupContextService, CalendarService, CalendarTransitionCoordinator, GroupStateRepository и SmallTime adapter получают новый согласованный key; unrelated cache keys не менять.
- [x] **3. Обновить паспорт.** Разделы групп/persistence, календаря/guard и SmallTime: signatures, owner, data flow, constraints, focused tests. Проверить внутренние ссылки spec/plan; не заявлять новую схему persisted data или уменьшение recovery checkpoints.
- [x] **4. Сравнить изолированный benchmark до/после на одной диагностической копии.** Snapshot, time patch и one-day transition с теми же mock persistence/disabled external stages; зафиксировать median, setting reads/writes и serialized bytes. Clock/guard archive traversals должны быть нулевыми; число durable writes и итоговые даты/журналы — прежними. Не выводить private world content и не менять live data.
- [x] **5. Независимо проверить diff на соответствие spec и failure matrix.** Gemini получает только релевантные snippets/diff без credentials; Codex проверяет важные замечания в source. При недоступности CLI — локальный review с явным ограничением независимой проверки.
- [x] **6. Выполнить release checks один раз после финальных runtime edits.** `node --test tests/*.test.mjs`; `node --check` каждого tracked JS/MJS плюс нового forwarder; `ConvertFrom-Json` каждого tracked JSON; `git diff --check`; meaningful diff и diff stat. Отчёт: passed/failed и реальные ошибки. Повторять только затронутые проверки при новых изменениях/ошибках.
- [ ] **7. Проверить live Foundry при доступном авторизованном сеансе.** Minutes, midnight forward/backward, календарный день и выбранная группа; браузерная совместимость/задержка не заявляются при недоступном сеансе. Авторизованный сеанс недоступен; live QA не выполнялась.
- [x] **8. Commit/push.** Stage только файлы задачи; осмысленный runtime commit и `git push -u origin lich_branch`. Финальный отчёт содержит spec/plan paths, commit, проверки, benchmark и ограничения.
