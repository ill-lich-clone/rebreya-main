import { ImportDiagnosticError, createImportDiagnostic, throwIfDiagnostics } from "../validation.mjs";

const SLOT_DECLARATIONS = new Map([
  ["Верх", { mode: "oneOf", values: ["top"] }],
  ["Сторона или низ", { mode: "oneOf", values: ["side", "bottom"] }],
  ["Сторона, низ", { mode: "oneOf", values: ["side", "bottom"] }],
  ["Низ + ствол", { mode: "all", values: ["bottom", "barrel"] }],
  ["Ствол", { mode: "oneOf", values: ["barrel"] }],
  ["Сторона", { mode: "oneOf", values: ["side"] }]
]);
const COMPATIBILITY = new Map([
  ["Длиноствольное оружие", ["long-firearm"]],
  ["Короткоствольное оружие", ["short-firearm"]],
  ["Короткоствольному оружие, на котором установленная пистолетная рукоять", ["short-firearm-with-pistol-grip"]],
  ["Винтовки, карабины", ["rifle", "carbine"]],
  ["Дробовики", ["shotgun"]],
  ["Мушкеты, кремнивые пистолеты, аркебузы, колесцовые оружия", ["musket", "flintlock-pistol", "arquebus", "wheellock"]],
  ["Всё огнестрельное оружие", ["all-firearms"]],
  ["Любому оружие, что имеет \"Смену магазина\" или \"Долгую смену магазина\"", ["magazine-fed-firearm"]]
]);

function text(value) { return String(value ?? "").trim(); }
function context(snapshot, rowNumber, column) {
  return { sheetKey: snapshot.sheetKey, range: snapshot.range, rowNumber, column };
}
function fail(code, value, ctx, message) {
  throw new ImportDiagnosticError(message, [createImportDiagnostic({ code, value, message, ...ctx })]);
}
function exactReference(snapshot, rowNumber, referenceIndex, diagnostics) {
  const sourceRef = `${snapshot.sheetTitle}!B${rowNumber}`;
  const reference = referenceIndex?.gearBySourceRef?.get(sourceRef);
  if (!reference) {
    diagnostics.push(createImportDiagnostic({
      code: "missing-equipment-reference", sheetKey: snapshot.sheetKey, range: snapshot.range,
      rowNumber, column: "Название", value: snapshot.values?.[rowNumber - 1]?.[1] ?? "",
      message: `Missing exact equipment reference for ${sourceRef}`
    }));
    return null;
  }
  return referenceIndex.resolveStableGearId(reference);
}

export function adaptAttachmentProfiles({ snapshot, referenceIndex, diagnostics = [] }) {
  if (!snapshot || snapshot.layout !== "raw") fail("missing-attachment-snapshot", "", {}, "Raw attachment snapshot is required");
  const fragments = new Map();
  for (let rowNumber = 9; rowNumber <= 24; rowNumber += 1) {
    const row = snapshot.values?.[rowNumber - 1] ?? [];
    if (!text(row[1])) continue;
    const slots = SLOT_DECLARATIONS.get(text(row[5]));
    if (!slots) fail("unknown-attachment-slot", row[5], context(snapshot, rowNumber, "Место"), `Unknown attachment slot: ${text(row[5])}`);
    const stableId = exactReference(snapshot, rowNumber, referenceIndex, diagnostics);
    if (!stableId) continue;
    fragments.set(stableId, { attachment: {
      kind: "weaponAttachment", slots: structuredClone(slots), compatibility: [], propertiesText: text(row[6])
    } });
  }
  for (let rowNumber = 27; rowNumber <= (snapshot.values?.length ?? 0); rowNumber += 1) {
    const row = snapshot.values?.[rowNumber - 1] ?? [];
    if (!text(row[1])) continue;
    const compatibility = COMPATIBILITY.get(text(row[5]));
    if (!compatibility) {
      fail("missing-attachment-compatibility", row[5], context(snapshot, rowNumber, "Применимо к"), `Unknown attachment compatibility: ${text(row[5])}`);
    }
    const stableId = exactReference(snapshot, rowNumber, referenceIndex, diagnostics);
    if (!stableId) continue;
    fragments.set(stableId, { attachment: {
      kind: "modernizedPart", slots: null, compatibility: [...compatibility], propertiesText: text(row[7])
    } });
  }
  throwIfDiagnostics(diagnostics, "Attachment profile adaptation failed");
  return fragments;
}
