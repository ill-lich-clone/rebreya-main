# Grouped Combat Performance Repair Plan

> **For agentic workers:** Use superpowers:executing-plans; restore the approved per-creature workflow contract without removing persistence or effects.

**Goal:** Убрать повторные render/ring/duration scans при journal writes и пересылку всей истории на каждый effect step.

**Architecture:** Существующие GroupedCombatRepository/Service и runtime/provider adapter. Native position/final updates прежние; progress writes явно помечены и проверяются по фактическому changed shape. Отдельная partial receipt запись сохраняет прежний flag schema/revision.

**Tech Stack:** Foundry13.351, dnd5e5.2.5, ESM JavaScript, Node tests и настоящие Foundry data helpers.

**Spec:** [Performance repair](../specs/2026-10-24-grouped-combat-performance.md), [основной контракт](../specs/2026-10-20-grouped-combat-start-design.md).

## Tasks

- [x] RED: runtime receipt writes вызывают лишние actor/ring refreshes; native/final/ordinary updates обязаны сохранить их. Strict progress predicate не принимает positional/foreign/mixed updates.
- [x] RED: managed flag-only update не должен запускать native provider; ordinary/pending по-прежнему вызывают original.
- [x] RED: partial receipt сохраняет running/done/revision с CAS и не отправляет историю; actual expandObject/mergeObject сохраняет предыдущие receipts/metadata и final removal. Service использует partial save после checkpoint, сохраняет failure/handover/deleted-member contracts.
- [x] GREEN: repository writeReceipt и progress metadata; service phase checkpoint/receipt saves; runtime suppression только двух ненужных refresh methods внутри marked journal _onUpdate; provider guards. Повтор focused suites и сравнение fixture costs.
- [x] Обновить profile/README и version1.5.2/forwarder/cache import graph. Gemini review и проверка замечаний в источнике.
- [x] Полные tests, tracked JS syntax, tracked JSON и diff review. Только task files commit/push lich_branch.

## Evidence

До правок clean lich_branch, HEAD=origin/lich_branch=11346d2f; 89 ahead/0 behind origin/main. Current release1.5.1. Bridge module not connected; никаких world writes для QA.

### Воспроизведение и контрольные показатели

Native-source VM harness исполняет настоящие `Combat._onUpdate/updateCombatantActors` и dnd5e `Combat5e._onUpdate`, с документированным fake previous-record helper для flag-only случая. Нативный backend добавляет changed._id (`client/data/client-backend.mjs:294–299`); regression сначала воспроизвёл отсутствие suppression с этим полем, затем проверил строгий allowlist.

Одинаковая fixture: 20 участников, 1000 старых receipts, 40 running/done writes. Repository input-data bytes (без socket headers), не live FPS:

| Метрика | До | После |
| --- | ---: | ---: |
| Записей | 40 | 40 |
| Объём данных записей | 7 524 932 bytes | 9 932 bytes |
| Actor sheet refresh calls | 800 | 0 |
| Dynamic ring refresh calls | 80 | 0 |

Durability не обменивалась на меньшее число acknowledgements. На progress updates сохраняется native base Document bookkeeping (40/40); настоящий position/final/ordinary/mixed update по-прежнему обновляет окна и rings. Отдельный receipt заменяется через native `==key`, чтобы не оставить старую effect metadata. История, CAS, anchors, pending checkpoint и final deletion проверены настоящими expandObject/mergeObject.

### Проверки

- RED → GREEN: 3 исходных failure (лишние native refreshes, flag-only provider invocation, отсутствующий partial receipt); отдельные regression для backend _id и replacement metadata. Все прежние grouped authorization/reload/uncertain/deleted-member tests сохранены.
- `node --test tests/grouped-combat-*.test.mjs`: **48 passed, 0 failed**.
- Grouped + manifest/composition/storage focused batch: **109 passed, 0 failed**. Release expectations обновлены только для затронутых owners. Старая неоднозначная проверка launcher `/hooks.js?.../` закреплена за фактическим неизменённым root `./hooks.js?v=1.4.360`, вместо случайного совпадения с combat/gadget hooks.
- `node --test tests/*.test.mjs`: **4989 passed, 0 failed, 1 прежний skipped** (4990 total); skip — отсутствующий Foundry Handlebars dependency для rendered ghost.
- Tracked JS/MJS `node --check`: **1057 passed, 0 failed**. Tracked JSON `ConvertFrom-Json`: **58 passed, 0 failed**.
- После полного прогона усилено только утверждение native bookkeeping в progress test: повторный focused **2 passed, 0 failed**, syntax этого файла PASS. Runtime после полного прогона не менялся.
- Version/forwarder1.5.2 и module auditor: PASS. Profile/README обновлены; live FPS не замерен из-за неподключённого bridge.

### Review и сохранённые ограничения

Gemini 3.8 Flash High analysis завершился SUCCESS и независимо подтвердил full-snapshot/write amplification. Codex сверил замечания с локальными native sources: обязательные position commits остаются; мелкие linear scans и ограничение receipt history не менялись. Финальный supplied-diff Gemini review достиг print timeout5m и не вернул подтверждённого результата; он не считается чистым review. По AGENTS.md продолжено локально.

Локальная итоговая проверка: source CAS без draft clone, pending checkpoint до partial writes, retry/final deletion, synchronous WeakSet scope с finally, actual backend _id, foreign/mixed/native/final fallback, logical provider phases и cache identity. Известный предел: число durable writes не уменьшено, глубокая history всё ещё входит в редкие phase/final snapshots; произвольные сторонние updateCombat hooks и реальные FPS требуют живого профиля. Все прежние ограничения provider versions/auto-reroll/reset-round сохранены.

Финальный diff/ссылки/cache identity проверены. Повторный fetch: HEAD совпадает с origin/lich_branch, origin/main не содержит новых commits относительно HEAD. Интеграция — commit и обычный push lich_branch по прямой инструкции проекта; main/master не меняются.
