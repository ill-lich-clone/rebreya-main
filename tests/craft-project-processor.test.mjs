import test from "node:test";
import assert from "node:assert/strict";

import { processCraftProjectWorkday } from "../scripts/data/craft-project-processor.js";

function createProject(overrides = {}) {
  return {
    id: "project-1",
    status: "active",
    targetGold: 20,
    progressGold: 0,
    reservation: {
      predominantMaterialLbReserved: 4,
      predominantMaterialLbSpent: 0,
      baseRawMaterialQuantityReserved: 10,
      baseRawMaterialQuantitySpent: 0
    },
    processedWorkdays: [],
    ...overrides
  };
}

test("processCraftProjectWorkday advances a partial day and returns proportional spend", () => {
  const source = createProject();
  const result = processCraftProjectWorkday(source, {
    isoDate: "2026-07-20",
    transitionId: "transition-1",
    dailyProgressGold: 5
  });

  assert.notEqual(result.project, source);
  assert.equal(source.progressGold, 0);
  assert.equal(result.project.progressGold, 5);
  assert.equal(result.project.status, "active");
  assert.deepEqual(result.spend, {
    predominantMaterialLb: 1,
    baseRawMaterialQuantity: 2.5
  });
  assert.equal(result.completion, false);
  assert.equal(result.alreadyProcessed, false);
  assert.deepEqual(result.project.processedWorkdays, [{
    isoDate: "2026-07-20",
    transitionId: "transition-1",
    progressGold: 5,
    spend: {
      predominantMaterialLb: 1,
      baseRawMaterialQuantity: 2.5
    }
  }]);
});

test("processor uses cumulative ratios so repeated rounding stays bounded", () => {
  let project = createProject({
    targetGold: 3,
    reservation: {
      predominantMaterialLbReserved: 1,
      predominantMaterialLbSpent: 0,
      baseRawMaterialQuantityReserved: 1,
      baseRawMaterialQuantitySpent: 0
    }
  });

  const first = processCraftProjectWorkday(project, {
    isoDate: "2026-07-20",
    transitionId: "transition-1",
    dailyProgressGold: 1
  });
  project = first.project;
  const second = processCraftProjectWorkday(project, {
    isoDate: "2026-07-21",
    transitionId: "transition-2",
    dailyProgressGold: 1
  });

  assert.deepEqual(first.spend, {
    predominantMaterialLb: 0.33333,
    baseRawMaterialQuantity: 0.33333
  });
  assert.deepEqual(second.spend, {
    predominantMaterialLb: 0.33334,
    baseRawMaterialQuantity: 0.33334
  });
  assert.equal(second.project.reservation.predominantMaterialLbSpent, 0.66667);
  assert.equal(second.project.reservation.baseRawMaterialQuantitySpent, 0.66667);
});

test("completion day consumes the exact remaining progress and reservation residue", () => {
  const project = createProject({
    targetGold: 3,
    progressGold: 2,
    reservation: {
      predominantMaterialLbReserved: 1,
      predominantMaterialLbSpent: 0.66667,
      baseRawMaterialQuantityReserved: 1,
      baseRawMaterialQuantitySpent: 0.66667
    },
    processedWorkdays: []
  });

  const result = processCraftProjectWorkday(project, {
    isoDate: "2026-07-22",
    transitionId: "transition-3",
    dailyProgressGold: 5
  });

  assert.equal(result.project.progressGold, 3);
  assert.equal(result.project.status, "completed");
  assert.deepEqual(result.spend, {
    predominantMaterialLb: 0.33333,
    baseRawMaterialQuantity: 0.33333
  });
  assert.equal(result.project.reservation.predominantMaterialLbSpent, 1);
  assert.equal(result.project.reservation.baseRawMaterialQuantitySpent, 1);
  assert.equal(result.completion, true);
});

test("retrying a processed transition is idempotent", () => {
  const recorded = {
    isoDate: "2026-07-20",
    transitionId: "transition-1",
    progressGold: 5,
    spend: {
      predominantMaterialLb: 1,
      baseRawMaterialQuantity: 2.5
    }
  };
  const project = createProject({
    progressGold: 5,
    reservation: {
      predominantMaterialLbReserved: 4,
      predominantMaterialLbSpent: 1,
      baseRawMaterialQuantityReserved: 10,
      baseRawMaterialQuantitySpent: 2.5
    },
    processedWorkdays: [recorded]
  });

  const result = processCraftProjectWorkday(project, {
    isoDate: "2026-07-20",
    transitionId: "transition-1",
    dailyProgressGold: 99
  });

  assert.deepEqual(result.project, project);
  assert.deepEqual(result.spend, recorded.spend);
  assert.equal(result.alreadyProcessed, true);
  assert.equal(result.completion, false);
});

test("paused and blocked projects return a stable blocked result without mutation", () => {
  for (const status of ["paused", "blocked"]) {
    const project = createProject({ status, blockReason: "Missing workshop" });
    const result = processCraftProjectWorkday(project, {
      isoDate: "2026-07-20",
      transitionId: "transition-1",
      dailyProgressGold: 5
    });

    assert.deepEqual(result.project, project);
    assert.deepEqual(result.spend, {
      predominantMaterialLb: 0,
      baseRawMaterialQuantity: 0
    });
    assert.equal(result.blocked, true);
    assert.match(result.blockReason, /workshop/i);
  }
});

test("completed projects are idempotent no-ops", () => {
  const project = createProject({ status: "completed", progressGold: 20 });
  const result = processCraftProjectWorkday(project, {
    isoDate: "2026-07-25",
    transitionId: "transition-5",
    dailyProgressGold: 5
  });

  assert.deepEqual(result.project, project);
  assert.equal(result.completion, false);
  assert.equal(result.alreadyCompleted, true);
});

test("processor rejects invalid operation and inconsistent reservation state", () => {
  assert.throws(() => processCraftProjectWorkday(createProject(), {
    isoDate: "",
    transitionId: "transition-1",
    dailyProgressGold: 5
  }), /date/i);
  assert.throws(() => processCraftProjectWorkday(createProject(), {
    isoDate: "2026-07-20",
    transitionId: "",
    dailyProgressGold: 5
  }), /transition/i);
  assert.throws(() => processCraftProjectWorkday(createProject(), {
    isoDate: "2026-07-20",
    transitionId: "transition-1",
    dailyProgressGold: 0
  }), /progress/i);
  assert.throws(() => processCraftProjectWorkday(createProject({
    reservation: {
      predominantMaterialLbReserved: 1,
      predominantMaterialLbSpent: 2,
      baseRawMaterialQuantityReserved: 1,
      baseRawMaterialQuantitySpent: 0
    }
  }), {
    isoDate: "2026-07-20",
    transitionId: "transition-1",
    dailyProgressGold: 5
  }), /reservation/i);
});

