import { escapeFoundryHtml as escape } from "../../../../shared/foundry-values.js";
import { labels } from "../lib/utilities/card-labels.js";

function label(value) {
  const key = String(value ?? "");
  const translated = globalThis.game?.i18n?.localize?.(key) ?? key;
  return translated === key && Object.hasOwn(labels, key) ? labels[key] : translated;
}
export class DialogApp {
  static async dialog(title, content, inputs = [], buttons = "okCancel", config = {}) {
    let html = `<p>${escape(label(content))}</p>`;
    const choices = [];
    const fields = [];
    const limits = [];
    for (const [type, options, group = {}] of inputs) {
      const groupFields = [];
      for (const { label: text, name, options: opt = {} } of options) {
        if (type === "button") {
          choices.push({ name, text });
          continue;
        }
        const id = `card-field-${fields.length}`;
        const inputName = type === "radio" ? (group.radioName ?? "targets") : id;
        fields.push({ id, inputName, name, type });
        groupFields.push(id);
        let control;
        if (type === "selectOption") {
          control = `<select name="${id}">${(opt.options ?? []).map((o) => `<option value="${escape(o.value)}"${o.value === opt.currentValue ? " selected" : ""}>${escape(label(o.label))}</option>`).join("")}</select>`;
        } else if (type === "number" || type === "selectAmount") {
          control = `<input type="number" step="1" required name="${id}" min="${Number(opt.minAmount ?? 0)}" max="${Number(opt.maxAmount ?? 1)}" value="${Number(opt.currentAmount ?? opt.minAmount ?? 0)}">`;
        } else if (type === "radio" || type === "checkbox") {
          control = `<input type="${type}" name="${escape(inputName)}" value="${id}"${opt.isChecked ? " checked" : ""}>`;
        } else throw new Error(`Unsupported card input: ${type}`);
        html += `<label class="form-group"><span>${escape(label(text))}</span>${control}</label>`;
      }
      if (["number", "selectAmount"].includes(type) && Number.isFinite(group.totalMax))
        limits.push({ ids: groupFields, max: group.totalMax });
    }
    const read = (form) => {
      if (form?.reportValidity && !form.reportValidity()) return false;
      const result = { buttons: true };
      for (const { id, inputName, name, type } of fields) {
        const field = form.elements.namedItem(inputName);
        if (type === "radio") {
          if (field.value === id) result[inputName] = name;
        } else
          result[name] =
            type === "checkbox"
              ? field.checked
              : ["number", "selectAmount"].includes(type)
                ? field.valueAsNumber
                : field.value;
      }
      return result;
    };
    const actions = choices.map(({ name, text }, i) => ({
      action: `select-${i}`,
      label: label(text),
      callback: () => ({ buttons: name })
    }));
    if (!actions.length) {
      if (buttons !== "cancel")
        actions.push({
          action: "ok",
          label: buttons === "yesNo" ? "Yes" : "OK",
          default: true,
          callback: (_event, button) => read(button.form)
        });
      if (buttons !== "ok")
        actions.push({
          action: "cancel",
          label: buttons === "yesNo" ? "No" : "Cancel",
          type: "button",
          callback: () => false
        });
    }
    return (
      (await foundry.applications.api.DialogV2.wait({
        window: { title: label(title) },
        position: { width: config.width ?? 420 },
        content: html,
        buttons: actions,
        rejectClose: false,
        render: (_event, dialog) => {
          const form = dialog.element.matches("form") ? dialog.element : dialog.element.querySelector("form");
          if (!form || !limits.length) return;
          const validate = () => {
            for (const { ids, max } of limits) {
              const inputs = ids.map((id) => form.elements.namedItem(id));
              inputs[0]?.setCustomValidity(
                inputs.reduce((sum, input) => sum + input.valueAsNumber, 0) > max ? `Максимум: ${max}` : ""
              );
            }
            const accept = form.querySelector('[data-action="ok"]');
            if (accept) accept.disabled = !form.checkValidity();
          };
          form.addEventListener("input", validate);
          validate();
        }
      })) ?? false
    );
  }
}
