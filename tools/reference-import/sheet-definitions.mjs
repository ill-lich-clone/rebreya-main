export const REFERENCE_SPREADSHEET_ID = "1G-UCW00vsjON05fr0CgyK03YaF82oYJemlqNKdv1JBk";

export const NARRATIVE_SHEET_DEFINITION = Object.freeze({
  registryOrder: 0,
  sheetTitle: "Нарративное заполнение",
  range: "A1:D4000",
  layout: "raw",
  headerRows: Object.freeze([1]),
  dataStartRow: 2,
  requiredHeaders: Object.freeze([
    "Оригинальный предмет",
    "Название",
    "Нарративное описание",
    "Ранг"
  ]),
  optionalHeaders: Object.freeze([]),
  headers: Object.freeze([
    "Оригинальный предмет",
    "Название",
    "Нарративное описание",
    "Ранг"
  ])
});
