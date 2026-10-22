# Исправление регрессий группового боя

Продолжение утверждённого контракта: [исходная спецификация](2026-10-20-grouped-combat-start-design.md), native initiative и joined/stale ingress во время workflow. Новая архитектура или игровые правила не вводятся.

## Наблюдаемый результат

- Три новых одинаковых unlinked NPC с одинаковыми правилами инициативы получают один native roll и общий ход. Настоящий dnd5e D20Roll допускается в профиль, включая advantageMode. Разные формулы, effective advantage и неизвестные semantic options по-прежнему разделяют группы.
- Пока тот же клиент ожидает свою смену хода и её эффекты, повторная навигация присоединяется к ожидающему запросу. Она не отправляет второй запрос с устаревающей ревизией и не перескакивает ещё один ход. Реальный конфликт двух клиентов/GM остаётся защищён revision check.
- Уже установленные разные initiative scores не переписываются автоматически; исправление не перебрасывает текущий пользовательский бой и не переигрывает эффекты.

## Evidence и владельцы

`describeInitiative` отвергал любое неизвестное option. Установленный dnd5e 5.2.5 `D20Roll.configureModifiers` всегда добавляет advantageMode (0/1/-1), отсутствовавший в whitelist. Read-only probe через настоящий native constructor/configureModifiers вернул `{key:null,canShare:false}` для обычного броска `1d20 + 2 + 0.13`. Предыдущие тесты использовали plain options и пропустили native normalization.

`registerGroupedCombatRuntime` выдавал новый operationId при каждом next/update, пока предыдущий awaited workflow ещё выполнялся. Service последовательно принимает первый и отвергает второй как stale; native позиция уже видна в трекере до окончания всех effect steps. Это воспроизводимый путь предупреждения со скриншота; без подключения к живому миру нельзя установить, был ли конкретный запрос повторным кликом или другим клиентом.

Владельцы: provider profile `grouped-combat-effects.js`, native ingress `grouped-combat-runtime.js`. Application revision/CAS, phase provider steps, receipts, grouping identity, authored formulas/settings/resources и остальные макросы сохраняются.

Живой bridge сейчас отвечает «module not connected»; браузерный инструмент показывает только about:blank. Существующий пользовательский бой не меняется. Регрессии проверяются настоящим установленным D20Roll в VM и await-controlled navigation tests; live QA ранее разрешено пропустить.
