# Reaction chat fix implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Оформить сообщение реакции и удалить его после успешной UUID-only реакции игрока.

**Architecture:** Существующий ReactionQueueService остаётся владельцем жизненного цикла. Исправить runtime lookup Actor при финальном списании и использовать один внутренний renderer двух состояний карточки; исходное применение остаётся у provider/MIDI.

**Tech Stack:** Foundry 13.351, dnd5e 5.2.5, Midi-QOL 13.0.61, ESM, CSS, Node test runner.

**Spec:** `docs/superpowers/specs/2026-10-26-reaction-chat-fix.md`.

## Global Constraints

- Сохранить 10 секунд выбора, success-only delete, ledger/rollback, formulas, budgets, quantity, ownership, native MIDI/optional AC и все прежние публичные API.
- Версия выпуска/forwarder/изменённый runtime import/CSS key: `1.5.7`; ветка только `lich_branch`.
- Шесть существующих изменённых планов других задач не редактировать и не добавлять в commit.

## Review Focus

- UUID-only Actor из индекса: разрешается через runtime `fromUuid` и передаётся в канонический consumeReaction.
- Неуспешное списание: rollback и карточка отказа, без удаления.
- Unlinked NPC Actor UUID и готовый Actor: сохраняется точный Document, без замены на базовый Actor.
- HTML в имени и узкий чат: экранирование, перенос, контраст двух состояний.
- Настоящий native dialog: `button.callback`, player→GM transport и результат остаются совместимыми.

### Task 1: Queue lifecycle, styling and release

**Files:** `scripts/combat/reaction-queue-service.js`, `styles/main.css`, `scripts/main.js`, `module.json`, `scripts/main-1.5.7.js`, `README.md`, `docs/function-passport.md`; focused tests `reaction-chat-lifecycle`, `reaction-queue-service`, `managed-reaction-session`, `midi-reaction-adapter`, `module-manifest`, `main-composition-root`.

**Interfaces:** Existing `_executeAccepted({candidate,choice,context,kind,provider,triggerId})`, `_beginReactionMessage(...)`, `_finishReactionMessage(message,applied)` and native result contracts are preserved. Internal `reactionChatContent(actorName,state)` returns scoped escaped HTML for `choosing`/`declined`.

- [x] Add and run RED regression for UUID-only player/synthetic Actor with no injected resolver; assert pay/apply/consume/delete order and one spend. Cover failed spend/rollback and ready Actor precedence.
- [x] Implement runtime resolver fallback in `_executeAccepted`; run queue regression tests GREEN.
- [x] Add RED markup assertions for both states with escaped names; keep existing strict lifecycle expectations. Update native harness to prepare buttons and invoke their callback like MIDI.
- [x] Implement internal renderer and scoped compact dark/gold card CSS; verify existing decline/timeout/error/managed/MIDI tests.
- [x] Bump manifest/forwarder to 1.5.7, queue ESM import and CSS cache key; update release assertions, README and function passport.
- [x] Verify actual Foundry player/NPC success, decline, timeout and visual layout; clean disposable fixtures. Run full tests, syntax and JSON checks once; inspect diff and preserved plan hashes.
- [x] Fresh independent review; resolve material findings, record report and commit only task files; push `lich_branch`.

Self-review: all spec requirements map to this single deliverable. Execution is inline in the existing checkout per user's explicit instruction to continue while preserving other edits; no unrelated branch/worktree changes.
