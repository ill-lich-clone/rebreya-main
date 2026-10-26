# SmallTime pinned click implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Щелчок по закреплённым часам без движения сохраняет закрепление после reload.

**Architecture:** Минимальный early return в существующем `SmallTimeApp.onDragEnd(event)` sibling SmallTime. Настоящий класс исполняется в VM; backup, exact patch и тест хранятся в Rebreya. Второго runtime owner нет.

**Tech Stack:** Foundry 13.351, SmallTime 2.0.4 → 2.0.5, JavaScript ESM, Node test runner, PowerShell.

**Spec:** `docs/superpowers/specs/2026-10-25-smalltime-pinned-click-design.md`.

План составлен после согласования спецификации; пользователь разрешил самостоятельный план и inline execution без следующего согласования.

## Global Constraints

- Единственное намеренное изменение — завершение неподвижного жеста закреплённого окна больше не записывает `position`/`pinned`.
- Реальное перетаскивание, порог начала движения, pin zone и повторное закрепление работают по прежним правилам.
- Keys/scopes/defaults settings, календарь, дата, world time, права GM/player и игровые документы не меняются.
- Ранее сохранённое `pinned=false` автоматически не сбрасывается.
- SmallTime 2.0.4 → 2.0.5; новый versioned entrypoint загружает изменённый source с новым cache key.
- Пользователь выбрал проверку только по исходникам; сервер/клиенты не перезапускаются.
- Git changes только в `lich_branch`; Rebreya runtime/версия 1.5.5 остаются прежними.

## Review Focus

- Открытая/закрытая дата и координаты вне pin zone: no-move не пишет settings.
- `pointercancel` без движения: нет writes, capture/listeners/state очищены.
- Реальный drag-out и drag-back: прежние parent/classes/position/persistence.
- Свободное окно и чужой pointer: прежний snap/persistence или отсутствие вмешательства.
- Новый loader и точный patch: cache key уникален, forward/reverse восстанавливает hashes.

---

### Task 1: Preserve pinned clicks and record the installed patch

**Files:**
- Modify: `../smalltime/scripts/smalltime-app.mjs`, `../smalltime/module.json`.
- Create: `../smalltime/scripts/smalltime-app-2.0.5.mjs`.
- Create: `tools/local-module-patches/2026-10-25-smalltime-pinned-click/{pinned-click.test.mjs,README.md,manifest.json,patches/smalltime.patch,.gitattributes}`.
- Modify: `docs/function-passport.md`, current spec and plan.

**Interfaces:**
- Consumes: `SmallTimeApp.onDragStart(event)`, `onDragMove(event)`, `onDragEnd(event)`, `pinApp(app)`, `unPinApp()`, `computePinZone(x,y)` and existing client settings.
- Produces: unchanged interfaces; no writes on pinned/no-unpin completion, existing cleanup retained.

- [x] **1. Snapshot and RED.** Save exact source/manifest under `C:/Users/ill_lich/.codex/backups/smalltime-pinned-click-2026-10-25/<timestamp>/`. Write real-class VM tests: for 58px/79px pointerup/pointercancel expect `settingsWrites=[]`, `pinned=true`, DOM in players, capture/listeners released and `_dragState=null`. Also test zero-delta move, duplicate end, real drag-out/back, floating click/snap and foreign pointer. Run `node --test tools/local-module-patches/2026-10-25-smalltime-pinned-click/pinned-click.test.mjs`; Expected: no-move regressions FAIL against the unmodified source; preservation cases PASS.
- [x] **2. Minimal implementation.** After listener cleanup in `onDragEnd(event)`, early-return when `wasPinnedAtStart && !hasUnpinnedOnThisDrag`, clearing animation/state. Bump SmallTime to 2.0.5; manifest points to `scripts/smalltime-app-2.0.5.mjs`, importing `./smalltime-app.mjs?v=2.0.5`. Preserve helper import and upstream metadata. Expected: focused suite PASS; prior calendar/BG3 checks remain PASS.
- [x] **3. Source record and documentation.** Generate exact binary-safe before/after hashes and patch with forward/reverse verification in disposable copies. Document the changed method, unchanged contracts, reset for already-saved false state, version/reload limitation and test commands. Expected: all after hashes match installed files; reverse equals before and removes only the added loader.
- [x] **4. Full checks and review.** Run `node --test tests/*.test.mjs`; `git diff --check`; `node --check` for tracked/new JS/MJS plus SmallTime JS/MJS; PowerShell JSON parser for tracked/new JSON plus sibling manifest. Redirect long logs to ignored `tmp/smalltime-pinned-click/`, report counts/errors. Delegate fresh final review to Gemini 3.8 Flash High using only this task's relevant code/spec/test content, no tool permissions or credentials; independently verify findings. Expected: no failures; existing skips/limitations named.
- [x] **5. Commit/push.** Inspect substantive scoped diff/stat; recheck remote `lich_branch` has not advanced. Stage only spec/plan/passport/patch-record files, commit `fix: preserve SmallTime pinning after stationary clicks`, push `git push -u origin lich_branch`. Expected: clean status and matching local/remote task commit.

## Execution decisions

- Existing `lich_branch` is required by project instructions. Sibling runtime is outside Git; isolate with exact backup and disposable patch-validation copy. A new Git worktree would not isolate that sibling.
- Use native PowerShell bookkeeping in ignored `tmp/smalltime-pinned-click/progress.md` instead of Bash helpers. Fresh independent review uses Codex.
- Self-review: every spec requirement maps to Task 1; no shared interfaces between independent tasks because there is one task. Threshold and floating-click redesign deliberately excluded.

## Результат выполнения

RED: 5 ожидаемых failures / 5 preservation passes. GREEN: 49 focused passed; полный suite 5025 passed / 0 failed / 1 existing skip. Syntax: 1064 Rebreya + 4 SmallTime; JSON: 65; forward/reverse hashes совпадают. Gemini final review SUCCESS, blockers отсутствуют. Runtime установлен в SmallTime; source-only QA, сервер/клиенты не перезапускались. Доставка — task commit и push в lich_branch; SHA и результат push фиксируются в отчёте чата.
