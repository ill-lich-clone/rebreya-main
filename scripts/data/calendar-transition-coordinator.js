import { WorldMutationCoordinator } from "../application/world-mutation-coordinator.js";
import { isActiveGmClient } from "../infrastructure/foundry/active-gm.js";

const JOURNAL_VERSION = 1;
const MAX_JOURNAL_ENTRIES = 100;
const DOWNTIME_STATUSES = ["free", "pending", "approved", "processed", "blocked"];
const DEFAULT_MUTATION_COORDINATOR = new WorldMutationCoordinator();
const TRANSITION_QUEUE_PREFIX = "calendar-transition";
const SECONDS_PER_DAY = 86400;

function clone(value) {
  if (globalThis.foundry?.utils?.deepClone) {
    return globalThis.foundry.utils.deepClone(value);
  }

  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function asObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function cleanText(value) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeTimeOfDaySeconds(value, fallback = 0) {
  const numericValue = Number(value);
  const fallbackValue = Number(fallback);
  const seconds = Math.floor(Number.isFinite(numericValue)
    ? numericValue
    : (Number.isFinite(fallbackValue) ? fallbackValue : 0));
  return ((seconds % SECONDS_PER_DAY) + SECONDS_PER_DAY) % SECONDS_PER_DAY;
}

function buildTimeOfDayParts(value) {
  const timeOfDaySeconds = normalizeTimeOfDaySeconds(value);
  const hour = Math.floor(timeOfDaySeconds / 3600);
  const minute = Math.floor((timeOfDaySeconds % 3600) / 60);
  const second = timeOfDaySeconds % 60;
  const timeLabel = [hour, minute, second]
    .map((part) => String(part).padStart(2, "0"))
    .join(":");
  return {
    timeOfDaySeconds,
    hour,
    minute,
    second,
    timeLabel,
    timeShortLabel: timeLabel.slice(0, 5)
  };
}

function resolveTargetTimeOfDaySeconds(baseSeconds, options = {}) {
  const source = asObject(options);
  if (Object.hasOwn(source, "timeOfDaySeconds")) {
    return normalizeTimeOfDaySeconds(source.timeOfDaySeconds, baseSeconds);
  }
  if (!["hour", "minute", "second"].some((key) => Object.hasOwn(source, key))) {
    return normalizeTimeOfDaySeconds(baseSeconds);
  }
  const current = buildTimeOfDayParts(baseSeconds);
  const clampPart = (value, fallback, maximum) => {
    const number = Number(value);
    return Math.max(0, Math.min(maximum, Math.floor(Number.isFinite(number) ? number : fallback)));
  };
  const hour = clampPart(source.hour, current.hour, 23);
  const minute = clampPart(source.minute, current.minute, 59);
  const second = clampPart(source.second, current.second, 59);
  return normalizeTimeOfDaySeconds((hour * 3600) + (minute * 60) + second);
}

function errorMessage(error) {
  return cleanText(error?.message) || String(error ?? "Calendar transition failed.");
}

function isoDateParts(isoDate) {
  const match = /^(\d{1,6})-(\d{2})-(\d{2})$/u.exec(cleanText(isoDate));
  if (!match) {
    throw new Error("Некорректная дата календаря.");
  }

  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

function createEmptyCycles() {
  return {
    days: 0,
    supplies: [],
    supplyTotals: {
      foodSpent: 0,
      waterSpent: 0,
      foodShortage: 0,
      waterShortage: 0
    },
    craft: {
      completed: [],
      completedCount: 0
    }
  };
}

function createEmptyTraderReset(reason, monthResetCount = 0) {
  return {
    triggered: false,
    reason,
    monthResetCount,
    refreshedTraderCount: 0,
    removedTraderCount: 0
  };
}

function previewEndpoint(snapshot = {}) {
  const source = asObject(snapshot);
  return {
    isoDate: cleanText(source.isoDate),
    year: Number(source.year) || 0,
    month: Number(source.month) || 0,
    day: Number(source.day) || 0,
    timeOfDaySeconds: Number(source.timeOfDaySeconds) || 0,
    hour: Number(source.hour) || 0,
    minute: Number(source.minute) || 0,
    second: Number(source.second) || 0,
    timeLabel: cleanText(source.timeLabel),
    timeShortLabel: cleanText(source.timeShortLabel),
    weekdayLabel: cleanText(source.weekdayLabel),
    dateLabel: cleanText(source.dateLabel),
    monthName: cleanText(source.monthName),
    monthYearLabel: cleanText(source.monthYearLabel)
  };
}

function normalizeJournal(value) {
  const source = asObject(value);
  const entries = asArray(source.entries).map((entry) => clone(asObject(entry)));
  const maxCounter = entries.reduce(
    (maximum, entry) => Math.max(maximum, Math.max(0, Math.floor(Number(entry.counter) || 0))),
    0
  );
  return {
    version: JOURNAL_VERSION,
    counter: Math.max(maxCounter, Math.max(0, Math.floor(Number(source.counter) || 0))),
    entries
  };
}

function normalizeMoveOptions(options = {}) {
  const source = asObject(options);
  return {
    processDowntime: source.processDowntime !== false,
    processSupplies: source.processSupplies === true,
    processDailyCycles: source.processDailyCycles === undefined
      ? source.processSupplies === true
      : source.processDailyCycles === true,
    consumeSupplies: source.consumeSupplies !== false,
    applyEnergy: source.applyEnergy !== false,
    refreshApps: source.refreshApps !== false,
    refreshSmallTime: source.refreshSmallTime !== false,
    monthResetMode: cleanText(source.monthResetMode) || "crossed",
    reason: cleanText(source.reason) || "calendar",
    targetTimeOfDaySeconds: normalizeTimeOfDaySeconds(source.targetTimeOfDaySeconds)
  };
}

function operationOptionsMatch(entry, options) {
  return entry.reason === options.reason
    && entry.processDowntime === options.processDowntime
    && entry.processSupplies === options.processSupplies
    && entry.processDailyCycles === options.processDailyCycles
    && entry.consumeSupplies === options.consumeSupplies
    && entry.applyEnergy === options.applyEnergy
    && entry.refreshApps === options.refreshApps
    && entry.refreshSmallTime === options.refreshSmallTime
    && entry.monthResetMode === options.monthResetMode
    && normalizeTimeOfDaySeconds(entry.targetTimeOfDaySeconds ?? entry.to?.timeOfDaySeconds)
      === options.targetTimeOfDaySeconds;
}

function operationMatches(entry, preview, options) {
  if (!operationOptionsMatch(entry, options) || entry.toIsoDate !== preview.toIsoDate || entry.status === "completed") {
    return false;
  }

  return entry.fromIsoDate === preview.fromIsoDate
    || (preview.direction === "same" && preview.fromIsoDate === entry.toIsoDate);
}

function completedOperationMatches(entry, preview, options) {
  return entry.status === "completed"
    && operationOptionsMatch(entry, options)
    && preview.direction === "same"
    && preview.fromIsoDate === entry.toIsoDate
    && preview.toIsoDate === entry.toIsoDate;
}

function affectedDowntimeIsoDates(preview) {
  const seen = new Set();
  return asArray(preview?.affectedDowntime)
    .map((summary) => cleanText(summary?.isoDate))
    .filter((isoDate) => {
      if (!isoDate || seen.has(isoDate)) {
        return false;
      }
      seen.add(isoDate);
      return true;
    });
}

function classifyDowntimeResult(result) {
  if (
    cleanText(result?.journalStatus) === "reconciliation-required"
    || asArray(result?.reconciliation).length > 0
  ) {
    return "reconciliation-required";
  }
  if (asArray(result?.blocked).length > 0) {
    return "blocked";
  }
  return "completed";
}

export class CalendarTransitionCoordinator {
  constructor({
    calendarService,
    downtimeService,
    groupContextService = calendarService?.groupContextService,
    refreshGlobalEvents = null,
    resetTraderMonth = null,
    processDayCycles = null,
    refreshApps = null,
    refreshSmallTime = null,
    activityProcessor = null,
    coordinator = DEFAULT_MUTATION_COORDINATOR
  } = {}) {
    if (!calendarService?.previewTransition || !calendarService?.setDate) {
      throw new Error("Calendar transition coordinator requires CalendarService.");
    }
    if (!groupContextService?.resolveForCurrentUser || !groupContextService?.mutateGroupState) {
      throw new Error("Calendar transition coordinator requires queued group state mutations.");
    }
    if (!coordinator?.run) {
      throw new Error("Calendar transition coordinator requires WorldMutationCoordinator.");
    }

    this.calendarService = calendarService;
    this.downtimeService = downtimeService;
    this.groupContextService = groupContextService;
    this.refreshGlobalEvents = typeof refreshGlobalEvents === "function" ? refreshGlobalEvents : null;
    this.resetTraderMonth = typeof resetTraderMonth === "function" ? resetTraderMonth : null;
    this.processDayCycles = typeof processDayCycles === "function" ? processDayCycles : null;
    this.refreshApps = typeof refreshApps === "function" ? refreshApps : null;
    this.refreshSmallTime = typeof refreshSmallTime === "function" ? refreshSmallTime : null;
    this.activityProcessor = typeof activityProcessor === "function" ? activityProcessor : null;
    this.coordinator = coordinator;
  }

  preview(options = {}) {
    const basePreview = this.calendarService.previewTransition(options.toIsoDate);
    const targetTimeOfDaySeconds = resolveTargetTimeOfDaySeconds(
      basePreview.from?.timeOfDaySeconds,
      options
    );
    const calendarPreview = {
      ...basePreview,
      to: {
        ...basePreview.to,
        ...buildTimeOfDayParts(targetTimeOfDaySeconds)
      }
    };
    const normalizedOptions = normalizeMoveOptions({ ...options, targetTimeOfDaySeconds });
    const resumableEntry = this.#findResumableEntry(calendarPreview, normalizedOptions);
    return resumableEntry
      ? this.#previewFromEntry(resumableEntry)
      : this.#enrichPreview(calendarPreview, normalizedOptions);
  }

  async moveTo(options = {}) {
    if (!isActiveGmClient(globalThis.game)) {
      throw new Error("Calendar transitions must execute on the active GM client.");
    }

    const context = this.groupContextService.resolveForCurrentUser();
    if (!context?.groupId) {
      throw new Error("Calendar transitions require an active Rebreya group.");
    }
    const executionUserId = cleanText(globalThis.game?.user?.id);

    return this.coordinator.run(`${TRANSITION_QUEUE_PREFIX}:${context.groupId}`, async () => {
      this.#assertExecutionContext(context.groupId, executionUserId);
      return this.#moveTo(context.groupId, options, executionUserId);
    });
  }

  async #moveTo(groupId, options, executionUserId) {
    this.#assertExecutionContext(groupId, executionUserId);
    const requestedPreview = this.preview(options);
    const normalizedOptions = normalizeMoveOptions({
      ...options,
      targetTimeOfDaySeconds: requestedPreview.to?.timeOfDaySeconds
    });

    const claim = await this.#claimTransition(
      groupId,
      requestedPreview,
      normalizedOptions,
      options,
      executionUserId
    );
    this.#assertExecutionContext(groupId, executionUserId);
    if (claim.replayedCompletion) {
      return this.#buildCompletedReplay(claim.entry, normalizedOptions);
    }
    const preview = claim.resumed
      ? this.#previewFromEntry(claim.entry)
      : requestedPreview;
    const transitionId = claim.entry.transitionId;
    let calendar;

    try {
      calendar = await this.#persistCalendar(
        groupId,
        transitionId,
        preview.toIsoDate,
        preview.to?.timeOfDaySeconds,
        options,
        executionUserId
      );
    }
    catch (error) {
      this.#assertExecutionContext(groupId, executionUserId);
      await this.#setTransitionStatus(
        groupId,
        transitionId,
        "reconciliation-required",
        errorMessage(error),
        executionUserId
      )
        .catch(() => undefined);
      throw error;
    }

    const downtime = await this.#processDowntimeDates(groupId, claim.entry, preview, executionUserId);
    const externalStageRunId = `${transitionId}:external:${Date.now()}`;
    await this.#startExternalStages(
      groupId,
      transitionId,
      [
        this.refreshGlobalEvents ? "globalEvents" : "",
        preview.direction === "forward" && this.resetTraderMonth ? "traderMonthlyReset" : "",
        preview.direction === "forward" && normalizedOptions.processDailyCycles && this.processDayCycles ? "dayCycles" : "",
        normalizedOptions.refreshApps && this.refreshApps ? "refreshApps" : "",
        normalizedOptions.refreshSmallTime && this.refreshSmallTime ? "refreshSmallTime" : ""
      ],
      externalStageRunId,
      executionUserId
    );
    const eventStage = await this.#runExternalStage({
      groupId,
      transitionId,
      executionUserId,
      name: "globalEvents",
      stageRunId: externalStageRunId,
      callback: this.refreshGlobalEvents
        ? (executionContext) => this.refreshGlobalEvents(preview.toIsoDate, preview.fromIsoDate, {
          ...executionContext,
          operationId: `${transitionId}:global-events`
        })
        : null
    });
    const monthResetCount = preview.direction === "forward" ? claim.entry.monthResetCount : 0;
    const traderStage = preview.direction === "forward"
      ? await this.#runExternalStage({
        groupId,
        transitionId,
        executionUserId,
        name: "traderMonthlyReset",
        stageRunId: externalStageRunId,
        callback: this.resetTraderMonth
          ? (executionContext) => this.resetTraderMonth(monthResetCount, normalizedOptions.reason, {
            ...executionContext,
            operationId: `${transitionId}:trader-monthly-reset`
          })
          : null
      })
      : await this.#skipStage(groupId, transitionId, "traderMonthlyReset", executionUserId);
    const cyclesStage = preview.direction === "forward" && normalizedOptions.processDailyCycles
      ? await this.#runExternalStage({
        groupId,
        transitionId,
        executionUserId,
        name: "dayCycles",
        stageRunId: externalStageRunId,
        callback: this.processDayCycles
          ? (executionContext) => this.processDayCycles(preview.crossedDates.length, {
            ...options,
            processDowntime: normalizedOptions.processDowntime,
            processSupplies: normalizedOptions.processSupplies,
            consumeSupplies: normalizedOptions.processSupplies && normalizedOptions.consumeSupplies,
            applyEnergy: normalizedOptions.applyEnergy,
            ...executionContext,
            operationId: `${transitionId}:day-cycles`
          })
          : null
      })
      : await this.#skipStage(groupId, transitionId, "dayCycles", executionUserId);
    const refreshAppsStage = normalizedOptions.refreshApps
      ? await this.#runExternalStage({
        groupId,
        transitionId,
        executionUserId,
        name: "refreshApps",
        stageRunId: externalStageRunId,
        callback: this.refreshApps
          ? (executionContext) => this.refreshApps({
            ...executionContext,
            operationId: `${transitionId}:refresh-apps`
          })
          : null
      })
      : await this.#skipStage(groupId, transitionId, "refreshApps", executionUserId);
    const refreshSmallTimeStage = normalizedOptions.refreshSmallTime
      ? await this.#runExternalStage({
        groupId,
        transitionId,
        executionUserId,
        name: "refreshSmallTime",
        stageRunId: externalStageRunId,
        callback: this.refreshSmallTime
          ? (executionContext) => this.refreshSmallTime({
            ...executionContext,
            operationId: `${transitionId}:refresh-smalltime`
          })
          : null
      })
      : await this.#skipStage(groupId, transitionId, "refreshSmallTime", executionUserId);

    const reconciliation = [
      ...downtime.filter((entry) => entry.status === "reconciliation-required"),
      ...[eventStage, traderStage, cyclesStage, refreshAppsStage, refreshSmallTimeStage]
        .filter((stage) => stage.status === "reconciliation-required")
    ];
    const status = reconciliation.length ? "reconciliation-required" : "completed";
    if (status === "completed") {
      await this.#prepareCompletion(groupId, transitionId, executionUserId);
      await this.#acknowledgeCompletion(groupId, transitionId, executionUserId);
    }
    else {
      await this.#setTransitionStatus(groupId, transitionId, status, "", executionUserId);
    }

    return {
      ...preview,
      transitionId,
      status,
      calendar,
      downtime,
      eventActivation: eventStage.result ?? { changed: false },
      traderReset: traderStage.result ?? createEmptyTraderReset(normalizedOptions.reason, monthResetCount),
      cycles: cyclesStage.result ?? createEmptyCycles(),
      reconciliation
    };
  }

  #enrichPreview(calendarPreview, options = {}) {
    const downtimeSnapshot = this.downtimeService?.getSnapshot?.() ?? {};
    const calendarByIsoDate = asObject(downtimeSnapshot.calendarByIsoDate);
    const affectedDowntime = calendarPreview.crossedDates
      .map((isoDate) => calendarByIsoDate[isoDate])
      .filter((summary) => Number(summary?.total ?? 0) > 0)
      .map((summary) => clone(summary));
    const affectedSlots = affectedDowntime.flatMap((summary) => asArray(summary.slots));
    const affectedRequestIds = new Set(affectedSlots.map((slot) => cleanText(slot?.requestId)).filter(Boolean));
    const downtimeByStatus = Object.fromEntries(DOWNTIME_STATUSES.map((status) => [status, 0]));
    for (const summary of affectedDowntime) {
      for (const status of DOWNTIME_STATUSES) {
        downtimeByStatus[status] += Math.max(0, Number(summary?.counts?.[status]) || 0);
      }
    }

    return {
      ...calendarPreview,
      groupId: cleanText(downtimeSnapshot.groupId),
      processDowntime: options.processDowntime !== false,
      processSupplies: options.processSupplies === true,
      reason: cleanText(options.reason) || "calendar",
      affectedDowntime,
      affectedRequestCount: affectedRequestIds.size,
      affectedSlotCount: affectedSlots.length,
      daysCount: calendarPreview.crossedDates.length,
      counts: {
        crossedDates: calendarPreview.crossedDates.length,
        days: calendarPreview.crossedDates.length,
        monthBoundaries: calendarPreview.monthStartDates.length,
        affectedDowntimeDates: affectedDowntime.length,
        affectedDowntimeRequests: affectedRequestIds.size,
        affectedDowntimeSlots: affectedSlots.length,
        downtimeByStatus
      }
    };
  }

  #previewFromEntry(entry) {
    return this.#enrichPreview({
      from: clone(entry.from),
      to: clone(entry.to),
      fromIsoDate: entry.fromIsoDate,
      toIsoDate: entry.toIsoDate,
      direction: entry.direction,
      crossedDates: clone(entry.crossedDates),
      crossedDateCount: entry.crossedDates.length,
      daysAdvanced: entry.daysAdvanced,
      monthStartDates: clone(entry.monthStartDates),
      monthResetCount: entry.monthResetCount,
      counts: {
        crossedDates: entry.crossedDates.length,
        monthBoundaries: entry.monthStartDates.length
      }
    }, entry);
  }

  #findResumableEntry(preview, options) {
    let context;
    try {
      context = this.groupContextService.resolveForCurrentUser();
    }
    catch (_error) {
      return null;
    }

    const journal = normalizeJournal(context?.groupState?.calendar?.transitionJournal);
    return [...journal.entries].reverse().find((entry) => operationMatches(entry, preview, options)) ?? null;
  }

  async #claimTransition(groupId, preview, options, rawOptions, executionUserId) {
    return this.#mutateJournal(groupId, (journal) => {
      const existing = [...journal.entries].reverse().find((entry) => operationMatches(entry, preview, options));
      if (existing) {
        existing.updatedAt = Date.now();
        return { entry: clone(existing), resumed: true };
      }

      const completed = [...journal.entries].reverse()
        .find((entry) => completedOperationMatches(entry, preview, options));
      if (completed) {
        return { entry: clone(completed), resumed: true, replayedCompletion: true };
      }

      const counter = journal.counter + 1;
      const transitionId = `calendar:${groupId}:${counter}:${preview.fromIsoDate}:${preview.toIsoDate}`;
      const explicitMonthResetCount = Number(rawOptions.monthResetCount);
      const monthResetCount = preview.direction === "forward"
        ? Number.isFinite(explicitMonthResetCount)
          ? Math.max(0, Math.floor(explicitMonthResetCount))
          : options.monthResetMode === "target-first"
            ? (preview.fromIsoDate !== preview.toIsoDate && Number(preview.to?.day ?? 0) === 1 ? 1 : 0)
            : preview.monthStartDates.length
        : 0;
      const downtimeIsoDates = options.processDowntime && preview.direction === "forward"
        ? affectedDowntimeIsoDates(preview)
        : [];
      const now = Date.now();
      const entry = {
        counter,
        transitionId,
        groupId,
        fromIsoDate: preview.fromIsoDate,
        toIsoDate: preview.toIsoDate,
        from: previewEndpoint(preview.from),
        to: previewEndpoint(preview.to),
        direction: preview.direction,
        crossedDates: clone(preview.crossedDates),
        daysAdvanced: preview.daysAdvanced,
        monthStartDates: clone(preview.monthStartDates),
        monthResetCount,
        ...options,
        status: "processing",
        error: "",
        stages: {
          calendar: { status: "pending" },
          globalEvents: { status: "pending" },
          traderMonthlyReset: { status: "pending" },
          dayCycles: { status: "pending" },
          refreshApps: { status: "pending" },
          refreshSmallTime: { status: "pending" }
        },
        downtimeByIsoDate: Object.fromEntries(downtimeIsoDates.map((isoDate) => [
          isoDate,
          { status: "pending" }
        ])),
        createdAt: now,
        updatedAt: now
      };
      journal.counter = counter;
      journal.entries.push(entry);
      journal.entries = journal.entries.slice(-MAX_JOURNAL_ENTRIES);
      return { entry: clone(entry), resumed: false };
    }, executionUserId);
  }

  async #persistCalendar(
    groupId,
    transitionId,
    toIsoDate,
    targetTimeOfDaySeconds,
    calendarOptions = {},
    executionUserId = ""
  ) {
    this.#assertExecutionContext(groupId, executionUserId);
    const currentCalendar = this.calendarService.getSnapshot();
    const claim = await this.#mutateEntry(groupId, transitionId, (entry) => {
      const stage = asObject(entry.stages.calendar);
      if (
        stage.status === "completed"
        && currentCalendar.isoDate === toIsoDate
        && currentCalendar.timeOfDaySeconds === normalizeTimeOfDaySeconds(targetTimeOfDaySeconds)
      ) {
        return { completed: true };
      }
      entry.stages.calendar = {
        ...stage,
        status: "processing",
        startedAt: Number(stage.startedAt) || Date.now()
      };
      return { completed: false };
    }, executionUserId);
    this.#assertExecutionContext(groupId, executionUserId);
    if (claim.completed) {
      return currentCalendar;
    }

    const calendar = await this.calendarService.setDate(...isoDateParts(toIsoDate), calendarOptions);
    this.#assertExecutionContext(groupId, executionUserId);
    await this.#mutateEntry(groupId, transitionId, (entry) => {
      entry.stages.calendar = {
        status: "completed",
        result: { isoDate: calendar.isoDate },
        completedAt: Date.now()
      };
    }, executionUserId);
    this.#assertExecutionContext(groupId, executionUserId);
    return calendar;
  }

  async #processDowntimeDates(groupId, entry, preview, executionUserId = "") {
    this.#assertExecutionContext(groupId, executionUserId);
    if (!entry.processDowntime || preview.direction !== "forward") {
      return [];
    }

    const pendingDates = new Set(Object.keys(asObject(entry.downtimeByIsoDate)).map(cleanText).filter(Boolean));
    const downtimeDates = asArray(preview.crossedDates).filter((isoDate) => pendingDates.has(isoDate));
    if (downtimeDates.length <= 0) {
      return [];
    }

    const results = [];
    for (const isoDate of downtimeDates) {
      this.#assertExecutionContext(groupId, executionUserId);
      const claim = await this.#mutateEntry(groupId, entry.transitionId, (journalEntry) => {
        const current = asObject(journalEntry.downtimeByIsoDate[isoDate]);
        if (current.status === "completed" || current.status === "blocked") {
          return { run: false, entry: clone(current) };
        }
        journalEntry.downtimeByIsoDate[isoDate] = {
          ...current,
          status: "processing",
          startedAt: Number(current.startedAt) || Date.now()
        };
        return { run: true };
      }, executionUserId);
      this.#assertExecutionContext(groupId, executionUserId);

      if (!claim.run) {
        results.push({ isoDate, ...claim.entry });
        continue;
      }

      let status = "reconciliation-required";
      let result = null;
      let error = "";
      const executionContext = this.#createCallbackContext(groupId, entry.transitionId, executionUserId);
      this.#assertExecutionContext(groupId, executionUserId);
      try {
        result = await this.downtimeService?.processScheduledDate?.(isoDate, {
          transitionId: entry.transitionId,
          activityProcessor: this.activityProcessor,
          ...executionContext
        });
        status = classifyDowntimeResult(result);
      }
      catch (caughtError) {
        error = errorMessage(caughtError);
      }
      this.#assertExecutionContext(groupId, executionUserId);

      const persisted = {
        status,
        result: clone(result),
        error,
        completedAt: Date.now()
      };
      await this.#mutateEntry(groupId, entry.transitionId, (journalEntry) => {
        journalEntry.downtimeByIsoDate[isoDate] = clone(persisted);
      }, executionUserId);
      this.#assertExecutionContext(groupId, executionUserId);
      results.push({ isoDate, ...persisted });
    }
    return results;
  }

  async #startExternalStages(groupId, transitionId, names, stageRunId, executionUserId = "") {
    const stageNames = [...new Set(asArray(names).map(cleanText).filter(Boolean))];
    const runId = cleanText(stageRunId);
    if (stageNames.length <= 0 || !runId) {
      return;
    }

    this.#assertExecutionContext(groupId, executionUserId);
    await this.#mutateEntry(groupId, transitionId, (entry) => {
      const started = [];
      for (const stageName of stageNames) {
        const stage = asObject(entry.stages[stageName]);
        if (["completed", "skipped", "reconciliation-required", "processing"].includes(stage.status)) {
          continue;
        }
        entry.stages[stageName] = {
          ...stage,
          status: "processing",
          startedAt: Number(stage.startedAt) || Date.now(),
          runId
        };
        started.push(stageName);
      }
      return started;
    }, executionUserId);
    this.#assertExecutionContext(groupId, executionUserId);
  }

  async #runExternalStage({ groupId, transitionId, executionUserId = "", name, stageRunId = "", callback }) {
    this.#assertExecutionContext(groupId, executionUserId);
    if (!callback) {
      return this.#skipStage(groupId, transitionId, name, executionUserId);
    }

    const currentEntry = this.#readTransitionEntry(groupId, transitionId);
    const currentStage = asObject(currentEntry?.stages?.[name]);
    if (["completed", "skipped", "reconciliation-required"].includes(currentStage.status)) {
      return { name, ...clone(currentStage) };
    }
    const runId = cleanText(stageRunId);
    if (currentStage.status === "processing" && (!runId || cleanText(currentStage.runId) !== runId)) {
      const ambiguousStage = await this.#markExternalStageAmbiguous(
        groupId,
        transitionId,
        name,
        currentStage,
        executionUserId
      );
      return { name, ...ambiguousStage };
    }
    if (currentStage.status !== "processing") {
      await this.#startExternalStages(
        groupId,
        transitionId,
        [name],
        runId || `${transitionId}:${name}:${Date.now()}`,
        executionUserId
      );
    }

    this.#assertExecutionContext(groupId, executionUserId);

    let status = "completed";
    let result = null;
    let error = "";
    const executionContext = this.#createCallbackContext(groupId, transitionId, executionUserId);
    executionContext.guard();
    try {
      result = await callback(executionContext);
    }
    catch (caughtError) {
      status = "reconciliation-required";
      error = errorMessage(caughtError);
    }
    this.#assertExecutionContext(groupId, executionUserId);

    const stage = {
      status,
      result: result === undefined ? null : clone(result),
      error,
      completedAt: Date.now()
    };
    const persistedStage = await this.#mutateEntry(groupId, transitionId, (entry) => {
      const latestStage = asObject(entry.stages[name]);
      if (["completed", "skipped", "reconciliation-required"].includes(latestStage.status)) {
        return clone(latestStage);
      }
      if (latestStage.status === "processing" && runId && cleanText(latestStage.runId) !== runId) {
        const ambiguous = {
          ...latestStage,
          status: "reconciliation-required",
          error: "External stage completion is ambiguous after an interrupted transition.",
          completedAt: Date.now()
        };
        entry.stages[name] = ambiguous;
        return clone(ambiguous);
      }
      entry.stages[name] = clone(stage);
      return clone(stage);
    }, executionUserId);
    this.#assertExecutionContext(groupId, executionUserId);
    return { name, ...persistedStage };
  }

  async #markExternalStageAmbiguous(groupId, transitionId, name, stage, executionUserId = "") {
    this.#assertExecutionContext(groupId, executionUserId);
    const ambiguous = await this.#mutateEntry(groupId, transitionId, (entry) => {
      const current = asObject(entry.stages[name]);
      if (["completed", "skipped", "reconciliation-required"].includes(current.status)) {
        return clone(current);
      }
      const next = {
        ...stage,
        ...current,
        status: "reconciliation-required",
        error: "External stage completion is ambiguous after an interrupted transition.",
        completedAt: Date.now()
      };
      entry.stages[name] = next;
      return clone(next);
    }, executionUserId);
    this.#assertExecutionContext(groupId, executionUserId);
    return ambiguous;
  }

  async #skipStage(groupId, transitionId, name, executionUserId = "") {
    this.#assertExecutionContext(groupId, executionUserId);
    const stage = await this.#mutateEntry(groupId, transitionId, (entry) => {
      const current = asObject(entry.stages[name]);
      if (current.status === "completed" || current.status === "reconciliation-required") {
        return clone(current);
      }
      const skipped = { status: "skipped", result: null, completedAt: Date.now() };
      entry.stages[name] = skipped;
      return clone(skipped);
    }, executionUserId);
    this.#assertExecutionContext(groupId, executionUserId);
    return { name, ...stage };
  }

  async #setTransitionStatus(groupId, transitionId, status, error = "", executionUserId = "") {
    const result = await this.#writeTransitionStatus(
      groupId,
      transitionId,
      status,
      error,
      executionUserId
    );
    this.#assertExecutionContext(groupId, executionUserId);
    return result;
  }

  #writeTransitionStatus(groupId, transitionId, status, error = "", executionUserId = "") {
    return this.#mutateEntry(groupId, transitionId, (entry) => {
      entry.status = status;
      entry.error = cleanText(error);
      entry.updatedAt = Date.now();
      if (status === "completed") {
        entry.completedAt = Date.now();
      }
      else {
        delete entry.completedAt;
      }
    }, executionUserId);
  }

  async #prepareCompletion(groupId, transitionId, executionUserId = "") {
    this.#assertExecutionContext(groupId, executionUserId);
    const result = await this.#mutateEntry(groupId, transitionId, (entry) => {
      if (entry.status === "completed") {
        return {
          completionToken: cleanText(entry.completionToken),
          status: entry.status
        };
      }

      const completionToken = cleanText(entry.completionToken) || `${transitionId}:completion`;
      entry.status = "completion-pending";
      entry.error = "";
      entry.completionToken = completionToken;
      entry.completionPreparedAt = Number(entry.completionPreparedAt) || Date.now();
      delete entry.completedAt;
      return { completionToken, status: entry.status };
    }, executionUserId);
    this.#assertExecutionContext(groupId, executionUserId);
    return result;
  }

  async #acknowledgeCompletion(groupId, transitionId, executionUserId = "") {
    this.#assertExecutionContext(groupId, executionUserId);
    const completionToken = `${transitionId}:completion`;
    try {
      return await this.#mutateEntry(groupId, transitionId, (entry) => {
        if (entry.status === "completed" && cleanText(entry.completionToken) === completionToken) {
          return clone(entry);
        }
        if (entry.status !== "completion-pending" || cleanText(entry.completionToken) !== completionToken) {
          throw new Error("Calendar transition completion intent is unavailable.");
        }

        entry.status = "completed";
        entry.error = "";
        entry.completedAt = Date.now();
        return clone(entry);
      }, executionUserId);
    }
    catch (error) {
      const durableEntry = this.#readTransitionEntry(groupId, transitionId);
      if (
        durableEntry?.status === "completed"
        && cleanText(durableEntry.completionToken) === completionToken
      ) {
        return durableEntry;
      }
      throw error;
    }
  }

  #readTransitionEntry(groupId, transitionId) {
    const registry = this.groupContextService.getRegistry?.();
    const calendar = asObject(registry?.groupsById?.[groupId]?.calendar);
    const journal = normalizeJournal(calendar.transitionJournal);
    const entry = journal.entries.find((candidate) => candidate.transitionId === transitionId);
    return entry ? clone(entry) : null;
  }

  #buildCompletedReplay(entry, options) {
    const preview = this.#previewFromEntry(entry);
    const downtime = Object.entries(asObject(entry.downtimeByIsoDate))
      .map(([isoDate, result]) => ({ isoDate, ...clone(asObject(result)) }));
    const stage = (name) => asObject(entry.stages?.[name]);
    return {
      ...preview,
      transitionId: entry.transitionId,
      status: "completed",
      calendar: this.calendarService.getSnapshot(),
      downtime,
      eventActivation: clone(stage("globalEvents").result) ?? { changed: false },
      traderReset: clone(stage("traderMonthlyReset").result)
        ?? createEmptyTraderReset(options.reason, entry.monthResetCount),
      cycles: clone(stage("dayCycles").result) ?? createEmptyCycles(),
      reconciliation: []
    };
  }

  #mutateEntry(groupId, transitionId, mutator, executionUserId = "") {
    return this.#mutateJournal(groupId, (journal) => {
      const entry = journal.entries.find((candidate) => candidate.transitionId === transitionId);
      if (!entry) {
        throw new Error(`Calendar transition journal entry not found: ${transitionId}`);
      }
      const result = mutator(entry);
      entry.updatedAt = Date.now();
      return clone(result);
    }, executionUserId);
  }

  #mutateJournal(groupId, mutator, executionUserId = "") {
    this.#assertExecutionContext(groupId, executionUserId);
    return this.groupContextService.mutateGroupState(groupId, (groupState) => {
      this.#assertExecutionContext(groupId, executionUserId);
      const calendar = asObject(groupState.calendar);
      const journal = normalizeJournal(calendar.transitionJournal);
      const result = mutator(journal);
      groupState.calendar = {
        ...calendar,
        transitionJournal: journal
      };
      return clone(result);
    });
  }

  #createCallbackContext(groupId, transitionId, executionUserId = "") {
    const guard = () => this.#assertExecutionContext(groupId, executionUserId);
    return Object.freeze({
      groupId: cleanText(groupId),
      transitionId: cleanText(transitionId),
      userId: cleanText(executionUserId),
      assertExecutionContext: guard,
      guard
    });
  }

  #assertExecutionContext(groupId, executionUserId = "") {
    if (executionUserId && cleanText(globalThis.game?.user?.id) !== cleanText(executionUserId)) {
      throw new Error("Calendar transition execution changed to another GM client.");
    }
    if (!isActiveGmClient(globalThis.game)) {
      throw new Error("Calendar transitions must execute on the active GM client.");
    }

    let currentGroupId = "";
    try {
      currentGroupId = cleanText(this.groupContextService.resolveForCurrentUser()?.groupId);
    }
    catch (cause) {
      const error = new Error("Calendar transition aborted because the active Rebreya group changed.");
      error.cause = cause;
      throw error;
    }

    if (currentGroupId !== cleanText(groupId)) {
      throw new Error("Calendar transition aborted because the active Rebreya group changed.");
    }
  }
}
