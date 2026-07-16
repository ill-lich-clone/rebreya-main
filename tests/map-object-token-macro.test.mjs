import test from "node:test";
import assert from "node:assert/strict";

import { normalizeMapObjectInput } from "../scripts/data/map-object-token-service.js";
import {
  promptMapObjectInput,
  runMapObjectTokenMacro,
  waitForMapObjectPlacement
} from "../scripts/integrations/map-object-token-macro.js";

function createForm(values = {}) {
  return {
    elements: Object.fromEntries(Object.entries(values).map(([name, value]) => [name, { value }]))
  };
}

function createDialogV2(respond) {
  let options = null;
  return {
    DialogV2: {
      async wait(nextOptions) {
        options = nextOptions;
        return respond(nextOptions);
      }
    },
    get options() {
      return options;
    }
  };
}

function createEmitter() {
  const listeners = new Map();
  const registrations = new Map();
  return {
    on(event, listener) {
      listeners.set(event, listener);
      registrations.set(event, (registrations.get(event) ?? 0) + 1);
    },
    off(event, listener) {
      if (listeners.get(event) === listener) {
        listeners.delete(event);
      }
    },
    emit(event, payload) {
      listeners.get(event)?.(payload);
    },
    getListener(event) {
      return listeners.get(event) ?? null;
    },
    listenerCount() {
      return listeners.size;
    },
    registrationCount(event) {
      return registrations.get(event) ?? 0;
    }
  };
}

function createDocumentTarget() {
  const listeners = new Map();
  return {
    addEventListener(event, listener) {
      listeners.set(event, listener);
    },
    removeEventListener(event, listener) {
      if (listeners.get(event) === listener) {
        listeners.delete(event);
      }
    },
    emit(event, payload) {
      listeners.get(event)?.(payload);
    },
    listenerCount() {
      return listeners.size;
    }
  };
}

function createPlacementEnvironment({ grid = null } = {}) {
  const stage = createEmitter();
  const documentTarget = createDocumentTarget();
  const view = { oncontextmenu: null };
  const canvas = {
    ready: true,
    scene: { id: "scene-1" },
    stage,
    tokens: { id: "token-layer" },
    app: { view },
    grid: grid ?? {
      size: 100,
      getSnappedPoint: ({ x, y }) => ({ x: x - 18, y: y + 4 })
    }
  };
  return { canvas, documentTarget, stage, view };
}

function assertPlacementListenersRemoved(environment) {
  assert.equal(environment.stage.listenerCount(), 0);
  assert.equal(environment.documentTarget.listenerCount(), 0);
  assert.equal(environment.view.oncontextmenu, null);
}

async function waitForStageListener(stage) {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    if (stage.listenerCount() > 0) {
      return;
    }
    await Promise.resolve();
  }
  throw new Error("placement listener was not registered");
}

test("promptMapObjectInput opens one unconstrained Russian form surface with documented defaults and normalizes submitted values", async () => {
  const dialog = createDialogV2((options) => options.buttons[0].callback(null, {
    form: createForm({
      name: "  Portcullis  ",
      hp: "30",
      ac: "18",
      damageThreshold: "10",
      size: "1.5"
    })
  }));

  const result = await promptMapObjectInput({ DialogV2: dialog.DialogV2 });

  assert.deepEqual(result, {
    name: "Portcullis",
    hp: 30,
    ac: 18,
    damageThreshold: 10,
    size: 1.5
  });
  assert.equal(dialog.options.window.title, "Создать объект на карте");
  assert.equal(dialog.options.buttons[0].label, "Разместить");
  assert.equal(dialog.options.buttons[1].label, "Отмена");
  assert.doesNotMatch(dialog.options.content, /<form\b/u);
  assert.doesNotMatch(dialog.options.content, /\s(?:required|min|max|step)(?:=|\s|>)/u);
  for (const label of ["Название", "ОЗ", "Класс доспеха", "Порог урона", "Размер в клетках"]) {
    assert.match(dialog.options.content, new RegExp(label, "u"));
  }
  for (const field of ["name", "hp", "ac", "damageThreshold", "size"]) {
    assert.match(dialog.options.content, new RegExp(`name="${field}"`, "u"));
  }
  const defaults = normalizeMapObjectInput({});
  assert.match(dialog.options.content, new RegExp(`value="${defaults.name}"`, "u"));
  assert.match(dialog.options.content, /name="hp"[^>]*value="10"/u);
  assert.match(dialog.options.content, /name="ac"[^>]*value="10"/u);
  assert.match(dialog.options.content, /name="damageThreshold"[^>]*value="0"/u);
  assert.match(dialog.options.content, /name="size"[^>]*value="1"/u);
});

test("promptMapObjectInput returns null when the dialog is cancelled", async () => {
  const dialog = createDialogV2(() => null);

  const result = await promptMapObjectInput({ DialogV2: dialog.DialogV2 });

  assert.equal(result, null);
});

test("promptMapObjectInput reports normalizer failures and does not return invalid input", async () => {
  const errors = [];
  const dialog = createDialogV2((options) => options.buttons[0].callback(null, {
    form: createForm({ name: "Broken", hp: "0", ac: "10", damageThreshold: "0", size: "1" })
  }));

  const result = await promptMapObjectInput({
    DialogV2: dialog.DialogV2,
    notifyError: (message) => errors.push(message)
  });

  assert.notEqual(result, null);
  assert.deepEqual(errors, ["Некорректные параметры объекта."]);
});

test("waitForMapObjectPlacement resolves the first primary mousedown to a snapped v13 scene point", async () => {
  const environment = createPlacementEnvironment();
  const placement = waitForMapObjectPlacement(environment);

  assert.equal(environment.stage.listenerCount(), 1);
  assert.equal(environment.documentTarget.listenerCount(), 2);
  environment.stage.emit("mousedown", {
    button: 0,
    data: {
      getLocalPosition(target) {
        assert.strictEqual(target, environment.canvas.tokens);
        return { x: 118, y: 246 };
      }
    }
  });

  assert.deepEqual(await placement, { x: 100, y: 250 });
  assertPlacementListenersRemoved(environment);
});

test("waitForMapObjectPlacement passes Foundry v13 center snapping options", async () => {
  const originalConst = globalThis.CONST;
  globalThis.CONST = {
    ...originalConst,
    GRID_SNAPPING_MODES: { CENTER: 77 }
  };
  const environment = createPlacementEnvironment({
    grid: {
      size: 100,
      getSnappedPoint(point, options) {
        assert.deepEqual(options, { mode: 77, resolution: 1 });
        return { x: point.x - 18, y: point.y + 4 };
      }
    }
  });

  try {
    const placement = waitForMapObjectPlacement(environment);
    environment.stage.emit("mousedown", {
      button: 0,
      data: { getLocalPosition: () => ({ x: 118, y: 246 }) }
    });

    assert.deepEqual(await placement, { x: 100, y: 250 });
    assertPlacementListenersRemoved(environment);
  }
  finally {
    globalThis.CONST = originalConst;
  }
});

test("waitForMapObjectPlacement supports direct local-position events and grid-size rounding", async () => {
  const environment = createPlacementEnvironment({ grid: { size: 50 } });
  const placement = waitForMapObjectPlacement(environment);

  environment.stage.emit("mousedown", {
    button: 0,
    getLocalPosition(target) {
      assert.strictEqual(target, environment.canvas.tokens);
      return { x: 74, y: 126 };
    }
  });

  assert.deepEqual(await placement, { x: 50, y: 150 });
  assertPlacementListenersRemoved(environment);
});

test("waitForMapObjectPlacement resolves null and cleans up on Escape", async () => {
  const environment = createPlacementEnvironment();
  const placement = waitForMapObjectPlacement(environment);

  environment.documentTarget.emit("keydown", { key: "Escape" });

  assert.equal(await placement, null);
  assertPlacementListenersRemoved(environment);
});

test("waitForMapObjectPlacement resolves null and cleans up on canvas-view and document right clicks", async () => {
  const canvasViewEnvironment = createPlacementEnvironment();
  const canvasViewPlacement = waitForMapObjectPlacement(canvasViewEnvironment);
  let prevented = 0;

  canvasViewEnvironment.view.oncontextmenu({ preventDefault: () => { prevented += 1; } });

  assert.equal(await canvasViewPlacement, null);
  assert.equal(prevented, 1);
  assertPlacementListenersRemoved(canvasViewEnvironment);

  const documentEnvironment = createPlacementEnvironment();
  const documentPlacement = waitForMapObjectPlacement(documentEnvironment);
  documentEnvironment.documentTarget.emit("contextmenu", { preventDefault() {} });

  assert.equal(await documentPlacement, null);
  assertPlacementListenersRemoved(documentEnvironment);
});

test("waitForMapObjectPlacement rejects on placement errors, cleans up, and ignores stale repeated completion attempts", async () => {
  let snapAttempts = 0;
  const environment = createPlacementEnvironment({
    grid: {
      size: 100,
      getSnappedPoint() {
        snapAttempts += 1;
        throw new Error("snap failed");
      }
    }
  });
  const placement = waitForMapObjectPlacement(environment);
  const staleMouseDown = environment.stage.getListener("mousedown");

  staleMouseDown({
    button: 0,
    data: { getLocalPosition: () => ({ x: 100, y: 100 }) }
  });

  await assert.rejects(placement, /snap failed/u);
  assertPlacementListenersRemoved(environment);

  let settlements = 0;
  placement.then(() => { settlements += 1; }, () => { settlements += 1; });
  staleMouseDown({
    button: 0,
    data: { getLocalPosition: () => ({ x: 200, y: 200 }) }
  });
  await Promise.resolve();
  assert.equal(settlements, 1);
  assert.equal(snapAttempts, 1);
});

test("runMapObjectTokenMacro rejects non-GM users and missing active scenes", async () => {
  const errors = [];
  const nonGmDialog = createDialogV2(() => {
    throw new Error("dialog should not open");
  });

  await assert.rejects(runMapObjectTokenMacro({
    service: { createToken() {} },
    game: { user: { isGM: false } },
    canvas: {},
    DialogV2: nonGmDialog.DialogV2,
    notifications: { error: (message) => errors.push(message) }
  }), /мастер/u);
  assert.equal(nonGmDialog.options, null);
  assert.deepEqual(errors, ["Создавать объекты на карте может только мастер."]);

  const missingSceneDialog = createDialogV2(() => {
    throw new Error("dialog should not open");
  });
  const missingSceneErrors = [];
  await assert.rejects(runMapObjectTokenMacro({
    service: { createToken() {} },
    game: { user: { isGM: true }, scenes: { active: null } },
    canvas: {},
    DialogV2: missingSceneDialog.DialogV2,
    notifications: { error: (message) => missingSceneErrors.push(message) }
  }), /активная сцена/u);
  assert.equal(missingSceneDialog.options, null);
  assert.deepEqual(missingSceneErrors, ["Для создания объекта нужна активная сцена."]);
});

test("runMapObjectTokenMacro rejects an unavailable canvas before opening the form", async () => {
  const dialog = createDialogV2(() => {
    throw new Error("dialog should not open");
  });
  const errors = [];
  const activeScene = { id: "scene-1" };

  await assert.rejects(runMapObjectTokenMacro({
    service: { createToken() {} },
    game: { user: { isGM: true }, scenes: { active: activeScene } },
    canvas: { scene: activeScene },
    DialogV2: dialog.DialogV2,
    notifications: { error: (message) => errors.push(message) }
  }), /canvas/u);

  assert.equal(dialog.options, null);
  assert.deepEqual(errors, ["Для создания объекта нужен открытый canvas активной сцены."]);
});

test("runMapObjectTokenMacro rejects a blank not-ready canvas before opening the form", async () => {
  const dialog = createDialogV2(() => {
    throw new Error("dialog should not open");
  });
  const errors = [];

  await assert.rejects(runMapObjectTokenMacro({
    service: { createToken() {} },
    game: { user: { isGM: true }, scenes: { active: { id: "scene-1" } } },
    canvas: {
      ready: false,
      scene: null,
      grid: null,
      stage: createEmitter()
    },
    DialogV2: dialog.DialogV2,
    notifications: { error: (message) => errors.push(message) }
  }), /canvas/u);

  assert.equal(dialog.options, null);
  assert.deepEqual(errors, ["Для создания объекта нужен открытый canvas активной сцены."]);
});

test("runMapObjectTokenMacro chains the prompt, placement, service, and success notification", async () => {
  const environment = createPlacementEnvironment();
  const dialog = createDialogV2((options) => options.buttons[0].callback(null, {
    form: createForm({ name: "Gate", hp: "30", ac: "18", damageThreshold: "10", size: "2" })
  }));
  const calls = [];
  const messages = [];
  const token = { id: "token-1" };
  const runner = runMapObjectTokenMacro({
    service: {
      async createToken(input, options) {
        calls.push({ input, options });
        return token;
      }
    },
    game: { user: { isGM: true }, scenes: { active: { id: "scene-1" } } },
    canvas: environment.canvas,
    DialogV2: dialog.DialogV2,
    documentTarget: environment.documentTarget,
    notifications: { info: (message) => messages.push(message), error() {} }
  });
  await waitForStageListener(environment.stage);
  environment.stage.emit("mousedown", {
    button: 0,
    data: { getLocalPosition: () => ({ x: 218, y: 396 }) }
  });

  assert.strictEqual(await runner, token);
  assert.deepEqual(calls, [{
    input: { name: "Gate", hp: 30, ac: 18, damageThreshold: 10, size: 2 },
    options: {
      scene: { id: "scene-1" },
      point: { x: 200, y: 400 },
      gridSize: 100
    }
  }]);
  assert.deepEqual(messages, ["Объект создан."]);
  assertPlacementListenersRemoved(environment);
});

test("runMapObjectTokenMacro reports exactly one cancellation for an explicitly cancelled form", async () => {
  const environment = createPlacementEnvironment();
  const dialog = createDialogV2(() => null);
  const info = [];
  const errors = [];

  const result = await runMapObjectTokenMacro({
    service: { async createToken() { throw new Error("service should not run"); } },
    game: { user: { isGM: true }, scenes: { active: { id: "scene-1" } } },
    canvas: environment.canvas,
    DialogV2: dialog.DialogV2,
    documentTarget: environment.documentTarget,
    notifications: {
      info: (message) => info.push(message),
      error: (message) => errors.push(message)
    }
  });

  assert.equal(result, null);
  assert.deepEqual(info, ["Создание объекта отменено."]);
  assert.deepEqual(errors, []);
  assert.equal(environment.stage.registrationCount("mousedown"), 0);
  assertPlacementListenersRemoved(environment);
});

test("runMapObjectTokenMacro reports exactly one error and never starts placement for invalid input", async () => {
  const environment = createPlacementEnvironment();
  const dialog = createDialogV2((options) => options.buttons[0].callback(null, {
    form: createForm({ name: "Broken", hp: "0", ac: "10", damageThreshold: "0", size: "1" })
  }));
  const info = [];
  const errors = [];
  const runner = runMapObjectTokenMacro({
    service: { async createToken() { throw new Error("service should not run"); } },
    game: { user: { isGM: true }, scenes: { active: { id: "scene-1" } } },
    canvas: environment.canvas,
    DialogV2: dialog.DialogV2,
    documentTarget: environment.documentTarget,
    notifications: {
      info: (message) => info.push(message),
      error: (message) => errors.push(message)
    }
  });

  for (let attempt = 0; attempt < 10 && errors.length === 0; attempt += 1) {
    await Promise.resolve();
  }
  await Promise.resolve();
  if (environment.stage.listenerCount() > 0) {
    environment.documentTarget.emit("keydown", { key: "Escape" });
  }

  assert.equal(await runner, undefined);
  assert.deepEqual(errors, ["Некорректные параметры объекта."]);
  assert.deepEqual(info, []);
  assert.equal(environment.stage.registrationCount("mousedown"), 0);
  assertPlacementListenersRemoved(environment);
});

test("runMapObjectTokenMacro reports and rethrows service errors", async () => {
  const environment = createPlacementEnvironment();
  const dialog = createDialogV2((options) => options.buttons[0].callback(null, {
    form: createForm({ name: "Gate", hp: "30", ac: "18", damageThreshold: "10", size: "2" })
  }));
  const errors = [];
  const runner = runMapObjectTokenMacro({
    service: { async createToken() { throw new Error("creation failed"); } },
    game: { user: { isGM: true }, scenes: { active: { id: "scene-1" } } },
    canvas: environment.canvas,
    DialogV2: dialog.DialogV2,
    documentTarget: environment.documentTarget,
    notifications: { info() {}, error: (message) => errors.push(message) }
  });
  await waitForStageListener(environment.stage);
  environment.stage.emit("mousedown", {
    button: 0,
    data: { getLocalPosition: () => ({ x: 218, y: 396 }) }
  });

  await assert.rejects(runner, /creation failed/u);
  assert.deepEqual(errors, ["Не удалось создать объект: creation failed"]);
  assertPlacementListenersRemoved(environment);
});
