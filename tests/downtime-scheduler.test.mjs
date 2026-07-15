import test from "node:test";
import assert from "node:assert/strict";

import {
  allocateRequestSlots,
  buildGrantSlots,
  nearestMonday,
  releaseFutureRequestSlots,
  summarizeScheduleByDate
} from "../scripts/data/downtime-scheduler.js";

test("nearest Monday includes Monday and otherwise anchors to the following week", () => {
  assert.equal(nearestMonday("2026-07-20"), "2026-07-20");
  assert.equal(nearestMonday("2026-07-16"), "2026-07-20");
  assert.equal(nearestMonday("2026-07-19"), "2026-07-20");
});

test("grant slots skip an occupied week as a whole", () => {
  const slots = buildGrantSlots({
    actorId: "actor-1",
    grantId: "grant-1",
    weeks: 2,
    fromIsoDate: "2026-07-16",
    occupiedDates: new Set(["2026-07-22"])
  });

  assert.equal(slots.length, 10);
  assert.equal(slots[0].isoDate, "2026-07-27");
  assert.equal(slots.at(-1).isoDate, "2026-08-07");
  assert.ok(slots.every((slot) => slot.status === "free"));
});

test("a four-week grant yields twenty weekday credits", () => {
  const slots = buildGrantSlots({
    actorId: "actor-1",
    grantId: "grant-1",
    weeks: 4,
    fromIsoDate: "2026-07-16",
    occupiedDates: new Set()
  });

  assert.equal(slots.length, 20);
  assert.equal(slots[0].isoDate, "2026-07-20");
  assert.equal(slots.at(-1).isoDate, "2026-08-14");
  assert.ok(slots.every((slot) => ![0, 6].includes(new Date(`${slot.isoDate}T00:00:00Z`).getUTCDay())));
});

test("city allocation reserves weekdays without mutating the grant slots", () => {
  const slots = buildGrantSlots({
    actorId: "actor-1",
    grantId: "grant-1",
    weeks: 2,
    fromIsoDate: "2026-07-16",
    occupiedDates: new Set()
  });
  const snapshot = structuredClone(slots);

  const allocated = allocateRequestSlots({
    slots,
    actorId: "actor-1",
    requestId: "request-1",
    workdays: 10,
    ownedWorkshop: false
  });
  const requestSlots = allocated.filter((slot) => slot.requestId === "request-1");

  assert.deepEqual(slots, snapshot);
  assert.deepEqual(requestSlots.map((slot) => slot.isoDate), [
    "2026-07-20", "2026-07-21", "2026-07-22", "2026-07-23", "2026-07-24",
    "2026-07-27", "2026-07-28", "2026-07-29", "2026-07-30", "2026-07-31"
  ]);
  assert.ok(requestSlots.every((slot) => slot.status === "pending"));
});

test("city allocation never uses released owned-workshop weekend credits", () => {
  const slots = [
    { id: "weekend-credit", actorId: "actor-1", isoDate: "2026-07-25", status: "free", requestId: null },
    { id: "weekday-credit", actorId: "actor-1", isoDate: "2026-07-27", status: "free", requestId: null }
  ];

  const allocated = allocateRequestSlots({
    slots,
    actorId: "actor-1",
    requestId: "request-1",
    workdays: 1,
    ownedWorkshop: false
  });

  assert.equal(allocated.find((slot) => slot.id === "weekend-credit").status, "free");
  assert.equal(allocated.find((slot) => slot.id === "weekday-credit").requestId, "request-1");
});

test("city allocation keeps one primary activity per actor and day", () => {
  const slots = [
    { id: "occupied-credit", actorId: "actor-1", isoDate: "2026-07-20", status: "free", requestId: null },
    { id: "existing-activity", actorId: "actor-1", isoDate: "2026-07-20", status: "approved", requestId: "existing-request" },
    { id: "available-credit", actorId: "actor-1", isoDate: "2026-07-21", status: "free", requestId: null }
  ];

  const allocated = allocateRequestSlots({
    slots,
    actorId: "actor-1",
    requestId: "request-1",
    workdays: 1,
    ownedWorkshop: false
  });

  assert.equal(allocated.find((slot) => slot.id === "occupied-credit").status, "free");
  assert.equal(allocated.find((slot) => slot.id === "available-credit").requestId, "request-1");
});

test("allocation reports insufficient free workdays with readable text", () => {
  assert.throws(
    () => allocateRequestSlots({
      slots: [],
      actorId: "actor-1",
      requestId: "request-1",
      workdays: 1
    }),
    { message: "Insufficient free workdays." }
  );
});

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

test("owned workshop reflow keeps one activity per actor and day", () => {
  const grantSlots = buildGrantSlots({
    actorId: "actor-1",
    grantId: "grant-1",
    weeks: 1,
    fromIsoDate: "2026-07-16",
    occupiedDates: new Set()
  });
  const occupied = {
    id: "existing-slot",
    actorId: "actor-1",
    isoDate: "2026-07-22",
    status: "approved",
    requestId: "existing-request"
  };
  const otherActor = {
    id: "other-actor-slot",
    actorId: "actor-2",
    isoDate: "2026-07-20",
    status: "approved",
    requestId: "other-request"
  };

  const allocated = allocateRequestSlots({
    slots: [...grantSlots, occupied, otherActor],
    actorId: "actor-1",
    requestId: "request-1",
    workdays: 5,
    ownedWorkshop: true
  });
  const actorDates = allocated
    .filter((slot) => slot.actorId === "actor-1")
    .map((slot) => slot.isoDate);

  assert.equal(new Set(actorDates).size, actorDates.length);
  assert.equal(allocated.find((slot) => slot.id === "other-actor-slot").isoDate, "2026-07-20");
  assert.deepEqual(
    allocated.filter((slot) => slot.requestId === "request-1").map((slot) => slot.isoDate),
    ["2026-07-20", "2026-07-21", "2026-07-23", "2026-07-24", "2026-07-25"]
  );
});

test("release frees only future unprocessed request slots", () => {
  const slots = [
    { id: "past", actorId: "actor-1", isoDate: "2026-07-19", status: "approved", requestId: "request-1" },
    { id: "today", actorId: "actor-1", isoDate: "2026-07-20", status: "pending", requestId: "request-1" },
    { id: "future", actorId: "actor-1", isoDate: "2026-07-21", status: "approved", requestId: "request-1", projectId: "project-1" },
    { id: "processed", actorId: "actor-1", isoDate: "2026-07-22", status: "processed", requestId: "request-1" },
    { id: "other", actorId: "actor-1", isoDate: "2026-07-23", status: "pending", requestId: "request-2" }
  ];
  const snapshot = structuredClone(slots);

  const released = releaseFutureRequestSlots({
    slots,
    requestId: "request-1",
    currentIsoDate: "2026-07-20"
  });

  assert.deepEqual(slots, snapshot);
  assert.equal(released.find((slot) => slot.id === "past").status, "approved");
  assert.equal(released.find((slot) => slot.id === "today").status, "pending");
  assert.deepEqual(released.find((slot) => slot.id === "future"), {
    id: "future",
    actorId: "actor-1",
    isoDate: "2026-07-21",
    status: "free",
    requestId: null,
    projectId: null
  });
  assert.equal(released.find((slot) => slot.id === "processed").status, "processed");
  assert.equal(released.find((slot) => slot.id === "other").requestId, "request-2");
});

test("date summaries are stable regardless of slot input order", () => {
  const slots = [
    { id: "b", actorId: "actor-2", isoDate: "2026-07-21", status: "approved", requestId: "request-2" },
    { id: "c", actorId: "actor-1", isoDate: "2026-07-20", status: "free", requestId: null },
    { id: "a", actorId: "actor-1", isoDate: "2026-07-21", status: "pending", requestId: "request-1" }
  ];

  const forward = summarizeScheduleByDate(slots);
  const reverse = summarizeScheduleByDate([...slots].reverse());

  assert.deepEqual([...forward], [...reverse]);
  assert.deepEqual([...forward.keys()], ["2026-07-20", "2026-07-21"]);
  assert.deepEqual(forward.get("2026-07-21"), {
    isoDate: "2026-07-21",
    total: 2,
    counts: { free: 0, pending: 1, approved: 1, processed: 0, blocked: 0 },
    slots: [slots[2], slots[0]]
  });
});
