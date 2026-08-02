import { execFile } from "node:child_process";
import { readFile, stat } from "node:fs/promises";
import { basename, dirname, extname, join, posix, relative } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

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

const TEXT_EXTENSIONS = new Set([
  ".css",
  ".hbs",
  ".html",
  ".js",
  ".json",
  ".md",
  ".mjs",
  ".ps1",
  ".py",
  ".svg",
  ".txt"
]);

const DOMAIN_ORDER = Object.freeze([
  "entrypoints",
  "composition",
  "application",
  "infrastructure",
  "data",
  "engine",
  "trading",
  "combat",
  "automation",
  "integrations",
  "ui",
  "templates",
  "styles",
  "localization",
  "assets",
  "tests",
  "tools",
  "documentation",
  "legacy",
  "resources"
]);

const DOMAIN_LABELS = Object.freeze({
  entrypoints: "Манифест и вход",
  composition: "Composition root",
  application: "Application",
  infrastructure: "Infrastructure",
  data: "Данные и доменные сервисы",
  engine: "Расчётные движки",
  trading: "Торговые транзакции",
  combat: "Бой и реакции",
  automation: "Автоматизации",
  integrations: "Интеграции Foundry / dnd5e",
  ui: "Пользовательский интерфейс",
  templates: "Handlebars-шаблоны",
  styles: "Стили",
  localization: "Локализация",
  assets: "Графические ресурсы",
  tests: "Автоматические тесты",
  tools: "Инструменты импорта и сборки",
  documentation: "Документация",
  legacy: "Совместимость и legacy",
  resources: "Прочие ресурсы"
});

const KNOWN_DESCRIPTIONS = Object.freeze({
  "module.json": "Манифест Foundry VTT и единственная декларация runtime entrypoint.",
  "scripts/main.js": "Единственный composition root, lifecycle, публичный API и socket dispatch.",
  "scripts/application/world-mutation-coordinator.js": "Сериализация world-state мутаций и дедупликация request ID.",
  "scripts/application/durable-mutation-journal.js": "Фазовый журнал многошаговых операций и восстановления.",
  "scripts/infrastructure/foundry/socket-command-bus.js": "Typed command protocol и исполнение привилегированных команд active GM.",
  "scripts/infrastructure/ui/ui-refresh-coordinator.js": "Объединение повторных UI refresh без перехвата фокуса.",
  "scripts/data/repository.js": "Загрузка и кэширование экономической модели.",
  "scripts/data/group-context-service.js": "Реестр активной dnd5e-группы и её участников.",
  "scripts/data/inventory-service.js": "Партийный инвентарь, валюты, запасы и перенос предметов.",
  "scripts/features/trading/trade-transaction-service.js": "Оркестрация покупок, продаж, аудита и отката торговли.",
  "scripts/combat/reaction-queue-service.js": "Единый владелец окон глобальных реакций.",
  "scripts/combat/spell-automation-registry.js": "Реестр рецептов и runtime spell automation.",
  "scripts/ui/inventory-app.js": "Главное окно inventory, party, craft, calendar, downtime и travel."
});

const CONCEPT_NODES = Object.freeze([
  {
    id: "concept:foundry-init",
    label: "Foundry init",
    description: "Регистрация settings, helpers, item types, статусов и ранних patches.",
    domain: "entrypoints",
    kind: "lifecycle",
    rank: 1
  },
  {
    id: "concept:foundry-setup",
    label: "Foundry setup",
    description: "Подключение socket listener и очередь сообщений до готовности API.",
    domain: "entrypoints",
    kind: "lifecycle",
    rank: 1
  },
  {
    id: "concept:foundry-ready",
    label: "Foundry ready",
    description: "Создание API, регистрация integrations/hooks и запуск initialize().",
    domain: "entrypoints",
    kind: "lifecycle",
    rank: 1
  },
  {
    id: "concept:rebreya-main-module",
    label: "RebreyaMainModule",
    description: "Центральный владелец сервисов и публичной поверхности модуля.",
    domain: "composition",
    kind: "composition",
    rank: 1
  },
  {
    id: "concept:public-api",
    label: "game.rebreyaMain / module.api",
    description: "Поддерживаемая поверхность вызовов макросов и интеграций.",
    domain: "composition",
    kind: "api",
    rank: 2
  },
  {
    id: "concept:socket-dispatch",
    label: "Socket dispatch / active GM",
    description: "Маршрутизация typed commands и legacy compatibility events.",
    domain: "infrastructure",
    kind: "socket",
    rank: 2
  }
]);

function normalizePath(value) {
  return String(value ?? "").replaceAll("\\", "/").replace(/^\.\//u, "");
}

function domainIndex(domain) {
  const index = DOMAIN_ORDER.indexOf(domain);
  return index < 0 ? DOMAIN_ORDER.length : index;
}

function compareNodes(left, right) {
  return left.rank - right.rank
    || domainIndex(left.domain) - domainIndex(right.domain)
    || left.id.localeCompare(right.id, "ru");
}

function compareEdges(left, right) {
  return left.source.localeCompare(right.source, "ru")
    || left.target.localeCompare(right.target, "ru")
    || left.kind.localeCompare(right.kind, "ru");
}

function fileKindFromExtension(path) {
  const extension = extname(path).toLowerCase();
  if (extension === ".hbs") return "template";
  if ([".js", ".mjs", ".py", ".ps1"].includes(extension)) return "source";
  if ([".json", ".txt"].includes(extension)) return "data";
  if (extension === ".css") return "style";
  if ([".md", ".pdf", ".doc", ".docx", ".xlsx"].includes(extension)) return "document";
  if ([".png", ".jpg", ".jpeg", ".webp", ".gif", ".svg", ".mp4", ".webm"].includes(extension)) return "asset";
  return "file";
}

export function classifyPath(inputPath) {
  const path = normalizePath(inputPath);
  if (path === "module.json") return { domain: "entrypoints", kind: "manifest", rank: 0 };
  if (path === "scripts/main.js") return { domain: "composition", kind: "composition", rank: 1 };
  if (path.startsWith("scripts/application/")) return { domain: "application", kind: "source", rank: 4 };
  if (path.startsWith("scripts/infrastructure/")) return { domain: "infrastructure", kind: "source", rank: 4 };
  if (path.startsWith("scripts/data/")) return { domain: "data", kind: "source", rank: 4 };
  if (path.startsWith("scripts/engine/")) return { domain: "engine", kind: "source", rank: 4 };
  if (path.startsWith("scripts/features/trading/")) return { domain: "trading", kind: "source", rank: 4 };
  if (path.startsWith("scripts/combat/") || path.startsWith("scripts/rest/") || path.startsWith("scripts/cosmology/")) {
    return { domain: "combat", kind: "source", rank: 4 };
  }
  if (path.startsWith("scripts/automation/")) return { domain: "automation", kind: "source", rank: 4 };
  if (path.startsWith("scripts/integrations/")) return { domain: "integrations", kind: "source", rank: 4 };
  if (path.startsWith("scripts/ui/") || path === "scripts/ui.js") return { domain: "ui", kind: "source", rank: 4 };
  if (path.startsWith("scripts/legacy/")) return { domain: "legacy", kind: "source", rank: 4 };
  if (path.startsWith("scripts/")) return { domain: "composition", kind: fileKindFromExtension(path), rank: 4 };
  if (path.startsWith("templates/icons/") || path.startsWith("templates/texture/")) {
    return { domain: "assets", kind: "asset", rank: 5 };
  }
  if (path.startsWith("templates/")) return { domain: "templates", kind: fileKindFromExtension(path), rank: 5 };
  if (path.startsWith("assets/")) return { domain: "assets", kind: fileKindFromExtension(path), rank: 5 };
  if (path.startsWith("styles/")) return { domain: "styles", kind: "style", rank: 5 };
  if (path.startsWith("lang/")) return { domain: "localization", kind: "data", rank: 5 };
  if (path.startsWith("data/")) return { domain: "data", kind: "data", rank: 5 };
  if (path.startsWith("tests/")) return { domain: "tests", kind: fileKindFromExtension(path), rank: 5 };
  if (path.startsWith("tools/")) return { domain: "tools", kind: fileKindFromExtension(path), rank: 5 };
  if (path.startsWith("docs/")) return { domain: "documentation", kind: fileKindFromExtension(path), rank: 5 };
  if (/^(README|AGENT|conversation-memory)/iu.test(path)) {
    return { domain: "documentation", kind: fileKindFromExtension(path), rank: 5 };
  }
  return { domain: "resources", kind: fileKindFromExtension(path), rank: 5 };
}

function makeFileNode(file, contents) {
  const classification = classifyPath(file.path);
  const content = contents.get(file.path);
  return {
    id: `file:${file.path}`,
    type: "file",
    label: basename(file.path),
    path: file.path,
    description: KNOWN_DESCRIPTIONS[file.path] ?? file.path,
    domain: classification.domain,
    kind: classification.kind,
    rank: classification.rank,
    size: file.size,
    lines: typeof content === "string" ? (content.length === 0 ? 0 : content.split(/\r?\n/u).length) : null
  };
}

function directoryPathsForFile(filePath, domain) {
  const parent = posix.dirname(filePath);
  if (parent === ".") return [];
  const segments = parent.split("/");
  const candidates = [];
  for (let length = 1; length <= segments.length; length += 1) {
    const candidate = segments.slice(0, length).join("/");
    if (candidate === "scripts") continue;
    if (classifyPath(`${candidate}/placeholder.js`).domain !== domain
      && !filePath.startsWith("templates/icons/")
      && !filePath.startsWith("templates/texture/")) {
      continue;
    }
    candidates.push(candidate);
  }
  return candidates;
}

function addEdge(edgeMap, source, target, kind, location = "") {
  if (!source || !target || source === target) return;
  const key = `${source}|${target}|${kind}`;
  if (!edgeMap.has(key)) {
    edgeMap.set(key, { source, target, kind, location });
  }
}

function resolveTrackedReference(sourcePath, rawReference, trackedPaths) {
  const rawPath = String(rawReference ?? "").split(/[?#]/u)[0];
  if (!rawPath || (!rawPath.startsWith(".") && !rawPath.startsWith("/"))) return null;
  const reference = normalizePath(rawPath);
  const candidate = rawPath.startsWith("/")
    ? reference.replace(/^\/+/, "")
    : posix.normalize(posix.join(posix.dirname(sourcePath), reference));
  for (const resolved of [candidate, `${candidate}.js`, `${candidate}.mjs`, `${candidate}/index.js`, `${candidate}/index.mjs`]) {
    if (trackedPaths.has(resolved)) return resolved;
  }
  return null;
}

function extractImports(sourcePath, content, trackedPaths) {
  const imports = [];
  const patterns = [
    /\b(?:import|export)\s+(?:[^"'`;]*?\s+from\s+)?["']([^"']+)["']/gu,
    /\bimport\s*\(\s*["']([^"']+)["']\s*\)/gu
  ];
  for (const pattern of patterns) {
    for (const match of content.matchAll(pattern)) {
      const resolved = resolveTrackedReference(sourcePath, match[1], trackedPaths);
      if (resolved) imports.push(resolved);
    }
  }
  return [...new Set(imports)];
}

function extractModuleResources(content, trackedPaths) {
  const references = [];
  const pattern = /modules\/rebreya-main\/([^"'`\s)>}]+)/gu;
  for (const match of content.matchAll(pattern)) {
    const candidate = normalizePath(match[1].split(/[?#]/u)[0]);
    if (trackedPaths.has(candidate)) references.push(candidate);
  }
  return [...new Set(references)];
}

function extractImportedBindings(sourcePath, content, trackedPaths) {
  const bindings = new Map();
  const pattern = /\bimport\s+([\s\S]*?)\s+from\s+["']([^"']+)["'];?/gu;
  for (const match of content.matchAll(pattern)) {
    const target = resolveTrackedReference(sourcePath, match[2], trackedPaths);
    if (!target) continue;
    const clause = match[1].trim();
    const named = clause.match(/\{([\s\S]*?)\}/u)?.[1] ?? "";
    for (const part of named.split(",")) {
      const value = part.trim();
      if (!value) continue;
      const localName = value.split(/\s+as\s+/u).at(-1)?.trim();
      if (localName) bindings.set(localName, target);
    }
    const defaultName = clause.replace(/\{[\s\S]*?\}/u, "").split(",")[0].trim();
    if (/^[A-Za-z_$][\w$]*$/u.test(defaultName)) bindings.set(defaultName, target);
  }
  return bindings;
}

function addManifestEdges(contents, trackedPaths, edges) {
  const text = contents.get("module.json");
  if (!text) return;
  try {
    const manifest = JSON.parse(text);
    for (const entrypoint of manifest.esmodules ?? []) {
      const target = normalizePath(entrypoint);
      if (trackedPaths.has(target)) addEdge(edges, "file:module.json", `file:${target}`, "entrypoint", "esmodules");
    }
    for (const style of manifest.styles ?? []) {
      const target = normalizePath(style);
      if (trackedPaths.has(target)) addEdge(edges, "file:module.json", `file:${target}`, "resource", "styles");
    }
    for (const language of manifest.languages ?? []) {
      const target = normalizePath(language?.path);
      if (trackedPaths.has(target)) addEdge(edges, "file:module.json", `file:${target}`, "resource", "languages");
    }
  }
  catch {
    // Invalid JSON is reported by the repository's JSON validation; the graph remains inspectable.
  }
}

function addLifecycleEdges(trackedPaths, edges) {
  if (!trackedPaths.has("scripts/main.js")) return;
  const mainId = "file:scripts/main.js";
  addEdge(edges, mainId, "concept:foundry-init", "lifecycle", "Hooks.once(init)");
  addEdge(edges, mainId, "concept:foundry-setup", "lifecycle", "Hooks.on(setup)");
  addEdge(edges, mainId, "concept:foundry-ready", "lifecycle", "Hooks.once(ready)");
  addEdge(edges, "concept:foundry-ready", "concept:rebreya-main-module", "constructs", "new RebreyaMainModule()");
  addEdge(edges, mainId, "concept:rebreya-main-module", "constructs", "class RebreyaMainModule");
  addEdge(edges, "concept:rebreya-main-module", "concept:public-api", "constructs", "game.rebreyaMain");
  addEdge(edges, "concept:rebreya-main-module", "concept:socket-dispatch", "constructs", "handleSocketMessage");
}

export function buildArchitectureGraph({
  files = [],
  contents = new Map(),
  sourceCommit = "",
  generatedAt = ""
} = {}) {
  const normalizedFiles = files
    .map((file) => ({ path: normalizePath(file.path), size: Number(file.size) || 0 }))
    .filter((file) => file.path)
    .sort((left, right) => left.path.localeCompare(right.path, "ru"));
  const trackedPaths = new Set(normalizedFiles.map((file) => file.path));
  const nodes = normalizedFiles.map((file) => makeFileNode(file, contents));
  const nodeMap = new Map(nodes.map((node) => [node.id, node]));
  const edges = new Map();

  for (const concept of CONCEPT_NODES) {
    nodeMap.set(concept.id, { ...concept, type: "concept", path: "", size: null, lines: null });
  }

  const usedDomains = new Set(nodes.map((node) => node.domain));
  for (const domain of [...usedDomains].sort((left, right) => domainIndex(left) - domainIndex(right))) {
    const id = `concept:domain:${domain}`;
    nodeMap.set(id, {
      id,
      type: "domain",
      label: DOMAIN_LABELS[domain] ?? domain,
      path: "",
      description: `Архитектурная область: ${DOMAIN_LABELS[domain] ?? domain}`,
      domain,
      kind: "domain",
      rank: 2,
      size: null,
      lines: null
    });
  }

  for (const file of normalizedFiles) {
    const fileNode = nodeMap.get(`file:${file.path}`);
    const directories = directoryPathsForFile(file.path, fileNode.domain);
    let parentId = `concept:domain:${fileNode.domain}`;
    for (const [index, directoryPath] of directories.entries()) {
      const directoryId = `concept:dir:${directoryPath}`;
      if (!nodeMap.has(directoryId)) {
        nodeMap.set(directoryId, {
          id: directoryId,
          type: "directory",
          label: basename(directoryPath),
          path: directoryPath,
          description: `Каталог ${directoryPath}`,
          domain: fileNode.domain,
          kind: "directory",
          rank: Math.min(4, 3 + index),
          size: null,
          lines: null
        });
      }
      addEdge(edges, parentId, directoryId, "contains");
      parentId = directoryId;
    }
    addEdge(edges, parentId, fileNode.id, "contains");
  }

  addManifestEdges(contents, trackedPaths, edges);
  addLifecycleEdges(trackedPaths, edges);

  for (const [sourcePath, content] of [...contents.entries()].sort(([left], [right]) => left.localeCompare(right, "ru"))) {
    if (!trackedPaths.has(sourcePath) || typeof content !== "string") continue;
    for (const targetPath of extractImports(sourcePath, content, trackedPaths)) {
      addEdge(
        edges,
        `file:${sourcePath}`,
        `file:${targetPath}`,
        sourcePath.startsWith("tests/") ? "test" : "import"
      );
    }
    for (const targetPath of extractModuleResources(content, trackedPaths)) {
      const kind = extname(targetPath).toLowerCase() === ".hbs" ? "template" : "resource";
      addEdge(edges, `file:${sourcePath}`, `file:${targetPath}`, kind);
    }
  }

  const mainContent = contents.get("scripts/main.js") ?? "";
  const mainBindings = extractImportedBindings("scripts/main.js", mainContent, trackedPaths);
  for (const match of mainContent.matchAll(/\bnew\s+([A-Za-z_$][\w$]*)\s*\(/gu)) {
    const targetPath = mainBindings.get(match[1]);
    if (targetPath) {
      addEdge(edges, "concept:rebreya-main-module", `file:${targetPath}`, "constructs", `new ${match[1]}()`);
    }
  }

  const sortedNodes = [...nodeMap.values()].sort(compareNodes);
  const sortedEdges = [...edges.values()].sort(compareEdges);
  const domains = [...usedDomains]
    .sort((left, right) => domainIndex(left) - domainIndex(right))
    .map((id) => ({
      id,
      label: DOMAIN_LABELS[id] ?? id,
      fileCount: sortedNodes.filter((node) => node.type === "file" && node.domain === id).length
    }));

  return {
    meta: {
      moduleId: "rebreya-main",
      sourceCommit: String(sourceCommit ?? "").trim(),
      generatedAt: String(generatedAt ?? ""),
      trackedFileCount: normalizedFiles.length
    },
    domains,
    nodes: sortedNodes,
    edges: sortedEdges
  };
}

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

async function mapInBatches(values, batchSize, mapper) {
  const results = [];
  for (let index = 0; index < values.length; index += batchSize) {
    const batch = values.slice(index, index + batchSize);
    results.push(...await Promise.all(batch.map(mapper)));
  }
  return results;
}

export async function collectRepositorySnapshot({
  repoRoot,
  excludedPaths = new Set()
} = {}) {
  const root = String(repoRoot ?? "");
  const normalizedExclusions = new Set([...excludedPaths].map(normalizePath));
  const [{ stdout: trackedOutput }, { stdout: commitOutput }] = await Promise.all([
    execFileAsync("git", ["ls-files", "-z"], {
      cwd: root,
      encoding: "utf8",
      maxBuffer: 16 * 1024 * 1024
    }),
    execFileAsync("git", ["rev-parse", "HEAD"], {
      cwd: root,
      encoding: "utf8",
      maxBuffer: 1024 * 1024
    })
  ]);
  const trackedPaths = trackedOutput
    .split("\0")
    .map(normalizePath)
    .filter((path) => path && !normalizedExclusions.has(path))
    .sort((left, right) => left.localeCompare(right, "ru"));
  const rows = await mapInBatches(trackedPaths, 64, async (path) => {
    const absolutePath = join(root, ...path.split("/"));
    const info = await stat(absolutePath);
    const extension = extname(path).toLowerCase();
    const content = TEXT_EXTENSIONS.has(extension)
      ? await readFile(absolutePath, "utf8")
      : null;
    return {
      file: { path, size: info.size },
      content
    };
  });
  const files = rows.map((row) => row.file);
  const contents = new Map(
    rows.filter((row) => typeof row.content === "string").map((row) => [row.file.path, row.content])
  );
  return {
    files,
    contents,
    sourceCommit: commitOutput.trim()
  };
}

export function repositoryRelativePath(repoRoot, absolutePath) {
  return normalizePath(relative(repoRoot, absolutePath));
}
