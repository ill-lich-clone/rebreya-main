# Party Inventory Folders Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Добавить партийному инвентарю общее дерево организационных папок глубиной до 5 с безопасными typed mutations, кэшированным поиском, личным раскрытием, drag-and-drop и живыми popout-представлениями без изменения Item Documents.

**Architecture:** `InventoryService` остаётся единственным владельцем общего состояния во флаге группового Actor; новый `inventory-folder-tree.js` содержит только чистую нормализацию, reducers и построение render-проекции. `RebreyaMainModule` маршрутизирует player-операции через пять typed commands, переиспользует существующий `WorldMutationCoordinator` и единственный `refreshInventoryViews({ actorIds })`, а `InventoryApp` переиспользуется для главного окна и popout поддерева.

**Tech Stack:** Foundry VTT 13 ApplicationV2, dnd5e, ES modules, Handlebars, CSS, Node.js `node:test`/`assert`, обязательный `statuscounter >= 3.0.4`.

**Spec:** `docs/superpowers/specs/2026-08-23-party-inventory-folders-design.md`

## Global Constraints

- Runtime-entrypoint остаётся `scripts/main.js`; versioned forwarder `scripts/main-1.4.155.js` не изменяется.
- Общее состояние хранится только в `flags["rebreya-main"].inventoryFolders` группового Actor одной структурой версии 1.
- Личное раскрытие хранится только в `flags["rebreya-main"].inventoryFolderUi` текущего User.
- Папки не являются dnd5e-контейнерами, не обновляют `Item.system`, `Item.flags`, `Item.folder` или `Item.sort` и не меняют каталоги.
- Все общие player-мутации проходят через active GM, exact-key typed commands и повторную authoritative проверку после ожидания actor-scoped очереди.
- Используется только существующий `WorldMutationCoordinator`; новый coordinator, resolver, state owner, refresh route или глобальный hook запрещён.
- Единственная точка UI refresh — `refreshInventoryViews({ actorIds })`; folder flag update коалесцируется существующим inventory-sync маршрутом.
- Максимальная глубина папок — 5; циклы, self-parent и перенос между разными групповыми Actor запрещены.
- Удаление папки поднимает её Item и прямых детей к родителю, но не удаляет содержимое.
- Перемещается целый embedded Item/стэк; разделение quantity и ручная sibling-сортировка отсутствуют.
- Существующий merge-кандидат сохраняет свою текущую папку; новый Item получает target folder только после доказанного create.
- `itemsCanMergeInInventory()` и durability signature остаются каноническими; broken/damaged варианты не объединяются.
- Цвета папок, пользовательские иконки, stack split и автоматическое восстановление popout после reload не входят в реализацию.
- Публичный пользовательский API и `README.md` не меняются; новые module API методы считаются внутренними UI entrypoints и не документируются в README.
- Все новые и изменённые методы, команды, data flow, ограничения и focused-тесты фиксируются в разделе 7 `docs/function-passport.md` в том же commit, где меняется код.
- Исходники, JSON, шаблоны и русские строки сохраняются в UTF-8.

---

## File and interface map

### New files

- `scripts/data/inventory-folder-tree.js` — чистая схема версии 1, repair-normalizer, immutable reducers, depth/cycle validation, recursive counts, folders-first tree, search index и видимая flat projection.
- `tests/inventory-folder-tree.test.mjs` — exhaustive pure tests без Foundry globals.
- `tests/inventory-folder-socket.test.mjs` — command dispatch, exact payload, transport sender, group authorization, authoritative re-resolve, stale-state validation и scoped refresh.

### Existing files to modify

- `scripts/data/inventory-service.js:1-45, 1763-1885, 3055-3090, 3297-3340, 4082-4210, 4390-4525, 5586-5688, 6110-6290` — constants/exports, actor resolution, snapshot projection, five folder mutations, actor flag write, import/grant recovery and merge-folder preservation.
- `scripts/data/storage-command-service.js:80-130, 493-590` — exact party target `{ groupActorId, folderId }` and storage grant propagation.
- `scripts/main.js:45-65, 640-746, 1038-1060, 1320-1435, 1586-1630, 3227-3235, 3272-3310, 4768-4790, 5385-5465, 5696-5720` — command registration, module API wrappers, personal User flag merge, popout registry and actor-scoped refresh.
- `scripts/integrations/inventory-sync.js:385-490` — coalesced actor-ID refresh through the existing hooks; no new hook.
- `scripts/ui/inventory-app.js:2520-2650, 3106-3180, 3778-4235, 5807-5860, 6318-6360, 6548-6610, 7036-7050` — cached folder projection, personal expansion, actions, DnD, popout scope/title/lifecycle.
- `templates/inventory-app.hbs:175-260` — toolbar create button and flat folder/item tree rows.
- `styles/main.css:5805-6060, 9960-10330` — compact folder rows, fixed-column item layout, leading-area depth indentation and drop states.
- `tests/group-inventory-migration.test.mjs` — service snapshot, normalization-on-read, Actor flag writes and folder mutations.
- `tests/inventory-mutation-recovery.test.mjs` — create/grant/import checkpoints, retry, merge-folder and durability regressions.
- `tests/storage-socket.test.mjs` — exact storage party target and folder-aware grant/container retry.
- `tests/inventory-app-context.test.mjs` — tree context, cached search, personal state, actions, popout and DnD.
- `tests/inventory-sync-hooks.test.mjs` — actor-scoped coalescence for the existing update hooks.
- `tests/ui-refresh-coordinator.test.mjs` — main/popout selection by Actor and no-focus refresh.
- `docs/function-passport.md:95-109` — current section 7 contract; section 19 is updated too if the refresh helper signature description changes.

### Locked cross-task interfaces

`scripts/data/inventory-folder-tree.js` exports exactly:

    export const INVENTORY_FOLDER_STATE_VERSION = 1;
    export const MAX_INVENTORY_FOLDER_DEPTH = 5;
    export const MAX_INVENTORY_FOLDER_NAME_LENGTH = 80;
    export class InventoryFolderStateError extends Error {}
    export function createEmptyInventoryFolderState();
    export function normalizeInventoryFolderState(rawState, { itemIds = [] } = {});
    export function normalizeExpandedFolderIds(rawIds, { folderIds = [] } = {});
    export function createInventoryFolder(state, { folderId, name, parentId = null });
    export function renameInventoryFolder(state, { folderId, name });
    export function moveInventoryFolder(state, { folderId, parentId = null });
    export function deleteInventoryFolder(state, { folderId });
    export function moveInventoryItemToFolder(state, { itemId, folderId = null });
    export function buildInventoryFolderTree({ state, items = [], compareItems });
    export function buildInventoryFolderSearchIndex(tree, { itemText });
    export function projectInventoryFolderRows({
      tree,
      searchIndex,
      rootFolderId = null,
      expandedFolderIds = [],
      search = "",
      typeFilter = "all"
    });

The normalized shared state is always:

    {
      version: 1,
      folders: [{ id: "folder-id", name: "Оружие", parentId: null }],
      itemFolderIds: { "item-id": "folder-id" }
    }

`InventoryService` adds or changes these callable methods:

    getInventoryActor({ create = false, groupActorId = "" } = {})
    getInventorySnapshot({
      search = "",
      typeFilter = "all",
      createActor = true,
      groupActorId = ""
    } = {})
    createInventoryFolder({ groupActorId, folderId, name, parentId = null })
    renameInventoryFolder({ groupActorId, folderId, name })
    moveInventoryFolder({ groupActorId, folderId, parentId = null })
    deleteInventoryFolder({ groupActorId, folderId })
    moveInventoryItemToFolder({ groupActorId, itemId, folderId = null })
    assignInventoryGrantFolder({ groupActorId, itemId, folderId = null })
    importDroppedItem(dropData, { groupActorId = "", folderId = null } = {})
    addLootgenRowToInventoryOnce(
      row,
      mutationId,
      { allowPersistedItemData = false, groupActorId = "", folderId = null } = {}
    )

The five command payloads contain no optional keys:

    inventory.folder.create  -> { groupActorId, folderId, name, parentId }
    inventory.folder.rename  -> { groupActorId, folderId, name }
    inventory.folder.move    -> { groupActorId, folderId, parentId }
    inventory.folder.delete  -> { groupActorId, folderId }
    inventory.item.folder.move -> { groupActorId, itemId, folderId }

`InventoryApp` keeps its existing constructor signature but consumes custom options:

    new InventoryApp(moduleApi, {
      groupActorId: "group-id",
      rootFolderId: null,
      inventoryViewKey: "main"
    })

For a popout, `rootFolderId` is a stable folder ID and `inventoryViewKey` is `groupActorId + ":" + rootFolderId`. The main view uses `rootFolderId: null` and the single existing `inventoryApp` slot.

The refresh contract added to `InventoryApp` is:

    get inventoryActorId()
    refreshInventorySnapshot({ preserveScroll = true } = {})

## Execution preflight

- [ ] Read `AGENTS.md` and the complete approved spec before editing.
- [ ] Run the mandatory shared-repository checks:

    git status --short --branch
    git branch --show-current
    git fetch origin
    git rev-list --left-right --count HEAD...origin/main
    git log --oneline HEAD..origin/main
    git rev-list --left-right --count HEAD...origin/lich_branch
    git log --oneline HEAD..origin/lich_branch

Expected: active branch `lich_branch`, no uncommitted foreign files, no commits on `origin/main` missing from HEAD, and no remote `lich_branch` commits missing locally. Stop and report instead of editing if any shared-copy stop condition from `AGENTS.md` is met.

- [ ] Re-run focused anchors instead of opening large files wholesale:

    rg -n "### 7\.|### 8\." docs/function-passport.md
    rg -n "getInventorySnapshot|#findInventoryMergeCandidate|#executeInventoryGrantOnce|#executeImportItemDocument" scripts/data/inventory-service.js
    rg -n "INVENTORY_.*COMMAND|refreshInventoryViews|openInventoryApp|inventoryApp" scripts/main.js
    rg -n "inventorySearchContext|_prepareContext|inventory-dropzone|data-item-drag" scripts/ui/inventory-app.js templates/inventory-app.hbs

---

### Task 1: Pure folder-state model, repair normalization and tree projection

**Files:**

- Create: `scripts/data/inventory-folder-tree.js`
- Create: `tests/inventory-folder-tree.test.mjs`
- Modify: `docs/function-passport.md:95-109`

**Interfaces:**

- Consumes: plain objects and plain Item rows only; no `game`, `foundry`, Actor, User, sockets or UI globals.
- Produces: all exports listed in “Locked cross-task interfaces”; every reducer returns a new normalized state and never mutates its input.

- [ ] **Step 1: Write failing normalization tests**

Add table-driven tests that prove deterministic repair:

    test("normalizeInventoryFolderState repairs corrupt parents, cycles, depth and membership", () => {
      const normalized = normalizeInventoryFolderState({
        version: 99,
        folders: [
          { id: "a", name: " A ", parentId: "b" },
          { id: "b", name: "B", parentId: "a" },
          { id: "a", name: "duplicate", parentId: null },
          { id: "self", name: "Self", parentId: "self" },
          { id: "missing", name: "Missing", parentId: "absent" },
          { id: "", name: "invalid", parentId: null },
          { id: "blank", name: "   ", parentId: null }
        ],
        itemFolderIds: {
          live: "a",
          staleItem: "a",
          unknownFolder: "absent"
        }
      }, { itemIds: ["live", "unknownFolder"] });

      assert.deepEqual(normalized, {
        version: 1,
        folders: [
          { id: "a", name: "A", parentId: null },
          { id: "b", name: "B", parentId: null },
          { id: "self", name: "Self", parentId: null },
          { id: "missing", name: "Missing", parentId: null }
        ],
        itemFolderIds: { live: "a" }
      });
    });

Add separate cases for absent/non-object state, equal names with different IDs, first-valid duplicate retention, a six-node chain, a deeper descendant below a repaired sixth node, and `normalizeExpandedFolderIds()` removing duplicates and missing folder IDs.

- [ ] **Step 2: Run the new focused test and confirm red state**

Run:

    node --test tests/inventory-folder-tree.test.mjs

Expected: FAIL because `inventory-folder-tree.js` or its exports do not exist.

- [ ] **Step 3: Implement the state normalizer in a fixed repair order**

Use this exact order so corrupt worlds normalize identically on every client:

1. Accept only object state; emit version 1 regardless of input version.
2. Trim folder ID and name; drop empty IDs/names; retain the first valid occurrence of a repeated ID.
3. Normalize empty parent to `null`; replace missing parent and self-parent with `null`.
4. Walk each parent chain with an ordered path; when a repeated path node is found, set `parentId: null` for every folder in that cycle.
5. Recompute depth from roots; when a folder would become depth 6, promote that first violating folder to root and then recompute its descendants from the new root.
6. Keep an Item membership only when the Item ID is in `itemIds` and the folder ID survived normalization.
7. Preserve folder insertion order in normalized storage; sorting belongs to tree construction.

`InventoryFolderStateError` uses stable `code` values: `invalid-folder-id`, `invalid-folder-name`, `folder-name-too-long`, `folder-not-found`, `parent-folder-not-found`, `folder-id-conflict`, `folder-cycle`, `folder-depth-exceeded`, and `item-not-found`.

- [ ] **Step 4: Write failing reducer tests**

Cover all mutation semantics:

    test("deleteInventoryFolder promotes direct contents without flattening deeper descendants", () => {
      const state = {
        version: 1,
        folders: [
          { id: "parent", name: "Parent", parentId: null },
          { id: "deleted", name: "Deleted", parentId: "parent" },
          { id: "child", name: "Child", parentId: "deleted" },
          { id: "grandchild", name: "Grandchild", parentId: "child" }
        ],
        itemFolderIds: { itemA: "deleted", itemB: "grandchild" }
      };

      assert.deepEqual(deleteInventoryFolder(state, { folderId: "deleted" }), {
        version: 1,
        folders: [
          { id: "parent", name: "Parent", parentId: null },
          { id: "child", name: "Child", parentId: "parent" },
          { id: "grandchild", name: "Grandchild", parentId: "child" }
        ],
        itemFolderIds: { itemA: "parent", itemB: "grandchild" }
      });
    });

Also assert:

- create trims name, accepts duplicate names, accepts depth 5, rejects depth 6, and treats the same `folderId/name/parentId` as an idempotent no-op;
- create rejects a reused ID with different data;
- rename changes only name and keeps descendants/membership;
- move rejects self, descendants and a target whose subtree height would exceed 5;
- move to current parent is a no-op;
- delete of a missing ID is a no-op and never reparents unrelated data;
- Item move to `null` removes the map key, preserves quantity data outside the state, and rejects missing target folders.

- [ ] **Step 5: Implement immutable reducers and subtree-depth validation**

Validate the deepest descendant, not only the moved folder:

    const resultingDeepestDepth =
      depthOfTargetParent + 1 + subtreeHeightOfMovedFolder - 1;

Reject when `resultingDeepestDepth > MAX_INVENTORY_FOLDER_DEPTH`. Reducers must clone only the state arrays/maps they return and must not retain caller-owned objects.

- [ ] **Step 6: Write failing tree, count, sort and search-projection tests**

Build fixtures with root folders `А`/`Б`, nested folders, root Items, Item type filters and equal folder names. Assert:

- folders use `localeCompare(name, "ru")` and precede Items at every level;
- Item order is delegated to the supplied `compareItems`;
- recursive count is the number of Item Documents, not quantity;
- the main projection includes a folder match plus ancestors but not unmatched descendants;
- an Item match includes its breadcrumb chain and temporarily expands ancestors;
- temporary search expansion is returned only in row context and does not alter `expandedFolderIds`;
- a popout projection excludes matches outside `rootFolderId`;
- Item type filter never applies to a folder name;
- `rootFolderId` projection omits the root row itself and makes its children relative depth 1.

- [ ] **Step 7: Implement tree/index/projection without repeated traversal per keystroke**

`buildInventoryFolderTree()` produces a root node, `foldersById` map and recursive counts in one post-order pass. `buildInventoryFolderSearchIndex()` precomputes normalized text and ancestor IDs once. `projectInventoryFolderRows()` consumes those cached structures and returns:

    {
      rows: [
        {
          key: "folder:weapons",
          kind: "folder",
          folderId: "weapons",
          depth: 1,
          recursiveItemCount: 4,
          expanded: true,
          searchExpanded: false,
          breadcrumb: []
        },
        {
          key: "item:sword",
          kind: "item",
          itemId: "sword",
          folderId: "weapons",
          depth: 1,
          breadcrumb: ["Оружие"]
        }
      ],
      visibleItemCount: 1,
      rootFolder: null,
      rootFolderMissing: false
    }

For an unknown popout root, return `rootFolderMissing: true` and no rows. Do not throw from a read projection.

- [ ] **Step 8: Run the pure tests**

Run:

    node --test tests/inventory-folder-tree.test.mjs

Expected: PASS for normalization, reducers, depth/cycle validation, recursive counts, folders-first sorting, breadcrumbs, filters and subtree projection.

- [ ] **Step 9: Update passport section 7**

Add the pure module as a stateless helper, list its exported methods, state that `InventoryService` remains owner, and list `tests/inventory-folder-tree.test.mjs`. Do not describe the helper as a repository or source of truth.

- [ ] **Step 10: Review, commit and push Task 1**

Run:

    git diff --check
    git diff --stat
    git diff -- scripts/data/inventory-folder-tree.js tests/inventory-folder-tree.test.mjs docs/function-passport.md
    git add scripts/data/inventory-folder-tree.js tests/inventory-folder-tree.test.mjs docs/function-passport.md
    git commit -m "feat: add party inventory folder tree model"
    git push -u origin lich_branch

---

### Task 2: InventoryService snapshot and canonical Actor-flag mutations

**Files:**

- Modify: `scripts/data/inventory-service.js`
- Modify: `tests/group-inventory-migration.test.mjs`
- Modify: `docs/function-passport.md:95-109`

**Interfaces:**

- Consumes: Task 1 normalizer/reducers; existing `GroupContextService.resolveForGroup(groupActorId)`; existing shared `moduleApi.worldMutationCoordinator`.
- Produces: folder-aware snapshot and the `InventoryService` methods listed in the interface map.

- [ ] **Step 1: Extend the Actor fixture and write failing snapshot tests**

Add `flags`, `getFlag()` and a counted `setFlag()` to the focused Actor fixture. Verify:

    const snapshot = await service.getInventorySnapshot({
      createActor: false,
      groupActorId: "group-a"
    });

    assert.deepEqual(snapshot.folders, [
      { id: "weapons", name: "Оружие", parentId: null }
    ]);
    assert.equal(snapshot.allItems.find((row) => row.itemId === "sword").folderId, "weapons");
    assert.equal(snapshot.allItems.find((row) => row.itemId === "torch").folderId, null);

Also test that no flag means `folders: []` and every existing Item is root, corrupt/missing membership is repaired in the read projection without a write, and summary totals are identical before and after folder assignment.

- [ ] **Step 2: Run the focused service test and confirm red state**

Run:

    node --test tests/group-inventory-migration.test.mjs

Expected: FAIL on missing `folders`/`folderId` or unsupported `groupActorId`.

- [ ] **Step 3: Add explicit group Actor resolution**

Change `getInventoryActor({ create, groupActorId })` so a non-empty group ID is resolved only with `groupContextService.resolveForGroup(groupActorId)`, must return the same managed group Actor ID, and never falls back to the active group or legacy Actor. Preserve the old no-ID behavior for existing callers.

Inside every folder mutation, call this resolver after entering:

    this.mutationCoordinator.run(
      `inventory-folders:${groupActorId}`,
      async () => {
        const actor = await this.getInventoryActor({ create: false, groupActorId });
        return actor;
      }
    );

This is the existing coordinator instance injected by composition; do not construct another coordinator.

- [ ] **Step 4: Add normalized folder data to the snapshot**

Read `actor.getFlag(MODULE_ID, "inventoryFolders")`, normalize against current `actor.items.contents` IDs, and add `folderId` to each Item entry. Return `folders` and `folderStateVersion: 1` for both present and empty Actor cases. Keep current search/type arguments backward compatible, but the new UI will fetch an unfiltered snapshot and filter from cache.

- [ ] **Step 5: Write failing canonical mutation tests**

For create, rename, move, delete and Item move assert:

- exactly one `actor.setFlag(MODULE_ID, "inventoryFolders", nextState)` on a changed operation;
- zero writes for an idempotent result;
- the state is normalized immediately before reducer application;
- Actor and folder/Item are re-resolved inside the queued operation;
- stale cycle/depth requests fail without a write;
- delete promotes contents exactly as Task 1 defines;
- an Item move changes only the Actor flag and never calls `item.update()`;
- two deferred mutations for one Actor serialize, while a mutation for another Actor can proceed.

Use separate keys `inventory-folders:group-a` and `inventory-folders:group-b` in the coordinator fixture.

- [ ] **Step 6: Implement one shared private mutation path**

Add private helpers with these responsibilities:

    #readInventoryFolderState(actor)
      -> normalizeInventoryFolderState(
           actor.getFlag(MODULE_ID, "inventoryFolders"),
           { itemIds: actor.items.contents.map((item) => item.id) }
         )

    #writeInventoryFolderState(actor, nextState)
      -> actor.setFlag(MODULE_ID, "inventoryFolders", nextState)

    #mutateInventoryFolderState(groupActorId, operation)
      -> coordinator.run(actorKey, re-resolve + normalize + operation + one conditional write)

The public methods return serializable results:

    {
      actorId: "group-a",
      folderId: "weapons",
      changed: true,
      deletedFolderId: ""
    }

`deleteInventoryFolder()` sets `deletedFolderId` only when a folder actually existed. `moveInventoryItemToFolder()` returns `itemId` as well.

- [ ] **Step 7: Run service and pure tests**

Run:

    node --test tests/inventory-folder-tree.test.mjs tests/group-inventory-migration.test.mjs

Expected: PASS, including legacy/group migration tests and unchanged summary totals.

- [ ] **Step 8: Update passport section 7**

Record the changed `getInventoryActor`/`getInventorySnapshot` signatures, the five folder mutation methods, `assignInventoryGrantFolder` as an internal recovery bridge, Actor flag ownership, actor-scoped coordinator key and one-write invariant.

- [ ] **Step 9: Review, commit and push Task 2**

Run:

    git diff --check
    git diff --stat
    git diff -- scripts/data/inventory-service.js tests/group-inventory-migration.test.mjs docs/function-passport.md
    git add scripts/data/inventory-service.js tests/group-inventory-migration.test.mjs docs/function-passport.md
    git commit -m "feat: own party inventory folder state on group actors"
    git push -u origin lich_branch

---

### Task 3: Import, storage grant and recovery-safe folder targets

**Files:**

- Modify: `scripts/data/inventory-service.js`
- Modify: `scripts/data/storage-command-service.js`
- Modify: `scripts/main.js:3272-3310, 4768-4790`
- Modify: `tests/inventory-mutation-recovery.test.mjs`
- Modify: `tests/storage-socket.test.mjs`
- Modify: `tests/group-inventory-migration.test.mjs`
- Modify: `docs/function-passport.md:95-109`

**Interfaces:**

- Consumes: Task 2 `assignInventoryGrantFolder()` and folder-aware actor resolution.
- Produces: exact folder targets on Item import and party storage claim; journal checkpoints that never recreate an Item on retry.

- [ ] **Step 1: Write failing merge and import recovery regressions**

Add fixtures with an existing merge candidate in `folder-old` and requested `folder-new`:

    const result = await service.importDroppedItem(dropData, {
      groupActorId: "group-a",
      folderId: "folder-new"
    });

    assert.equal(result.actorId, "group-a");
    assert.equal(actor.getFlag(MODULE_ID, "inventoryFolders").itemFolderIds.existing, "folder-old");
    assert.equal(actor.createEmbeddedDocumentsCalls, 0);

Add a new-Item case where:

1. Item create succeeds.
2. First Actor flag write throws.
3. Retry uses the same mutation ID.
4. Retry finds the mutation-marked Item, writes membership once, and does not create a second Item.

Keep explicit tests that intact vs broken/damaged items do not merge and therefore the new damaged Item receives the requested folder independently.

- [ ] **Step 2: Run recovery tests and confirm red state**

Run:

    node --test tests/inventory-mutation-recovery.test.mjs tests/group-inventory-migration.test.mjs

Expected: FAIL because folder target is not carried through the existing receipt phases.

- [ ] **Step 3: Insert a durable folder-assignment checkpoint**

Freeze normalized `groupActorId` and nullable `folderId` into new grant/import journal records. Reject reuse of the same mutation ID with a different folder target.

For both `#executeInventoryGrantOnce()` and `#executeImportItemDocument()` use this phase order:

    prepared
      -> target-created
      -> folder-assigned
      -> source-debited     // import only
      -> committed

At `target-created`:

- when `targetReceipt.created === false`, advance to `folder-assigned` without writing folder state;
- when a new Item was created and `folderId === null`, advance without a flag write because absence means root;
- when a new Item was created with a folder target, call `assignInventoryGrantFolder()`, which queues on `inventory-folders:${groupActorId}`, re-resolves folder and Item, writes the Actor flag once, then checkpoint;
- if assignment fails, leave the created Item recoverable by its existing mutation marker and do not debit/delete the source;
- retry resumes from `target-created` and never repeats Item create.

Do not call the five player-facing command methods from recovery code; use the internal grant bridge so no socket or UI refresh is created inside the service.

- [ ] **Step 4: Extend exact import payload and direct API options**

Change `inventory.import` to exact keys:

    {
      inventoryActorId: "group-a",
      itemUuid: "Actor.character.Item.sword",
      mutationId: "inventory-import:stable",
      folderId: "folder-new"
    }

`folderId` is always present and is either a trimmed string or `null`. Update every existing request construction and test fixture to send `folderId: null` for root. `executeImportMutation()` passes the authoritative target into the journal path.

- [ ] **Step 5: Write failing exact storage-target tests**

For destination `party` require:

    target: {
      groupActorId: "group-a",
      folderId: "folder-new"
    }

Assert that `target: null`, an extra key, missing `groupActorId`, foreign group and unknown folder are rejected. For root, `folderId` remains an explicit `null`. Add one ordinary row and one portable-container root retry case.

- [ ] **Step 6: Propagate storage target without a second grant route**

Change `isValidStorageTarget("party", target)` to accept exactly `["folderId", "groupActorId"]`. In `StorageCommandService.claimRow()`:

- re-resolve the requested group via `inventoryService.getInventoryActor({ create: false, groupActorId })`;
- pass `{ allowPersistedItemData: true, groupActorId, folderId }` to `addLootgenRowToInventoryOnce()`;
- for a portable container, capture the root returned by existing `materializeToActorOnce()` and then call `assignInventoryGrantFolder({ groupActorId, itemId: root.id, folderId })` before the storage claim is committed;
- on retry, existing materialization returns the same root, then folder assignment completes idempotently.

`RebreyaMainModule.importInventoryDrop(dropData, { groupActorId, folderId })` passes this exact target to `claimStorageRow()` or to `InventoryService.importDroppedItem()`. It does not add a second socket event.

- [ ] **Step 7: Run recovery, storage and migration focused tests**

Run:

    node --test tests/inventory-mutation-recovery.test.mjs tests/storage-socket.test.mjs tests/group-inventory-migration.test.mjs

Expected: PASS with no duplicate Item/container, preserved merge folder, separate durability variants and exact storage payload authorization.

- [ ] **Step 8: Update passport section 7**

Document new optional options on `importDroppedItem` and `addLootgenRowToInventoryOnce`, the `folder-assigned` receipt phase, merge-folder preservation and storage party target flow. Keep `itemsCanMergeInInventory()` as the named canonical matcher.

- [ ] **Step 9: Review, commit and push Task 3**

Run:

    git diff --check
    git diff --stat
    git diff -- scripts/data/inventory-service.js scripts/data/storage-command-service.js scripts/main.js tests/inventory-mutation-recovery.test.mjs tests/storage-socket.test.mjs tests/group-inventory-migration.test.mjs docs/function-passport.md
    git add scripts/data/inventory-service.js scripts/data/storage-command-service.js scripts/main.js tests/inventory-mutation-recovery.test.mjs tests/storage-socket.test.mjs tests/group-inventory-migration.test.mjs docs/function-passport.md
    git commit -m "feat: recover folder-aware inventory grants"
    git push -u origin lich_branch

---

### Task 4: Five typed commands, authorization and personal User state API

**Files:**

- Modify: `scripts/data/inventory-service.js:35-45`
- Modify: `scripts/main.js:45-65, 640-746, 1398-1438, 1586-1630`
- Create: `tests/inventory-folder-socket.test.mjs`
- Modify: `docs/function-passport.md:95-109`

**Interfaces:**

- Consumes: Task 2 service mutations and existing `#canSenderManageGroup(sender, groupActorId)`.
- Produces: five exact commands and local User UI-state methods.

- [ ] **Step 1: Write a failing command-dispatch suite**

Base the fixture on `tests/group-command-dispatch.test.mjs`, but include two managed group Actors and folders. For each command, send one valid payload and variants with a missing key, extra key, untrimmed ID and wrong nullable field type.

The authorization matrix must assert:

    GM                                  -> allowed
    owner of a current member in group -> allowed
    user owning only another group     -> unauthorized
    unknown sender                     -> unknown-sender
    transport sender mismatch          -> sender-mismatch

Also queue a move request, mutate the Actor flag before the queued operation resumes, and assert the active GM rejects a newly formed cycle or sixth level from current state. Test create replay with identical data as success/no write and conflicting same ID as `command-failed`.

- [ ] **Step 2: Run the socket test and confirm red state**

Run:

    node --test tests/inventory-folder-socket.test.mjs

Expected: FAIL because command constants and registrations are absent.

- [ ] **Step 3: Export constants and add exact validators**

Export:

    INVENTORY_FOLDER_CREATE_COMMAND = "inventory.folder.create"
    INVENTORY_FOLDER_RENAME_COMMAND = "inventory.folder.rename"
    INVENTORY_FOLDER_MOVE_COMMAND = "inventory.folder.move"
    INVENTORY_FOLDER_DELETE_COMMAND = "inventory.folder.delete"
    INVENTORY_ITEM_FOLDER_MOVE_COMMAND = "inventory.item.folder.move"

Validators use the existing `hasExactKeys()`. IDs are trimmed non-empty strings no longer than 160 characters; name is already trimmed, length 1–80; `parentId` and `folderId` targets are trimmed strings or `null`.

- [ ] **Step 4: Register commands with existing authorization and refresh wrapper**

Each definition:

- authorizes with `#canSenderManageGroup(sender, payload.groupActorId)`;
- executes the matching `InventoryService` method;
- wraps execute in existing `runInventoryMutation()` so the active GM’s Actor hook and explicit result refresh coalesce;
- extracts `result.actorId` for `refreshInventoryViews({ actorIds: [result.actorId] })`.

Do not trust payload folder/Item existence during authorize; service re-resolves them after entering `inventory-folders:${payload.groupActorId}`.

- [ ] **Step 5: Add local module API wrappers**

Expose internal UI methods with the command payload signatures:

    createInventoryFolder(payload)
    renameInventoryFolder(payload)
    moveInventoryFolder(payload)
    deleteInventoryFolder(payload)
    moveInventoryItemToFolder(payload)

Non-active-GM clients call `socketCommandBus.request(command, exactPayload)`. The active GM uses the same service/`runInventoryMutation` execution path without weakening validation; build payload with the same helper and reject it locally if its exact validator fails.

- [ ] **Step 6: Write failing personal expansion tests**

In `tests/inventory-folder-socket.test.mjs` or a small section of `tests/inventory-app-context.test.mjs` assert:

- `getInventoryFolderUiState("group-a", ["a", "b"])` returns only existing IDs from the current User flag;
- `setInventoryFolderExpanded("group-a", "b", true)` re-reads the latest flag inside a user-scoped coordinator queue and merges with an expansion written by another open view;
- setting false removes only that ID;
- stale folder IDs are removed on the next successful User flag write;
- no Actor write, socket request or global setting write occurs.

- [ ] **Step 7: Implement personal User flag merge**

Add:

    getInventoryFolderUiState(groupActorId, folderIds = [])
      -> { version: 1, groupActorId, expandedFolderIds: [] }

    setInventoryFolderExpanded(groupActorId, folderId, expanded)
      -> Promise<{ version: 1, groupActorId, expandedFolderIds: [] }>

Use the existing coordinator with key `inventory-folder-ui:${game.user.id}`, re-read `game.user.getFlag(MODULE_ID, "inventoryFolderUi")` inside the queue, normalize against current folder IDs, merge one toggle and perform one `game.user.setFlag()`. This state is personal and never uses active GM or typed commands.

- [ ] **Step 8: Run socket/security focused tests**

Run:

    node --test tests/inventory-folder-socket.test.mjs tests/group-command-dispatch.test.mjs tests/world-mutation-infrastructure.test.mjs

Expected: PASS for command envelopes, unknown/mismatched senders, exact keys, group membership and stale authoritative validation.

- [ ] **Step 9: Update passport section 7**

List all five commands/payloads, authorization matrix, active-GM re-resolution, actor/user coordinator keys and personal flag method signatures.

- [ ] **Step 10: Review, commit and push Task 4**

Run:

    git diff --check
    git diff --stat
    git diff -- scripts/data/inventory-service.js scripts/main.js tests/inventory-folder-socket.test.mjs docs/function-passport.md
    git add scripts/data/inventory-service.js scripts/main.js tests/inventory-folder-socket.test.mjs docs/function-passport.md
    git commit -m "feat: route inventory folder mutations through active GM"
    git push -u origin lich_branch

---

### Task 5: InventoryApp cached tree context, search and personal expansion

**Files:**

- Modify: `scripts/ui/inventory-app.js:2520-2650, 3106-3180, 3778-4235, 6318-6360, 7036-7050`
- Modify: `tests/inventory-app-context.test.mjs`
- Modify: `docs/function-passport.md:95-109`

**Interfaces:**

- Consumes: Task 1 tree/index/projection and Task 4 User-state methods.
- Produces: `inventoryRows` render context, optimistic expansion and cached search fast-path shared by main/popout.

- [ ] **Step 1: Write failing context-shape tests**

Build one snapshot with root Items, two root folders, nested depth 5 and quantities greater than one. Assert:

- `inventoryRows` is folders-first/items-second at every level;
- folder row has `depth` and `recursiveItemCount`, while Item row keeps existing metrics;
- collapse hides descendants without changing `summary.distinctCount`, weight, value or quantity;
- two app instances can receive different User expansion state for the same shared snapshot;
- deleted expansion IDs do not appear in context;
- popout context is restricted to its subtree.

- [ ] **Step 2: Write the search performance regression before implementation**

Adapt the existing cached-search test to count all expensive operations:

    assert.equal(calls.getInventorySnapshot, 1);
    assert.equal(calls.getModel, 1);
    assert.equal(calls.socketRequest, 0);
    assert.equal(calls.setUserFlag, 0);

After three debounced search inputs, also assert `getInventorySnapshot` is still 1, search parents are temporarily open, stored `expandedFolderIds` is unchanged, a matching folder does not reveal unmatched descendants, and popout search never returns an outside Item.

- [ ] **Step 3: Run the UI context test and confirm red state**

Run:

    node --test tests/inventory-app-context.test.mjs

Expected: FAIL because current context is a flat Item list with no folder projection.

- [ ] **Step 4: Add stable view scope and replace the cache payload**

In the existing constructor, strip custom `groupActorId`, `rootFolderId` and `inventoryViewKey` before passing ApplicationV2 options to `super`. Store:

    this.groupActorId
    this.rootFolderId
    this.inventoryViewKey
    this.expandedFolderIds = new Set()
    this.inventorySnapshotCache = null
    this.inventoryFolderTreeCache = null
    this.inventorySearchIndexCache = null

On a full context load call `getInventorySnapshot({ createActor: false, groupActorId })` without search/type filtering, build tree/index once, read User expansion once, and retain summary/context inputs. On search/filter/sort-only rerender, call only `projectInventoryFolderRows()` with cached data.

After the full fetch, expose `inventoryActorId` from `inventorySnapshotCache.actor.id`, falling back to the explicit constructor `groupActorId`. This lets the main window follow the currently resolved group while a popout remains pinned to its explicit Actor.

- [ ] **Step 5: Keep Item sorting delegated and folders alphabetic**

Continue using `sortInventoryEntries()` as the Item comparator passed to `buildInventoryFolderTree()`. Folder sort remains `left.name.localeCompare(right.name, "ru")` regardless of Item sort mode. Return `inventoryRows`, `inventoryCount` equal to visible Item rows, and `emptyInventory` based on the current projection.

Expose `canOrganizeInventory` from the same current-group participation capability used by `canDropInventoryItems`. It gates folder controls only in the UI; typed-command authorization remains authoritative.

- [ ] **Step 6: Implement optimistic personal expansion**

Chevron click:

1. updates `this.expandedFolderIds` immediately;
2. marks the next render as cached projection only;
3. rerenders without snapshot fetch;
4. calls `moduleApi.setInventoryFolderExpanded(groupActorId, folderId, expanded)`;
5. on failure restores the previous Set, rerenders cached context and shows a localized notification.

Search-derived expansion is never copied into `this.expandedFolderIds` and never persisted.

- [ ] **Step 7: Add explicit snapshot invalidation**

Add:

    async refreshInventorySnapshot({ preserveScroll = true } = {})

It clears the three inventory caches, marks the next context as a full fetch and renders with `force: true`/`preserveScroll`. Search/filter/sort handlers do not call this method. `_preClose()` clears timers and caches.

- [ ] **Step 8: Run UI context, pure tree and search regressions**

Run:

    node --test tests/inventory-folder-tree.test.mjs tests/inventory-app-context.test.mjs

Expected: PASS, including no snapshot/catalog/socket/User write per search key and unchanged aggregate totals.

- [ ] **Step 9: Update passport section 7**

Document constructor scope fields, `refreshInventorySnapshot()`, cache lifetime, search projection flow and optimistic User expansion.

- [ ] **Step 10: Review, commit and push Task 5**

Run:

    git diff --check
    git diff --stat
    git diff -- scripts/ui/inventory-app.js tests/inventory-app-context.test.mjs docs/function-passport.md
    git add scripts/ui/inventory-app.js tests/inventory-app-context.test.mjs docs/function-passport.md
    git commit -m "feat: project cached inventory folder contexts"
    git push -u origin lich_branch

---

### Task 6: Folder toolbar, rows, dialogs, menus and fixed-column styling

**Files:**

- Modify: `scripts/ui/inventory-app.js:2760-2865, 3390-3520, 5807-6610`
- Modify: `templates/inventory-app.hbs:175-285`
- Modify: `styles/main.css:5805-6060, 9960-10330`
- Modify: `tests/inventory-app-context.test.mjs`
- Modify: `docs/function-passport.md:95-109`

**Interfaces:**

- Consumes: Task 4 module API mutations and Task 5 `inventoryRows`.
- Produces: accessible folder controls and visually stable tree rows; no DnD behavior yet.

- [ ] **Step 1: Write failing template/action tests**

Assert the rendered/source contract contains:

- one icon-only `data-action="create-inventory-folder"` button after sort, with tooltip/title and `aria-label="Создать папку"`;
- folder rows with `data-folder-id`, `data-depth="1"` through `"5"`, chevron, one folder icon, name, `N поз.` and menu button;
- no quantity/weight/price labels inside a folder row;
- Item row metrics remain in the same DOM grid regardless of depth;
- menu actions exactly “Создать вложенную папку”, “Переименовать”, “Открыть отдельно”, “Удалить”.

Assert folder controls are present for a GM or current-group participant and absent for a user outside that group.

- [ ] **Step 2: Write failing dialog and action tests**

Test create at root, create under selected folder, rename identity preservation and deletion confirmation text. The prompt trims and rejects empty or >80 characters before API call. Delete confirmation explicitly states that Items and child folders move one level up and are not deleted.

- [ ] **Step 3: Run focused UI tests and confirm red state**

Run:

    node --test tests/inventory-app-context.test.mjs

Expected: FAIL on missing folder controls and handlers.

- [ ] **Step 4: Implement one reusable name prompt and folder context menu**

Add `promptInventoryFolderName({ title, initialName = "", confirmLabel })` using existing DialogV2 conventions. Use current `#openContextMenu()` for folder actions; do not create a second menu system.

Generate create IDs on the initiating client with `globalThis.crypto.randomUUID()` and fail clearly if no stable ID can be generated. The same ID is reused if the same UI operation is retried.

- [ ] **Step 5: Replace the flat Item loop with one flat tree-row loop**

Render `inventoryRows` and branch on `kind`. The tree is already depth-first and sorted; Handlebars performs no recursion, sorting or Actor reads. A folder row spans the full list width. An Item row keeps the existing actions and metric cells.

Use exact context data:

    folder: { folderId, name, depth, recursiveItemCount, expanded, canCreateChild }
    item:   { itemId, folderId, depth, quantity, totalWeight, priceLabel }

- [ ] **Step 6: Add fixed-depth styles**

Use a shared row grid for Items and a full-width compact folder row. Apply indentation only to the leading icon/name region with explicit fixed selectors. Folder rows use their one-based folder depth:

    folder [data-depth="1"] -> 0px
    folder [data-depth="2"] -> 14px
    folder [data-depth="3"] -> 28px
    folder [data-depth="4"] -> 42px
    folder [data-depth="5"] -> 56px

Item rows use the number of ancestor folders, so a root Item stays at zero and an Item inside a depth-5 folder receives the fifth fixed step:

    item [data-depth="0"] -> 0px
    item [data-depth="1"] -> 14px
    item [data-depth="2"] -> 28px
    item [data-depth="3"] -> 42px
    item [data-depth="4"] -> 56px
    item [data-depth="5"] -> 70px

Do not use percentage indentation. Add hover, keyboard focus, selected, collapsed and drop-target-ready classes using existing module color variables. Keep folder height visibly below the current Item row and preserve responsive hiding of Item metric columns.

- [ ] **Step 7: Bind actions to exact payloads**

Main toolbar creates under `null`; popout toolbar creates under its `rootFolderId`. Context create uses that row’s ID. Rename/delete use stable IDs. After an expected command error, leave the app open, invalidate snapshot and show the service message.

- [ ] **Step 8: Run UI tests**

Run:

    node --test tests/inventory-app-context.test.mjs tests/inventory-header-motion.test.mjs

Expected: PASS for controls, accessible labels, fixed columns, dialogs, existing item actions and header regressions.

- [ ] **Step 9: Update passport section 7**

Record the name prompt, context actions and the invariant that template rows consume a precomputed projection and never write Actor state.

- [ ] **Step 10: Review, commit and push Task 6**

Run:

    git diff --check
    git diff --stat
    git diff -- scripts/ui/inventory-app.js templates/inventory-app.hbs styles/main.css tests/inventory-app-context.test.mjs docs/function-passport.md
    git add scripts/ui/inventory-app.js templates/inventory-app.hbs styles/main.css tests/inventory-app-context.test.mjs docs/function-passport.md
    git commit -m "feat: render party inventory folder controls"
    git push -u origin lich_branch

---

### Task 7: Internal/external drag-and-drop and root/folder targets

**Files:**

- Modify: `scripts/ui/inventory-app.js:5807-5860, 6548-6610`
- Modify: `templates/inventory-app.hbs:205-285`
- Modify: `styles/main.css:5860-5935`
- Modify: `tests/inventory-app-context.test.mjs`
- Modify: `tests/group-inventory-migration.test.mjs`
- Modify: `docs/function-passport.md:95-109`

**Interfaces:**

- Consumes: existing `buildPartyInventoryItemDragData(itemUuid)`, Task 3 `importInventoryDrop()` options, Task 4 move commands.
- Produces: one internal payload parser shared by main and popout, with server authority unchanged.

- [ ] **Step 1: Write failing pure payload and target tests**

Use exact internal data:

    folder drag:
    {
      type: "RebreyaInventoryFolder",
      rebreyaInventory: {
        version: 1,
        kind: "folder",
        groupActorId: "group-a",
        folderId: "weapons"
      }
    }

    Item drag extension:
    flags["rebreya-main"].inventoryFolderDrag = {
      version: 1,
      kind: "item",
      groupActorId: "group-a",
      itemId: "sword"
    }

Assert parser rejection for extra/missing fields, cross-group payloads, folder-on-self and folder-on-descendant. Root target is explicit `folderId: null`.

- [ ] **Step 2: Write failing DOM DnD tests**

Cover:

- Item and folder dragstart serialize to all currently supported MIME types;
- valid dragover prevents default and adds a whole-row drop class;
- invalid target does neither;
- drop on folder calls the matching move API with that folder;
- drop on the free/root surface sends `folderId: null`;
- external Foundry Item drop calls `importInventoryDrop(dragData, { groupActorId, folderId })`;
- main and popout use identical payload and target resolution;
- Item quantity/update/delete methods are untouched by internal reorganization.

- [ ] **Step 3: Run focused UI/service tests and confirm red state**

Run:

    node --test tests/inventory-app-context.test.mjs tests/group-inventory-migration.test.mjs

Expected: FAIL on missing internal payload and folder target handling.

- [ ] **Step 4: Implement payload helpers in InventoryApp module**

Export testable pure helpers:

    buildInventoryFolderDragData({ groupActorId, folderId })
    extendInventoryItemDragData(basePayload, { groupActorId, itemId })
    readInventoryTreeDragData(dragData)

Item drag starts from existing `buildPartyInventoryItemDragData()` so character-sheet transfer/recovery behavior remains intact; only add the organizational metadata flag.

- [ ] **Step 5: Bind one delegated drop handler**

Resolve target from closest `[data-folder-drop-id]` or the root surface. For internal payload:

- require same `groupActorId` client-side;
- call `moveInventoryFolder()` or `moveInventoryItemToFolder()`;
- treat client checks as visual guidance only; active GM service repeats all checks.

For external `type: "Item"` without valid internal metadata, call the existing import route with target options. Drop never supplies sibling position.

- [ ] **Step 6: Add drop-state styling and cleanup**

Highlight the entire folder row, clear classes on dragleave/drop/error, and use the existing root-surface state for move-to-root. Ensure listener AbortController cleanup still removes all DnD listeners on rerender/close.

- [ ] **Step 7: Add the whole-stack regression**

In service/UI focused tests assert an internal Item move performs one Actor flag write with the same Item ID and no call to `item.update()`, `item.delete()` or `createEmbeddedDocuments()`; quantity remains unchanged.

- [ ] **Step 8: Run DnD and import regressions**

Run:

    node --test tests/inventory-app-context.test.mjs tests/group-inventory-migration.test.mjs tests/inventory-mutation-recovery.test.mjs tests/inventory-sync-hooks.test.mjs

Expected: PASS for root/folder targets, main↔popout payload compatibility, whole-stack movement and existing character-sheet transfer hooks.

- [ ] **Step 9: Update passport section 7**

Record payload shapes, root semantics, external import target flow and the rule that drag data is never authoritative.

- [ ] **Step 10: Review, commit and push Task 7**

Run:

    git diff --check
    git diff --stat
    git diff -- scripts/ui/inventory-app.js templates/inventory-app.hbs styles/main.css tests/inventory-app-context.test.mjs tests/group-inventory-migration.test.mjs docs/function-passport.md
    git add scripts/ui/inventory-app.js templates/inventory-app.hbs styles/main.css tests/inventory-app-context.test.mjs tests/group-inventory-migration.test.mjs docs/function-passport.md
    git commit -m "feat: move inventory folders and stacks by drag"
    git push -u origin lich_branch

---

### Task 8: Live folder popouts and actor-scoped refresh coalescence

**Files:**

- Modify: `scripts/main.js:1038-1048, 1327-1338, 5385-5465, 5696-5720`
- Modify: `scripts/integrations/inventory-sync.js:385-490`
- Modify: `scripts/ui/inventory-app.js:3106-3180, 3778-4235, 7036-7050`
- Modify: `tests/inventory-app-context.test.mjs`
- Modify: `tests/inventory-sync-hooks.test.mjs`
- Modify: `tests/ui-refresh-coordinator.test.mjs`
- Modify: `docs/function-passport.md:95-109, 279-295`

**Interfaces:**

- Consumes: Task 5 `refreshInventorySnapshot()` and Task 6 “Открыть отдельно” action.
- Produces: one `inventoryFolderApps` registry and one actor-scoped refresh route for main/popout/sheets.

- [ ] **Step 1: Write failing popout lifecycle tests**

Assert:

- `openInventoryFolderPopout("group-a", "weapons")` reuses the same app/key on repeat;
- another folder gets a distinct app;
- title is the current folder name from the latest snapshot;
- rename refresh updates title without changing app ID;
- moving the root folder keeps the popout open;
- deleting root closes only `group-a:weapons` with a localized notification;
- closing manually unregisters only that instance;
- no User flag stores open popouts and reload does not recreate them.

- [ ] **Step 2: Write failing refresh selection tests**

Open main view for group A, two group-A popouts and one group-B popout. Call:

    await moduleApi.refreshInventoryViews({ actorIds: ["group-a"] });

Assert only group-A views call `refreshInventorySnapshot({ preserveScroll: true })`, minimized/closed views are skipped, no view is focused, and actor sheets remain scoped through the existing helper.

- [ ] **Step 3: Write failing hook coalescence tests**

Update the existing hook fixture so `updateActor(actor, changes)` and Item hooks pass Actor IDs. Assert:

- a folder flag Actor update schedules `refreshInventoryViews({ actorIds: ["group-a"] })`;
- concurrent folder/item updates for one Actor coalesce to one refresh;
- IDs for two Actors are unioned;
- no new Hook name is registered;
- on the active GM, `runInventoryMutation` hold plus updateActor and explicit completion still flush once.

- [ ] **Step 4: Run the three focused suites and confirm red state**

Run:

    node --test tests/inventory-app-context.test.mjs tests/inventory-sync-hooks.test.mjs tests/ui-refresh-coordinator.test.mjs

Expected: FAIL on missing popout registry and unscoped current refresh.

- [ ] **Step 5: Add the composition-owned popout registry**

Initialize `this.inventoryFolderApps = new Map()` beside `inventoryApp`. Add:

    openInventoryFolderPopout(groupActorId, folderId)
    unregisterInventoryFolderPopout(inventoryViewKey, app)

Validate folder existence from one snapshot before first open, construct `InventoryApp` with stable scope options, render and bring only an explicitly opened popout to front. `_onClose()` unregisters itself with identity comparison so a stale close cannot remove a replacement.

- [ ] **Step 6: Make dynamic title and missing-root close part of InventoryApp**

During full context:

- set `this.options.window.title` from the current root folder name;
- if `rootFolderMissing` is true, schedule one close, notify that contents were moved one level up, and return an empty safe context;
- main view never closes for a missing root because its `rootFolderId` is `null`.

No per-popout document hooks are added.

- [ ] **Step 7: Extend the existing refresh flush**

In `#flushInventoryViews()` build tasks from `this.inventoryApp` plus `this.inventoryFolderApps.values()`. Filter by each view’s resolved group Actor ID when `actorIds` is non-empty and call `refreshInventorySnapshot()` through `UiRefreshCoordinator`. Keep `refreshInventoryViews({ actorIds })` as the only external entrypoint.

Use the Task 5 `inventoryActorId` getter for the main view and the explicit `groupActorId` fallback for a popout whose first snapshot has not loaded yet.

- [ ] **Step 8: Scope and coalesce existing inventory-sync hooks**

Replace the single pending timeout payload with a Set of pending Actor IDs. Existing `createItem`, `updateItem`, `deleteItem` and `updateActor` handlers add the affected Actor ID and call the same `scheduleInventoryRefresh`. The folder flag update is not given a separate hook or route; active-GM explicit refresh is coalesced by the existing hold/settle mechanism.

- [ ] **Step 9: Run popout/refresh focused tests**

Run:

    node --test tests/inventory-app-context.test.mjs tests/inventory-sync-hooks.test.mjs tests/ui-refresh-coordinator.test.mjs tests/background-refresh-focus.test.mjs

Expected: PASS with actor-scoped live refresh, no focus stealing, stable titles and selective missing-root close.

- [ ] **Step 10: Update passport sections 7 and 19**

Section 7 records popout key/lifecycle and same-Actor snapshot flow. Section 19 updates the existing `refreshInventoryViews({ actorIds })` description to include main plus registered inventory-folder popouts without claiming a new refresh entrypoint.

- [ ] **Step 11: Review, commit and push Task 8**

Run:

    git diff --check
    git diff --stat
    git diff -- scripts/main.js scripts/integrations/inventory-sync.js scripts/ui/inventory-app.js tests/inventory-app-context.test.mjs tests/inventory-sync-hooks.test.mjs tests/ui-refresh-coordinator.test.mjs docs/function-passport.md
    git add scripts/main.js scripts/integrations/inventory-sync.js scripts/ui/inventory-app.js tests/inventory-app-context.test.mjs tests/inventory-sync-hooks.test.mjs tests/ui-refresh-coordinator.test.mjs docs/function-passport.md
    git commit -m "feat: keep inventory folder popouts live"
    git push -u origin lich_branch

---

### Task 9: Cross-layer regression audit, full verification and Foundry acceptance

**Files:**

- Modify only if an audit finds an omission: files already listed in Tasks 1–8.
- Modify: `docs/function-passport.md:95-109` only for contract corrections found by the audit.
- Do not modify: `README.md`, catalogs, `module.json`, `scripts/main-1.4.155.js` or Item data definitions.

**Interfaces:**

- Consumes: all prior task commits.
- Produces: verified feature with no open contract/documentation gap.

- [ ] **Step 1: Run the focused feature set once on unchanged HEAD**

Run:

    node --test tests/inventory-folder-tree.test.mjs tests/group-inventory-migration.test.mjs tests/inventory-mutation-recovery.test.mjs tests/inventory-folder-socket.test.mjs tests/storage-socket.test.mjs tests/inventory-app-context.test.mjs tests/inventory-sync-hooks.test.mjs tests/ui-refresh-coordinator.test.mjs tests/background-refresh-focus.test.mjs

Expected: all tests pass. Record passed/failed counts and only real error output.

- [ ] **Step 2: Audit the approved invariants from repository diff**

Run:

    git diff origin/main...HEAD -- scripts/data/inventory-folder-tree.js scripts/data/inventory-service.js scripts/data/storage-command-service.js scripts/main.js scripts/integrations/inventory-sync.js scripts/ui/inventory-app.js templates/inventory-app.hbs styles/main.css docs/function-passport.md
    rg -n "inventoryFolders|inventoryFolderUi|inventory\.folder|inventory\.item\.folder|refreshInventoryViews" scripts docs/function-passport.md
    rg -n "setFlag|update\(" scripts/ui/inventory-app.js

Confirm:

- exactly one shared Actor flag owner;
- UI has no direct shared Actor write;
- five shared mutations are the only new command routes;
- no second refresh method/hook/resolver/coordinator was introduced;
- no Item gameplay field is written for organization;
- merge matcher and durability signature were not weakened;
- `README.md` and catalogs are unchanged.

- [ ] **Step 3: Re-read spec coverage against focused tests**

Map every section 6–20 requirement to a test or Foundry acceptance row. In particular verify damaged merge separation, target-after-create recovery, type-filter folder visibility, search breadcrumbs, personal state isolation, root drop, same-Actor popout refresh and delete promotion.

- [ ] **Step 4: Run the complete repository verification once**

Run in PowerShell:

    node --test tests/*.test.mjs
    git diff --check

    $files = git ls-files '*.js' '*.mjs'
    foreach ($file in $files) { node --check $file }

    $json = git ls-files '*.json'
    foreach ($file in $json) {
      Get-Content -Raw -Encoding UTF8 $file | ConvertFrom-Json | Out-Null
    }

Expected: zero failed tests, zero syntax errors, zero invalid tracked JSON files and no whitespace errors. Do not rerun the full suite unless HEAD changes afterward.

- [ ] **Step 5: Perform the Foundry VTT 13 acceptance matrix**

With one active GM and two players in the same group:

- create/rename/move/delete is visible in all open main/popout views;
- each player has independent expansion restored after reload;
- main↔popout Item/folder DnD works in both directions;
- root drop returns Item/folder to root;
- cycle and sixth-level attempts show localized errors and preserve state;
- delete preserves all contents, promotes one level and closes only the deleted folder popout;
- Item metric columns remain aligned at depths 1–5;
- collapse/filter/search do not change total count, weight or value;
- rapid search input causes no Actor/User writes, sockets, catalog rebuilds or visible lag;
- external Item/storage drop to folder creates membership only for a new Item;
- merge into an existing stack preserves its old folder and damaged variants remain separate.

- [ ] **Step 6: Final passport audit**

Confirm section 7 contains exact signatures, five commands, both flags, actor/user data flow, recovery phase, popout lifecycle, search cache, DnD trust boundary and all focused test filenames. Remove any description of superseded signatures so the passport describes current state rather than history.

- [ ] **Step 7: Review final task diff**

Run:

    git status --short --branch
    git diff --check
    git diff --stat
    git diff

If Task 9 required no corrections, do not create an empty commit. If it required corrections, stage only those files, create a focused commit, rerun affected focused tests plus the full verification because HEAD changed, then push:

    git add scripts/data/inventory-folder-tree.js scripts/data/inventory-service.js scripts/data/storage-command-service.js scripts/main.js scripts/integrations/inventory-sync.js scripts/ui/inventory-app.js templates/inventory-app.hbs styles/main.css tests/inventory-folder-tree.test.mjs tests/group-inventory-migration.test.mjs tests/inventory-mutation-recovery.test.mjs tests/inventory-folder-socket.test.mjs tests/storage-socket.test.mjs tests/inventory-app-context.test.mjs tests/inventory-sync-hooks.test.mjs tests/ui-refresh-coordinator.test.mjs docs/function-passport.md
    git commit -m "test: close inventory folder regression gaps"
    git push -u origin lich_branch

## Completion criteria

- All folder operations work for GM and each member of the target group through authoritative active-GM routing.
- Every embedded Item is root or has exactly one valid folder membership; no Item gameplay field changes.
- Tree depth is at most five and no cycle can be persisted, including stale concurrent moves.
- Shared Actor state and personal User expansion are isolated and normalized safely.
- Delete never deletes contents; it promotes direct contents one level.
- Existing merge stack keeps its folder; a new Item gets target only after successful create; retry does not duplicate.
- Main and popout views share the same snapshot owner, DnD payload and scoped refresh route.
- Search/filter uses one cached snapshot/index per full refresh and performs no per-keystroke persistence, socket or catalog work.
- `docs/function-passport.md` section 7 matches final methods, commands, data flow, constraints and tests.
- Focused tests, full `node --test` suite, JS/MJS syntax checks, JSON parsing and `git diff --check` pass on final HEAD.
