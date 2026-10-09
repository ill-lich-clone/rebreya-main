# Hero Doll Two Columns — report

Spec: `docs/superpowers/specs/2026-10-09-hero-doll-two-columns.md`.
Plan: `docs/superpowers/plans/2026-10-09-hero-doll-two-columns.md`.

Result: release1.4.367 always keeps doll left and inventory right. Single scoped grid has panel minima420/220px and gap14px; root scrolls horizontally below654px content width. Removed every layout breakpoint override. Anatomical68px slots, all Actor behavior, templates and existing ESM cache keys preserved. Updated forwarder/module/stylesheet cache and current passport descriptions.

Verification:

- Existing regression changed to enforce explicit user contract. RED:3 layout rules instead of1; GREEN `node --test tests/hero-doll-ui.test.mjs tests/module-manifest.test.mjs tests/main-composition-root.test.mjs` —55/55.
- Browser rendered actual hero-doll-tab.hbs using Handlebars and full current main.css in an isolated fixture (no live world/Actor mutation). Widths400/650/744/1000/1400px: two tracks, stock right and same row, horizontal scroll reaches inventory in narrow containers. Separate400px browser viewport preserves both tracks. Only console error was fixture favicon404. Task browser tab and local QA server closed afterward.
- Full `node --test tests/*.test.mjs` with Foundry NODE_PATH —4452/4452, zero failed/skipped.
- Tracked JS/MJS plus new forwarder `node --check` —937 files, zero failures; tracked JSON parse —55 files, zero failures. `git diff --check` passed.
- Fresh Astra review found no runtime issues; obsolete stacking statement in passport corrected under mandatory current-state documentation requirement. No deferred findings/unresolved rulings. Actual Foundry-world visual QA remains user-performed as previously agreed.

Task1 complete: RED→GREEN, browser layout verified, full checks passed. Commit/push receipt is in task final response.
