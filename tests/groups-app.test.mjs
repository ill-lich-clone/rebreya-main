import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

function installFoundryApplicationStub() {
  const previousFoundry = globalThis.foundry;
  globalThis.foundry = {
    applications: {
      api: {
        ApplicationV2: class {
          constructor(_options = {}) {}
          async _onRender() {}
        },
        HandlebarsApplicationMixin: (Base) => class extends Base {}
      }
    }
  };

  return () => {
    globalThis.foundry = previousFoundry;
  };
}

test("groups template renders dedicated state-aware cards", async () => {
  const template = await readFile(new URL("../templates/groups-app.hbs", import.meta.url), "utf8");

  assert.match(template, /class="rm-groups-grid"/u);
  assert.match(template, /class="rm-group-card \{\{stateClass\}\}"/u);
  assert.match(template, /\{\{#if showRegister\}\}[\s\S]*data-action="register-group"/u);
  assert.match(template, /\{\{#if showSetActive\}\}[\s\S]*data-action="set-active-group"/u);
  assert.match(template, /\{\{#if showCurrentGroup\}\}[\s\S]*Текущая группа/u);
  assert.match(
    template,
    /class="rm-inline-menu[^"]*rm-group-card__menu"[\s\S]*data-action="merge-legacy-inventory"/u
  );
  assert.doesNotMatch(template, /class="rm-compact-item"/u);
});

test("GroupsApp maps active, registered, and unregistered card states", async () => {
  const restoreFoundry = installFoundryApplicationStub();
  const previousGame = globalThis.game;
  globalThis.game = {
    actors: {
      contents: [
        { id: "active", name: "Active", type: "group", img: "active.webp", system: { members: [{}, {}] } },
        { id: "registered", name: "Registered", type: "group", img: "registered.webp", system: { members: [{}] } },
        { id: "new", name: "New", type: "group", img: "new.webp", system: { members: [] } }
      ]
    }
  };

  try {
    const { GroupsApp } = await import(`../scripts/ui/groups-app.js?card-states=${Date.now()}`);
    const app = new GroupsApp({
      getGroupRegistry: () => ({
        activeGroupActorId: "active",
        groupsById: {
          active: { initializedAt: 1 },
          registered: { initializedAt: 2 }
        }
      })
    });
    const context = await app._prepareContext();
    const groups = Object.fromEntries(context.groups.map((group) => [group.id, group]));

    assert.equal(groups.active.stateClass, "is-active");
    assert.equal(groups.active.showCurrentGroup, true);
    assert.equal(groups.active.showSetActive, false);
    assert.equal(groups.active.showRegister, false);

    assert.equal(groups.registered.stateClass, "is-registered");
    assert.equal(groups.registered.showCurrentGroup, false);
    assert.equal(groups.registered.showSetActive, true);
    assert.equal(groups.registered.showRegister, false);

    assert.equal(groups.new.stateClass, "is-unregistered");
    assert.equal(groups.new.showCurrentGroup, false);
    assert.equal(groups.new.showSetActive, false);
    assert.equal(groups.new.showRegister, true);
  }
  finally {
    globalThis.game = previousGame;
    restoreFoundry();
  }
});

test("groups card grid has isolated responsive styles", async () => {
  const css = await readFile(new URL("../styles/main.css", import.meta.url), "utf8");

  assert.match(
    css,
    /\.rebreya-groups-app \.rm-groups-grid\s*\{[^}]*grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\);/su
  );
  assert.match(css, /\.rebreya-groups-app \.rm-group-card\s*\{[^}]*display:\s*grid;/su);
  assert.match(css, /\.rebreya-groups-app \.rm-group-card\.is-active\s*\{[^}]*border-top-color:\s*var\(--rm-accent\);/su);
  assert.match(
    css,
    /@media \(max-width:\s*760px\)[\s\S]*\.rebreya-groups-app \.rm-groups-grid\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\);/su
  );
});
