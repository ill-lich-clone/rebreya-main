export const EQUIPMENT_SPREADSHEET_ID = "1G-UCW00vsjON05fr0CgyK03YaF82oYJemlqNKdv1JBk";

function declaration(registryOrder, definition) {
  return Object.freeze({
    registryOrder,
    layout: "tabular",
    optionalHeaders: [],
    ...definition,
    headerRows: Object.freeze([...(definition.headerRows ?? [])]),
    requiredHeaders: Object.freeze([...(definition.requiredHeaders ?? [])]),
    optionalHeaders: Object.freeze([...(definition.optionalHeaders ?? [])]),
    legacyMirrors: Object.freeze([...(definition.legacyMirrors ?? [])].map(Object.freeze))
  });
}

export const SHEET_REGISTRY = Object.freeze({
  baseGear: declaration(0, {
    sheetTitle: "Общий компендиум снаряжения V0.1",
    range: "A1:M806",
    headerRows: [1],
    dataStartRow: 3,
    requiredHeaders: ["Название", "Тип снаряжения", "Цена", "Ранг", "Вес", "Описание"],
    optionalHeaders: ["Подтип (магазин)", "Объем", "Вместимость", "Преобладающий материал (источник)", "Связанный инструмент", "Value", "Множественное появление"],
    stableKeyHeader: "Название",
    adapter: "baseGear",
    outputCatalog: "gear"
  }),
  equipmentReferences: declaration(1, {
    sheetTitle: "_СПРАВОЧНИК_СНАРЯЖЕНИЯ",
    range: "A1:AC1200",
    headerRows: [1],
    dataStartRow: 2,
    layout: "raw",
    requiredHeaders: ["Ключ", "Тип", "Каноническое название", "ID источника", "Лист", "Строка"],
    stableKeyHeader: "Ключ",
    adapter: "references",
    outputCatalog: null
  }),
  weaponGroups: declaration(2, {
    sheetTitle: "Оружейные группы",
    range: "A1:Z1004",
    headerRows: [],
    dataStartRow: 1,
    layout: "raw",
    requiredHeaders: [],
    stableKeyHeader: null,
    adapter: "weapons",
    outputCatalog: "gear"
  }),
  weapons: declaration(3, {
    sheetTitle: "Оружие V0.36",
    range: "A1:Z983",
    headerRows: [1, 2],
    dataStartRow: 3,
    requiredHeaders: ["Название", "Урон", "Тип урона", "Цена", "Ранг", "Вес", "Оружейная группа", "Количество рук"],
    optionalHeaders: ["Смена хвата", "Тип по весу", "Наскок", "Фехтовальное", "Досягаемость", "Расширенный критический удар", "Множитель критического удара", "Силовое", "Размах", "Обратный замах", "Мешающее", "Круговая атака", "Метательное", "Боеприпас", "Дистанция. (Дис.)", "Минимальная сила", "Смертельное", "Дополнительные свойства"],
    stableKeyHeader: "Название",
    adapter: "weapons",
    outputCatalog: "gear"
  }),
  firearms: declaration(4, {
    sheetTitle: "Огнестрел V0.36",
    range: "A1:AA961",
    headerRows: [1, 2],
    dataStartRow: 3,
    requiredHeaders: ["Название", "Год изобретения (распространения)", "Урон", "Тип урона", "Цена (ЗМ)", "Ранг", "Вес", "Оружейная группа", "Дальность", "Руки", "Осечка", "Боеприпасы", "Тип стрельбы", "Перезарядка"],
    optionalHeaders: ["Свойство боеприпасов", "Минимальная сила", "Различие конструкции", "Внезапность", "Дополнительные свойства"],
    stableKeyHeader: "Название",
    adapter: "weapons",
    outputCatalog: "gear"
  }),
  attachments: declaration(5, {
    sheetTitle: "Улучшения и обвесы V0.2",
    range: "A1:AA1010",
    headerRows: [],
    dataStartRow: 1,
    layout: "raw",
    requiredHeaders: [],
    stableKeyHeader: null,
    sections: Object.freeze([
      Object.freeze({ name: "weaponAttachments", range: "B8:G24", headerRow: 8 }),
      Object.freeze({ name: "modernizedParts", range: "B26:H1010", headerRow: 26 })
    ]),
    adapter: "attachments",
    outputCatalog: "gear"
  }),
  ammunition: declaration(6, {
    sheetTitle: "Боеприпасы",
    range: "B1:G1005",
    headerRows: [],
    dataStartRow: 1,
    layout: "raw",
    requiredHeaders: [],
    stableKeyHeader: null,
    sections: Object.freeze([
      Object.freeze({ name: "standardAmmunition", range: "B3:F17", headerRow: 3 }),
      Object.freeze({
        name: "handCannonAmmunition",
        range: "B19:G1005",
        headerRow: 19,
        headers: Object.freeze(["Боеприпас", "Цена", "Ранг", "Эффект", "Вес", "Правило ручницы"])
      })
    ]),
    adapter: "ammunition",
    outputCatalog: "gear"
  }),
  specialAmmunition: declaration(7, {
    sheetTitle: "Особые боеприпасы",
    range: "B2:H1000",
    headerRows: [3],
    dataStartRow: 4,
    requiredHeaders: ["Боеприпас", "Цена", "Ранг", "Заменяет", "Вес", "Свойства", "Осечка при крафте"],
    stableKeyHeader: "Боеприпас",
    legacyMirrors: [{
      sheetTitle: "Особые боеприпа",
      range: "A1:G999",
      requireEquivalent: true
    }],
    adapter: "ammunition",
    outputCatalog: "gear"
  }),
  armor: declaration(8, {
    sheetTitle: "Доспехи V0.1",
    range: "A1:H999",
    headerRows: [1],
    dataStartRow: 3,
    requiredHeaders: ["Название", "Цена (зм)", "Ранг", "Вес (фнт)", "Класс доспеха (КД)", "Сила", "Скрытность"],
    optionalHeaders: ["Дополнительные свойства"],
    stableKeyHeader: "Название",
    adapter: "armor",
    outputCatalog: "gear"
  }),
  explosives: declaration(9, {
    sheetTitle: "Взрывчатка V0.0",
    range: "A1:N1000",
    headerRows: [1, 2],
    dataStartRow: 3,
    requiredHeaders: ["Название", "Урон", "Тип урона", "Цена", "Ранг", "Вес", "Оружейная группа", "Сл взрывчатки", "Радиус взрыва"],
    optionalHeaders: ["Время задержки", "Механизм срабатывания", "Обезвреживание", "Дистанция", "Дополнительные свойства"],
    stableKeyHeader: "Название",
    adapter: "explosives",
    outputCatalog: "gear"
  }),
  implants: declaration(10, {
    sheetTitle: "Импланты V0.1",
    range: "A1:AC1000",
    headerRows: [],
    dataStartRow: 1,
    layout: "raw",
    requiredHeaders: ["Название", "Ранг", "Очки модификации", "Эффект", "Требования", "Цена (ЗМ ) и Источник", "Тип"],
    stableKeyHeader: "Название",
    adapter: "implants",
    outputCatalog: "implants"
  }),
  upgrades: declaration(11, {
    sheetTitle: "Усовершенствования V0.21",
    range: "A1:G1000",
    headerRows: [1],
    dataStartRow: 2,
    requiredHeaders: ["Название", "Ранг", "Применимо к", "Эффект", "Цена (зм)", "Источник", "Тип"],
    stableKeyHeader: "Название",
    adapter: "upgrades",
    outputCatalog: "upgrades"
  }),
  materials: declaration(12, {
    sheetTitle: "Энциклопедия материалов",
    range: "A1:M1065",
    headerRows: [1, 2],
    dataStartRow: 3,
    requiredHeaders: ["Название", "Тип", "Цена (зм)", "Вес (фнт)", "Ранг", "Описание"],
    optionalHeaders: ["Подтип / добыча", "Усовершенствование", "Имплант", "Создание и Снаряжение", "Алхимия", "Знания", "Аспекты (алхимия)"],
    stableKeyHeader: "Название",
    adapter: "materials",
    outputCatalog: "materials"
  }),
  magicItems: declaration(13, {
    sheetTitle: "Магические предметы V0",
    range: "A1:R1004",
    headerRows: [1],
    dataStartRow: 2,
    requiredHeaders: ["№", "Название", "Редкость", "Тип", "Источник", "Ранг", "Стоимость", "Настройка", "Описание", "Value"],
    optionalHeaders: ["Подтип", "Слот", "Материалы", "Торги", "Влиятельность", "Настройка детали", "Расходник", "РЕВОРК"],
    stableKeyHeader: "№",
    adapter: "magicItems",
    outputCatalog: "magicItems"
  }),
  transport: declaration(14, {
    sheetTitle: "Транспорт V0.1",
    range: "A1:V1002",
    headerRows: [1],
    dataStartRow: 3,
    requiredHeaders: ["Название", "Тип транспорта", "Цена", "Ранг", "КД", "Скорость (сражение)", "Экипаж", "Пассажиры", "Размер", "Грузоподъемность"],
    optionalHeaders: ["Год изобретения (распространения)", "Цена аренды", "Вес", "Хиты", "Разгон (футы)", "Скорость путешествия", "Граница поломки (к20)", "Топливо или корм и расход", "Топливный бак", "Запас хода", "Сила", "Описание"],
    stableKeyHeader: "Название",
    adapter: "transport",
    outputCatalog: "transport"
  })
});
