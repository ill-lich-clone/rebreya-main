# Mastery Extra Mounts Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans. Implement each behavior with a failing focused regression first.

**Goal:** Give firearm masters extra attachment mounts equal to proficiency and display them below the blueprint.

**Architecture:** Extend the existing weapon-mod descriptor, validation, reciprocal links, authenticated command and panel. Separate current installation entitlement from durable previously installed mounts so transfers and proficiency changes do not discard attachments.

**Tech Stack:** Foundry VTT 13, dnd5e, ES modules, Node test runner.

**Spec:** `docs/superpowers/specs/2026-10-29-mastery-extra-mounts-design.md`

## Global Constraints

- Preserve original topology, paid rebuild, quantities, compatibility, duplicate policy, socket authentication, runtime graphs and old journal fingerprints.
- Extra mounts correspond exactly to current integer proficiency for a feat owner; existing occupied extras remain readable/removable when entitlement decreases.
- Preserve two-mount attachment occupancy and validate selected IDs on the active GM under the existing actor lock.
- Version the module and update every dependent cache key consistently; update the weapon-mod passport.

## Review Focus

- Bonus decreases or feat removal while one or more extras are occupied, including transfer to a new owner.
- Forged extra IDs, a request for a locked slot, duplicate slots, and an exhausted capacity.
- Two-mount attachments spanning ordinary and extra places, linked indicators, removal and paid rebuild.
- Concurrent installation/retry after a changed proficiency and unchanged legacy operation fingerprints.
- 0, 3, 6 and 7 proficiency; responsive panel geometry and no blueprint anchor regressions.

### Task 1: Rule and persistence

**Files:** `scripts/data/weapon-mod-rules.js`, `scripts/data/item-upgrade-service.js`, `scripts/data/weapon-rebuild-rules.js`, `scripts/application/weapon-mod-mutation-commands.js`, relevant tests.

- [ ] Add failing tests for exact BM-derived extra IDs, ordinary actors, malformed values, locked/occupied mounts and mixed two-slot attachment.
- [ ] Distinguish currently authorized mount IDs from valid installed historical IDs; validate mutations using fresh Actor state and preserve installed links across ownership/feat/BM changes.
- [ ] Extend exact command validation and fingerprint handling; test replay, concurrency, removal, rebuild and inventory transfer.

### Task 2: Panel

**Files:** `scripts/integrations/weapon-mod-panel.js`, `styles/main.css`, `tests/weapon-mod-panel.test.mjs`.

- [ ] Write failing tests for the 3-column grid, active and occupied historical extra slots, labels, link indicators and original blueprint rendering.
- [ ] Reuse the existing mount action/drag/drop/chooser bindings; keep the grid outside the original blueprint and its anchor manifest.
- [ ] Run focused rules, mutation, graph, blueprint and panel tests; exercise visible UI in the authenticated browser without changing player inventory.

### Task 3: Finish

- [ ] Update `docs/weapon-mods-function-passport.md`, the module manifest, forwarder and cache graph; retain existing entrypoint compatibility.
- [ ] Obtain independent code review, fix actionable findings with regression tests.
- [ ] Run `node --test tests/*.test.mjs`, JS/MJS syntax and JSON checks, `git diff --check`, review the task diff, commit task files and push `lich_branch`.
