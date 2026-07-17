# Global Reactions and Rune Knight Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Ввести единый 10-секундный сервис реакций для всего Rebreya и поверх него полностью автоматизировать Rune Knight из Fighter V0.28 с приоритетом MIDI-QOL/DAE и без polling или сканирования мира в горячих hooks.

**Architecture:** Активный GM координирует сериализованные типы реакций через `ReactionQueueService`; ленивый `ReactionCapabilityIndex` хранит только провайдеров текущей сцены. Классовые сервисы регистрируют типы реакций и реализуют проверку/оплату/эффект, но не создают реакционные окна. `RuneKnightAutomationService` использует этот фундамент для Stone/Cloud/Storm/Runic Shield, а данные предметов и DAE-эффектов строятся в отдельном `rune-knight-automation.js`.

**Tech Stack:** Foundry VTT v13, dnd5e v5, MIDI-QOL hooks/workflows, DAE Active Effects, native ES modules, Node `node:test`/`assert`, module socket `module.rebreya-main`.

## Global Constraints

- Перед каждой серией правок выполнить `git status --short`, `git branch --show-current`, `git fetch origin --prune` и проверить `git merge-base --is-ancestor origin/main HEAD`.
- Работать только в `lich_branch`; при чужих незакоммиченных файлах или расхождении, требующем конфликтного merge/rebase, остановиться.
- Не трогать девять вручную разыгрываемых приёмов: Активное уклонение, Обезоруживающая атака, Парирование, Сплочение, Атака с захватом, Засада, Командирский напор, Подмена, Тактическая оценка.
- Рунные пассивы работают от владения предметом руны; привязки руны к экипировке нет.
- Каждое отдельное реакционное окно живёт ровно `10_000` мс. Закрытие, timeout, disconnect и пустой ответ ничего не расходуют.
- В бою порядок равен текущему `combat.turns`; вне боя кандидаты перемешиваются ровно один раз внедрённым RNG.
- После принятой реакции очередь завершается только при исчезновении исходного триггера.
- `Giant's Might` имеет `@prof` использований на продолжительный отдых. Это правило важнее текста исходного JSON про два использования.
- Короткий отдых dnd5e считается 10-минутным перерывом для восстановления рун.
- Никаких `setInterval`, `requestAnimationFrame`, боевого polling, сканирования `game.actors` из hooks или force push.

---

### Task 1: Зафиксировать baseline и контракт индекса реакций

**Files:**

- Create: `tests/reaction-capability-index.test.mjs`
- Create: `scripts/combat/reaction-capability-index.js`

**Step 1: Написать падающие тесты индекса**

Покрыть следующие публичные методы и свойства:

```js
const index = new ReactionCapabilityIndex({ tokenProvider, actorResolver });
index.registerProvider("counterspell", ({ actor, token }) => candidateDescriptors);
index.rebuildScene(scene);
index.refreshActor(actor);
index.removeToken(tokenUuid);
index.invalidateScene(sceneId);
index.has("counterspell");
index.list("counterspell");
```

Тесты должны доказать:

- первый `has/list` лениво индексирует только токены активной сцены;
- повторный `has/list` не повторяет provider resolver;
- `refreshActor(actor)` переиндексирует только этого актёра;
- update/delete токена удаляет только связанные descriptor-ы;
- пустой kind возвращается за O(1) без вызова внедрённых `distanceFeet`/`isVisible` spies;
- индекс нигде не читает `game.actors` и не создаёт timer/interval.

**Step 2: Запустить тест и подтвердить RED**

Run: `node --test tests/reaction-capability-index.test.mjs`

Expected: `ERR_MODULE_NOT_FOUND` для `reaction-capability-index.js`.

**Step 3: Реализовать минимальный событийный индекс**

Использовать структуры:

```js
this._providers = new Map();       // kind -> resolver
this._entriesByKind = new Map();   // kind -> Map(candidateKey, descriptor)
this._keysByActor = new Map();     // actorUuid -> Set(`${kind}:${candidateKey}`)
this._sceneId = "";
this._built = false;
```

Descriptor содержит только `kind`, `providerId`, `actorUuid`, `tokenUuid`, `itemUuid`, `activityId`, `ownerUserIds`. Геометрия и документы в кеше не хранятся. `rebuildScene` разрешает только actors токенов сцены; `refreshActor` очищает старые ключи актёра и повторно запускает зарегистрированные resolver-ы для него.

**Step 4: Запустить тест и syntax check**

Run: `node --test tests/reaction-capability-index.test.mjs && node --check scripts/combat/reaction-capability-index.js`

Expected: PASS.

**Step 5: Commit**

```bash
git add scripts/combat/reaction-capability-index.js tests/reaction-capability-index.test.mjs
git commit -m "feat: add event-driven reaction capability index"
```

---

### Task 2: Реализовать чистое ядро последовательной очереди реакций

**Files:**

- Create: `tests/reaction-queue-service.test.mjs`
- Create: `scripts/combat/reaction-queue-service.js`

**Step 1: Написать падающие unit-тесты порядка и lifecycle**

Зафиксировать API:

```js
queue.registerType("counterspell", provider);
const result = await queue.resolve({
  triggerId: "cast:workflow-1",
  kind: "counterspell",
  workflowId: "workflow-1",
  context: { casterTokenUuid, itemUuid, activityId, spellLevel }
});
```

Provider contract:

```js
{
  listCandidates(context, capabilityIndex),
  isTriggerValid(context),
  revalidateCandidate(candidate, context),
  buildPrompt(candidate, context),
  pay(candidate, choice, context),
  apply(candidate, choice, context),
  rollback(candidate, transaction, context)
}
```

Тесты:

- инициативы `[20, 14, 7]` вызываются именно в этом порядке независимо от входного массива;
- без боя внедрённый RNG Fisher-Yates вызывается один раз и порядок далее не меняется;
- decline/close/timeout переходят к следующему кандидату;
- после accepted `isTriggerValid=false` прекращает цепочку;
- после accepted и `isTriggerValid=true` цепочка продолжается;
- один `triggerId` одновременно возвращает тот же Promise и не открывает второе окно;
- provider exception освобождает lock в `finally`;
- `pay` или `apply` failure вызывает `rollback`, не вызывает расход обычной реакции и не оставляет cached in-flight state.

**Step 2: Подтвердить RED**

Run: `node --test tests/reaction-queue-service.test.mjs`

Expected: отсутствующий export `ReactionQueueService`.

**Step 3: Реализовать очередь с внедрёнными зависимостями**

Экспортировать:

```js
export const REACTION_PROMPT_TIMEOUT_MS = 10_000;
export const REACTION_RESULT_TTL_MS = 60_000;
const queue = new ReactionQueueService(moduleApi, options);
queue.registerType(kind, provider);
const outcome = await queue.resolve(request);
const handled = await queue.handleSocketMessage(message, transportSenderId);
```

Конструктор принимает `moduleApi`, `capabilityIndex`, `gameProvider`, `random`, `now`, `setTimeoutFn`, `clearTimeoutFn`, `promptCandidate`. Использовать `Map` для `_inFlight` и небольшой TTL/LRU cache для максимум 256 завершённых trigger results. Удалять locks и timers в `finally`.

Платёжная транзакция выполняется в порядке: повторная валидация → provider `pay` → provider `apply` → `combatAttackService.consumeReaction`. При любом последующем отказе вызвать provider `rollback`. Timeout никогда не доходит до `pay`.

**Step 4: GREEN**

Run: `node --test tests/reaction-queue-service.test.mjs && node --check scripts/combat/reaction-queue-service.js`

Expected: PASS.

**Step 5: Commit**

```bash
git add scripts/combat/reaction-queue-service.js tests/reaction-queue-service.test.mjs
git commit -m "feat: add deterministic global reaction queue"
```

---

### Task 3: Добавить единственный multi-user transport и 10-секундное окно

**Files:**

- Modify: `scripts/combat/reaction-queue-service.js`
- Modify: `tests/reaction-queue-service.test.mjs`

**Step 1: Добавить падающие transport-тесты**

Зафиксировать четыре socket envelope type:

```js
rebreya-main.reaction.trigger
rebreya-main.reaction.triggerResult
rebreya-main.reaction.prompt
rebreya-main.reaction.promptResult
```

Проверить:

- non-GM source отправляет trigger только активному GM;
- GM отправляет prompt только одному активному владельцу actor, а при его отсутствии — себе;
- `transportSenderId` обязан совпадать с envelope `senderId` и ожидаемым `forUserId`;
- forged/late result игнорируется;
- disconnect, close и timeout дают `{accepted:false, reason}` и закрывают приложение;
- единственный prompt timer равен строго `10_000`;
- socket payload содержит UUID/string/number/boolean и prompt schema, но не Actor/Item/Token/workflow objects;
- pending maps ограничены 128 trigger requests и 128 prompt requests; старые завершённые записи очищаются по TTL.

**Step 2: RED**

Run: `node --test --test-name-pattern="socket|owner|timeout|forged" tests/reaction-queue-service.test.mjs`

Expected: новые transport assertions падают.

**Step 3: Реализовать transport и общий renderer**

Добавить `initialize()`, `handleSocketMessage(message, transportSenderId)`, `promptDecision({ requestId, forUserId, prompt, timeoutMs })` и `destroy()`. `promptDecision` является единым транспортом/renderer-ом также для triggered choices без расхода обычной реакции (например, Fire Rune), но candidate ordering и reaction ledger применяются только методом `resolve`. Общая prompt schema:

```js
{
  title: "Counterspell",
  body: "Use Counterspell against a level 5 spell?",
  acceptLabel: "Counterspell",
  declineLabel: "Пропустить",
  fields: [{
    name: "spellLevel",
    type: "select",
    options: [{ value: 3, label: "3" }]
  }]
}
```

Только `ReactionQueueService` вызывает `foundry.applications.api.DialogV2.wait`. Timeout закрывает конкретный Dialog application через `close({ force: true })`; callback и timeout объединяются `Promise.race` + `AbortController` без polling.

**Step 4: GREEN**

Run: `node --test tests/reaction-queue-service.test.mjs`

Expected: PASS.

**Step 5: Commit**

```bash
git add scripts/combat/reaction-queue-service.js tests/reaction-queue-service.test.mjs
git commit -m "feat: route reaction prompts through active GM"
```

---

### Task 4: Подключить общий сервис в composition root и событийные invalidation hooks

**Files:**

- Modify: `scripts/main.js`
- Modify: `scripts/combat/hooks.js`
- Modify: `tests/main-composition-root.test.mjs`
- Modify: `tests/environment-automation-service.test.mjs`

**Step 1: Написать падающие composition/hook assertions**

Проверить создание в таком порядке:

```js
this.reactionCapabilityIndex = new ReactionCapabilityIndex();
this.reactionQueueService = new ReactionQueueService(this, {
  capabilityIndex: this.reactionCapabilityIndex
});
this.combatAttackService = new CombatAttackService(this);
this.spellAutomationService = new SpellAutomationService(this);
```

Rune Knight service подключается позднее в Task 8, после создания его файла. Здесь проверить `await reactionQueueService.initialize()` до provider registrations существующих сервисов и `reactionCapabilityIndex.rebuildScene(canvas.scene)` после них. `main.js` должен передавать socket messages сначала `reactionQueueService.handleSocketMessage`, затем старым handlers/`SocketCommandBus` только если message не обработан.

Hook-тест регистрирует и вызывает `canvasReady`, create/update/delete `Actor`, `Item`, `ActiveEffect`, `Token`, `updateUser`, `deleteCombat`; каждая операция должна переиндексировать только соответствующий actor/token или ownership, кроме редкого `canvasReady/updateUser`, которым разрешён rebuild текущей сцены.

**Step 2: RED**

Run: `node --test tests/main-composition-root.test.mjs tests/environment-automation-service.test.mjs`

Expected: отсутствуют reaction services/hooks.

**Step 3: Реализовать wiring**

Добавить imports, public module API passthrough `resolveReactionTrigger`, `registerReactionType`, `invalidateReactionActor`, socket routing и hook guards. Горячие MIDI/dnd5e hooks сначала вызывают `reactionCapabilityIndex.has(kind)`; только `true` допускает candidate geometry.

**Step 4: GREEN**

Run: `node --test tests/main-composition-root.test.mjs tests/environment-automation-service.test.mjs tests/reaction-capability-index.test.mjs tests/reaction-queue-service.test.mjs`

Expected: PASS.

**Step 5: Commit**

```bash
git add scripts/main.js scripts/combat/hooks.js tests/main-composition-root.test.mjs tests/environment-automation-service.test.mjs
git commit -m "feat: wire global reactions into module runtime"
```

---

### Task 5: Мигрировать Counterspell и Spell Shatter

**Files:**

- Modify: `scripts/combat/spell-automation-service.js`
- Modify: `tests/spell-automation-service.test.mjs`

**Step 1: Перевести тестовый harness на общий queue**

Заменить прямые `handleSocketMessage` Counterspell fixtures на зарегистрированный provider `spell-counter`. Добавить assertions:

- Counterspell/Spell Shatter используют инициативный/случайный порядок очереди;
- successful Counterspell инвалидирует текущий spell-cast trigger и завершает эту очередь;
- Counterspell на Counterspell создаёт дочерний trigger и корректно восстанавливает root cast;
- timeout/decline не расходуют slot/SP/обычную реакцию;
- failed slot/SP payment или failed effect полностью откатываются;
- remote owner использует общий authenticated transport;
- source text больше не содержит `COUNTERSPELL_REQUEST_EVENT`, `COUNTERSPELL_RESULT_EVENT`, `COUNTERSPELL_REQUEST_TIMEOUT_MS`, `_pendingCounterspellRequests` или `promptCounterspell`.

**Step 2: RED**

Run: `node --test tests/spell-automation-service.test.mjs`

Expected: fixtures ждут provider registration, старые private queue tests падают.

**Step 3: Зарегистрировать spell provider**

В `initialize()` зарегистрировать capability kinds `counterspell` и `spell-shatter`, затем reaction type `spell-counter`. Перенести discovery/visibility/range/slot-level logic в provider callbacks. Сохранить deferred `dnd5e.preUseActivity`/`midi-qol.preItemRoll`, но заменить локальный socket/dialog/ordering на:

```js
return this.moduleApi.reactionQueueService.resolve({
  triggerId: `spell:${cast.workflowId}`,
  kind: "spell-counter",
  workflowId: cast.workflowId,
  context: this.#serializeCast(cast)
});
```

Сериализовать только caster token/item/activity UUID, level и V/S flags. Удалить 30-секундный timeout и оба старых socket event.

**Step 4: GREEN**

Run: `node --test tests/spell-automation-service.test.mjs tests/reaction-queue-service.test.mjs`

Expected: PASS.

**Step 5: Commit**

```bash
git add scripts/combat/spell-automation-service.js tests/spell-automation-service.test.mjs
git commit -m "refactor: migrate spell counters to global reactions"
```

---

### Task 6: Мигрировать текущие боевые реакции AttackService

**Files:**

- Modify: `scripts/combat/attack-service.js`
- Modify: `scripts/combat/hooks.js`
- Modify: `scripts/main.js`
- Modify: `tests/combat-attack-service.test.mjs`

**Step 1: Добавить падающие provider tests**

Покрыть ровно существующие автоматизированные пути:

- `provoked-attack` — trigger может остаться после удара, поэтому очередь продолжает остальных;
- `parry` — существующий низкоуровневый resolve остаётся execution callback без окна;
- `interception` — существующий low-level damage reduction остаётся execution callback без окна.

Тесты проверяют, что public trigger methods `requestProvokedAttacks`, `requestParry`, `requestInterception` вызывают только `reactionQueueService.resolve`, а методы `resolveProvokedAttack`, `resolveParry`, `resolveInterception` не открывают Dialog и могут применяться provider-ом транзакционно.

**Step 2: RED**

Run: `node --test --test-name-pattern="reaction|provoked|parry|interception" tests/combat-attack-service.test.mjs`

Expected: request methods/providers отсутствуют.

**Step 3: Реализовать provider registration и hooks**

Зарегистрировать kinds `provoked-attack`, `parry`, `interception` и перевести существующие public callers на новые request methods. Сохранить `getReactionState/canUseReaction/refreshReaction/consumeReaction` единственным ledger; удалить прямой consume из low-level methods и передать его общей транзакции.

Не добавлять в этом task новый автоматический `midi-qol.hitsChecked` detector для Parry/Interception: утверждённая спецификация откладывает новые Riposte/Interception triggers в следующий Fighter delivery. Здесь меняется общий transport и транзакция уже вызываемых путей.

Не добавлять auto-trigger девяти приёмам из Global Constraints.

**Step 4: GREEN**

Run: `node --test tests/combat-attack-service.test.mjs tests/reaction-queue-service.test.mjs`

Expected: PASS.

**Step 5: Commit**

```bash
git add scripts/combat/attack-service.js scripts/combat/hooks.js scripts/main.js tests/combat-attack-service.test.mjs
git commit -m "refactor: route combat reactions through shared queue"
```

---

### Task 7: Сгенерировать Rune Knight items, activities, effects и advancement data

**Files:**

- Create: `scripts/data/rune-knight-automation.js`
- Modify: `scripts/data/classes-compendium.js`
- Modify: `tests/classes-compendium.test.mjs`

**Step 1: Написать падающие data-generation tests**

По stable source IDs проверить:

```text
rb_u2n3lx  Rune Carver
rb_11bq5jy Giant's Might
rb_1n0gnxz Runic Shield
rb_1fn5ecu Great Stature
rb_hxk9fo  Master of Runes
rb_1et55f3 Runic Juggernaut
```

И шесть generated rune items: `stone`, `frost`, `cloud`, `fire`, `hill`, `storm`.

Assertions:

- каждое rune item имеет stable automation flag, passive transfer effect, rune DC metadata `8 + @prof + @abilities.con.mod`, uses/recovery;
- Stone/Cloud имеют reaction activity, Frost/Hill/Storm bonus activity, Fire triggered activity;
- Giant's Might bonus activity имеет runtime-managed payment, `uses.max="@prof"`, LR recovery;
- Runic Shield reaction activity имеет `uses.max="@prof"`, LR recovery;
- Rune Carver choices остаются `[2,1,1,1]` на `[3,7,10,15]` и level gates `[4,6,6,6]`;
- smith's tools и Giant language добавлены native advancement-ами без дублей.

**Step 2: RED**

Run: `node --test --test-name-pattern="Rune Knight|rune|Giant's Might|Runic Shield" tests/classes-compendium.test.mjs`

Expected: rune automation module/flags отсутствуют.

**Step 3: Реализовать metadata builders**

Экспортировать immutable metadata и lookup:

```js
export const RUNE_KNIGHT_AUTOMATION_IDS = Object.freeze({ /* stable ids */ });
export function getRuneKnightRuneAutomation(feature) { /* six runes */ }
export function getRuneKnightFeatureAutomation(feature) { /* five runtime features */ }
```

`classes-compendium.js` вызывает lookup до общего `sourceType !== "classFeature"` early return, потому что руны имеют `sourceType="runeKnightRune"`, а основные способности — `subclassFeature`. Использовать существующие `stableHashId`, activity schema, `passiveFeatureEffect`, `buildItemChoiceAdvancement`, `buildItemGrantAdvancement`.

**Step 4: GREEN**

Run: `node --test tests/classes-compendium.test.mjs && node --check scripts/data/rune-knight-automation.js && node --check scripts/data/classes-compendium.js`

Expected: PASS.

**Step 5: Commit**

```bash
git add scripts/data/rune-knight-automation.js scripts/data/classes-compendium.js tests/classes-compendium.test.mjs
git commit -m "feat: generate automated Rune Knight features"
```

---

### Task 8: Реализовать Rune Knight actor repair, uses и rest recharge

**Files:**

- Create: `scripts/combat/rune-knight-automation-service.js`
- Create: `tests/rune-knight-automation-service.test.mjs`
- Modify: `scripts/combat/hooks.js`
- Modify: `scripts/main.js`
- Modify: `tests/main-composition-root.test.mjs`

**Step 1: Написать падающие resource tests**

Проверить:

- level 3–14 rune uses max=1; level 15+ с Master of Runes max=2;
- увеличение max не refill-ит уже потраченные uses;
- dnd5e short rest и long rest восстанавливают все known rune uses;
- Giant's Might и Runic Shield max равен текущему PB и восстанавливается только long rest;
- два одинаковых rest/item hooks дают один update;
- удаление rune item удаляет только эффекты с matching source item UUID;
- repair одного actor не читает `game.actors` и coalesces concurrent repairs в `Map<actorUuid, Promise>`.

**Step 2: RED**

Run: `node --test tests/rune-knight-automation-service.test.mjs`

Expected: service module отсутствует.

**Step 3: Реализовать lifecycle**

Public API:

```js
initialize();
repairActor(actor, { restoreRunes = false, restoreLongRest = false });
handleRestCompleted(actor, result, config);
handleEmbeddedItemChange(item);
handleEmbeddedEffectChange(effect);
```

Считать fighter level по class identifier/item flags, PB через `actor.system.attributes.prof`. Синхронизировать `system.uses.max/spent`, не используя localized names кроме migration fallback. Hook `dnd5e.restCompleted` передаёт short/long semantics; create/update/delete Item/ActiveEffect запускают repair только parent actor. В `main.js` создать/инициализировать `RuneKnightAutomationService` после общего reaction foundation и до `registerCombatHooks`; добавить composition assertions.

**Step 4: GREEN**

Run: `node --test tests/rune-knight-automation-service.test.mjs`

Expected: PASS.

**Step 5: Commit**

```bash
git add scripts/combat/rune-knight-automation-service.js scripts/combat/hooks.js scripts/main.js tests/rune-knight-automation-service.test.mjs tests/main-composition-root.test.mjs
git commit -m "feat: manage Rune Knight resources and recharge"
```

---

### Task 9: Реализовать пассивы и self-activations шести рун

**Files:**

- Modify: `scripts/data/rune-knight-automation.js`
- Modify: `scripts/combat/rune-knight-automation-service.js`
- Modify: `scripts/combat/hooks.js`
- Modify: `tests/classes-compendium.test.mjs`
- Modify: `tests/rune-knight-automation-service.test.mjs`

**Step 1: Добавить падающие effect tests**

Проверить DAE/MIDI keys и durations:

- Stone: Insight advantage, darkvision upgrade 120;
- Frost: Animal Handling/Performance advantage; activation `+2` STR/CON checks+saves, 10 minutes;
- Cloud: Sleight of Hand/Deception advantage;
- Fire: tool proficiency удваивается только для уже proficient tool checks;
- Hill: poison-save advantage только при poison context, poison resistance; activation B/P/S resistance, 1 minute;
- Storm: Arcana advantage и surprise immunity только пока actor не incapacitated; activation prophetic-state, 1 minute.

Проверить, что passive transfer effect активен только пока actor владеет rune item и не зависит от equipped/attuned state.

**Step 2: RED**

Run: `node --test --test-name-pattern="passive|Frost|Hill|Storm|tool|surprise" tests/classes-compendium.test.mjs tests/rune-knight-automation-service.test.mjs`

Expected: DAE changes/runtime roll hooks отсутствуют.

**Step 3: Реализовать эффекты и узкие hooks**

Использовать `flags.midi-qol.advantage.skill.*`, dnd5e sense/damage trait paths и source flags. Для poison-context и tool expertise применять только pre-roll config hooks после O(1) actor feature cache check. Prophetic state хранить как DAE effect, а не service timer.

**Step 4: GREEN**

Run: `node --test tests/classes-compendium.test.mjs tests/rune-knight-automation-service.test.mjs`

Expected: PASS.

**Step 5: Commit**

```bash
git add scripts/data/rune-knight-automation.js scripts/combat/rune-knight-automation-service.js scripts/combat/hooks.js tests/classes-compendium.test.mjs tests/rune-knight-automation-service.test.mjs
git commit -m "feat: automate Rune Knight rune passives"
```

---

### Task 10: Реализовать Stone Rune через общую реакционную очередь

**Files:**

- Modify: `scripts/combat/rune-knight-automation-service.js`
- Modify: `scripts/combat/hooks.js`
- Modify: `tests/rune-knight-automation-service.test.mjs`

**Step 1: Написать падающие Stone tests**

Проверить end-turn trigger, visibility/range 30 ft, WIS save DC, расход rune use + обычной реакции только после успешного apply, timeout без расхода, charmed+incapacitated+speed 0, repeat WIS save в конце каждого хода, expiry 1 minute и cleanup при удалении source rune.

Отдельно instrument `distanceFeet`/`isVisible`: при `capabilityIndex.has("rune-stone") === false` combat-turn hook вызывает их 0 раз.

**Step 2: RED**

Run: `node --test --test-name-pattern="Stone|stone|zero geometry" tests/rune-knight-automation-service.test.mjs`

Expected: Stone provider отсутствует.

**Step 3: Реализовать provider/effect**

В `initialize()` зарегистрировать `rune-stone`. На `combatTurn` разрешить закончившего ход combatant из prior/current turn data, сформировать stable `triggerId`, затем queue. Повторные saves/duration вести DAE source flags + MIDI OverTime (`turn=end`) с runtime fallback; не создавать отдельный interval.

**Step 4: GREEN**

Run: `node --test tests/rune-knight-automation-service.test.mjs tests/reaction-queue-service.test.mjs`

Expected: PASS.

**Step 5: Commit**

```bash
git add scripts/combat/rune-knight-automation-service.js scripts/combat/hooks.js tests/rune-knight-automation-service.test.mjs
git commit -m "feat: automate Stone Rune reactions"
```

---

### Task 11: Реализовать Fire Rune hit, damage и shackles

**Files:**

- Modify: `scripts/data/rune-knight-automation.js`
- Modify: `scripts/combat/rune-knight-automation-service.js`
- Modify: `scripts/combat/hooks.js`
- Modify: `tests/rune-knight-automation-service.test.mjs`

**Step 1: Написать падающие Fire tests**

Проверить только weapon hit; подтверждение до damage finalization; `2d6 fire`; STR save по rune DC; restrained на провале; `2d6 fire` в начале turn; repeat STR save в конце turn; SR/LR recharge; duplicate MIDI/dnd5e hooks не повторяют damage/save/payment.

Fire не расходует обычную реакцию. Для выбора вызвать `reactionQueueService.promptDecision` из Task 3, но не регистрировать Fire как reaction и не вызывать `consumeReaction`.

**Step 2: RED**

Run: `node --test --test-name-pattern="Fire|shackle|weapon hit" tests/rune-knight-automation-service.test.mjs`

Expected: Fire workflow отсутствует.

**Step 3: Реализовать MIDI-first workflow**

На `midi-qol.hitsChecked` отметить eligible hit, применить optional activation, добавить damage term до финального damage roll, затем source-owned DAE restraint. Start/end turn использовать MIDI OverTime с idempotency key `${workflowId}:fire-rune`; native activity остаётся ручным fallback.

**Step 4: GREEN**

Run: `node --test tests/rune-knight-automation-service.test.mjs`

Expected: PASS.

**Step 5: Commit**

```bash
git add scripts/data/rune-knight-automation.js scripts/combat/rune-knight-automation-service.js scripts/combat/hooks.js tests/rune-knight-automation-service.test.mjs
git commit -m "feat: automate Fire Rune shackles"
```

---

### Task 12: Реализовать Cloud Rune и Runic Shield до урона

**Files:**

- Modify: `scripts/combat/rune-knight-automation-service.js`
- Modify: `scripts/combat/hooks.js`
- Modify: `tests/rune-knight-automation-service.test.mjs`

**Step 1: Написать падающие hit-rewrite tests**

Cloud assertions:

- предлагает Rune Knight, видящего исходную цель в 30 ft;
- prompt schema содержит selectable token UUIDs в 30 ft, кроме attacker;
- переносит исходный attack total/effects на новую цель;
- original target удалён из `targets`, `hitTargets`, damage recipients;
- новая цель получает урон только если тот же total попадает по её AC.

Runic Shield assertions:

- видимая hit target в 60 ft;
- `@prof` uses + обычная реакция;
- `workflow.attackRoll.reroll()`/`workflow.setAttackRoll(newRoll)` заменяют обязательный результат;
- `targets/hitTargets` пересчитаны до damage;
- timeout/payment/apply failure ничего не расходуют.

**Step 2: RED**

Run: `node --test --test-name-pattern="Cloud|Runic Shield|redirect|reroll" tests/rune-knight-automation-service.test.mjs`

Expected: providers отсутствуют.

**Step 3: Реализовать providers**

Зарегистрировать `rune-cloud` и `runic-shield`. Hooks вызываются из `midi-qol.hitsChecked` в порядке: Cloud target rewrite → пересчёт hit → Runic Shield reroll → Fire/Giant damage eligibility. Для native fallback оставить activity/chat warning, не симулировать уже завершённое перенаправление.

**Step 4: GREEN**

Run: `node --test tests/rune-knight-automation-service.test.mjs tests/reaction-queue-service.test.mjs`

Expected: PASS.

**Step 5: Commit**

```bash
git add scripts/combat/rune-knight-automation-service.js scripts/combat/hooks.js tests/rune-knight-automation-service.test.mjs
git commit -m "feat: automate Cloud Rune and Runic Shield"
```

---

### Task 13: Реализовать Storm Rune pre-roll reactions

**Files:**

- Modify: `scripts/combat/rune-knight-automation-service.js`
- Modify: `scripts/combat/hooks.js`
- Modify: `tests/rune-knight-automation-service.test.mjs`

**Step 1: Написать падающие Storm tests**

Проверить attack/save/check triggers в 60 ft, активный prophetic-state, выбор advantage/disadvantage, расход только обычной реакции, отсутствие повторного расхода activation use, invalid/finished roll trigger stops queue, duplicate pre-roll hooks применяют mode один раз.

MIDI async hooks должны ждать queue до создания roll. Native `dnd5e.preRollD20Test`, `preRollAttack`, `preRollSavingThrow` применяют уже полученный flag choice; если безопасно приостановить native roll нельзя, показывают ограниченный manual fallback без постфактум изменения результата.

**Step 2: RED**

Run: `node --test --test-name-pattern="Storm|prophetic|advantage|disadvantage" tests/rune-knight-automation-service.test.mjs`

Expected: Storm provider отсутствует.

**Step 3: Реализовать pre-roll provider**

Зарегистрировать `rune-storm`. На принятии добавить один из dnd5e/MIDI mode markers (`advantage=true`, `disadvantage=true`) в ещё не выполненный roll config/workflow. Stable trigger ID включает workflow/test id и actor UUID; завершённый roll делает `isTriggerValid=false`.

**Step 4: GREEN**

Run: `node --test tests/rune-knight-automation-service.test.mjs tests/environment-automation-service.test.mjs`

Expected: PASS.

**Step 5: Commit**

```bash
git add scripts/combat/rune-knight-automation-service.js scripts/combat/hooks.js tests/rune-knight-automation-service.test.mjs
git commit -m "feat: automate Storm Rune roll control"
```

---

### Task 14: Реализовать Giant's Might, dominance fallback и once-per-turn damage

**Files:**

- Modify: `scripts/data/rune-knight-automation.js`
- Modify: `scripts/combat/rune-knight-automation-service.js`
- Modify: `scripts/combat/hooks.js`
- Modify: `tests/rune-knight-automation-service.test.mjs`

**Step 1: Написать падающие Giant's Might tests**

Проверить:

- bonus action, duration 1 minute, uses maximum PB (`@prof`), LR recovery;
- если item use есть — платится он; если нет — предлагается одна dominance die; при отсутствии обоих активация не применяется;
- failed form effect откатывает выбранный ресурс;
- advantage STR checks/saves;
- actor/token увеличивается на одну size category только при свободном пространстве, иначе effect работает без роста footprint;
- первый weapon/unarmed hit в собственный ход получает 1d6, второй не получает;
- duplicate MIDI hooks не дублируют die;
- effect deletion возвращает только сохранённые этой формой size/footprint values.

**Step 2: RED**

Run: `node --test --test-name-pattern="Giant's Might|dominance|once per turn|size" tests/rune-knight-automation-service.test.mjs`

Expected: runtime activation отсутствует.

**Step 3: Реализовать payment/form/damage**

Не использовать native item consumption: service транзакционно обновляет `system.uses.spent` либо общий dominance resource, затем создаёт source-owned DAE form. Хранить исходные token width/height и actor size во флагах самого effect. Turn key: `${combat.id}:${combat.round}:${combat.turn}:${actor.uuid}`; вне боя — `${workflow.id}:${actor.uuid}`.

MIDI damage term добавлять до damage finalization. Native `dnd5e.preRollDamage` использует тот же dedupe key. Optional damage offer и dominance fallback используют `reactionQueueService.promptDecision`, не `resolve`, поэтому обычная реакция не проверяется и не расходуется.

**Step 4: GREEN**

Run: `node --test tests/rune-knight-automation-service.test.mjs tests/fighter-automation-service.test.mjs`

Expected: PASS.

**Step 5: Commit**

```bash
git add scripts/data/rune-knight-automation.js scripts/combat/rune-knight-automation-service.js scripts/combat/hooks.js tests/rune-knight-automation-service.test.mjs
git commit -m "feat: automate Giant's Might form"
```

---

### Task 15: Реализовать Great Stature, Master of Runes и Runic Juggernaut

**Files:**

- Modify: `scripts/combat/rune-knight-automation-service.js`
- Modify: `scripts/combat/attack-service.js`
- Modify: `tests/rune-knight-automation-service.test.mjs`
- Modify: `tests/combat-attack-service.test.mjs`

**Step 1: Написать падающие progression tests**

Проверить:

- Great Stature один раз бросает `3d4`, записывает `flags.rebreya-main.runeKnight.heightIncreaseInches`, создаёт chat message; повторный repair/render не reroll-ит;
- Giant's Might die становится `1d8` с Great Stature;
- Master of Runes max=2 и SR/LR refill всех известных рун;
- Runic Juggernaut die становится `1d10`;
- при форме можно выбрать Huge, если помещается;
- только Huge form даёт melee reach +5;
- attack range calculation читает source-owned `reachBonus`, а cleanup не меняет оружие/чужие эффекты.

**Step 2: RED**

Run: `node --test --test-name-pattern="Great Stature|Master of Runes|Juggernaut|reach" tests/rune-knight-automation-service.test.mjs tests/combat-attack-service.test.mjs`

Expected: progression behavior отсутствует.

**Step 3: Реализовать progression**

Great Stature acquisition guard — persistent actor flag. Master synchronization делегирует Task 8 repair. Juggernaut DAE form выставляет `flags.rebreya-main.runeKnight.reachBonus=5`; `CombatAttackService` добавляет его только для melee reach checks, пока matching form effect активен.

**Step 4: GREEN**

Run: `node --test tests/rune-knight-automation-service.test.mjs tests/combat-attack-service.test.mjs`

Expected: PASS.

**Step 5: Commit**

```bash
git add scripts/combat/rune-knight-automation-service.js scripts/combat/attack-service.js tests/rune-knight-automation-service.test.mjs tests/combat-attack-service.test.mjs
git commit -m "feat: complete Rune Knight progression"
```

---

### Task 16: Зафиксировать глобальность reaction service и performance contract

**Files:**

- Create: `tests/reaction-dialog-ownership.test.mjs`
- Modify: `tests/reaction-capability-index.test.mjs`
- Modify: `tests/reaction-queue-service.test.mjs`
- Modify: `tests/rune-knight-automation-service.test.mjs`
- Modify: `README.md`

**Step 1: Написать source-level guard и hot-path tests**

Guard читает `scripts/combat/*.js` и разрешает `DialogV2.wait` для reaction prompt только в `reaction-queue-service.js`. Нереакционные dialogs в `attack-roll-boost-service.js`, Fighter/Sorcerer остаются допустимыми по явному allowlist; `spell-automation-service.js` и Rune/Attack reaction paths не входят в allowlist.

Performance assertions:

- no `setInterval`/`requestAnimationFrame` в двух новых сервисах;
- no `game.actors` в reaction/rune hot paths;
- 1000 пустых `has(kind)` не вызывают provider/geometry;
- duplicate MIDI + dnd5e delivery создаёт один prompt/payment/damage/effect;
- TTL cleanup сокращает completed map до заданного bound;
- один активный queue имеет не более одного dialog и одного 10-second timer.

**Step 2: RED**

Run: `node --test tests/reaction-dialog-ownership.test.mjs tests/reaction-capability-index.test.mjs tests/reaction-queue-service.test.mjs tests/rune-knight-automation-service.test.mjs`

Expected: guard/metrics сначала выявляют оставшиеся нарушения.

**Step 3: Удалить нарушения и обновить README**

README automation table должен описывать `ReactionQueueService`, `ReactionCapabilityIndex`, Rune Knight hooks/resources, точный 10-second timeout, active-GM/owner routing, initiative/random ordering и отсутствие polling.

**Step 4: GREEN**

Run: `node --test tests/reaction-dialog-ownership.test.mjs tests/reaction-capability-index.test.mjs tests/reaction-queue-service.test.mjs tests/rune-knight-automation-service.test.mjs`

Expected: PASS.

**Step 5: Commit**

```bash
git add tests/reaction-dialog-ownership.test.mjs tests/reaction-capability-index.test.mjs tests/reaction-queue-service.test.mjs tests/rune-knight-automation-service.test.mjs README.md
git commit -m "test: enforce global reaction performance contract"
```

---

### Task 17: Version entrypoint, полная проверка, diff audit и push

**Files:**

- Modify: `module.json`
- Create: `scripts/main-1.4.98.js`
- Modify: `tests/module-manifest.test.mjs`

**Step 1: Написать падающий manifest test**

Проверить `module.json.version === "1.4.98"`, единственный esmodule `scripts/main-1.4.98.js` и forwarder import `./main.js?v=1.4.98-global-reactions-rune-knight`.

**Step 2: RED**

Run: `node --test tests/module-manifest.test.mjs`

Expected: manifest ещё указывает 1.4.97.

**Step 3: Обновить versioned entrypoint**

Создать:

```js
// @rebreya-role active-version-forwarder
import "./main.js?v=1.4.98-global-reactions-rune-knight";
```

Обновить `module.json`, не удаляя исторические forwarders.

**Step 4: Запустить focused verification**

Run:

```bash
node --test tests/reaction-capability-index.test.mjs tests/reaction-queue-service.test.mjs tests/reaction-dialog-ownership.test.mjs tests/spell-automation-service.test.mjs tests/combat-attack-service.test.mjs tests/classes-compendium.test.mjs tests/rune-knight-automation-service.test.mjs tests/main-composition-root.test.mjs tests/module-manifest.test.mjs
```

Expected: PASS, 0 failed.

**Step 5: Проверить синтаксис всех изменённых modules**

Run:

```bash
node --check scripts/combat/reaction-capability-index.js
node --check scripts/combat/reaction-queue-service.js
node --check scripts/combat/rune-knight-automation-service.js
node --check scripts/combat/spell-automation-service.js
node --check scripts/combat/attack-service.js
node --check scripts/combat/hooks.js
node --check scripts/data/rune-knight-automation.js
node --check scripts/data/classes-compendium.js
node --check scripts/main.js
node --check scripts/main-1.4.98.js
```

Expected: каждый процесс exit 0.

**Step 6: Запустить полный suite**

Run: `node --test tests/*.test.mjs`

Expected: PASS, 0 failed.

**Step 7: Проверить diff и отсутствие мусора**

Run:

```bash
git diff --check
git status --short
git diff --stat origin/lich_branch...HEAD
git diff origin/lich_branch...HEAD -- scripts/combat scripts/data scripts/main.js module.json tests README.md docs/superpowers
```

Expected: нет whitespace errors; только файлы этого плана и ранее утверждённая spec/plan документация; нет секретов, debug logs, generated coverage или чужих файлов.

**Step 8: Финальный commit**

```bash
git add module.json scripts/main-1.4.98.js tests/module-manifest.test.mjs
git commit -m "feat: release global reactions and Rune Knight automation"
```

Если после предыдущих task commits остались исправления только от verification, добавить отдельный `fix: harden Rune Knight reaction workflows`, а не amend опубликованной истории.

**Step 9: Сверить main и push без force**

Run:

```bash
git fetch origin --prune
git merge-base --is-ancestor origin/main HEAD
git status --short --branch
git push -u origin lich_branch
```

Expected: main является ancestor, worktree clean, обычный push успешен. Не использовать `--force` или `--force-with-lease`.

---

## Spec Coverage Audit

- Общая очередь, 10 секунд, initiative/random, trigger continuation: Tasks 2–3.
- Active-GM, owner prompt, authentication, rollback, dedupe: Tasks 2–4.
- Event-driven index и отсутствие нагрузки: Tasks 1, 4, 16.
- Миграция существующих Counterspell/Spell Shatter/provoked/parry/interception: Tasks 5–6.
- Rune item data, always-on passives, recharge, Master of Runes: Tasks 7–9, 15.
- Stone/Frost/Cloud/Fire/Hill/Storm: Tasks 9–13.
- Giant's Might PB uses, dominance fallback, size/damage: Task 14.
- Runic Shield, Great Stature, Runic Juggernaut: Tasks 12, 15.
- MIDI-QOL/DAE primary и native fallback: Tasks 9–15.
- Source-level global dialog ownership, full tests, diff, version, push: Tasks 16–17.
- Отложенные Extra Feat, Eldritch Knight, Riposte, Great Weapon Fighting, новые Interception triggers и высокоуровневые Fighter features не потеряны: они явно остаются следующим delivery после этого foundation и не смешиваются с текущим scope.
