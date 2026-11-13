import { EQUIPMENT_SPREADSHEET_ID, SHEET_REGISTRY } from "../sheet-registry.mjs";

const clean = value => String(value ?? "").trim();
const key = value => clean(value).normalize("NFC").toLocaleLowerCase("ru").replace(/\s+/g, " ");
const loot = value => /^[-–—]*$/.test(clean(value)) ? null : clean(value);

export function adaptMonstersCatalog({ sheetId, sheetTitle, values }, spreadsheetId = EQUIPMENT_SPREADSHEET_ID) {
  const expected = [["Название", "Тип существа", "Ранг монстра", "Добыча!"],
    ["", "", "", "Уникальная", "Тип существа", "Общие", "Общие", "Общие", "Общие"]];
  if (sheetId !== 1267718446 || sheetTitle !== SHEET_REGISTRY.monsters.sheetTitle
      || !expected.every((row, i) => row.every((name, j) => clean(values?.[i]?.[j]) === name))) {
    throw new Error("Invalid monster encyclopedia sheet or columns");
  }
  const firstRows = new Map();
  const records = [];
  for (const [index, row] of values.slice(2).entries()) {
    if (!row.some(cell => clean(cell))) continue;
    const rowNumber = index + 3;
    const [name, type, rawRank] = row.slice(0, 3).map(clean);
    if (!name || !type || !/^(?:[0-9]|10)$/.test(rawRank ?? "")) {
      throw new Error(`Invalid monster name, type or rank at row ${rowNumber}`);
    }
    const rank = Number(rawRank);
    const id = `monster:${key(name)}|${key(type)}|${rank}`;
    if (firstRows.has(id)) throw new Error(`Duplicate monster ${name} at rows ${firstRows.get(id)} and ${rowNumber}`);
    firstRows.set(id, rowNumber);
    records.push({ id, name, type, rank, unique: loot(row[3]), typeLoot: loot(row[4]),
      common: row.slice(5, 9).map(loot).filter(Boolean),
      source: { spreadsheetId, sheetName: sheetTitle, row: rowNumber } });
  }
  if (!records.length) throw new Error("Monster encyclopedia has no records");
  return records;
}
