import test from "node:test";
import assert from "node:assert/strict";

import { SiteAutoSync } from "../scripts/integrations/site-auto-sync.js";

// --- Manual clock + timers ----------------------------------------------------------

function makeClock() {
  let now = 0;
  let seq = 0;
  const timers = new Map();
  const flush = () => new Promise((r) => setImmediate(r));
  return {
    now: () => now,
    timers: {
      setTimeout: (fn, ms) => { const id = ++seq; timers.set(id, { at: now + Math.max(0, ms), fn }); return id; },
      clearTimeout: (id) => timers.delete(id),
      setInterval: (fn, ms) => { const id = ++seq; timers.set(id, { at: now + ms, fn, every: ms }); return id; },
      clearInterval: (id) => timers.delete(id),
    },
    /** Advance time, firing due timers in order and letting promises settle. */
    async advance(ms) {
      const end = now + ms;
      for (;;) {
        await flush();
        const due = [...timers.entries()].filter(([, t]) => t.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
        if (!due) break;
        const [id, t] = due;
        now = t.at;
        if (t.every) t.at += t.every; else timers.delete(id);
        t.fn();
        await flush();
      }
      now = end;
      await flush();
    },
  };
}

// --- Fake characterSync over an in-memory "site" -----------------------------------------

function makeWorld({ userId = "player1", holder = "player1", token = "TOK", autoSync = undefined, pushDelayMs = 0, clock } = {}) {
  const actor = { id: "A1", name: "Тайрен", local: { hp: 20 }, link: { id: 7, lastStateHash: "h0", lastSyncedSignature: "sig:20", linkHolderUserId: holder, autoSync } };
  const site = { hash: "h0", state: { currentHp: 20 }, patches: [], gets: 0, inFlight: 0, maxInFlight: 0 };
  const sig = () => `sig:${actor.local.hp}`;
  const characterSync = {
    getLink: (a) => (a === actor ? actor.link : null),
    getLinkToken: () => token,
    localSignature: sig,
    isLocallyDirty: () => actor.link.lastSyncedSignature !== sig(),
    fetchRemoteState: async () => { site.gets += 1; return { ...site.state, stateHash: site.hash }; },
    pushState: async () => {
      site.inFlight += 1;
      site.maxInFlight = Math.max(site.maxInFlight, site.inFlight);
      if (pushDelayMs) await new Promise((r) => clock.timers.setTimeout(r, pushDelayMs));
      site.inFlight -= 1;
      if (site.hash !== actor.link.lastStateHash) return { ok: false, conflict: true, remoteHash: site.hash, remote: site.state };
      site.patches.push(actor.local.hp);
      site.state = { currentHp: actor.local.hp };
      site.hash = `h${site.patches.length}`;
      actor.link.lastStateHash = site.hash;
      actor.link.lastSyncedSignature = sig();
      return { ok: true, stateHash: site.hash };
    },
    applySiteState: async (_a, remote) => {
      actor.local.hp = remote.currentHp;
      actor.link.lastStateHash = remote.stateHash;
      actor.link.lastSyncedSignature = sig();
      return { ok: true, warnings: [] };
    },
  };
  const game = { user: { id: userId }, actors: Object.assign([actor], { get: (id) => (id === actor.id ? actor : null) }) };
  return { actor, site, characterSync, game };
}

function makeAuto(world, clock, extra = {}) {
  const conflicts = [];
  const notes = [];
  const auto = new SiteAutoSync({ characterSync: world.characterSync, site: { isEnabled: () => true } }, {
    gameRef: () => world.game,
    now: clock.now,
    timers: clock.timers,
    worldEnabled: () => extra.worldOn ?? true,
    onConflict: async (actor, c) => { conflicts.push(c.remoteHash); },
    notify: (kind, msg) => notes.push([kind, msg]),
  });
  return { auto, conflicts, notes };
}

// --- Tests ---------------------------------------------------------------------------------

test("debounce: a burst of changes becomes one PATCH ~2 s after the last change", async () => {
  const clock = makeClock();
  const world = makeWorld({ clock });
  const { auto } = makeAuto(world, clock);
  for (const hp of [19, 17, 12]) {
    world.actor.local.hp = hp;
    auto.notifyChange(world.actor);
    await clock.advance(500);
  }
  assert.deepEqual(world.site.patches, []);
  await clock.advance(2000);
  assert.deepEqual(world.site.patches, [12]);
});

test("rate: continuous combat changes for 10 minutes stay far under 600 PATCH/hour", async () => {
  const clock = makeClock();
  const world = makeWorld({ clock });
  const { auto } = makeAuto(world, clock);
  // A change every 2.5 s (just past the debounce) for 10 minutes.
  for (let t = 0; t < 600_000; t += 2500) {
    world.actor.local.hp = (world.actor.local.hp % 30) + 1;
    auto.notifyChange(world.actor);
    await clock.advance(2500);
  }
  await clock.advance(20_000);
  const perHour = world.site.patches.length * 6;
  assert.ok(world.site.patches.length > 0);
  assert.ok(perHour <= 450, `projected ${perHour}/hour`);
});

test("at most one request in flight, and changes during it are pushed afterwards", async () => {
  const clock = makeClock();
  const world = makeWorld({ clock, pushDelayMs: 5000 });
  const { auto } = makeAuto(world, clock);
  world.actor.local.hp = 10;
  auto.notifyChange(world.actor);
  await clock.advance(2500); // push started, takes 5 s
  world.actor.local.hp = 9;
  auto.notifyChange(world.actor);
  await clock.advance(30_000);
  assert.equal(world.site.maxInFlight, 1);
  // The slow push read the state when it was sent (already 9); the site ends
  // with the latest local value and nothing is left pending.
  assert.equal(world.site.patches.at(-1), 9);
  assert.equal(world.site.state.currentHp, world.actor.local.hp);
  assert.equal(auto.pending.size, 0);
});

test("echo: our own pull/acknowledge updates (rebreyaSiteSync) and unchanged state push nothing", async () => {
  const clock = makeClock();
  const world = makeWorld({ clock });
  const { auto } = makeAuto(world, clock);
  world.actor.local.hp = 5;
  auto.notifyChange(world.actor, { rebreyaSiteSync: true });
  await clock.advance(20_000);
  assert.deepEqual(world.site.patches, []);
  world.actor.local.hp = 20; // back to the synced value
  auto.notifyChange(world.actor);
  await clock.advance(20_000);
  assert.deepEqual(world.site.patches, [], "not dirty → no PATCH");
});

test("election: only the token holder's client syncs; per-actor and world switches respected", async () => {
  const clock = makeClock();
  const cases = [
    [{ userId: "gm1", holder: "player1" }, {}, false],
    [{ token: null }, {}, false],
    [{ autoSync: false }, {}, false],
    [{}, { worldOn: false }, false],
    [{ holder: undefined }, {}, true], // legacy link without holder: the token is the proof
    [{}, {}, true],
  ];
  for (const [worldOpts, autoOpts, expected] of cases) {
    const world = makeWorld({ clock, ...worldOpts });
    const { auto } = makeAuto(world, clock, autoOpts);
    assert.equal(auto.isElected(world.actor), expected, JSON.stringify(worldOpts) + JSON.stringify(autoOpts));
  }
});

test("pull: site moved, Foundry did not → applied silently", async () => {
  const clock = makeClock();
  const world = makeWorld({ clock });
  const { auto, conflicts } = makeAuto(world, clock);
  world.site.state = { currentHp: 7 };
  world.site.hash = "h-site";
  assert.equal(await auto.pullActor(world.actor), "applied");
  assert.equal(world.actor.local.hp, 7);
  assert.equal(conflicts.length, 0);
  assert.equal(await auto.pullActor(world.actor), "same");
  // …and the echo of that pull does not push anything
  auto.notifyChange(world.actor);
  await clock.advance(20_000);
  assert.deepEqual(world.site.patches, []);
});

test("pull: only Foundry moved → pushed; both moved → conflict dialog once per site state", async () => {
  const clock = makeClock();
  const world = makeWorld({ clock });
  const { auto, conflicts } = makeAuto(world, clock);
  world.actor.local.hp = 15;
  assert.equal(await auto.pullActor(world.actor), "pushed");
  await clock.advance(20_000);
  assert.deepEqual(world.site.patches, [15]);

  world.actor.local.hp = 3;            // Foundry moved…
  world.site.state = { currentHp: 30 }; // …and so did the site
  world.site.hash = "h-other";
  assert.equal(await auto.pullActor(world.actor), "conflict");
  assert.equal(await auto.pullActor(world.actor), "conflict");
  assert.deepEqual(conflicts, ["h-other"], "dialog shown once for this site state");
  assert.equal(world.actor.local.hp, 3, "neither side silently overwritten");
});

test("poll loop: start() pulls now and every 30 s", async () => {
  const clock = makeClock();
  const world = makeWorld({ clock });
  const { auto } = makeAuto(world, clock);
  auto.start();
  await clock.advance(95_000);
  auto.stop();
  assert.equal(world.site.gets, 4); // t=0, 30, 60, 90
});

test("revoked link: one warning, no retry storm", async () => {
  const clock = makeClock();
  const world = makeWorld({ clock });
  world.characterSync.fetchRemoteState = async () => { const e = new Error("revoked"); e.name = "LinkRevoked"; throw e; };
  const { auto, notes } = makeAuto(world, clock);
  assert.equal(await auto.pullActor(world.actor), "error");
  assert.equal(await auto.pullActor(world.actor), "error");
  assert.equal(notes.length, 1);
  assert.match(notes[0][1], /отозвана/u);
});
