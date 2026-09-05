import test from "node:test";
import assert from "node:assert/strict";

import { MODULE_ID } from "../scripts/constants.js";
import { StorageGroundPileService } from "../scripts/data/storage-ground-pile-service.js";
import { readStorageState } from "../scripts/data/storage-service.js";

function applyPatch(target, patch) {
  for (const [path, value] of Object.entries(patch)) {
    const parts = path.split(".");
    let cursor = target;
    for (const part of parts.slice(0, -1)) cursor = (cursor[part] ??= {});
    cursor[parts.at(-1)] = structuredClone(value);
  }
}

function deferred() {
  let resolve;
  const promise = new Promise((next) => { resolve = next; });
  return { promise, resolve };
}

function createHarness({ activeGm = true, beforeCreate, beforeUpdate, afterDelete, idFactory } = {}) {
  const pileActor = {
    id: "pile-actor",
    flags: {
      [MODULE_ID]: {
        builtinStoragePreset: { id: "ground-pile" },
        storage: { enabled: true }
      }
    },
    getFlag(scope, key) { return this.flags?.[scope]?.[key]; },
    prototypeToken: {
      name: "Куча предметов",
      width: 1,
      height: 1,
      texture: { src: "mixed.png" },
      sight: { enabled: true, range: 60 }
    }
  };
  const tokens = [];
  const scene = {
    id: "scene",
    grid: { size: 100, distance: 5 },
    tokens: { contents: tokens },
    async createEmbeddedDocuments(type, rows) {
      assert.equal(type, "Token");
      await beforeCreate?.();
      return rows.map((data, index) => {
        const token = {
          ...structuredClone(data),
          id: `pile-${tokens.length + index + 1}`,
          uuid: `Scene.scene.Token.pile-${tokens.length + index + 1}`,
          parent: scene,
          actor: pileActor,
          getFlag(scope, key) { return this.flags?.[scope]?.[key]; },
          async update(patch) { await beforeUpdate?.(); applyPatch(this, patch); return this; },
          async delete() {
            tokens.splice(tokens.indexOf(this), 1);
            this.deleted = true;
            await afterDelete?.(this);
          }
        };
        tokens.push(token);
        return token;
      });
    }
  };
  const game = {
    actors: { contents: [pileActor] },
    scenes: { get: (id) => id === scene.id ? scene : null, contents: [scene] },
    user: { id: "gm", isGM: true }
  };
  let nextId = 0;
  const service = new StorageGroundPileService({
    gameProvider: () => game,
    isActiveGm: () => activeGm,
    idFactory: idFactory ?? (() => `pile-row-${++nextId}`)
  });
  return { service, scene, tokens, pileActor, game };
}

const sword = {
  rowId: "source-sword",
  sourceType: "gear",
  sourceId: "sword",
  name: "Меч",
  img: "icons/sword.webp",
  typeLabel: "Оружие",
  quantity: 5,
  itemData: { name: "Меч", system: { quantity: 5 } }
};

const axe = {
  ...structuredClone(sword),
  rowId: "source-axe",
  sourceId: "axe",
  name: "Топор",
  img: "icons/axe.webp",
  quantity: 1,
  itemData: { name: "Топор", system: { quantity: 1 } }
};

const treasure = {
  ...structuredClone(sword),
  rowId: "source-ruby",
  sourceId: "ruby",
  name: "Рубин",
  img: "icons/ruby.webp",
  typeLabel: "Сокровища",
  quantity: 1,
  itemData: { name: "Рубин", system: { quantity: 1 } }
};

function managedCanonicalRow({ sourceType, sourceId, name, typeLabel }) {
  const identityField = sourceType === "gear" ? "gearId" : "materialId";
  const moduleFlags = {
    managed: true,
    [identityField]: sourceId,
    ...(sourceType === "gear" ? { sourceType: "gear" } : {})
  };
  return {
    rowId: `source-${sourceId}`,
    sourceType: sourceType === "gear" ? "weapon" : "loot",
    sourceId: `Compendium.world.rebreya-${sourceType}.Item.${sourceId}-document`,
    name,
    img: `icons/${sourceId}-item-icon.webp`,
    typeLabel,
    quantity: 1,
    itemData: {
      name,
      img: `icons/${sourceId}-item-icon.webp`,
      system: { quantity: 1 },
      flags: {
        [MODULE_ID]: moduleFlags
      }
    }
  };
}

const rapier = managedCanonicalRow({
  sourceType: "gear",
  sourceId: "rapira",
  name: "Рапира",
  typeLabel: "Оружие"
});

const longsword = managedCanonicalRow({
  sourceType: "gear",
  sourceId: "dlinnyy-mech",
  name: "Длинный меч",
  typeLabel: "Оружие"
});

const halberd = managedCanonicalRow({
  sourceType: "gear",
  sourceId: "alebarda",
  name: "Алебарда",
  typeLabel: "Оружие"
});

const revolver = managedCanonicalRow({
  sourceType: "gear",
  sourceId: "revol-ver",
  name: "Револьвер",
  typeLabel: "Огнестрельное оружие"
});

const monsterHoof = managedCanonicalRow({
  sourceType: "material",
  sourceId: "material-10",
  name: "Копыто чудовища",
  typeLabel: "Материал"
});

const plateArmor = managedCanonicalRow({
  sourceType: "gear",
  sourceId: "laty",
  name: "Латы",
  typeLabel: "Доспех"
});

const bigTable = managedCanonicalRow({
  sourceType: "gear",
  sourceId: "stol-bolshoy",
  name: "Стол, большой",
  typeLabel: "Снаряжение"
});

const chair = managedCanonicalRow({
  sourceType: "gear",
  sourceId: "stul",
  name: "Стул",
  typeLabel: "Снаряжение"
});

const bed = managedCanonicalRow({
  sourceType: "gear",
  sourceId: "krovat",
  name: "Кровать",
  typeLabel: "Снаряжение"
});

const journalNote = {
  rowKind: "journal",
  rowId: "source-note",
  stackKey: "",
  sourceId: "JournalEntry.gartar",
  sourceType: "journal",
  name: "Заметки Гартара",
  img: "icons/book.webp",
  quantity: 1
};

const platinumCoinItemRow = {
  rowId: "legacy-platinum-coin",
  sourceType: "gear",
  sourceId: "Compendium.world.rebreya-gear.Item.platinum",
  name: "Платиновая монета",
  img: "icons/commodities/currency/coins-assorted-mix-platinum.webp",
  typeLabel: "Сокровища",
  quantity: 1,
  itemData: {
    name: "Платиновая монета",
    type: "loot",
    img: "icons/commodities/currency/coins-assorted-mix-platinum.webp",
    system: { quantity: 1, type: { value: "treasure" } },
    flags: {
      [MODULE_ID]: {
        sourceType: "gear",
        storageCoinTemplate: { version: 1, denomination: "pp" }
      }
    }
  }
};

test("canvas transfer creates an unlinked independent ground pile token", async () => {
  const { service, tokens } = createHarness();
  const result = await service.transferToScene({
    row: sword,
    quantity: 2,
    sceneId: "scene",
    x: 300,
    y: 400,
    mutationId: "create-1"
  });

  assert.equal(result.created, true);
  assert.equal(tokens.length, 1);
  assert.equal(tokens[0].actorLink, false);
  assert.equal(tokens[0].disposition, 0);
  assert.deepEqual(tokens[0].sight, { enabled: false, range: 60 });
  assert.equal(tokens[0].width, 0.5);
  assert.equal(tokens[0].height, 0.5);
  assert.equal(tokens[0].x, 275);
  assert.equal(tokens[0].y, 375);
  assert.equal(tokens[0].name, "Меч (2)");
  assert.equal(tokens[0].texture.src, "icons/sword.webp");
  assert.equal(tokens[0].flags[MODULE_ID].groundPile.enabled, true);
  assert.equal(tokens[0].flags[MODULE_ID].groundPile.coinPile, false);
  assert.equal(readStorageState(tokens[0]).manualRows[0].quantity, 2);
  assert.equal(readStorageState(tokens[0]).state, "opened");
});

test("managed gear and material drops create tokens with canonical top-down textures", async () => {
  for (const [row, expectedTexture] of [
    [rapier, `modules/${MODULE_ID}/assets/top-down/items/gear/rapira.webp`],
    [monsterHoof, `modules/${MODULE_ID}/assets/top-down/items/material/material-10.webp`]
  ]) {
    const { service, tokens } = createHarness();
    await service.transferToScene({
      row,
      quantity: 1,
      sceneId: "scene",
      x: 300,
      y: 400,
      mutationId: `create-${row.itemData.flags[MODULE_ID].gearId ?? row.itemData.flags[MODULE_ID].materialId}`
    });

    assert.equal(tokens[0].texture.src, expectedTexture);
    assert.equal(Number.isInteger(tokens[0].rotation), true);
    assert.equal(tokens[0].rotation >= 0 && tokens[0].rotation < 360, true);
    assert.equal(tokens[0].flags[MODULE_ID].groundPile.enabled, true);
    assert.equal(readStorageState(tokens[0]).manualRows[0].itemData.img, row.itemData.img);
  }
});

test("curated long items use 1.5 texture scale and a stable per-spawn angle", async () => {
  const first = createHarness({ idFactory: () => "stable-long-row" });
  const second = createHarness({ idFactory: () => "stable-long-row" });
  const different = createHarness({ idFactory: () => "different-long-row" });
  const request = {
    row: halberd,
    quantity: 1,
    sceneId: "scene",
    x: 300,
    y: 400,
    mutationId: "long-item-create"
  };

  await first.service.transferToScene(request);
  await second.service.transferToScene(request);
  await different.service.transferToScene(request);

  assert.equal(first.tokens[0].width, 0.5);
  assert.equal(first.tokens[0].height, 0.5);
  assert.equal(first.tokens[0].texture.scaleX, 1.5);
  assert.equal(first.tokens[0].texture.scaleY, 1.5);
  assert.equal(first.tokens[0].rotation, second.tokens[0].rotation);
  assert.notEqual(first.tokens[0].rotation, different.tokens[0].rotation);

  const rotationBeforeRetry = first.tokens[0].rotation;
  const duplicate = await first.service.transferToScene(request);
  assert.equal(duplicate.duplicate, true);
  assert.equal(first.tokens[0].rotation, rotationBeforeRetry);
});

test("compact firearms keep standard texture scale", async () => {
  const { service, tokens } = createHarness();
  await service.transferToScene({
    row: revolver,
    quantity: 1,
    sceneId: "scene",
    x: 300,
    y: 400,
    mutationId: "revolver-create"
  });

  assert.equal(tokens[0].width, 0.5);
  assert.equal(tokens[0].height, 0.5);
  assert.equal(tokens[0].texture.scaleX, 1);
  assert.equal(tokens[0].texture.scaleY, 1);
});

test("managed armor occupies one full grid cell", async () => {
  const { service, tokens } = createHarness();
  await service.transferToScene({
    row: plateArmor,
    quantity: 1,
    sceneId: "scene",
    x: 300,
    y: 400,
    mutationId: "plate-create"
  });

  assert.equal(tokens[0].width, 1);
  assert.equal(tokens[0].height, 1);
  assert.equal(tokens[0].x, 250);
  assert.equal(tokens[0].y, 350);
  assert.equal(tokens[0].texture.scaleX, 1.5);
  assert.equal(tokens[0].texture.scaleY, 1.5);
});

test("managed furniture uses curated footprints and stable cardinal rotations", async () => {
  const first = createHarness({ idFactory: () => "stable-furniture-row" });
  const second = createHarness({ idFactory: () => "stable-furniture-row" });
  const request = {
    row: bigTable,
    quantity: 1,
    sceneId: "scene",
    x: 300,
    y: 400,
    mutationId: "big-table-create"
  };

  await first.service.transferToScene(request);
  await second.service.transferToScene(request);

  const quarterTurn = first.tokens[0].rotation === 90 || first.tokens[0].rotation === 270;
  assert.equal(first.tokens[0].width, quarterTurn ? 2 : 3);
  assert.equal(first.tokens[0].height, quarterTurn ? 3 : 2);
  assert.equal(first.tokens[0].x, quarterTurn ? 200 : 150);
  assert.equal(first.tokens[0].y, quarterTurn ? 250 : 300);
  assert.equal(first.tokens[0].texture.scaleX, quarterTurn ? 1.5 : 1);
  assert.equal(first.tokens[0].texture.scaleY, quarterTurn ? 1.5 : 1);
  assert.equal(first.tokens[0].texture.fit, "contain");
  assert.ok([0, 90, 180, 270].includes(first.tokens[0].rotation));
  assert.equal(first.tokens[0].rotation, second.tokens[0].rotation);

  const rotationBeforeRetry = first.tokens[0].rotation;
  const duplicate = await first.service.transferToScene(request);
  assert.equal(duplicate.duplicate, true);
  assert.equal(first.tokens[0].rotation, rotationBeforeRetry);

  const bedHarness = createHarness();
  await bedHarness.service.transferToScene({
    ...request,
    row: bed,
    mutationId: "bed-create"
  });
  const bedQuarterTurn = bedHarness.tokens[0].rotation === 90 || bedHarness.tokens[0].rotation === 270;
  assert.equal(bedHarness.tokens[0].width, bedQuarterTurn ? 2 : 1);
  assert.equal(bedHarness.tokens[0].height, bedQuarterTurn ? 1 : 2);
  assert.equal(bedHarness.tokens[0].x, bedQuarterTurn ? 200 : 250);
  assert.equal(bedHarness.tokens[0].y, bedQuarterTurn ? 350 : 300);
  assert.equal(bedHarness.tokens[0].texture.scaleX, bedQuarterTurn ? 2 : 1);
  assert.equal(bedHarness.tokens[0].texture.scaleY, bedQuarterTurn ? 2 : 1);
});

test("explicit furniture orientation swaps footprint around the drop center and compensates texture scale", async () => {
  for (const rotation of [0, 90, 180, 270]) {
    const { service, tokens } = createHarness();
    await service.transferToScene({
      row: bed,
      quantity: 1,
      sceneId: "scene",
      x: 300,
      y: 400,
      mutationId: `bed-${rotation}`,
      rotation
    });
    const quarterTurn = rotation === 90 || rotation === 270;
    assert.equal(tokens[0].rotation, rotation);
    assert.equal(tokens[0].width, quarterTurn ? 2 : 1);
    assert.equal(tokens[0].height, quarterTurn ? 1 : 2);
    assert.equal(tokens[0].x, quarterTurn ? 200 : 250);
    assert.equal(tokens[0].y, quarterTurn ? 350 : 300);
    assert.equal(tokens[0].texture.scaleX, quarterTurn ? 2 : 1);
    assert.equal(tokens[0].texture.scaleY, quarterTurn ? 2 : 1);
  }

  const tableHarness = createHarness();
  await tableHarness.service.transferToScene({
    row: bigTable,
    quantity: 1,
    sceneId: "scene",
    x: 300,
    y: 400,
    mutationId: "table-90",
    rotation: 90
  });
  assert.equal(tableHarness.tokens[0].rotation, 90);
  assert.equal(tableHarness.tokens[0].width, 2);
  assert.equal(tableHarness.tokens[0].height, 3);
  assert.equal(tableHarness.tokens[0].x, 200);
  assert.equal(tableHarness.tokens[0].y, 250);
  assert.equal(tableHarness.tokens[0].texture.scaleX, 1.5);
  assert.equal(tableHarness.tokens[0].texture.scaleY, 1.5);
});

test("ground-pile owner rejects invalid orientation and ignores explicit orientation outside rectangular furniture", async () => {
  const invalid = createHarness();
  await assert.rejects(() => invalid.service.transferToScene({
    row: bed,
    quantity: 1,
    sceneId: "scene",
    x: 300,
    y: 400,
    mutationId: "bed-invalid",
    rotation: 45
  }), /0, 90, 180, or 270/);
  assert.equal(invalid.tokens.length, 0);

  for (const row of [chair, rapier]) {
    const explicit = createHarness({ idFactory: () => "stable-ignored-orientation" });
    const omitted = createHarness({ idFactory: () => "stable-ignored-orientation" });
    const request = {
      row,
      quantity: 1,
      sceneId: "scene",
      x: 300,
      y: 400,
      mutationId: `ignored-${row.name}`
    };
    await explicit.service.transferToScene({ ...request, rotation: 90 });
    await omitted.service.transferToScene(request);
    assert.equal(explicit.tokens[0].rotation, omitted.tokens[0].rotation);
    assert.equal(explicit.tokens[0].width, omitted.tokens[0].width);
    assert.equal(explicit.tokens[0].height, omitted.tokens[0].height);
    assert.equal(explicit.tokens[0].texture.scaleX, omitted.tokens[0].texture.scaleX);
  }
});

test("furniture merge preserves the existing final orientation until presentation changes", async () => {
  const { service, tokens } = createHarness();
  const request = {
    row: bed,
    quantity: 1,
    sceneId: "scene",
    x: 300,
    y: 400,
    mutationId: "bed-create-90",
    rotation: 90
  };
  await service.transferToScene(request);
  await service.transferToScene({
    ...request,
    mutationId: "bed-merge-ignored-rotation",
    rotation: 0
  });
  assert.equal(tokens[0].rotation, 90);
  assert.equal(tokens[0].width, 2);
  assert.equal(tokens[0].height, 1);
  assert.equal(tokens[0].x, 200);
  assert.equal(tokens[0].y, 350);
  assert.equal(tokens[0].texture.scaleX, 2);

  const duplicate = await service.transferToScene({
    ...request,
    mutationId: "bed-merge-ignored-rotation",
    rotation: 270
  });
  assert.equal(duplicate.duplicate, true);
  assert.equal(tokens[0].rotation, 90);

  await service.transferToScene({
    ...request,
    row: chair,
    mutationId: "chair-merge",
    rotation: 270
  });
  assert.equal(tokens[0].rotation, 0);
  assert.equal(tokens[0].width, 1);
  assert.equal(tokens[0].height, 1);
  assert.equal(tokens[0].x, 250);
  assert.equal(tokens[0].y, 350);
  assert.equal(tokens[0].texture.scaleX, 1);
});

test("furniture merge resets pile layout and restores the surviving footprint around its center", async () => {
  const { service, tokens } = createHarness();
  await service.transferToScene({
    row: bigTable,
    quantity: 1,
    sceneId: "scene",
    x: 300,
    y: 400,
    mutationId: "table-create"
  });
  await service.transferToScene({
    row: chair,
    quantity: 1,
    sceneId: "scene",
    x: 300,
    y: 400,
    mutationId: "chair-merge"
  });

  assert.equal(tokens[0].width, 1);
  assert.equal(tokens[0].height, 1);
  assert.equal(tokens[0].x, 250);
  assert.equal(tokens[0].y, 350);
  assert.equal(tokens[0].rotation, 0);

  const state = readStorageState(tokens[0]);
  const chairRow = state.manualRows.find((row) => row.itemData?.flags?.[MODULE_ID]?.gearId === "stul");
  await service.refreshAfterStorageMutation(tokens[0], {
    ...state,
    claimedRowIds: [chairRow.rowId]
  });

  const quarterTurn = tokens[0].rotation === 90 || tokens[0].rotation === 270;
  assert.equal(tokens[0].width, quarterTurn ? 2 : 3);
  assert.equal(tokens[0].height, quarterTurn ? 3 : 2);
  assert.equal(tokens[0].x, quarterTurn ? 200 : 150);
  assert.equal(tokens[0].y, quarterTurn ? 250 : 300);
  assert.equal(tokens[0].texture.scaleX, quarterTurn ? 1.5 : 1);
  assert.ok([0, 90, 180, 270].includes(tokens[0].rotation));
});

test("managed merge uses the existing pile texture then restores the survivor top-down texture", async () => {
  const { service, tokens } = createHarness();
  const request = {
    row: rapier,
    quantity: 1,
    sceneId: "scene",
    x: 300,
    y: 400,
    mutationId: "managed-rapier"
  };

  await service.transferToScene(request);
  const duplicate = await service.transferToScene(request);
  assert.equal(duplicate.duplicate, true);
  assert.equal(readStorageState(tokens[0]).manualRows.length, 1);

  await service.transferToScene({
    ...request,
    row: longsword,
    mutationId: "managed-longsword"
  });
  assert.equal(tokens[0].texture.src, `modules/${MODULE_ID}/assets/storage/piles/weapons.png`);
  assert.equal(tokens[0].width, 1);
  assert.equal(tokens[0].height, 1);
  assert.equal(tokens[0].rotation, 0);
  assert.equal(tokens[0].texture.scaleX, 1);
  assert.equal(tokens[0].texture.scaleY, 1);

  const state = readStorageState(tokens[0]);
  const rapierRow = state.manualRows.find((row) => row.itemData?.flags?.[MODULE_ID]?.gearId === "rapira");
  const refreshed = await service.refreshAfterStorageMutation(tokens[0], {
    ...state,
    claimedRowIds: [rapierRow.rowId]
  });

  assert.equal(refreshed.deleted, false);
  assert.equal(tokens[0].name, "Длинный меч");
  assert.equal(
    tokens[0].texture.src,
    `modules/${MODULE_ID}/assets/top-down/items/gear/dlinnyy-mech.webp`
  );
  assert.equal(tokens[0].width, 0.5);
  assert.equal(tokens[0].height, 0.5);
  assert.equal(tokens[0].texture.scaleX, 1.5);
  assert.equal(tokens[0].texture.scaleY, 1.5);
  assert.notEqual(tokens[0].rotation, 0);
});

test("ground pile refresh repairs hostile disposition and enabled sight", async () => {
  const { service, tokens } = createHarness();
  await service.transferToScene({
    row: sword,
    quantity: 1,
    sceneId: "scene",
    x: 300,
    y: 400,
    mutationId: "repair-presentation"
  });
  const token = tokens[0];
  token.disposition = -1;
  token.sight.enabled = true;

  await service.refreshAfterStorageMutation(token, readStorageState(token));

  assert.equal(token.disposition, 0);
  assert.equal(token.sight.enabled, false);
  assert.equal(token.sight.range, 60);
});

test("a player who drops an item owns the created synthetic pile actor", async () => {
  const { service, tokens } = createHarness();
  await service.transferToScene({
    row: sword,
    quantity: 1,
    sceneId: "scene",
    x: 300,
    y: 400,
    mutationId: "player-drop",
    ownerUserId: "player-1"
  });

  assert.equal(tokens[0].delta.ownership["player-1"], 3);
});

test("dropping on a pile stacks identical items and appends different items", async () => {
  const { service, tokens } = createHarness();
  await service.transferToScene({ row: sword, quantity: 2, sceneId: "scene", x: 300, y: 400, mutationId: "one" });
  await service.transferToScene({ row: sword, quantity: 3, sceneId: "scene", x: 320, y: 420, mutationId: "two" });

  assert.equal(tokens.length, 1);
  assert.equal(readStorageState(tokens[0]).manualRows.length, 1);
  assert.equal(readStorageState(tokens[0]).manualRows[0].quantity, 5);
  assert.equal(tokens[0].name, "Меч (5)");

  await service.transferToScene({
    row: { ...sword, sourceId: "axe", name: "Топор", img: "icons/axe.webp" },
    quantity: 1,
    sceneId: "scene",
    x: 320,
    y: 420,
    mutationId: "three"
  });
  assert.equal(readStorageState(tokens[0]).manualRows.length, 2);
  assert.equal(tokens[0].name, "Куча оружия");
  assert.match(tokens[0].texture.src, /weapons\.png$/u);
});

test("Journal scene rows remain reference-only, quantity one, and never stack", async () => {
  const { service, tokens } = createHarness();
  await service.transferToScene({
    row: journalNote,
    quantity: 1,
    sceneId: "scene",
    x: 300,
    y: 400,
    mutationId: "journal-first"
  });

  assert.equal(tokens[0].name, "Заметки Гартара");
  assert.equal(tokens[0].texture.src.endsWith("/journal-note.png"), true);
  assert.equal(readStorageState(tokens[0]).manualRows[0].itemData, undefined);

  await service.transferToScene({
    row: {
      ...journalNote,
      rowId: "source-second",
      sourceId: "JournalEntry.second",
      name: "Вторая"
    },
    quantity: 1,
    sceneId: "scene",
    x: 300,
    y: 400,
    mutationId: "journal-second"
  });

  const state = readStorageState(tokens[0]);
  assert.equal(state.manualRows.length, 2);
  assert.deepEqual(state.manualRows.map((row) => row.quantity), [1, 1]);
  assert.equal(state.manualRows.every((row) => row.itemData === undefined), true);
  assert.equal(tokens[0].name, "Куча заметок");
  assert.equal(tokens[0].texture.src.endsWith("/journal-notes.png"), true);
});

test("ground presentation reveals the surviving Journal and its shared read marker", async () => {
  const { service, tokens } = createHarness();
  await service.transferToScene({
    row: sword,
    quantity: 1,
    sceneId: "scene",
    x: 300,
    y: 400,
    mutationId: "item-first"
  });
  await service.transferToScene({
    row: journalNote,
    quantity: 1,
    sceneId: "scene",
    x: 300,
    y: 400,
    mutationId: "journal-second"
  });

  const token = tokens[0];
  assert.equal(token.name, "Меч");
  let state = readStorageState(token);
  const itemRow = state.manualRows.find((row) => row.sourceType !== "journal");
  const journalRow = state.manualRows.find((row) => row.sourceType === "journal");
  const afterClaim = await service.refreshAfterStorageMutation(token, {
    ...state,
    claimedRowIds: [itemRow.rowId]
  });

  assert.equal(afterClaim.deleted, false);
  assert.equal(token.name, "Заметки Гартара");
  assert.equal(token.texture.src.endsWith("/journal-note.png"), true);

  state = readStorageState(token);
  const afterRead = await service.refreshAfterStorageMutation(token, {
    ...state,
    readJournalRowIds: [journalRow.rowId]
  });
  assert.equal(afterRead.deleted, false);
  assert.equal(token.name, "Заметки Гартара (прочитано)");
  assert.equal(tokens.length, 1);
});

test("nearby drops outside pile bounds create another token and duplicate mutations do nothing", async () => {
  const { service, tokens } = createHarness();
  await service.transferToScene({ row: sword, quantity: 1, sceneId: "scene", x: 300, y: 400, mutationId: "one" });
  await service.transferToScene({ row: sword, quantity: 1, sceneId: "scene", x: 340, y: 400, mutationId: "two" });
  assert.equal(tokens.length, 2);

  const duplicate = await service.transferToScene({
    row: sword,
    quantity: 1,
    sceneId: "scene",
    x: 310,
    y: 410,
    mutationId: "one"
  });
  assert.equal(duplicate.duplicate, true);
  assert.equal(readStorageState(tokens[0]).manualRows[0].quantity, 1);
});

test("claiming the last ordinary ground-pile row successfully deletes its token", async () => {
  const { service, tokens } = createHarness();
  await service.transferToScene({ row: sword, quantity: 2, sceneId: "scene", x: 300, y: 400, mutationId: "one" });
  const token = tokens[0];
  const state = readStorageState(token);
  state.manualRows[0].quantity = 1;
  state.manualRows[0].itemData.system.quantity = 1;
  await service.refreshAfterStorageMutation(token, state);
  assert.equal(token.name, "Меч");

  const result = await service.refreshAfterStorageMutation(token, {
    ...state,
    state: "empty",
    claimedRowIds: [state.manualRows[0].rowId]
  });
  assert.equal(result.deleted, true);
  assert.equal(token.deleted, true);
  assert.equal(tokens.length, 0);
});

test("final ordinary pile deletion treats a lost post-delete acknowledgement as success", async () => {
  const { service, tokens } = createHarness({
    afterDelete() {
      throw new Error("delete acknowledgement lost");
    }
  });
  await service.transferToScene({ row: sword, quantity: 1, sceneId: "scene", x: 300, y: 400, mutationId: "one" });
  const token = tokens[0];
  const state = readStorageState(token);

  const result = await service.refreshAfterStorageMutation(token, {
    ...state,
    state: "empty",
    claimedRowIds: [state.manualRows[0].rowId]
  });

  assert.equal(result.deleted, true);
  assert.equal(token.deleted, true);
  assert.equal(tokens.length, 0);
});

test("coin transfer creates and merges a pure manual-coin pile idempotently", async () => {
  const { service, tokens } = createHarness();
  const request = {
    coins: { gp: 5 },
    sceneId: "scene",
    x: 300,
    y: 400,
    mutationId: "coin-drop-one"
  };

  const created = await service.transferCoinsToScene(request);
  assert.equal(created.created, true);
  assert.equal(tokens.length, 1);
  assert.equal(tokens[0].name, "Золотая монета");
  assert.equal(tokens[0].texture.src, `modules/${MODULE_ID}/assets/top-down/items/coins/gp-05.webp`);
  assert.equal(tokens[0].flags[MODULE_ID].groundPile.coinPile, true);
  assert.equal(readStorageState(tokens[0]).manualRows.length, 0);
  assert.deepEqual(readStorageState(tokens[0]).manualCoins, { pp: 0, gp: 5, sp: 0, cp: 0 });
  assert.deepEqual(readStorageState(tokens[0]).generatedCoins, { pp: 0, gp: 0, sp: 0, cp: 0 });

  const processed = service.findProcessedMutationAtPoint(request);
  assert.equal(processed.duplicate, true);
  assert.equal(processed.token, tokens[0]);
  assert.equal(service.findProcessedMutationAtPoint({ ...request, sceneId: "other" }), null);
  assert.equal(service.findProcessedMutationAtPoint({ ...request, x: 900, y: 900 }), null);
  assert.equal(service.findProcessedMutationAtPoint({ ...request, mutationId: "not-processed" }), null);

  const duplicate = await service.transferCoinsToScene(request);
  assert.equal(duplicate.duplicate, true);
  assert.equal(readStorageState(tokens[0]).manualCoins.gp, 5);

  const merged = await service.transferCoinsToScene({
    ...request,
    coins: { sp: 3 },
    mutationId: "coin-drop-two"
  });
  assert.equal(merged.merged, true);
  assert.equal(tokens.length, 1);
  assert.equal(tokens[0].name, "Куча монет");
  assert.equal(tokens[0].texture.src, `modules/${MODULE_ID}/assets/storage/piles/coins.png`);
  assert.deepEqual(readStorageState(tokens[0]).manualCoins, { pp: 0, gp: 5, sp: 3, cp: 0 });
});

test("coin balance transitions swap sprites on the same centered owned token for every denomination", async () => {
  for (const denomination of ["pp", "gp", "sp", "cp"]) {
    const { service, tokens } = createHarness();
    await service.transferCoinsToScene({
      coins: { [denomination]: 3 },
      sceneId: "scene",
      x: 300,
      y: 400,
      mutationId: `coin-transition-${denomination}`,
      ownerUserId: "player-1"
    });
    const token = tokens[0];
    const uuid = token.uuid;
    const ownership = structuredClone(token.delta.ownership);
    const center = () => ({
      x: token.x + token.width * token.parent.grid.size / 2,
      y: token.y + token.height * token.parent.grid.size / 2
    });
    const sprite = (amount) => amount > 50
      ? `modules/${MODULE_ID}/assets/top-down/items/coins/${denomination}-pile.webp`
      : `modules/${MODULE_ID}/assets/top-down/items/coins/${denomination}-${String(amount).padStart(2, "0")}.webp`;
    const setCount = async (amount) => {
      const state = readStorageState(token);
      state.manualCoins = { pp: 0, gp: 0, sp: 0, cp: 0, [denomination]: amount };
      state.generatedCoins = { pp: 0, gp: 0, sp: 0, cp: 0 };
      state.coinsClaimed = false;
      return service.refreshAfterStorageMutation(token, state);
    };

    assert.equal(token.texture.src, sprite(3));
    await setCount(2); // 3 -> 2
    assert.equal(token.texture.src, sprite(2));
    await setCount(10);
    await setCount(11); // 10 -> 11
    assert.equal(token.texture.src, sprite(11));
    await setCount(50);
    await setCount(51); // 50 -> 51
    assert.equal(token.texture.src, sprite(51));
    await setCount(50); // 51 -> 50
    assert.equal(token.texture.src, sprite(50));
    await setCount(50); // idempotent presentation refresh
    assert.equal(token.texture.src, sprite(50));
    await setCount(1);
    await setCount(0); // 1 -> 0
    assert.equal(token.texture.src, `modules/${MODULE_ID}/assets/storage/piles/coins.png`);
    assert.equal(readStorageState(token).manualCoins[denomination], 0);
    assert.equal(tokens.length, 1);
    assert.equal(token.uuid, uuid);
    assert.deepEqual(center(), { x: 300, y: 400 });
    assert.deepEqual(token.delta.ownership, ownership);
  }
});

test("rejected coin sprite refresh rolls back balance and presentation for every denomination", async () => {
  for (const denomination of ["pp", "gp", "sp", "cp"]) {
    let rejectUpdate = false;
    const { service, tokens } = createHarness({
      beforeUpdate() {
        if (rejectUpdate) throw new Error("simulated token update rejection");
      }
    });
    await service.transferCoinsToScene({
      coins: { [denomination]: 3 },
      sceneId: "scene",
      x: 300,
      y: 400,
      mutationId: `coin-rollback-${denomination}`
    });
    const token = tokens[0];
    const before = structuredClone({
      name: token.name,
      texture: token.texture,
      flags: token.flags,
      x: token.x,
      y: token.y,
      width: token.width,
      height: token.height,
      uuid: token.uuid
    });
    const rejectedState = readStorageState(token);
    rejectedState.manualCoins[denomination] = 2;
    rejectUpdate = true;

    await assert.rejects(
      service.refreshAfterStorageMutation(token, rejectedState),
      /simulated token update rejection/u
    );
    assert.deepEqual({
      name: token.name,
      texture: token.texture,
      flags: token.flags,
      x: token.x,
      y: token.y,
      width: token.width,
      height: token.height,
      uuid: token.uuid
    }, before);
    assert.equal(readStorageState(token).manualCoins[denomination], 3);
  }
});

test("coin merge rejects unsafe cumulative balances for every denomination without changing the pile", async () => {
  for (const denomination of ["pp", "gp", "sp", "cp"]) {
    const { service, tokens } = createHarness();
    await service.transferCoinsToScene({
      coins: { [denomination]: Number.MAX_SAFE_INTEGER },
      sceneId: "scene",
      x: 300,
      y: 400,
      mutationId: `coin-safe-limit-${denomination}`
    });
    const before = structuredClone({
      name: tokens[0].name,
      texture: tokens[0].texture,
      flags: tokens[0].flags,
      delta: tokens[0].delta
    });

    await assert.rejects(service.transferCoinsToScene({
      coins: { [denomination]: 1 },
      sceneId: "scene",
      x: 300,
      y: 400,
      mutationId: `coin-overflow-${denomination}`
    }), /безопасным целым/u);

    assert.deepEqual({
      name: tokens[0].name,
      texture: tokens[0].texture,
      flags: tokens[0].flags,
      delta: tokens[0].delta
    }, before);
    assert.equal(readStorageState(tokens[0]).manualCoins[denomination], Number.MAX_SAFE_INTEGER);
  }
});

test("coin merge accepts the exact largest safe cumulative balance", async () => {
  const { service, tokens } = createHarness();
  await service.transferCoinsToScene({
    coins: { gp: Number.MAX_SAFE_INTEGER - 1 },
    sceneId: "scene",
    x: 300,
    y: 400,
    mutationId: "coin-below-limit"
  });

  const merged = await service.transferCoinsToScene({
    coins: { gp: 1 },
    sceneId: "scene",
    x: 300,
    y: 400,
    mutationId: "coin-at-limit"
  });

  assert.equal(merged.merged, true);
  assert.equal(readStorageState(tokens[0]).manualCoins.gp, Number.MAX_SAFE_INTEGER);
});

test("concurrent same-ID coin creation creates and adds exactly once", async () => {
  const createEntered = deferred();
  const releaseCreate = deferred();
  const { service, tokens } = createHarness({
    beforeCreate: async () => {
      createEntered.resolve();
      await releaseCreate.promise;
    }
  });
  const request = {
    coins: { gp: 5 }, sceneId: "scene", x: 300, y: 400, mutationId: "parallel-create"
  };

  const first = service.transferCoinsToScene(request);
  await createEntered.promise;
  const second = service.transferCoinsToScene(request);
  releaseCreate.resolve();
  const results = await Promise.all([first, second]);

  assert.equal(tokens.length, 1);
  assert.equal(results.filter((result) => result.created).length, 1);
  assert.equal(results.filter((result) => result.duplicate).length, 1);
  assert.deepEqual(readStorageState(tokens[0]).manualCoins, { pp: 0, gp: 5, sp: 0, cp: 0 });
});

test("concurrent same-ID merge adds exactly once", async () => {
  const updateEntered = deferred();
  const releaseUpdate = deferred();
  const { service, tokens } = createHarness({
    beforeUpdate: async () => {
      updateEntered.resolve();
      await releaseUpdate.promise;
    }
  });
  await service.transferCoinsToScene({
    coins: { gp: 1 }, sceneId: "scene", x: 300, y: 400, mutationId: "parallel-base"
  });
  const request = {
    coins: { sp: 2 }, sceneId: "scene", x: 300, y: 400, mutationId: "parallel-same-merge"
  };

  const first = service.transferCoinsToScene(request);
  await updateEntered.promise;
  const second = service.transferCoinsToScene(request);
  releaseUpdate.resolve();
  const results = await Promise.all([first, second]);

  assert.equal(results.filter((result) => result.merged).length, 1);
  assert.equal(results.filter((result) => result.duplicate).length, 1);
  assert.deepEqual(readStorageState(tokens[0]).manualCoins, { pp: 0, gp: 1, sp: 2, cp: 0 });
});

test("concurrent distinct merges both survive on the contained pile", async () => {
  const updateEntered = deferred();
  const releaseUpdate = deferred();
  const { service, tokens } = createHarness({
    beforeUpdate: async () => {
      updateEntered.resolve();
      await releaseUpdate.promise;
    }
  });
  await service.transferCoinsToScene({
    coins: { gp: 1 }, sceneId: "scene", x: 300, y: 400, mutationId: "distinct-base"
  });

  const first = service.transferCoinsToScene({
    coins: { sp: 2 }, sceneId: "scene", x: 300, y: 400, mutationId: "distinct-sp"
  });
  await updateEntered.promise;
  const second = service.transferCoinsToScene({
    coins: { cp: 3 }, sceneId: "scene", x: 320, y: 420, mutationId: "distinct-cp"
  });
  releaseUpdate.resolve();
  await Promise.all([first, second]);

  assert.deepEqual(readStorageState(tokens[0]).manualCoins, { pp: 0, gp: 1, sp: 2, cp: 3 });
  assert.deepEqual(tokens[0].flags[MODULE_ID].groundPile.mutationIds, [
    "distinct-base", "distinct-sp", "distinct-cp"
  ]);
});

test("coin mutation lookup requires the active GM and coin transfer rejects an empty map", async () => {
  const { service } = createHarness({ activeGm: false });
  const request = { coins: {}, sceneId: "scene", x: 300, y: 400, mutationId: "empty-coins" };

  assert.throws(() => service.findProcessedMutationAtPoint(request), /активный мастер/u);
  await assert.rejects(() => service.transferCoinsToScene(request), /хотя бы одну монету/u);
});

test("a claimed pure coin pile reopens with only incoming coins", async () => {
  const { service, tokens } = createHarness();
  await service.transferCoinsToScene({
    coins: { gp: 5 }, sceneId: "scene", x: 300, y: 400, mutationId: "coin-create"
  });
  const token = tokens[0];
  const claimed = { ...readStorageState(token), coinsClaimed: true, state: "empty", displayMode: "empty" };

  const emptyResult = await service.refreshAfterStorageMutation(token, claimed);
  assert.equal(emptyResult.deleted, false);
  assert.equal(tokens.length, 1);
  assert.equal(token.name, "Куча монет (пусто)");
  assert.equal(token.texture.src, `modules/${MODULE_ID}/assets/storage/piles/coins.png`);
  assert.equal(token.flags[MODULE_ID].groundPile.coinPile, true);
  assert.equal(readStorageState(token).state, "empty");
  assert.equal(readStorageState(token).displayMode, "empty");

  await service.transferCoinsToScene({
    coins: { gp: 2 }, sceneId: "scene", x: 300, y: 400, mutationId: "coin-reopen-single"
  });
  let reopened = readStorageState(token);
  assert.equal(token.name, "Золотая монета");
  assert.equal(reopened.state, "opened");
  assert.equal(reopened.displayMode, "opened");
  assert.equal(reopened.coinsClaimed, false);
  assert.deepEqual(reopened.manualCoins, { pp: 0, gp: 2, sp: 0, cp: 0 });

  await service.refreshAfterStorageMutation(token, {
    ...reopened,
    generatedCoins: { pp: 0, gp: 0, sp: 0, cp: 4 },
    coinsClaimed: true,
    state: "empty",
    displayMode: "empty"
  });
  await service.transferCoinsToScene({
    coins: { sp: 3 }, sceneId: "scene", x: 300, y: 400, mutationId: "coin-reopen-after-generated"
  });
  reopened = readStorageState(token);
  assert.equal(token.name, "Серебряная монета");
  assert.equal(reopened.state, "opened");
  assert.equal(reopened.coinsClaimed, false);
  assert.deepEqual(reopened.manualCoins, { pp: 0, gp: 0, sp: 3, cp: 0 });
  assert.deepEqual(reopened.generatedCoins, { pp: 0, gp: 0, sp: 0, cp: 0 });
});

test("ordinary treasure rows keep their single-item presentation with coins and still delete when emptied", async () => {
  const { service, tokens } = createHarness();
  await service.transferSnapshotToScene({
    rows: [treasure],
    coins: {},
    sceneId: "scene",
    x: 300,
    y: 400,
    mutationId: "treasure-create"
  });
  await service.transferCoinsToScene({
    coins: { gp: 4 },
    sceneId: "scene",
    x: 300,
    y: 400,
    mutationId: "treasure-coins"
  });
  const token = tokens[0];
  const state = readStorageState(token);
  assert.equal(token.name, "Рубин");
  assert.equal(token.texture.src, "icons/ruby.webp");
  assert.equal(token.flags[MODULE_ID].groundPile.coinPile, false);
  assert.deepEqual(state.manualCoins, { pp: 0, gp: 4, sp: 0, cp: 0 });

  await service.refreshAfterStorageMutation(token, {
    ...state,
    claimedRowIds: [state.manualRows[0].rowId],
    coinsClaimed: true,
    state: "empty",
    displayMode: "empty"
  });
  assert.equal(token.deleted, true);
  assert.equal(tokens.length, 0);
});

test("snapshot transfer keeps ordinary item presentation ahead of coins", async () => {
  const { service, tokens } = createHarness();
  await service.transferSnapshotToScene({
    rows: [treasure],
    coins: { sp: 2 },
    sceneId: "scene",
    x: 300,
    y: 400,
    mutationId: "treasure-snapshot"
  });

  assert.equal(tokens[0].name, "Рубин");
  assert.equal(tokens[0].texture.src, "icons/ruby.webp");
  assert.equal(tokens[0].flags[MODULE_ID].groundPile.coinPile, false);
});

test("snapshot transfer converts managed coin rows into manualCoins before creating the pile", async () => {
  const { service, tokens } = createHarness();
  await service.transferSnapshotToScene({
    rows: [platinumCoinItemRow],
    coins: { gp: 100 },
    sceneId: "scene",
    x: 300,
    y: 400,
    mutationId: "coin-row-snapshot"
  });

  const state = readStorageState(tokens[0]);
  assert.deepEqual(state.manualRows, []);
  assert.deepEqual(state.manualCoins, { pp: 1, gp: 100, sp: 0, cp: 0 });
  assert.equal(tokens[0].name, "Куча монет");
  assert.equal(tokens[0].width, 0.5);
  assert.equal(tokens[0].height, 0.5);
});

test("a complete snapshot creates one pile with every row and coin", async () => {
  const { service, tokens } = createHarness();

  const result = await service.transferSnapshotToScene({
    rows: [sword, axe],
    coins: { gp: 4, sp: 2 },
    sceneId: "scene",
    x: 300,
    y: 400,
    mutationId: "snapshot-one"
  });

  assert.equal(result.created, true);
  assert.equal(tokens.length, 1);
  const state = readStorageState(tokens[0]);
  assert.equal(state.manualRows.length, 2);
  assert.deepEqual(state.manualRows.map((row) => row.quantity), [5, 1]);
  assert.deepEqual(state.manualCoins, { pp: 0, gp: 4, sp: 2, cp: 0 });
  assert.equal(tokens[0].width, 1);
  assert.equal(tokens[0].height, 1);
});

test("a single container snapshot keeps the preset token size", async () => {
  const { service, tokens } = createHarness();
  await service.transferSnapshotToScene({
    rows: [{
      ...sword,
      rowKind: "container",
      container: { containerId: "bag-1", rows: [], coins: {} }
    }],
    coins: {},
    sceneId: "scene",
    x: 300,
    y: 400,
    mutationId: "container-one"
  });

  assert.equal(tokens[0].width, 1);
  assert.equal(tokens[0].height, 1);
  assert.equal(tokens[0].x, 250);
  assert.equal(tokens[0].y, 350);
});

test("snapshot retries are idempotent while new snapshots stack rows and add coins", async () => {
  const { service, tokens } = createHarness();
  const request = {
    rows: [sword],
    coins: { gp: 2 },
    sceneId: "scene",
    x: 300,
    y: 400,
    mutationId: "snapshot-one"
  };
  await service.transferSnapshotToScene(request);
  const duplicate = await service.transferSnapshotToScene(request);
  assert.equal(duplicate.duplicate, true);

  await service.transferSnapshotToScene({
    ...request,
    coins: { gp: 3, cp: 7 },
    mutationId: "snapshot-two"
  });

  assert.equal(tokens.length, 1);
  const state = readStorageState(tokens[0]);
  assert.equal(state.manualRows.length, 1);
  assert.equal(state.manualRows[0].quantity, 10);
  assert.deepEqual(state.manualCoins, { pp: 0, gp: 5, sp: 0, cp: 7 });
});

test("pure coin piles use the tiny ground-item token size", async () => {
  const { service, tokens } = createHarness();

  await service.transferCoinsToScene({
    coins: { gp: 100 },
    sceneId: "scene",
    x: 300,
    y: 400,
    mutationId: "tiny-gold-pile"
  });

  assert.equal(tokens[0].width, 0.5);
  assert.equal(tokens[0].height, 0.5);
  assert.equal(tokens[0].x, 275);
  assert.equal(tokens[0].y, 375);
});

test("a managed Coin Item dropped onto existing gold becomes manual platinum currency, never an Item row", async () => {
  const { service, tokens } = createHarness();
  await service.transferCoinsToScene({
    coins: { gp: 100 },
    sceneId: "scene",
    x: 300,
    y: 400,
    mutationId: "existing-gold"
  });

  await service.transferToScene({
    row: platinumCoinItemRow,
    quantity: 1,
    sceneId: "scene",
    x: 300,
    y: 400,
    mutationId: "platinum-item-on-gold"
  });

  const state = readStorageState(tokens[0]);
  assert.deepEqual(state.manualRows, []);
  assert.deepEqual(state.manualCoins, { pp: 1, gp: 100, sp: 0, cp: 0 });
  assert.equal(tokens[0].name, "Куча монет");
  assert.equal(tokens[0].texture.src, `modules/${MODULE_ID}/assets/storage/piles/coins.png`);
  assert.equal(tokens[0].width, 0.5);
  assert.equal(tokens[0].height, 0.5);
});

test("active GM idempotently migrates legacy Coin Item rows into manualCoins and repairs presentation and size", async () => {
  const { service, tokens } = createHarness();
  await service.transferToScene({
    row: sword,
    quantity: 1,
    sceneId: "scene",
    x: 300,
    y: 400,
    mutationId: "legacy-pile-seed"
  });
  const token = tokens[0];
  const legacyState = readStorageState(token);
  legacyState.manualRows = [structuredClone(platinumCoinItemRow)];
  legacyState.manualCoins = { pp: 0, gp: 100, sp: 0, cp: 0 };
  token.flags[MODULE_ID].storage = legacyState;
  token.width = 1;
  token.height = 1;
  token.x = 250;
  token.y = 350;

  const first = await service.repairLegacyCoinRows();
  const second = await service.repairLegacyCoinRows();

  assert.deepEqual(first, { repairedTokens: 1, convertedRows: 1 });
  assert.deepEqual(second, { repairedTokens: 0, convertedRows: 0 });
  const repaired = readStorageState(token);
  assert.deepEqual(repaired.manualRows, []);
  assert.deepEqual(repaired.manualCoins, { pp: 1, gp: 100, sp: 0, cp: 0 });
  assert.equal(token.name, "Куча монет");
  assert.equal(token.texture.src, `modules/${MODULE_ID}/assets/storage/piles/coins.png`);
  assert.equal(token.width, 0.5);
  assert.equal(token.height, 0.5);
  assert.equal(token.x, 275);
  assert.equal(token.y, 375);
});

test("legacy coin texture repair migrates stock and old module icons while preserving balances and custom icons", async () => {
  const { service, tokens } = createHarness();
  await service.transferCoinsToScene({
    coins: { gp: 5 },
    sceneId: "scene",
    x: 300,
    y: 400,
    mutationId: "repair-coin-icon"
  });
  tokens[0].texture.src = "icons/commodities/currency/coins-plain-gold.webp";
  assert.equal((await service.repairLegacyCoinRows()).repairedTokens, 1);
  assert.equal(tokens[0].texture.src, `modules/${MODULE_ID}/assets/top-down/items/coins/gp-05.webp`);
  assert.equal(readStorageState(tokens[0]).manualCoins.gp, 5);
  assert.equal((await service.repairLegacyCoinRows()).repairedTokens, 0);
  tokens[0].texture.src = `modules/${MODULE_ID}/assets/top-down/items/gear/zolotaya-moneta.webp`;
  assert.equal((await service.repairLegacyCoinRows()).repairedTokens, 1);
  assert.equal(tokens[0].texture.src, `modules/${MODULE_ID}/assets/top-down/items/coins/gp-05.webp`);
  tokens[0].texture.src = "custom-coin.webp";
  await service.repairLegacyCoinRows();
  assert.equal(tokens[0].texture.src, "custom-coin.webp");
});
