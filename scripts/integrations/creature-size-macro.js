import { EQUIPMENT_SIZES, EQUIPMENT_SIZE_LABELS } from "../data/equipment-size-rules.js?v=1.4.393";
const escape = value => String(value ?? "").replace(/[&<>"']/gu, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);

export async function runCreatureSizeMacro({ moduleApi = globalThis.game?.rebreyaMain, canvas = globalThis.canvas,
  DialogV2 = globalThis.foundry?.applications?.api?.DialogV2, notify = message => globalThis.ui?.notifications?.warn?.(message) } = {}) {
  const tokens = (canvas?.tokens?.controlled ?? []).map(token => token.document ?? token).filter(token => token.actor?.isOwner && token.isOwner);
  if (!tokens.length) { notify("Выберите подконтрольный токен существа на сцене."); return null; }
  const service = moduleApi.equipmentSizeService;
  const previews = tokens.map(token => service.getCreatureResizePreview(token));
  const content = `<p>Выберите существо, новый размер и оружие в руках для пересчёта.</p>${previews.map((p, index) => `<fieldset><legend><label><input type="radio" name="token" value="${index}" ${index === 0 ? "checked" : ""}> ${escape(tokens[index].name ?? tokens[index].actor.name)}</label></legend>
    <div class="form-group"><label>Размер существа</label><select name="size-${index}">${EQUIPMENT_SIZES.map(size => `<option value="${size}" ${size === p.size ? "selected" : ""}>${EQUIPMENT_SIZE_LABELS[size]}</option>`).join("")}</select></div>
    ${p.weaponRows.map(row => `<label style="display:block"><input type="checkbox" name="weapon-${index}" value="${escape(row.id)}" checked> ${escape(row.name)} ×${row.quantity} (${EQUIPMENT_SIZE_LABELS[row.size]})</label>`).join("") || "<p>В руках нет оружия.</p>"}</fieldset>`).join("")}`;
  const selected = await DialogV2.wait({ window: { title: "Изменить размер" }, content, rejectClose: false,
    buttons: [{ action: "resize", label: "Применить", default: true, callback: (_event, button) => {
      const form = button.form, index = Number(form.querySelector('[name="token"]:checked').value), p = previews[index];
      return { actorUuid: p.actorUuid, tokenUuid: p.tokenUuid, size: form.querySelector(`[name="size-${index}"]`).value,
        weaponIds: Array.from(form.querySelectorAll(`[name="weapon-${index}"]:checked`)).map(input => input.value), expected: p.expected };
    } }, { action: "cancel", label: "Отмена", callback: () => null }] });
  return selected ? service.requestCreatureResize(selected) : null;
}
