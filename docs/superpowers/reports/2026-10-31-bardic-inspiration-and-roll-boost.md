# Вдохновение Laaru и доброс d20: результат

Дата: 2026-10-31. Ветка: `lich_branch`. Выпуск: `1.5.41`.

## Требования и реализация

- [Утверждённая спецификация](../specs/2026-10-31-bardic-inspiration-and-roll-boost-design.md).
- [Утверждённый план](../plans/2026-10-31-bardic-inspiration-and-roll-boost.md).
- [Текущий паспорт функций](../../bardic-inspiration-function-passport.md).

Laaru source `hpLNiGq7y67d2EHA` распознаётся по точному modern/legacy source. Существующая activity выдачи создаёт одну кость на 600 секунд; размер берётся от исходного барда и authored scale/formula. Раздача и применение разделены: ресурс расходуется штатной activity один раз; получатель добровольно применяет эффект к атаке/проверке/спасброску. Отдельная activity броска, authored formulas, recovery, subclass spending и восстановление барабаном сохраняются.

Доброс использует ожидаемую native d20-границу и общую очередь обоих consumers по Actor. MIDI ждёт pending fallback, получает обновлённые total/hit sets и штатно обновляет persisted Roll и HTML карточки. Прибавка сохраняется в terms/formula; исходный d20 и crit/advantage options не заменяются. Кости «Исполнителя» и барда не вытесняют друг друга. После диалога проверяются наличие и срок эффекта. Общий ограниченный itemUses pool не оплачивает больше костей, чем позволяет бюджет.

Typed `bardic.inspiration.grant` повторно проверяет источник, OWNER отправителя, activity, точную цель/Token и native consumption message. Новая кость первоначально disabled и активируется только после durable complete receipt. Повтор того же использования после расхода кости не выдаёт её заново.

## Проверки

- `node --test tests/*.test.mjs`: **5430 tests; 5429 passed, 0 failed, 1 skipped**. Финальный полный прогон после исправлений ревью; длительность около 66 секунд.
- Focused suites: attack-roll-boost, performer-automation, bardic-inspiration-compat/command, d20-bonus-native/roll, curse-upgrade-hooks. Регрессии сначала наблюдались падающими, затем прошли. Существующие behavioral assertions не удалялись.
- `node --check` для всех tracked JS/MJS плюс новых task-файлов: без ошибок; после финальных изменений повторены затронутые файлы (10).
- Все 65 tracked JSON разобраны через `ConvertFrom-Json`: 0 ошибок.
- `git diff --check`, staged diff review и versioned forwarder/manifest/composition suites: без ошибок. Отдельный release/architecture прогон: 65/65 passed.

Первый полный прогон выявил четыре ошибки проверки выпуска: два architecture-теста видели ещё не staged rename `main-1.5.40.js`, два version assertions требовали синхронизировать README/composition с `1.5.41`. Причины устранены, affected suites и финальный полный прогон зелёные.

Независимое итоговое ревью выявило два P2: исчезновение/истечение эффекта во время диалога и replay после прерванного complete-receipt. Оба исправлены через RED→GREEN regressions; повторного расхода или повторного создания при неопределённом исходе нет. Полировка/минорные замечания не отложены.

## Chrome / реальный Foundry

Проверено на `https://vtt.rebreya.com/`, GM CODEX: **Foundry 13.351 / dnd5e 5.2.5 / MIDI 13.0.61 / Laaru 3.99.0**.

- Импортированы реальные Laaru class/feature на временного барда 5-го уровня: scale=`d8`, исходный ресурс 4. Native activity выдачи потратила ровно один заряд и создала у союзника `1d8`, duration=600; pending=false, disabled=false, receipt complete=true.
- Отказ от native проверки сохранил кость. Применение к проверке: **15+1=16**, эффект удалён, persisted ChatMessage и JSON roundtrip дают 16.
- Native спасбросок: **4+3=7**, кость удалена, сохранённый/восстановленный Roll даёт 7.
- Реальный MIDI weapon workflow с контролируемым входом (d20=10, modifier=5; QA bonus=4): **15 против КД18 → 19, hitTargets=1**. Persisted `midi-qol.attackRoll._total`=19, HTML карточки показывает19, JSON roundtrip=19. Урон не применялся.
- Повтор исходного typed grant после расхода вернул `already-granted`; ресурс повторно не потрачен.
- Compatibility restore на реальном Item уменьшил spent **4→3**.
- Проверен reload и загрузка финальных методов. Во время успешных сценариев browser console: 0 errors; имеются предупреждения сторонних модулей.
- Удалены все созданные fixtures: **2 Actors, 1 QA Scene, 16 QA ChatMessages**; осталось 0 QA Actors, общее число Actors вернулось к188. Временные hooks/wrappers сняты, исходная сцена восстановлена.

Отдельный вход с ролью player не выполнялся; player authorization, unowned target routing и synthetic Token boundaries проверены focused-тестами. Нет утверждения о live-проверке других систем или иных версий. Foundry хранит startup package metadata старого выпуска `1.5.31`; локальный module.json/forwarder обновлены до `1.5.41`, новые runtime-методы проверены после reload. Перечитывание отображаемой версии/списка esmodules сервером произойдёт после обычного перезапуска Foundry.

## Самостоятельные решения и их границы

1. Работа в существующем чистом runtime checkout `lich_branch`, без нового worktree: так соблюдается пользовательский Git-процесс и проверяется реальная локальная установка. Цена — общий checkout; перед правками и перед Git-доставкой проверены чистота/remote divergence.
2. Durable receipt хранится на native usage ChatMessage вместо bounded списка source Item: старые receipts не вытесняются и стандартный replay не возвращает потраченную кость. Цена — используется штатная модель доступа Foundry к ChatMessage.
3. Намеренное переписывание OWNER собственных native flags/resources остаётся внутри штатной модели доверия Foundry. Это не anti-cheat против владельца, изменяющего свои документы; обычная повторная доставка и reconnect защищены.
4. Pending выдача без surviving effect имеет неопределённый исход и требует проверки GM, вместо автоматического создания новой кости. Цена — редкий сетевой сбой/ручное удаление незавершённого эффекта может потребовать ручного восстановления ресурса/эффекта; потраченная кость не дублируется.

Новых dependencies, пользовательских настроек, UI-приложений и изменений стороннего пакета Laaru нет. Финальная Git-доставка: task-only commit и push `origin lich_branch` по обязательным инструкциям репозитория; commit указан в итоговом сообщении задачи.
