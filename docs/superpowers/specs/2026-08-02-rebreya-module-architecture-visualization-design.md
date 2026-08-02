# Rebreya Module Architecture Visualization Design

## Goal

Create one large standalone HTML document that visualizes the complete tracked module as a left-to-right architectural diagram. The first view must make architectural ownership obvious: entrypoints and composition blocks dominate visually, subsystem owners are smaller, and individual files and resources are the smallest nodes.

The deliverable will be `docs/rebreya-module-architecture.html` and must open directly in a modern browser without Foundry VTT or a local server.

## Scope

The diagram includes every file returned by `git ls-files`, except the generated visualization itself. This includes runtime JavaScript, Handlebars templates, JSON data, styles, localization, tests, tools, documentation, and binary assets. Every file is visible in the initial graph; no group is collapsed.

The visualization distinguishes architectural relationships from simple containment:

- manifest entrypoint declarations;
- JavaScript module imports;
- Foundry lifecycle registration and initialization;
- construction and ownership by `RebreyaMainModule`;
- UI-to-template references;
- runtime references to JSON, styles, localization, and assets;
- test imports and directly identifiable source-under-test relationships;
- directory containment for files without a stronger runtime edge.

Generated, local-only, and Git-internal content such as `.git/` is not part of the module snapshot.

## Composition

The canvas flows left to right through five visual ranks:

1. Manifest and Foundry lifecycle: `module.json`, `init`, `setup`, and `ready`.
2. Composition root: `scripts/main.js`, `RebreyaMainModule`, public API, socket dispatch, and initialization.
3. Major architectural domains: application, infrastructure, data/engine, trading, combat/automation, integrations, UI, templates, resources, tests, tools, and documentation.
4. Subsystem owners and important services, applications, registries, repositories, runtimes, and integration adapters.
5. Individual source files, templates, data files, styles, localization files, tests, tools, documents, and assets.

Major blocks use greater width, height, label weight, and visual emphasis. Subsystem blocks are medium-sized. Leaf files are compact. Size communicates hierarchy; color communicates node type only.

Large domains form subtle background bands so the complete graph remains navigable without hiding any nodes. Nodes within each band are ordered to reduce edge crossings, with high-degree owners placed before peripheral leaves.

## Data model

The HTML embeds a static architecture snapshot as JavaScript data. Each node contains:

- stable ID;
- displayed label and repository-relative path;
- architectural rank and domain;
- node kind;
- source line count or asset size when available;
- short responsibility description for known owners.

Each edge contains source, target, relationship kind, and optional source location. Import and lifecycle edges are primary. Ownership, template, data, test, and containment edges use progressively quieter styling.

The snapshot is derived from repository contents rather than an invented architecture. Descriptions for key owners are taken from code and the current README; ambiguous files retain neutral file-level labels.

## Visual language

The page follows the supplied reference:

- dark near-black canvas;
- charcoal nodes with light text;
- thin pale connectors with arrowheads;
- restrained accent colors for architectural categories;
- square or lightly rounded rectangular nodes;
- generous horizontal spacing and compact vertical spacing;
- no decorative dashboard cards or unrelated metrics.

Entrypoints and composition nodes receive the strongest contrast. Directory and domain bands are muted. File nodes remain legible at working zoom and reduce to recognizable blocks at overview zoom.

## Interaction

All content is expanded on load. Interaction changes only the view, never node visibility:

- mouse wheel or trackpad zoom centered on the pointer;
- drag empty canvas to pan;
- click a node to emphasize its direct incoming and outgoing relationships;
- search by filename, class, service, or relative path;
- search results stay visible and are brought into view without hiding other nodes;
- reset/fit button returns to the complete graph;
- a minimap shows the current viewport within the full canvas;
- keyboard-accessible search, node selection, and reset controls;
- a compact legend explains node and edge types.

The initial viewport fits the complete architecture. Users zoom into dense areas for filenames and relationships.

## Implementation constraints

- One self-contained HTML file with embedded CSS, JavaScript, graph data, and SVG markers.
- No network requests, external libraries, CDN dependencies, or Foundry runtime dependencies.
- The graph uses an HTML node layer and an SVG edge layer under one shared transform so thousands of nodes remain selectable while connectors stay lightweight.
- Layout is calculated deterministically from architectural rank, domain, hierarchy, and degree. Reloading the document produces the same placement.
- Binary files are represented as metadata nodes; their contents are not embedded.
- Labels and controls remain readable in both Chromium and Firefox.
- The document records the source commit and generation timestamp so the snapshot's age is explicit.

## Verification

Before delivery:

1. Compare embedded file paths with `git ls-files` and verify that every tracked file in scope has exactly one node.
2. Verify that all edge endpoints exist and node IDs are unique.
3. Check JavaScript syntax and parse the HTML with the available local tooling.
4. Open the document in a browser and confirm that the complete graph renders.
5. Exercise pan, zoom, search, selection highlighting, minimap, and fit-to-view.
6. Inspect representative paths through lifecycle, inventory, trading, combat automation, integrations, UI/templates, data, tests, and assets.
7. Run `git diff --check` and the repository's relevant automated checks.

## Deliverable boundary

This work documents the current architecture. It does not refactor module code, change runtime behavior, modify Foundry settings, or add a new runtime entrypoint.
