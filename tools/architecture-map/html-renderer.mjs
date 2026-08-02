const PAGE_TITLE = "Rebreya Main — архитектура модуля";
const MAX_LEAF_COLUMNS = 72;
const MIN_FOCUS_SCALE = 1.05;
const MAX_FOCUS_SCALE = 1.35;

export function calculateLeafColumnCount(count) {
  const normalizedCount = Math.max(0, Number(count) || 0);
  if (normalizedCount <= 1) return 1;
  return Math.max(
    1,
    Math.min(MAX_LEAF_COLUMNS, Math.ceil(Math.sqrt(normalizedCount * 1.9)))
  );
}

export function calculateFocusScale(currentScale) {
  return Math.max(MIN_FOCUS_SCALE, Math.min(MAX_FOCUS_SCALE, Number(currentScale) || 0));
}

function serializeForInlineScript(value) {
  return JSON.stringify(value)
    .replace(/</gu, "\\u003c")
    .replace(/>/gu, "\\u003e")
    .replace(/&/gu, "\\u0026")
    .replace(/\u2028/gu, "\\u2028")
    .replace(/\u2029/gu, "\\u2029");
}

export function renderArchitectureHtml(graph) {
  const serializedGraph = serializeForInlineScript(graph);
  return `<!doctype html>
<html lang="ru">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${PAGE_TITLE}</title>
  <style>
    :root {
      color-scheme: dark;
      --canvas: #111214;
      --surface: #191b1f;
      --surface-raised: #22252a;
      --node: #35383d;
      --node-hover: #41454b;
      --text: #f3f4f6;
      --muted: #a8adb6;
      --quiet: #747b86;
      --line: #aeb4bd;
      --line-quiet: #555b64;
      --border: #4a4e55;
      --focus: #d9b96e;
      --entry: #d9b96e;
      --composition: #8bb6dc;
      --application: #88b99a;
      --infrastructure: #a9a0d4;
      --data: #c49b73;
      --combat: #c98282;
      --integration: #8eb5b0;
      --ui: #c59ac4;
      --resource: #8f98a6;
      --shadow: rgba(0, 0, 0, 0.38);
      font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    }

    * { box-sizing: border-box; }

    html,
    body {
      width: 100%;
      height: 100%;
      margin: 0;
      overflow: hidden;
      background: var(--canvas);
      color: var(--text);
    }

    body {
      display: grid;
      grid-template-rows: auto minmax(0, 1fr);
    }

    button,
    input {
      font: inherit;
    }

    .architecture-toolbar {
      position: relative;
      z-index: 20;
      display: grid;
      grid-template-columns: minmax(210px, 1fr) minmax(280px, 520px) auto;
      align-items: center;
      gap: 16px;
      min-height: 68px;
      padding: 10px 16px;
      border-bottom: 1px solid var(--border);
      background: rgba(25, 27, 31, 0.97);
      box-shadow: 0 8px 24px var(--shadow);
    }

    .architecture-title {
      min-width: 0;
    }

    .architecture-title h1 {
      margin: 0;
      font-size: 17px;
      font-weight: 600;
      letter-spacing: 0.01em;
    }

    .architecture-meta {
      margin-top: 3px;
      color: var(--muted);
      font-size: 12px;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .architecture-search-wrap {
      position: relative;
      min-width: 0;
    }

    #architecture-search {
      width: 100%;
      height: 38px;
      padding: 0 38px 0 12px;
      border: 1px solid var(--border);
      border-radius: 4px;
      outline: none;
      color: var(--text);
      background: #101216;
    }

    #architecture-search:focus {
      border-color: var(--focus);
      box-shadow: 0 0 0 2px rgba(217, 185, 110, 0.2);
    }

    .search-count {
      position: absolute;
      top: 50%;
      right: 10px;
      transform: translateY(-50%);
      color: var(--muted);
      font-size: 11px;
      pointer-events: none;
    }

    .architecture-actions {
      display: flex;
      gap: 8px;
      justify-content: flex-end;
    }

    .architecture-control {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 7px;
      min-height: 38px;
      padding: 0 12px;
      border: 1px solid var(--border);
      border-radius: 4px;
      color: var(--text);
      background: var(--surface-raised);
      cursor: pointer;
    }

    .architecture-control:hover { background: #30343a; }
    .architecture-control:focus-visible { outline: 2px solid var(--focus); outline-offset: 2px; }
    .architecture-control svg { width: 16px; height: 16px; fill: none; stroke: currentColor; stroke-width: 1.8; }

    .architecture-shell {
      position: relative;
      min-width: 0;
      min-height: 0;
      overflow: hidden;
    }

    #architecture-canvas {
      position: absolute;
      inset: 0;
      overflow: hidden;
      cursor: grab;
      touch-action: none;
      background-color: var(--canvas);
      background-image:
        linear-gradient(rgba(255, 255, 255, 0.025) 1px, transparent 1px),
        linear-gradient(90deg, rgba(255, 255, 255, 0.025) 1px, transparent 1px);
      background-size: 32px 32px;
    }

    #architecture-canvas.is-dragging { cursor: grabbing; }

    #architecture-edges,
    #architecture-nodes {
      position: absolute;
      inset: 0;
      width: 100%;
      height: 100%;
      transform-origin: 0 0;
    }

    #architecture-edges {
      overflow: visible;
      pointer-events: none;
    }

    #architecture-nodes {
      pointer-events: none;
    }

    .domain-band {
      position: absolute;
      border-top: 1px solid rgba(255, 255, 255, 0.055);
      border-bottom: 1px solid rgba(255, 255, 255, 0.035);
      background: rgba(255, 255, 255, 0.012);
      pointer-events: none;
    }

    .domain-band-label {
      position: absolute;
      top: 18px;
      left: 24px;
      color: rgba(235, 238, 243, 0.58);
      font-size: 15px;
      font-weight: 600;
      letter-spacing: 0.05em;
      text-transform: uppercase;
    }

    .architecture-node {
      position: absolute;
      display: flex;
      flex-direction: column;
      align-items: flex-start;
      justify-content: center;
      min-width: 0;
      margin: 0;
      padding: 6px 10px;
      overflow: hidden;
      border: 1px solid var(--border);
      border-radius: 2px;
      color: var(--text);
      background: var(--node);
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.24);
      text-align: left;
      pointer-events: auto;
      cursor: pointer;
      transition: opacity 120ms ease, border-color 120ms ease, background 120ms ease, box-shadow 120ms ease;
    }

    .architecture-node:hover { background: var(--node-hover); }
    .architecture-node:focus-visible { outline: 3px solid var(--focus); outline-offset: 2px; }

    .architecture-node.rank-0,
    .architecture-node.rank-1 {
      border-width: 2px;
      box-shadow: 0 9px 24px rgba(0, 0, 0, 0.34);
    }

    .architecture-node.rank-2 { border-width: 2px; }
    .architecture-node.kind-domain { background: #292c31; }
    .architecture-node.kind-directory { background: #2e3136; }
    .architecture-node.kind-manifest { border-color: var(--entry); }
    .architecture-node.kind-composition { border-color: var(--composition); }
    .architecture-node.domain-application { border-color: color-mix(in srgb, var(--application) 70%, var(--border)); }
    .architecture-node.domain-infrastructure { border-color: color-mix(in srgb, var(--infrastructure) 70%, var(--border)); }
    .architecture-node.domain-data,
    .architecture-node.domain-engine,
    .architecture-node.domain-trading { border-color: color-mix(in srgb, var(--data) 68%, var(--border)); }
    .architecture-node.domain-combat,
    .architecture-node.domain-automation { border-color: color-mix(in srgb, var(--combat) 68%, var(--border)); }
    .architecture-node.domain-integrations { border-color: color-mix(in srgb, var(--integration) 68%, var(--border)); }
    .architecture-node.domain-ui,
    .architecture-node.domain-templates { border-color: color-mix(in srgb, var(--ui) 68%, var(--border)); }

    .node-label {
      display: block;
      width: 100%;
      overflow: hidden;
      font-size: 12px;
      font-weight: 500;
      line-height: 1.2;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .rank-0 .node-label,
    .rank-1 .node-label { font-size: 17px; }
    .rank-2 .node-label { font-size: 15px; }
    .rank-3 .node-label { font-size: 13px; }

    .node-path {
      display: block;
      width: 100%;
      margin-top: 4px;
      overflow: hidden;
      color: var(--muted);
      font-family: "Cascadia Code", "SFMono-Regular", Consolas, monospace;
      font-size: 10px;
      line-height: 1.2;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .rank-5 .node-path { display: none; }

    .architecture-edge {
      fill: none;
      stroke: var(--line-quiet);
      stroke-width: 1;
      vector-effect: non-scaling-stroke;
      opacity: 0.5;
      transition: opacity 120ms ease, stroke 120ms ease, stroke-width 120ms ease;
    }

    .architecture-edge.kind-entrypoint,
    .architecture-edge.kind-lifecycle,
    .architecture-edge.kind-constructs,
    .architecture-edge.kind-import {
      stroke: var(--line);
      opacity: 0.72;
    }

    .architecture-edge.kind-entrypoint,
    .architecture-edge.kind-lifecycle,
    .architecture-edge.kind-constructs { stroke-width: 1.4; }

    .has-selection .architecture-node,
    .has-selection .architecture-edge { opacity: 0.13; }
    .has-selection .architecture-node.is-related,
    .has-selection .architecture-node.is-selected,
    .has-selection .architecture-edge.is-related { opacity: 1; }
    .architecture-node.is-selected {
      border-color: var(--focus);
      background: #464039;
      box-shadow: 0 0 0 3px rgba(217, 185, 110, 0.2), 0 10px 24px rgba(0, 0, 0, 0.4);
    }
    .architecture-node.is-search-match {
      border-color: #e7d492;
      box-shadow: 0 0 0 3px rgba(231, 212, 146, 0.22);
    }
    .architecture-edge.is-related { stroke: #e5d49a; stroke-width: 2; }

    .architecture-legend {
      position: absolute;
      z-index: 12;
      left: 14px;
      bottom: 14px;
      display: flex;
      flex-wrap: wrap;
      gap: 7px 13px;
      max-width: min(690px, calc(100% - 300px));
      padding: 9px 11px;
      border: 1px solid var(--border);
      border-radius: 4px;
      background: rgba(25, 27, 31, 0.94);
      box-shadow: 0 6px 18px var(--shadow);
      pointer-events: none;
    }

    .legend-item {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      color: var(--muted);
      font-size: 11px;
      white-space: nowrap;
    }

    .legend-swatch {
      width: 15px;
      height: 9px;
      border: 1px solid var(--line);
      background: var(--node);
    }

    .legend-line {
      width: 18px;
      height: 0;
      border-top: 1px solid var(--line);
    }

    .legend-line.quiet { border-color: var(--line-quiet); opacity: 0.7; }

    .architecture-inspector {
      position: absolute;
      z-index: 13;
      right: 14px;
      top: 14px;
      width: min(410px, calc(100% - 28px));
      padding: 11px 13px;
      border: 1px solid var(--border);
      border-radius: 4px;
      background: rgba(25, 27, 31, 0.95);
      box-shadow: 0 6px 18px var(--shadow);
      pointer-events: none;
    }

    .inspector-label {
      margin: 0;
      overflow: hidden;
      font-size: 13px;
      font-weight: 600;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .inspector-path,
    .inspector-description {
      margin: 4px 0 0;
      color: var(--muted);
      font-size: 11px;
      line-height: 1.35;
    }

    .inspector-path {
      overflow: hidden;
      font-family: "Cascadia Code", "SFMono-Regular", Consolas, monospace;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .architecture-minimap-wrap {
      position: absolute;
      z-index: 14;
      right: 14px;
      bottom: 14px;
      width: 250px;
      height: 154px;
      overflow: hidden;
      border: 1px solid var(--border);
      border-radius: 4px;
      background: rgba(17, 18, 20, 0.94);
      box-shadow: 0 6px 18px var(--shadow);
      pointer-events: none;
    }

    #architecture-minimap { width: 100%; height: 100%; display: block; }

    .sr-only {
      position: absolute;
      width: 1px;
      height: 1px;
      padding: 0;
      margin: -1px;
      overflow: hidden;
      clip: rect(0, 0, 0, 0);
      white-space: nowrap;
      border: 0;
    }

    @media (max-width: 820px) {
      .architecture-toolbar {
        grid-template-columns: 1fr auto;
        gap: 8px;
      }
      .architecture-title { grid-column: 1 / -1; }
      .architecture-search-wrap { min-width: 0; }
      .architecture-control span { display: none; }
      .architecture-control { width: 38px; padding: 0; }
      .architecture-legend { display: none; }
      .architecture-minimap-wrap { width: 172px; height: 108px; }
    }

    @media (prefers-reduced-motion: reduce) {
      .architecture-node,
      .architecture-edge { transition: none; }
    }
  </style>
</head>
<body>
  <header class="architecture-toolbar">
    <div class="architecture-title">
      <h1>Rebreya Main — архитектура модуля</h1>
      <div class="architecture-meta" id="architecture-meta"></div>
    </div>
    <label class="architecture-search-wrap">
      <span class="sr-only">Поиск файла, сервиса или пути</span>
      <input id="architecture-search" type="search" autocomplete="off" spellcheck="false" placeholder="Найти файл, сервис или путь…">
      <span class="search-count" id="search-count" aria-live="polite"></span>
    </label>
    <div class="architecture-actions">
      <button class="architecture-control" id="fit-graph" type="button" aria-label="Показать всю схему">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 3H3v5M16 3h5v5M8 21H3v-5M16 21h5v-5"/></svg>
        <span>Вся схема</span>
      </button>
      <button class="architecture-control" id="clear-selection" type="button" aria-label="Сбросить поиск и выделение">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 5l14 14M19 5L5 19"/></svg>
        <span>Сбросить</span>
      </button>
    </div>
  </header>
  <main class="architecture-shell">
    <div id="architecture-canvas" aria-label="Полная архитектурная схема Rebreya Main">
      <svg id="architecture-edges" aria-hidden="true">
        <defs>
          <marker id="architecture-arrow" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto" markerUnits="strokeWidth">
            <path d="M0,0 L8,4 L0,8 z" fill="#aeb4bd"></path>
          </marker>
          <marker id="architecture-arrow-quiet" markerWidth="7" markerHeight="7" refX="6" refY="3.5" orient="auto" markerUnits="strokeWidth">
            <path d="M0,0 L7,3.5 L0,7 z" fill="#555b64"></path>
          </marker>
        </defs>
        <g id="architecture-edge-world"></g>
      </svg>
      <div id="architecture-nodes"></div>
    </div>
    <aside class="architecture-inspector" aria-live="polite">
      <p class="inspector-label" id="inspector-label">Вся схема</p>
      <p class="inspector-path" id="inspector-path">Выберите узел или воспользуйтесь поиском</p>
      <p class="inspector-description" id="inspector-description"></p>
    </aside>
    <div class="architecture-legend" aria-label="Легенда схемы">
      <span class="legend-item"><span class="legend-swatch"></span> размер = уровень владения</span>
      <span class="legend-item"><span class="legend-line"></span> runtime / import</span>
      <span class="legend-item"><span class="legend-line quiet"></span> template / resource / containment</span>
      <span class="legend-item">Колесо: масштаб</span>
      <span class="legend-item">Перетаскивание: обзор</span>
    </div>
    <div class="architecture-minimap-wrap" aria-hidden="true">
      <canvas id="architecture-minimap"></canvas>
    </div>
  </main>
  <script>window.__REBREYA_ARCHITECTURE__ = ${serializedGraph};</script>
  <script>
    (() => {
      "use strict";

      const graph = window.__REBREYA_ARCHITECTURE__;
      const canvas = document.getElementById("architecture-canvas");
      const nodeWorld = document.getElementById("architecture-nodes");
      const edgeWorld = document.getElementById("architecture-edge-world");
      const search = document.getElementById("architecture-search");
      const searchCount = document.getElementById("search-count");
      const fitButton = document.getElementById("fit-graph");
      const clearButton = document.getElementById("clear-selection");
      const minimap = document.getElementById("architecture-minimap");
      const inspectorLabel = document.getElementById("inspector-label");
      const inspectorPath = document.getElementById("inspector-path");
      const inspectorDescription = document.getElementById("inspector-description");
      const meta = document.getElementById("architecture-meta");
      const minimapContext = minimap.getContext("2d");
      const SVG_NS = "http://www.w3.org/2000/svg";
      const domainOrder = new Map(graph.domains.map((domain, index) => [domain.id, index]));
      const nodeById = new Map(graph.nodes.map((node) => [node.id, node]));
      const degree = new Map(graph.nodes.map((node) => [node.id, 0]));
      const adjacency = new Map(graph.nodes.map((node) => [node.id, new Set()]));
      const edgeElements = new Map();
      const nodeElements = new Map();
      const nodeSizes = {
        0: { width: 300, height: 88 },
        1: { width: 330, height: 94 },
        2: { width: 270, height: 76 },
        3: { width: 230, height: 62 },
        4: { width: 190, height: 48 },
        5: { width: 164, height: 40 }
      };
      const transform = { x: 0, y: 0, scale: 1 };
      let selectedId = "";
      let dragging = false;
      let dragPointerId = null;
      let dragStart = null;

      graph.edges.forEach((edge) => {
        degree.set(edge.source, (degree.get(edge.source) || 0) + 1);
        degree.set(edge.target, (degree.get(edge.target) || 0) + 1);
        if (adjacency.has(edge.source)) adjacency.get(edge.source).add(edge.target);
        if (adjacency.has(edge.target)) adjacency.get(edge.target).add(edge.source);
      });

      function sizeFor(node) {
        return nodeSizes[Math.max(0, Math.min(5, Number(node.rank) || 0))];
      }

      function nodeSort(left, right) {
        return (Number(left.rank) || 0) - (Number(right.rank) || 0)
          || (degree.get(right.id) || 0) - (degree.get(left.id) || 0)
          || String(left.path || left.label).localeCompare(String(right.path || right.label), "ru");
      }

      function calculateLayout() {
        const positions = new Map();
        const bands = [];
        const domainIds = graph.domains.map((domain) => domain.id);
        for (const node of graph.nodes) {
          if (!domainOrder.has(node.domain)) domainIds.push(node.domain);
        }
        const uniqueDomains = [...new Set(domainIds)];
        let currentY = 44;
        let maxWidth = 2600;

        for (const domain of uniqueDomains) {
          const domainNodes = graph.nodes.filter((node) => node.domain === domain).sort(nodeSort);
          if (domainNodes.length === 0) continue;
          const prominent = domainNodes.filter((node) => node.rank <= 2 && node.type !== "domain");
          const domainNode = domainNodes.find((node) => node.type === "domain");
          const directories = domainNodes.filter((node) => node.type === "directory");
          const leaves = domainNodes.filter((node) => node.rank >= 3 && node.type !== "directory");
          const leafColumns = leaves.length <= 1
            ? 1
            : Math.max(1, Math.min(${MAX_LEAF_COLUMNS}, Math.ceil(Math.sqrt(leaves.length * 1.9))));
          const leafRows = Math.ceil(leaves.length / leafColumns);
          const directoryColumns = Math.max(1, Math.min(3, Math.ceil(Math.sqrt(Math.max(1, directories.length)))));
          const directoryRows = Math.ceil(directories.length / directoryColumns);
          const prominentHeight = prominent.reduce((sum, node) => sum + sizeFor(node).height + 14, 0);
          const bandHeight = Math.max(190, prominentHeight + 72, directoryRows * 72 + 86, leafRows * 52 + 86);
          const bandWidth = 1510 + leafColumns * 180 + 34;
          maxWidth = Math.max(maxWidth, bandWidth);
          bands.push({ domain, x: 24, y: currentY, width: bandWidth, height: bandHeight });

          let prominentY = currentY + 64;
          for (const node of prominent) {
            const nodeSize = sizeFor(node);
            const x = node.rank === 0 ? 70 : 420;
            positions.set(node.id, { x, y: prominentY, width: nodeSize.width, height: nodeSize.height });
            prominentY += nodeSize.height + 14;
          }

          if (domainNode) {
            const nodeSize = sizeFor(domainNode);
            positions.set(domainNode.id, {
              x: 805,
              y: currentY + Math.max(66, (bandHeight - nodeSize.height) / 2),
              width: nodeSize.width,
              height: nodeSize.height
            });
          }

          directories.forEach((node, index) => {
            const nodeSize = sizeFor(node);
            const column = index % directoryColumns;
            const row = Math.floor(index / directoryColumns);
            positions.set(node.id, {
              x: 1100 + column * 244,
              y: currentY + 66 + row * 72,
              width: nodeSize.width,
              height: nodeSize.height
            });
          });

          leaves.forEach((node, index) => {
            const nodeSize = sizeFor(node);
            const column = index % leafColumns;
            const row = Math.floor(index / leafColumns);
            positions.set(node.id, {
              x: 1510 + column * 180,
              y: currentY + 66 + row * 52,
              width: nodeSize.width,
              height: nodeSize.height
            });
          });

          currentY += bandHeight + 34;
        }

        return {
          positions,
          bands,
          bounds: { x: 0, y: 0, width: maxWidth + 40, height: currentY + 20 }
        };
      }

      const layout = calculateLayout();

      function makeNodeElement(node, position) {
        const element = document.createElement("button");
        element.type = "button";
        element.className = "architecture-node rank-" + node.rank
          + " kind-" + node.kind
          + " domain-" + node.domain;
        element.dataset.nodeId = node.id;
        element.style.left = position.x + "px";
        element.style.top = position.y + "px";
        element.style.width = position.width + "px";
        element.style.height = position.height + "px";
        element.setAttribute("aria-label", node.label + (node.path ? ", " + node.path : ""));

        const label = document.createElement("span");
        label.className = "node-label";
        label.textContent = node.label;
        element.append(label);

        if (node.path && node.rank < 5) {
          const path = document.createElement("span");
          path.className = "node-path";
          path.textContent = node.path;
          element.append(path);
        }

        element.addEventListener("click", (event) => {
          event.stopPropagation();
          selectNode(node.id);
        });
        element.addEventListener("keydown", (event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            selectNode(node.id);
          }
        });
        return element;
      }

      function pathForEdge(source, target) {
        const sourceRight = source.x + source.width;
        const sourceCenterY = source.y + source.height / 2;
        const targetLeft = target.x;
        const targetCenterY = target.y + target.height / 2;
        const forwardDistance = targetLeft - sourceRight;
        if (forwardDistance >= 24) {
          const control = Math.max(38, forwardDistance * 0.48);
          return "M" + sourceRight + "," + sourceCenterY
            + " C" + (sourceRight + control) + "," + sourceCenterY
            + " " + (targetLeft - control) + "," + targetCenterY
            + " " + targetLeft + "," + targetCenterY;
        }
        const bend = 54 + Math.min(150, Math.abs(targetCenterY - sourceCenterY) * 0.18);
        return "M" + sourceRight + "," + sourceCenterY
          + " C" + (sourceRight + bend) + "," + sourceCenterY
          + " " + (targetLeft - bend) + "," + targetCenterY
          + " " + targetLeft + "," + targetCenterY;
      }

      function renderGraph() {
        const bandFragment = document.createDocumentFragment();
        for (const band of layout.bands) {
          const element = document.createElement("div");
          element.className = "domain-band";
          element.style.left = band.x + "px";
          element.style.top = band.y + "px";
          element.style.width = band.width + "px";
          element.style.height = band.height + "px";
          const label = document.createElement("span");
          label.className = "domain-band-label";
          const domain = graph.domains.find((entry) => entry.id === band.domain);
          label.textContent = domain ? domain.label + " · " + domain.fileCount : band.domain;
          element.append(label);
          bandFragment.append(element);
        }
        nodeWorld.append(bandFragment);

        const nodeFragment = document.createDocumentFragment();
        for (const node of graph.nodes) {
          const position = layout.positions.get(node.id);
          if (!position) continue;
          const element = makeNodeElement(node, position);
          nodeElements.set(node.id, element);
          nodeFragment.append(element);
        }
        nodeWorld.append(nodeFragment);

        const edgeFragment = document.createDocumentFragment();
        graph.edges.forEach((edge, index) => {
          const source = layout.positions.get(edge.source);
          const target = layout.positions.get(edge.target);
          if (!source || !target) return;
          const path = document.createElementNS(SVG_NS, "path");
          path.setAttribute("d", pathForEdge(source, target));
          path.setAttribute("class", "architecture-edge kind-" + edge.kind);
          const quiet = ["resource", "template", "test", "contains"].includes(edge.kind);
          path.setAttribute("marker-end", quiet ? "url(#architecture-arrow-quiet)" : "url(#architecture-arrow)");
          path.dataset.edgeIndex = String(index);
          edgeElements.set(index, path);
          edgeFragment.append(path);
        });
        edgeWorld.append(edgeFragment);
      }

      function applyTransform() {
        const cssTransform = "translate(" + transform.x + "px, " + transform.y + "px) scale(" + transform.scale + ")";
        nodeWorld.style.transform = cssTransform;
        edgeWorld.setAttribute("transform", "translate(" + transform.x + " " + transform.y + ") scale(" + transform.scale + ")");
        drawMinimap();
      }

      function fitGraph() {
        const rect = canvas.getBoundingClientRect();
        const padding = 42;
        const scale = Math.min(
          0.92,
          Math.max(0.025, (rect.width - padding * 2) / layout.bounds.width),
          Math.max(0.025, (rect.height - padding * 2) / layout.bounds.height)
        );
        transform.scale = scale;
        transform.x = (rect.width - layout.bounds.width * scale) / 2;
        transform.y = (rect.height - layout.bounds.height * scale) / 2;
        applyTransform();
      }

      function centerNode(nodeId) {
        const position = layout.positions.get(nodeId);
        if (!position) return;
        const rect = canvas.getBoundingClientRect();
        transform.scale = Math.max(${MIN_FOCUS_SCALE}, Math.min(${MAX_FOCUS_SCALE}, transform.scale));
        transform.x = rect.width / 2 - (position.x + position.width / 2) * transform.scale;
        transform.y = rect.height / 2 - (position.y + position.height / 2) * transform.scale;
        applyTransform();
      }

      function setInspector(node) {
        if (!node) {
          inspectorLabel.textContent = "Вся схема";
          inspectorPath.textContent = "Выберите узел или воспользуйтесь поиском";
          inspectorDescription.textContent = "";
          return;
        }
        inspectorLabel.textContent = node.label;
        inspectorPath.textContent = node.path || node.kind;
        const facts = [];
        if (Number.isFinite(node.lines)) facts.push(node.lines + " строк");
        if (Number.isFinite(node.size)) facts.push(node.size.toLocaleString("ru-RU") + " байт");
        const suffix = facts.length ? " · " + facts.join(" · ") : "";
        inspectorDescription.textContent = (node.description || "") + suffix;
      }

      function clearSelection() {
        selectedId = "";
        canvas.classList.remove("has-selection");
        nodeElements.forEach((element) => element.classList.remove("is-selected", "is-related"));
        edgeElements.forEach((element) => element.classList.remove("is-related"));
        setInspector(null);
      }

      function selectNode(nodeId, center = false) {
        if (!nodeById.has(nodeId)) return;
        clearSelection();
        selectedId = nodeId;
        canvas.classList.add("has-selection");
        const related = adjacency.get(nodeId) || new Set();
        const selectedElement = nodeElements.get(nodeId);
        if (selectedElement) selectedElement.classList.add("is-selected", "is-related");
        related.forEach((id) => nodeElements.get(id)?.classList.add("is-related"));
        graph.edges.forEach((edge, index) => {
          if (edge.source === nodeId || edge.target === nodeId) {
            edgeElements.get(index)?.classList.add("is-related");
          }
        });
        setInspector(nodeById.get(nodeId));
        if (center) centerNode(nodeId);
      }

      function updateSearch() {
        const query = search.value.trim().toLocaleLowerCase("ru");
        nodeElements.forEach((element) => element.classList.remove("is-search-match"));
        if (!query) {
          searchCount.textContent = "";
          return [];
        }
        const matches = graph.nodes.filter((node) => [node.label, node.path, node.description]
          .some((value) => String(value || "").toLocaleLowerCase("ru").includes(query)));
        matches.forEach((node) => nodeElements.get(node.id)?.classList.add("is-search-match"));
        searchCount.textContent = String(matches.length);
        return matches;
      }

      function resizeMinimap() {
        const rect = minimap.getBoundingClientRect();
        const ratio = window.devicePixelRatio || 1;
        minimap.width = Math.max(1, Math.round(rect.width * ratio));
        minimap.height = Math.max(1, Math.round(rect.height * ratio));
        minimapContext.setTransform(ratio, 0, 0, ratio, 0, 0);
      }

      function drawMinimap() {
        const miniRect = minimap.getBoundingClientRect();
        if (!miniRect.width || !miniRect.height) return;
        const ratioX = miniRect.width / layout.bounds.width;
        const ratioY = miniRect.height / layout.bounds.height;
        const ratio = Math.min(ratioX, ratioY);
        const offsetX = (miniRect.width - layout.bounds.width * ratio) / 2;
        const offsetY = (miniRect.height - layout.bounds.height * ratio) / 2;
        minimapContext.clearRect(0, 0, miniRect.width, miniRect.height);
        minimapContext.fillStyle = "#111214";
        minimapContext.fillRect(0, 0, miniRect.width, miniRect.height);
        minimapContext.fillStyle = "rgba(255,255,255,0.055)";
        layout.bands.forEach((band) => {
          minimapContext.fillRect(
            offsetX + band.x * ratio,
            offsetY + band.y * ratio,
            band.width * ratio,
            Math.max(1, band.height * ratio)
          );
        });
        minimapContext.fillStyle = "rgba(210,215,223,0.48)";
        layout.positions.forEach((position) => {
          minimapContext.fillRect(
            offsetX + position.x * ratio,
            offsetY + position.y * ratio,
            Math.max(1, position.width * ratio),
            Math.max(1, position.height * ratio)
          );
        });
        const canvasRect = canvas.getBoundingClientRect();
        const viewX = -transform.x / transform.scale;
        const viewY = -transform.y / transform.scale;
        const viewWidth = canvasRect.width / transform.scale;
        const viewHeight = canvasRect.height / transform.scale;
        minimapContext.strokeStyle = "#d9b96e";
        minimapContext.lineWidth = 1.5;
        minimapContext.strokeRect(
          offsetX + viewX * ratio,
          offsetY + viewY * ratio,
          viewWidth * ratio,
          viewHeight * ratio
        );
      }

      canvas.addEventListener("pointerdown", (event) => {
        if (event.target.closest(".architecture-node")) return;
        dragging = true;
        dragPointerId = event.pointerId;
        dragStart = { x: event.clientX, y: event.clientY, tx: transform.x, ty: transform.y };
        canvas.classList.add("is-dragging");
        canvas.setPointerCapture(event.pointerId);
      });

      canvas.addEventListener("pointermove", (event) => {
        if (!dragging || event.pointerId !== dragPointerId) return;
        transform.x = dragStart.tx + event.clientX - dragStart.x;
        transform.y = dragStart.ty + event.clientY - dragStart.y;
        applyTransform();
      });

      function stopDragging(event) {
        if (!dragging || event.pointerId !== dragPointerId) return;
        dragging = false;
        dragPointerId = null;
        canvas.classList.remove("is-dragging");
      }

      canvas.addEventListener("pointerup", stopDragging);
      canvas.addEventListener("pointercancel", stopDragging);
      canvas.addEventListener("wheel", (event) => {
        event.preventDefault();
        const rect = canvas.getBoundingClientRect();
        const pointerX = event.clientX - rect.left;
        const pointerY = event.clientY - rect.top;
        const worldX = (pointerX - transform.x) / transform.scale;
        const worldY = (pointerY - transform.y) / transform.scale;
        const factor = Math.exp(-event.deltaY * 0.0013);
        const nextScale = Math.max(0.025, Math.min(2.5, transform.scale * factor));
        transform.x = pointerX - worldX * nextScale;
        transform.y = pointerY - worldY * nextScale;
        transform.scale = nextScale;
        applyTransform();
      }, { passive: false });

      search.addEventListener("input", updateSearch);
      search.addEventListener("keydown", (event) => {
        if (event.key !== "Enter") return;
        const matches = updateSearch();
        if (matches[0]) selectNode(matches[0].id, true);
      });
      fitButton.addEventListener("click", fitGraph);
      clearButton.addEventListener("click", () => {
        search.value = "";
        updateSearch();
        clearSelection();
      });
      document.addEventListener("keydown", (event) => {
        if (event.key === "Escape") clearSelection();
      });
      window.addEventListener("resize", () => {
        resizeMinimap();
        drawMinimap();
      });

      const commit = String(graph.meta.sourceCommit || "").slice(0, 10);
      meta.textContent = graph.meta.trackedFileCount.toLocaleString("ru-RU")
        + " файлов · " + graph.nodes.length.toLocaleString("ru-RU")
        + " узлов · " + graph.edges.length.toLocaleString("ru-RU")
        + " связей · commit " + commit;
      renderGraph();
      resizeMinimap();
      fitGraph();
    })();
  </script>
</body>
</html>
`;
}
