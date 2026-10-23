# Global Reaction Chat Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Все реакции игроков/NPC и Midi-QOL управляются нашим сервисом; общий чат показывает выбор и отказ, успешное применение удаляет сообщение.

**Architecture:** Расширить существующий ReactionQueueService, не создавать вторую очередь. Изолированный адаптер перехватывает MIDI socket-handler `chooseReactions`, направляет обработку в сервис и использует исходный MIDI handler как исполнитель с управляемым жизненным циклом выбора/применения. Исходные native callbacks сохраняют формулы, оплату и результат workflow.

**Tech Stack:** JavaScript ESM, Foundry 13 Documents/Hooks/DialogV2, Midi-QOL 13.0.61, установленный socketlib, Node test runner.

**Spec:** `docs/superpowers/specs/2026-10-23-global-reaction-chat-design.md`

## Global Constraints

- Тексты: «Имя выбирает реакцию» и «Имя не применил реакцию». Общий чат, включая скрытых NPC; HTML-экранирование имени.
- Выбор — ровно 10 секунд. После подтверждения начатое применение не обрывается таймером выбора.
- Никакого двойного списания, изменения authored formulas, quantity/budget rules, настроек доступности или схем существующих flags/API.
- Существующие providers, порядок кандидатов, authenticated sender checks, fallback владельца на GM сохраняются.
- Нереакционные promptDecision не создают сообщения. Native activity и optional AC возвращают исходный MIDI результат.
- Без изменения файлов Midi-QOL/socketlib и новых зависимостей. Весь код и commit/push — `lich_branch`.
- Runtime-изменения требуют новой версии manifest и versioned forwarder.

## Review Focus

- Поздний callback после таймаута не оплачивает и не применяет реакцию — Task 1/2.
- Native optional AC, включая формулы, conditions, force и расход счётчика, выполняется исходным callback без упрощения — Task 2.
- Nested reaction из применения другой реакции не попадает во взаимную блокировку — Task 2.
- Reconnect/смена active GM завершает просроченные сообщения без повторного применения — Task 1/3.
- Вызов native handler для чужого Actor и поддельное сообщение о начале применения не обходят авторизацию — Task 2.

## Проверенная граница MIDI

`../midi-qol/midi-qol.js:17435`: requestReactions отправляет `chooseReactions` и возвращает его результат ожидающему doReactions. `:21292` localDoReactions восстанавливает item/activity и вызывает promptReactions. `:17478` promptReactions обрабатывает activities и optional AC; `:17642`/`:16493` экспортируемые `MidiQOL.apps.ReactionDialog` и `RollModifyDialog` получают `data.callback`, `data.close`, `data.actor`, `data.timeout`.

У socketlib `register` повторную регистрацию **игнорирует**. Поэтому адаптер получает уже зарегистрированный socket через `socketlib.modules.get("midi-qol")`, сохраняет `functions.get("chooseReactions")` и заменяет только эту запись обёрткой. Это внутренний контракт, проверяемый feature guards и отдельными тестами; не подменять его неработающим повторным register. Повторная initialize не оборачивает функцию заново. При неподдерживаемой форме API показать одну явную ошибку интеграции; не заявлять, что MIDI охвачен.

### Task 1: Жизненный цикл сообщений существующих реакций

**Files:** modify `scripts/combat/reaction-queue-service.js`; create `tests/reaction-chat-lifecycle.test.mjs`.

**Interfaces:** `_beginReactionMessage({triggerId, candidate, kind}) -> Promise<ChatMessage|null>`; `_finishReactionMessage(message, applied) -> Promise<void>`; `recoverExpiredReactionMessages() -> Promise<void>`. Dependencies берутся через существующий options injection и Foundry globals, без UI world writes.

- [ ] Добавить регрессии создания перед prompt, удаления только после transaction.accepted, update при decline/close/timeout/paymentFailed/applicationFailed/providerError; утверждать точные тексты и отсутствие двойного расхода.
- [ ] Проверить duplicate trigger/candidate, одинаковые имена разных Actor, HTML в имени, ошибку create/update/delete, отсутствие кандидата, нереакционный promptDecision, выбор дольше срока через late callback.
- [ ] Запустить `node --test tests/reaction-chat-lifecycle.test.mjs` и увидеть RED на отсутствующем поведении.
- [ ] Добавить begin/finally-finalize вокруг реального candidate lifecycle в `_resolve`, оставляя existing payment/apply/rollback владельцами мутаций. Удалять только при подтверждённом transaction.accepted. Для exceptions обновлять отказ перед распространением/обработкой ошибки.
- [ ] Module-owned message flag `reactionChoice` содержит triggerId, candidateActorUuid, kind, state, expiresAt, actorName; recovery читает только этот namespace у game.messages и переводит истёкшие choosing в declined на active GM. Не изменяет несвязанные сообщения.
- [ ] Запустить `node --test tests/reaction-chat-lifecycle.test.mjs tests/reaction-queue-service.test.mjs tests/reaction-dialog-ownership.test.mjs`; Expected: все PASS.

### Task 2: Управляемое native применение через очередь

**Files:** create `scripts/integrations/midi-reaction-adapter.js`, `tests/midi-reaction-adapter.test.mjs`; modify `scripts/combat/reaction-queue-service.js`, `tests/reaction-dialog-ownership.test.mjs`.

**Interfaces:** `MidiReactionAdapter(moduleApi, options={})`, `initialize()`, `renderPrompt(prompt,{signal})`, `handleSocketMessage(message,senderId)`; queue `resolveManagedReaction(request) -> Promise<serializable MIDI result>`. Native request содержит исходные tokenUuid, triggerTokenUuid, triggerType, reactionActivityList, options и стабильный triggerId. В отдельном module-owned protocol различать prompt/commit/apply/result; переносить только сериализуемые данные, callbacks остаются в локальной bounded session map.

- [ ] До реализации написать contract harness с socket.functions Map и исходным native handler, создающим ReactionDialog/AC dialog через тестовые классы. Проверить до/после: handler result идентичен исходному для успеха, optional AC и отказа; native handler не запускается вне сервиса.
- [ ] RED-тесты: NPC и player routing, повтор initialize/request, десятисекундный decline, click на границе срока, отсутствие повторной оплаты, nested reactions, неподдерживаемый socket API, неверный sender/Actor, отсутствие активного GM.
- [ ] RED-тесты AC: native callback получает исходные formula/condition/count/force; callback вызывается ровно один раз, результат `ac` возвращается без потерь. Обычные не-AC RollModifyDialog не затрагиваются.
- [ ] Реализовать обёртку chooseReactions и provider для managed lifecycle в существующем сервисе. Авторитетный GM валидирует token/actor/activities и отправителя перед native prompt; клиент-владелец не выбирает произвольный Actor или callback по входному ID.
- [ ] Использовать исходный localDoReactions на владельце через адаптер. Пометить его options уникальным module-owned session ID. В обёртках render только двух экспортируемых native классов связать dialog с этой session по actor и request context; не использовать глобальный «последний диалог». Несвязанные диалоги вызывают original render без изменений.
- [ ] Перед native callback зафиксировать выбор в сервисе, остановить таймер выбора и получить разрешение координатора. Лишь затем вызвать сохранённый callback. Это two-phase lifecycle: сообщение остаётся «выбирает» до финального native result; callback не сериализуется. При abort закрыть только принадлежащие session окна, отменить callback и завершить исходный handler без применения.
- [ ] Для native activity callback оставить исходный completeActivityUse; для AC оставить исходные bonusDialog callbacks и их roll/flag/payment logic. Native timer настроить на 10 секунд выбора, очистить только session-owned таймеры при commit; не обрывать исполнение отдельным старым MIDI таймером после клика. Принудительные AC без окна выполняются внутри managed operation и финализируются по native result.
- [ ] Не добавлять native provider повторное consumeReaction: оплата остаётся native executor. Перед запуском повторно проверить module reaction ledger; синхронизировать успешный native расход с существующим владельцем reaction state без второго эффекта/платежа. Сохранить настройки запрета/доступности. Исключить module-owned реакции из native списка по существующим provider/capability признакам, не по локализованному имени.
- [ ] Native AC может предлагать несколько допустимых бонусов в одной сессии: сохранить исходную возможность, а после первого commit защита от позднего ответа действует на ещё не начатые callbacks, не отменяет уже подтверждённый workflow.
- [ ] Возвращать исходный MIDI `{name,uuid,ac,itemName,itemUuid}` без изменения служебных вариантов; successful activity определяется финальным uuid/workflow, AC — подтверждённым изменением roll. При native отказе после выбора обновлять сообщение на отказ.
- [ ] Bound sessions — максимум 128, завершённые keys — существующие TTL/лимит очереди. Cleanup на success/decline/error/abort, без polling. Взаимно ожидающие nested callbacks не блокируются глобальным mutex.
- [ ] Запустить `node --test tests/midi-reaction-adapter.test.mjs tests/reaction-chat-lifecycle.test.mjs tests/reaction-queue-service.test.mjs tests/reaction-dialog-ownership.test.mjs tests/spell-automation-service.test.mjs tests/rune-knight-automation-service.test.mjs`; Expected: все PASS.

### Task 3: Runtime-регистрация и восстановление

**Files:** modify `scripts/main.js`, `scripts/combat/hooks.js`, `tests/environment-automation-service.test.mjs`; extend adapter tests.

**Interfaces:** единственный `moduleApi.midiReactionAdapter`; initialize вызывается после доступности MIDI/socketlib; module socket dispatch передаёт authenticated sender в адаптер. `recoverExpiredReactionMessages()` из Task 1 вызывается на startup и смене active GM, без периодического сканирования.

- [ ] RED-тесты регистрации на каждом клиенте ровно один раз, reload/reinitialize, смены GM с истёкшим сообщением, обработки отказа без GM и сохранения нереакционных prompts.
- [ ] Подключить adapter в composition root и существующий dispatch; lifecycle hooks только в canonical combat hooks. Отсутствие MIDI сохраняет module providers. Административная ошибка версии/контракта не превращается в скрытый успешный bypass.
- [ ] Запустить затронутые тесты Task 1/2 и `node --test tests/environment-automation-service.test.mjs`; Expected: все PASS.

### Task 4: Документация, версия и итоговая проверка

**Files:** modify `README.md`, `docs/function-passport.md`, `module.json`; create новый `scripts/main-<version>.js`, удалить старый forwarder по принятой практике проекта. Spec/plan входят в commit.

- [ ] Обновить раздел глобальных реакций README: общий чат, успех/отказ, native MIDI/AC, 10 секунд выбора, имена скрытых NPC, проверенная версия и внутренняя граница адаптера. Записать новые/изменённые методы в профильный паспорт.
- [ ] Увеличить текущую версию минимум на patch, синхронизировать esmodules/forwarder и проверить отсутствие старого runtime entrypoint.
- [ ] Выполнить `node --test tests/*.test.mjs` с кратким passed/failed summary; `git diff --check`; node --check для tracked JS/MJS и новых runtime файлов; ConvertFrom-Json для tracked JSON. Expected: 0 failed, 0 syntax/JSON/diff errors.
- [ ] В доступном живом Foundry проверить player/native reaction, GM/NPC, decline, timeout, успешную activity, optional AC, nested реакцию, duplicate hooks после reload и сообщения. Зафиксировать точные Foundry/dnd5e/MIDI версии; недоступное live-окружение обозначить как непроверенное, не как PASS.
- [ ] Независимый review кода против spec и Review Focus, исправление существенных замечаний с RED→GREEN тестами. Просмотреть содержательный diff и diff stat.
- [ ] Stage только файлы задачи; commit с осмысленным сообщением; `git push -u origin lich_branch`. Без force push, изменений main или чужих файлов. В отчёте — spec/plan, commit, тестовые команды и passed/failed, ограничения live QA.

## Self-review

Все пользовательские требования покрываются Tasks 1–4. Самая рискованная граница — сохранение native callbacks и результата через две фазы и клиента-владельца; contract harness Task 2 обязателен до runtime wiring. Нельзя заменять его тестом, который просто ищет строку в исходнике. Если установленный MIDI contract не позволяет безопасно остановить выбор и сохранить оплату/формулы, остановить именно реализацию адаптера с конкретным воспроизводимым blocker, не выпускать частичное «все реакции».

## Execution

Утверждено пользователем 2026-10-23: native исполнение Codex в текущем чате. Gemini проверил подход к forced optional AC; финальное независимое ревью выполнено Codex после истечения CLI timeout Gemini. Реализация сохраняет callbacks на исходном owner client, а сервис проводит begin/commit/finish RPC; отдельные renderPrompt/handleSocketMessage у адаптера не нужны, транспорт принадлежит существующей очереди. Подробные результаты и ограничения: `docs/superpowers/reports/2026-10-23-global-reaction-chat.md`.
