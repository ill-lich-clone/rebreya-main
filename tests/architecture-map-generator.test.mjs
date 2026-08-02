import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import {
  buildArchitectureGraph,
  classifyPath,
  collectRepositorySnapshot,
  validateArchitectureGraph
} from "../tools/architecture-map/graph-builder.mjs";
import { renderArchitectureHtml } from "../tools/architecture-map/html-renderer.mjs";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const generatedHtmlPath = "docs/rebreya-module-architecture.html";
const execFileAsync = promisify(execFile);

function makeFixture() {
  return {
    files: [
      { path: "module.json", size: 100 },
      { path: "scripts/main.js", size: 200 },
      { path: "scripts/data/inventory-service.js", size: 300 },
      { path: "scripts/ui/inventory-app.js", size: 400 },
      { path: "templates/inventory-app.hbs", size: 500 },
      { path: "assets/ui/trader-cutout.png", size: 600 }
    ],
    contents: new Map([
      ["module.json", JSON.stringify({ esmodules: ["scripts/main.js"] })],
      [
        "scripts/main.js",
        [
          'import { InventoryService } from "./data/inventory-service.js?v=1";',
          'import { InventoryApp } from "./ui/inventory-app.js";',
          'Hooks.once("ready", () => new InventoryService());'
        ].join("\n")
      ],
      ["scripts/data/inventory-service.js", "export class InventoryService {}"],
      [
        "scripts/ui/inventory-app.js",
        'export class InventoryApp { static PARTS = { main: { template: "modules/rebreya-main/templates/inventory-app.hbs" } }; }'
      ],
      ["templates/inventory-app.hbs", '<img src="modules/rebreya-main/assets/ui/trader-cutout.png">']
    ]),
    sourceCommit: "abc123",
    generatedAt: "2026-08-02T00:00:00.000Z"
  };
}

test("architecture paths receive deterministic domains, kinds, and ranks", () => {
  assert.deepEqual(classifyPath("module.json"), {
    domain: "entrypoints",
    kind: "manifest",
    rank: 0
  });
  assert.deepEqual(classifyPath("scripts/main.js"), {
    domain: "composition",
    kind: "composition",
    rank: 1
  });
  assert.deepEqual(classifyPath("scripts/data/inventory-service.js"), {
    domain: "data",
    kind: "source",
    rank: 4
  });
  assert.deepEqual(classifyPath("templates/inventory-app.hbs"), {
    domain: "templates",
    kind: "template",
    rank: 5
  });
  assert.deepEqual(classifyPath("assets/ui/trader-cutout.png"), {
    domain: "assets",
    kind: "asset",
    rank: 5
  });
});

test("graph extracts manifest, import, template, resource, and construction relationships", () => {
  const graph = buildArchitectureGraph(makeFixture());
  const relationships = new Set(
    graph.edges.map(({ source, target, kind }) => `${source}|${target}|${kind}`)
  );

  assert.ok(relationships.has("file:module.json|file:scripts/main.js|entrypoint"));
  assert.ok(relationships.has("file:scripts/main.js|file:scripts/data/inventory-service.js|import"));
  assert.ok(relationships.has("file:scripts/main.js|file:scripts/ui/inventory-app.js|import"));
  assert.ok(relationships.has("file:scripts/ui/inventory-app.js|file:templates/inventory-app.hbs|template"));
  assert.ok(relationships.has("file:templates/inventory-app.hbs|file:assets/ui/trader-cutout.png|resource"));
  assert.ok(relationships.has("concept:rebreya-main-module|file:scripts/data/inventory-service.js|constructs"));
  assert.equal(validateArchitectureGraph(graph).valid, true);
});

test("graph construction is deterministic for identical files in a different input order", () => {
  const fixture = makeFixture();
  const first = buildArchitectureGraph(fixture);
  const second = buildArchitectureGraph({
    ...fixture,
    files: fixture.files.toReversed()
  });

  assert.deepEqual(second, first);
});

test("graph validation reports duplicate nodes and dangling edges", () => {
  const validation = validateArchitectureGraph({
    nodes: [{ id: "same" }, { id: "same" }],
    edges: [{ source: "same", target: "missing", kind: "import" }]
  });

  assert.equal(validation.valid, false);
  assert.deepEqual(validation.errors, [
    "duplicate node: same",
    "missing edge target: missing"
  ]);
});

test("repository snapshot gives every tracked file exactly one file node", async () => {
  const snapshot = await collectRepositorySnapshot({
    repoRoot,
    excludedPaths: new Set([generatedHtmlPath])
  });
  const graph = buildArchitectureGraph({
    ...snapshot,
    generatedAt: "2026-08-02T00:00:00.000Z"
  });
  const filePaths = graph.nodes
    .filter((node) => node.type === "file")
    .map((node) => node.path)
    .sort();
  const trackedPaths = snapshot.files.map((file) => file.path).sort();

  assert.equal(filePaths.length, snapshot.files.length);
  assert.deepEqual(filePaths, trackedPaths);
  assert.equal(new Set(filePaths).size, filePaths.length);
  assert.equal(graph.meta.trackedFileCount, snapshot.files.length);
});

test("renderer emits a self-contained offline architecture document", () => {
  const graph = buildArchitectureGraph(makeFixture());
  const html = renderArchitectureHtml(graph);

  assert.match(html, /^<!doctype html>/iu);
  assert.match(html, /id="architecture-search"/u);
  assert.match(html, /id="fit-graph"/u);
  assert.match(html, /id="architecture-canvas"/u);
  assert.match(html, /id="architecture-edges"/u);
  assert.match(html, /id="architecture-nodes"/u);
  assert.match(html, /id="architecture-minimap"/u);
  assert.match(html, /window\.__REBREYA_ARCHITECTURE__/u);
  assert.doesNotMatch(html, /<script[^>]+src=/iu);
  assert.doesNotMatch(html, /<link[^>]+href=/iu);
  assert.doesNotMatch(html, /\bfetch\s*\(/u);
});

test("renderer safely serializes data that could otherwise terminate an inline script", () => {
  const graph = buildArchitectureGraph(makeFixture());
  graph.nodes[0].description = "</script><script>globalThis.compromised=true</script>";

  const html = renderArchitectureHtml(graph);

  assert.doesNotMatch(html, /<script>globalThis\.compromised=true<\/script>/u);
  assert.match(html, /\\u003c\/script\\u003e/u);
});

test("renderer output is deterministic for a fixed graph", () => {
  const graph = buildArchitectureGraph(makeFixture());

  assert.equal(renderArchitectureHtml(graph), renderArchitectureHtml(graph));
});

test("generator CLI writes a complete current-repository snapshot", async () => {
  const outputPath = join(tmpdir(), `rebreya-architecture-${process.pid}.html`);
  try {
    await execFileAsync(process.execPath, ["tools/generate-architecture-map.mjs", outputPath], {
      cwd: repoRoot,
      encoding: "utf8",
      maxBuffer: 16 * 1024 * 1024
    });
    const html = await readFile(outputPath, "utf8");
    const match = html.match(/window\.__REBREYA_ARCHITECTURE__\s*=\s*(\{.*?\});\s*<\/script>/su);
    assert.ok(match, "generated HTML embeds the architecture graph");
    const graph = JSON.parse(match[1]);
    const { stdout } = await execFileAsync("git", ["ls-files", "-z"], {
      cwd: repoRoot,
      encoding: "utf8",
      maxBuffer: 16 * 1024 * 1024
    });
    const tracked = stdout
      .split("\0")
      .filter((path) => path && path !== generatedHtmlPath);

    assert.equal(graph.nodes.filter((node) => node.type === "file").length, tracked.length);
    assert.equal(graph.meta.trackedFileCount, tracked.length);
    assert.match(html, new RegExp(graph.meta.sourceCommit.slice(0, 10), "u"));
  }
  finally {
    await rm(outputPath, { force: true });
  }
});
