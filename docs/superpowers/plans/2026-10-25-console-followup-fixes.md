# Console follow-up fixes implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Закрыть подтверждённые console failures и старые ссылки BG3 после native teleport без изменения правил или повторных расходов.

**Architecture:** Existing Rebreya adapter/service/macro boundaries; narrow BG3 resolver/use guards; exact legacy asset aliases. Все изменения получают failing behavioral tests до реализации, чужие runtime файлы — exact backup/patch/hash record.

**Tech Stack:** Foundry 13.351, dnd5e 5.2.5, Rebreya 1.5.6, BG3 3.4.7; Node test runner/VM, PowerShell.

**Spec:** `docs/superpowers/specs/2026-10-25-console-followup-fixes-design.md`.

## Global Constraints

- Сохраняются ранее разрешённые самостоятельные планирование/выполнение и source-only QA.
- Нет world database edits, server restart, глобального подавления ошибок, повторного запуска MIDI workflow или расходов.
- API validation, world authority, quantity, authored formulas, immunity deadline и receipts сохранены.
- Только `lich_branch`; sibling/module asset изменения имеют exact backup/hash record; чужие файлы не перезаписываются.
- Изменённые runtime owners/direct importers получают новый cache key, Rebreya 1.5.6/BG3 3.4.7.

## Review Focus

- Missing document tooltip vs ошибка существующего document: только null input безопасно пропускается.
- Cleanup race vs чужой ID/permission error: игнорировать только точное отсутствие запрошенного эффекта; остальные ошибки сохранить.
- Scene A/B с одинаковым token ID и actor ID vs чужая Scene/Token/Actor: безопасно разрешать только current self Item.
- Async targeting с потерей current context: ноль `.use()` и target writes; неизменный контекст использует прежние options один раз.
- Resize callback batching/disconnect и exact aliases: no synchronous layout writes; no overwrite of unrelated assets.

---

### Task 1: Rebreya expected failures and responsive inventory

**Files:** `scripts/integrations/dnd5e-tooltip-compat.js`, `scripts/ui/treat-wounds-dialog.js`, `scripts/application/treat-wounds-service.js`, `scripts/combat/grapple-macro-service.js`, their focused tests and `scripts/main.js` wiring.

**Interfaces:** Existing `patchDnd5eTooltipRaceGuard`, `resolveTreatWoundsSelection`, `cleanupExpiredEffects`, `buildTreatWoundsMacroData`; add `patchDnd5eInventoryResizeGuard` in existing adapter.

- [x] Write/run RED: null/undefined tooltip doc skips original; real doc errors propagate; `_onResize` deferred once with latest entries, disconnected inventory skipped. Existing dataset tests remain.
- [x] Write/run RED: selection returns typed `invalid-tokens`; executing generated macro catches only this rejection; unexpected failure escapes. Cleanup continues after exact missing requested ActiveEffect, removes other expired effects, preserves unrelated/not-yet-expired, propagates permission/wrong-ID errors.
- [x] Implement narrow changes; run `node --test tests/dnd5e-tooltip-compat.test.mjs tests/treat-wounds-dialog.test.mjs tests/treat-wounds-service.test.mjs tests/grapple-macro-service.test.mjs`. Expected: all PASS, no gameplay assertion weakened.

### Task 2: BG3 current Item identity after transfer

**Files:** sibling `scripts/utils/foundryUtils.js`, `scripts/components/containers/GridCell.js`, `scripts/bg3-hotbar.js`; new `tools/local-module-patches/2026-10-25-console-followup-fixes/bg3-transfer.test.mjs`.

**Interfaces:** Optional current-token argument to canonical `fromUuid(uuid, {token}={})`; GridCell getter passes manager token. Existing Item/Activity `.use()` bodies preserve options and target selection.

- [x] Backup BG3 manifest/all JS/test sources, capture hashes, make disposable work copy.
- [x] Write/run RED against actual installed classes/helpers: stored Scene A/Token T/Actor A/Item I resolves current Scene B T/A/I without querying old UUID; different actor/token, Macro/Compendium/world references keep original resolver. Missing self Item returns null. After target selection context loss cancels without use/target mutation; stable context performs original use once.
- [x] Implement current-owner lookup and context guards at both GridCell and activity-dialog use boundaries. Run patch tests plus previous `hud-recovery.test.mjs` and `console-errors.test.mjs`; Expected: PASS with preservation cases unchanged. Bump full canonical BG3 ESM graph to 3.4.7; use versioned loader.

### Task 3: Legacy aliases, release, documentation and integration

**Files:** two explicit Data aliases from spec; Rebreya manifest/forwarder/README/importers; affected passports; patch record `{README.md,manifest.json,patches/bg3-inspired-hotbar.patch,.gitattributes}`.

**Interfaces:** Runtime import graph and exact before/after file identities from Tasks 1/2.

- [x] Create only absent legacy aliases from canonical image, or verify existing identical contents. Attempt HTTP HEAD old paths and canonical source; record exact hashes/ownership and unavailable live check.
- [x] Release Rebreya 1.5.6 with `main-1.5.6.js`; update direct importers of changed owners, preserve unaffected cache graph assertions. Document current method contracts, macro behavior, native-teleport support limits, unknown 404/Resize attribution and source-only limitations.
- [x] Generate exact BG3 patch and forward/reverse verify against disposable copies. Run focused tests; `node --test tests/*.test.mjs`; tracked/new JS/MJS `node --check`; PowerShell JSON parse; sibling runtime syntax; `git diff --check`. Expected: no failures; existing Handlebars skip named.
- [x] Fresh inline Gemini review of supplied source/requirements; verify findings, fix blockers RED→GREEN, rerun only affected checks after later changes. Inspect substantive diff/stat and remote branch state. Final integration: commit task files, `git push -u origin lich_branch`, verify clean/synchronized checkout; actual commit/push state is recorded in the task report.

## Execution ledger

`tmp/console-fixes-2026-10-25/progress.md` (ignored). Initial baseline 29 focused passed. Reuse current required checkout; sibling isolation is exact backups/disposable copies. Gemini read_file was denied; reviews use self-contained inline content without file or command tools. Pre-flight dependencies: Task 3 consumes Task 1 runtime signatures and Task 2 installed hashes; no signature conflict. Plan self-review maps every spec requirement to a test/verification step; unknown live warning origins are explicitly bounded.

Task 1: 5 observed RED → 34 focused GREEN. Task 2: 7 observed RED → 10 GREEN; live foreign-scene regression 1 observed RED → 11 GREEN. Task 3: aliases exact hashes confirmed, HTTP unavailable (server closes canonical and alias connections), no restart. Rebreya full: 5030 passed/0 failed/1 existing Handlebars skip; third-party final 81 passed; BG3 runtime 3 passed; syntax 1066 Rebreya +47 BG3; JSON 66. Exact patch verification:44 after/43 before/1 new loader removed;120 canonical imports. See patch record README for commands and limits.

Final review: three confirmed failures (detached inventory without RAF, strict-mode native activity click, disappearing HUD/manager) observed RED, then GREEN. Current combined affected119/119, release88/88, BG3 runtime3/3; changed JS/test syntax, manifest JSON and regenerated exact patch44492bytes pass. Added explicit native activity/cancel contracts to spec/passport. Full Rebreya5030 result predates these narrow fixes; all affected checks repeated. Gemini no-kits suggestion rejected using canonical preview contract; no unresolved blocker in changed paths. Final commit/push follows verification.

Native dialog guard now precedes both native/targeting branches: stale own Item before native click observed RED, then final119/119 GREEN (35 Rebreya+14 transfer+36 HUD+34 console). Same context validation applies before native click; no attack replay. Exact regenerated patch44492bytes verified forward/reverse with all installed hashes.
