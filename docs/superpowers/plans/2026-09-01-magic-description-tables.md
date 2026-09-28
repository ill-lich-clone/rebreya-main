# Magic Description Tables Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make multiline magic-item and feat descriptions readable, restore 39 verified magic-item tables, and make the equipment importer reject future structural table loss.

**Architecture:** A tracked JSON contract owns only table structure and dnd.su provenance, while spreadsheet prose remains sheet-owned. A pure importer normalizer validates each declared legacy block and converts it to canonical Markdown; the shared renderer turns Markdown into escaped HTML, while trusted feat HTML receives only table-cell newline normalization.

**Tech Stack:** Node.js ESM, Node test runner, Foundry VTT 13/dnd5e, JSON data, existing deterministic equipment importer.

**Spec:** User-approved design in the 2026-09-01 task conversation; source pages are the dnd.su item URLs stored per contract entry.

## Global Constraints

- Work only on `lich_branch`; do not touch unrelated worktree changes.
- Do not fetch dnd.su during normal imports; imports must remain deterministic and offline-capable.
- Keep spreadsheet prose sheet-owned; the sidecar owns table structure only.
- A missing header, row, or column is a fatal import diagnostic before transactional output replacement.
- Preserve UTF-8 Russian text and existing visible description text.
- Bump `module.json`, add the matching versioned forwarder, and update `docs/function-passport.md`.

---

### Task 1: Structural Contract and Pure Normalizer

**Files:**
- Create: `data/magic-item-description-tables.json`
- Create: `tools/equipment-import/magic-item-description-tables.mjs`
- Test: `tests/equipment-import-magic-item-description-tables.test.mjs`

**Interfaces:**
- Consumes: raw contract JSON and `{stableId,itemName,description,context,diagnostics}`.
- Produces: `validateMagicItemDescriptionTableContracts(raw)` and `normalizeMagicItemDescriptionTables(args)` returning canonical Markdown.

- [ ] **Step 1: Write failing tests** for ordinary spaced rows, repeated tables, `key-plus-spaced` rows, `paired-lines` rows, and fatal `magic-item-description-table-structure` diagnostics.
- [ ] **Step 2: Run `node --test tests/equipment-import-magic-item-description-tables.test.mjs`** and confirm failure because the module does not exist.
- [ ] **Step 3: Implement the contract parser and normalizer** with the contract shape below:

```json
{
  "schemaVersion": 1,
  "items": {
    "stable-id": {
      "sourceUrl": "https://dnd.su/items/example/",
      "tables": [
        { "header": ["к100", "Эффект"], "rowCount": 3, "layout": "spaced-lines" }
      ]
    }
  }
}
```

The normalizer must emit `| header |`, `| --- |`, and escaped Markdown rows without changing prose outside matched blocks.
- [ ] **Step 4: Seed all 36 items / 39 tables** including two Cube of Force tables, three Bag of Tricks tables, and the split Deck of Wild Cards table.
- [ ] **Step 5: Run the focused test** and confirm all cases pass.

### Task 2: Importer Integration and Catalog Migration

**Files:**
- Modify: `tools/import-equipment.mjs`
- Modify: `tools/equipment-import/pipeline.mjs`
- Modify: `tools/equipment-import/adapters/magic-items.mjs`
- Modify: `magicItem.js`
- Test: `tests/equipment-import-magic-items.test.mjs`

**Interfaces:**
- Consumes: validated `descriptionTableContracts` loaded by the CLI.
- Produces: the unchanged magic-item record contract except `description` is normalized canonical Markdown when a structural contract exists.

- [ ] **Step 1: Add failing adapter tests** proving a matching table becomes Markdown and a flattened/missing row fails with sheet row/column context.
- [ ] **Step 2: Run `node --test tests/equipment-import-magic-items.test.mjs`** and confirm the new assertions fail.
- [ ] **Step 3: Load and validate `data/magic-item-description-tables.json`** in the CLI, pass it through `buildEquipmentBundle`, and call `normalizeMagicItemDescriptionTables` immediately after stable-ID resolution.
- [ ] **Step 4: Mechanically normalize the current generated `magicItem.js`** through the same pure normalizer and deterministic serializer; do not hand-edit table rows.
- [ ] **Step 5: Run both importer focused tests** and confirm every declared contract matches the current 655-item catalog.

### Task 3: Runtime Rendering for Magic Items and Feats

**Files:**
- Modify: `scripts/data/magic-items-compendium.js`
- Modify: `scripts/data/feats-compendium.js`
- Modify: `scripts/data/markdown-description.js`
- Test: `tests/markdown-description.test.mjs`
- Test: `tests/magic-items-compendium.test.mjs`
- Test: `tests/feats-compendium.test.mjs`

**Interfaces:**
- Consumes: canonical Markdown magic descriptions and either trusted HTML or plain-text/Markdown feat descriptions.
- Produces: `renderDescriptionMarkdown(value)` HTML and `renderFeatDescription(value)` HTML.

- [ ] **Step 1: Add failing renderer tests** for paragraphs plus a Markdown table, HTML escaping, preservation of feat HTML tables, and literal newlines inside `<td>` becoming `<br>`.
- [ ] **Step 2: Run the three focused test files** and confirm only the new behavior fails.
- [ ] **Step 3: Replace magic-item one-paragraph escaping** with `renderDescriptionMarkdown(item.description)` and keep metadata escaping unchanged.
- [ ] **Step 4: Implement and use `renderFeatDescription(value)`**: detect existing HTML, replace newlines only inside `td`/`th` content with `<br>`, otherwise call the shared Markdown renderer.
- [ ] **Step 5: Increment `MAGIC_TEMPLATE_VERSION` and `FEAT_TEMPLATE_VERSION`**, then rerun focused tests.

### Task 4: Version, Passport, Verification, and Delivery

**Files:**
- Modify: `module.json`
- Create: `scripts/main-1.4.202.js`
- Modify: `docs/function-passport.md`

**Interfaces:**
- Produces: client cache invalidation and current documentation for every changed/new method.

- [ ] **Step 1: Set module version to `1.4.202`**, point `esmodules` at `scripts/main-1.4.202.js`, and make that file import only `./main.js`.
- [ ] **Step 2: Update the passport** with contract validation, normalization data flow, fatal diagnostic behavior, renderer ownership, and focused tests.
- [ ] **Step 3: Run focused tests**, then `node --test tests/*.test.mjs`, `git diff --check`, `node --check` for tracked JS/MJS, and UTF-8 JSON parsing for tracked JSON.
- [ ] **Step 4: Review `git diff --stat` and substantive `git diff`**, ensuring unrelated files are absent.
- [ ] **Step 5: Stage only task files, commit with an explicit message, and push `lich_branch` without force.**
