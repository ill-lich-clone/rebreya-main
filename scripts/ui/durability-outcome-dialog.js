function escapeHtml(value) {
  const text = String(value ?? "");
  const escape = globalThis.foundry?.utils?.escapeHTML;
  if (typeof escape === "function") return escape(text);
  return text
    .replace(/&/gu, "&amp;")
    .replace(/</gu, "&lt;")
    .replace(/>/gu, "&gt;")
    .replace(/"/gu, "&quot;")
    .replace(/'/gu, "&#39;");
}

export async function promptDurabilityOutcome({
  name = "Предмет",
  dialog = globalThis.foundry?.applications?.api?.DialogV2 ?? globalThis.DialogV2
} = {}) {
  if (typeof dialog?.wait !== "function") return null;
  const safeName = String(name ?? "").trim() || "Предмет";
  return dialog.wait({
    window: { title: `${safeName}: 0 HP` },
    content: `<p>Что сделать с объектом «${escapeHtml(safeName)}»?</p>`,
    buttons: [
      {
        action: "broken",
        label: "Сломать предмет",
        icon: "fa-solid fa-hammer",
        callback: () => "broken"
      },
      {
        action: "destroyed",
        label: "Разрушить предмет",
        icon: "fa-solid fa-burst",
        callback: () => "destroyed"
      }
    ],
    close: () => null
  });
}
