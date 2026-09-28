function clean(value) {
  return String(value ?? "").trim();
}

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

export function resolveCityViewMode({ isGM = false, requestedMode = "admin" } = {}) {
  return isGM && requestedMode === "admin" ? "admin" : "public";
}

export function openCityImagePicker({
  current = "",
  pickerClass = globalThis.foundry?.applications?.apps?.FilePicker?.implementation ?? globalThis.FilePicker,
  onSelected,
  onError
} = {}) {
  if (typeof pickerClass !== "function") throw new Error("Foundry image picker is unavailable.");
  const picker = new pickerClass({
    type: "image",
    current: clean(current),
    callback: async (path) => {
      const selected = clean(path);
      if (!selected) return;
      try {
        await onSelected?.(selected);
      }
      catch (error) {
        onError?.(error);
      }
    }
  });
  void picker.render({ force: true });
  return picker;
}

export async function promptCityDescription({
  city,
  dialogClass = globalThis.foundry?.applications?.api?.DialogV2
} = {}) {
  if (typeof dialogClass?.prompt !== "function") throw new Error("Foundry dialog is unavailable.");
  return dialogClass.prompt({
    window: { title: `Описание: ${clean(city?.name) || "Город"}` },
    content: `<form class="rm-city-description-dialog"><textarea name="description" maxlength="5000" rows="12">${escapeHtml(city?.description)}</textarea></form>`,
    ok: {
      label: "Сохранить",
      callback: (_event, button) => clean(button?.form?.elements?.description?.value)
    },
    rejectClose: false
  });
}
