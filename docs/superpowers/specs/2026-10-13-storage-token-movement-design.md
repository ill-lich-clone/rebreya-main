# Проход токенов через хранилища

Дата: 2026-10-13. Статус: согласована пользователем.

## Наблюдаемый результат

Игрок может переместить свой токен через клетку с постоянным хранилищем,
сундуком, предметом или кучей монет Rebreya. Эти объекты не блокируют проход
как существа и не создают системную труднопроходимую местность от существа.
Правило действует для уже размещённых и новых объектов после загрузки модуля.

Игрок по-прежнему не получает право двигать чужие токены, перемещать само
хранилище, открывать его без прежних проверок или проходить сквозь стены.
Обычные персонажи, враги, транспорт и материализованные трупы без отдельного
permanent-storage marker сохраняют существующие правила движения.

## Подтверждённая причина

Установлена система dnd5e 5.2.5. В её `dnd5e.mjs`:

- `CreatureTemplate.isCreature` возвращает `true` для NPC data model.
- `TokenLayer5e.isOccupiedGridSpaceBlocking()` рассматривает такие токены как
  существа; одинаковый disposition снимает блокировку, но neutral хранилища
  отличается от friendly персонажа.
- `isOccupiedGridSpaceDifficult()` также учитывает NPC как существо.
- Обе проверки предоставляют публичные hooks с изменяемым `Set<Token5e>`:
  `dnd5e.determineOccupiedGridSpaceBlocking` и
  `dnd5e.determineOccupiedGridSpaceDifficult`.

Проверенные строки установленного источника:
`D:/FoundryVTT/Data/systems/dnd5e/dnd5e.mjs:67415`, `:67460`, `:68634`.
Нейтральный disposition уже применяется built-in/ground-pile builders и сам
по себе не устраняет проблему. Менять Actor type или права владельца не нужно.

## Владелец и минимальный подход

Расширить существующий `registerStorageTokenHooks()` в
`scripts/integrations/storage-token-hooks.js`. В обоих системных hooks один
синхронный обработчик удаляет из переданного Set только объекты, распознанные
каноническим `storageObjectKind()` из `scripts/data/storage-object-kind.js`.
Новый app, обход прав, private-method patch и второй storage owner не создаются.

## Контракты и намеренное изменение

- Единственное игровое изменение: постоянные storage objects Rebreya больше
  не участвуют в creature blocking/difficult-terrain расчёте dnd5e.
- Действуют существующие классификация flags и исключение materialized corpse;
  папка «Хранилища» сама по себе не делает NPC предметом.
- Остальные кандидаты остаются в том же Set. Другие movement hooks продолжают
  выполняться; disposition, ownership, Actor/Token documents не записываются.
- Сохраняются storage open/deposit/claim, proximity ≤10 ft, visibility,
  авторизация отправителя, количество предметов, бюджет и authored formulas.
- Совместимость: Foundry VTT 13, dnd5e, `statuscounter >= 3.0.4`; других
  зависимостей нет. В других системах dnd5e hooks не вмешиваются в движение.
- Клиентский релиз повышается с `1.4.373` до `1.4.374` вместе с forwarder и
  cache URL изменённой integration. Прежние forwarders сохраняются.

## Регрессии до product edits

Для каждого hook и preview/final режима проверить:

1. Из mixed Set удаляются chest и ground pile, в том числе marker только на
   TokenDocument; normal enemy/character/vehicle остаются и продолжают блокировать.
2. Materialized corpse и NPC только из папки «Хранилища» остаются в Set.
3. Обработка работает у player и GM, сохраняет Set identity, не пишет
   Documents/settings и не меняет grid/options/moving token.
4. Пустой Set безопасен; повторное применение не меняет итог.
5. Existing storage interaction/access/drop tests остаются и проходят.

Focused owners: `tests/storage-token-hooks.test.mjs`,
`tests/storage-object-kind.test.mjs`, `tests/storage-token-drop.test.mjs`.
После реализации — полный Node test runner, tracked JS/MJS syntax checks,
tracked JSON parsing, diff check и live movement в Foundry при доступной
авторизованной test-world сессии. Недоступная live-проверка указывается в отчёте.

Спецификация и последующий письменный план требуют review перед реализацией
по обязательному процессу AGENTS.md / Superpowers.
