# Storage Token Vision and Transfer Chat Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Disable Token Vision for every storage/item scene token created by Rebreya Main and publish one safe public ChatMessage after each successful self/party storage claim.

**Architecture:** Storage token creation remains owned by the existing built-in actor, ground-pile, portable-container, and storage-source recovery services; each creation boundary writes `sight.enabled: false` without touching ordinary actors or tokens. Claim presentation remains inside the authoritative `StorageCommandService`, which receives the composition-root ChatMessage creator, publishes only after a changed claim, and relies on the existing mutation result cache for exactly-once behavior.

**Tech Stack:** Foundry VTT 13 token data, dnd5e, JavaScript ES modules, Node.js test runner.

## Global Constraints

- Work only on `lich_branch`; no force push and no direct commit to `main` or `master`.
- Privileged storage mutation remains active-GM-only and routed through existing typed commands.
- `scripts/main.js` remains the only composition root; versioned forwarders remain import-only.
- Do not create another storage owner or notification subsystem.
- Journal rows remain reference-only and cannot be claimed, materialized, or announced as received.
- Messages must contain only escaped presentation fields, never source UUIDs, internal flags, or Journal documents.
- New and changed methods must be reflected in `docs/function-passport.md`.

---

### Task 1: Storage scene tokens never provide vision

**Files:**
- Modify: `tests/builtin-storage-actor-service.test.mjs`
- Modify: `tests/storage-ground-pile-service.test.mjs`
- Modify: `tests/storage-container-item-service.test.mjs`
- Modify: `tests/storage-deposit-source.test.mjs`
- Modify: `scripts/data/builtin-storage-actor-service.js`
- Modify: `scripts/data/storage-ground-pile-service.js`
- Modify: `scripts/data/storage-container-item-service.js`
- Modify: `scripts/data/storage-deposit-source.js`

**Interfaces:**
- Consumes: Foundry Token data field `sight.enabled`.
- Produces: every built-in storage prototype and every directly created/recreated storage scene token has `sight.enabled === false`.

- [ ] **Step 1: Write failing focused tests**

Add literal assertions that built-in Actor data, a newly created ground pile, a restored portable container, and a rollback-restored storage token all override inherited `sight.enabled: true` to `false`.

- [ ] **Step 2: Run tests to verify RED**

Run:

```powershell
node --test tests/builtin-storage-actor-service.test.mjs tests/storage-ground-pile-service.test.mjs tests/storage-container-item-service.test.mjs tests/storage-deposit-source.test.mjs
```

Expected: assertions receive `true` or `undefined`, proving the creation boundaries do not yet disable sight.

- [ ] **Step 3: Implement the minimal creation-boundary patches**

Merge the inherited sight object while forcing its enabled bit:

```js
sight: {
  ...(clone(existingSight) ?? {}),
  enabled: false
}
```

Apply the equivalent dotted Actor update (`"prototypeToken.sight.enabled": false`) for existing managed prototype Actors. Do not update unrelated scene tokens.

- [ ] **Step 4: Run focused tests to verify GREEN**

Run the same four-file command and require zero failures.

### Task 2: Exactly-once public claim messages

**Files:**
- Create: `tests/storage-transfer-chat.test.mjs`
- Modify: `scripts/data/storage-command-service.js`
- Modify: `scripts/main.js`

**Interfaces:**
- Consumes: `StorageCommandService.claimRow(payload, { sender })`, `claimCoins(payload, { sender })`, authoritative `result.changed`, sender display name, destination Actor display name, row name/quantity, and `pp/gp/sp/cp` balances.
- Produces: one awaited best-effort public ChatMessage creation after a successful changed claim to `self` or `party`; retries and unchanged/error paths produce none.

- [ ] **Step 1: Write failing focused tests**

Create a real `StorageService`/`StorageCommandService` harness and cover:

```js
assert.equal(messages.length, 1);
assert.match(messages[0].content, /Игрок/iu);
assert.match(messages[0].content, /2 × Меч/iu);
assert.equal(messages[0].whisper, undefined);
```

Separate cases cover row-to-self, row-to-party, partial quantity, coins with all four correct denomination labels, repeated mutation ID, target/source mutation failure, validation failure, escaped malicious presentation fields, absence of UUID/flags, and Journal claim rejection with no message.

- [ ] **Step 2: Run the ChatMessage test to verify RED**

Run:

```powershell
node --test tests/storage-transfer-chat.test.mjs
```

Expected: successful claims produce zero messages because no publisher is wired yet.

- [ ] **Step 3: Implement authoritative post-commit presentation**

Inject a `createChatMessage(data)` dependency into `StorageCommandService` from `scripts/main.js`. Add one private presentation method that:

```js
if (result.changed === true && (destination === "self" || destination === "party")) {
  await this.#publishClaimMessage({ sender, destination, actor, row, quantity, coins });
}
```

Build content only from escaped sender/Actor/row presentation names plus validated quantity or positive normalized coin balances. Do not set `whisper`; catch and warn on ChatMessage creation failure so presentation cannot roll back or falsely invalidate an already committed storage mutation.

- [ ] **Step 4: Run the ChatMessage test to verify GREEN**

Run the single focused test file and require zero failures, then rerun `tests/storage-socket.test.mjs` and `tests/storage-main-registration.test.mjs` for command/composition regressions.

### Task 3: Public behavior documentation and final verification

**Files:**
- Modify: `README.md`
- Modify: `docs/function-passport.md`

**Interfaces:**
- Consumes: final implementation signatures and focused test names.
- Produces: current documentation for sight-disabled storage tokens and public exactly-once transfer messages.

- [ ] **Step 1: Update current-state documentation**

Document the four token creation boundaries, the authoritative post-claim ChatMessage flow, escaped safe fields, self/party scope, denomination rendering, and retry/error/Journal exclusions.

- [ ] **Step 2: Review the complete diff**

Run `git diff --check`, `git diff --stat`, and inspect `git diff` for scope, UTF-8 text, and accidental changes.

- [ ] **Step 3: Run full verification once on the final tree**

Run:

```powershell
node --test tests/*.test.mjs
git diff --check
$files = git ls-files '*.js' '*.mjs'
foreach ($file in $files) { node --check $file }
$json = git ls-files '*.json'
foreach ($file in $json) { Get-Content -Raw -Encoding UTF8 $file | ConvertFrom-Json | Out-Null }
```

Require zero failed tests, zero syntax failures, zero JSON parse failures, and a clean whitespace check.

- [ ] **Step 4: Commit and push only task files**

Stage explicit paths (never `git add -A`), commit with `fix: disable storage token vision and announce claims`, and push with `git push -u origin lich_branch`.
