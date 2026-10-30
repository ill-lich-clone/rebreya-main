# Ammunition Magazine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Выбирать боеприпасы и заряжать упорядоченные однородные группы 1/3/6 во флаг оружия с точным расходом, возвратом и бонусом один раз на атаку.

**Architecture:** Чистые правила состава и проекции урона находятся в `scripts/combat/ammunition-magazine.js`. Канонический `CombatAttackService` выполняет операции и связывает snapshot с конкретной атакой; ApplicationV2 хранит только черновик. Существующие native Documents, hooks и владельцы пересборки сохраняются.

**Tech Stack:** JavaScript ESM, Foundry 13, dnd5e 5.2.5, Handlebars, Node test runner; без новых зависимостей.

**Spec:** `docs/superpowers/specs/2026-10-30-ammunition-magazine-design.md`, утверждена пользователем 2026-10-30, включая однократный бонус и ручные сложные эффекты.

## Global Constraints

- Только `lich_branch`; текущая чистая рабочая копия является установленным модулем и используется без нового worktree.
- Магазин во флаге оружия; соседние группы могут различаться, внутри атаки смешение запрещено.
- Полуавтомат — ровно 3, автомат — ровно 6; бонус боеприпаса один раз к атаке.
- Черновик, пресеты и заполнение до подтверждения не записывают Documents.
- Сохраняются авторские формулы/effects/flags, осечки, имплант, исходная/модифицированная вместимость, native права, Repeating Shot и существующие результаты API.
- Сложные спецэффекты показываются явно как ручные; runtime не парсит правила из prose.
- Перед финальным commit: focused/full tests, JS/JSON checks, live QA где доступно, паспорт/README, версия и forwarder, push без force.

## Review Focus

1. Пропавший исходный стак: возврат и поздний урон используют сохранённый snapshot, не похожий каталожный патрон (Task 2/4).
2. Частичный area fire оставляет неоднородный префикс: следующая атака блокируется без пропуска патронов (Task 1/2).
3. Два окна/повтор hook/неоднозначная запись: повтор не дублирует возврат или расход (Task 2/4).
4. Старый имплант и legacy магазин: количество не теряется и разновидность не угадывается (Task 1/2).
5. Смена магазина между атакой и уроном: старая карточка продолжает использовать свой snapshot (Task 4).

---

### Task 1: Pure magazine rules and ammunition projection

**Files:** Create `scripts/combat/ammunition-magazine.js`; Test `tests/ammunition-magazine.test.mjs`.

**Interfaces:** Produces `captureAmmunition(item) -> {key,data}`, `magazineRounds(state) -> {rounds,sources}`, `validateMagazine(rounds,groupSize,capacity) -> void`, `getAmmunitionDamage(data) -> {parts,type,dieStep,manual}`, `applyAmmunitionDamage(config,data) -> void`. Unknown historical rounds use a reserved legacy key, preserving count; snapshot identity excludes quantity/container/document metadata, preserves mechanics. Existing flag scalar fields remain owned by CombatAttackService.

- [x] Write failing tests: same mechanics across stack quantities share identity; changed effects differ; legacy `current:5` gives five unknown rounds; semi `[a,a,a,b,b,b]` accepted and `[a,b,a]` rejected; overcapacity/gaps/malformed data rejected; partial prefix after area fire blocks; fire/frost add once and authored native damage wins without duplicate source projection.
- [x] Run `node --test tests/ammunition-magazine.test.mjs`; expect failures for missing behavior.
- [x] Implement the interfaces with detached source data, strict validation and explicit stable-ID damage rules.
- [x] Run the same command; expect all pass. Update ledger; commit together with consumer once runtime version is synchronized.

### Task 2: Canonical load, unload, reservoir and shot state

**Files:** Modify `scripts/combat/attack-service.js`; Test `tests/combat-attack-service.test.mjs`.

**Interfaces:** Consumes Task 1. Produces `getMagazineEditorData(actor,weapon) -> plain draft`, `commitMagazine(actor,weapon,draft) -> Promise<result>`, `unloadFirearm(actorOrItem,weaponOrId?,options?) -> Promise<result>`. Existing `reloadFirearm` accepts optional explicit draft while retaining programmatic auto-fill and result fields. All snapshots originate from actual owned sources, never client-supplied Item data.

- [x] Write failing consumer tests: explicit mixed neighboring groups reload with one confirmation; invalid group/stale quantity has zero writes; unload returns exact kinds; resubmitting a stale draft is rejected; missing sources refund exact snapshots; write-then-throw observes this action’s actual result; legacy/implant counts remain; auto-fill `2 normal reservoir + fire inventory` refuses without spending.
- [x] Run `node --test tests/combat-attack-service.test.mjs`; confirm new tests fail for the intended behavior.
- [x] Extend existing state read/set/consume to preserve ordered source keys, derive `current`, enforce fixed 3/6 before all attack paths, slice consumed prefix, and preserve unchanged-write optimization. Use direct native OWNER writes; no custom socket, world journal, persistent receipt, recovery framework or shared queue. The editor disables submission while saving. Verify observed writes in memory and compensate only this action’s unchanged writes; create missing refund targets at zero quantity before the final batch.
- [x] Extend reservoir snapshots and mechanical identity checks; legacy source remains unknown. Preserve exact old result fields and compatible reload priority. Extend `planWeaponAmmoReconfiguration` to refund exact affected tail/full sequence using existing batch owner.
- [x] Run consumer tests plus `tests/weapon-mod-mutations.test.mjs`; expect all pass, with only explicitly approved 3/6 contract expectations updated.

### Task 3: Local draft editor and native activities

**Files:** Create `scripts/ui/ammunition-magazine-app.js`, `templates/ammunition-magazine.hbs`; Modify `styles/main.css`, `scripts/data/gear-compendium.js`, `scripts/combat/attack-service.js`; Test `tests/ammunition-magazine-app.test.mjs`, `tests/gear-compendium.test.mjs`.

**Interfaces:** `AmmunitionMagazineApp(service,actor,weapon,options={})`; consumes Task 2 public editor data/commit/unload. `CombatAttackService.openMagazineEditor(actor,weapon)` dynamically imports the UI and returns one app per weapon. Utility reload opens it; unload activity delegates to canonical service.

- [x] Write failing behavior tests for draft fill/reorder/preset/cancel with zero writes, homogeneous groups 3/6 and partial tail; confirm button submits exact shown rounds; shortage retains draft; repeated open reuses one editor.
- [x] Run new app tests and gear tests; confirm failures.
- [x] Implement scoped ApplicationV2 with ordered slots, compatible stock, fill-remaining, preset naming/save/delete staged until load, and prominent confirmed last-pattern action. Bind native change/click events once per render; keep errors visible and primary button disabled while submitting.
- [x] Add managed unload utility; preserve current authored activities, managed repair and property removal/restoration. Scope CSS to the app.
- [x] Run app/gear/consumer tests; expect pass.

### Task 4: Ordinary selection and per-attack damage context

**Files:** Modify `scripts/combat/attack-service.js`, `scripts/combat/hooks.js`, `scripts/data/ammunition-compatibility.js`; Test `tests/combat-attack-service.test.mjs`, `tests/environment-automation-service.test.mjs`, `tests/ammunition-magazine.test.mjs`.

**Interfaces:** Consumes Task 1/2 source snapshots. Native roll/message and MIDI workflow carry `flags.rebreya-main.ammunitionShot`; damage resolves its originating attack, never current weapon state. Uses existing native roll configuration and amount consumption; no second inventory debit for firearms.

- [x] Write failing tests for required ordinary selection/quick roll cancellation, Repeating Shot exception, immutable shot snapshot, duplicate hooks, two sequential cards, fire/frost damage once, base-only type/die changes, and manual-effect notice.
- [x] Run affected focused tests; confirm failures.
- [x] Integrate selected snapshot before confirmed roll, persist it to originating card and workflow, and apply Task 1 projection before ordinary combat damage modifiers. Explicitly force ordinary ammo selection through native dialog when needed and include special-profile compatibility without replacing native family restrictions.
- [x] Validate area-fire prefixes using actual preserved consumption amount. Keep base formulas and charge/misfire timing unchanged.
- [x] Run all focused tests; expect pass.

### Task 5: Live QA, documentation, release and review

**Files:** Modify `docs/function-passport.md`, `README.md`, `module.json`, versioned forwarder and affected import query versions; update this plan completion boxes and spec approval status.

- [x] Check spec-to-task coverage, then exercise actual installed Foundry UI with detached disposable Actor/Item fixtures and no production-world writes: open/cancel, narrow layout, groups, fill, shortage, persistence boundaries and player permission. Record exact versions and console results; if authenticated world is unavailable report the exact limitation.
- [x] Run `node --test tests/*.test.mjs` once after runtime changes; record passed/failed and actual errors. Run tracked JS/MJS `node --check`, JSON parsing and `git diff --check`. Repeat affected checks after fixes.
- [x] Document all new/changed methods, data flow, persistence limitations, manual effects, public UI/API entry points and regression tests. Bump manifest/forwarder and all affected canonical import URLs consistently.
- [x] Fresh whole-change reviewer checks spec, plan, diff and evidence; fix important findings with failing regression tests before code.
- [x] Review substantive diff, commit task files explicitly, `git push -u origin lich_branch`, verify clean synchronized status. Report spec/plan paths, commit, test counts and live limitations.

## Уточнение по истории проекта (2026-10-30)

Прочитаны чат «Исправить торговлю и инвентарь» и коммиты ba33e1d4/082fbc58. Их native OWNER policy обязательна: обычная конкуренция Foundry принята; новый GM/socket маршрут, durable receipts, recovery и общая очередь для зарядки/разрядки не нужны. Удалены из реализации. Проверка OWNER с throwing socket/journal/coordinator закрепляет прямой native batch. Затраты на несколько native Documents не являются основанием возвращать привилегированную обвязку.

## Execution and verification

Implemented in the existing CombatAttackService and local ApplicationV2 draft. The approved native OWNER policy from ba33e1d4/082fbc58 is enforced: no new custom socket route, persistent mutation receipt, recovery framework or shared queue. Native capability tests make socket/journal/coordinator calls throw and assert one normal embedded Item batch with no preliminary flag mutation. Ordinary Foundry concurrency is accepted.

Regression failures were observed before implementation/correction. Existing quantity, formulas, implant reservoir, misfire and weapon-mod refund contracts remain tested; the deliberate burst contract change is exactly 3/6 homogeneous rounds. Final independent review findings were fixed with focused RED/GREEN tests: partial native cancellation, cancelled Actor reservoir write, snapshot compatibility, scoped nested-flag replacement, and compensation limited to attempted own writes. Live tests additionally exposed and pinned the preset-name blur event and preservation of native dnd5e roll-data class references.

Final current-tree verification: `node --test tests/*.test.mjs` — 5314 passed, 0 failed, 1 skipped (5315 total). Affected pure/editor/combat suite after the last functional fixes — 122 passed, 0 failed. Tracked `node --check` — 1119 JS/MJS passed; tracked JSON parsing — 65 passed; affected syntax rerun after final functional fixes. `git diff --check` passed. Earlier full-run failures were 11 stale version/cache expectations, corrected to the actual 1.5.26 runtime URLs; no production behavior assertions were dropped.

Live acceptance: Foundry 13.351, dnd5e 5.2.5, test world testovyj3, authenticated CODEX GM. On disposable native Actor/Items: staged mixed groups left quantities and flag unchanged; confirmation spent exactly 3 fire + 3 cold; preset persisted only on confirmation; successive semi attacks consumed fire3 then cold3. Late damage from the earlier fire card with the magazine now empty produced native 1d12 piercing + 1d6 fire, once per attack. Last-pattern button reloaded the same six rounds with one click. Deleting the loose fire stack before unloading recreated exactly 3 fire from its loaded snapshot and returned 3 cold to its existing stack. Cancellation preserved the full Actor source. Width 540 had no horizontal overflow; footer wrapping was corrected and visually measured. Fixture Actor and all three associated chat messages were deleted afterward.

Live limits: tested as GM; player OWNER/no-GM behavior is covered by focused capability tests, not a separate authenticated player browser. Console was clear after the final native damage/reload/unload checks; shrinking the viewport intentionally triggered Foundry’s minimum-resolution warning. An earlier QA-only weapon-property setup edit showed a base-data notification and was not reproduced by subsequent normal attacks; no claim is made about unrelated startup warnings. Complex ammunition effects remain manual as approved.

Independent scoped follow-up approved the two last functional fixes and footer CSS; reviewer independently ran the pure/editor files: 12 passed, 0 failed. No unresolved Critical/Important findings. Delivery follows the explicit repository instruction: commit and push to lich_branch, no main merge or additional integration decision.

## Task 6: Fix temporary native activity Item routing

Spec: native activity correction above in the existing approved specification. Inline execution continues under the user's explicit bugfix/shared-copy authorization.

- [x] RED: regression through applyDnd5ePreUseActivity for native-shaped temporary reload/unload Items must route to actor.items.get(id), with zero writes before confirmation; denied capability/deleted Item still rejected.
- [x] GREEN: resolve the canonical owned Item at the existing firearm utility boundary; keep strict editor/native capability checks. No socket, permission grants or new mutation infrastructure.
- [x] Verify focused combat tests, actual installed Activity.use when browser available, full runtime/JSON checks and one scoped independent review.
- [x] Bump release/cache entrypoint, update passport and report evidence. Stage only this task; preserve user's parallel changes, including the rest of main.js; commit/push lich_branch.

Task 6 review/live evidence: clone routing tests RED 2 failed / 1 guard passed; corrected combat suite 113 passed / 0 failed. Scoped independent review approved runtime/authorization behavior and independently ran the three new tests (3/3). Its unrelated held-items cache-key finding was excluded from the own patch; the user’s working source retains it. Actual installed Activity.use (Foundry13.351/dnd5e5.2.5, CODEX GM in testovyj3) opened exactly one editor bound to canonical Actor/Item; empty count remained0. Actual native unload returned success. Fixture and editor removed. Release1.5.28 leaves parallel 1.5.27 work intact. Full verification uses HEAD424ea441 plus only the own patch, materialized from a private index; no shared worktree or index reset is used.

Verification-copy setup note: the first full run had 13 failures from checkout autocrlf conversion and missing relative installed-system/module fixtures (plus one additional environment skip). Restored exact Git line endings and supplied the existing installed fixtures to the copy; all 221 affected environment/contract tests then passed without product-code or test-expectation changes. Full repeat follows on that corrected verification environment.

Task 6 final verification: `node --test tests/*.test.mjs` on the own patch/index snapshot — 5317 passed, 0 failed, 1 skipped (5318 total). `node --check` — 1120 JS/MJS passed; tracked JSON — 65 passed. Focused combat — 113/113. `git diff --check` passed. Only the eleven own patch paths/hunks are committed; parallel user source/import/test changes remain outside the commit. Authorized delivery: commit/push lich_branch.
