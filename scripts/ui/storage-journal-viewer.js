import { MODULE_ID } from "../constants.js";

export async function openStorageJournalViewer(snapshot, dependencies = {}) {
  const renderTemplate = dependencies.renderTemplate ?? globalThis.renderTemplate;
  const DialogV2 = dependencies.dialogClass ?? globalThis.foundry?.applications?.api?.DialogV2;
  if (typeof renderTemplate !== "function" || typeof DialogV2 !== "function") {
    throw new Error("Storage Journal viewer is unavailable.");
  }
  const content = await renderTemplate(`modules/${MODULE_ID}/templates/storage-journal-viewer.hbs`, snapshot);
  const dialog = new DialogV2({
    window: { title: String(snapshot?.name ?? "").trim() || "Запись журнала" },
    position: { width: 760, height: "auto" },
    content,
    buttons: [{ action: "close", label: "Закрыть", default: true }]
  });
  return dialog.render(true);
}
