import { mkdir, writeFile } from "node:fs/promises";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  buildArchitectureGraph,
  collectRepositorySnapshot,
  validateArchitectureGraph
} from "./architecture-map/graph-builder.mjs";
import { renderArchitectureHtml } from "./architecture-map/html-renderer.mjs";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const generatedHtmlPath = "docs/rebreya-module-architecture.html";

function normalizePath(value) {
  return String(value ?? "").replaceAll("\\", "/");
}

async function main() {
  const outputPath = resolve(repoRoot, process.argv[2] || generatedHtmlPath);
  const outputRelativePath = normalizePath(relative(repoRoot, outputPath));
  const snapshot = await collectRepositorySnapshot({
    repoRoot,
    excludedPaths: new Set([generatedHtmlPath, outputRelativePath])
  });
  const graph = buildArchitectureGraph({
    ...snapshot,
    generatedAt: new Date().toISOString()
  });
  const validation = validateArchitectureGraph(graph);
  if (!validation.valid) {
    throw new Error(`Architecture graph validation failed:\n${validation.errors.join("\n")}`);
  }

  const html = renderArchitectureHtml(graph);
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, html, "utf8");
  process.stdout.write([
    `Architecture map written to ${outputPath}`,
    `${graph.meta.trackedFileCount} tracked files`,
    `${graph.nodes.length} nodes`,
    `${graph.edges.length} edges`,
    ""
  ].join("\n"));
}

main().catch((error) => {
  process.stderr.write(`${error?.stack || error}\n`);
  process.exitCode = 1;
});
