import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const moduleRoot = process.env.THIRD_PARTY_MODULES_ROOT
  ?? fileURLToPath(new URL('../../../../', import.meta.url));
const read = (id, file) => fs.readFileSync(path.join(moduleRoot, id, file), 'utf8');
const evaluate = (source, context) => vm.runInNewContext(source, context, { timeout: 1000 });
const namedFunction = (source, name) => {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = source.match(new RegExp(`(?:async )?function ${escaped}\\([^]*?\\r?\\n\\}`));
  assert.ok(match, `Installed function ${name} is available`);
  return match[0];
};

function bg3Lifecycle(initUser, readyUser) {
  const calls = { settings: 0, panels: 0, early: 0 };
  const phases = {};
  const game = { user: initUser, modules: new Map([['lib-wrapper', { active: true }]]), packs: new Map() };
  const source = read('bg3-inspired-hotbar', 'scripts/module.js').replace(/^import .*;\r?\n/gm, '');
  evaluate(source, {
    game, ui: {}, console: { log() {} }, BG3CONFIG: { MODULE_NAME: 'bg3-inspired-hotbar' },
    Hooks: { once(event, fn) { phases[event] = fn; } },
    registerEarly() { calls.early++; }, registerSettings() { calls.settings++; },
    registerHandlebars() {}, registerKeybinding() {}, registerLibWrapper() {}, updateSettingsDisplay() {},
    BG3Hotbar: class { constructor() { calls.panels++; } }
  });
  phases.init();
  game.user = readyUser;
  phases.ready();
  return calls;
}

for (const [name, initUser, readyUser, panelCount] of [
  ['GM resolved after init', undefined, { isGM: true }, 0],
  ['GM already known at init', { isGM: true }, { isGM: true }, 0],
  ['player resolved after init', undefined, { isGM: false }, 1],
  ['player already known at init', { isGM: false }, { isGM: false }, 1]
]) test(`BG3 registers settings once for ${name} with preserved UI visibility`, () => {
  const calls = bg3Lifecycle(initUser, readyUser);
  assert.equal(calls.settings, 1);
  assert.equal(calls.panels, panelCount);
});

function bg3Roll({ panel = true, registered = true, midi = true, enabled = true, state = 'advBtn', once = false, mismatch = false, workflow = true } = {}) {
  const calls = { reads: 0, resets: [] };
  const actor = { getFlag(_id, key) { return key === 'advState' ? state : once; } };
  const ui = panel ? { BG3HOTBAR: { manager: { actor }, components: { advantage: { setState(value) { calls.resets.push(value); } } } } } : {};
  const settings = {
    settings: new Map(registered ? [['bg3-inspired-hotbar.addAdvBtnsMidiQoL', {}]] : []),
    get(id, key) {
      calls.reads++;
      assert.equal(`${id}.${key}`, 'bg3-inspired-hotbar.addAdvBtnsMidiQoL');
      if (!registered) throw new Error('unregistered game setting');
      return enabled;
    }
  };
  const source = read('bg3-inspired-hotbar', 'scripts/utils/config.js').match(/const hookRollEvent = [^]*?\r?\n\}/)[0];
  const handler = evaluate(`${source};hookRollEvent`, { ui, game: { settings, modules: new Map([['midi-qol', { active: midi }]]) }, BG3CONFIG: { MODULE_NAME: 'bg3-inspired-hotbar' } });
  const roll = workflow ? { workflow: { actor: mismatch ? {} : actor } } : {};
  return { handler, roll, ui, calls };
}

function bg3Settings(isGM = true) {
  const settings = new Map(), calls = { migrations: 0 };
  const source = namedFunction(read('bg3-inspired-hotbar', 'scripts/utils/config.js'), 'registerSettings');
  const context = {
    ui: {}, document: { body: { dataset: {} } }, BG3CONFIG: { MODULE_NAME: 'bg3-inspired-hotbar' },
    game: { user: { isGM }, modules: new Map(), settings: {
      register(id, key, definition) { assert.equal(id, 'bg3-inspired-hotbar'); settings.set(key, definition); },
      get(_id, key) { return settings.get(key)?.default; },
      registerMenu() {}
    } },
    ThemeSettingDialog: class {}, ExtraInfosDialog: class {}, AutoPopulateDefaults: class {}, CPRActionsDialog: class {},
    _migrateConsumableSettings() { calls.migrations++; }
  };
  evaluate(`${source};registerSettings()`, context);
  return { settings, calls };
}
test('BG3 newly registered GM settings callbacks tolerate the absent panel', async () => {
  const { settings } = bg3Settings();
  for (const [key, definition] of settings) {
    if (!definition.onChange?.toString().includes('ui.BG3HOTBAR')) continue;
    await assert.doesNotReject(async () => definition.onChange(definition.default), `GM setting ${key}`);
  }
});
test('BG3 GM registration does not start the player consumable migration', () => {
  assert.equal(bg3Settings(true).calls.migrations, 0);
  assert.equal(bg3Settings(false).calls.migrations, 1);
});

for (const [name, options] of [
  ['missing panel', { panel: false }], ['unregistered setting', { registered: false }],
  ['missing workflow', { workflow: false }], ['different actor', { mismatch: true }],
  ['disabled Midi-QOL', { midi: false }], ['disabled sync', { enabled: false }]
]) test(`BG3 safely skips ${name}`, () => {
  const fixture = bg3Roll(options), before = { ...fixture.roll };
  assert.doesNotThrow(() => fixture.handler(fixture.roll, {}, {}));
  assert.deepEqual(fixture.roll, before);
  assert.deepEqual(fixture.calls.resets, []);
  if (name !== 'disabled sync') assert.equal(fixture.calls.reads, 0);
});

for (const missing of ['manager', 'actor']) test(`BG3 safely skips missing ${missing}`, () => {
  const fixture = bg3Roll();
  if (missing === 'manager') delete fixture.ui.BG3HOTBAR.manager;
  else delete fixture.ui.BG3HOTBAR.manager.actor;
  assert.doesNotThrow(() => fixture.handler(fixture.roll, {}, {}));
  assert.equal(fixture.calls.reads, 0);
  assert.equal(fixture.roll.advantage, undefined);
});

for (const [state, key] of [['advBtn', 'advantage'], ['disBtn', 'disadvantage']]) {
  for (const once of [false, true]) test(`BG3 preserves ${key} and advOnce=${once}`, () => {
    const fixture = bg3Roll({ state, once });
    fixture.handler(fixture.roll, {}, {});
    assert.equal(fixture.roll[key], true);
    assert.equal(fixture.roll[key === 'advantage' ? 'disadvantage' : 'advantage'], undefined);
    assert.deepEqual(fixture.calls.resets, once ? [null] : []);
  });
}

// Only the jQuery/DOM boundary is doubled; the installed hook owns its operations.
function airshipFixture({ anchor = true, allowed = true, jquery = false } = {}) {
  const buttons = [], placements = [], events = new Map();
  const dom = { nodeType: 1 };
  let openCount = 0, handler;
  const root = {
    jquery: 'fixture',
    find(selector) {
      if (selector === '.sm-airship-settings-launch') return { length: buttons.length };
      assert.equal(selector, '#settings-documentation');
      return { length: anchor ? 1 : 0, before(button) { buttons.push(button); placements.push('before'); } };
    },
    append(button) { buttons.push(button); placements.push('append'); }
  };
  const $ = value => {
    if (value === dom) return root;
    assert.equal(typeof value, 'string');
    assert.match(value, /class="sm-airship-settings-launch"/);
    return { on(event, callback) { events.set(event, callback); } };
  };
  const source = read('sm-airship', 'scripts/module.js');
  evaluate(source.slice(source.indexOf('Hooks.on("renderSettings"')), {
    $, canOpenApp: () => allowed, openAirshipApp() { openCount++; },
    Hooks: { on(event, callback) { assert.equal(event, 'renderSettings'); handler = callback; } }
  });
  return { render: () => handler({}, jquery ? root : dom), buttons, placements, events, openCount: () => openCount };
}

for (const jquery of [false, true]) for (const anchor of [false, true]) {
  test(`airship renders one working launch button for jquery=${jquery}, anchor=${anchor}`, () => {
    const fixture = airshipFixture({ jquery, anchor });
    fixture.render(); fixture.render();
    assert.equal(fixture.buttons.length, 1);
    assert.deepEqual(fixture.placements, [anchor ? 'before' : 'append']);
    let prevented = 0;
    fixture.events.get('click')({ preventDefault() { prevented++; } });
    assert.equal(prevented, 1);
    assert.equal(fixture.openCount(), 1);
  });
}
test('airship respects the existing access check', () => {
  const fixture = airshipFixture({ allowed: false });
  fixture.render();
  assert.equal(fixture.buttons.length, 0);
});

function transformFixture(active = true) {
  const deletes = [];
  const source = namedFunction(read('transform-cleanup', 'transform-cleanup.mjs'), 'onUpdateActor');
  const handler = evaluate(`${source};onUpdateActor`, {
    game: { user: { isActiveGM: active } },
    Actor: { implementation: { deleteDocuments(ids) { deletes.push(Array.from(ids)); } } }
  });
  return { handler, deletes };
}
for (const [name, changed] of [
  ['name only', { name: 'Renamed' }], ['other flags', { flags: { 'midi-qol': { actions: {} } } }],
  ['non-deletion dnd5e flags', { flags: { dnd5e: { isPolymorphed: true } } }]
]) test(`transform ignores ${name} without deletion or exception`, () => {
  const fixture = transformFixture();
  assert.doesNotThrow(() => fixture.handler({ id: 'actor' }, changed, {}, 'gm'));
  assert.deepEqual(fixture.deletes, []);
});
for (const active of [false, true]) test(`transform preserves polymorph deletion for activeGM=${active}`, () => {
  const fixture = transformFixture(active);
  fixture.handler({ id: 'actor' }, { flags: { dnd5e: { '-=isPolymorphed': null } } }, {}, 'gm');
  assert.deepEqual(fixture.deletes, active ? [['actor']] : []);
});

function effectFixture({ owner = true, executor = true } = {}) {
  const gm = { id: 'gm' }, player = { id: 'player', active: true, isGM: false };
  const current = executor ? (owner ? player : gm) : { id: 'other' };
  const calls = [], permissions = [];
  const actor = {
    testUserPermission(user, level) { permissions.push([user.id, level]); return owner; },
    appliedEffects: [{ id: 'first' }, { id: 'skip' }, { id: 'second' }]
  };
  const game = { user: current, users: { activeGM: gm, getDesignatedUser(fn) { return [player].find(fn); } } };
  const source = read('effectmacro', 'module.mjs');
  const effectmacro = { utils: {
    hasMacro(effect, hook) { assert.equal(hook, 'onTurnStart'); return effect.id !== 'skip'; },
    async callMacro(effect, hook) { calls.push([effect.id, hook]); }
  } };
  const getExecutor = evaluate(`${namedFunction(source, 'getExecutor')};getExecutor`, { game });
  effectmacro.utils.isExecutor = evaluate(`${namedFunction(source, 'isExecutor')};isExecutor`, { getExecutor, game });
  const execute = evaluate(`${namedFunction(source, '_executeAppliedEffects$1')};_executeAppliedEffects$1`, { effectmacro });
  return { actor, gm, player, calls, permissions, getExecutor, execute };
}
for (const actor of [undefined, null]) test(`effectmacro returns no executor for actor=${actor}`, () => {
  const fixture = effectFixture();
  assert.equal(fixture.getExecutor(actor), null);
  assert.deepEqual(fixture.permissions, []);
});
test('effectmacro skips missing previous actor and executes valid current effects in order', async () => {
  const fixture = effectFixture();
  await fixture.execute(undefined, 'onTurnStart');
  await fixture.execute(fixture.actor, 'onTurnStart');
  assert.deepEqual(fixture.calls, [['first', 'onTurnStart'], ['second', 'onTurnStart']]);
});
for (const owner of [false, true]) test(`effectmacro preserves owner/GM selection with owner=${owner}`, () => {
  const fixture = effectFixture({ owner });
  assert.equal(fixture.getExecutor(fixture.actor), owner ? fixture.player : fixture.gm);
  assert.deepEqual(fixture.permissions, [['player', 'OWNER']]);
});
test('effectmacro does not execute effects on another client', async () => {
  const fixture = effectFixture({ executor: false });
  await fixture.execute(fixture.actor, 'onTurnStart');
  assert.deepEqual(fixture.calls, []);
});
