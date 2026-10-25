# Исправление ошибок консоли после переноса токена

Пользователь поручил исправить обсуждённые ошибки; сохраняется разрешённый ранее режим самостоятельного планирования/выполнения. Проверка только по исходникам, без перезапуска игры и изменений world database для QA.

## Наблюдаемый результат

- Старые ссылки `icons/equipment/eyes/goggles-of-night.webp` и `goggles-of-night.webp` загружают существующее изображение «Ночные очки» вместо 404.
- Неоднозначный выбор лекаря/пациента по-прежнему отклоняется с уведомлением, но managed world macro не создаёт второй unhandled rejection для ожидаемого `invalid-tokens`. Публичный API сохраняет rejected Promise.
- Active GM удаляет истёкший иммунитет по прежнему world-hour правилу. Уже удалённый запрошенный эффект не прерывает очистку остальных; иные ошибки остаются видимыми.
- Подсказка отсутствующего документа безопасно завершается; прежний null-dataset race guard сохраняется, ошибки существующего документа не скрываются.
- Сохранённые BG3 слоты после native cross-scene teleport обращаются к Item нового токена, если actor ID и token ID подтверждают того же владельца. При неоднозначной/чужой ссылке автоматической подстановки нет. Macro, Compendium и world Actor ссылки сохраняются. До/после ожидания target selector проверяется текущий token context; сменившийся контекст отменяет ещё не начатое использование без повторного броска/расхода.
- Активность без targeting в BG3 activity dialog передаётся native обработчику ровно одним click без strict-mode ошибки. Если HUD/manager исчез или собственный Item устарел до выбора активности, оба пути безопасно отклоняются до native click/use/target writes.
- Изменение классов responsive inventory dnd5e переносится из синхронного ResizeObserver callback в один animation frame; последний размер выигрывает, закрытый inventory не обновляется. Это закрывает подтверждённый синхронный resize-path; исходный безымянный browser warning не объявляется полностью атрибутированным без live QA.

## Подходы и владельцы

Выбран узкий подход по владельцам: existing Rebreya compatibility adapter/managed macro/service; existing BG3 UUID resolver/use boundaries с exact local patch; два legacy asset aliases в Data. Глобальное подавление ошибок, переписывание Foundry backend и автоматический replay MIDI атак исключены: они скрывают реальные сбои или повторяют расходы.

### Rebreya

`scripts/integrations/dnd5e-tooltip-compat.js` проверяет null document до original method; новый inventory resize guard оборачивает существующий protected `_onResize` runtime custom element. `TreatWoundsError('invalid-tokens',...)` задаёт ожидаемый отказ UI selection; managed macro ловит только этот code. `TreatWoundsService.cleanupExpiredEffects()` удаляет запрошенные expired IDs по одному и игнорирует только exact missing-ActiveEffect для текущего ID. Авторизация, очередь, immunity duration, Medicine, DC, whole-kit quantity, HP и receipts не меняются.

### BG3

Установленный BG3 3.4.6 хранит layout UUID `Scene.old.Token.T.Actor.A.Item.I`; native Foundry 13 перенос сохраняет T, если destination не содержит коллизии. Канонический `foundryUtils.fromUuid()` получает optional current-token context от GridCell. Только Scene/Token/Actor/Item reference с T и A текущего token/actor разрешается через текущую Actor Items collection. Если в другой исходной сцене ещё существует Token T, ссылка сохраняет native resolver: совпадение IDs не доказывает перенос. Item ID должен существовать; отсутствующий свой Item даёт null, без поиска по имени. После awaiting targeting прежний item/token должен оставаться текущим; никакого повторного запуска уже начатого workflow и переноса старых расходов нет. Изменённые методы фиксируются в profile passport.

### Legacy assets

Источник — `templates/icons/Magic Items/Ночные очки.webp`. Существующий непохожий файл не перезаписывать. Создать только отсутствующие aliases в `D:/FoundryVTT/Data/icons/equipment/eyes/goggles-of-night.webp` и `D:/FoundryVTT/Data/goggles-of-night.webp`; записать exact hashes/пути в task record. Канонический storage normalizer сохраняется. Безымянный десятый 404 не имеет URL в логе и не может быть определён этим изменением.

## Поставка и сохранение контрактов

- Rebreya 1.5.5 → 1.5.6 с тонким `main-1.5.6.js`, новым cache key каждого изменённого runtime owner и его direct runtime importers.
- BG3 3.4.6 → 3.4.7; versioned loader и canonical relative ESM graph. Existing lifecycle recovery, settings/defaults, filters, ownership и layouts сохраняются. Exact backup, forward/reverse patch и hashes — в `tools/local-module-patches/2026-10-25-console-followup-fixes/`.
- Не менять Midi-QOL, систему dnd5e или core Foundry source. Код dnd5e служит источником тестовой проверки поведения.
- Действия уже созданных MIDI workflows/старых chat cards не replay-ятся. Обнаруженные ошибки за пределами подтверждённых сценариев не маскируются.

## Проверка

До реализации — behavioral RED для null-document tooltip, RAF batching/disconnect, exact missing-effect cleanup, typed invalid selection/managed macro, реального BG3 resolver на old/current Scene references и context loss during targeting. Preservation tests: foreign token/actor, Macro/Compendium/world Item, missing own Item, original errors, immunity deadline/other effects/GM guard, macro unexpected failures и прежние BG3 recovery tests. Затем focused suites, full Rebreya suite, tracked/new JS/MJS syntax, JSON, HTTP HEAD aliases, patch forward/reverse и independent inline Gemini review. Live GM/player teleport и источник исходного ResizeObserver warning остаются непроверенными при выбранном source-only режиме.
