# Поля импорта предметов Rebreya

## Немагическое снаряжение

Рекомендуемые поля таблицы:

- `equipmentType: string`
  Основная категория из базы Rebreya. Поддерживаемые значения: `Оружие`, `Огнестрельное оружие`, `Доспех`, `Снаряжение`, `Обвес`, `Скакуны и транспорт`, `Инструменты`, `Зелье`.
- `foundryType: string`
  Явное переопределение типа документа Foundry. Допустимые значения: `weapon`, `equipment`, `tool`, `consumable`, `loot`.
- `foundrySubtype: string`
  Основной subtype/`system.type.value`.
  Для `weapon`: `simpleM`, `simpleR`, `martialM`, `martialR`, `firearmPrimitive`, `firearmAdvanced`.
  Для `equipment`: `clothing`, `ring`, `rod`, `trinket`, `vehicle`, `wand`, `wondrous`, `light`, `medium`, `heavy`, `shield`.
  Для `tool`: `art`, `music`, `game`, `vehicle`.
  Для `consumable`: `ammo`, `potion`, `poison`, `scroll`.
  Для `loot`: `art`, `gear`, `gem`, `junk`, `material`, `resource`, `trade`, `treasure`.
- `foundrySubtypeExtra: string`
  Дополнительный subtype для `loot` и `consumable`.
  Примеры: `attachment`, `arrow`, `crossbowBolt`, `blowgunNeedle`, `slingBullet`, `firearmBullet`.
- `foundryBaseItem: string`
  Базовый предмет `dnd5e`, если нужен системный шаблон. Примеры: `halberd`, `battleaxe`, `shield`, `plate`, `pistol`, `musket`.
- `foundryFolder: string`
  Путь папки в компендиуме. Пример: `Огнестрельное оружие/Примитивное`.
- `heroDollSlots: string | string[]`
  Явные слоты куклы героя.
  Поддерживаемые значения: `head`, `neck`, `shoulders`, `chest`, `belt`, `legs`, `bracers`, `leftHand`, `rightHand`, `ring1`, `ring2`, `back1`, `back2`, `back3`, `back4`, `back5`.
  Допускаются русские алиасы вроде `Голова`, `Шея`, `Рука`, `Кольцо`, `Спина`.
- `firearmClass: string`
  Класс огнестрела: `primitive` или `advanced`.

## Магические предметы

Рекомендуемые поля таблицы:

- `name: string`
- `type: string`
- `rarity: string`
- `itemType: string`
- `itemSubtype: string`
- `itemSlot: string`
- `heroDollSlots: string | string[]`
- `source: string`
- `rank: number`
- `materials: string`
- `bargaining: string`
- `costText: string`
- `impact: string`
- `attunement: string`
- `isConsumable: boolean`
- `description: string`
- `value: number`

## Алиасы, которые уже понимает импорт

Импортер дополнительно читает такие синонимы колонок:

- `foundryType`: `dnd5eType`, `documentType`
- `foundrySubtype`: `dnd5eSubtype`, `typeValue`
- `foundrySubtypeExtra`: `dnd5eSubtypeExtra`, `subtypeValue`, `typeSubtype`
- `foundryBaseItem`: `dnd5eBaseItem`, `baseItem`
- `foundryFolder`: `folderPath`, `folder`
- `heroDollSlots`: `heroSlots`, `itemSlots`, `slots`
- `firearmClass`: `gunClass`, `firearmSubtype`
