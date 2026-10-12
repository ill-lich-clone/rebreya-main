# Расходы еды и воды по группе: отчёт

Дата: 2026-10-12. Ветка: `lich_branch`. Версия: `1.4.373`.

Оба флажка покрытия припасов сохраняются отдельно для каждой группы.
Окно, snapshot и календарное списание используют captured Group Actor ID.
При следующем `ready` active GM однократно переносит старые мировые значения
в существующие группы; новые группы начинают с `false/false`.
Нормы участников, quantity/energy rules, бюджет и `defaultCapMod` сохранены.

- Спецификация: [2026-10-12-group-supply-coverage-design.md](../specs/2026-10-12-group-supply-coverage-design.md).
- Согласованный план: [2026-10-12-group-supply-coverage.md](../plans/2026-10-12-group-supply-coverage.md).

## Проверки

- RED до product edits: 301 passed / 9 failed на новых requirements.
- `node --test tests/*.test.mjs`: **4543 passed / 0 failed / 1 skipped**, 4544 total.
- `node --check` для всех tracked JS/MJS и нового forwarder: **957 checked / 0 failed**.
  После финальной scoped-read правки повторены затронутые syntax checks.
- `Get-Content -Raw -Encoding UTF8 <tracked-json> | ConvertFrom-Json`: **55 checked / 0 failed**.
- `git diff --check`: без ошибок.
- Первая полная проверка обнаружила три старых cache-version expectations.
  Они обновлены на фактические новые URLs; 50 affected release/composition checks
  прошли, затем прошёл полный финальный прогон.
- Live Foundry не проверен: Browser/Playwright inventories не содержат
  подключённого авторизованного Foundry/test world. Игровые данные для QA не изменялись.

## Независимое ревью и решения

Gemini 3.8 Flash High через Antigravity провёл ревью переданного diff/spec.
Его пять замечаний проверены по исходникам; ни одно не подтвердилось:

| Проверенное утверждение | Решение и основание | Цена ошибочного решения |
|---|---|---|
| Missing/deleted ID даёт world fallback | Отклонено: `#resolveSupplyConsumptionActor()` бросает ошибку; missing/unregistered regression tests подтверждают отказ до write. | Запись не в ту группу/мир. |
| `inventoryActorId` не определён | Отклонено: существующий getter возвращает ID snapshot; native/legacy UI tests проверяют payload. | Запись в активную вместо показанной группы. |
| Новые группы наследуют live world flags | Отклонено: fresh defaults явно `false/false`, существующие группы инициализируются один раз; fallback сохраняет только pre-migration compatibility. | Общие флажки после startup. |
| Single-field patch заменяет второй флажок | Отклонено: existing boolean fields перекрывают initial legacy values; explicit `false` сохранён normalizer/repository и тестами. | Потеря независимого выбора второго ресурса. |
| `mutateRegistry` не является canonical repository route | Отклонено: метод определён в `GroupStateRepository`; `mutateGroupState` сам делегирует ему, с fresh-read/normalization/active-GM guards. | Неудачная startup migration. |

Финальный scope audit дополнительно закрепил чтение UI через optional
`getPartySnapshot({ groupActorId })`: две проверки сначала упали, затем прошли
после передачи ID показанного инвентаря. Старые вызовы API сохранены.
Существенных неустранённых замечаний и отложенных minor findings нет.
