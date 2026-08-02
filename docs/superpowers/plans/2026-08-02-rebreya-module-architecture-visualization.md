# Rebreya Module Architecture Visualization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Generate one self-contained, left-to-right HTML architecture diagram containing every tracked module file with hierarchy-aware sizing and inspectable real relationships.

**Architecture:** A repository scanner builds a deterministic graph from `git ls-files`, JavaScript imports, manifest entrypoints, template/resource references, known Foundry lifecycle locations, and directory containment. A separate renderer embeds that graph into an offline HTML document whose HTML node layer and SVG edge layer share pan/zoom transforms. A small CLI composes both units and writes the final snapshot.

**Tech Stack:** Node.js ESM, built-in `node:test`, built-in filesystem/child-process modules, standalone HTML/CSS/JavaScript, SVG connectors, no external dependencies.

## Global Constraints

- Deliverable path is exactly `docs/rebreya-module-architecture.html`.
- Include every path returned by `git ls-files`, except `docs/rebreya-module-architecture.html` itself.
- All content is expanded on load; interactions may emphasize but never hide nodes.
- Layout flows left to right and is deterministic.
- One self-contained HTML file; no network requests, CDN libraries, Foundry runtime, or local server dependency.
- Major blocks are visibly larger than subsystem owners, and subsystem owners are larger than file leaves.
- Binary contents are never embedded; binary nodes contain path, size, and type metadata only.
- Record the source commit and UTC generation timestamp in the generated snapshot.
- Do not modify runtime behavior or add a Foundry entrypoint.

---

## File Structure

- Create `tools/architecture-map/graph-builder.mjs`: repository snapshot collection, path classification, relationship extraction, graph validation, and deterministic ranks/domains.
- Create `tools/architecture-map/html-renderer.mjs`: standalone HTML serialization, layout, visual styling, pan/zoom, search, selection, minimap, legend, and accessibility behavior.
- Create `tools/generate-architecture-map.mjs`: CLI entrypoint that collects the snapshot, builds the graph, renders HTML, and writes the deliverable.
- Create `tests/architecture-map-generator.test.mjs`: unit and repository-level coverage for completeness, relationships, determinism, escaping, and the offline interaction contract.
- Create `docs/rebreya-module-architecture.html`: generated architecture snapshot.

### Task 1: Deterministic architecture graph builder

**Files:**
- Create: `tools/architecture-map/graph-builder.mjs`
- Create: `tests/architecture-map-generator.test.mjs`

**Interfaces:**
- Produces: `classifyPath(path: string): { domain: string, kind: string, rank: number }`.
- Produces: `buildArchitectureGraph({ files, contents, sourceCommit, generatedAt }): ArchitectureGraph`.
- Produces: `validateArchitectureGraph(graph): { valid: boolean, errors: string[] }`.
- Produces: `collectRepositorySnapshot({ repoRoot, excludedPaths }): Promise<{ files, contents, sourceCommit }>`.
- `ArchitectureGraph` is `{ meta, domains, nodes, edges }`; node IDs use `file:<repo-relative-path>` for files and `concept:<name>` for architectural concepts.

- [ ] **Step 1: Write failing classification and relationship tests**

Add tests that prove stable hierarchy and actual relationships:

```js
import test from "node:test";
import assert from "node:assert/strict";
import {
  buildArchitectureGraph,
  classifyPath,
  validateArchitectureGraph
} from "../tools/architecture-map/graph-builder.mjs";

test("architecture paths receive deterministic domains, kinds, and ranks", () => {
  assert.deepEqual(classifyPath("module.json"), { domain: "entrypoints", kind: "manifest", rank: 0 });
  assert.deepEqual(classifyPath("scripts/main.js"), { domain: "composition", kind: "composition", rank: 1 });
  assert.deepEqual(classifyPath("scripts/data/inventory-service.js"), { domain: "data", kind: "source", rank: 4 });
  assert.deepEqual(classifyPath("templates/inventory-app.hbs"), { domain: "templates", kind: "template", rank: 5 });
  assert.deepEqual(classifyPath("assets/ui/trader-cutout.png"), { domain: "assets", kind: "asset", rank: 5 });
});

test("graph extracts manifest, import, template, and containment relationships", () => {
  const files = [
    { path: "module.json", size: 100 },
    { path: "scripts/main.js", size: 200 },
    { path: "scripts/ui/inventory-app.js", size: 300 },
    { path: "templates/inventory-app.hbs", size: 400 }
  ];
  const contents = new Map([
    ["module.json", JSON.stringify({ esmodules: ["scripts/main.js"] })],
    ["scripts/main.js", 'import { InventoryApp } from "./ui/inventory-app.js";\nHooks.once("ready", () => {});'],
    ["scripts/ui/inventory-app.js", 'static PARTS = { main: { template: "modules/rebreya-main/templates/inventory-app.hbs" } };'],
    ["templates/inventory-app.hbs", "<section>Inventory</section>"]
  ]);
  const graph = buildArchitectureGraph({ files, contents, sourceCommit: "abc123", generatedAt: "2026-08-02T00:00:00.000Z" });
  const relationships = graph.edges.map(({ source, target, kind }) => `${source}|${target}|${kind}`);
  assert.ok(relationships.includes("file:module.json|file:scripts/main.js|entrypoint"));
  assert.ok(relationships.includes("file:scripts/main.js|file:scripts/ui/inventory-app.js|import"));
  assert.ok(relationships.includes("file:scripts/ui/inventory-app.js|file:templates/inventory-app.hbs|template"));
  assert.equal(validateArchitectureGraph(graph).valid, true);
});
```

- [ ] **Step 2: Run the focused test and verify failure**

Run: `node --test tests/architecture-map-generator.test.mjs`

Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `tools/architecture-map/graph-builder.mjs`.

- [ ] **Step 3: Implement classification, graph construction, and validation**

Implement explicit exports and stable ordering. Use this relationship vocabulary:

```js
export const EDGE_KINDS = Object.freeze([
  "entrypoint",
  "lifecycle",
  "constructs",
  "import",
  "template",
  "resource",
  "test",
  "contains"
]);

export function validateArchitectureGraph(graph) {
  const errors = [];
  const ids = new Set();
  for (const node of graph.nodes ?? []) {
    if (ids.has(node.id)) errors.push(`duplicate node: ${node.id}`);
    ids.add(node.id);
  }
  for (const edge of graph.edges ?? []) {
    if (!ids.has(edge.source)) errors.push(`missing edge source: ${edge.source}`);
    if (!ids.has(edge.target)) errors.push(`missing edge target: ${edge.target}`);
    if (!EDGE_KINDS.includes(edge.kind)) errors.push(`unknown edge kind: ${edge.kind}`);
  }
  return { valid: errors.length === 0, errors };
}
```

Normalize paths to `/`, strip import query strings, resolve relative imports against the importing file, and deduplicate edges by `source|target|kind`. Parse only text extensions: `.js`, `.mjs`, `.json`, `.hbs`, `.css`, `.md`, `.txt`, `.ps1`, `.py`, `.svg`, and `.html`. Add concept nodes for `Foundry init`, `Foundry setup`, `Foundry ready`, `RebreyaMainModule`, `Public API`, and `Socket dispatch`, with lifecycle/construction edges anchored to `scripts/main.js`.

For text files, record line count from normalized line breaks. For binary files, record byte size without reading their contents as text. Assign concise responsibility descriptions to known owners from the current README map; use the repository-relative path as the neutral description for unrecognized leaves.

- [ ] **Step 4: Add repository snapshot and completeness tests**

```js
test("repository snapshot gives every tracked file exactly one file node", async () => {
  const repoRoot = fileURLToPath(new URL("..", import.meta.url));
  const snapshot = await collectRepositorySnapshot({
    repoRoot,
    excludedPaths: new Set(["docs/rebreya-module-architecture.html"])
  });
  const graph = buildArchitectureGraph({
    ...snapshot,
    generatedAt: "2026-08-02T00:00:00.000Z"
  });
  const filePaths = graph.nodes.filter((node) => node.type === "file").map((node) => node.path);
  assert.equal(filePaths.length, snapshot.files.length);
  assert.deepEqual(filePaths.toSorted(), snapshot.files.map((file) => file.path).toSorted());
  assert.equal(new Set(filePaths).size, filePaths.length);
});
```

Use `execFile("git", ["ls-files", "-z"])` and `execFile("git", ["rev-parse", "HEAD"])`; never parse human-formatted Git output.

- [ ] **Step 5: Run focused tests and commit**

Run: `node --test tests/architecture-map-generator.test.mjs`

Expected: all graph-builder tests PASS.

Commit:

```powershell
git add tools/architecture-map/graph-builder.mjs tests/architecture-map-generator.test.mjs
git commit -m "feat: build complete module architecture graph"
```

### Task 2: Offline HTML renderer and interaction contract

**Files:**
- Create: `tools/architecture-map/html-renderer.mjs`
- Modify: `tests/architecture-map-generator.test.mjs`

**Interfaces:**
- Consumes: `ArchitectureGraph` from `buildArchitectureGraph`.
- Produces: `renderArchitectureHtml(graph: ArchitectureGraph): string`.
- Produces: a full HTML document containing `window.__REBREYA_ARCHITECTURE__` and no external resource URLs.

- [ ] **Step 1: Write failing renderer contract tests**

```js
import { renderArchitectureHtml } from "../tools/architecture-map/html-renderer.mjs";

test("renderer emits an offline document with all required controls", () => {
  const graph = buildArchitectureGraph({
    files: [{ path: "module.json", size: 10 }],
    contents: new Map([["module.json", "{}"]]),
    sourceCommit: "abc123",
    generatedAt: "2026-08-02T00:00:00.000Z"
  });
  const html = renderArchitectureHtml(graph);
  assert.match(html, /<!doctype html>/iu);
  assert.match(html, /id="architecture-search"/u);
  assert.match(html, /id="fit-graph"/u);
  assert.match(html, /id="architecture-minimap"/u);
  assert.match(html, /window\.__REBREYA_ARCHITECTURE__/u);
  assert.doesNotMatch(html, /<script[^>]+src=/iu);
  assert.doesNotMatch(html, /<link[^>]+href=/iu);
  assert.doesNotMatch(html, /fetch\s*\(/u);
});
```

- [ ] **Step 2: Run the renderer test and verify failure**

Run: `node --test tests/architecture-map-generator.test.mjs`

Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `tools/architecture-map/html-renderer.mjs`.

- [ ] **Step 3: Implement deterministic left-to-right layout and visual hierarchy**

Render domain bands and nodes into an absolute-positioned layer, and edges into one SVG. Use rank sizes equivalent to:

```js
const NODE_SIZES = Object.freeze({
  0: { width: 300, height: 88 },
  1: { width: 340, height: 104 },
  2: { width: 270, height: 76 },
  3: { width: 230, height: 62 },
  4: { width: 190, height: 48 },
  5: { width: 160, height: 38 }
});
```

Order columns by rank and nodes by domain, descending connection degree, then path. Route connectors with cubic Bézier paths from the right midpoint of the source to the left midpoint of the target. Visually distinguish primary edges (`entrypoint`, `lifecycle`, `constructs`, `import`) from quiet structural edges (`resource`, `test`, `contains`).

- [ ] **Step 4: Implement view-only interaction and accessibility**

Implement one transform state `{ x, y, scale }`, with scale clamped to `0.06..2.5`. Apply it identically to the SVG world group and HTML node world. Add:

- pointer-drag panning on empty canvas;
- wheel zoom centered on pointer coordinates;
- `fitGraph()` calculating scale and offsets from graph bounds;
- search over lowercase `label`, `path`, and `description`;
- node click/Enter selection that adds emphasis classes to adjacent nodes/edges and dims unrelated ones without changing display or visibility;
- Escape to clear selection;
- a minimap viewport rectangle updated after every transform;
- visible focus styling and ARIA labels for controls and nodes;
- reduced-motion handling.

Escape embedded JSON so `</script>` in repository text cannot terminate the data script:

```js
function serializeForInlineScript(value) {
  return JSON.stringify(value)
    .replace(/</gu, "\\u003c")
    .replace(/>/gu, "\\u003e")
    .replace(/&/gu, "\\u0026")
    .replace(/\u2028/gu, "\\u2028")
    .replace(/\u2029/gu, "\\u2029");
}
```

- [ ] **Step 5: Run renderer tests and commit**

Run: `node --test tests/architecture-map-generator.test.mjs`

Expected: all graph and renderer tests PASS.

Commit:

```powershell
git add tools/architecture-map/html-renderer.mjs tests/architecture-map-generator.test.mjs
git commit -m "feat: render interactive architecture diagram"
```

### Task 3: Generator CLI and complete HTML snapshot

**Files:**
- Create: `tools/generate-architecture-map.mjs`
- Modify: `tests/architecture-map-generator.test.mjs`
- Create: `docs/rebreya-module-architecture.html`

**Interfaces:**
- Consumes: `collectRepositorySnapshot`, `buildArchitectureGraph`, `validateArchitectureGraph`, and `renderArchitectureHtml`.
- Produces: `node tools/generate-architecture-map.mjs [outputPath]` with default output `docs/rebreya-module-architecture.html`.

- [ ] **Step 1: Write a failing CLI integration test**

Create a temporary output path, execute the CLI, read the HTML, and extract the embedded graph JSON:

```js
test("generator CLI writes a complete current-repository snapshot", async () => {
  const outputPath = join(tmpdir(), `rebreya-architecture-${process.pid}.html`);
  await execFileAsync(process.execPath, ["tools/generate-architecture-map.mjs", outputPath], { cwd: repoRoot });
  const html = await readFile(outputPath, "utf8");
  const match = html.match(/window\.__REBREYA_ARCHITECTURE__\s*=\s*(\{.*?\});\s*<\/script>/su);
  assert.ok(match);
  const graph = JSON.parse(match[1]);
  const tracked = (await execFileAsync("git", ["ls-files", "-z"], { cwd: repoRoot })).stdout
    .split("\0")
    .filter((path) => path && path !== "docs/rebreya-module-architecture.html");
  assert.equal(graph.nodes.filter((node) => node.type === "file").length, tracked.length);
  await rm(outputPath, { force: true });
});
```

- [ ] **Step 2: Run the CLI test and verify failure**

Run: `node --test tests/architecture-map-generator.test.mjs`

Expected: FAIL because `tools/generate-architecture-map.mjs` does not exist.

- [ ] **Step 3: Implement the CLI**

The CLI must resolve the repository root from its own location, exclude the final HTML path, validate before writing, create the destination directory, and fail with a non-zero exit code when validation fails:

```js
const snapshot = await collectRepositorySnapshot({
  repoRoot,
  excludedPaths: new Set([relative(repoRoot, outputPath).replaceAll("\\", "/")])
});
const graph = buildArchitectureGraph({
  ...snapshot,
  generatedAt: new Date().toISOString()
});
const validation = validateArchitectureGraph(graph);
if (!validation.valid) throw new Error(validation.errors.join("\n"));
await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, renderArchitectureHtml(graph), "utf8");
```

- [ ] **Step 4: Generate the checked-in deliverable and verify metadata**

Run:

```powershell
node tools/generate-architecture-map.mjs
Get-Item docs/rebreya-module-architecture.html | Select-Object FullName,Length
Select-String -Path docs/rebreya-module-architecture.html -Pattern 'sourceCommit|generatedAt|architecture-search|architecture-minimap'
```

Expected: the HTML exists, is non-empty, contains the current commit, and includes all four metadata/control markers.

- [ ] **Step 5: Run focused tests and commit**

Run: `node --test tests/architecture-map-generator.test.mjs`

Expected: all tests PASS, including tracked-file completeness.

Commit:

```powershell
git add tools/generate-architecture-map.mjs tests/architecture-map-generator.test.mjs docs/rebreya-module-architecture.html
git commit -m "docs: generate full module architecture map"
```

### Task 4: Browser validation and repository checks

**Files:**
- Modify if validation finds defects: `tools/architecture-map/html-renderer.mjs`
- Modify if graph coverage finds defects: `tools/architecture-map/graph-builder.mjs`
- Regenerate after any fix: `docs/rebreya-module-architecture.html`
- Modify tests with any regression case: `tests/architecture-map-generator.test.mjs`

**Interfaces:**
- Consumes: final generated HTML.
- Produces: verified browser behavior and a clean, pushed `lich_branch`.

- [ ] **Step 1: Run syntax, focused, and full repository checks**

Run:

```powershell
git diff --check
node --check tools/architecture-map/graph-builder.mjs
node --check tools/architecture-map/html-renderer.mjs
node --check tools/generate-architecture-map.mjs
node --test tests/architecture-map-generator.test.mjs
node --test tests/*.test.mjs
```

Expected: every command exits zero.

- [ ] **Step 2: Open the HTML and inspect the initial overview**

Open `docs/rebreya-module-architecture.html` in Chromium. Confirm the initial view fits the complete left-to-right graph, major nodes are visibly dominant, all domain bands are present, there are no blank or overlapping control surfaces, and the browser console has no errors.

- [ ] **Step 3: Exercise interactions**

Verify:

- wheel zoom stays centered under the pointer;
- canvas drag pans smoothly;
- search for `inventory-service.js`, `RebreyaMainModule`, `SocketCommandBus`, and `inventory-app.hbs` finds and centers the expected nodes;
- clicking `RebreyaMainModule` emphasizes its adjacent services and edges without hiding unrelated nodes;
- Escape clears emphasis;
- fit returns to the complete graph;
- minimap viewport follows pan and zoom;
- Tab and Enter can reach and select controls and nodes.

- [ ] **Step 4: Verify representative architecture paths and completeness**

Inspect these paths in the rendered diagram:

```text
module.json -> scripts/main.js -> Foundry ready -> RebreyaMainModule
RebreyaMainModule -> InventoryService -> inventory-app.js -> inventory-app.hbs
RebreyaMainModule -> SocketCommandBus -> active GM mutation paths
RebreyaMainModule -> combat hooks -> automation services
managed compendium services -> data JSON and world compendium responsibilities
tests -> imported source modules
asset directories -> individual asset leaf nodes
```

Regenerate and rerun the focused test after any correction.

- [ ] **Step 5: Commit validation fixes if needed and push**

If validation required changes:

```powershell
git add tools/architecture-map tests/architecture-map-generator.test.mjs docs/rebreya-module-architecture.html
git commit -m "fix: validate module architecture visualization"
```

Then run:

```powershell
git status --short --branch
git push origin lich_branch
```

Expected: clean `lich_branch` tracking `origin/lich_branch`, with no force push.
