import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const modulesRoot = process.env.THIRD_PARTY_MODULES_ROOT ?? fileURLToPath(new URL('../../../../', import.meta.url));
const read = file => fs.readFileSync(path.join(modulesRoot, 'bg3-inspired-hotbar', file), 'utf8');
const plain = value => JSON.parse(JSON.stringify(value));

// Real HUD/manager logic; doubles cover Foundry's DOM, hook bus and document I/O.
function fixture({ gm = false, enabled = true, locked = false, construct = true } = {}) {
    const state = { writes: [], renders: [], errors: [], settingsRegistered: 0, initCalls: 0, renderGate: null };
    const hooks = new Map(), socket = new Map(), timers = new Map(), scenes = new Map();
    let timerId = 0;
    class Element {
        constructor() { this.style = { setProperty() {}, removeProperty() {} }; this.dataset = {}; this.children = []; }
        appendChild(child) { this.children.push(child); }
        setAttribute() {}
    }
    class Component {
        constructor() { this.element = new Element(); this.components = {}; }
        get token() { return context.ui.BG3HOTBAR?.manager.token; }
        get actor() { return context.ui.BG3HOTBAR?.manager.actor; }
        async render() { return this.element; }
        setComponentsVisibility() {}
    }
    class Application {
        static RENDER_STATES = { NONE: 0, RENDERING: 1, RENDERED: 2, ERROR: -3 };
        constructor() { this.rendered = false; this._state = 0; this.element = [new Element()]; }
        async close() { state.closeStarted?.(); if (state.closeGate) await state.closeGate; this.rendered = false; }
        async _renderInner() { return [new Element()]; }
        async _render() {
            if (this._state === 1) return;
            this._state = 1;
            if (state.failNextRender) { state.failNextRender = false; throw new Error('temporary-render-failure'); }
            if (state.renderGate) await state.renderGate;
            await this._renderInner({});
            this.rendered = true;
            this._state = 2;
            state.renders.push(this.manager.actor?.id ?? null);
        }
        render(force) { this._externalRender = this._render(force); return this; }
    }
    const canvas = { ready: true, loading: false, scene: null, tokens: { controlled: [], placeables: [], get(id) { return this.placeables.find(t => t.id === id); } } };
    const settings = new Map([['uiEnabled', enabled], ['synchroBRMidiQoL', true]]);
    const game = {
        user: { id: 'player', isGM: gm, character: null }, scenes,
        modules: new Map(), packs: new Map(),
        settings: { get(_id, key) { return settings.get(key); }, set(...args) { state.writes.push(args); }, settings: new Map() },
        socket: { io: { on(event, callback) { socket.set(event, callback); } } }
    };
    const context = vm.createContext({
        console: { log() {}, warn: (...args) => state.errors.push(args), error: (...args) => state.errors.push(args) },
        Application, BG3Component: Component, game, canvas, ui: {}, window: { innerHeight: 1500 },
        document: { body: { dataset: {} } }, TooltipManager: {},
        BG3CONFIG: { MODULE_NAME: 'bg3-inspired-hotbar', CONTAINERS_NAME: 'containers', FLAG_NAME: 'hotbar', CONTAINERSDATA: {} },
        foundry: { utils: { deepClone: structuredClone } },
        ControlsManager: { isSettingLocked: () => locked, updateUIDataset() {} },
        Hooks: {
            on(event, callback) { const list = hooks.get(event) ?? []; list.push(callback); hooks.set(event, list); },
            once(event, callback) { this.on(event, callback); }
        },
        setTimeout(callback) { timers.set(++timerId, callback); return timerId; }, clearTimeout(id) { timers.delete(id); },
        preloadHandlebarsTemplates() {}, registerSettings() { state.settingsRegistered++; },
        registerEarly() { state.initCalls++; }, registerHandlebars() {}, registerKeybinding() {}, registerLibWrapper() {}, updateSettingsDisplay() {},
        AutoPopulateCreateToken: { async populateUnlinkedToken() { state.writes.push('autopopulate'); } },
        DragDropManager: class {}, ItemUpdateManager: class {}, BG3TooltipManager: class {},
        ...Object.fromEntries(['HotbarContainer', 'PortraitContainer', 'RestTurnContainer', 'WeaponContainer', 'AdvContainer'].map(name => [name, Component])),
        fromUuidSync(uuid) { for (const scene of scenes.values()) for (const doc of scene.tokens.values()) if (doc.uuid === uuid) return doc; return null; }
    });
    function load(file, name) {
        const source = read(file).replace(/^import .*\r?$/gm, '').replace(`export class ${name}`, `class ${name}`);
        vm.runInContext(`${source}\nglobalThis.${name} = ${name};`, context);
        return context[name];
    }
    const Manager = load('scripts/managers/HotbarManager.js', 'HotbarManager');
    const HUD = load('scripts/bg3-hotbar.js', 'BG3Hotbar');
    HUD.prototype._applyTheme = function () {};
    HUD.prototype._applyMacrobarCollapseSetting = function () {};
    const result = { state, canvas, game, context, settings, hooks, socket, timers, Manager, HUD, load };
    result.scene = id => {
        const scene = scenes.get(id) ?? { id, tokens: new Map() }; scenes.set(id, scene);
        canvas.scene = scene; canvas.tokens.placeables = [...scene.tokens.values()].map(doc => doc.object); canvas.tokens.controlled = [];
        return scene;
    };
    result.token = (id, actorId = 'hero', { owner = true, hidden = false, linked = true, saved = true } = {}) => {
        const layout = { hotbar: [{ cols: 7, rows: 3, items: { '2-1': { uuid: `Actor.${actorId}.Item.sword` } } }], weapon: [], combat: [] };
        const actor = {
            id: actorId, uuid: `Actor.${actorId}`, isOwner: owner, hasPlayerOwner: true, type: 'character', items: [],
            getFlag(_id, key) { return key === 'containers' && saved ? layout : undefined; },
            async setFlag(...args) { state.writes.push(['setFlag', actorId, ...args]); },
            async unsetFlag(...args) { state.writes.push(['unsetFlag', actorId, ...args]); }
        };
        const doc = { id, _id: id, actor, actorLink: linked, hidden, parent: canvas.scene, uuid: `Scene.${canvas.scene.id}.Token.${id}` };
        const token = { id, actor, isOwner: owner, actorLink: linked, document: doc, name: id }; doc.object = token;
        canvas.scene.tokens.set(id, doc); canvas.tokens.placeables.push(token);
        return token;
    };
    result.emit = async (event, ...args) => { for (const callback of hooks.get(event) ?? []) await callback(...args); };
    result.flush = async () => {
        for (let turn = 0; turn < 20; turn++) {
            await Promise.resolve();
            for (const [id, callback] of [...timers]) { if (!timers.delete(id)) continue; await callback(); }
            await result.app?._generationQueue;
            await result.app?._externalRender;
            if (!timers.size) return;
        }
        assert.fail('Lifecycle recovery must settle without polling');
    };
    result.start = async () => {
        result.app = new HUD(); context.ui.BG3HOTBAR = result.app;
        await result.flush(); return result.app;
    };
    result.scene('A');
    if (construct) result.app = null;
    return result;
}

test('GM ready registers settings without constructing HUD or recovery listeners', async () => {
    const f = fixture({ gm: true });
    vm.runInContext(read('scripts/module.js').replace(/^import .*\r?$/gm, ''), f.context);
    await f.emit('init'); await f.emit('ready');
    assert.equal(f.state.settingsRegistered, 1);
    assert.equal(f.context.ui.BG3HOTBAR, undefined);
    assert.equal(f.hooks.has('canvasReady'), false);
    assert.equal(f.socket.size, 0);
});

test('startup renders selected character without changing saved layout or flags', async () => {
    const f = fixture(), hero = f.token('hero-token'); f.canvas.tokens.controlled = [hero];
    const before = plain(hero.actor.getFlag('', 'containers'));
    await f.start();
    assert.equal(f.app.rendered, true); assert.equal(f.app.manager.actor, hero.actor);
    assert.deepEqual(plain(f.app.manager.containers), before); assert.deepEqual(f.state.writes, []);
});

test('reconnect with multiple controlled tokens shows assigned character without changing selection', async () => {
    const f = fixture(), other = f.token('other', 'other'), hero = f.token('hero');
    f.game.user.character = hero.actor; f.canvas.tokens.controlled = [other, hero];
    await f.start();
    assert.equal(f.app.rendered, true); assert.equal(f.app.manager.actor, hero.actor);
    assert.deepEqual(f.canvas.tokens.controlled, [other, hero]);
});

test('disabled HUD stays closed on startup, canvasReady and reconnect', async () => {
    const f = fixture({ enabled: false }), hero = f.token('hero'); f.canvas.tokens.controlled = [hero];
    await f.start(); await f.emit('canvasReady'); await f.socket.get('reconnect')?.(); await f.flush();
    assert.equal(f.app.rendered, false); assert.deepEqual(f.state.renders, []); assert.deepEqual(f.state.writes, []);
});

for (const options of [{ owner: false }, { hidden: true }]) test(`recovery rejects ${options.hidden ? 'hidden' : 'unowned'} selected token`, async () => {
    const f = fixture(), hero = f.token('hero', 'hero', options); f.canvas.tokens.controlled = [hero];
    await f.start(); assert.equal(f.app.rendered, false); assert.deepEqual(f.state.writes, []);
});

test('late delete from source scene cannot close same-ID destination HUD or erase unlinked layout', async () => {
    const f = fixture(), source = f.token('same'); f.canvas.tokens.controlled = [source]; await f.start();
    f.scene('B'); const destination = f.token('same', 'hero', { linked: false }); f.canvas.tokens.controlled = [destination];
    await f.app.generate(destination); await f.flush();
    await f.emit('deleteToken', source.document, { replacements: { same: destination.document.uuid } }); await f.flush();
    assert.equal(f.app.rendered, true); assert.equal(f.app.manager.token, destination); assert.deepEqual(f.state.writes, []);
});

test('manager never resolves same token ID against another scene before recovery', async () => {
    const f = fixture(), source = f.token('same'); f.canvas.tokens.controlled = [source]; await f.start();
    f.scene('B'); f.token('same');
    assert.equal(f.app.manager.token, null); assert.equal(f.app.manager.actor, null);
});

test('canvasReady recovers a replacement with a new ID after scene teardown', async () => {
    const f = fixture(), source = f.token('old'); f.canvas.tokens.controlled = [source]; await f.start();
    await f.emit('canvasTearDown'); f.scene('B'); const destination = f.token('new');
    await f.emit('canvasReady'); await f.flush();
    assert.equal(f.app.rendered, true); assert.equal(f.app.manager.token, destination); assert.deepEqual(f.state.writes, []);
});

test('DAE create-before-delete rebinds to unselected replacement without autopopulation', async () => {
    const f = fixture(), source = f.token('old'); f.canvas.tokens.controlled = [source]; await f.start();
    const destination = f.token('new'); await f.emit('createToken', destination.document);
    f.canvas.scene.tokens.delete('old'); f.canvas.tokens.placeables = [destination]; f.canvas.tokens.controlled = [];
    await f.emit('deleteToken', source.document, {}); await f.flush();
    assert.equal(f.app.rendered, true); assert.equal(f.app.manager.token, destination); assert.deepEqual(f.state.writes, []);
});

test('replacement document resolves placeable on recovery tick even when actor ID changes', async () => {
    const f = fixture(), source = f.token('old'); f.canvas.tokens.controlled = [source]; await f.start();
    const latest = f.token('form', 'form'), other = f.token('other', 'other');
    f.canvas.scene.tokens.delete('old'); f.canvas.tokens.placeables = [latest, other]; f.canvas.tokens.controlled = [];
    latest.document.object = null;
    await f.emit('deleteToken', source.document, { replacements: { old: latest.document.uuid } });
    latest.document.object = latest;
    await f.flush(); assert.equal(f.app.rendered, true); assert.equal(f.app.manager.token, latest); assert.deepEqual(f.state.writes, []);
});

test('external render cannot create an empty HUD during teardown or with no actor', async () => {
    const f = fixture(); await f.start(); const before = f.state.renders.length;
    await f.app._render(true); assert.equal(f.app.rendered, false); assert.equal(f.state.renders.length, before);
});

test('rapid release/control batches retain only one scheduled callback', async () => {
    const f = fixture(), hero = f.token('hero'); f.canvas.tokens.controlled = [hero]; await f.start();
    for (let i = 0; i < 5; i++) { await f.emit('controlToken', hero, false); await f.emit('controlToken', hero, true); }
    assert.equal(f.timers.size, 1); await f.flush(); assert.equal(f.app.rendered, true);
});

test('socket reconnect restores current player HUD without duplicating listeners', async () => {
    const f = fixture(), hero = f.token('hero'); f.canvas.tokens.controlled = [hero]; await f.start();
    f.app.rendered = false; await f.socket.get('reconnect')?.(); await f.flush();
    assert.equal(f.app.rendered, true); assert.equal(f.socket.size, 1);
    for (const name of ['canvasReady', 'canvasTearDown']) assert.equal(f.hooks.get(name)?.length, 1);
});

for (const locked of [false, true]) test(`manual deselect preserves lock=${locked}`, async () => {
    const f = fixture({ locked }), hero = f.token('hero'); f.canvas.tokens.controlled = [hero]; await f.start();
    f.canvas.tokens.controlled = []; await f.emit('controlToken', hero, false); await f.flush();
    assert.equal(f.app.rendered, locked); assert.deepEqual(f.state.writes, []);
});

test('unrelated token creation does not undo a completed manual deselect', async () => {
    const f = fixture(), hero = f.token('hero'); f.canvas.tokens.controlled = [hero]; await f.start();
    f.canvas.tokens.controlled = []; await f.emit('controlToken', hero, false); await f.flush();
    const other = f.token('other', 'other'); await f.emit('createToken', other.document); await f.flush();
    assert.equal(f.app.rendered, false); assert.deepEqual(f.state.writes, []);
});

test('unrelated creation preserves current component and manual filter state', async () => {
    const f = fixture(), hero = f.token('hero'); f.canvas.tokens.controlled = [hero]; await f.start();
    const container = f.app.components.container;
    container.components.filterContainer = { used: ['manual-action'], _checkBonusReactionUsed() {} };
    const other = f.token('other', 'other'); await f.emit('createToken', other.document); await f.flush();
    assert.equal(f.app.components.container, container);
    assert.deepEqual(container.components.filterContainer.used, ['manual-action']);
});

test('deleting last token closes HUD without clearing stored actor flags', async () => {
    const f = fixture(), hero = f.token('hero', 'hero', { linked: false }); f.canvas.tokens.controlled = [hero]; await f.start();
    f.canvas.scene.tokens.delete(hero.id); f.canvas.tokens.placeables = []; f.canvas.tokens.controlled = [];
    await f.emit('deleteToken', hero.document, {}); await f.flush();
    assert.equal(f.app.rendered, false); assert.deepEqual(f.state.writes, []);
});

test('newest generation wins over a pending old render', async () => {
    const f = fixture(), old = f.token('old'), latest = f.token('latest', 'latest'); f.canvas.tokens.controlled = [old]; await f.start();
    let release; f.state.renderGate = new Promise(resolve => { release = resolve; });
    const first = f.app.generate(old); await Promise.resolve();
    const last = f.app.generate(latest); release(); await Promise.all([first, last]); await f.flush();
    assert.equal(f.app.rendered, true); assert.equal(f.state.renders.at(-1), 'latest'); assert.equal(f.app.manager.token, latest);
});

test('failed Foundry render can recover on next generation instead of remaining RENDERING', async () => {
    const f = fixture(), hero = f.token('hero'); f.canvas.tokens.controlled = [hero]; await f.start();
    f.state.failNextRender = true; f.app.rendered = false; await f.app.generate(hero);
    await f.app.generate(hero);
    assert.equal(f.app.rendered, true); assert.equal(f.state.errors.length, 1);
});

test('rapid scene transitions discard old render and retain final scene layout', async () => {
    const f = fixture(), source = f.token('same'); f.canvas.tokens.controlled = [source]; await f.start();
    let release; f.state.renderGate = new Promise(resolve => { release = resolve; });
    const pending = f.app.generate(source); await new Promise(resolve => setImmediate(resolve));
    const teardown = f.emit('canvasTearDown');
    f.scene('B'); f.token('same');
    f.scene('C'); const latest = f.token('same', 'final'); f.canvas.tokens.controlled = [latest];
    const ready = f.emit('canvasReady'); release(); await Promise.all([pending, teardown, ready]); await f.flush();
    assert.equal(f.app.rendered, true); assert.equal(f.app.manager.actor.id, 'final');
    assert.equal(f.app.manager.containers.hotbar[0].items['2-1'].uuid, 'Actor.final.Item.sword'); assert.deepEqual(f.state.writes, []);
});

test('a pending old close cannot hide a newer selected character', async () => {
    const f = fixture(), hero = f.token('hero'); f.canvas.tokens.controlled = [hero]; await f.start();
    let release; f.state.closeGate = new Promise(resolve => { release = resolve; });
    let started; const closeStarted = new Promise(resolve => { started = resolve; }); f.state.closeStarted = started;
    const closing = f.app.generate(null); await closeStarted;
    const opening = f.app.generate(hero); await new Promise(resolve => setImmediate(resolve));
    release(); await Promise.all([closing, opening]); await f.flush();
    assert.equal(f.app.rendered, true); assert.equal(f.app.manager.token, hero);
});

test('late release of replaced token cannot cancel DAE recovery or close replacement', async () => {
    const f = fixture(), old = f.token('old'); f.canvas.tokens.controlled = [old]; await f.start();
    const latest = f.token('latest'); f.canvas.scene.tokens.delete('old'); f.canvas.tokens.placeables = [latest]; f.canvas.tokens.controlled = [];
    await f.emit('deleteToken', old.document, {}); await f.flush();
    await f.emit('controlToken', old, false); await f.flush();
    assert.equal(f.app.rendered, true); assert.equal(f.app.manager.token, latest);
});

test('effect list and rendering tolerate missing actor during scene transition', async () => {
    const f = fixture(); await f.start();
    f.context.ActiveButton = class {};
    const Active = f.load('scripts/components/containers/ActiveContainer.js', 'ActiveContainer');
    const active = new Active();
    assert.deepEqual(plain(active.activesList), []); await active.render();
    assert.equal(active.element.style.visibility, 'hidden');
});

test('valid effect render failures are reported instead of silently swallowed', async () => {
    const f = fixture(), hero = f.token('hero'); f.canvas.tokens.controlled = [hero]; await f.start();
    f.app.components.container.components.activeContainer = { async render() { throw new Error('effect-render-failed'); } };
    await f.app._onUpdateActive({ parent: hero.actor });
    assert.equal(f.state.errors.length, 1); assert.match(String(f.state.errors[0]), /effect-render-failed/);
});

async function midiFixture({ used = 0, max = 2, api = true, counters = true, sync = true, midi = true } = {}) {
    const f = fixture(), hero = f.token('hero'); f.canvas.tokens.controlled = [hero];
    const getFlag = hero.actor.getFlag;
    hero.actor.getFlag = (id, key) => id === 'midi-qol' && key === 'actions'
        ? (counters ? { reactionsUsed: used, reactionsMax: max, bonusActionsUsed: used, bonusActionsMax: max } : undefined)
        : getFlag(id, key);
    await f.start();
    f.settings.set('synchroBRMidiQoL', sync); f.game.modules.set('midi-qol', { active: midi });
    if (api) {
        const midiSource = fs.readFileSync('D:/FoundryVTT/Data/modules/midi-qol/midi-qol.js', 'utf8');
        f.context.MODULE_ID = 'midi-qol'; f.context.MidiQOL = {};
        for (const name of ['hasUsedReaction', 'hasUsedBonusAction']) {
            vm.runInContext(midiSource.slice(midiSource.indexOf(`function ${name}(`), midiSource.indexOf(`__name(${name},`)) + `\nMidiQOL.${name} = ${name};`, f.context);
        }
    }
    const Filter = f.load('scripts/components/containers/FilterContainer.js', 'FilterContainer');
    const filter = new Filter(); filter.components = [{ data: { id: 'bonus' } }, { data: { id: 'reaction' } }];
    filter.updateCellFilterState = () => {};
    f.app.components.container.components.activeContainer = { activesList: used ? [{ _id: 'dnd5ebonusaction' }, { _id: 'dnd5ereaction000' }] : [] };
    return { ...f, filter, hero };
}

for (const api of [true, false]) for (const used of [0, 1, 2]) test(`MIDI indicator counts ${used}/2 with API=${api}`, async () => {
    const f = await midiFixture({ used, api }); f.filter._checkBonusReactionUsed();
    assert.equal(f.filter.used.length, used === 2 ? 2 : 0); assert.deepEqual(f.state.writes, []);
});

test('MIDI reset clears both indicators and synchronization off preserves manual state', async () => {
    const f = await midiFixture({ used: 2 }); f.filter._checkBonusReactionUsed(); assert.equal(f.filter.used.length, 2);
    f.hero.actor.getFlag = () => ({ reactionsUsed: 0, reactionsMax: 2, bonusActionsUsed: 0, bonusActionsMax: 2 });
    f.filter._checkBonusReactionUsed(); assert.equal(f.filter.used.length, 0);
    f.settings.set('synchroBRMidiQoL', false); f.filter.used = f.filter.components[0];
    f.filter._checkBonusReactionUsed(); assert.equal(f.filter.used.length, 1);
});

test('effect IDs remain fallback when MIDI API and action counters are unavailable', async () => {
    const f = await midiFixture({ used: 1, api: false, counters: false, midi: false });
    f.filter._checkBonusReactionUsed(); assert.equal(f.filter.used.length, 2);
});

test('repeated generation keeps only current combat component references', async () => {
    const f = fixture(), hero = f.token('hero'); f.canvas.tokens.controlled = [hero]; await f.start();
    for (let i = 0; i < 4; i++) { await f.app.generate(hero); await f.flush(); }
    assert.equal(f.app.combat.length, 1);
});

test('recovery loads CPR layout without legacy Item flag migration writes', async () => {
    const f = fixture(), hero = f.token('hero'); f.canvas.tokens.controlled = [hero];
    const layout = hero.actor.getFlag('', 'containers'); layout.combat = [{ items: { '0-0': { uuid: 'Actor.hero.Item.dash' } } }];
    f.game.modules.set('chris-premades', { active: true }); f.game.modules.set('tidy5e-sheet', { active: true });
    hero.actor.items = [{ uuid: 'Actor.hero.Item.dash', getFlag: id => id === 'chris-premades' ? { source: 'chris-premades' } : 'old', setFlag: async (...args) => f.state.writes.push(args) }];
    await f.start(); assert.deepEqual(f.state.writes, []); assert.deepEqual(plain(f.app.manager.containers), plain(layout));
    await f.app.manager._loadTokenData(); assert.equal(f.state.writes.length, 1, 'default non-recovery migration contract is retained');
});
