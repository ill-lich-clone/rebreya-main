import { ALCHEMY_ASPECTS } from "../data/alchemy-aspects.js";
import { getPlantExtractionData } from "../data/alchemy-extraction-service.js";
import { escapeFoundryHtml as escape } from "../shared/foundry-values.js";

function sourceScope(item, moduleApi, user) {
  if (!user || item?.type !== "loot" || !item.parent) return null;
  const groups = moduleApi.groupContextService;
  const holder = item.parent;
  let reference;
  try {
    reference = holder.type === "group" ? groups.resolveReferenceForGroup(holder.id) : groups.resolveReferenceForCurrentUser();
  } catch {
    return null;
  }
  const actors = (reference?.members ?? []).filter((actor) => actor.type === "character"
    && (holder.type === "group" || holder.id === actor.id)
    && (user.isGM || actor.testUserPermission(user, "OWNER")));
  return actors.length ? { groupId: reference.groupId, actors } : null;
}

export async function bindAlchemyExtractionAction(root, item, moduleApi, {
  user = globalThis.game?.user, open = openAlchemyExtractionDialog
} = {}) {
  if (!moduleApi?.alchemyExtractionService || !sourceScope(item, moduleApi, user)
    || root.querySelector("[data-alchemy-extraction]")) return false;
  const { materialById } = await moduleApi.getModel();
  if (!getPlantExtractionData(item, materialById) || root.querySelector("[data-alchemy-extraction]")) return false;
  const button = root.ownerDocument.createElement("button");
  button.type = "button";
  button.className = "rm-alchemy-extraction-action";
  button.dataset.alchemyExtraction = "";
  button.textContent = "Расщепить на аспекты";
  button.addEventListener("click", async () => {
    if (button.disabled) return;
    button.disabled = true;
    try { await open(item, moduleApi); }
    catch (error) { globalThis.ui?.notifications?.warn?.(error.message); }
    finally { button.disabled = false; }
  });
  (root.querySelector(".sheet-header") ?? root).prepend(button);
  return true;
}

function renderPlant(row, index, item) {
  const isSource = row.actorId === item.parent.id && row.itemId === item.id;
  const aspects = Object.entries(row.baseYield).map(([kind, amount]) => `${amount} ${ALCHEMY_ASPECTS[kind].code}`).join(", ");
  return `<label class="rm-alchemy-extraction-row"><span>${escape(row.name)} · ${escape(row.actorName)}<small>${aspects} за порцию · доступно ${row.available}</small></span>
    <input type="number" min="0" max="${row.available}" step="1" value="${isSource ? 1 : 0}" data-extract-index="${index}"></label>`;
}

function readDraft(root, groupId, previews) {
  const actorId = root?.querySelector("[name='actorId']")?.value;
  const preview = previews.get(actorId);
  if (preview?.pending) return preview.pending;
  if (!preview?.tool) return null;
  const part = [...root.querySelectorAll("[data-extract-actor]")].find((row) => row.dataset.extractActor === actorId);
  const ingredients = [];
  for (const input of part?.querySelectorAll("[data-extract-index]") ?? []) {
    const quantity = Number(input.value);
    const row = preview.plants[Number(input.dataset.extractIndex)];
    if (!row || !Number.isSafeInteger(quantity) || quantity < 0 || quantity > row.available) return null;
    if (quantity > 0) ingredients.push({ actorId: row.actorId, itemId: row.itemId, quantity });
  }
  return ingredients.length ? { groupId, actorId, ingredients } : null;
}

export async function openAlchemyExtractionDialog(item, moduleApi, {
  user = globalThis.game?.user, DialogV2 = globalThis.foundry?.applications?.api?.DialogV2
} = {}) {
  const scope = sourceScope(item, moduleApi, user);
  if (!scope || !DialogV2) throw new Error("Нет доступного алхимика в группе.");
  const { groupId, actors } = scope;
  const previews = new Map(await Promise.all(actors.map(async ({ id }) => [id, await moduleApi.alchemyExtractionService.preview({ groupId, actorId: id })])));
  const defaultActorId = actors.find((actor) => actor.id === user.character?.id)?.id ?? actors[0].id;
  const choices = actors.map(({ id, name }) => `<option value="${escape(id)}" ${id === defaultActorId ? "selected" : ""}>${escape(name)}</option>`).join("");
  const parts = actors.map(({ id }) => {
    const { plants, pending, tool } = previews.get(id);
    let body = plants.map((row, rowIndex) => renderPlant(row, rowIndex, item)).join("");
    if (pending) body = "<p>Есть незавершённая партия. Подтверждение повторит её обработку.</p>";
    else if (!tool) body = "<p>Нужны исправные инструменты алхимика.</p>";
    else if (!plants.length) body = "<p>Нет доступных целых порций растений.</p>";
    return `<fieldset data-extract-actor="${escape(id)}" ${id === defaultActorId ? "" : "hidden disabled"}>${body}</fieldset>`;
  }).join("");
  const selection = await DialogV2.wait({
    window: { title: "Расщепить на аспекты" },
    position: { width: 510 },
    content: `<div class="rm-alchemy-extraction"><p>10 игровых минут · Интеллект (Инструменты алхимика)</p>
      <label ${actors.length === 1 ? "hidden" : ""}>Алхимик <select name="actorId">${choices}</select></label>${parts}</div>`,
    render: (_event, dialog) => {
      const content = dialog.element.querySelector(".rm-alchemy-extraction");
      const select = content.querySelector("[name='actorId']");
      const cancel = dialog.element.querySelector("[data-action='cancel']");
      if (cancel) cancel.formNoValidate = true;
      const confirm = dialog.element.querySelector("[data-action='extract']");
      const update = () => { confirm.disabled = !readDraft(content, groupId, previews); };
      content.addEventListener("input", update);
      select.addEventListener("change", () => {
        for (const part of content.querySelectorAll("[data-extract-actor]")) part.hidden = part.disabled = part.dataset.extractActor !== select.value;
        update();
      });
      update();
    },
    buttons: [{
      action: "extract", label: "Расщепить", default: true,
      callback: (_event, button) => {
        const draft = readDraft(button.form, groupId, previews);
        return draft ? { ...draft, operationId: draft.operationId ?? globalThis.foundry.utils.randomID() } : false;
      }
    }, { action: "cancel", label: "Отмена", callback: () => false }],
    close: () => null,
    rejectClose: false
  });
  return selection ? moduleApi.mutateAlchemyExtraction(selection) : null;
}
