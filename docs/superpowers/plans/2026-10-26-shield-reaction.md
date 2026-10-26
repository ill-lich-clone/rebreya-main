# Shield Reaction Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans or superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Создать мировую копию «Щита», которая через существующую очередь предлагает реакцию только при полезном попадании либо против CPR Magic Missile.

**Architecture:** Сохранить native dnd5e/MIDI spell use и `ReactionQueueService.resolveManagedReaction`. Расширить `MidiReactionAdapter` адресным фильтром, а CPR Magic Missile связать с той же managed session на клиенте владельца через отдельный небольшой adapter; исходные сторонние файлы не изменять. Копирование карточки принадлежит data-сервису, сериализованному `WorldMutationCoordinator`, с GM-only API из composition root.

**Tech Stack:** Foundry 13, installed dnd5e 5.2.5, Midi-QOL 13.0.61, CPR 1.5.44, JavaScript ESM, Node test runner.

**Spec:** `docs/superpowers/specs/2026-10-26-shield-reaction-design.md` (утверждена).

## Global Constraints

- Работать только в `lich_branch`; обязательный Git preflight по AGENTS.md, без force push и без stage чужих файлов.
- Marker: `flags.rebreya-main.shieldReaction.version = 1`; имя «Щит» не используется для распознавания.
- CPR source: `Compendium.chris-premades.CPRSpells.Item.RpVLINL74RjPDkC4`; SRD description fallback: `Compendium.dnd5e.spells.Item.z1mx84ONwkXKUZd7`.
- При КД 10 результаты 9, 15 и 20 не вызывают предложение, 10–14 вызывают; крит исключён. Для конкретной атаки учитывать фактические target modifiers/cover, не только Actor AC.
- Не менять глобальный `ignoreSpellReactionRestriction`, исходные компендиумы, карточки существующих персонажей, authored formulas/count/consumption и чужие реакции.
- Один существующий queue/ledger owner. Штатный use определяет расход ресурсов и применение эффекта; source effects и их embedded IDs/reference links сохраняются.
- Runtime release: следующий patch после актуального manifest (baseline 1.5.7 → 1.5.8), новый `scripts/main-<version>.js` только с `import "./main.js";`, согласованные cache keys.

## Review Focus

1. Linked и synthetic Actor с несколькими Token: Shield проверяется для точной текущей цели; чужой Token не может подставить более подходящую КД.
2. Cover, ignored cover, fixed flanking, active defence и target-specific attack bonus: проверка полезности соответствует MIDI; формулы/кости не бросаются повторно ради фильтра.
3. Отмена native resource dialog, исключение use, late click и два клика: очередь завершает выбор без лишнего расхода и зависшей applying-reservation.
4. CPR remote dialog на владельце, а атакующий — другой игрок: begin/commit выполняются с подлинной identity владельца; весь native use остаётся внутри разрешённой managed session.
5. Повторный импорт, повреждённый source и отсутствующий CPR: существующая авторская карточка не перезаписывается; не возникает частичного или дублирующего world Item.

---

## Task 1: Сохранная мировая копия и явный GM import

**Files:** Create `scripts/data/shield-spell-item.js`, `tests/shield-spell-item.test.mjs`; modify узкие import/API ranges `scripts/main.js`.

**Interfaces:**
- `buildShieldSpellItem(sourceData, { description = "" } = {}) -> ItemData`: глубокая копия с marker, русским именем и description fallback; root `_id`/`folder` очищаются, embedded effect/activity IDs и их ссылки сохраняются.
- `ensureWorldShieldSpell({ game, coordinator, resolveUuid, itemClass }) -> Promise<Item>`: active-GM guard, поиск точного marker, повторная проверка внутри `coordinator.run("shield-world-item", ...)`, source resolution, один `itemClass.create(data)`; существующий Item возвращается без update.
- Public `game.rebreyaMain.importShieldSpell() -> Promise<Item>` и тот же method в существующем module API делегируют этому owner; нет массовой actor migration и автоматического overwriting при reload.

- [x] **1. RED:** добавить `shield-spell-item.test.mjs`: deep equality всего source за вычетом явных root изменений; не мутировать source; сохранить кастомные formulas, slots/scaling, item-level uses, embedded effect references, DAE/CPR flags и заполненное описание; пустому добавить SRD text. Два одновременных импорта дают один create, существующий marker с авторскими изменениями не обновляется, source отсутствует/повреждён и player/неактивный GM дают понятную ошибку до записи.
- [x] **2. Выполнить** `node --test tests/shield-spell-item.test.mjs`; подтвердить ожидаемый FAIL отсутствующего export/поведения.
- [x] **3. Реализовать** два interface выше и composition API, переиспользуя существующие active-GM helper и coordinator. Не создавать settings, repository framework или socket route для недоступного игрокам GM import.
- [x] **4. GREEN:** выполнить тот же focused test; проверить, что данные позволяют исходной activity найти свой эффект. Product commit отложен до Task 4 с обязательной новой версией.

## Task 2: Полезность Shield до native reaction window

**Files:** Modify `scripts/integrations/midi-reaction-adapter.js`, `scripts/combat/hooks.js`, `tests/midi-reaction-adapter.test.mjs`; create `tests/shield-reaction-hooks.test.mjs`.

**Interfaces:**
- `MidiReactionAdapter.filterReactions(reactions, options, triggerType, reactionActivityList) -> Promise<void>`: entry point зарегистрированного один раз `midi-qol.ReactionFilter`; работает только с marked Shield, не отменяет общий hook для других реакций.
- `MidiReactionAdapter.getShieldAttackContext(workflow, target) -> Promise<{ workflowId, tokenUuid, attackTotal, effectiveAC, isCritical, isFumble } | null>`: narrow compatibility boundary installed MIDI 13.0.61. Использовать его текущие `targetACModifiers`, target descriptors, публичные `computeCoverBonus/createConditionData/evalCondition` и уже evaluated attack bonuses; исходные броски не повторять.
- `MidiReactionAdapter.canOfferShield(activity, context) -> Promise<boolean>`: marker, native use availability/preparation, отсутствие действующего source Shield и условие `!isCritical && !isFumble && effectiveAC <= attackTotal && attackTotal < effectiveAC + 5` для hit trigger.
- Исходный hook сохраняет target-indexed contexts в `options.rebreyaShieldReaction`; `choose(data)` выбирает ровно `data.tokenUuid` и повторно проверяет живую доступность/КД до очереди. На удалённом повторном `ReactionFilter` без live workflow использовать только уже сформированный exact-token context; не искать workflow по совпавшему локальному ID и не брать произвольный Token одного Actor.

- [x] **1. RED:** matrix КД 10 × 9/10/14/15/20, critical/fumble, attacked/missed/preAttack, ignored restrictions on/off; marked и unmarked Shield; другая reaction остаётся. Проверить: active Shield, exhausted reaction, prepared/slots/pact/innate/item-use availability; native cancellation ничего не расходует.
- [x] **2. RED Review Focus 1–2:** одна атака против нескольких целей и двух linked Token одного Actor с разным cover; synthetic actor identity; status/module/ignored/full cover; фиксированное flanking, `targetACModifiers`, реально evaluated attack bonus. Счётчик dice evaluations не увеличивается. Использовать source-derived expected values installed MIDI, не вычислять expected тем же helper, который тестируется.
- [x] **3. Выполнить** `node --test tests/midi-reaction-adapter.test.mjs tests/shield-reaction-hooks.test.mjs`; подтвердить FAIL новых требований, не ослабляя существующие native formula/counter/callback regressions.
- [x] **4. Реализовать** указанные методы и единственную регистрацию hook внутри имеющегося блока `moduleApi.midiReactionAdapter`. Фильтр выполняется до `_beginReactionMessage`, поэтому бесполезная атака не создаёт ни окна, ни карточки выбора. Native callback, condition и ресурсы исполняются captured original handler.
- [x] **5. GREEN:** повторить affected tests; дополнительно `node --test tests/managed-reaction-session.test.mjs tests/reaction-capability-index.test.mjs tests/reaction-chat-lifecycle.test.mjs` — 0 failed. Не переписывать shared queue, session authority и ledger для решения адресного фильтра.

## Task 3: CPR Magic Missile внутри той же очереди

**Files:** Create `scripts/integrations/cpr-shield-reaction-adapter.js`, `tests/cpr-shield-reaction-adapter.test.mjs`; modify initialization `scripts/integrations/midi-reaction-adapter.js`.

**Evidence:** CPR `magicMissile.js` после распределения ненулевых bolts вызывает `selectDocumentDialog(..., "CHRISPREMADES.Macros.MagicMissile.Shield", ...)`. На owner client это проходит через публичный `chrisPremades.DialogApp.dialog`; выбранный Item затем применяется через `MidiQOL.completeItemUse` локально или из CPR socket `rollItem`. Проверка эффекта `shield` и обнуление урона уже принадлежат CPR.

**Interfaces:**
- `CprShieldReactionAdapter(moduleApi, options = {})`, `initialize() -> boolean`: idempotent optional обёртки `chrisPremades.DialogApp.dialog` и `MidiQOL.completeItemUse`; чужие CPR dialogs/use полностью делегируются original.
- `routeDialog(args) -> Promise<originalDialogResult>`: распознать точный magic-missile shield content и marked owned Items из button IDs; запустить `resolveManagedReaction({kind:"midi-native", triggerId, candidate:{actorUuid,activityUuids}}, execute)` на клиенте владельца. Внутри session вызвать original dialog, native result вернуть CPR только после `controls.commit({activityUuid})`; закрытие/timeout/None возвращают штатную отмену.
- `routeItemUse(item, config, options) -> Promise<originalUseResult>`: только для точного выбранного Item ожидающей CPR session выполнить original use один раз и завершить deferred execute результатом native use; await queue finalization до возврата useResult CPR. Между dialog и native use applying-reservation остаётся живой. При отказе/ошибке не возвращать фиктивный successful UUID.
- Небольшая bounded map pending sessions с точным Actor/Item key хранится только в adapter; deadline выбора и авторизация остаются у общей очереди. Отсутствующий CPR — no-op, несовместимый установленный API — явная диагностическая ошибка.

- [x] **1. RED:** CPR flow `select → remote/local completeItemUse → effect check`: ровно один original dialog, один native use, один shared queue begin/commit/finish; исходный урон блокируется только при реально созданном `shield` effect. Already-active Shield обходится без нового выбора. Нулевая доля bolts не вызывает этот dialog; обычный CPR dialog или unmarked-only выбор не перехватывается.
- [x] **2. RED Review Focus 3–4:** атакующий игрок не владеет целью, но owner client проходит permission; source client не подменяет owner. Decline/None/close/timeout/late click/два клика; native resource cancellation/throw; отсутствие active GM; duplicate init; unrelated `completeItemUse`/nested spell во время pending Shield. Без лишнего дебита, зависшего lease и второго prompt.
- [x] **3. Выполнить** `node --test tests/cpr-shield-reaction-adapter.test.mjs`; подтвердить ожидаемый FAIL нового adapter.
- [x] **4. Реализовать** указанные interfaces, initialization через существующий MIDI adapter; native spell/CPR macro и vendor files не переписывать. Сохранять original arguments, return values, resource dialogs и effect identity.
- [x] **5. GREEN:** выполнить CPR focused suite и MIDI/session suites из Task 2. Если source compatibility не позволяет сохранить указанные identity/finish guarantees, остановиться с конкретным несовпадением исходника; не заменять это обходом ownership или двойным use.

## Task 4: Документация, выпуск и импорт в живой мир

**Files:** Modify `docs/function-passport.md` (раздел 16, native MIDI + world import), `README.md` (public API/Shield), `module.json`, task spec/plan, imports изменённых owners в `scripts/main.js`; create `scripts/main-1.5.8.js` при неизменном baseline, иначе следующий patch.

- [x] **1. Обновить** паспорт сигнатурами/data flow/ограничениями/тестами всех добавленных методов. README объясняет GM `importShieldSpell()`, marker transfer, намеренный фильтр, CPR requirement и отсутствие автоматической замены actor copies.
- [x] **2. Поднять версию** manifest, esmodules и scoped runtime cache keys согласованно; новые stateful importers используют один canonical URL. Старые unrelated forwarders не переписывать. Выполнить `node --test tests/module-manifest.test.mjs` и `git diff --check`.
- [x] **3. Выполнить один полный проход** `node --test tests/*.test.mjs`; проверить `node --check` всех tracked JS/MJS плюс новых файлов; tracked JSON разобрать `Get-Content -Raw -Encoding UTF8 ... | ConvertFrom-Json`. Сохранить passed/failed/skipped counts и реальные ошибки; после исправлений повторять affected checks.
- [ ] **4. Live import/QA:** повторно проверить доступность Foundry GM через имеющийся bridge/browser; записать runtime versions. Вызвать `game.rebreyaMain.importShieldSpell()`, записать возвращённый world UUID, повторить и подтвердить тот же UUID и одну карточку. Проверить только disposable fixture Actor/Token: полезное/бесполезное попадание, крит/укрытие, другой owner, штатный выбор/отмена ресурса, одна реакция, начало следующего хода, CPR Magic Missile, reload/idempotence. Убрать fixture документы; итоговую мировую карточку сохранить. При отсутствии подключения не писать world LevelDB напрямую и не обозначать импорт/QA выполненными.
- [x] **5. Final review:** сравнить diff со spec, особенно actual effective AC, источники resource расхода, source effect references, CPR owner handoff и bounded pending state. Рекомендуемое исполнение Native; независимый финальный reviewer — Codex согласно правилам проекта, без мелкой параллельности.
- [x] **6. Git gate:** актуальный preflight; `git diff --check`, `git diff --stat`, содержательный scoped diff; explicit stage только task files; meaningful commit и `git push -u origin lich_branch`, без force. Отчёт: commit/version, spec/plan paths, команды/counts, world Item UUID либо конкретный незавершённый import и необходимое подключение.

## Self-review и review gate

- Spec coverage: world/source preservation → Task 1; useful-only native prompt и exact-target AC → Task 2; source Magic Missile через общую очередь → Task 3; регрессии/resources/reload/docs/version/Git/live evidence → Task 4.
- Все пять Review Focus привязаны к RED tests в Tasks 1–3. Existing native formula/counter tests остаются без ослабления.
- Исходные полные карточки берутся из установленного pack во время GM import; нет сетевого runtime fetch или нового asset scan.
- Спецификация и этот план утверждены пользователем; выбран **Native** через `executing-plans`.

## Результаты исполнения

### Обязательное исправление назначения карточки

Прямое уточнение пользователя утверждает включение карточки в существующий компендиум; исполнение продолжается Native без повторного выбора дизайна.

- [x] RED: `tests/spells-compendium.test.mjs` проверяет Shield в реальном JSON-каталоге, разрешение его CPR pack, сохранение native данных и маркера, SRD fallback, effects-aware signature и два sync без дубликатов/изменения остальных spell routes.
- [x] GREEN: добавить точную Shield source definition в `data/rebreya-spells-v01.json`; расширить `normalizedSourceDefinition`, `buildManagedSpellEntry(definition,source,options)` и `SpellsCompendiumService.sync()` для per-entry CPR source + source description fallback, переиспользовать `buildShieldSpellItem`. Не создавать второй компендиум, новый сервис либо новый способ расхода.
- [x] Выпуск 1.5.9: новая версия/forwarder, scoped spells-compendium import, профильная документация и release expectations. Focused tests → полный прогон Node tests, tracked syntax/JSON/diff; scoped commit/push в `lich_branch`.

Подтверждение уточнения: три новые регрессии сначала упали; после реализации focused **66/66**, полный `node --test tests/*.test.mjs` — **5058 tests / 5057 passed / 0 failed / 1 skipped**. Синтаксис **1074 JS/MJS / 0 failed**, JSON **65 / 0 failed**. В авторизованном active-GM сеансе CODEX (Foundry 13.351 / dnd5e 5.2.5 / MIDI 13.0.61 / CPR 1.5.44) перезагружен клиент и выполнен штатный sync. Карточка **Compendium.world.rebreya-spells.Item.DXprZvUhDCRqHdzg**, имя «Щит», description length 223, source effect +5, `turnStartSource`, CPR identifier `shield`, module marker version 1, native `spellSlot:true`. Повторный sync: **unchanged 3, created 0, updated 0, deleted 0**, Shield count 1 и прежний ID; Counterspell/Melf сохранены. Компендиум и карточка открыты для пользователя. Это подтверждение поставки карточки; полная live combat/expiry/player матрица остаётся отдельным непроверенным пунктом предыдущего этапа.

- Tasks 1–3 реализованы с RED→GREEN: source-preserving GM import; фильтр native reactions; CPR selector/native-use handoff. Общая очередь/ledger и vendor files сохранены.
- Независимый Codex-review (GPT-6 Astra high) нашёл два дефекта: ID ambiguity synthetic Actors и Active Defence. Оба воспроизведены тестами до исправления и устранены: original CPR UUID mode и готовый exact-target defence roll. Повторный review не запускался; fixed regressions + полный прогон проверяют исправления.
- Полный `node --test tests/*.test.mjs`: **5055 tests, 5054 passed, 0 failed, 1 skipped**. Первый прогон выявил два старых release/cache ожидания; они обновлены без ослабления поведенческих проверок, полный повтор зелёный.
- `node --check`: **1073 JS/MJS, 0 failed**; после review дополнительно перепроверены два изменённых runtime adapter. Tracked JSON через `ConvertFrom-Json`: **65, 0 failed**. `git diff --check` прошёл.
- Runtime release **1.5.8**; новый тонкий forwarder и согласованные imports изменённых owners. Функциональный паспорт вынесен в `docs/shield-reaction-function-passport.md`, раздел 16 основного паспорта маршрутизирует к нему.
- Foundry **13.351**, мир `testovyj3` («Ребрея мейн») запущен установленным Node entrypoint с прежним dataPath, без редактирования options/LevelDB или удаления lockfiles. Страница join доступна. Авторизация CODEX с пустым паролем отклонена; пользователь запрошен войти под GM. **Мировая карточка ещё не создана; live effect expiry/slots/player QA не подтверждены.**
- Решения: сохранён существующий чистый checkout `lich_branch` по правилам проекта; native MIDI optional-AC stacking не переписывался (reviewer снял своё замечание после проверки source recomputation). Введённые UUID/defence refinements выполняют уже утверждённые requirements, scope не расширен.
