# Rebreya Gray-Gold Theme Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Convert Rebreya utility windows to an inherited dnd5e-inspired gray and gold theme without changing layout or behavior, while preserving Trader v2's standalone parchment theme.

**Architecture:** Define primitive and semantic theme tokens in `styles/main.css`, keep existing variables as compatibility aliases, then replace legacy brown and turquoise literals with the shared tokens. A focused Node test enforces the token contract and prevents the old palette from returning.

**Tech Stack:** CSS custom properties, Foundry VTT ApplicationV2 styles, Node.js test runner.

---

### Task 1: Theme Contract Test

**Files:**
- Create: `tests/style-theme.test.mjs`

- [ ] Add a Node test that reads `styles/main.css` and asserts the semantic surface, border, text, and accent tokens exist.
- [ ] Assert `--rm-bg`, `--rm-panel`, `--rm-border`, `--rm-text`, and `--rm-muted` remain as aliases to the new token roles.
- [ ] Assert the window surface references `/ui/denim075.png`.
- [ ] Assert the dominant legacy brown and turquoise literals are absent.
- [ ] Run `node --test tests/style-theme.test.mjs` and confirm it fails on the current stylesheet.

### Task 2: Semantic Theme Foundation

**Files:**
- Modify: `styles/main.css:1-27`

- [ ] Add the primitive gray and gold color tokens derived from dnd5e.
- [ ] Add semantic window, panel, row, input, border, and text tokens.
- [ ] Redirect the existing `--rm-*` compatibility variables to semantic roles.
- [ ] Replace the root window background with the denim surface token.
- [ ] Run `node --test tests/style-theme.test.mjs` and confirm only legacy-literal assertions remain failing.

### Task 3: Component Color Migration

**Files:**
- Modify: `styles/main.css`

- [ ] Replace repeated brown panel backgrounds with `--rm-surface-*` tokens.
- [ ] Replace repeated brown borders with `--rm-border-*` tokens.
- [ ] Replace cream text literals with `--rm-text-*` tokens.
- [ ] Replace turquoise decorative accents with neutral gold tokens.
- [ ] Preserve all `.rebreya-trader-app-v2` and `.rm-trader-v2-*` rules as a standalone local theme.
- [ ] Preserve semantic success, warning, and danger colors.
- [ ] Run `node --test tests/style-theme.test.mjs` and confirm it passes.

### Task 4: Verification And Release

**Files:**
- Modify: `module.json`
- Modify: `scripts/main.js`
- Create: next cache-busted `scripts/main-<version>.js`

- [ ] Run `git diff --check`.
- [ ] Run `node --test tests\\*.test.mjs` and confirm all tests pass.
- [ ] Open representative Rebreya windows in Foundry and inspect window, panel, row, input, hover, selected, success, warning, and danger states.
- [ ] Bump the module patch version and create the matching cache-busted entrypoint.
- [ ] Commit and push `lich_branch` without force.
