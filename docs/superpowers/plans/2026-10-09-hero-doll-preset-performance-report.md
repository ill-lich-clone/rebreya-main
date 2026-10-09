# Preset performance/diagnostics — report

Spec: `docs/superpowers/specs/2026-10-09-hero-doll-preset-performance.md`.
Plan: `docs/superpowers/plans/2026-10-09-hero-doll-preset-performance.md`.

Release1.4.368 reduces overhead without removing checks: resolved Actors reused per write/verify pass; fresh Item collection reads preserved; doll/preset Actor flags written together; forward preset Item placements use render:false, final Actor render/hooks/broadcast and rollback options remain unchanged. All unchanged receipts still verified. Write CAS repeated after authority await prevents an unrelated edit being overwritten.

Original batch failure now saved in durable checkpoint and retained through terminal retry/resumed rollback failure. Safe compensation notification adds original reason; field mismatch adds document UUID/paths. User's specific runtime rollback cause and real elapsed latency remain unknown until reproduction. These changes do not claim to fix an unobserved original cause.

Evidence:

- Four new performance/diagnostic regressions observed RED, then GREEN. Controlled fixture: Actor resolutions8→3; Actor document writes2→1 when both doll/preset flags differ; Item render:false, final Actor render preserved.
- Foreign Actor edit during awaited authority check reproduced as overwrite (RED), now rejects/preserves foreign field (GREEN).
- Fresh Astra review found P2: resumed compensation could overwrite stored original cause with empty failure. Regression RED confirmed EIO/original message became write-failed/empty; fix preserves current/record failure, GREEN. No deferred findings or unresolved rulings.
- Focused `node --test tests/hero-doll-*.test.mjs tests/item-instance-*.test.mjs tests/module-manifest.test.mjs tests/main-composition-root.test.mjs` —146/146 passed, zero skipped.
- Final full `node --test tests/*.test.mjs` with installed Foundry NODE_PATH —4458/4458 passed, zero failed/skipped. Prior full run4457/4457 before final review regression.
- `node --check`:938 tracked JS/MJS plus new forwarder, zero failures; changed workflow/test rechecked after review fix. JSON parse55/55; diff check passed.
- Gemini provided a concise independent bottleneck/uncertainty analysis; verified actual Foundry ClientDocument descendant-update render:false behavior from installed source.

Task1 complete; runtime diagnosis requires user's next reproduction. Commit/push receipt recorded in task final response.
