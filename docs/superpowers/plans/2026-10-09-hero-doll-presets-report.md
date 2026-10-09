# Пресеты куклы героя: результат

Спецификация: [2026-10-09-hero-doll-presets-design.md](../specs/2026-10-09-hero-doll-presets-design.md).
План: [2026-10-09-hero-doll-presets.md](2026-10-09-hero-doll-presets.md).
Выпуск: 1.4.364, ветка lich_branch; реализация выполнялась самим Codex в текущем checkout по явному поручению пользователя.

## Поведение

- Именованные Actor-комплекты: выбор без переключения, создание, явные Apply/Save, переименование и удаление; отметка изменения текущей куклы.
- Missing Item изображается полупрозрачным силуэтом с названием и безопасной запасной иконкой. Силуэт не попадает в canonical slots/equipped/heldHands/резервирование и не даёт эффектов.
- Удаление/замена силуэта меняет только текущую куклу. Без Save повторный Apply возвращает его; оставшиеся силуэты сохраняются вместе с комплектом.
- Конкретные Item IDs, совместимость слотов, quantity rules, grip, формулы/charges/upgrades/contents и independently equipped предметы сохраняются. Ordinary legacy stack оставляет оригинальную надетую единицу qty=1 и отдельный unequipped remainder.
- Typed actor-key command, повторная OWNER/active-GM проверка, durable batch receipts, стабильный retry, компенсация затронутых полей и manual-review при чужой правке.

## Проверки

- Начальные focused tests: 40 passed, 0 failed.
- RED→GREEN: отсутствие runBatch/executePresetMutation/UI helper; все create/debit/equip/placement before/after fault cases; stale/corrupt/duplicate preset, ghost remove/reapply/save, real replacement, legacy quantity/identity, active-GM restart.
- Независимый review: 0 Critical, 2 Important, 0 Minor. Оба Important исправлены с воспроизводящими RED→GREEN tests: public retry после start/finish persistence/response failures (включая EIO) сохраняет исходный operationId; компенсация перепроверяет fields внутри guarded callback после каждого await и не затирает mid-rollback foreign edit.
- `node --test tests/*.test.mjs`: финально **4445 passed, 0 failed, 0 skipped**. Для выполнения реального Handlebars render-теста NODE_PATH указывал на node_modules установленного Foundry. Первый полный прогон выявил 7 старых release guards; обновлены только текущие version/forwarder/cache expectations с сохранением остальных контрактов.
- `node --check` для всех tracked и новых JS/MJS: **934 файлов, 0 ошибок**; после review fixes повторены **25 затронутых файлов, 0 ошибок**.
- `Get-Content -Raw -Encoding UTF8 <tracked JSON> | ConvertFrom-Json`: **55 файлов, 0 ошибок**.
- `git diff --check`: успешно. Manifest/forwarder, stylesheet, hero-doll template и изменённые workflow/driver/service/sheet import URLs обновлены; старые forwarders сохранены.

## Решения и границы проверки

1. Выполнение в текущем чистом lich_branch без второго запроса одобрения плана/создания worktree: явное поручение пользователя; изоляция отдельным checkout не применялась.
2. Product changes объединены в выпускной commit после целостной реализации и полной проверки согласно Git-процессу репозитория; промежуточные результаты фиксировались в execution ledger.
3. Обновлены release guards и cache URLs под 1.4.364, остальные subsystem cache keys сохранены. При неверном выборе key клиенты могли бы получать старые файлы; versioned runtime/template/CSS guards проверены.
4. Live Foundry GM/player/dialog/cross-window QA не выполнена: доступная браузерная вкладка была на /join (Foundry 13 Build 351), authenticated test world отсутствовал. Пользователь явно поручил завершить без живой проверки и проверить мир самостоятельно. Это ограничивает подтверждение внешнего вида и живого lifecycle; production world для QA не изменялся.

Gemini помог подготовить исходный checklist спецификации; repository exploration через его CLI не состоялось из-за command permissions, поэтому источники проверялись локально. Отложенных Minor findings нет.
