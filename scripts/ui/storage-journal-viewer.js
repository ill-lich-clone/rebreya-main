import { MODULE_ID } from "../constants.js";

export async function openStorageJournalViewer(snapshot, dependencies = {}) {
  const renderTemplate = dependencies.renderTemplate ?? globalThis.renderTemplate;
  const DialogV2 = dependencies.dialogClass ?? globalThis.foundry?.applications?.api?.DialogV2;
  const onRecord = dependencies.onRecord;
  const notifications = dependencies.notifications ?? globalThis.ui?.notifications;
  if (typeof renderTemplate !== "function" || typeof DialogV2 !== "function") {
    throw new Error("Storage Journal viewer is unavailable.");
  }
  const content = await renderTemplate(`modules/${MODULE_ID}/templates/storage-journal-viewer.hbs`, snapshot);
  const buttons = typeof onRecord === "function"
    ? [{
        action: "record",
        label: "Записать",
        default: true,
        callback: async () => {
          try {
            const result = await onRecord();
            notifications?.info?.(result?.created === false
              ? "Эта запись уже есть в инвентаре."
              : "Запись добавлена в инвентарь.");
            return result;
          }
          catch (error) {
            notifications?.error?.(error?.message || "Не удалось добавить запись в инвентарь.");
            return false;
          }
        }
      }]
    : [{
        action: "readonly",
        label: "",
        type: "button",
        disabled: true,
        class: "rm-storage-journal-viewer__sentinel",
        style: { display: "none" }
      }];
  const dialog = new DialogV2({
    classes: [
      "rm-storage-journal-dialog",
      ...(typeof onRecord === "function" ? [] : ["rm-storage-journal-dialog--readonly"])
    ],
    window: { title: String(snapshot?.name ?? "").trim() || "Запись журнала" },
    position: { width: 760, height: "auto" },
    content,
    buttons
  });
  return dialog.render(true);
}
