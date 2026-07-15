# Downtime Calendar v2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace week-only downtime accounting with scheduled workday credits and make every manual calendar transition process approved downtime exactly once.

**Architecture:** Keep group-scoped persistence in `DowntimeService`, extract deterministic slot placement into a pure scheduler, and route all date movement through a transition coordinator. The existing inventory calendar renders scheduler summaries and confirms date changes; SmallTime opts into downtime processing while travel explicitly opts out.

**Tech Stack:** Foundry VTT v13, dnd5e, ApplicationV2/Handlebars, vanilla ES modules, `node:test`.

## Global Constraints

- One granted week equals exactly five workday credits.
- Scheduling starts at the nearest upcoming Monday; the current day is eligible when it is Monday.
- City workshop scheduling uses Monday-Friday; owned workshop scheduling uses all seven days without creating extra credits.
- Players never select dates.
- Forward manual changes and SmallTime process downtime; travel does not.
- Backward changes never reverse work and processed dates never run twice.
- Every date change initiated by the calendar UI requires confirmation.
- Right-clicking a day opens an informational downtime summary.
- Preserve active-group isolation and GM-owned durable mutations.

---

## File Map

- Create `scripts/data/downtime-scheduler.js`: pure date, grant-slot, request-allocation, release, and calendar-summary functions.
- Create `scripts/data/calendar-transition-coordinator.js`: idempotent forward/backward transition orchestration.
- Create `tests/downtime-scheduler.test.mjs`: scheduler and occupancy unit tests.
- Create `tests/calendar-transition-coordinator.test.mjs`: transition ordering, retry, and exclusion tests.
- Modify `scripts/data/downtime-service.js`: state-v2 normalization, migration, grants, allocations, slot processing, audit.
- Modify `scripts/data/calendar-service.js`: expose pure transition preview data without running domain work.
- Modify `scripts/main.js`: instantiate the coordinator and route every date-changing API through it.
- Modify `scripts/integrations/smalltime-compat.js`: use `processDowntime: true` independently from supply confirmation.
- Modify `scripts/data/travel-service.js` and `scripts/data/travel-map-service.js`: pass `processDowntime: false` explicitly.
- Modify `scripts/ui/inventory-app.js`: confirmation, right-click summary, and workday wording.
- Modify `templates/inventory-app.hbs`: status markers and workday balances.
- Modify `styles/main.css`: stable calendar cell dimensions and accessible status colors.
- Modify `tests/downtime-service.test.mjs`, `tests/calendar-service.test.mjs`, `tests/smalltime-compat.test.mjs`, and `tests/travel-service.test.mjs`.

### Task 1: Pure Workday Scheduler

**Interfaces:**

- Produces `nearestMonday(isoDate): string`.
- Produces `buildGrantSlots({ actorId, grantId, weeks, fromIsoDate, occupiedDates }): ScheduleSlot[]`.
- Produces `allocateRequestSlots({ slots, actorId, requestId, workdays, ownedWorkshop }): ScheduleSlot[]`.
- Produces `releaseFutureRequestSlots({ slots, requestId, currentIsoDate }): ScheduleSlot[]`.
- Produces `summarizeScheduleByDate(slots): Map<string, CalendarDaySummary>`.

- [ ] **Step 1: Write failing scheduler tests**

Add tests proving Monday anchoring, occupied-week skipping, a four-week grant yielding 20 credits, city allocation skipping weekends, owned-workshop allocation compacting over weekends, one activity per actor/day, release of only future unprocessed slots, and stable date summaries.

```js
test("owned workshop compacts the same twenty credits into weekends", () => {
  const slots = buildGrantSlots({
    actorId: "actor-1",
    grantId: "grant-1",
    weeks: 4,
    fromIsoDate: "2026-07-16",
    occupiedDates: new Set()
  });
  const allocated = allocateRequestSlots({
    slots,
    actorId: "actor-1",
    requestId: "request-1",
    workdays: 20,
    ownedWorkshop: true
  });
  assert.equal(allocated.filter((slot) => slot.requestId === "request-1").length, 20);
  assert.equal(allocated.find((slot) => slot.requestId === "request-1").isoDate, "2026-07-20");
  assert.equal(allocated.filter((slot) => slot.requestId === "request-1").at(-1).isoDate, "2026-08-08");
});
```

- [ ] **Step 2: Verify the tests fail**

Run: `node --test tests/downtime-scheduler.test.mjs`

Expected: FAIL because `scripts/data/downtime-scheduler.js` does not exist.

- [ ] **Step 3: Implement the scheduler**

Use UTC-only ISO date helpers. Build grants as 5-credit week blocks, then permit owned-workshop allocation to reflow unprocessed free credits onto consecutive dates while preserving credit count and actor occupancy. Never mutate input arrays.

```js
export function allocateRequestSlots({ slots, actorId, requestId, workdays, ownedWorkshop = false }) {
  const source = structuredClone(slots ?? []);
  const eligible = source
    .filter((slot) => slot.actorId === actorId && slot.status === "free")
    .sort((left, right) => left.isoDate.localeCompare(right.isoDate));
  if (eligible.length < workdays) throw new Error("Недостаточно свободных рабочих дней.");
  return reflowAndAssign(source, eligible.slice(0, workdays), { requestId, ownedWorkshop });
}
```

- [ ] **Step 4: Run scheduler tests**

Run: `node --test tests/downtime-scheduler.test.mjs`

Expected: all scheduler tests PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/data/downtime-scheduler.js tests/downtime-scheduler.test.mjs
git commit -m "feat: add downtime workday scheduler"
```

### Task 2: Downtime State v2 and Migration

**Interfaces:**

- Consumes scheduler functions from Task 1.
- Produces `DowntimeService.getSnapshot({ actorId })` with `version: 2`, `balancesByActorId`, `grants`, `scheduleSlots`, and `calendarByIsoDate`.
- Produces `grantWeeks({ actorIds, weeks, reason, fromIsoDate })` and request allocation/release through existing request APIs.
- Produces `processScheduledDate(isoDate, { transitionId, activityProcessor }): Promise<ProcessDateResult>`.

- [ ] **Step 1: Add failing state-v2 tests**

Extend `tests/downtime-service.test.mjs` with migration assertions (`weeks * 5`), idempotent normalization, pending slot allocation, approval status propagation, release on return/reject/cancel, and immutable processed slots.

```js
assert.deepEqual(snapshot.balance, {
  availableWorkdays: 10,
  reservedWorkdays: 5,
  spentWorkdays: 5,
  totalGrantedWorkdays: 20
});
assert.equal(snapshot.scheduleSlots.filter((slot) => slot.requestId === request.id).length, 5);
```

- [ ] **Step 2: Verify the tests fail**

Run: `node --test tests/downtime-service.test.mjs`

Expected: FAIL because the snapshot still exposes week balances and no schedule slots.

- [ ] **Step 3: Implement state normalization and mutations**

Add a single `normalizeDowntimeStateV2(value, currentIsoDate)` migration boundary. Preserve request/check/history fields, append migration audit once, and write v2 only through the existing group registry mutation path.

```js
async processScheduledDate(isoDate, { transitionId, activityProcessor } = {}) {
  this.#assertCanManage(this.#resolveContext());
  return this.#writeState(async (state) => processDateSlots(state, {
    isoDate,
    transitionId,
    activityProcessor
  }));
}
```

- [ ] **Step 4: Run downtime tests**

Run: `node --test tests/downtime-service.test.mjs tests/group-state-repository.test.mjs`

Expected: PASS with no v1 regression outside migrated field names.

- [ ] **Step 5: Commit**

```bash
git add scripts/data/downtime-service.js tests/downtime-service.test.mjs
git commit -m "feat: migrate downtime to scheduled workdays"
```

### Task 3: Unified Calendar Transition Coordinator

**Interfaces:**

- Consumes `CalendarService`, `DowntimeService`, existing global-event/trader/supply callbacks, and `refresh` callback.
- Produces `preview({ toIsoDate, processDowntime, reason }): CalendarTransitionPreview`.
- Produces `moveTo({ toIsoDate, processDowntime = true, processSupplies = false, reason }): Promise<CalendarTransitionResult>`.
- Transition IDs are deterministic from group, from/to date, and a persisted journal counter.

- [ ] **Step 1: Add failing coordinator tests**

Cover chronological date enumeration, forward processing, backward no-op for domain work, duplicate transition retry, a blocked day that still advances time, and `processDowntime: false`.

```js
await coordinator.moveTo({ toIsoDate: "2026-07-22", processDowntime: true, reason: "calendar-ui" });
await coordinator.moveTo({ toIsoDate: "2026-07-20", processDowntime: true, reason: "calendar-ui" });
await coordinator.moveTo({ toIsoDate: "2026-07-22", processDowntime: true, reason: "calendar-ui" });
assert.deepEqual(processedDates, ["2026-07-21", "2026-07-22"]);
```

- [ ] **Step 2: Verify the tests fail**

Run: `node --test tests/calendar-transition-coordinator.test.mjs`

Expected: FAIL because the coordinator is absent.

- [ ] **Step 3: Implement coordinator and calendar preview**

Keep date persistence in `CalendarService`; the coordinator owns sequencing and journals completed date/domain pairs. A slot failure becomes a blocked result and does not abort the remaining crossed dates.

```js
export class CalendarTransitionCoordinator {
  async moveTo({ toIsoDate, processDowntime = true, processSupplies = false, reason = "calendar" }) {
    const preview = this.preview({ toIsoDate, processDowntime, reason });
    const calendar = await this.calendarService.setDate(...isoDateParts(toIsoDate));
    const downtime = processDowntime && preview.direction === "forward"
      ? await this.#processDowntimeDates(preview.crossedDates, preview.transitionId)
      : [];
    await this.refresh();
    return { ...preview, calendar, downtime };
  }
}
```

- [ ] **Step 4: Route module APIs through the coordinator**

Instantiate it in `scripts/main.js`; make `setCalendarDate`, `shiftCalendarDays`, `advanceCalendarDays`, `advanceCalendarWeeks`, and `advanceCalendarMonths` delegate to `moveTo`. Preserve global events, trader resets, supplies, and SmallTime refresh as injected transition stages. Remove craft processing from `#runDayCycles` because craft now enters through scheduled downtime.

- [ ] **Step 5: Run transition and calendar tests**

Run: `node --test tests/calendar-transition-coordinator.test.mjs tests/calendar-service.test.mjs tests/crafting-service.test.mjs`

Expected: PASS; crafting tests may still cover legacy service directly but calendar no longer calls it.

- [ ] **Step 6: Commit**

```bash
git add scripts/data/calendar-transition-coordinator.js scripts/data/calendar-service.js scripts/main.js tests/calendar-transition-coordinator.test.mjs tests/calendar-service.test.mjs
git commit -m "feat: coordinate idempotent calendar transitions"
```

### Task 4: SmallTime and Travel Routing

**Interfaces:**

- SmallTime calls `shiftCalendarDays(dayDelta, { processDowntime: true, processSupplies, reason: "smalltime-world-time" })`.
- Travel calls date movement with `{ processDowntime: false, reason: "travel" }`.

- [ ] **Step 1: Write failing integration tests**

Assert that denying supply consumption does not disable downtime, positive SmallTime deltas process downtime, negative deltas do not, and travel always excludes downtime.

```js
assert.equal(shiftCalls[0].options.processDowntime, true);
assert.equal(shiftCalls[0].options.processSupplies, false);
```

- [ ] **Step 2: Verify the tests fail**

Run: `node --test tests/smalltime-compat.test.mjs tests/travel-service.test.mjs tests/travel-map-service.test.mjs`

Expected: FAIL because SmallTime currently ties all cycles to supply confirmation and travel lacks the new explicit option.

- [ ] **Step 3: Update integrations**

Build SmallTime options independently:

```js
await moduleApi.shiftCalendarDays(dayDelta, {
  processDowntime: dayDelta > 0,
  processSupplies: shouldConsumeSupplies,
  consumeSupplies: shouldConsumeSupplies,
  applyEnergy: shouldConsumeSupplies,
  reason: "smalltime-world-time"
});
```

Pass `processDowntime: false` at both travel date-advance call sites.

- [ ] **Step 4: Run integration tests and commit**

Run: `node --test tests/smalltime-compat.test.mjs tests/travel-service.test.mjs tests/travel-map-service.test.mjs`

Expected: PASS.

```bash
git add scripts/integrations/smalltime-compat.js scripts/data/travel-service.js scripts/data/travel-map-service.js tests/smalltime-compat.test.mjs tests/travel-service.test.mjs tests/travel-map-service.test.mjs
git commit -m "fix: route downtime by calendar change source"
```

### Task 5: Calendar and Downtime UI

**Interfaces:**

- Consumes `calendar.cells[].downtime = { total, dominantStatus, counts, entries }`.
- Calendar left-click calls preview, confirms, then performs the transition.
- Calendar right-click opens an informational context dialog for `entries`.

- [ ] **Step 1: Add failing view-model and template tests**

Extend `tests/inventory-app-context.test.mjs` and add string assertions for the template/CSS: all five statuses, numeric markers, workday labels, confirmation path, and `contextmenu` handler.

- [ ] **Step 2: Verify tests fail**

Run: `node --test tests/inventory-app-context.test.mjs tests/style-theme.test.mjs`

Expected: FAIL because cells have no downtime summaries.

- [ ] **Step 3: Implement view model and markup**

Render fixed-size markers without allowing text to resize the cell:

```hbs
<span class="rm-calendar-grid__day-number">{{day}}</span>
{{#if downtime.total}}<span class="rm-calendar-grid__total">{{downtime.total}}</span>{{/if}}
<span class="rm-calendar-grid__markers">
  {{#each downtime.markers}}<span class="rm-calendar-grid__marker is-{{status}}">{{count}}</span>{{/each}}
</span>
```

Use amber pending, blue approved, green processed, red blocked, and neutral free. Keep current-date border distinct.

- [ ] **Step 4: Add confirmation and right-click behavior**

Use the existing dialog/context-menu helpers. Confirmation text must include from/to date, direction, crossed-day count, and affected request count. Right-click calls `preventDefault()` and shows actor, activity, status, hours, workshop mode, and block reason.

- [ ] **Step 5: Remove the independent craft-day control and update wording**

Change group balances from weeks to workdays while keeping the GM grant input in weeks. Remove `data-action="craft-process-day"` from the template and listener.

- [ ] **Step 6: Run UI tests**

Run: `node --test tests/inventory-app-context.test.mjs tests/style-theme.test.mjs tests/downtime-service.test.mjs`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add scripts/ui/inventory-app.js templates/inventory-app.hbs styles/main.css tests/inventory-app-context.test.mjs tests/style-theme.test.mjs
git commit -m "feat: show scheduled downtime on calendar"
```

### Task 6: End-to-End Verification

- [ ] **Step 1: Run the focused suite**

Run: `node --test tests/downtime-scheduler.test.mjs tests/downtime-service.test.mjs tests/calendar-transition-coordinator.test.mjs tests/calendar-service.test.mjs tests/smalltime-compat.test.mjs tests/travel-service.test.mjs tests/travel-map-service.test.mjs tests/inventory-app-context.test.mjs tests/style-theme.test.mjs`

Expected: all tests PASS.

- [ ] **Step 2: Run the full suite**

Run: `node --test tests/*.test.mjs`

Expected: all tests PASS.

- [ ] **Step 3: Verify in Foundry as GM and player**

Grant four weeks and confirm 20 dated credits; submit two overlapping character requests; verify colored counts; approve one; advance from the calendar and SmallTime; move backward then forward; confirm no duplicate work; advance through travel and confirm no downtime; verify right-click details and every date-change confirmation.

- [ ] **Step 4: Commit verification fixes only if needed**

```bash
git add scripts tests templates styles
git commit -m "test: verify scheduled downtime transitions"
```
