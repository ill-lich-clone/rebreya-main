import { MODULE_ID } from "../constants.js";
import { ALCHEMY_ASPECTS } from "../data/alchemy-aspects.js";

const roleLabels = { base: "Основа", aspect: "Аспект", component: "Компонент" };
const itemKey = ({ actorId, itemId, role }) => `${actorId}:${itemId}:${role}`;

export function buildAlchemyCraftingView(snapshot, { mode, productId, selection, search = "", catalystKey = "" }) {
  const laboratory = mode === "laboratory";
  const option = snapshot.options[selection.optionIndex];
  const manual = laboratory && option?.goldGp !== undefined;
  const searchKey = search.trim().toLocaleLowerCase("ru-RU");
  const quote = snapshot.quote;
  const prepared = !laboratory && snapshot.field?.status === "prepared";
  const values = new Map((snapshot.selection?.items ?? []).map((row) => [itemKey(row), row.quantity]));
  const errors = [...(quote?.errors ?? [])];
  if (laboratory && quote?.weeks > snapshot.availableWeeks) {
    errors.push({ message: "Недостаточно доступных недель простоя." });
  }
  const allRecipes = snapshot.recipes.filter(({ rank }) => laboratory || rank <= 5)
    .map((row) => ({ ...row, selected: row.id === productId, hidden: !row.name.toLocaleLowerCase("ru-RU").includes(searchKey),
      img: row.icon?.startsWith("modules/") ? row.icon : `modules/${MODULE_ID}/${row.icon}` }));
  const stock = snapshot.aspectStock ?? {};
  const needs = quote?.aspectNeeds ?? {};
  const aspectStock = Object.entries(ALCHEMY_ASPECTS).map(([kind, aspect]) => ({
    ...aspect, available: stock[kind] ?? 0
  }));
  const aspectNeeds = Object.entries(needs).map(([kind, required]) => ({
    name: ALCHEMY_ASPECTS[kind].name, available: stock[kind] ?? 0, required
  }));
  if (quote?.anyAspects) aspectNeeds.push({
    name: "Любые", required: quote.anyAspects,
    available: Object.entries(stock).reduce((sum, [kind, quantity]) => sum + Math.max(0, quantity - (needs[kind] ?? 0)), 0)
  });
  return {
    laboratory, fieldMode: !laboratory, manual, prepared, quote, errors,
    ready: Boolean(quote && !errors.length && !prepared),
    aspectStock, aspectNeeds,
    showFieldLoss: Boolean(!laboratory && quote && !errors.length),
    manualWeeks: selection.manualWeeks ?? "",
    manualGoldGp: selection.manualGoldGp ?? option?.goldGp,
    abilityWis: selection.ability === "wis",
    availableWeeks: snapshot.availableWeeks,
    toolRank: snapshot.toolRank ?? "—",
    field: snapshot.field,
    fieldResult: !laboratory && snapshot.field?.status === "completed",
    restMessageUuid: snapshot.restMessageUuid,
    laboratoryRequests: laboratory ? (snapshot.laboratoryRequests ?? []).map((request) => ({
      ...request,
      statusText: { completed: "ожидает выдачи", approved: "в работе", pending: "на рассмотрении" }[request.status]
    })) : [],
    search,
    product: snapshot.recipes.find(({ id }) => id === productId),
    recipes: allRecipes.filter(({ hidden }) => !hidden),
    allRecipes,
    options: snapshot.options.map((row, index) => ({ ...row, index, selected: index === selection.optionIndex })),
    catalysts: snapshot.catalysts.map((row) => ({ ...row, selected: row.key === catalystKey })),
    catalyst: snapshot.catalysts.find(({ key }) => key === catalystKey),
    stock: snapshot.stockOptions.map((row, index) => ({
      ...row, index, roleLabel: roleLabels[row.role],
      quantity: values.get(itemKey(row)) ?? 0,
      step: row.fractional ? "any" : "1"
    })),
    fieldLoss: quote?.failureDebits?.reduce((total, row) => total + row.quantity, 0),
    shelfLifeHours: quote?.output?.lifetimeSeconds / 3600
  };
}

const applications = globalThis.foundry?.applications?.api;
const ApplicationBase = applications ? applications.HandlebarsApplicationMixin(applications.ApplicationV2) : class {};

export class AlchemyCraftingApp extends ApplicationBase {
  static DEFAULT_OPTIONS = {
    id: "rebreya-alchemy-crafting", classes: ["rebreya-main", "rm-alchemy-crafting"],
    window: { title: "Алхимия", resizable: true }, position: { width: 570, height: "auto" }
  };
  static PARTS = { main: { template: `modules/${MODULE_ID}/templates/alchemy-crafting.hbs` } };

  constructor(moduleApi, groupId, actorId) {
    super();
    this.moduleApi = moduleApi;
    this.service = moduleApi.alchemyCraftingService;
    this.groupId = groupId;
    this.actorId = actorId;
    this.mode = "laboratory";
    this.search = "";
    this.error = "";
    this.resetRecipe("");
  }

  resetRecipe(productId) {
    this.productId = productId;
    this.catalystKey = "";
    this.selection = { optionIndex: 0, ability: this.selection?.ability ?? "int" };
  }

  async _prepareContext() {
    const group = this.moduleApi.groupContextService.resolveReferenceForGroup(this.groupId);
    const user = globalThis.game.user;
    const actors = group.members.filter((actor) => actor.type === "character" && (user.isGM || actor.testUserPermission(user, "OWNER")));
    if (!actors.some((actor) => actor.id === this.actorId)) {
      this.actorId = actors.some((actor) => actor.id === user.character?.id) ? user.character.id : actors[0]?.id;
    }
    if (!this.actorId) return { noActor: true };
    this.snapshot = await this.service.view({
      groupId: this.groupId, actorId: this.actorId, mode: this.mode,
      productId: this.productId, selection: this.selection, catalystKey: this.catalystKey
    });
    return {
      ...buildAlchemyCraftingView(this.snapshot, this),
      actors: actors.map((actor) => ({ id: actor.id, name: actor.name, selected: actor.id === this.actorId })),
      chooseActor: actors.length > 1, error: this.error, busy: this.busy
    };
  }

  async _onRender(context, options) {
    await super._onRender(context, options);
    this.renderListeners?.abort();
    this.renderListeners = new AbortController();
    const listenerOptions = { signal: this.renderListeners.signal };
    const element = this.element;
    element.querySelectorAll("[data-craft-expand]").forEach((details) => {
      const key = details.dataset.craftExpand;
      if (this.expanded?.has(key)) details.open = true;
      details.addEventListener("toggle", () => {
        this.expanded ??= new Set();
        if (details.open) this.expanded.add(key);
        else this.expanded.delete(key);
      }, listenerOptions);
    });
    const filter = element.querySelector("[data-craft-search]");
    if (filter) {
      filter.addEventListener("input", () => {
        this.search = filter.value;
        const query = this.search.trim().toLocaleLowerCase("ru-RU");
        for (const row of element.querySelectorAll("[data-craft-product]")) row.hidden = !row.textContent.toLocaleLowerCase("ru-RU").includes(query);
      }, listenerOptions);
    }
    element.addEventListener("change", (event) => {
      const input = event.target;
      if (input.name === "mode") {
        this.mode = input.value;
        this.resetRecipe(this.productId);
      } else if (input.name === "actor") {
        this.actorId = input.value;
        this.resetRecipe(this.productId);
      } else if (input.name === "option") {
        this.resetRecipe(this.productId);
        this.selection.optionIndex = Number(input.value);
      } else if (input.name === "catalyst") {
        this.catalystKey = input.value;
        delete this.selection.items;
      } else if (input.name === "ability") {
        this.selection.ability = input.value;
      } else if (input.name === "manualWeeks" || input.name === "manualGoldGp") {
        if (input.value === "") delete this.selection[input.name];
        else this.selection[input.name] = Number(input.value);
      } else if (input.dataset.craftStock !== undefined) {
        const chosen = [...element.querySelectorAll("[data-craft-stock]")].flatMap((field) => {
          const quantity = Number(field.value);
          const { actorId, itemId, role } = this.snapshot.stockOptions[Number(field.dataset.craftStock)];
          return quantity > 0 ? [{ actorId, itemId, role, quantity }] : [];
        });
        const catalyst = this.snapshot.catalysts.find(({ key }) => key === this.catalystKey);
        if (catalyst?.item) chosen.push(catalyst.item);
        this.selection.items = chosen;
      } else return;
      this.operationId = null;
      this.error = "";
      void this.render({ force: true });
    }, listenerOptions);
    element.addEventListener("click", (event) => {
      const button = event.target.closest("button");
      if (!button || this.busy) return;
      if (button.dataset.craftProduct) {
        this.operationId = null;
        this.resetRecipe(button.dataset.craftProduct);
        this.error = "";
        void this.render({ force: true });
      } else if (button.dataset.craftAction) {
        void this.runAction(button.dataset.craftAction);
      }
    }, listenerOptions);
  }

  async runAction(action) {
    this.busy = true;
    this.error = "";
    const scope = { groupId: this.groupId, actorId: this.actorId };
    try {
      if (action === "confirm") {
        if (!this.snapshot.quote || this.snapshot.quote.errors.length) return;
        this.operationId ??= foundry.utils.randomID();
        await this.moduleApi.mutateAlchemyCraft(this.mode === "laboratory" ? "submitLaboratory" : "prepareField", {
          ...scope, operationId: this.operationId, productId: this.productId, selection: this.snapshot.selection
        });
        this.operationId = null;
        this.resetRecipe("");
      } else if (action === "cancel" || action === "retry") {
        const operationId = this.snapshot.field.operationId;
        const payload = { ...scope, operationId };
        if (action === "retry") payload.restMessageUuid = this.snapshot.restMessageUuid;
        await this.moduleApi.mutateAlchemyCraft(action === "cancel" ? "cancelField" : "completeField", payload);
      }
    } catch (error) {
      this.error = error.message || "Действие недоступно.";
    } finally {
      this.busy = false;
      await this.render({ force: true });
    }
  }

  async _onClose(options) {
    this.renderListeners?.abort();
    await super._onClose(options);
  }
}
