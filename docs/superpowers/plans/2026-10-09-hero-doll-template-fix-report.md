# Hero Doll Template Fix — report

Spec: `docs/superpowers/specs/2026-10-09-hero-doll-template-fix.md`.
Plan: `docs/superpowers/plans/2026-10-09-hero-doll-template-fix.md`.

Root cause verified in installed Foundry server Files.loadTemplate: socket template paths pass directly through path.extname whitelist; `.hbs?v=1.4.365` fails. Earlier tests enforced a browser-style URL instead of this server contract. Canonical `.hbs` path now used for character and NPC, with unchanged content/Actor behavior. Release1.4.366 and sheet ESM cache key updated; unchanged hero service retains its prior cache key. Page reload reloads the template through Foundry's socket loader.

Regression RED observed: registered template extension rejected. GREEN: 191/191 focused tests, 4452/4452 full tests (`node --test tests/*.test.mjs`, NODE_PATH=installed Foundry node_modules), zero failures/skips. `node --check`:936 JS/MJS files, zero failures. Tracked JSON parse:55 files, zero failures. `git diff --check` passed.

Fresh Astra review: clean, independently reran changed suites (127/127). No deferred findings or unresolved rulings. Live world rendering remains user-verified, as agreed earlier.

Task1 complete: root cause → failing regression → minimal fix → full verification. Commit and push receipt recorded in the task final response.
