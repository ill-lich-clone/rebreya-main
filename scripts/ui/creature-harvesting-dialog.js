import { escapeFoundryHtml as escape } from "../shared/foundry-values.js";
import { HARVEST_DCS, HARVEST_MINUTES } from "../data/creature-harvesting.js?v=1.5.73";

const button = (action, label, callback = () => ({ action })) => ({ action, label, callback });
const values = control => new FormData(control.form);
const str = (form, key) => String(form.get(key) ?? "").trim();
const num = (form, key) => str(form, key) === "" ? null : Number(str(form, key));
const checkLabel = check => {
  const [ability, skill] = check.split(":");
  const labels = globalThis.CONFIG?.DND5E;
  const abilityLabel = labels?.abilities?.[ability]?.label ?? ({ str: "Сила", dex: "Ловкость", con: "Телосложение",
    int: "Интеллект", wis: "Мудрость", cha: "Харизма" })[ability];
  const skillLabel = labels?.skills?.[skill]?.label ?? ({ sur: "Выживание", arc: "Магия", slt: "Ловкость рук", ath: "Атлетика" })[skill];
  const localize = label => globalThis.game?.i18n?.localize(label) ?? label;
  return skillLabel ? `${localize(abilityLabel)} (${localize(skillLabel)})` : localize(abilityLabel ?? check);
};

const rules = `<details><summary>Правила разделки</summary>
  <p>Одна попытка на тело в течение часа после смерти. Разделка занимает ${HARVEST_MINUTES} минут. Гуманоидов разделывать нельзя.</p>
  <p>Сл от 0-го до 9-го ранга — ${HARVEST_DCS.join(", ")}. Для 10-го ранга Сл задаёт Мастер.</p>
  <p>Провал на 5 и более — урон от действия существа. Провал на 1–4 — один случайный материал. Успех — обычные трофеи. Успех на 5 и более — ещё и уникальный трофей.</p>
  <p><a href="https://docs.google.com/document/d/1a2k-CnJxJWiX7aC3nPbLt3TIaQD5_0cGsl0I1Iihy3E/edit" target="_blank" rel="noopener">БЕТА-заметки</a></p></details>`;

export async function openCreatureHarvestingDialog(request, { DialogV2 = globalThis.foundry.applications.api.DialogV2 } = {}) {
  const wait = (content, buttons) => DialogV2.wait({ window: { title: "Разделка" }, content, buttons,
    rejectClose: false, close: () => null });
  const showResult = async ({ outcome, total, dc, loot }) => {
    const message = { severe: "Тяжёлый провал. Мастер применяет урон от уместного действия существа.",
      partial: "Лёгкий провал.", success: "Успех.", exceptional: "Успех на 5 и более.", closed: "Попытка закрыта." }[outcome];
    const roll = total === null ? "" : `<p>Результат ${escape(total)} · Сл ${escape(dc)}</p>`;
    const items = loot.length ? `<ul>${loot.map(item => `<li>${escape(item.name)}</li>`).join("")}</ul>` : "";
    await wait(`${roll}<p>${message}</p>${items}<p>Мастер отмечает ${HARVEST_MINUTES} игровых минут.</p>`, [button("close", "Закрыть")]);
  };
  let selection = {};
  for (;;) {
    const info = await request({ action: "read", ...selection });
    if (info.result) return showResult(info.result);
    const admin = Boolean(info.config);
    const monster = info.choices.length === 1 ? info.choices[0] : null;
    let content = info.message ? `<p>${escape(info.message)}</p>` : "";
    if (monster) content += `<p>${escape(monster.name)} · ${monster.rank} ранг${info.dc === null ? "" : ` · Сл ${info.dc}`}</p>
      <p>${escape(checkLabel(info.check))} · ${HARVEST_MINUTES} мин.</p>`;
    const buttons = [];
    if (!info.reason && (info.attempt === "resolved" || monster)) {
      buttons.push(button("begin", info.attempt === "resolved" ? "Завершить выдачу" : "Проверка", () => ({
        action: "begin", monsterId: info.attemptMonsterId ?? monster?.id, ...(selection.name ? { name: selection.name } : {})
      })));
    }
    if (!info.attempt && ["monster", "ambiguous"].includes(info.reason)) {
      const options = info.choices.map(choice => `<option value="${escape(choice.id)}">${escape(choice.name)} · ${escape(choice.type)} · ${choice.rank} ранг</option>`).join("");
      if (options) {
        content += `<label>Запись чудовища<select name="monsterId">${options}</select></label>`;
        buttons.push(button("select", "Выбрать", (_event, control) => ({ action: "select", monsterId: str(values(control), "monsterId") })));
      }
      if (info.reason === "monster" || selection.name) {
        content += `<label>Имя аналога<input type="text" name="analogue" maxlength="240" value="${escape(selection.name ?? "")}"></label>`;
        buttons.push(button("search", "Найти", (_event, control) => ({ action: "search", name: str(values(control), "analogue") })));
      }
    }
    if (admin && !info.attempt && info.reason !== "humanoid") buttons.push(button("configure", "Настроить"));
    if (admin && info.reason === "rolling") buttons.push(button("resolve", "Восстановить"));
    buttons.push(button("close", "Закрыть"));
    const next = await wait(`${content}${rules}`, buttons);
    if (!next || next.action === "close") return;
    if (next.action === "search") { selection = next.name ? { name: next.name } : {}; continue; }
    if (next.action === "select") { selection = { ...selection, monsterId: next.monsterId }; continue; }
    if (next.action === "configure") {
      const skills = Object.entries(globalThis.CONFIG?.DND5E?.skills ?? {}).map(([key, value]) => `${value.ability}:${key}`);
      const checks = [...new Set([info.check, "wis:sur", "int:arc", "dex:slt", "str:ath", ...skills, "str", "dex", "con", "int", "wis", "cha"])];
      const checkOptions = checks.map(check => `<option value="${check}"${check === info.check ? " selected" : ""}>${escape(checkLabel(check))}</option>`).join("");
      const config = await wait(`<label>Сколько минут прошло после смерти<input type="number" name="minutes" min="0" step="any" value="${Number.isFinite(info.diedAt) ? (info.now - info.diedAt) / 60 : ""}"></label>
        ${info.reason === "type" || info.config.type ? `<label>Тип тела<input name="type" value="${escape(info.config.type ?? "")}"></label>` : ""}
        <label>Проверка<select name="check">${checkOptions}</select></label>
        <label>Сл для 10-го ранга<input type="number" name="dc" min="1" value="${escape(info.config.dc ?? "")}"></label>
        <label>Кровь<select name="blood"><option value="">По типу тела</option><option value="yes"${info.config.blood === true ? " selected" : ""}>Есть</option><option value="no"${info.config.blood === false ? " selected" : ""}>Нет</option></select></label>`,
      [button("save", "Сохранить", (_event, control) => {
        const form = values(control), minutes = num(form, "minutes"), blood = str(form, "blood");
        return { diedAt: minutes === null ? null : info.now - minutes * 60, type: str(form, "type") || null,
          check: str(form, "check"), dc: num(form, "dc"), blood: blood ? blood === "yes" : null };
      }), button("cancel", "Отмена", () => false)]);
      if (config) await request({ action: "configure", config });
      continue;
    }
    if (next.action === "resolve") {
      const resolved = await wait('<label>Подтверждённый итог<input type="number" name="total" step="any"></label>', [
        button("save", "Применить итог", (_event, control) => {
          const total = num(values(control), "total");
          return total === null ? false : { action: "resolve", total };
        }), button("discard", "Закрыть без добычи", () => ({ action: "resolve", total: null })),
        button("cancel", "Отмена", () => false)
      ]);
      if (resolved) return showResult(await request(resolved));
      continue;
    }
    return showResult(await request(next));
  }
}
