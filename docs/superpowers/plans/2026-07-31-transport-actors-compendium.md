# Transport Actor Compendium Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a managed 62-entry Rebreya vehicle Actor compendium whose entries can be dropped onto a managed party token as independent world Actors and controlled from the party inventory.

**Architecture:** Versioned JSON preserves the Google Sheet rows, a pure builder maps them to D&D5e 5.2.5 vehicle data, and an active-GM compendium service synchronizes `world.rebreya-transport`. A transport-instance service owns validated world-Actor creation and state mutations; a synchronous canvas hook suppresses Foundry's default token drop before delegating the asynchronous mutation through the typed socket bus. The existing inventory service remains the read model and is extended to expose native vehicle data and the live instance state.

**Tech Stack:** Foundry VTT 13, D&D5e 5.2.5, modern browser ES modules, Handlebars, CSS, Node.js built-in `node:test`.

## Global Constraints

- Work only on `lich_branch`; never commit or push directly to `main` or `master`.
- Preserve parallel user changes and stage only files listed by the current task.
- Before every commit, inspect each listed file's diff; if a user change shares
  the same file, stage only the transport hunks with `git add -p` and leave the
  user's hunks unstaged.
- Source spreadsheet: ID `1G-UCW00vsjON05fr0CgyK03YaF82oYJemlqNKdv1JBk`, sheet `Транспорт V0.1`, range `A1:T64`, exactly 62 data rows.
- Runtime Foundry clients must not require Google Drive access.
- The managed pack is `world.rebreya-transport`, labeled `Транспорт Ребреи`, and contains Actor documents of type `vehicle`.
- Every accepted group-token drop creates a new independent world Actor.
- Non-GM mutations must use the typed active-GM socket command bus with exact payload validation and server-side authorization.
- Existing transport Items and existing vehicle group members remain supported.
- Missing source values remain null/absent; do not invent statistics for spreadsheet dashes.
- Tank/feed capacity and current reserve are stored per imported Actor and entered manually.
- Full automatic travel fuel consumption and automatic breakdown rolls are out of scope.
- Every implementation task follows red-green-refactor and ends with a focused passing test and a dedicated commit.

---

## File Structure

### New production files

- `data/rebreya-transport-v01.json`
  - Canonical checked-in representation of the 62 rows from `Транспорт V0.1`.
- `scripts/data/transport-actor-builder.js`
  - Pure normalization, unit parsing, and D&D5e vehicle Actor construction.
- `scripts/data/transport-compendium.js`
  - Catalog loading and active-GM synchronization of the managed Actor pack.
- `scripts/data/transport-instance-service.js`
  - Authorized import, rollback, role assignment, and live instance-state updates.
- `scripts/integrations/transport-group-drop.js`
  - Synchronous `dropCanvasData` interception and party-token hit testing.
- `scripts/integrations/transport-vehicle-sheet.js`
  - Read-only Rebreya specifications block for D&D5e vehicle sheets.

### New test files

- `tests/transport-actor-builder.test.mjs`
- `tests/transport-compendium.test.mjs`
- `tests/transport-instance-service.test.mjs`
- `tests/transport-instance-socket.test.mjs`
- `tests/transport-group-drop.test.mjs`
- `tests/transport-vehicle-sheet.test.mjs`

### Existing files to modify

- `scripts/constants.js`
  - Pack names and transport document UUID helpers.
- `scripts/main.js`
  - Service composition, pack synchronization, socket commands, public API, and hook registration.
- `scripts/data/inventory-service.js`
  - Correct native vehicle paths, Actor instance state, and vehicle cargo contribution.
- `scripts/ui/inventory-app.js`
  - Transport state form context and actions.
- `templates/inventory-app.hbs`
  - Actor-backed transport control panel.
- `styles/main.css`
  - Transport panel layout and state styling.
- `tests/group-inventory-migration.test.mjs`
  - Vehicle read-model and party capacity coverage.
- `tests/inventory-app-context.test.mjs`
  - UI contract and action delegation.
- `tests/main-composition-root.test.mjs`
  - Composition-root imports and hook/service registration contract.

---

### Task 1: Canonical transport catalog and pure Actor builder

**Files:**
- Create: `data/rebreya-transport-v01.json`
- Create: `scripts/data/transport-actor-builder.js`
- Create: `tests/transport-actor-builder.test.mjs`

**Interfaces:**
- Consumes: the approved source range `Транспорт V0.1!A1:T64`.
- Produces:
  - `normalizeTransportEntry(raw: object, index: number): NormalizedTransportEntry`
  - `parseTransportWeight(value: string): { value: number|null, units: "lb", raw: string }`
  - `parseTransportCapacity(value: string): { cargoCapacityLb: number|null, towedCapacityLb: number|null, raw: string }`
  - `parseTransportSpeed(value: string): { primaryFt: number|null, secondaryFt: number|null, raw: string }`
  - `buildTransportActorData(entry: object): object`

- [ ] **Step 1: Add failing catalog integrity and representative mapping tests**

```js
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  buildTransportActorData,
  normalizeTransportEntry,
  parseTransportCapacity,
  parseTransportSpeed
} from "../scripts/data/transport-actor-builder.js";

const catalog = JSON.parse(await readFile(
  new URL("../data/rebreya-transport-v01.json", import.meta.url),
  "utf8"
));

test("transport catalog contains 62 stable unique entries", () => {
  assert.equal(catalog.length, 62);
  assert.equal(new Set(catalog.map(row => row.sourceId)).size, 62);
  assert.equal(new Set(catalog.map(row => row.documentId)).size, 62);
  assert.ok(catalog.every(row => /^lchtransport\d{4}$/u.test(row.documentId)));
});

test("transport normalizer keeps source text and does not invent dashed stats", () => {
  const mount = normalizeTransportEntry(catalog.find(row => row.name === "Боевой конь"), 0);
  assert.equal(mount.typeLabel, "Скакун");
  assert.equal(mount.defaultGroupRole, "mount");
  assert.equal(mount.hpMax, null);
  assert.equal(mount.source.hp, "—");
});

test("locomotive capacity retains own and towed tonnage", () => {
  assert.deepEqual(parseTransportCapacity("5/500 тонн"), {
    cargoCapacityLb: 10000,
    towedCapacityLb: 1000000,
    raw: "5/500 тонн"
  });
});

test("two-mode combat speed retains both values", () => {
  assert.deepEqual(parseTransportSpeed("40/80 футов"), {
    primaryFt: 40,
    secondaryFt: 80,
    raw: "40/80 футов"
  });
});

test("vehicle builder writes native and Rebreya fields", () => {
  const source = catalog.find(row => row.type === "Механический транспорт" && row.hp !== "—");
  const actor = buildTransportActorData(source);
  assert.equal(actor._id, source.documentId);
  assert.equal(actor.type, "vehicle");
  assert.equal(actor.system.attributes.hp.max, Number(source.hp));
  assert.equal(actor.system.attributes.capacity.cargo.units, "lb");
  assert.equal(actor.flags["rebreya-main"].transport.sourceId, source.sourceId);
  assert.equal(actor.prototypeToken.actorLink, true);
});
```

- [ ] **Step 2: Run the focused test and verify the red state**

Run:

```powershell
node --test tests/transport-actor-builder.test.mjs
```

Expected: FAIL because the JSON catalog and builder module do not exist.

- [ ] **Step 3: Transcribe the exact 62 spreadsheet rows into the canonical JSON schema**

Each object must contain all source columns under stable English keys:

```json
{
  "sourceId": "transport-v01-boevoy-kon",
  "documentId": "lchtransport0001",
  "sourceRow": 3,
  "name": "Боевой конь",
  "inventionYear": "—",
  "type": "Скакун",
  "price": "400 зм",
  "rentalPrice": "—",
  "rank": "3",
  "weight": "—",
  "hp": "—",
  "ac": "11",
  "combatSpeed": "60 футов",
  "acceleration": "—",
  "travelSpeed": "6 миль/час",
  "breakdownThreshold": "—",
  "consumption": "4 фнт",
  "crew": "1",
  "passengers": "1",
  "strength": "18",
  "size": "Большой",
  "cargoCapacity": "540 фнт",
  "description": ""
}
```

Use the formatted cell values, preserve `—`, fractions, slashes, commas, units,
and source wording exactly. `sourceId` and `documentId` are explicit checked-in
values and must not be regenerated from array position at runtime.

- [ ] **Step 4: Implement normalization and Actor construction**

The builder must use small pure helpers and preserve raw values:

```js
export function normalizeTransportEntry(raw = {}, index = 0) {
  const source = Object.fromEntries(Object.entries(raw).map(([key, value]) => [
    key, String(value ?? "").trim()
  ]));
  const typeLabel = source.type;
  const hpMax = parseOptionalNumber(source.hp);
  const capacity = parseTransportCapacity(source.cargoCapacity);
  return {
    ...source,
    sourceId: requireStableId(source.sourceId, "sourceId"),
    documentId: requireDocumentId(source.documentId),
    sourceRow: Number(source.sourceRow) || index + 3,
    typeLabel,
    defaultGroupRole: typeLabel === "Скакун" ? "mount" : "transport",
    hpMax,
    ...capacity,
    source
  };
}

export function buildTransportActorData(rawEntry) {
  const entry = normalizeTransportEntry(rawEntry);
  const hp = entry.hpMax == null
    ? { value: 0, max: 0, temp: 0, tempmax: 0, formula: "" }
    : { value: entry.hpMax, max: entry.hpMax, temp: 0, tempmax: 0, formula: "" };
  return {
    _id: entry.documentId,
    name: entry.name,
    type: "vehicle",
    img: resolveTransportDefaultArtwork(entry.typeLabel),
    flags: {
      "rebreya-main": {
        managed: true,
        sourceId: entry.sourceId,
        signature: buildTransportSignature(entry),
        transport: buildTransportFlags(entry)
      }
    },
    prototypeToken: buildTransportPrototypeToken(entry),
    system: buildDnd5eVehicleSystem(entry, hp)
  };
}
```

Map exact D&D5e 5.2.5 paths from the approved spec, including
`attributes.capacity.cargo.value`, `crew.max`, `passengers.max`,
`traits.weight`, `traits.size`, flat AC, movement, travel speed, price, and
Strength. Store non-native values and raw dual values under the transport flag.

- [ ] **Step 5: Run the focused test and syntax check**

Run:

```powershell
node --check scripts/data/transport-actor-builder.js
node --test tests/transport-actor-builder.test.mjs
```

Expected: PASS; the test reports exactly 62 unique entries.

- [ ] **Step 6: Commit only the catalog, builder, and focused test**

```powershell
git add -- data/rebreya-transport-v01.json scripts/data/transport-actor-builder.js tests/transport-actor-builder.test.mjs
git commit -m "feat: add Rebreya transport actor catalog"
```

---

### Task 2: Managed transport Actor compendium

**Files:**
- Modify: `scripts/constants.js:6-26`
- Create: `scripts/data/transport-compendium.js`
- Create: `tests/transport-compendium.test.mjs`

**Interfaces:**
- Consumes:
  - `buildTransportActorData(entry): object`
  - `syncFlaggedManagedDocuments(options): Promise<SyncResult>`
- Produces:
  - `TRANSPORT_COMPENDIUM_NAME = "rebreya-transport"`
  - `TRANSPORT_COMPENDIUM_LABEL = "Транспорт Ребреи"`
  - `TRANSPORT_COMPENDIUM_ID = "world.rebreya-transport"`
  - `loadTransportCatalog(options?): Promise<object[]>`
  - `TransportCompendiumService.sync(entries?: object[]|null): Promise<object>`

- [ ] **Step 1: Write failing compendium lifecycle tests**

```js
function createTransportPackHarness() {
  const documents = [];
  const pack = {
    collection: "world.rebreya-transport",
    documentName: "Actor",
    metadata: { system: "dnd5e" },
    documentClass: {
      async createDocuments(rows) {
        documents.push(...rows.map(row => ({
          ...structuredClone(row),
          id: row._id,
          getFlag(scope, key) { return this.flags?.[scope]?.[key]; },
          async update(patch) { Object.assign(this, structuredClone(patch)); }
        })));
      },
      async deleteDocuments(ids) {
        for (const id of ids) {
          const index = documents.findIndex(document => document.id === id);
          if (index >= 0) documents.splice(index, 1);
        }
      }
    },
    async getDocuments() { return documents; }
  };
  return {
    documents,
    pack,
    game: {
      system: { id: "dnd5e" },
      packs: { get: id => id === pack.collection ? pack : null }
    },
    async createCompendium(metadata) {
      assert.equal(metadata.name, "rebreya-transport");
      assert.equal(metadata.type, "Actor");
      return pack;
    }
  };
}

test("transport compendium sync creates one managed vehicle per catalog row", async () => {
  const harness = createTransportPackHarness();
  const service = new TransportCompendiumService({
    gameProvider: () => harness.game,
    isActiveGmClient: () => true,
    createCompendium: harness.createCompendium,
    catalogProvider: async () => catalog
  });

  const first = await service.sync();
  const second = await service.sync();

  assert.equal(first.pack.collection, "world.rebreya-transport");
  assert.equal(harness.documents.length, 62);
  assert.ok(harness.documents.every(document => document.type === "vehicle"));
  assert.equal(second.result.created, 0);
  assert.equal(second.result.updated, 0);
});

test("transport compendium sync skips inactive GM and non-dnd5e", async () => {
  const inactive = new TransportCompendiumService({
    gameProvider: () => ({ system: { id: "dnd5e" } }),
    isActiveGmClient: () => false
  });
  assert.equal((await inactive.sync([])).skipped, true);
});
```

Also cover replacement of a pack whose `documentName` is not `Actor`, update
after signature change, deletion of stale managed entries, and preservation of
unmanaged documents.

- [ ] **Step 2: Run the test and verify failure**

Run:

```powershell
node --test tests/transport-compendium.test.mjs
```

Expected: FAIL because the constants and service do not exist.

- [ ] **Step 3: Add constants and catalog loading**

```js
export const TRANSPORT_COMPENDIUM_NAME = "rebreya-transport";
export const TRANSPORT_COMPENDIUM_LABEL = "Транспорт Ребреи";
export const TRANSPORT_COMPENDIUM_ID = `world.${TRANSPORT_COMPENDIUM_NAME}`;
```

```js
export async function loadTransportCatalog({
  fetcher = globalThis.fetch,
  path = `modules/${MODULE_ID}/data/rebreya-transport-v01.json`
} = {}) {
  const response = await fetcher(path);
  if (!response?.ok) throw new Error(`Transport catalog request failed: ${response?.status ?? "unknown"}`);
  const rows = await response.json();
  if (!Array.isArray(rows) || rows.length !== 62) {
    throw new Error("Transport catalog must contain exactly 62 rows");
  }
  return rows;
}
```

- [ ] **Step 4: Implement active-GM Actor pack synchronization**

Follow `CraftsmanConstructCompendiumService` for Actor pack creation, but do not
create a technical world Actor:

```js
export class TransportCompendiumService {
  constructor(options = {}) {
    this.options = options;
    this.catalogProvider = options.catalogProvider ?? (() => loadTransportCatalog(options));
  }

  async sync(entries = null) {
    const game = this.options.gameProvider?.() ?? globalThis.game;
    if (!(this.options.isActiveGmClient?.(game) ?? isActiveGmClient(game))
        || game?.system?.id !== "dnd5e") {
      return { skipped: true, pack: null, result: null };
    }
    const rows = entries ?? await this.catalogProvider();
    const pack = await this.ensurePack(game);
    const documents = await pack.getDocuments();
    const result = await syncFlaggedManagedDocuments({
      pack,
      entries: rows.map(normalizeTransportEntry),
      documents,
      moduleId: MODULE_ID,
      sourceIdFlag: "sourceId",
      documentIdOfEntry: entry => entry.documentId,
      buildData: entry => buildTransportActorData(entry)
    });
    return { skipped: false, pack, result };
  }
}
```

The pack metadata is exactly:

```js
{
  name: TRANSPORT_COMPENDIUM_NAME,
  label: TRANSPORT_COMPENDIUM_LABEL,
  type: "Actor",
  system: "dnd5e",
  package: "world"
}
```

- [ ] **Step 5: Run focused compendium tests**

Run:

```powershell
node --check scripts/data/transport-compendium.js
node --test tests/transport-compendium.test.mjs tests/managed-compendium-sync.test.mjs
```

Expected: PASS.

- [ ] **Step 6: Commit the pack service**

```powershell
git add -- scripts/constants.js scripts/data/transport-compendium.js tests/transport-compendium.test.mjs
git commit -m "feat: sync transport actor compendium"
```

---

### Task 3: Compose transport pack synchronization into the module

**Files:**
- Modify: `scripts/main.js:3-14`
- Modify: `scripts/main.js:945-988`
- Modify: `scripts/main.js:2257-2350`
- Modify: `tests/main-composition-root.test.mjs`

**Interfaces:**
- Consumes: `new TransportCompendiumService(options)` and
  `transportCompendium.sync()`.
- Produces: `RebreyaMainModule.transportCompendium` and synchronization during
  both initialization and `reloadData()`.

- [ ] **Step 1: Add a failing composition-root contract**

```js
test("main composes and synchronizes the transport Actor compendium", async () => {
  const source = await readFile(new URL("../scripts/main.js", import.meta.url), "utf8");
  assert.match(source, /import \{ TransportCompendiumService \} from "\.\/data\/transport-compendium\.js/u);
  assert.match(source, /this\.transportCompendium = new TransportCompendiumService/u);
  assert.match(source, /await this\.transportCompendium\.sync\(\)/u);
  assert.match(source, /Failed to sync transport compendium/u);
});
```

- [ ] **Step 2: Run the contract and verify failure**

Run:

```powershell
node --test tests/main-composition-root.test.mjs
```

Expected: FAIL on the missing import or service property.

- [ ] **Step 3: Wire the service into `RebreyaMainModule`**

Add the import, instantiate with active-GM and game providers, and append one
isolated `try/catch` in `#syncManagedCompendia`:

```js
try {
  await this.transportCompendium.sync();
}
catch (error) {
  console.error(`${MODULE_ID} | Failed to sync transport compendium.`, error);
  ui.notifications?.warn("Не удалось синхронизировать компендиум транспорта.");
}
```

Do not make failure of this pack prevent synchronization of other managed
compendia.

- [ ] **Step 4: Run composition and compendium tests**

Run:

```powershell
node --check scripts/main.js
node --test tests/main-composition-root.test.mjs tests/transport-compendium.test.mjs
```

Expected: PASS.

- [ ] **Step 5: Commit composition changes**

```powershell
git add -- scripts/main.js tests/main-composition-root.test.mjs
git commit -m "feat: initialize transport compendium"
```

---

### Task 4: Independent world-Actor import and live state service

**Files:**
- Create: `scripts/data/transport-instance-service.js`
- Create: `tests/transport-instance-service.test.mjs`

**Interfaces:**
- Consumes:
  - `TRANSPORT_COMPENDIUM_ID`
  - `groupContextService.resolveForGroup(groupActorId)`
  - `inventoryService.updatePartyMember(actorId, { role })`
- Produces:
  - `TRANSPORT_IMPORT_COMMAND = "group.transport.importActor"`
  - `TRANSPORT_UPDATE_STATE_COMMAND = "group.transport.updateActorState"`
  - `normalizeTransportInstanceState(value): TransportInstanceState`
  - `validateTransportImportPayload(payload): boolean`
  - `validateTransportStatePayload(payload): boolean`
  - `registerTransportInstanceCommands(commandBus, service): void`
  - `TransportInstanceService.importIntoGroup(payload, context): Promise<ImportResult>`
  - `TransportInstanceService.updateInstanceState(payload, context): Promise<StateResult>`

- [ ] **Step 1: Write failing import, duplicate, rollback, and state tests**

```js
const validImport = {
  groupActorId: "group-a",
  sourceActorUuid: "Compendium.world.rebreya-transport.Actor.lchtransport0001"
};

function createTransportInstanceHarness({ addMemberError = null } = {}) {
  const createdActors = [];
  const addedMemberIds = [];
  const roleUpdates = [];
  const actorUpdates = [];
  const source = {
    uuid: validImport.sourceActorUuid,
    pack: "world.rebreya-transport",
    type: "vehicle",
    name: "Боевой конь",
    toObject: () => ({
      _id: "lchtransport0001",
      name: "Боевой конь",
      type: "vehicle",
      flags: {
        "rebreya-main": {
          managed: true,
          sourceId: "transport-v01-boevoy-kon",
          transport: {
            defaultGroupRole: "mount",
            consumptionUnit: "lb"
          }
        }
      },
      system: { attributes: { hp: { value: 0, max: 0 } } }
    }),
    getFlag(scope, key) { return this.toObject().flags?.[scope]?.[key]; }
  };
  const vehicleActor = {
    id: "vehicle-a",
    uuid: "Actor.vehicle-a",
    type: "vehicle",
    system: { attributes: { hp: { value: 100, max: 100 } } },
    getFlag(_scope, key) {
      return key === "transport"
        ? { consumptionUnit: "gal", instanceState: { reserveUnit: "gal" } }
        : undefined;
    },
    async update(patch) {
      actorUpdates.push(structuredClone(patch));
      return this;
    }
  };
  const groupActor = {
    id: "group-a",
    type: "group",
    system: {
      async addMember(actor) {
        if (addMemberError) throw addMemberError;
        addedMemberIds.push(actor.id);
      }
    }
  };
  const gm = { id: "gm", isGM: true };
  const moduleApi = {
    groupContextService: {
      resolveForGroup(id) {
        assert.equal(id, "group-a");
        return { groupId: "group-a", groupActor, members: [vehicleActor], canManage: true };
      }
    },
    inventoryService: {
      async updatePartyMember(actorId, patch) {
        roleUpdates.push([actorId, structuredClone(patch)]);
      }
    }
  };
  const Actor = {
    async create(data) {
      const actor = {
        ...structuredClone(data),
        id: `vehicle-created-${createdActors.length + 1}`,
        uuid: `Actor.vehicle-created-${createdActors.length + 1}`,
        deleted: false,
        async delete() { this.deleted = true; }
      };
      createdActors.push(actor);
      return actor;
    }
  };
  return {
    gm,
    moduleApi,
    createdActors,
    addedMemberIds,
    roleUpdates,
    actorUpdates,
    options: {
      gameProvider: () => ({ user: gm }),
      actorProvider: () => Actor,
      fromUuid: async uuid => uuid === source.uuid ? source : null,
      idFactory: () => `instance-${createdActors.length + 1}`
    }
  };
}

test("each import creates a separate world Actor and assigns its default role", async () => {
  const harness = createTransportInstanceHarness();
  const service = new TransportInstanceService(harness.moduleApi, harness.options);

  const first = await service.importIntoGroup({
    groupActorId: "group-a",
    sourceActorUuid: "Compendium.world.rebreya-transport.Actor.lchtransport0001"
  }, { sender: harness.gm });
  const second = await service.importIntoGroup({
    groupActorId: "group-a",
    sourceActorUuid: "Compendium.world.rebreya-transport.Actor.lchtransport0001"
  }, { sender: harness.gm });

  assert.notEqual(first.actorId, second.actorId);
  assert.deepEqual(harness.addedMemberIds, [first.actorId, second.actorId]);
  assert.deepEqual(harness.roleUpdates, [
    [first.actorId, { role: "mount" }],
    [second.actorId, { role: "mount" }]
  ]);
});

test("failed native group membership deletes the newly-created orphan", async () => {
  const harness = createTransportInstanceHarness({ addMemberError: new Error("membership failed") });
  const service = new TransportInstanceService(harness.moduleApi, harness.options);
  await assert.rejects(() => service.importIntoGroup(validImport, { sender: harness.gm }), /membership failed/u);
  assert.equal(harness.createdActors[0].deleted, true);
});

test("state update writes native HP and bounded per-instance fuel", async () => {
  const harness = createTransportInstanceHarness();
  const service = new TransportInstanceService(harness.moduleApi, harness.options);
  await service.updateInstanceState({
    groupActorId: "group-a",
    actorId: "vehicle-a",
    patch: {
      hpCurrent: 72,
      condition: "damaged",
      reserveCurrent: 8,
      reserveCapacity: 12
    }
  }, { sender: harness.gm });
  assert.deepEqual(harness.actorUpdates.at(-1), {
    "system.attributes.hp.value": 72,
    "flags.rebreya-main.transport.instanceState": {
      condition: "damaged",
      reserveCurrent: 8,
      reserveCapacity: 12,
      reserveUnit: "gal"
    }
  });
});
```

Also test forged source pack rejection, unmanaged source rejection, non-group
target rejection, unauthorized sender, invalid condition, negative values, HP
above maximum, and reserve above configured capacity.

- [ ] **Step 2: Run the focused test and verify failure**

Run:

```powershell
node --test tests/transport-instance-service.test.mjs
```

Expected: FAIL because the service does not exist.

- [ ] **Step 3: Implement exact payload and state normalization**

```js
const TRANSPORT_CONDITIONS = new Set(["operational", "damaged", "broken"]);

export function normalizeTransportInstanceState(value = {}, { reserveUnit = "" } = {}) {
  const capacity = optionalNonNegativeNumber(value.reserveCapacity);
  const current = nonNegativeNumber(value.reserveCurrent, 0);
  if (capacity != null && current > capacity) {
    throw new Error("Запас топлива или корма не может превышать вместимость.");
  }
  const condition = String(value.condition ?? "operational").trim();
  if (!TRANSPORT_CONDITIONS.has(condition)) {
    throw new Error("Неизвестное состояние транспорта.");
  }
  return { condition, reserveCurrent: current, reserveCapacity: capacity, reserveUnit };
}

export function validateTransportImportPayload(payload) {
  return hasExactKeys(payload, ["groupActorId", "sourceActorUuid"])
    && isSafeId(payload.groupActorId)
    && isTransportCompendiumUuid(payload.sourceActorUuid);
}

export function registerTransportInstanceCommands(commandBus, service) {
  commandBus.register(TRANSPORT_IMPORT_COMMAND, {
    validate: validateTransportImportPayload,
    authorize: (payload, { sender }) => service.canManageGroup(payload.groupActorId, sender),
    execute: (payload, { sender }) => service.importIntoGroup(payload, { sender })
  });
  commandBus.register(TRANSPORT_UPDATE_STATE_COMMAND, {
    validate: validateTransportStatePayload,
    authorize: (payload, { sender }) => service.canManageGroup(payload.groupActorId, sender),
    execute: (payload, { sender }) => service.updateInstanceState(payload, { sender })
  });
}
```

`validateTransportStatePayload` accepts exact top-level keys
`groupActorId`, `actorId`, `patch`; the patch accepts exact keys
`hpCurrent`, `condition`, `reserveCurrent`, `reserveCapacity`.

- [ ] **Step 4: Implement authorization, cloning, membership, and rollback**

```js
async importIntoGroup(payload, { sender } = {}) {
  const groupContext = this.#resolveAuthorizedGroup(payload.groupActorId, sender);
  const source = await this.#fromUuid(payload.sourceActorUuid);
  this.#assertManagedTransportSource(source);
  const data = this.#buildWorldInstanceData(source, groupContext.groupActor.id);
  const actor = await this.#Actor.create(data, { renderSheet: false, keepId: false });
  try {
    await groupContext.groupActor.system.addMember(actor);
    const role = source.getFlag(MODULE_ID, "transport")?.defaultGroupRole === "mount"
      ? "mount"
      : "transport";
    await this.moduleApi.inventoryService.updatePartyMember(actor.id, { role });
    return { actorId: actor.id, actorUuid: actor.uuid, groupActorId: groupContext.groupId, role };
  }
  catch (error) {
    await actor.delete().catch(() => undefined);
    throw error;
  }
}
```

World instance data removes `_id`, `folder`, `pack`, and
`flags.rebreya-main.managed`; adds unique instance provenance and default state;
and sets default ownership to OBSERVER. Compendium synchronization must have no
flag pattern that matches the world copy.

- [ ] **Step 5: Implement live state mutation**

Re-resolve the Actor from the target group's native members, validate sender
authorization, compare HP against native `hp.max`, preserve the inferred reserve
unit, and perform one Actor update containing native HP plus the normalized
instance flag.

```js
async updateInstanceState(payload, { sender } = {}) {
  const groupContext = this.#resolveAuthorizedGroup(payload.groupActorId, sender);
  const actor = groupContext.members.find(member => member?.id === payload.actorId);
  if (!actor || actor.type !== "vehicle") {
    throw new Error("Транспорт не найден в выбранной группе.");
  }
  const hpMax = Math.max(0, Number(actor.system?.attributes?.hp?.max) || 0);
  const hpCurrent = nonNegativeNumber(payload.patch.hpCurrent, 0);
  if (hpMax > 0 && hpCurrent > hpMax) {
    throw new Error("Текущие хиты не могут превышать максимум.");
  }
  const transport = actor.getFlag(MODULE_ID, "transport") ?? {};
  const instanceState = normalizeTransportInstanceState(payload.patch, {
    reserveUnit: transport.instanceState?.reserveUnit ?? transport.consumptionUnit ?? ""
  });
  await actor.update({
    "system.attributes.hp.value": hpCurrent,
    [`flags.${MODULE_ID}.transport.instanceState`]: instanceState
  });
  return { groupActorId: groupContext.groupId, actorId: actor.id, instanceState, hpCurrent };
}
```

- [ ] **Step 6: Run focused service tests**

Run:

```powershell
node --check scripts/data/transport-instance-service.js
node --test tests/transport-instance-service.test.mjs
```

Expected: PASS.

- [ ] **Step 7: Commit the instance service**

```powershell
git add -- scripts/data/transport-instance-service.js tests/transport-instance-service.test.mjs
git commit -m "feat: create independent party transport actors"
```

---

### Task 5: Typed socket commands and module API

**Files:**
- Modify: `scripts/main.js:790-850`
- Modify: `scripts/main.js:945-1015`
- Modify: `scripts/main.js:1150-1245`
- Modify: `scripts/main.js:2843-2885`
- Create: `tests/transport-instance-socket.test.mjs`

**Interfaces:**
- Consumes Task 4 command constants,
  `registerTransportInstanceCommands(commandBus, service)`, and
  `TransportInstanceService`.
- Produces:
  - `RebreyaMainModule.importTransportIntoGroup(payload): Promise<ImportResult>`
  - `RebreyaMainModule.updateTransportInstanceState(payload): Promise<StateResult>`
  - registered typed commands `group.transport.importActor` and
    `group.transport.updateActorState`.

- [ ] **Step 1: Write failing direct-GM, player socket, and forged-request tests**

```js
const validImport = {
  groupActorId: "group-a",
  sourceActorUuid: "Compendium.world.rebreya-transport.Actor.lchtransport0001"
};

function createRegisteredTransportCommandHarness() {
  const registrations = new Map();
  const importContexts = [];
  const service = {
    canManageGroup: (_groupActorId, sender) => sender.id === "player-a",
    async importIntoGroup(payload, context) {
      importContexts.push(context);
      return { actorId: "vehicle-a", ...payload };
    },
    async updateInstanceState(payload) {
      return { actorId: payload.actorId };
    }
  };
  const commandBus = {
    register(command, definition) {
      registrations.set(command, definition);
    }
  };
  registerTransportInstanceCommands(commandBus, service);
  return { registrations, importContexts };
}

test("registered import command validates and authorizes the authenticated sender", async () => {
  const harness = createRegisteredTransportCommandHarness();
  const definition = harness.registrations.get(TRANSPORT_IMPORT_COMMAND);
  const sender = { id: "player-a", isGM: false };
  assert.equal(definition.validate(validImport), true);
  assert.equal(await definition.authorize(validImport, { sender }), true);
  const result = await definition.execute(validImport, { sender });
  assert.equal(result.actorId, "vehicle-a");
  assert.equal(harness.importContexts[0].sender, sender);
});

test("main public API sends only ids through the typed socket bus for players", async () => {
  const source = await readFile(new URL("../scripts/main.js", import.meta.url), "utf8");
  assert.match(source, /socketCommandBus\.request\(TRANSPORT_IMPORT_COMMAND,\s*payload\)/u);
  assert.match(source, /socketCommandBus\.request\(TRANSPORT_UPDATE_STATE_COMMAND,\s*payload\)/u);
});
```

Include malformed extra keys, mismatched sender, unrelated pack UUID, Actor
outside the target group for state updates, and inactive-GM non-execution.

- [ ] **Step 2: Run socket tests and verify failure**

Run:

```powershell
node --test tests/transport-instance-socket.test.mjs
```

Expected: FAIL because the service is not composed and commands are absent.

- [ ] **Step 3: Compose the instance service and register commands**

```js
this.transportInstanceService = new TransportInstanceService(this, {
  gameProvider: () => globalThis.game,
  actorProvider: () => globalThis.Actor,
  fromUuid: uuid => globalThis.fromUuid(uuid)
});

registerTransportInstanceCommands(this.socketCommandBus, this.transportInstanceService);
```

The helper registers both exact validators, authorization callbacks, and
execute callbacks. Do not add a second ad-hoc socket envelope.

- [ ] **Step 4: Add local-or-socket public API methods**

```js
async importTransportIntoGroup(payload) {
  return isActiveGmClient(globalThis.game)
    ? this.transportInstanceService.importIntoGroup(payload, { sender: game.user })
    : this.socketCommandBus.request(TRANSPORT_IMPORT_COMMAND, payload);
}

async updateTransportInstanceState(payload) {
  const result = isActiveGmClient(globalThis.game)
    ? await this.transportInstanceService.updateInstanceState(payload, { sender: game.user })
    : await this.socketCommandBus.request(TRANSPORT_UPDATE_STATE_COMMAND, payload);
  await this.refreshOpenApps();
  return result;
}
```

- [ ] **Step 5: Run socket, infrastructure, and syntax tests**

Run:

```powershell
node --check scripts/main.js
node --test tests/transport-instance-socket.test.mjs tests/world-mutation-infrastructure.test.mjs
```

Expected: PASS.

- [ ] **Step 6: Commit socket composition**

```powershell
git add -- scripts/main.js tests/transport-instance-socket.test.mjs
git commit -m "feat: route transport mutations through active GM"
```

---

### Task 6: Synchronous canvas drop interception

**Files:**
- Create: `scripts/integrations/transport-group-drop.js`
- Create: `tests/transport-group-drop.test.mjs`
- Modify: `scripts/main.js:5038-5170`
- Modify: `tests/main-composition-root.test.mjs`

**Interfaces:**
- Consumes:
  - `moduleApi.importTransportIntoGroup({ groupActorId, sourceActorUuid })`
  - `isManagedPartyGroup(actor)`
- Produces:
  - `findManagedGroupTokenAtPoint(canvas, x, y): Token|null`
  - `isTransportCompendiumActorDrop(data): boolean`
  - `handleTransportGroupDrop(canvas, data, moduleApi): boolean`
  - `registerTransportGroupDropHooks(moduleApi, options?): boolean`

- [ ] **Step 1: Write failing hook behavior tests**

```js
const validTransportData = {
  type: "Actor",
  uuid: "Compendium.world.rebreya-transport.Actor.lchtransport0001",
  x: 150,
  y: 150
};

function createCanvasWithGroupToken({
  id = "group-a",
  bounds = [100, 100, 200, 200],
  managed = true,
  actorType = "group"
} = {}) {
  const [left, top, right, bottom] = bounds;
  return {
    tokens: {
      placeables: [{
        actor: {
          id,
          type: actorType,
          getFlag: (_scope, key) => key === "managed" ? managed : undefined
        },
        bounds: {
          contains: (x, y) => x >= left && x <= right && y >= top && y <= bottom
        }
      }]
    }
  };
}

test("accepted transport drop suppresses Foundry synchronously and imports asynchronously", async () => {
  const calls = [];
  const moduleApi = {
    async importTransportIntoGroup(payload) {
      calls.push(payload);
      return { actorId: "vehicle-a" };
    }
  };
  const allowed = handleTransportGroupDrop(
    createCanvasWithGroupToken({ id: "group-a", bounds: [100, 100, 200, 200] }),
    {
      type: "Actor",
      uuid: "Compendium.world.rebreya-transport.Actor.lchtransport0001",
      x: 150,
      y: 150
    },
    moduleApi
  );
  assert.equal(allowed, false);
  await Promise.resolve();
  assert.deepEqual(calls, [{
    groupActorId: "group-a",
    sourceActorUuid: "Compendium.world.rebreya-transport.Actor.lchtransport0001"
  }]);
});

test("empty canvas and unrelated Actor drops keep Foundry behavior", () => {
  const moduleApi = { importTransportIntoGroup: async () => ({}) };
  const emptyCanvas = { tokens: { placeables: [] } };
  const groupCanvas = createCanvasWithGroupToken({ bounds: [0, 0, 10, 10] });
  assert.equal(handleTransportGroupDrop(emptyCanvas, validTransportData, moduleApi), true);
  assert.equal(
    handleTransportGroupDrop(groupCanvas, { type: "Actor", uuid: "Actor.other", x: 1, y: 1 }, moduleApi),
    true
  );
});
```

Also test topmost-token selection, unmanaged Group token, non-Group token,
missing coordinates, registration idempotence, and error notification without
falling through to default token creation.

- [ ] **Step 2: Run the hook test and verify failure**

Run:

```powershell
node --test tests/transport-group-drop.test.mjs
```

Expected: FAIL because the integration module does not exist.

- [ ] **Step 3: Implement synchronous detection and asynchronous delegation**

Foundry 13 calls `Hooks.call("dropCanvasData", ...)` synchronously. The callback
must therefore return `false` before awaiting:

```js
export function handleTransportGroupDrop(canvas, data, moduleApi) {
  if (!isTransportCompendiumActorDrop(data)) return true;
  const token = findManagedGroupTokenAtPoint(canvas, Number(data.x), Number(data.y));
  if (!token) return true;
  void moduleApi.importTransportIntoGroup({
    groupActorId: token.actor.id,
    sourceActorUuid: data.uuid
  }).then(() => moduleApi.refreshOpenApps?.()).catch(error => {
    console.error(`${MODULE_ID} | Failed to import dropped transport.`, error);
    ui.notifications?.error(error?.message || "Не удалось добавить транспорт в группу.");
  });
  return false;
}
```

`findManagedGroupTokenAtPoint` walks `canvas.tokens.placeables` from the end,
uses `token.bounds.contains(x, y)`, and requires a managed `group` Actor.

- [ ] **Step 4: Register the hook after module API creation**

```js
registerTransportGroupDropHooks(moduleApi, { Hooks });
```

The registration function uses a `WeakSet` keyed by the Hooks object to remain
idempotent in tests and hot reloads.

- [ ] **Step 5: Run drop and composition tests**

Run:

```powershell
node --check scripts/integrations/transport-group-drop.js
node --test tests/transport-group-drop.test.mjs tests/main-composition-root.test.mjs
```

Expected: PASS.

- [ ] **Step 6: Commit canvas integration**

```powershell
git add -- scripts/integrations/transport-group-drop.js tests/transport-group-drop.test.mjs scripts/main.js tests/main-composition-root.test.mjs
git commit -m "feat: drop transport actors onto party tokens"
```

---

### Task 7: Correct native vehicle read model and party capacity

**Files:**
- Modify: `scripts/data/inventory-service.js:650-1100`
- Modify: `scripts/data/inventory-service.js:3604-3683`
- Modify: `scripts/data/inventory-service.js:3753-3854`
- Modify: `tests/group-inventory-migration.test.mjs`

**Interfaces:**
- Consumes native D&D5e vehicle data and
  `flags.rebreya-main.transport.instanceState`.
- Produces Actor-backed transport profiles with:
  - `actorId`
  - `actorUuid`
  - `isActorBacked`
  - `canEditState`
  - `condition`, `conditionLabel`
  - `reserveCurrent`, `reserveCapacity`, `reserveUnit`, `reserveLabel`
  - corrected cargo, crew, passengers, HP, AC, and travel speed.

- [ ] **Step 1: Add failing native-path and cargo integration tests**

```js
test("vehicle member reads D&D5e 5.2.5 native fields and live instance state", async () => {
  const actor = createActor({
    id: "vehicle-a",
    name: "Тяжёлый гражданский фургон",
    type: "vehicle",
    isOwner: true,
    flags: {
      [MODULE_ID]: {
        transport: {
          travelSpeedMph: 12,
          instanceState: {
            condition: "damaged",
            reserveCurrent: 8,
            reserveCapacity: 12,
            reserveUnit: "gal"
          }
        }
      }
    }
  });
  actor.system.attributes = {
    hp: { value: 72, max: 100 },
    ac: { flat: 17 },
    capacity: { cargo: { value: 5000, units: "lb" } }
  };
  actor.system.crew = { max: 2, value: [] };
  actor.system.passengers = { max: 6, value: [] };
  const groupActor = createActor({
    id: "group-a",
    name: "Партия",
    type: "group",
    isOwner: true,
    members: [{ actor }]
  });
  const fixture = installInventoryFixture({
    actors: [groupActor, actor],
    partyState: { members: { "vehicle-a": { role: "transport", capBonusLb: 0 } } }
  });
  const service = new InventoryService({
    groupContextService: {
      resolveForCurrentUser: () => ({
        groupActor,
        groupId: groupActor.id,
        members: [actor],
        canManage: true
      })
    },
    getModel: async () => ({
      materials: [],
      materialById: new Map(),
      materialByGoodId: new Map(),
      gear: [],
      gearById: new Map()
    })
  });
  try {
    const snapshot = await service.getPartySnapshot();
    const member = snapshot.members[0];
    assert.equal(member.transport.cargoCapacityLb, 5000);
    assert.equal(member.transport.crew, 2);
    assert.equal(member.transport.passengers, 6);
    assert.equal(member.transport.condition, "damaged");
    assert.equal(member.capacityLb, 5000);
  }
  finally {
    fixture.restore();
  }
});
```

Add a mount with explicit cargo, a vehicle with no explicit cargo using the
legacy fallback, and an Item-backed transport that does not expose Actor state
controls.

- [ ] **Step 2: Run the focused inventory test and verify failure**

Run:

```powershell
node --test --test-name-pattern="vehicle member|vehicle cargo|transport instance" tests/group-inventory-migration.test.mjs
```

Expected: FAIL because cargo currently reads the object and transport-role
capacity ignores Actor cargo.

- [ ] **Step 3: Correct D&D5e paths and expose instance state**

Change path priority to:

```js
cargoValue: firstDefinedValue(actorData, [
  `flags.${MODULE_ID}.transport.cargoCapacityLb`,
  "system.attributes.capacity.cargo.value",
  "system.attributes.capacity.weight.value",
  "system.capacity.weight.value"
]),
crew: firstDefinedValue(actorData, [
  `flags.${MODULE_ID}.transport.crew`,
  "system.crew.max",
  "system.attributes.crew.max"
]),
passengers: firstDefinedValue(actorData, [
  `flags.${MODULE_ID}.transport.passengers`,
  "system.passengers.max",
  "system.attributes.passengers.max"
])
```

Add raw Actor identity and normalized instance-state fields to the profile.
Keep old paths after the correct paths as compatibility fallbacks.

- [ ] **Step 4: Use explicit vehicle cargo as party capacity**

```js
const transportProfile = buildTransportProfileFromActor(actorDocument, memberState, {
  memberCapacityLb: legacyCapacityLb,
  memberRole: memberState.role
});
const explicitVehicleCapacity = Math.max(0, Number(transportProfile?.cargoCapacityLb) || 0);
const capacityLb = ["transport", "mount"].includes(memberState.role) && explicitVehicleCapacity > 0
  ? roundNumber(explicitVehicleCapacity + memberState.capBonusLb, 2)
  : legacyCapacityLb;
```

Do not count the same cargo twice. `capBonusLb` remains additive.

- [ ] **Step 5: Run inventory and travel regression tests**

Run:

```powershell
node --test tests/group-inventory-migration.test.mjs tests/inventory-app-context.test.mjs tests/travel-service.test.mjs
```

Expected: PASS.

- [ ] **Step 6: Commit the corrected read model**

```powershell
git add -- scripts/data/inventory-service.js tests/group-inventory-migration.test.mjs
git commit -m "fix: read native party vehicle capacity and state"
```

---

### Task 8: Party inventory transport control panel

**Files:**
- Modify: `scripts/ui/inventory-app.js:1464-1510`
- Modify: `scripts/ui/inventory-app.js:3467-3810`
- Modify: `scripts/ui/inventory-app.js:5525-5542`
- Modify: `templates/inventory-app.hbs:715-803`
- Modify: `styles/main.css:5672-5825`
- Modify: `tests/inventory-app-context.test.mjs`

**Interfaces:**
- Consumes:
  - Actor-backed fields from Task 7.
  - `moduleApi.updateTransportInstanceState(payload)`.
  - existing `open-actor-sheet` action.
- Produces:
  - `transport.activeVehicle.stateForm`
  - `data-action="transport-state-save"`
  - editable HP, condition, reserve, and capacity controls.

- [ ] **Step 1: Extend the fake module API and add failing context/action tests**

```js
async updateTransportInstanceState(payload) {
  calls.push(["updateTransportInstanceState", payload]);
  return {};
}
```

```js
test("InventoryApp prepares editable state for an Actor-backed transport", async () => {
  const app = new InventoryApp(createModuleApi({
    transportSnapshot: {
      canManage: true,
      activeTransportId: "member:vehicle-a",
      activeVehicle: {
        id: "member:vehicle-a",
        actorId: "vehicle-a",
        isActorBacked: true,
        hpValue: 72,
        hpMax: 100,
        condition: "damaged",
        reserveCurrent: 8,
        reserveCapacity: 12,
        reserveUnit: "gal"
      },
      vehicles: []
    }
  }));
  app.setActiveTab("transport", { render: false });
  const context = await app._prepareContext();
  assert.equal(context.transport.activeVehicle.stateForm.canEdit, true);
  assert.equal(context.transport.activeVehicle.stateForm.hpCurrent, "72");
  assert.equal(context.transport.activeVehicle.stateForm.capacity, "12");
});

test("transport state save delegates exact group and Actor ids", async () => {
  const restoreFoundry = installFoundryApplicationStub();
  const dom = installMinimalDom();
  const { InventoryApp } = await import(`../scripts/ui/inventory-app.js?transport-state=${Date.now()}`);
  const calls = [];
  const saveButton = createFakeControl();
  const fields = new Map([
    ["hpCurrent", createFakeControl({ value: "70" })],
    ["condition", createFakeControl({ value: "damaged" })],
    ["reserveCurrent", createFakeControl({ value: "7" })],
    ["reserveCapacity", createFakeControl({ value: "12" })]
  ]);
  const form = createFakeElement({ dataset: { actorId: "vehicle-a" } });
  form.querySelector = selector => {
    const match = selector.match(/^\[name='(.+)'\]$/u);
    return match ? fields.get(match[1]) ?? null : null;
  };
  saveButton.closest = selector => selector === "[data-transport-state-form]" ? form : null;
  const root = createFakeElement();
  root.querySelector = selector => selector === "[data-action='transport-state-save']" ? saveButton : null;
  root.querySelectorAll = () => [];
  const app = new InventoryApp(createModuleApi({ getGroupContext: () => null, calls }));
  app.groupActor = { id: "group-a" };
  app.element = root;
  try {
    await app._onRender({}, {});
    await dispatchClick(saveButton);
    assert.deepEqual(calls.filter(call => call[0] === "updateTransportInstanceState"), [[
      "updateTransportInstanceState",
      {
        groupActorId: "group-a",
        actorId: "vehicle-a",
        patch: {
          hpCurrent: 70,
          condition: "damaged",
          reserveCurrent: 7,
          reserveCapacity: 12
        }
      }
    ]]);
  }
  finally {
    dom.restore();
    restoreFoundry();
  }
});
```

- [ ] **Step 2: Run the UI tests and verify failure**

Run:

```powershell
node --test --test-name-pattern="transport" tests/inventory-app-context.test.mjs
```

Expected: FAIL because `stateForm` and save delegation are absent.

- [ ] **Step 3: Prepare safe UI state**

`prepareTransportContext` maps the three conditions to localized select options:

```js
const TRANSPORT_CONDITION_OPTIONS = [
  { value: "operational", label: "Исправен" },
  { value: "damaged", label: "Повреждён" },
  { value: "broken", label: "Сломан" }
];
```

`stateForm.canEdit` is true only when the transport is Actor-backed and the
snapshot grants management. Preserve null capacity as an empty string.

- [ ] **Step 4: Add the Actor-backed state form to the template**

Inside the active transport panel:

```hbs
{{#if transport.activeVehicle.isActorBacked}}
  <form class="rm-transport-state" data-transport-state-form data-actor-id="{{transport.activeVehicle.actorId}}">
    <label>
      <span>Хиты</span>
      <span class="rm-transport-state__split">
        <input name="hpCurrent" type="number" min="0" max="{{transport.activeVehicle.hpMax}}"
               value="{{transport.activeVehicle.stateForm.hpCurrent}}"
               {{#unless transport.activeVehicle.stateForm.canEdit}}disabled{{/unless}}>
        <strong>/ {{transport.activeVehicle.hpMax}}</strong>
      </span>
    </label>
    <label>
      <span>Состояние</span>
      <select name="condition" {{#unless transport.activeVehicle.stateForm.canEdit}}disabled{{/unless}}>
        {{#each transport.activeVehicle.stateForm.conditionOptions}}
          <option value="{{value}}" {{#if selected}}selected{{/if}}>{{label}}</option>
        {{/each}}
      </select>
    </label>
    <label>
      <span>Запас</span>
      <input name="reserveCurrent" type="number" min="0"
             value="{{transport.activeVehicle.stateForm.reserveCurrent}}"
             {{#unless transport.activeVehicle.stateForm.canEdit}}disabled{{/unless}}>
    </label>
    <label>
      <span>Вместимость</span>
      <input name="reserveCapacity" type="number" min="0"
             value="{{transport.activeVehicle.stateForm.reserveCapacity}}"
             placeholder="Задать вручную"
             {{#unless transport.activeVehicle.stateForm.canEdit}}disabled{{/unless}}>
    </label>
    {{#if transport.activeVehicle.stateForm.canEdit}}
      <button type="button" class="rm-button rm-button--primary" data-action="transport-state-save">
        <i class="fa-solid fa-floppy-disk"></i><span>Сохранить состояние</span>
      </button>
    {{/if}}
    <button type="button" class="rm-button rm-button--secondary"
            data-action="open-actor-sheet" data-actor-id="{{transport.activeVehicle.actorId}}">
      <i class="fa-solid fa-id-card"></i><span>Открыть лист</span>
    </button>
  </form>
{{/if}}
```

Display read-only consumption, acceleration, breakdown threshold, crew, and
passenger capacity next to the form.

- [ ] **Step 5: Bind state-save with explicit numeric parsing**

The listener finds the nearest form, reads named controls, converts empty
capacity to `null`, delegates the exact payload, reports success/error, and
re-renders. Disable the clicked button while awaiting.

```js
element.querySelector("[data-action='transport-state-save']")?.addEventListener("click", async event => {
  const button = event.currentTarget;
  const form = button.closest("[data-transport-state-form]");
  const field = name => form.querySelector(`[name='${name}']`)?.value ?? "";
  const capacityText = String(field("reserveCapacity")).trim();
  button.disabled = true;
  try {
    await this.moduleApi.updateTransportInstanceState({
      groupActorId: String(this.groupActor?.id ?? "").trim(),
      actorId: String(form.dataset.actorId ?? "").trim(),
      patch: {
        hpCurrent: Number(field("hpCurrent")),
        condition: field("condition"),
        reserveCurrent: Number(field("reserveCurrent")),
        reserveCapacity: capacityText === "" ? null : Number(capacityText)
      }
    });
    this.#setActionFeedback("success", "Состояние транспорта сохранено.");
    this.render({ force: true });
  }
  catch (error) {
    button.disabled = false;
    ui.notifications?.error(error?.message || "Не удалось сохранить состояние транспорта.");
  }
});
```

- [ ] **Step 6: Style the panel without changing the approved book header**

Use a bounded responsive grid under `.rm-transport-state`; do not modify crest,
wallet, header metrics, window dimensions, or right-side bookmarks. At narrow
widths collapse the state grid to one column.

```css
.rm-transport-state {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 8px;
}

.rm-transport-state label {
  display: grid;
  gap: 4px;
  min-width: 0;
}

@media (max-width: 900px) {
  .rm-transport-state {
    grid-template-columns: 1fr;
  }
}
```

- [ ] **Step 7: Run UI, template, and style tests**

Run:

```powershell
node --test --test-name-pattern="transport" tests/inventory-app-context.test.mjs
node --test tests/style-theme.test.mjs
```

Expected: PASS.

- [ ] **Step 8: Commit the transport control panel**

```powershell
git add -- scripts/ui/inventory-app.js templates/inventory-app.hbs styles/main.css tests/inventory-app-context.test.mjs
git commit -m "feat: control live transport state from inventory"
```

---

### Task 9: Show Rebreya-only specifications on vehicle sheets

**Files:**
- Create: `scripts/integrations/transport-vehicle-sheet.js`
- Create: `tests/transport-vehicle-sheet.test.mjs`
- Modify: `scripts/main.js:5038-5170`
- Modify: `tests/main-composition-root.test.mjs`

**Interfaces:**
- Consumes `flags.rebreya-main.transport` on a vehicle Actor.
- Produces:
  - `buildTransportSpecifications(actor): Array<{ label, value }>`
  - `injectTransportSpecifications(app, html): boolean`
  - `registerTransportVehicleSheetHooks(moduleApi, options?): boolean`

- [ ] **Step 1: Write failing specification and DOM-injection tests**

```js
function createTransportActor(transport, { type = "vehicle" } = {}) {
  return {
    type,
    getFlag(scope, key) {
      return scope === MODULE_ID && key === "transport" ? transport : undefined;
    }
  };
}

function createSheetDom() {
  const createElement = tagName => ({
    tagName: tagName.toUpperCase(),
    className: "",
    textContent: "",
    children: [],
    append(...nodes) { this.children.push(...nodes); },
    querySelector(selector) {
      if (selector === "aside" && this.tagName === "ASIDE") return this;
      if (selector.startsWith(".") && this.className.split(/\s+/u).includes(selector.slice(1))) return this;
      for (const child of this.children) {
        const found = child.querySelector?.(selector);
        if (found) return found;
      }
      return null;
    }
  });
  const ownerDocument = { createElement };
  const root = createElement("div");
  root.ownerDocument = ownerDocument;
  const aside = createElement("aside");
  aside.ownerDocument = ownerDocument;
  root.append(aside);
  return {
    root,
    aside,
    html: {
      querySelector(selector) {
        return selector === ".window-content" ? root : root.querySelector(selector);
      }
    }
  };
}

test("vehicle specifications include every Rebreya field absent from native sheet", () => {
  const rows = buildTransportSpecifications(createTransportActor({
    inventionYear: "318",
    rentalPriceRaw: "10 зм",
    rank: 3,
    accelerationFt: 40,
    breakdownThreshold: 5,
    consumption: "1 галлон на милю",
    cargoCapacityRaw: "5/500 тонн"
  }));
  assert.deepEqual(rows.map(row => row.label), [
    "Год изобретения",
    "Цена аренды",
    "Ранг",
    "Разгон",
    "Граница поломки",
    "Расход топлива или корма",
    "Исходная грузоподъёмность"
  ]);
});

test("sheet injection only touches managed Rebreya vehicle actors", () => {
  const vehicleDom = createSheetDom();
  const characterDom = createSheetDom();
  const unrelatedDom = createSheetDom();
  const vehicleApp = { actor: createTransportActor({ inventionYear: "318" }) };
  const characterApp = { actor: createTransportActor({ inventionYear: "318" }, { type: "character" }) };
  const unrelatedVehicleApp = { actor: createTransportActor(undefined) };
  assert.equal(injectTransportSpecifications(vehicleApp, vehicleDom.html), true);
  assert.equal(vehicleDom.aside.children.length, 1);
  assert.equal(injectTransportSpecifications(characterApp, characterDom.html), false);
  assert.equal(injectTransportSpecifications(unrelatedVehicleApp, unrelatedDom.html), false);
});
```

- [ ] **Step 2: Run the sheet test and verify failure**

Run:

```powershell
node --test tests/transport-vehicle-sheet.test.mjs
```

Expected: FAIL because the integration does not exist.

- [ ] **Step 3: Implement safe read-only sheet injection**

Build DOM nodes through `ownerDocument.createElement`; do not concatenate source
values into HTML. Attach one `.rm-rebreya-transport-specs` section to the
vehicle sheet sidebar or details region, guarded by an existing-element check.
Show only non-empty values. This block is informational; live state remains
editable from the party inventory.

```js
export function injectTransportSpecifications(app, html) {
  const actor = app?.actor ?? app?.document;
  const root = html?.querySelector?.(".window-content") ?? html?.[0] ?? html;
  if (actor?.type !== "vehicle" || !actor.getFlag?.(MODULE_ID, "transport") || !root) return false;
  if (root.querySelector?.(".rm-rebreya-transport-specs")) return true;
  const rows = buildTransportSpecifications(actor);
  if (!rows.length) return false;
  const document = root.ownerDocument ?? globalThis.document;
  const section = document.createElement("section");
  section.className = "rm-rebreya-transport-specs";
  const heading = document.createElement("h3");
  heading.textContent = "Характеристики Ребреи";
  section.append(heading);
  for (const row of rows) {
    const line = document.createElement("p");
    const label = document.createElement("span");
    const value = document.createElement("strong");
    label.textContent = row.label;
    value.textContent = row.value;
    line.append(label, value);
    section.append(line);
  }
  (root.querySelector?.("aside") ?? root).append(section);
  return true;
}
```

- [ ] **Step 4: Register generic and D&D5e vehicle render hooks idempotently**

Register `renderActorSheet` plus the installed D&D5e vehicle-specific render
hook if emitted. Both callbacks call the same idempotent injector, so duplicate
hook delivery cannot duplicate the panel.

```js
const registeredHookSets = new WeakSet();

export function registerTransportVehicleSheetHooks(_moduleApi, { Hooks = globalThis.Hooks } = {}) {
  if (!Hooks?.on || registeredHookSets.has(Hooks)) return false;
  registeredHookSets.add(Hooks);
  const render = (app, html) => injectTransportSpecifications(app, html);
  Hooks.on("renderActorSheet", render);
  Hooks.on("renderActorSheet5eVehicle", render);
  return true;
}
```

- [ ] **Step 5: Run sheet and composition tests**

Run:

```powershell
node --check scripts/integrations/transport-vehicle-sheet.js
node --test tests/transport-vehicle-sheet.test.mjs tests/main-composition-root.test.mjs
```

Expected: PASS.

- [ ] **Step 6: Commit the vehicle sheet extension**

```powershell
git add -- scripts/integrations/transport-vehicle-sheet.js tests/transport-vehicle-sheet.test.mjs scripts/main.js tests/main-composition-root.test.mjs
git commit -m "feat: show Rebreya specifications on vehicle sheets"
```

---

### Task 10: Integrated verification and live Foundry acceptance

**Files:**
- Modify only if a failing acceptance check exposes a transport-specific defect.
- Do not modify unrelated user files to make the suite green.

**Interfaces:**
- Consumes all prior task deliverables.
- Produces a verified `lich_branch` ready to push.

- [ ] **Step 1: Inspect final scope and whitespace**

Run:

```powershell
git status --short --branch
git diff --check
git diff --stat origin/lich_branch...HEAD
```

Expected: only intended transport commits plus separately identifiable user
changes; no whitespace errors.

- [ ] **Step 2: Run the complete focused transport suite**

Run:

```powershell
node --test tests/transport-actor-builder.test.mjs tests/transport-compendium.test.mjs tests/transport-instance-service.test.mjs tests/transport-instance-socket.test.mjs tests/transport-group-drop.test.mjs tests/transport-vehicle-sheet.test.mjs tests/group-inventory-migration.test.mjs tests/inventory-app-context.test.mjs tests/main-composition-root.test.mjs tests/world-mutation-infrastructure.test.mjs tests/travel-service.test.mjs tests/style-theme.test.mjs
```

Expected: PASS.

- [ ] **Step 3: Run syntax checks on every new or modified JavaScript module**

Run:

```powershell
node --check scripts/data/transport-actor-builder.js
node --check scripts/data/transport-compendium.js
node --check scripts/data/transport-instance-service.js
node --check scripts/integrations/transport-group-drop.js
node --check scripts/integrations/transport-vehicle-sheet.js
node --check scripts/data/inventory-service.js
node --check scripts/ui/inventory-app.js
node --check scripts/main.js
```

Expected: all commands exit 0.

- [ ] **Step 4: Run all available repository tests**

Run:

```powershell
$testFiles = Get-ChildItem tests -Filter *.test.mjs | Sort-Object Name | ForEach-Object FullName
node --test $testFiles
```

Expected: PASS. If a parallel user test fails, report its exact failure and
verify that the transport-focused suite still passes; do not edit unrelated
files without authorization.

- [ ] **Step 5: Reload Foundry with the Codex profile**

Open the local Foundry page, select the Codex browser profile, authenticate with
the supplied password `666`, enter the test world, and verify that the
`Транспорт Ребреи` Actor compendium contains 62 vehicle entries.

- [ ] **Step 6: Exercise the group-token workflow**

For one mount and one mechanical vehicle:

1. Drag the compendium Actor onto the intended managed Group token.
2. Confirm no transport token is created on top of the group token.
3. Confirm a new world vehicle Actor exists.
4. Confirm it is a native group member.
5. Confirm its role is `mount` or `transport`.
6. Repeat the same source drop and confirm a second independent Actor exists.

- [ ] **Step 7: Exercise state and inventory behavior**

In the party inventory:

1. Select one imported Actor as active transport.
2. Change HP, condition, current reserve, and manual capacity.
3. Reopen the inventory and full Actor sheet to confirm persistence.
4. Verify the duplicate Actor kept its own untouched state.
5. Verify group capacity includes the selected/imported vehicle cargo.
6. Verify active transport speed reaches the travel snapshot.
7. Verify a legacy transport Item still appears and can be selected.

- [ ] **Step 8: Review the final diff**

Run:

```powershell
git diff --check origin/lich_branch...HEAD
git log --oneline origin/lich_branch..HEAD
git status --short
```

Inspect every transport-related file and confirm no user-owned parallel changes
were staged accidentally.

- [ ] **Step 9: Create a final corrective commit only if acceptance required a fix**

Stage exact transport paths only:

```powershell
git add -- data/rebreya-transport-v01.json scripts/constants.js scripts/main.js scripts/data/transport-actor-builder.js scripts/data/transport-compendium.js scripts/data/transport-instance-service.js scripts/data/inventory-service.js scripts/integrations/transport-group-drop.js scripts/integrations/transport-vehicle-sheet.js scripts/ui/inventory-app.js templates/inventory-app.hbs styles/main.css tests/transport-actor-builder.test.mjs tests/transport-compendium.test.mjs tests/transport-instance-service.test.mjs tests/transport-instance-socket.test.mjs tests/transport-group-drop.test.mjs tests/transport-vehicle-sheet.test.mjs tests/group-inventory-migration.test.mjs tests/inventory-app-context.test.mjs tests/main-composition-root.test.mjs
git diff --cached --name-only
git commit -m "fix: complete transport actor workflow"
```

Skip this step when the working tree contains no transport-specific fix.

- [ ] **Step 10: Push without force**

Run:

```powershell
git push origin lich_branch
```

Expected: normal fast-forward push succeeds. Never use `--force` or
`--force-with-lease` without separate user authorization.
