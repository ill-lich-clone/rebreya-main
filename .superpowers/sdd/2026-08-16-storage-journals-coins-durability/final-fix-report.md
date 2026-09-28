# Final fix wave: storage Journals, ground coins, durability

## Scope

- Base commit: `fa85cc01a8734635bd03bbd6ced206f507c8ef4a`.
- Final commit: the commit containing this report (the literal SHA is reported after commit because a commit cannot contain its own hash).
- Journal text is sanitized on the active-GM side through the injected inert-template parser before the socket response. Foundry document metadata and standard open/drag/roll affordances are removed; parsing, querying, sanitization, and serialization fail closed.
- Ground-pile `manualCoins` merge performs checked `pp/gp/sp/cp` addition inside the existing per-scene FIFO before write. Overflow rejects without changing the token; `Number.MAX_SAFE_INTEGER` remains valid.
- Durability has an explicit regression for a valid stable built-in Coin flag combined with mutable `sourceType: "gear"`; production durability rules were already correct.

## TDD evidence

### Journal sanitizer

- RED: `node --test tests/storage-journal-reader.test.mjs`
  - 6 tests: 4 passed, 2 failed for the expected missing behavior.
  - Failures: enriched document identifiers/affordances remained in returned HTML; missing query/serialization adapter capabilities did not fail closed.
- GREEN: `node --test tests/storage-journal-reader.test.mjs`
  - 6 passed, 0 failed.

### Checked manual coin addition

- RED: `node --test tests/storage-ground-pile-service.test.mjs`
  - 18 tests: 17 passed, 1 failed for the expected missing rejection of an unsafe cumulative balance.
- GREEN: `node --test tests/storage-ground-pile-service.test.mjs`
  - 18 passed, 0 failed.
- Task 9 rollback GREEN: `node --test tests/storage-socket.test.mjs`
  - 54 passed, 0 failed.
  - The regression uses the real embedded managed-Coin source adapter: the source Item is deleted on consume and restored with `keepId: true` when ground transfer rejects overflow.

### Durability regression

- `node --test tests/durability-rules.test.mjs`
  - 26 passed, 0 failed.
  - Test-only change; no production RED was required because the stable Coin flag already had precedence over mutable `sourceType`.

### Focused cluster

- `node --test tests/storage-journal-reader.test.mjs tests/storage-ground-pile-service.test.mjs tests/storage-socket.test.mjs tests/durability-rules.test.mjs`
  - 104 passed, 0 failed.

## Final verification

- `node --test tests/*.test.mjs`
  - Invoked exactly once. The tool yielded after 30 seconds and truncated the long output before Node's final summary; the returned tool result did not include an exit code (`undefined`). The spawned test process subsequently exited, but its final passed/failed count and exit code were not recoverable. No count or success claim is inferred from partial output.
- Tracked JS/MJS syntax: 444 checked, 0 failed.
- Tracked JSON parsing: 30 checked, 0 failed.
- `git diff --check`: 0 errors.

## Files

- `scripts/data/storage-journal-reader.js`
- `scripts/data/storage-ground-pile-service.js`
- `tests/storage-journal-reader.test.mjs`
- `tests/storage-ground-pile-service.test.mjs`
- `tests/storage-socket.test.mjs`
- `tests/durability-rules.test.mjs`
- `docs/function-passport.md` (section 8 contract updates only)
- `.superpowers/sdd/2026-08-16-storage-journals-coins-durability/final-fix-report.md`

## Concerns

- The full-suite result is indeterminate solely because the tool output/session was truncated before the final summary. Focused tests and all static syntax/JSON checks completed with zero failures.
- README was not changed: no public API surface changed.
