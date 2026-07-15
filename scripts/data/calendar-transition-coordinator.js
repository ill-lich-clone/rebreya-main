const JOURNAL_VERSION = 1;
const MAX_JOURNAL_ENTRIES = 100;
const DOWNTIME_STATUSES = ["free", "pending", "approved", "processed", "blocked"];

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
    reason: cleanText(source.reason) || "calendar"
  };
}

function operationMatches(entry, preview, options) {
  const sameOptions = entry.reason === options.reason
    && entry.processDowntime === options.processDowntime
    && entry.processSupplies === options.processSupplies
    && entry.processDailyCycles === options.processDailyCycles
    && entry.consumeSupplies === options.consumeSupplies
    && entry.applyEnergy === options.applyEnergy
    && entry.refreshApps === options.refreshApps
    && entry.refreshSmallTime === options.refreshSmallTime
    && entry.monthResetMode === options.monthResetMode;
  if (!sameOptions || entry.toIsoDate !== preview.toIsoDate || entry.status === "completed") {
    return false;
  }

  return entry.fromIsoDate === preview.fromIsoDate
    || (preview.direction === "same" && preview.fromIsoDate === entry.toIsoDate);
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
    activityProcessor = null
  } = {}) {
    if (!calendarService?.previewTransition || !calendarService?.setDate) {
      throw new Error("Calendar transition coordinator requires CalendarService.");
    }
    if (!groupContextService?.resolveForCurrentUser || !groupContextService?.mutateGroupState) {
      throw new Error("Calendar transition coordinator requires queued group state mutations.");
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
  }

  preview({
    toIsoDate,
    processDowntime = true,
    processSupplies = false,
    reason = "calendar"
  } = {}) {
    const calendarPreview = this.calendarService.previewTransition(toIsoDate);
    return this.#enrichPreview(calendarPreview, {
      processDowntime,
      processSupplies,
      reason
    });
  }

  async moveTo(options = {}) {
    const normalizedOptions = normalizeMoveOptions(options);
    const requestedPreview = this.preview({
      toIsoDate: options.toIsoDate,
      processDowntime: normalizedOptions.processDowntime,
      processSupplies: normalizedOptions.processSupplies,
      reason: normalizedOptions.reason
    });
    const context = this.groupContextService.resolveForCurrentUser();
    if (!context?.groupId) {
      throw new Error("Calendar transitions require an active Rebreya group.");
    }

    const claim = await this.#claimTransition(context.groupId, requestedPreview, normalizedOptions, options);
    const preview = claim.resumed
      ? this.#previewFromEntry(claim.entry)
      : requestedPreview;
    const transitionId = claim.entry.transitionId;
    let calendar;

    try {
      calendar = await this.#persistCalendar(context.groupId, transitionId, preview.toIsoDate, options);
    }
    catch (error) {
      await this.#setTransitionStatus(context.groupId, transitionId, "reconciliation-required", errorMessage(error))
        .catch(() => undefined);
      throw error;
    }

    const downtime = await this.#processDowntimeDates(context.groupId, claim.entry, preview);
    const eventStage = await this.#runExternalStage({
      groupId: context.groupId,
      transitionId,
      name: "globalEvents",
      callback: this.refreshGlobalEvents
        ? () => this.refreshGlobalEvents(preview.toIsoDate, preview.fromIsoDate, {
          operationId: `${transitionId}:global-events`
        })
        : null
    });
    const monthResetCount = claim.entry.monthResetCount;
    const traderStage = await this.#runExternalStage({
      groupId: context.groupId,
      transitionId,
      name: "traderMonthlyReset",
      callback: this.resetTraderMonth
        ? () => this.resetTraderMonth(monthResetCount, normalizedOptions.reason, {
          operationId: `${transitionId}:trader-monthly-reset`
        })
        : null
    });
    const cyclesStage = preview.direction === "forward" && normalizedOptions.processDailyCycles
      ? await this.#runExternalStage({
        groupId: context.groupId,
        transitionId,
        name: "dayCycles",
        callback: this.processDayCycles
          ? () => this.processDayCycles(preview.crossedDates.length, {
            ...options,
            processDowntime: normalizedOptions.processDowntime,
            processSupplies: normalizedOptions.processSupplies,
            consumeSupplies: normalizedOptions.processSupplies && normalizedOptions.consumeSupplies,
            applyEnergy: normalizedOptions.applyEnergy,
            operationId: `${transitionId}:day-cycles`
          })
          : null
      })
      : await this.#skipStage(context.groupId, transitionId, "dayCycles");
    const refreshAppsStage = normalizedOptions.refreshApps
      ? await this.#runExternalStage({
        groupId: context.groupId,
        transitionId,
        name: "refreshApps",
        callback: this.refreshApps
          ? () => this.refreshApps({ operationId: `${transitionId}:refresh-apps` })
          : null
      })
      : await this.#skipStage(context.groupId, transitionId, "refreshApps");
    const refreshSmallTimeStage = normalizedOptions.refreshSmallTime
      ? await this.#runExternalStage({
        groupId: context.groupId,
        transitionId,
        name: "refreshSmallTime",
        callback: this.refreshSmallTime
          ? () => this.refreshSmallTime({ operationId: `${transitionId}:refresh-smalltime` })
          : null
      })
      : await this.#skipStage(context.groupId, transitionId, "refreshSmallTime");

    const reconciliation = [
      ...downtime.filter((entry) => entry.status === "reconciliation-required"),
      ...[eventStage, traderStage, cyclesStage, refreshAppsStage, refreshSmallTimeStage]
        .filter((stage) => stage.status === "reconciliation-required")
    ];
    const status = reconciliation.length ? "reconciliation-required" : "completed";
    await this.#setTransitionStatus(context.groupId, transitionId, status);

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

  async #claimTransition(groupId, preview, options, rawOptions) {
    return this.#mutateJournal(groupId, (journal) => {
      const existing = [...journal.entries].reverse().find((entry) => operationMatches(entry, preview, options));
      if (existing) {
        existing.updatedAt = Date.now();
        return { entry: clone(existing), resumed: true };
      }

      const counter = journal.counter + 1;
      const transitionId = `calendar:${groupId}:${counter}:${preview.fromIsoDate}:${preview.toIsoDate}`;
      const explicitMonthResetCount = Number(rawOptions.monthResetCount);
      const monthResetCount = Number.isFinite(explicitMonthResetCount)
        ? Math.max(0, Math.floor(explicitMonthResetCount))
        : options.monthResetMode === "target-first"
          ? (preview.fromIsoDate !== preview.toIsoDate && Number(preview.to?.day ?? 0) === 1 ? 1 : 0)
          : preview.monthStartDates.length;
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
        downtimeByIsoDate: Object.fromEntries(
          options.processDowntime && preview.direction === "forward"
            ? preview.crossedDates.map((isoDate) => [isoDate, { status: "pending" }])
            : []
        ),
        createdAt: now,
        updatedAt: now
      };
      journal.counter = counter;
      journal.entries.push(entry);
      journal.entries = journal.entries.slice(-MAX_JOURNAL_ENTRIES);
      return { entry: clone(entry), resumed: false };
    });
  }

  async #persistCalendar(groupId, transitionId, toIsoDate, calendarOptions = {}) {
    const claim = await this.#mutateEntry(groupId, transitionId, (entry) => {
      const stage = asObject(entry.stages.calendar);
      if (stage.status === "completed") {
        return { completed: true };
      }
      entry.stages.calendar = {
        ...stage,
        status: "processing",
        startedAt: Number(stage.startedAt) || Date.now()
      };
      return { completed: false };
    });
    if (claim.completed) {
      return this.calendarService.getSnapshot();
    }

    const calendar = await this.calendarService.setDate(...isoDateParts(toIsoDate), calendarOptions);
    await this.#mutateEntry(groupId, transitionId, (entry) => {
      entry.stages.calendar = {
        status: "completed",
        result: { isoDate: calendar.isoDate },
        completedAt: Date.now()
      };
    });
    return calendar;
  }

  async #processDowntimeDates(groupId, entry, preview) {
    if (!entry.processDowntime || preview.direction !== "forward") {
      return [];
    }

    const results = [];
    for (const isoDate of preview.crossedDates) {
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
      });

      if (!claim.run) {
        results.push({ isoDate, ...claim.entry });
        continue;
      }

      let status = "reconciliation-required";
      let result = null;
      let error = "";
      try {
        result = await this.downtimeService?.processScheduledDate?.(isoDate, {
          transitionId: entry.transitionId,
          activityProcessor: this.activityProcessor
        });
        status = classifyDowntimeResult(result);
      }
      catch (caughtError) {
        error = errorMessage(caughtError);
      }

      const persisted = {
        status,
        result: clone(result),
        error,
        completedAt: Date.now()
      };
      await this.#mutateEntry(groupId, entry.transitionId, (journalEntry) => {
        journalEntry.downtimeByIsoDate[isoDate] = clone(persisted);
      });
      results.push({ isoDate, ...persisted });
    }
    return results;
  }

  async #runExternalStage({ groupId, transitionId, name, callback }) {
    if (!callback) {
      return this.#skipStage(groupId, transitionId, name);
    }

    const claim = await this.#mutateEntry(groupId, transitionId, (entry) => {
      const stage = asObject(entry.stages[name]);
      if (["completed", "skipped", "reconciliation-required"].includes(stage.status)) {
        return { run: false, stage: clone(stage) };
      }
      if (stage.status === "processing") {
        const ambiguous = {
          ...stage,
          status: "reconciliation-required",
          error: "External stage completion is ambiguous after an interrupted transition.",
          completedAt: Date.now()
        };
        entry.stages[name] = ambiguous;
        return { run: false, stage: clone(ambiguous) };
      }

      entry.stages[name] = {
        status: "processing",
        startedAt: Date.now()
      };
      return { run: true };
    });
    if (!claim.run) {
      return { name, ...claim.stage };
    }

    let status = "completed";
    let result = null;
    let error = "";
    try {
      result = await callback();
    }
    catch (caughtError) {
      status = "reconciliation-required";
      error = errorMessage(caughtError);
    }

    const stage = {
      status,
      result: result === undefined ? null : clone(result),
      error,
      completedAt: Date.now()
    };
    await this.#mutateEntry(groupId, transitionId, (entry) => {
      entry.stages[name] = clone(stage);
    });
    return { name, ...stage };
  }

  async #skipStage(groupId, transitionId, name) {
    const stage = await this.#mutateEntry(groupId, transitionId, (entry) => {
      const current = asObject(entry.stages[name]);
      if (current.status === "completed" || current.status === "reconciliation-required") {
        return clone(current);
      }
      const skipped = { status: "skipped", result: null, completedAt: Date.now() };
      entry.stages[name] = skipped;
      return clone(skipped);
    });
    return { name, ...stage };
  }

  #setTransitionStatus(groupId, transitionId, status, error = "") {
    return this.#mutateEntry(groupId, transitionId, (entry) => {
      entry.status = status;
      entry.error = cleanText(error);
      entry.updatedAt = Date.now();
      if (status === "completed") {
        entry.completedAt = Date.now();
      }
    });
  }

  #mutateEntry(groupId, transitionId, mutator) {
    return this.#mutateJournal(groupId, (journal) => {
      const entry = journal.entries.find((candidate) => candidate.transitionId === transitionId);
      if (!entry) {
        throw new Error(`Calendar transition journal entry not found: ${transitionId}`);
      }
      const result = mutator(entry);
      entry.updatedAt = Date.now();
      return clone(result);
    });
  }

  #mutateJournal(groupId, mutator) {
    return this.groupContextService.mutateGroupState(groupId, (groupState) => {
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
}
