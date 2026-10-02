# Foundry Console Errors Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Исправить четыре подтверждённых дефекта сторонних модулей без изменения игровых данных и правил.

**Architecture:** Правки в существующих владельцах lifecycle/hook каждого установленного модуля. Проверяемый patch bundle и regression tests хранятся в rebreya-main, исходные резервные копии — вне раздаваемой Data-папки. Runtime rebreya-main не меняется.

**Tech Stack:** JavaScript ESM, Node test runner и VM, PowerShell, Foundry 13.351, dnd5e 5.2.5.

**Spec:** `docs/superpowers/specs/2026-10-02-foundry-console-errors-design.md`, согласована пользователем 2026-10-02.

## Global Constraints

- Не менять settings keys/scopes/defaults, public API, namespace flags, authored activities/formulas, Item IDs/types, ресурсы и uses.spent, quantity rules, budget spending, HP, текущий бой, эффекты или права пользователей.
- Не выполнять миграцию мира, броски, урон или удаление реальных Actor для проверки.
- UI BG3 создаётся только у игроков; registerSettings остаётся на ready и вызывается ровно один раз для всех клиентов.
- Исправления не внедряются через глобальные hooks rebreya-main.
- Before/after каждого изменяемого файла фиксируются SHA-256; неизвестный concurrent drift останавливает соответствующую правку.
- Все repository changes только в lich_branch; foreign changes и remote ahead блокируют дальнейшую запись. Сторонние установленные модули не являются Git-репозиториями.
- До изменения сохранить исходники/manifest в `C:/Users/ill_lich/.codex/backups/foundry-console-errors-2026-10-02/<unique-run>/`.
- Версии: BG3 `3.4.4` → `3.4.5`; sm-airship `0.1.9` → `0.1.10`; transform-cleanup `13.351.5.3.2.1` → `13.351.5.3.2.2`; effectmacro `13.0.3` → `13.0.4`. Это локальные patch versions, без утверждений об upstream releases.
- Не перезапускать сервер или чужие сеансы для проверки; новый CODEX-сеанс открывается при доступной авторизации. Недоступную live-проверку явно отметить в отчёте.

## Review Focus

- GM известен уже на init: настройки всё равно регистрируются, GM UI не создаётся — Task 1 lifecycle tests.
- Панель есть, настройка ещё не зарегистрирована: no-op без get/изменения roll — Task 1 roll tests.
- advOnce=false: advantage/disadvantage применяется без сброса кнопки — Task 1 roll tests.
- Снятие polymorph выполняет прежнее удаление только active GM — Task 3 mocked deletion test.
- Отсутствует предыдущий Actor на начале боя: эффекты текущего валидного Actor продолжаются — Task 4 execution tests.

## Task 1: BG3 settings lifecycle и roll handler

**Files:** Modify `D:/FoundryVTT/Data/modules/bg3-inspired-hotbar/scripts/module.js`, `scripts/utils/config.js`, `module.json` в том же модуле. Create `tools/local-module-patches/2026-10-02-console-errors/console-errors.test.mjs` в rebreya-main.

**Interfaces:** Consumes установленный source text; VM mocks Hooks.once/on, game/settings, ui и BG3Hotbar. Produces прежние `registerSettings(): void` и `hookRollEvent(rollConfig,dialogConfig,messageConfig): void` с безопасным отсутствующим UI/settings. Test helper читает sibling module root либо `THIRD_PARTY_MODULES_ROOT`; не входит в общий `tests/*.test.mjs` glob.

- [x] Сохранить exact source+manifest backups всех четырёх модулей; записать before hashes и проверить repository status/fetch.
- [x] Добавить source-based lifecycle tests: init user undefined/GM/player → ready GM/player; settings called exactly once, GM UI count=0, player UI count=1.
- [x] Добавить roll tests: no UI/manager/actor/setting/workflow, mismatched actor, MIDI disabled, setting false → неизменённый roll; setting true + matching actor + advBtn/disBtn → соответствующее поле true; advOnce=true вызывает один setState(null), advOnce=false не вызывает reset.
- [x] Запустить `node --test --test-name-pattern="BG3" tools/local-module-patches/2026-10-02-console-errors/console-errors.test.mjs`; ожидается red на GM settings и отсутствующем UI/settings.
- [x] Перенести существующий registerSettings в ready до GM return; удалить прежний повторный вызов. В hookRollEvent проверять panel/actor/workflow и game.settings.settings.has до get; сохранить прежние advState/advOnce.
- [x] Повысить manifest version до 3.4.5; обеспечить cache bust изменённого entrypoint и config import единственным ESM URL в каждом importer. Проверить реальные importers через scoped rg, не создавать второй module lifecycle.
- [x] Повторить BG3 tests; ожидается 0 failed. Проверить сохранённые keys/scopes/defaults сравнением исходного registerSettings.

## Task 2: sm-airship renderSettings

**Files:** Modify `D:/FoundryVTT/Data/modules/sm-airship/scripts/module.js`, `module.json`; extend общий focused test artifact.

**Interfaces:** Consumes Foundry renderSettings callback `(app,html)` и canOpenApp(); produces ту же launch button/action.

- [x] Добавить tests на DOM input, прежний jQuery input, два render (count buttons=1), canOpenApp=false (count=0), anchor present/absent и обработчик открытия (openAirshipApp called once; preventDefault called).
- [x] Запустить focused pattern `airship`; ожидается red на HTMLElement.find.
- [x] В существующем callback нормализовать input в jQuery root (`html?.jquery ? html : $(html)`), сохранив button placement, click callback и дедупликацию. Никаких новых hooks/apps.
- [x] Повысить version до 0.1.10 и cache bust entrypoint; повторить tests, ожидается 0 failed.

## Task 3: transform-cleanup flags guard

**Files:** Modify `D:/FoundryVTT/Data/modules/transform-cleanup/transform-cleanup.mjs`, `module.json`; extend focused test artifact.

**Interfaces:** Preserves `onUpdateActor(updatedActor,changed,options,userId): void` и existing Actor.implementation.deleteDocuments invocation.

- [x] Добавить tests: changed без flags, flags без dnd5e, dnd5e без deletion key → 0 deletes/no throw; active GM + dnd5e `-=isPolymorphed` → exact `[updatedActor.id]`; inactive GM/player → 0 deletes.
- [x] Запустить focused pattern `transform`; ожидается red для отсутствующих flags/dnd5e.
- [x] Перед in проверять changed?.flags?.dnd5e, сохранив active GM guard и прежнее удаление. Не менять критерий самого удаления.
- [x] Повысить version до 13.351.5.3.2.2 и cache bust entrypoint; повторить tests, ожидается 0 failed.

## Task 4: effectmacro missing Actor

**Files:** Modify `D:/FoundryVTT/Data/modules/effectmacro/module.mjs`, `module.json`; extend focused test artifact.

**Interfaces:** Preserves `getExecutor(actor): User|null`, `_executeAppliedEffects$1(actor,hook): Promise<void>` и callers updateCombat/updateCombatant.

- [x] Добавить tests: getExecutor(undefined/null)=null; undefined actor execution=no-op; valid actor designated owner unchanged; fallback activeGM unchanged; non-executor не выполняет macros; matching appliedEffects идут в прежнем порядке. Сценарий missing previous actor + valid current actor выполняет только current effects.
- [x] Запустить focused pattern `effectmacro`; ожидается red для undefined Actor.
- [x] Добавить guard отсутствующего Actor в getExecutor и execution helper; не менять порядок owner selection/effect filters.
- [x] Повысить version до 13.0.4 и cache bust entrypoint; повторить tests, ожидается 0 failed.

## Task 5: Patch bundle, итоговая проверка и Git

**Files:** Create `tools/local-module-patches/2026-10-02-console-errors/patches/<module-id>.patch`, `manifest.json`, `README.md`; update diagnostic section `docs/function-passport.md` для нового verification helper и spec/plan statuses.

**Interfaces:** Bundle manifest хранит relative file paths, original/patched versions, SHA-256 before/after и местоположение backups; patch-файлы содержат только diff затронутых source/manifest. Не содержит world data/credentials. README описывает focused command, local-patch статус, восстановление из backups и риск замены при upstream update.

- [x] Сгенерировать минимальные diffs из exact backups и installed files; проверить, что изменение каждого файла соответствует spec.
- [x] Запустить весь artifact: `node --test tools/local-module-patches/2026-10-02-console-errors/console-errors.test.mjs`; ожидается 0 failed. Запустить `node --check` на изменённых JS/MJS; JSON parse четырёх manifests; проверить cache URLs и их существующие targets.
- [x] **Пропущено по указанию пользователя «Не нужно проверять»:** Если CODEX-сеанс доступен, загрузить изменённые callbacks без повторной регистрации lifecycle/hooks либо открыть новый клиент и проверить: registered BG3 settings, GM UI absent, roll no-op без реальных бросков, airship button count/action, transform/effectmacro fixture scenarios без Document writes. Не изменять живой бой или ownership pack. Указать точные runtime versions и ограничения cache/server manifest refresh.
- [x] Обновить паспорт проверочного artifact: owner, data flow source→VM mocks→assertions, команда и отсутствие persisted writes. Сохранить результат тестов, версии и пути backups в README.
- [x] `git diff --check`, `git diff --stat`, содержательный diff; добавлять только spec, plan и patch artifact/docs. Commit `fix: preserve third-party hooks during missing client state`; `git push -u origin lich_branch`.
- [x] Если runtime rebreya-main не изменялся, его version не повышать и общую runtime suite не запускать: actual changes verified по сторонним исходникам. Если новая необходимость изменит этот scope, сначала пересмотреть spec и выполнить полные проверки из AGENTS.md.

## Execution review

Self-review: все четыре owner fixes и сохранённые контракты покрыты focused tests; общие version/cache/backup/patch constraints покрыты Task 5. Применение — executing-plans в текущем чате, с остановкой при foreign changes, drift или несовпадении spec. План согласован пользователем до product edits; выполнение завершено 2026-10-02. Live-пункт пропущен по прямому указанию пользователя, без доступа к игре.


## Результат исполнения

Tasks 1–4: ожидаемые red failures воспроизведены до реализации; итог 34 passed / 0 failed. Task 1 дополнен regression tests на newly reachable GM onChange callbacks и migration: 36 отсутствующих panel guards, player-only migration, исходные settings metadata/player callback bodies сохранены.

Task 5: проверены 46 JS/MJS, 4 manifests, 125 relative import references; четыре patches применены и обращены на изолированных копиях с точным совпадением 50 after / 46 before SHA-256. Live-проверка отменена пользователем; сервер не перезапускался. Runtime rebreya-main не менялся. Решения исполнения и backups записаны в `tools/local-module-patches/2026-10-02-console-errors/README.md`.
