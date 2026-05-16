import { MODULE_ID, SETTINGS_KEYS } from "./constants.js";
import { MaterialsCompendiumService } from "./data/materials-compendium.js";
import { GearCompendiumService } from "./data/gear-compendium.js";
import { MagicItemsCompendiumService } from "./data/magic-items-compendium.js";
import { FeatsCompendiumService } from "./data/feats-compendium.js";
import { RacesCompendiumService } from "./data/races-compendium.js";
import { ClassesCompendiumService } from "./data/classes-compendium.js";
import { EconomyRepository } from "./data/repository.js";
import { TraderService } from "./data/trader-service.js";
import { InventoryService } from "./data/inventory-service.js";
import { HeroDollService } from "./data/hero-doll-service.js";
import { CraftingService } from "./data/crafting-service.js";
import { CalendarService } from "./data/calendar-service.js";
import { GlobalEventsService } from "./data/global-events-service.js";
import { registerCombatHooks } from "./combat/hooks.js";
import { CombatAttackService } from "./combat/attack-service.js";
import { CombatStatusService, registerCombatStatusConfig } from "./combat/status-service.js";
import { RaceAutomationService, SOCKET_EVENT_RACE_AUTOMATION } from "./combat/race-automation-service.js";
import { registerSceneControlsHook } from "./hooks.js";
import { extendDnd5eItemTypes, registerDnd5eSheetExtensions } from "./integrations/dnd5e-sheet-extensions.js";
import { registerSettings } from "./settings.js";
import { buildLootgenChatContent, buildLootgenStatusContent, registerLootgenChatHooks } from "./ui/lootgen-chat.js";
import { bringAppToFront, registerHandlebarsHelpers, rerenderApp } from "./ui.js";

const SOCKET_CHANNEL = `module.${MODULE_ID}`;
const SOCKET_EVENT_LOOTGEN_SHOW = "lootgen-show-result";
const SOCKET_EVENT_LOOTGEN_CLAIM_ROW = "lootgen-claim-row";
const SOCKET_EVENT_LOOTGEN_CLAIM_COINS = "lootgen-claim-coins";

function normalizeLookupText(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/['\u2019\u2018\u02BC\u02B9\u2032"\u201C\u201D\u00AB\u00BB]/gu, "")
    .replace(/\s+/gu, " ");
}

function normalizeTradeSourceType(value) {
  const compact = normalizeLookupText(value).replace(/[_\-\s]+/gu, "");
  if (["material", "materials", "материал", "материалы"].includes(compact)) {
    return "material";
  }

  if (["gear", "equipment", "loot", "снаряжение"].includes(compact)) {
    return "gear";
  }

  if (["magicitem", "magicitems", "magic", "magical", "магическийпредмет", "магия"].includes(compact)) {
    return "magicItem";
  }

  if (["feat", "feats", "черта", "черты", "умение"].includes(compact)) {
    return "feat";
  }

  return compact || "";
}

function parseCalendarIsoDate(value) {
  const text = String(value ?? "").trim();
  const match = text.match(/^(\d{1,6})-(\d{2})-(\d{2})$/u);
  if (!match) {
    return null;
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) {
    return null;
  }

  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year
    || date.getUTCMonth() !== month - 1
    || date.getUTCDate() !== day
  ) {
    return null;
  }

  return date;
}

function countMonthStartBoundaries(fromIsoDate, toIsoDate) {
  const fromDate = parseCalendarIsoDate(fromIsoDate);
  const toDate = parseCalendarIsoDate(toIsoDate);
  if (!fromDate || !toDate || toDate.getTime() <= fromDate.getTime()) {
    return 0;
  }

  let count = 0;
  const cursor = new Date(fromDate.getTime());
  while (cursor.getTime() < toDate.getTime()) {
    cursor.setUTCDate(cursor.getUTCDate() + 1);
    if (cursor.getUTCDate() === 1) {
      count += 1;
    }
  }

  return count;
}

function toNumber(value, fallback = 0) {
  const numericValue = Number(value ?? fallback);
  return Number.isFinite(numericValue) ? numericValue : fallback;
}

function filterVisibleGlobalEvents(events = []) {
  const rows = Array.isArray(events) ? events : [];
  if (game.user?.isGM) {
    return rows;
  }

  const showPublicEvents = game.settings.get(MODULE_ID, SETTINGS_KEYS.GLOBAL_EVENTS_SHOW_PUBLIC) === true;
  if (!showPublicEvents) {
    return [];
  }

  return rows.filter((event) => event?.visibility?.gmOnly === false);
}

class RebreyaMainModule {
  constructor() {
    this.repository = new EconomyRepository();
    this.materialsCompendium = new MaterialsCompendiumService();
    this.gearCompendium = new GearCompendiumService();
    this.magicItemsCompendium = new MagicItemsCompendiumService();
    this.featsCompendium = new FeatsCompendiumService();
    this.racesCompendium = new RacesCompendiumService();
    this.classesCompendium = new ClassesCompendiumService();
    this.traderService = new TraderService(this);
    this.inventoryService = new InventoryService(this);
    this.heroDollService = new HeroDollService(this);
    this.craftingService = new CraftingService(this);
    this.calendarService = new CalendarService();
    this.globalEventsService = new GlobalEventsService(this);
    this.combatStatusService = new CombatStatusService(this);
    this.combatAttackService = new CombatAttackService(this);
    this.raceAutomationService = new RaceAutomationService(this);
    this.repository.setGlobalEventsService(this.globalEventsService);
    this.economyApp = null;
    this.worldTradeRoutesApp = null;
    this.statesApp = null;
    this.globalEventsApp = null;
    this.inventoryApp = null;
    this.lootgenApps = new Map();
    this.lootgenCounter = 0;
    this.latestLootgenResult = null;
    this.cityApps = new Map();
    this.traderApps = new Map();
    this.tradeRouteApps = new Map();
    this.referenceApps = new Map();
  }

  async initialize() {
    try {
      const calendarSnapshot = this.calendarService.getSnapshot();
      await this.globalEventsService.refreshEventActivationByDate(calendarSnapshot?.isoDate, null);
    }
    catch (error) {
      console.warn(`${MODULE_ID} | Failed to refresh global events activation during initialization.`, error);
    }

    const model = await this.repository.load();
    console.log(`${MODULE_ID} | Economy loaded`, {
      cities: model.cities.length,
      regions: model.regions.length,
      goods: model.goods.length,
      materials: model.materials.length,
      gear: model.gear.length,
      source: model.source
    });

    await this.#syncManagedCompendia(model);
    try {
      await this.traderService.cleanupLegacyManagedTraders();
    }
    catch (error) {
      console.warn(`${MODULE_ID} | Failed to cleanup legacy trader actors.`, error);
    }

    try {
      await this.combatStatusService.initialize();
    }
    catch (error) {
      console.warn(`${MODULE_ID} | Failed to initialize combat status service.`, error);
    }

    try {
      await this.combatAttackService.initialize();
    }
    catch (error) {
      console.warn(`${MODULE_ID} | Failed to initialize combat attack service.`, error);
    }

    try {
      await this.raceAutomationService.initialize();
    }
    catch (error) {
      console.warn(`${MODULE_ID} | Failed to initialize race automation service.`, error);
    }
  }

  async handleSocketMessage(message) {
    if (!message || typeof message !== "object") {
      return;
    }

    if (message.senderId && message.senderId === game.user?.id) {
      return;
    }

    if (message.type === SOCKET_EVENT_RACE_AUTOMATION) {
      await this.raceAutomationService.handleSocketMessage(message.payload ?? {});
      return;
    }

    if (message.type === SOCKET_EVENT_LOOTGEN_SHOW) {
      const payload = foundry.utils.deepClone(message.payload ?? {});
      this.latestLootgenResult = payload;
      await this.openLootgenApp({
        newWindow: false,
        viewer: true,
        sharedResult: payload
      });
    }

    if (message.type === SOCKET_EVENT_LOOTGEN_CLAIM_ROW && game.user?.isGM) {
      await this.claimLootgenChatRow(message.payload?.lootId, message.payload?.rowId, { quiet: true, fromSocket: true });
      return;
    }

    if (message.type === SOCKET_EVENT_LOOTGEN_CLAIM_COINS && game.user?.isGM) {
      await this.claimLootgenChatCoins(message.payload?.lootId, { quiet: true, fromSocket: true });
    }
  }

  async shareLootgenResult(payload = {}) {
    const sharedResult = foundry.utils.deepClone(payload ?? {});
    this.latestLootgenResult = sharedResult;

    game.socket?.emit?.(SOCKET_CHANNEL, {
      type: SOCKET_EVENT_LOOTGEN_SHOW,
      payload: sharedResult,
      senderId: game.user?.id ?? ""
    });
  }

  #findLootgenChatMessage(lootId) {
    const safeLootId = String(lootId ?? "").trim();
    if (!safeLootId) {
      return null;
    }

    return game.messages.contents.find((message) => {
      const state = message.getFlag(MODULE_ID, "lootgenChat") ?? null;
      return String(state?.lootId ?? "") === safeLootId;
    }) ?? null;
  }

  async #updateLootgenChatState(lootId, mutator) {
    const message = this.#findLootgenChatMessage(lootId);
    if (!message) {
      throw new Error("Сообщение с лутом не найдено.");
    }

    const state = foundry.utils.deepClone(message.getFlag(MODULE_ID, "lootgenChat") ?? {});
    state.lootId = String(state.lootId ?? lootId ?? "");
    state.rows = Array.isArray(state.rows) ? state.rows : [];
    state.coins = state.coins && typeof state.coins === "object" ? state.coins : {};
    const changed = await mutator(state);
    if (!changed) {
      return { message, state, changed: false };
    }

    await message.update({
      content: buildLootgenChatContent(state),
      [`flags.${MODULE_ID}.lootgenChat`]: state
    });

    return { message, state, changed: true };
  }

  #emitLootgenClaimRequest(type, payload = {}) {
    game.socket?.emit?.(SOCKET_CHANNEL, {
      type,
      payload: foundry.utils.deepClone(payload),
      senderId: game.user?.id ?? ""
    });
  }

  #notifyLootgenChatClaim(lootId, rowId, claimType) {
    for (const app of this.lootgenApps.values()) {
      app?.handleLootgenChatClaim?.(lootId, rowId, claimType);
    }
  }

  async createLootgenChatMessage(payload = {}, options = {}) {
    if (!game.user?.isGM) {
      throw new Error("Отправлять лут в чат может только ГМ.");
    }

    const rows = Array.isArray(payload.rows) ? payload.rows : [];
    const lootId = randomID();
    const appKey = String(options.appKey ?? "");
    const chatRows = [];

    for (const [index, row] of rows.entries()) {
      const rowId = randomID();
      const rowIndex = Number.isFinite(Number(row.rowIndex)) ? Number(row.rowIndex) : index;
      const item = await this.inventoryService.createLootgenChatItem(row, {
        lootId,
        rowId,
        appKey,
        rowIndex
      });

      if (!item) {
        throw new Error(`Не удалось подготовить предмет "${row.name ?? "лут"}" для чата.`);
      }

      chatRows.push({
        rowId,
        rowIndex,
        itemId: item.id,
        itemUuid: item.uuid,
        name: item.name,
        img: item.img,
        sourceType: row.sourceType,
        sourceId: row.sourceId,
        typeLabel: row.typeLabel,
        rank: row.rank,
        quantity: row.quantity,
        value: row.value,
        totalValue: row.totalValue,
        claimed: false
      });
    }

    const state = {
      lootId,
      appKey,
      createdBy: game.user?.id ?? "",
      generatedAt: String(payload.generatedAt ?? ""),
      rows: chatRows,
      coins: foundry.utils.deepClone(payload.coins ?? {}),
      coinsClaimed: Number(payload.coins?.totalCopper ?? 0) <= 0,
      spentValue: payload.spentValue ?? 0,
      budgetValue: payload.budgetValue ?? 0,
      totalItems: payload.totalItems ?? chatRows.reduce((sum, row) => sum + Number(row.quantity ?? 0), 0)
    };

    const message = await ChatMessage.create({
      user: game.user?.id,
      speaker: ChatMessage.getSpeaker(),
      content: buildLootgenChatContent(state),
      flags: {
        [MODULE_ID]: {
          lootgenChat: state
        }
      }
    });

    return {
      lootId,
      messageId: message?.id ?? "",
      rows: chatRows
    };
  }

  async claimLootgenChatRow(lootId, rowId, { quiet = false, fromSocket = false } = {}) {
    const safeLootId = String(lootId ?? "").trim();
    const safeRowId = String(rowId ?? "").trim();
    if (!safeLootId || !safeRowId) {
      return false;
    }

    if (!game.user?.isGM) {
      if (!fromSocket) {
        this.#emitLootgenClaimRequest(SOCKET_EVENT_LOOTGEN_CLAIM_ROW, { lootId: safeLootId, rowId: safeRowId });
      }
      return true;
    }

    let claimedRow = null;
    const result = await this.#updateLootgenChatState(safeLootId, (state) => {
      const row = state.rows.find((entry) => String(entry.rowId ?? "") === safeRowId) ?? null;
      if (!row || row.claimed) {
        return false;
      }

      row.claimed = true;
      claimedRow = row;
      return true;
    });

    if (!result.changed || !claimedRow) {
      return false;
    }

    await this.inventoryService.deleteLootgenChatItem(claimedRow.itemUuid);
    this.#notifyLootgenChatClaim(safeLootId, safeRowId, "row");
    if (!quiet) {
      ui.notifications?.info(`Лут "${claimedRow.name}" отмечен как забранный.`);
    }
    return true;
  }

  async #addLootgenCoinsToInventory(coins = {}) {
    const inventory = await this.getInventorySnapshot({ createActor: true });
    const current = inventory?.summary?.currency ?? {
      pp: 0,
      gp: 0,
      sp: 0,
      cp: 0
    };

    await this.updatePartyCurrency({
      pp: toNumber(current.pp, 0) + toNumber(coins.pp, 0),
      gp: toNumber(current.gp, 0) + toNumber(coins.gp, 0),
      sp: toNumber(current.sp, 0) + toNumber(coins.sp, 0),
      cp: toNumber(current.cp, 0) + toNumber(coins.cp, 0)
    });
  }

  async claimLootgenChatCoins(lootId, { quiet = false, fromSocket = false } = {}) {
    const safeLootId = String(lootId ?? "").trim();
    if (!safeLootId) {
      return false;
    }

    if (!game.user?.isGM) {
      if (!fromSocket) {
        this.#emitLootgenClaimRequest(SOCKET_EVENT_LOOTGEN_CLAIM_COINS, { lootId: safeLootId });
      }
      ui.notifications?.info("Запрос на добавление монет отправлен мастеру.");
      return true;
    }

    const message = this.#findLootgenChatMessage(safeLootId);
    const state = foundry.utils.deepClone(message?.getFlag(MODULE_ID, "lootgenChat") ?? {});
    if (!message || state.coinsClaimed) {
      return false;
    }

    const claimedCoins = foundry.utils.deepClone(state.coins ?? {});
    await this.#addLootgenCoinsToInventory(claimedCoins);
    state.coinsClaimed = true;
    await message.update({
      content: buildLootgenChatContent(state),
      [`flags.${MODULE_ID}.lootgenChat`]: state
    });

    this.#notifyLootgenChatClaim(safeLootId, "", "coins");
    if (!quiet) {
      ui.notifications?.info("Монеты из чат-лута добавлены в партийный склад.");
    }
    return true;
  }

  async handleLootgenChatItemCreated(item, _userId) {
    const claim = item?.getFlag?.(MODULE_ID, "lootgenChat") ?? null;
    if (!claim?.lootId || !claim?.rowId) {
      return false;
    }

    if (item.parent instanceof Actor && item.parent.getFlag(MODULE_ID, "managedLootgenChatActor")) {
      return false;
    }

    const result = await this.claimLootgenChatRow(claim.lootId, claim.rowId, { quiet: true });
    try {
      await item.unsetFlag(MODULE_ID, "lootgenChat");
    }
    catch (_error) {
      // The claim is already processed; leaving the metadata is safer than failing the drop.
    }
    return result;
  }

  async restoreLootgenClearFromChat(messageId) {
    if (!game.user?.isGM) {
      throw new Error("Восстановить лутген может только ГМ.");
    }

    const message = game.messages.get(messageId) ?? null;
    const status = foundry.utils.deepClone(message?.getFlag(MODULE_ID, "lootgenStatus") ?? {});
    if (!message || status.action !== "clear" || status.restored) {
      return false;
    }

    const appKey = String(status.appKey ?? "");
    const payload = foundry.utils.deepClone(status.payload ?? {});
    const app = this.lootgenApps.get(appKey) ?? null;
    if (!app || typeof app.restoreGeneratedResult !== "function") {
      throw new Error("Окно лутгена для восстановления не найдено.");
    }

    app.restoreGeneratedResult(payload);
    status.restored = true;
    status.message = "Очистка лутгена отменена.";
    await message.update({
      content: buildLootgenStatusContent(status),
      [`flags.${MODULE_ID}.lootgenStatus`]: status
    });
    return true;
  }

  async #syncManagedCompendia(model) {
    this.traderService.invalidatePackCache();

    try {
      await this.materialsCompendium.sync(model.materials);
    }
    catch (error) {
      console.error(`${MODULE_ID} | Failed to sync materials compendium.`, error);
      ui.notifications?.warn(game.i18n.localize("REBREYA_MAIN.Notifications.CompendiumSyncFailed"));
    }

    try {
      await this.gearCompendium.sync(model.gear);
    }
    catch (error) {
      console.error(`${MODULE_ID} | Failed to sync gear compendium.`, error);
      ui.notifications?.warn(game.i18n.localize("REBREYA_MAIN.Notifications.GearCompendiumSyncFailed"));
    }

    try {
      await this.magicItemsCompendium.sync();
    }
    catch (error) {
      console.error(`${MODULE_ID} | Failed to sync magic items compendium.`, error);
      ui.notifications?.warn("Не удалось синхронизировать компендиум магических предметов.");
    }

    try {
      await this.featsCompendium.sync();
    }
    catch (error) {
      console.error(`${MODULE_ID} | Failed to sync feats compendium.`, error);
      ui.notifications?.warn(game.i18n.localize("REBREYA_MAIN.Notifications.FeatsCompendiumSyncFailed"));
    }

    try {
      await this.racesCompendium.sync();
    }
    catch (error) {
      console.error(`${MODULE_ID} | Failed to sync races compendium.`, error);
      ui.notifications?.warn(game.i18n.localize("REBREYA_MAIN.Notifications.RacesCompendiumSyncFailed"));
    }

    try {
      await this.classesCompendium.sync();
    }
    catch (error) {
      console.error(`${MODULE_ID} | Failed to sync classes compendium.`, error);
      ui.notifications?.warn("Не удалось синхронизировать компендиумы классов и архетипов.");
    }
  }

  async getModel(options = {}) {
    return this.repository.load(options);
  }

  getCombatStatusDefinitions() {
    return this.combatStatusService.getStatusDefinitions();
  }

  normalizeCombatStatusId(statusInput, fallback = "") {
    return this.combatStatusService.normalizeStatusId(statusInput, fallback);
  }

  getCombatStatus(actorOrId, statusInput) {
    return this.combatStatusService.getStatus(actorOrId, statusInput);
  }

  async setCombatStatus(actorOrId, statusInput, options = {}) {
    const result = await this.combatStatusService.setStatus(actorOrId, statusInput, options);
    await this.refreshOpenApps();
    return result;
  }

  async clearCombatStatus(actorOrId, statusInput, options = {}) {
    const result = await this.combatStatusService.clearStatus(actorOrId, statusInput, options);
    await this.refreshOpenApps();
    return result;
  }

  async setCombatStatusValue(actorOrId, statusInput, value, meta = undefined) {
    const result = await this.combatStatusService.setStatusValue(actorOrId, statusInput, value, meta);
    await this.refreshOpenApps();
    return result;
  }

  async applyDecayingDamage(actorOrId, amount, options = {}) {
    const result = await this.combatStatusService.applyDecayingDamage(actorOrId, amount, options);
    await this.refreshOpenApps();
    return result;
  }

  async syncBloodiedStatuses() {
    const result = await this.combatStatusService.syncBloodiedForAllActors();
    await this.refreshOpenApps();
    return result;
  }

  getReactionState(actorOrId) {
    return this.combatAttackService.getReactionState(actorOrId);
  }

  canUseReaction(actorOrId, requiredUses = 1) {
    return this.combatAttackService.canUseReaction(actorOrId, requiredUses);
  }

  async refreshReaction(actorOrId, options = {}) {
    const result = await this.combatAttackService.refreshReaction(actorOrId, options);
    await this.refreshOpenApps();
    return result;
  }

  async consumeReaction(actorOrId, options = {}) {
    const result = await this.combatAttackService.consumeReaction(actorOrId, options);
    await this.refreshOpenApps();
    return result;
  }

  async rollWeaponAttack(actorOrId, weaponOrId, options = {}) {
    return this.combatAttackService.rollWeaponAttack(actorOrId, weaponOrId, options);
  }

  async rollFirearmAttack(actorOrId, weaponOrId, options = {}) {
    return this.combatAttackService.rollFirearmAttack(actorOrId, weaponOrId, options);
  }

  async resolveProvokedAttack(reactorOrId, targetOrId, options = {}) {
    return this.combatAttackService.resolveProvokedAttack(reactorOrId, targetOrId, options);
  }

  async resolveParry(defenderOrId, incomingAttackTotal, options = {}) {
    return this.combatAttackService.resolveParry(defenderOrId, incomingAttackTotal, options);
  }

  async resolveInterception(guardianOrId, targetOrId, incomingDamage, options = {}) {
    return this.combatAttackService.resolveInterception(guardianOrId, targetOrId, incomingDamage, options);
  }

  async handleGlobalEventsConfigChange() {
    await this.repository.rebuildModel();
    await this.refreshOpenApps();
    return this.repository.model;
  }

  getAllGlobalEvents() {
    return this.globalEventsService.getAllGlobalEvents();
  }

  getActiveGlobalEvents(currentDate = null) {
    const safeDate = currentDate ?? this.calendarService.getSnapshot()?.isoDate ?? null;
    return filterVisibleGlobalEvents(this.globalEventsService.getActiveGlobalEvents(safeDate));
  }

  getEventsAffectingCity(cityId, currentDate = null) {
    return filterVisibleGlobalEvents(
      this.globalEventsService.getEventsAffectingCity(cityId, currentDate, this.repository.dataset ?? null)
    );
  }

  getEventsAffectingCityGood(cityId, goodId, currentDate = null) {
    return filterVisibleGlobalEvents(
      this.globalEventsService.getEventsAffectingCityGood(cityId, goodId, currentDate, this.repository.dataset ?? null)
    );
  }

  getEventsAffectingRoute(fromCityId, toCityId, currentDate = null, connectionId = "") {
    return filterVisibleGlobalEvents(this.globalEventsService.getEventsAffectingRoute(
      fromCityId,
      toCityId,
      currentDate,
      this.repository.dataset ?? null,
      connectionId
    ));
  }

  getEventsAffectingState(stateId, currentDate = null) {
    return filterVisibleGlobalEvents(
      this.globalEventsService.getEventsAffectingState(stateId, currentDate, this.repository.dataset ?? null)
    );
  }

  getEffectiveStatePolicy(stateId, targetStateId = null, currentDate = null) {
    const basePolicy = this.repository.getStatePolicy(stateId);
    const effective = this.globalEventsService.getEffectiveStatePolicy(
      basePolicy,
      stateId,
      currentDate ?? this.calendarService.getSnapshot()?.isoDate ?? null,
      this.repository.dataset ?? null
    );

    if (targetStateId) {
      return {
        ...effective,
        resolvedBilateralDuty: toNumber(effective?.bilateralDuties?.[targetStateId], 0)
      };
    }

    return effective;
  }

  async createGlobalEvent(data = {}) {
    const event = await this.globalEventsService.createGlobalEvent(data);
    if (this.globalEventsService.isAutoRecalculateEnabled()) {
      await this.repository.rebuildModel();
    }
    await this.refreshOpenApps();
    return event;
  }

  async updateGlobalEvent(id, patch = {}) {
    const event = await this.globalEventsService.updateGlobalEvent(id, patch);
    if (this.globalEventsService.isAutoRecalculateEnabled()) {
      await this.repository.rebuildModel();
    }
    await this.refreshOpenApps();
    return event;
  }

  async deleteGlobalEvent(id) {
    const result = await this.globalEventsService.deleteGlobalEvent(id);
    if (this.globalEventsService.isAutoRecalculateEnabled()) {
      await this.repository.rebuildModel();
    }
    await this.refreshOpenApps();
    return result;
  }

  async duplicateGlobalEvent(id) {
    const duplicate = await this.globalEventsService.duplicateGlobalEvent(id);
    if (this.globalEventsService.isAutoRecalculateEnabled()) {
      await this.repository.rebuildModel();
    }
    await this.refreshOpenApps();
    return duplicate;
  }

  async importDefaultGlobalEventTemplates() {
    const imported = await this.globalEventsService.importDefaultGlobalEventTemplates();
    if (this.globalEventsService.isAutoRecalculateEnabled()) {
      await this.repository.rebuildModel();
    }
    await this.refreshOpenApps();
    return imported;
  }

  getCitySnapshot(cityId) {
    return this.repository.getCitySnapshot(cityId);
  }

  getTradeRouteSnapshot(connectionId) {
    return this.repository.getTradeRoute(connectionId);
  }

  getTradeRouteBaseSnapshot(connectionId) {
    return this.repository.getTradeRouteBase(connectionId);
  }

  getTradeRoutes() {
    return this.repository.getTradeRoutes();
  }

  hasTradeRouteAnalytics() {
    return this.repository.hasTradeRouteAnalytics();
  }

  async prepareTradeRouteAnalytics({ rerender = false } = {}) {
    await this.repository.prepareTradeRouteAnalytics();
    if (rerender) {
      await this.refreshOpenApps();
    }

    return this.repository.getTradeRoutes();
  }

  getReferenceEntrySnapshot(entryType, entryId) {
    return this.repository.getReferenceEntry(entryType, entryId);
  }

  getStatePolicies() {
    return this.repository.getStatePolicies();
  }

  async setConnectionActive(connectionId, isActive) {
    await this.repository.setConnectionActive(connectionId, isActive);
    await this.refreshOpenApps();
    return this.repository.model;
  }

  async updateReferenceDescription(entryType, entryId, description) {
    await this.repository.setReferenceNote(`${entryType}::${entryId}`, description);
    await this.refreshOpenApps();
    return this.getReferenceEntrySnapshot(entryType, entryId);
  }

  async updateTradeRouteMetadata(connectionId, patch) {
    const route = await this.repository.setTradeRouteOverride(connectionId, patch);
    await this.refreshOpenApps();
    return route;
  }

  async updateStatePolicy(stateId, patch) {
    const policy = await this.repository.setStatePolicy(stateId, patch);
    await this.refreshOpenApps();
    return policy;
  }

  async resetWorldData({ notify = false } = {}) {
    await this.traderService.resetState();
    const model = await this.repository.resetWorldData();
    if (notify) {
      ui.notifications?.info(game.i18n.localize("REBREYA_MAIN.Notifications.DataRestored"));
    }

    await this.refreshOpenApps();
    return model;
  }

  getMaterialByGoodId(goodId) {
    return this.repository.getMaterialByGoodId(goodId);
  }

  isTraderIntegrationAvailable() {
    return this.traderService.isAvailable();
  }

  async getCityTraderSummaries(cityId) {
    return this.traderService.getCityTraderSummaries(cityId);
  }

  async getTraderSnapshot(cityId, traderKey, options = {}) {
    return this.traderService.getTraderSnapshot(cityId, traderKey, options);
  }

  async purchaseTraderItem(cityId, traderKey, itemKey, quantity, options = {}) {
    return this.traderService.purchaseItem(cityId, traderKey, itemKey, quantity, options);
  }

  async createTraderSalePreview(cityId, traderKey, dropData) {
    return this.traderService.createSalePreview(cityId, traderKey, dropData);
  }

  async sellTraderItem(cityId, traderKey, preview, quantity) {
    return this.traderService.sellItem(cityId, traderKey, preview, quantity);
  }

  async updateTraderMetadata(cityId, traderKey, patch) {
    const trader = await this.traderService.updateTraderMetadata(cityId, traderKey, patch);
    await this.refreshOpenApps();
    return trader;
  }

  async getInventorySnapshot(options = {}) {
    return this.inventoryService.getInventorySnapshot(options);
  }

  async getPartySnapshot(options = {}) {
    return this.inventoryService.getPartySnapshot(options);
  }

  async addPartyMember(actorId) {
    const result = await this.inventoryService.addPartyMember(actorId);
    await this.refreshOpenApps();
    return result;
  }

  async removePartyMember(actorId) {
    const result = await this.inventoryService.removePartyMember(actorId);
    await this.refreshOpenApps();
    return result;
  }

  async updatePartyDefaults(patch = {}) {
    const result = await this.inventoryService.updatePartyDefaults(patch);
    await this.refreshOpenApps();
    return result;
  }

  async updatePartyMember(actorId, patch = {}) {
    const result = await this.inventoryService.updatePartyMember(actorId, patch);
    await this.refreshOpenApps();
    return result;
  }

  async updateInventoryItemQuantity(itemId, nextQuantity) {
    const result = await this.inventoryService.updateItemQuantity(itemId, nextQuantity);
    await this.refreshOpenApps();
    return result;
  }

  async deleteInventoryItem(itemId) {
    const result = await this.inventoryService.deleteItem(itemId);
    await this.refreshOpenApps();
    return result;
  }

  async addPartySupply(resourceKey, quantity) {
    const result = await this.inventoryService.addSupply(resourceKey, quantity);
    await this.refreshOpenApps();
    return result;
  }

  async consumePartySuppliesOneDay(options = {}) {
    const result = await this.inventoryService.consumeSuppliesOneDay(options);
    await this.refreshOpenApps();
    return result;
  }

  async importInventoryDrop(dropData) {
    const result = await this.inventoryService.importDroppedItem(dropData);
    await this.refreshOpenApps();
    return result;
  }

  async openPartyInventorySheet() {
    return this.inventoryService.openInventoryActorSheet();
  }

  async updatePartyCurrency(values = {}) {
    const result = await this.inventoryService.updateCurrency(values);
    await this.refreshOpenApps();
    return result;
  }

  async convertPartyCurrency(mode = "normalized") {
    const result = await this.inventoryService.convertCurrency(mode);
    await this.refreshOpenApps();
    return result;
  }

  async breakInventoryItemToMaterial(itemId, quantity = 1) {
    const result = await this.inventoryService.breakItemToMaterial(itemId, quantity);
    await this.refreshOpenApps();
    return result;
  }

  async addModelItemToInventory(sourceType, sourceId, quantity = 1) {
    const result = await this.inventoryService.addModelItemToInventory(sourceType, sourceId, quantity);
    await this.refreshOpenApps();
    return result;
  }

  getRebreyaToolCatalog() {
    return this.inventoryService.getRebreyaToolCatalog();
  }

  async updatePartyMemberTool(actorId, toolId, patch = {}) {
    const result = await this.inventoryService.updatePartyMemberTool(actorId, toolId, patch);
    await this.refreshOpenApps();
    return result;
  }

  async setPartyMemberEnergy(actorId, currentEnergy) {
    const result = await this.inventoryService.setMemberEnergy(actorId, currentEnergy);
    await this.refreshOpenApps();
    return result;
  }

  async restorePartyMemberEnergy(actorId, days = 1) {
    const result = await this.inventoryService.restoreMemberEnergy(actorId, days);
    await this.refreshOpenApps();
    return result;
  }

  async getCraftSnapshot(options = {}) {
    return this.craftingService.getSnapshot(options);
  }

  async queueCraftTask(payload = {}) {
    const result = await this.craftingService.queueTask(payload);
    await this.refreshOpenApps();
    return result;
  }

  async cancelCraftTask(taskId) {
    const result = await this.craftingService.cancelTask(taskId);
    await this.refreshOpenApps();
    return result;
  }

  async processCraftOneDay() {
    const result = await this.craftingService.processOneDay();
    await this.refreshOpenApps();
    return result;
  }

  getCalendarSnapshot() {
    return this.calendarService.getSnapshot();
  }

  async #refreshGlobalEventsByCalendarTransition(currentIsoDate, previousIsoDate) {
    const activation = await this.globalEventsService.refreshEventActivationByDate(currentIsoDate, previousIsoDate);
    if (activation.changed && this.globalEventsService.isAutoRecalculateEnabled()) {
      await this.repository.rebuildModel();
    }

    return activation;
  }

  async #applyTraderMonthlyReset(monthResetCount, reason = "calendar") {
    const safeResetCount = Math.max(0, Math.floor(Number(monthResetCount ?? 0)));
    if (safeResetCount <= 0 || !game.user?.isGM) {
      return {
        triggered: false,
        reason,
        monthResetCount: safeResetCount,
        refreshedTraderCount: 0,
        removedTraderCount: 0
      };
    }

    const resetResult = await this.traderService.resetAssortments();
    return {
      triggered: true,
      reason,
      monthResetCount: safeResetCount,
      refreshedTraderCount: Math.max(0, Math.floor(Number(resetResult?.refreshedTraderCount ?? 0))),
      removedTraderCount: Math.max(0, Math.floor(Number(resetResult?.removedTraderCount ?? 0)))
    };
  }

  async setCalendarDate(year, month, day) {
    const previousSnapshot = this.calendarService.getSnapshot();
    const result = await this.calendarService.setDate(year, month, day);
    const eventActivation = await this.#refreshGlobalEventsByCalendarTransition(result?.isoDate, previousSnapshot?.isoDate);
    const monthResetCount = (
      previousSnapshot?.isoDate !== result?.isoDate
      && Number(result?.day ?? 0) === 1
    ) ? 1 : 0;
    const traderReset = await this.#applyTraderMonthlyReset(monthResetCount, "set-date");
    await this.refreshOpenApps();
    return {
      ...result,
      eventActivation,
      traderReset
    };
  }

  async #runDayCycles(days, { consumeSupplies = true, applyEnergy = true, processCraft = true } = {}) {
    const safeDays = Math.max(0, Math.floor(Number(days ?? 0)));
    const supplies = [];
    let craftCompleted = [];
    let craftCompletedCount = 0;

    for (let index = 0; index < safeDays; index += 1) {
      if (consumeSupplies) {
        const supplyResult = await this.inventoryService.consumeSuppliesOneDay({ applyEnergy });
        supplies.push(supplyResult);
      }

      if (processCraft) {
        const craftResult = await this.craftingService.processOneDay();
        craftCompleted = craftCompleted.concat(craftResult.completed ?? []);
        craftCompletedCount += Number(craftResult.completedCount ?? 0);
      }
    }

    const supplyTotals = supplies.reduce((totals, row) => ({
      foodSpent: totals.foodSpent + Number(row.foodSpent ?? 0),
      waterSpent: totals.waterSpent + Number(row.waterSpent ?? 0),
      foodShortage: totals.foodShortage + Number(row.foodShortage ?? 0),
      waterShortage: totals.waterShortage + Number(row.waterShortage ?? 0)
    }), {
      foodSpent: 0,
      waterSpent: 0,
      foodShortage: 0,
      waterShortage: 0
    });

    return {
      days: safeDays,
      supplies,
      supplyTotals,
      craft: {
        completed: craftCompleted,
        completedCount: craftCompletedCount
      }
    };
  }

  async advanceCalendarDays(days = 1, options = {}) {
    const safeDays = Math.max(0, Math.floor(Number(days ?? 0)));
    const advance = await this.calendarService.advanceDays(safeDays);
    const eventActivation = await this.#refreshGlobalEventsByCalendarTransition(advance?.to?.isoDate, advance?.from?.isoDate);
    const monthResetCount = countMonthStartBoundaries(advance?.from?.isoDate, advance?.to?.isoDate);
    const traderReset = await this.#applyTraderMonthlyReset(monthResetCount, "advance-days");
    const cycles = await this.#runDayCycles(safeDays, options);
    await this.refreshOpenApps();
    return {
      ...advance,
      eventActivation,
      cycles,
      traderReset
    };
  }

  async advanceCalendarWeeks(weeks = 1, options = {}) {
    const safeWeeks = Math.max(0, Math.floor(Number(weeks ?? 0)));
    return this.advanceCalendarDays(safeWeeks * 7, options);
  }

  async advanceCalendarMonths(months = 1, options = {}) {
    const advance = await this.calendarService.advanceMonths(months);
    const eventActivation = await this.#refreshGlobalEventsByCalendarTransition(advance?.to?.isoDate, advance?.from?.isoDate);
    const monthResetCount = countMonthStartBoundaries(advance?.from?.isoDate, advance?.to?.isoDate);
    const traderReset = await this.#applyTraderMonthlyReset(monthResetCount, "advance-months");
    const cycles = await this.#runDayCycles(advance.daysAdvanced, options);
    await this.refreshOpenApps();
    return {
      ...advance,
      eventActivation,
      cycles,
      traderReset
    };
  }

  unregisterLootgenApp(appKey) {
    if (!appKey) {
      return false;
    }

    return this.lootgenApps.delete(appKey);
  }

  async openLootgenApp({ newWindow = true, viewer = false, sharedResult = null } = {}) {
    try {
      if (!viewer && !game.user?.isGM) {
        throw new Error("Лутген доступен только мастеру.");
      }

      const { LootgenApp } = await import("./ui/lootgen-app.js");
      let app = null;

      if (!viewer && !newWindow) {
        app = Array.from(this.lootgenApps.values()).find((candidate) => candidate?.rendered && !candidate.viewer) ?? null;
      }

      if (!app) {
        if (viewer) {
          const viewerAppKey = "lootgen-viewer";
          app = this.lootgenApps.get(viewerAppKey) ?? null;
          if (!app) {
            app = new LootgenApp(this, {
              appKey: viewerAppKey,
              viewer: true,
              sharedResult: sharedResult ?? this.latestLootgenResult ?? null
            });
            this.lootgenApps.set(viewerAppKey, app);
          }
        }
        else {
          this.lootgenCounter += 1;
          const appKey = `lootgen-${this.lootgenCounter}`;
          app = new LootgenApp(this, { appKey });
          this.lootgenApps.set(appKey, app);
        }
      }

      if (viewer && sharedResult && typeof app?.setSharedResult === "function") {
        app.setSharedResult(sharedResult);
      }

      await app.render({ force: true });
      bringAppToFront(app);
      return app;
    }
    catch (error) {
      console.error(`${MODULE_ID} | Failed to open loot generator app.`, error);
      ui.notifications?.error("Не удалось открыть окно лутгена.");
      throw error;
    }
  }
  async openTrader(cityId, traderKey, options = {}) {
    try {
      const { TraderApp } = await import("./ui/trader-app.js");
      const appKey = `${cityId}::${traderKey}`;

      let app = this.traderApps.get(appKey);
      if (!app) {
        app = new TraderApp(this, cityId, traderKey, options);
        this.traderApps.set(appKey, app);
      }
      else if (options?.actorId !== undefined) {
        app.selectedActorId = options.actorId;
      }

      await app.render({ force: true });
      bringAppToFront(app);
      return app;
    }
    catch (error) {
      console.error(`${MODULE_ID} | Failed to open trader '${cityId}:${traderKey}'.`, error);
      ui.notifications?.error("Не удалось открыть окно лавки.");
      throw error;
    }
  }

  async openTraderSheet(cityId, traderKey, options = {}) {
    return this.openTrader(cityId, traderKey, options);
  }

  async reloadData({ notify = false, rerender = true } = {}) {
    const model = await this.repository.reload();
    await this.#syncManagedCompendia(model);

    if (notify) {
      ui.notifications?.info(game.i18n.format("REBREYA_MAIN.Notifications.DataReloaded", { count: model.cities.length }));
    }

    if (rerender) {
      await this.refreshOpenApps();
    }

    return model;
  }

  async refreshOpenApps() {
    const tasks = [];

    if (this.economyApp?.rendered) {
      tasks.push(rerenderApp(this.economyApp));
    }

    if (this.worldTradeRoutesApp?.rendered) {
      tasks.push(rerenderApp(this.worldTradeRoutesApp));
    }

    if (this.statesApp?.rendered) {
      tasks.push(rerenderApp(this.statesApp));
    }

    if (this.globalEventsApp?.rendered) {
      tasks.push(rerenderApp(this.globalEventsApp));
    }

    if (this.inventoryApp?.rendered) {
      tasks.push(rerenderApp(this.inventoryApp));
    }

    for (const app of this.lootgenApps.values()) {
      if (app?.rendered) {
        tasks.push(rerenderApp(app));
      }
    }

    for (const app of this.cityApps.values()) {
      if (app?.rendered) {
        tasks.push(rerenderApp(app));
      }
    }

    for (const app of this.traderApps.values()) {
      if (app?.rendered) {
        tasks.push(rerenderApp(app));
      }
    }

    for (const app of this.tradeRouteApps.values()) {
      if (app?.rendered) {
        tasks.push(rerenderApp(app));
      }
    }

    for (const app of this.referenceApps.values()) {
      if (app?.rendered) {
        tasks.push(rerenderApp(app));
      }
    }

    await Promise.allSettled(tasks);
  }

  async openEconomyApp() {
    try {
      const { EconomyApp } = await import("./ui/economy-app.js");

      if (!this.economyApp) {
        this.economyApp = new EconomyApp(this);
      }

      await this.economyApp.render({ force: true });
      return this.economyApp;
    }
    catch (error) {
      console.error(`${MODULE_ID} | Failed to open economy app.`, error);
      ui.notifications?.error("Не удалось открыть окно экономики. Подробности в консоли.");
      throw error;
    }
  }

  async openCityApp(cityId) {
    try {
      const { CityEconomyApp } = await import("./ui/city-app.js");

      let app = this.cityApps.get(cityId);
      if (!app) {
        app = new CityEconomyApp(this, cityId);
        this.cityApps.set(cityId, app);
      }

      await app.render({ force: true });
      return app;
    }
    catch (error) {
      console.error(`${MODULE_ID} | Failed to open city app '${cityId}'.`, error);
      ui.notifications?.error("Не удалось открыть окно города. Подробности в консоли.");
      throw error;
    }
  }

  async openWorldTradeRoutesApp() {
    try {
      const { WorldTradeRoutesApp } = await import("./ui/trade-routes-app.js");

      if (!this.worldTradeRoutesApp) {
        this.worldTradeRoutesApp = new WorldTradeRoutesApp(this);
      }

      await this.worldTradeRoutesApp.render({ force: true });
      return this.worldTradeRoutesApp;
    }
    catch (error) {
      console.error(`${MODULE_ID} | Failed to open world trade routes app.`, error);
      ui.notifications?.error("Не удалось открыть окно мировых связей.");
      throw error;
    }
  }

  async openStatesApp() {
    try {
      const { StatesApp } = await import("./ui/states-app.js");

      if (!this.statesApp) {
        this.statesApp = new StatesApp(this);
      }

      await this.statesApp.render({ force: true });
      return this.statesApp;
    }
    catch (error) {
      console.error(`${MODULE_ID} | Failed to open states app.`, error);
      ui.notifications?.error("Не удалось открыть меню государств.");
      throw error;
    }
  }

  async openGlobalEventsApp() {
    try {
      if (!game.user?.isGM) {
        throw new Error("Окно глобальных ивентов доступно только мастеру.");
      }

      const { GlobalEventsApp } = await import("./ui/global-events-app.js");

      if (!this.globalEventsApp) {
        this.globalEventsApp = new GlobalEventsApp(this);
      }

      await this.globalEventsApp.render({ force: true });
      bringAppToFront(this.globalEventsApp);
      return this.globalEventsApp;
    }
    catch (error) {
      console.error(`${MODULE_ID} | Failed to open global events app.`, error);
      ui.notifications?.error("Не удалось открыть окно глобальных ивентов.");
      throw error;
    }
  }

  async openInventoryApp(options = {}) {
    try {
      const { InventoryApp } = await import("./ui/inventory-app.js");

      if (!this.inventoryApp) {
        this.inventoryApp = new InventoryApp(this);
      }

      if (options?.tab && typeof this.inventoryApp.setActiveTab === "function") {
        this.inventoryApp.setActiveTab(options.tab, { render: false });
      }

      await this.inventoryApp.render({ force: true });
      bringAppToFront(this.inventoryApp);
      return this.inventoryApp;
    }
    catch (error) {
      console.error(`${MODULE_ID} | Failed to open inventory app.`, error);
      ui.notifications?.error("Не удалось открыть партийный инвентарь.");
      throw error;
    }
  }
  async openTradeRouteApp(connectionId) {
    try {
      const { TradeRouteApp } = await import("./ui/trade-route-app.js");

      let app = this.tradeRouteApps.get(connectionId);
      if (!app) {
        app = new TradeRouteApp(this, connectionId);
        this.tradeRouteApps.set(connectionId, app);
      }

      await app.render({ force: true });
      if (!this.hasTradeRouteAnalytics()) {
        this.prepareTradeRouteAnalytics({ rerender: false }).catch((error) => {
          console.error(`${MODULE_ID} | Failed to warm trade route analytics for '${connectionId}'.`, error);
        });
      }
      return app;
    }
    catch (error) {
      console.error(`${MODULE_ID} | Failed to open trade route app '${connectionId}'.`, error);
      ui.notifications?.error("Не удалось открыть окно торговой связи.");
      throw error;
    }
  }

  async openReferenceInfoApp(entryType, entryId) {
    try {
      const { ReferenceInfoApp } = await import("./ui/reference-info-app.js");
      const appKey = `${entryType}::${entryId}`;

      let app = this.referenceApps.get(appKey);
      if (!app) {
        app = new ReferenceInfoApp(this, entryType, entryId);
        this.referenceApps.set(appKey, app);
      }

      await app.render({ force: true });
      return app;
    }
    catch (error) {
      console.error(`${MODULE_ID} | Failed to open reference info '${entryType}:${entryId}'.`, error);
      ui.notifications?.error("Не удалось открыть справочную запись.");
      throw error;
    }
  }

  async openMaterialByGoodId(goodId) {
    const model = await this.getModel();
    const material = model.materialByGoodId.get(goodId);
    return this.materialsCompendium.openMaterial(material);
  }

  async openMaterialById(materialId, fallbackName = "") {
    const model = await this.getModel();
    const normalizedFallbackName = normalizeLookupText(fallbackName);
    const material = model.materialById.get(materialId)
      ?? model.materials.find((entry) => entry.id === materialId)
      ?? model.materials.find((entry) => normalizeLookupText(entry.name) === normalizedFallbackName);
    return this.materialsCompendium.openMaterial(material);
  }

  async openGearById(gearId, fallbackName = "") {
    const model = await this.getModel();
    const normalizedFallbackName = normalizeLookupText(fallbackName);
    const gearItem = model.gearById.get(gearId)
      ?? model.gear.find((entry) => entry.id === gearId)
      ?? model.gear.find((entry) => normalizeLookupText(entry.name) === normalizedFallbackName);
    return this.gearCompendium.openGear(gearItem);
  }

  async openMagicItemById(magicItemId, fallbackName = "") {
    return this.magicItemsCompendium.openMagicItem(magicItemId, fallbackName);
  }

  async openFeatById(featId, fallbackName = "") {
    return this.featsCompendium.openFeat(featId, fallbackName);
  }

  async openTradeEntry(sourceType, sourceId, sourceName = "") {
    const normalizedType = normalizeTradeSourceType(sourceType);

    if (normalizedType === "material") {
      return this.openMaterialById(sourceId, sourceName);
    }

    if (normalizedType === "gear") {
      return this.openGearById(sourceId, sourceName);
    }

    if (normalizedType === "magicItem") {
      return this.openMagicItemById(sourceId, sourceName);
    }

    if (normalizedType === "feat") {
      return this.openFeatById(sourceId, sourceName);
    }

    return null;
  }
}

Hooks.once("init", () => {
  try {
    registerSettings();
  }
  catch (error) {
    console.error(`${MODULE_ID} | Failed to register settings.`, error);
  }

  try {
    registerHandlebarsHelpers();
  }
  catch (error) {
    console.error(`${MODULE_ID} | Failed to register Handlebars helpers.`, error);
  }

  try {
    registerSceneControlsHook();
  }
  catch (error) {
    console.error(`${MODULE_ID} | Failed to register scene controls hook.`, error);
  }

  try {
    extendDnd5eItemTypes();
  }
  catch (error) {
    console.error(`${MODULE_ID} | Failed to extend dnd5e item types.`, error);
  }

  try {
    registerCombatStatusConfig();
  }
  catch (error) {
    console.error(`${MODULE_ID} | Failed to register combat status config.`, error);
  }
});

Hooks.once("ready", async () => {
  let moduleApi;
  try {
    moduleApi = new RebreyaMainModule();
  }
  catch (error) {
    console.error(`${MODULE_ID} | Failed to construct module API.`, error);
    ui.notifications?.error("Rebreya: не удалось запустить модульный API.");
    return;
  }

  game.rebreyaMain = moduleApi;
  const module = game.modules.get(MODULE_ID);
  if (module) {
    module.api = moduleApi;
  }

  game.socket?.on?.(SOCKET_CHANNEL, (message) => {
    moduleApi.handleSocketMessage(message).catch((error) => {
      console.error(`${MODULE_ID} | Failed to handle socket message.`, error);
    });
  });

  try {
    registerCombatHooks(moduleApi);
  }
  catch (error) {
    console.error(`${MODULE_ID} | Failed to register combat hooks.`, error);
  }

  try {
    registerDnd5eSheetExtensions(moduleApi);
  }
  catch (error) {
    console.error(`${MODULE_ID} | Failed to register dnd5e sheet extensions.`, error);
    ui.notifications?.warn("Rebreya: расширения листов dnd5e отключены из-за ошибки.");
  }

  try {
    registerLootgenChatHooks(moduleApi);
  }
  catch (error) {
    console.error(`${MODULE_ID} | Failed to register lootgen chat hooks.`, error);
  }

  try {
    await moduleApi.initialize();
  }
  catch (error) {
    console.error(`${MODULE_ID} | Failed to initialize module.`, error);
    ui.notifications?.error(game.i18n.localize("REBREYA_MAIN.Notifications.InitializationFailed"));
  }
});



