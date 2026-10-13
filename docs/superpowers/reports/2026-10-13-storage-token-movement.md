# Проход через хранилища: отчёт

Дата: 2026-10-13. Ветка: `lich_branch`. Релиз: `1.4.374`.

Постоянные chest/ground-pile/item/coin objects Rebreya исключаются из creature
blocking и creature difficult-terrain расчётов dnd5e для новых и существующих
scene tokens. Один синхронный handler в существующей storage integration
использует canonical `storageObjectKind()` и два публичных occupied-space hooks.
Остальные candidates остаются в том же Set. Стены, normal creatures, vehicles,
materialized corpses без permanent-storage marker, ownership и storage access
сохраняют прежние правила. Фильтр не пишет Actor/Token/settings.

- Спецификация: [2026-10-13-storage-token-movement-design.md](../specs/2026-10-13-storage-token-movement-design.md).
- Согласованный план: [2026-10-13-storage-token-movement.md](../plans/2026-10-13-storage-token-movement.md).

## Проверки и ревью

- Baseline: 33 focused passed / 0 failed.
- RED до product edits: 16 passed / 8 failed на отсутствии двух hooks.
- Focused `node --test tests/storage-token-hooks.test.mjs tests/storage-object-kind.test.mjs tests/storage-token-drop.test.mjs tests/storage-access.test.mjs`: **53 passed / 0 failed**.
- Финальный `node --test tests/*.test.mjs`: **4551 passed / 0 failed / 1 skipped**, 4552 total.
- `node --check` всех tracked JS/MJS и нового forwarder: **958 checked / 0 failed**.
- `Get-Content -Raw -Encoding UTF8 <tracked-json> | ConvertFrom-Json`: **55 checked / 0 failed**.
- `git diff --check`: без ошибок.
- Первый полный прогон выявил один старый cache-URL expectation в
  `tests/storage-main-registration.test.mjs`. Проверка сохранена, URL обновлён
  на `1.4.374`; 60 affected release/registration checks и полный прогон прошли.
- Независимое ревью Gemini 3.8 Flash High через Antigravity: `findings:[]`,
  `uncertainties:[]`. Diff также сверён с исходниками и согласованной spec;
  отложенных замечаний и изменений игрового scope нет.

Проверена установленная система **dnd5e 5.2.5**: source contracts обоих hooks
и NPC `isCreature` getter. Manifest compatibility остаётся **Foundry VTT 13**;
точный live runtime build не проверен. Попытка подключения браузера для live
QA завершилась таймаутом; movement в авторизованном test world не проверялся.
Игровые данные для QA не менялись. Для применения требуется обновить страницы
Foundry GM и игроков; новые миграции/world writes не требуются.
