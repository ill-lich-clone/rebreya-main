# Покрытие расходов еды и воды по группе: план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans or superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Сохранять оба флажка покрытия припасов отдельно для каждой группы.

**Architecture:** `InventoryService` остаётся владельцем поведения. Новый
`supplyCoverage` живёт в существующем group state и записывается через
`GroupStateRepository`. Публичный API захватывает группу и направляет mutation
через существующий gateway; UI передаёт группу показанного инвентаря.

**Tech Stack:** Foundry VTT 13, dnd5e, native ESM, Node test runner.

**Spec:** `docs/superpowers/specs/2026-10-12-group-supply-coverage-design.md`

## Global Constraints

- Foundry VTT 13, dnd5e, `statuscounter >= 3.0.4`; новых зависимостей нет.
- Работа только в `lich_branch`; сохранить чужие изменения, force push запрещён.
- Сохранить `PARTY_STATE`, вызов `updatePartyDefaults(patch)`, `defaultCapMod`,
  авторские нормы участников, количества, бюджет и действующие права.
- Существующие группы однократно наследуют старые значения; новые — `false/false`.
- Обновить `module.json` с `1.4.372` до `1.4.373` и versioned forwarder.
- Каждый изменённый метод отражается в `docs/function-passport.md`.

## Review Focus

- Явный `false` не теряется при нормализации или повторной миграции.
- При активной B snapshot/списание для A использует только A.
- Смена active group во время ожидания не перенаправляет mutation.
- Нехватка непокрытой воды/еды по-прежнему списывает припасы и снижает энергию.
- Неактивный GM/владелец обращается к active GM; чужая/удалённая группа отвергается.

## Task 1: Перенести флажки в group state и подключить существующий flow

**Files:**
- Modify: `scripts/data/group-context-service.js` — schema и начальная миграция.
- Modify: `scripts/data/inventory-service.js` — scoped чтение, запись и списание.
- Modify: `scripts/application/group-registry-mutation-commands.js` — validator.
- Modify: `scripts/main.js` — typed command, API wrapper и ready migration.
- Modify: `scripts/ui/inventory-app.js` — передача показанной группы.
- Modify: `tests/group-context-service.test.mjs`,
  `tests/group-inventory-migration.test.mjs`,
  `tests/group-command-dispatch.test.mjs`, `tests/inventory-app-context.test.mjs`.
- Modify: `docs/function-passport.md`, `README.md`, `module.json`.
- Create: `scripts/main-1.4.373.js`; remove previous forwarder only if release
  convention requires replacement, сохранив единственный import `./main.js`.

**Interfaces:**
- Consumes: `GroupContextService.resolveForGroup(groupActorId)`,
  `mutateGroupState(groupActorId, mutator)`, canonical repository/gateway.
- Produces: group state `supplyCoverage: { coverFoodExpenses?: boolean,
  coverWaterExpenses?: boolean }`; fresh default содержит оба `false`.
- Produces: `normalizeGroupSupplyCoverage(value = {}) -> object` сохраняет
  только явно boolean-поля, отсутствие остаётся отсутствием для migration.
- Produces: `GroupContextService.initializeSupplyCoverage(legacyCoverage)
  -> Promise<number>` заполняет отсутствующие поля зарегистрированных групп
  одной canonical registry mutation; повторный вызов ничего не перезаписывает.
- Produces: `InventoryService.updatePartyDefaults(patch = {},
  { groupActorId = "", guard } = {})` и такой же optional group scope у
  `RebreyaMainModule.updatePartyDefaults(patch = {}, { groupActorId = "" } = {})`.
- Produces: `InventoryService.getPartySnapshot({actor=null,groupActorId=""}={})`
  принимает optional explicit scope; UI читает флажки показанного inventory ID,
  сохраняя прежний вызов без аргументов. Это закрывает смену active group после
  async inventory snapshot load.
- Produces: `GROUP_PARTY_DEFAULTS_UPDATE_COMMAND = "group.party.defaults.update"`
  и `isValidGroupPartyDefaultsUpdatePayload(payload)`: exact `{ groupActorId,
  patch }`, trimmed non-empty group ID, plain patch только с прежними полями.
  Coverage в socket payload — booleans; public wrapper сохраняет прежнее
  приведение `=== true`. `defaultCapMod` сохраняет прежнюю нормализацию.

- [x] **Step 1: Write regression tests before product changes.**
  Использовать существующие fixtures и реальные сервисы; добавить assertions:
  A=`true/false`, B=`false/true`, member norms=`food 2 / water 3`, supplies=`10/10`.
  После двух дней A имеет `food 10 / water 4`, B — `food 6 / water 10`.
  Смена active group и создание нового service сохраняют флажки.
  При недостатке непокрытого ресурса покрытый ресурс остаётся неизменным,
  `hungry=true`, энергия уменьшается на прежнюю величину за каждый день.
  Миграция `true/false` не заменяет отдельное `false/true`, новые группы
  имеют `false/false`; unrelated group state и `defaultCapMod` сохраняются.
  API/UI тесты проверяют captured ID, inactive-GM socket route, отказ чужому
  владельцу/неверной группе и отсутствие мировых coverage writes.
- [x] **Step 2: Run RED.**
  `node --test tests/group-context-service.test.mjs tests/group-inventory-migration.test.mjs tests/group-command-dispatch.test.mjs tests/inventory-app-context.test.mjs`.
  Expected: новые проверки падают на отсутствии scoped coverage/migration/route;
  исключить ошибки fixture/import из доказательства RED.
- [x] **Step 3: Implement schema and initial migration.**
  Нормализовать optional booleans, задать fresh defaults; migration использует
  fresh-read repository queue и не трогает прочие домены. В `ready` active GM
  запускает migration после prune зарегистрированных групп и до initialize.
  Coverage берётся из `PARTY_STATE` только для первоначального заполнения.
- [x] **Step 4: Implement scoped reading and service mutation.**
  Один private resolver `#getSupplyCoverage(state, inventoryActor)` используется
  `getPartySnapshot()` и `#buildSupplyConsumptionSnapshot()`. Для native группы
  читать её `supplyCoverage`; до первоначальной migration отсутствующие поля
  сохраняют legacy значение. Запись обоих флажков — только в captured native
  group. Legacy режим сохраняет прежний путь. Не менять формулы списания/
  энергии; `defaultCapMod` сохраняет прежний world scope и числовые правила.
  Явный group ID валидировать, не подменять текущей группой после `await`.
- [x] **Step 5: Connect gateway, API and UI.**
  Зарегистрировать command с keyed scheduling по `groupKey(groupActorId)`,
  существующей `#canSenderManageGroup`, проверкой зарегистрированной группы,
  `assertActiveGm` и одним scoped inventory refresh. Native public wrapper
  использует gateway; legacy wrapper сохраняет прежний route. Обработчик
  `party-default-field` захватывает `inventoryActorId` и передаёт optional scope.
- [x] **Step 6: Run GREEN and affected repository checks.**
  Повторить RED-команду и `node --test tests/group-state-repository.test.mjs`.
  Expected: все проверки проходят; старые coverage-тесты остаются и проверяют
  прежние quantity/energy assertions, не заменяются более слабыми тестами.
- [x] **Step 7: Document and version.**
  Обновить паспорт сигнатур/schema/flow/tests и README API; синхронно bump
  manifest и forwarder до `1.4.373`, проверить runtime references.
- [x] **Step 8: Validate once before commit.**
  `node --test tests/*.test.mjs`; `git diff --check`; `node --check` для каждого
  tracked JS/MJS; `ConvertFrom-Json` для каждого tracked JSON. Expected:
  ноль failed, syntax/JSON/diff errors. Если доступен Foundry, проверить две
  группы, persistence/reload и console; недоступную live-проверку указать.
- [x] **Step 9: Review, commit and push.**
  Сверить полный diff со spec, выполнить independent review через Gemini
  (если CLI доступен; иначе доступный review инструмент/локальная сверка),
  исправить существенные замечания с RED/GREEN. Проверить remote и отсутствие
  чужих правок. Добавить только файлы задачи, commit
  `fix: scope food and water expense coverage to groups`, затем
  `git push -u origin lich_branch`. Указать spec, plan, commit и checks в отчёте.

## Execution handoff

План и native/inline execution согласованы пользователем 2026-10-12.
Одна связанная правка с существующими владельцами выполняется без отдельных
implementer subagents. Спецификация согласована 2026-10-12.
