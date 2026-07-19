import test from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";

const RELEASED_CACHE_VERSION = "1\\.4\\.96";

function compareVersion(a, b) {
  const left = String(a).split(".").map((part) => Number.parseInt(part, 10) || 0);
  const right = String(b).split(".").map((part) => Number.parseInt(part, 10) || 0);
  const length = Math.max(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    const delta = (left[index] ?? 0) - (right[index] ?? 0);
    if (delta) {
      return delta;
    }
  }
  return 0;
}

async function readCanonicalEntrypointSource() {
  return readFile(new URL("../scripts/main.js", import.meta.url), "utf8");
}

test("module manifest enables the Foundry module socket namespace", async () => {
  const manifest = JSON.parse(await readFile(new URL("../module.json", import.meta.url), "utf8"));

  assert.equal(manifest.socket, true);
});

test("module manifest loads a cache-busted entrypoint for the current version", async () => {
  const manifestUrl = new URL("../module.json", import.meta.url);
  const manifest = JSON.parse(await readFile(manifestUrl, "utf8"));
  const scripts = await readdir(new URL("../scripts/", import.meta.url));
  const latestEntrypointVersion = scripts
    .map((fileName) => fileName.match(/^main-(\d+\.\d+\.\d+)\.js$/u)?.[1] ?? "")
    .filter(Boolean)
    .sort(compareVersion)
    .at(-1);
  const expectedEntrypoint = `scripts/main-${manifest.version}.js`;
  const entrypointSource = await readFile(new URL(expectedEntrypoint, manifestUrl), "utf8");
  const expectedSource = [
    "// @rebreya-role active-version-forwarder",
    'import "./main.js?v=1.4.99-item-upgrade-row-root";',
    ""
  ].join("\n");

  assert.equal(manifest.version, "1.4.99");
  assert.equal(manifest.version, latestEntrypointVersion);
  assert.deepEqual(manifest.esmodules, [expectedEntrypoint]);
  assert.equal(entrypointSource, expectedSource);
  assert.doesNotMatch(entrypointSource, /(?:class\s+RebreyaMainModule|Hooks\.(?:once|on)\s*\()/u);
});

test("current entrypoint cache-busts the changed craft durability and transfer graph", async () => {
  const canonicalSource = await readCanonicalEntrypointSource();

  for (const importPath of [
    "data/downtime-service.js?v=1.4.96-craft-calendar",
    "data/inventory-service.js?v=1.4.96-durable-transfer",
    "data/durability-service.js?v=1.4.96-durability",
    "data/crafting-service.js?v=1.4.96-craft-calendar",
    "data/craft-downtime-service.js?v=1.4.96-craft-calendar",
    "data/calendar-transition-coordinator.js?v=1.4.96-craft-calendar",
    "integrations/durability-hooks.js?v=1.4.96-durability-piles",
    "integrations/item-piles-dnd5e.js?v=1.4.96-durability-piles",
    "integrations/inventory-sync.js?v=1.4.96-durable-transfer"
  ]) {
    assert.equal(canonicalSource.includes(importPath), true, importPath);
  }

  assert.match(
    canonicalSource,
    /import\(`\.\/ui\/lootgen-app\.js\?v=\$\{encodeURIComponent\(moduleVersion\)\}`\)/u
  );
});

test("module keeps the previous version forwarder for already-running Foundry instances", async () => {
  const manifestUrl = new URL("../module.json", import.meta.url);
  const manifest = JSON.parse(await readFile(manifestUrl, "utf8"));
  const scripts = await readdir(new URL("../scripts/", import.meta.url));
  const versionedEntrypoints = scripts
    .filter((fileName) => /^main-\d+\.\d+\.\d+\.js$/u.test(fileName))
    .sort();
  const legacyEntrypoint = "main-1.4.98.js";
  const legacySource = await readFile(new URL(`../scripts/${legacyEntrypoint}`, import.meta.url), "utf8");

  assert.deepEqual(versionedEntrypoints, [legacyEntrypoint, `main-${manifest.version}.js`]);
  assert.match(legacySource, /@rebreya-role legacy-version-forwarder/u);
  assert.match(legacySource, /import "\.\/main\.js\?v=1\.4\.99-legacy-main-1\.4\.98";/u);
});

test("canonical module entrypoint owns the live composition root", async () => {
  const canonicalSource = await readCanonicalEntrypointSource();

  assert.match(canonicalSource, /@rebreya-role canonical-composition-root/u);
  assert.match(canonicalSource, /export class RebreyaMainModule/u);
});

test("durability service and its persisted mutation journal are wired into the live module", async () => {
  const canonicalSource = await readCanonicalEntrypointSource();
  const constantsModule = await import("../scripts/constants.js");

  assert.equal(constantsModule.DURABILITY_UPDATED_HOOK, "rebreya-main.durabilityUpdated");
  assert.equal(constantsModule.SETTINGS_KEYS.DURABILITY_MUTATION_JOURNAL, "durabilityMutationJournal");
  assert.match(canonicalSource, /import \{ DurabilityService \} from "\.\/data\/durability-service\.js\?v=1\.4\.96-durability";/u);
  assert.match(canonicalSource, /this\.inventoryService = new InventoryService\(this\);\s+this\.durabilityService = new DurabilityService\(this\);/u);
  assert.match(canonicalSource, /game\.settings\.register\(MODULE_ID, SETTINGS_KEYS\.DURABILITY_MUTATION_JOURNAL,/u);
  for (const method of ["initializeItem", "damageItem", "breakItem", "destroyItem", "getDurability", "isBroken"]) {
    assert.match(canonicalSource, new RegExp(`\\n  ${method}\\(item`, "u"));
  }
});

test("Item Piles integration is invoked from both init and ready lifecycle call sites", async () => {
  const canonicalSource = await readCanonicalEntrypointSource();
  const initStart = canonicalSource.indexOf('Hooks.once("init"');
  const readyStart = canonicalSource.indexOf('Hooks.once("ready"');
  const initSource = canonicalSource.slice(initStart, readyStart);
  const readySource = canonicalSource.slice(readyStart);

  assert.match(canonicalSource, /import\s+\{[^}]*ensureItemPilesDnD5eIntegration[^}]*\}\s+from "\.\/integrations\/item-piles-dnd5e\.js(?:\?[^"\s]+)?";/u);
  assert.match(initSource, /ensureItemPilesDnD5eIntegration\(\)/u);
  assert.match(readySource, /await ensureItemPilesDnD5eIntegration\(\)/u);
});

test("legacy settings relay is an explicit deprecated compatibility boundary", async () => {
  const compatibilitySymbols = [
    "SOCKET_EVENT_SET_SETTING",
    "SOCKET_EVENT_SET_SETTING_RESULT",
    "handleSettingsUpdateSocketResponse",
    "requestSettingsUpdate"
  ].sort();
  const settingsSource = await readFile(new URL("../scripts/settings.js", import.meta.url), "utf8");

  assert.doesNotMatch(settingsSource, /pendingSettingUpdates|function\s+(?:handleSettingsUpdateSocketResponse|requestSettingsUpdate)/u);
  assert.match(settingsSource, /from "\.\/legacy\/settings-socket-relay\.js";/u);

  const [settingsModule, legacyModule, legacySource] = await Promise.all([
    import("../scripts/settings.js"),
    import("../scripts/legacy/settings-socket-relay.js"),
    readFile(new URL("../scripts/legacy/settings-socket-relay.js", import.meta.url), "utf8")
  ]);

  assert.deepEqual(Object.keys(legacyModule).sort(), compatibilitySymbols);
  assert.deepEqual(Object.keys(settingsModule).sort(), [...compatibilitySymbols, "registerSettings"].sort());
  for (const symbol of compatibilitySymbols) {
    assert.equal(settingsModule[symbol], legacyModule[symbol]);
  }
  assert.equal(Array.from(legacySource.matchAll(/@deprecated/gu)).length, compatibilitySymbols.length);
});

test("legacy settings relay fails closed when a world-setting socket is unavailable", async () => {
  const originalGame = globalThis.game;
  globalThis.game = {
    user: { id: "player-1", isGM: false },
    settings: {
      settings: new Map([["rebreya.groupState", { scope: "world" }]]),
      set() {
        throw new Error("world setting must not be written locally");
      }
    },
    socket: {}
  };

  try {
    const { requestSettingsUpdate } = await import("../scripts/settings.js");

    await assert.rejects(
      requestSettingsUpdate("groupState", { version: 1 }),
      (error) => error?.code === "raw-setting-disabled" && error?.message === "raw-setting-disabled"
    );
  }
  finally {
    if (originalGame === undefined) {
      delete globalThis.game;
    }
    else {
      globalThis.game = originalGame;
    }
  }
});

test("module stylesheet cache bust preserves the released item upgrade version", async () => {
  const entrypointSource = await readCanonicalEntrypointSource();
  const escapedVersion = RELEASED_CACHE_VERSION;

  assert.match(entrypointSource, new RegExp(`const MODULE_STYLE_VERSION = "${escapedVersion}-item-upgrade-slots";`, "u"));
  assert.match(entrypointSource, /const stylesheetHref = `\$\{MODULE_STYLE_PATH\}\?v=\$\{encodeURIComponent\(MODULE_STYLE_VERSION\)\}`;/u);
  assert.doesNotMatch(entrypointSource, /module\?\.version\s*\?\?/u);
});

test("module entrypoint preserves the released magic weapon template cache bust", async () => {
  const entrypointSource = await readCanonicalEntrypointSource();
  const escapedVersion = RELEASED_CACHE_VERSION;

  assert.match(entrypointSource, /registerMagicWeaponTemplateHook/u);
  assert.match(
    entrypointSource,
    new RegExp(`magic-weapon-template\\.js\\?v=${escapedVersion}`, "u"),
  );
  assert.match(entrypointSource, /registerMagicWeaponTemplateHook\(moduleApi\)/u);
});

test("gear compendium import preserves the released firearm activity cache bust", async () => {
  const entrypointSource = await readCanonicalEntrypointSource();
  const escapedVersion = RELEASED_CACHE_VERSION;

  assert.match(
    entrypointSource,
    new RegExp(`gear-compendium\\.js\\?v=${escapedVersion}-firearm-template-version-18`, "u"),
  );
});

test("combat automation imports preserve their released cache busts", async () => {
  const entrypointSource = await readCanonicalEntrypointSource();
  const statusServiceSource = await readFile(new URL("../scripts/combat/status-service.js", import.meta.url), "utf8");
  const escapedVersion = RELEASED_CACHE_VERSION;

  assert.match(
    entrypointSource,
    new RegExp(`combat/hooks\\.js\\?v=${escapedVersion}-firearm-item-sheet-no-rerender`, "u"),
  );
  assert.match(
    entrypointSource,
    new RegExp(`attack-service\\.js\\?v=${escapedVersion}-firearm-weight-threshold`, "u"),
  );
  assert.match(
    entrypointSource,
    new RegExp(`environment-automation-service\\.js\\?v=${escapedVersion}-environment-stable-statuses`, "u"),
  );
  assert.match(
    entrypointSource,
    new RegExp(`mechanus-rolls\\.js\\?v=${escapedVersion}-mechanus-d20-advantage-mode`, "u"),
  );
  assert.match(
    entrypointSource,
    new RegExp(`status-service\\.js\\?v=${escapedVersion}-surrounded-ac`, "u"),
  );
  assert.match(
    entrypointSource,
    new RegExp(`sorcerer-automation-service\\.js\\?v=${escapedVersion}-sorcerer-cooldown-card`, "u"),
  );
  assert.match(
    statusServiceSource,
    new RegExp(`status-definitions\\.js\\?v=${escapedVersion}-surrounded-ac`, "u"),
  );
});

test("held item integrations preserve their released cache bust", async () => {
  const entrypointSource = await readCanonicalEntrypointSource();
  const sheetSource = await readFile(new URL("../scripts/integrations/dnd5e-sheet-extensions.js", import.meta.url), "utf8");
  const attackSource = await readFile(new URL("../scripts/combat/attack-service.js", import.meta.url), "utf8");
  const escapedVersion = RELEASED_CACHE_VERSION;

  assert.match(
    entrypointSource,
    new RegExp(`dnd5e-sheet-extensions\\.js\\?v=${escapedVersion}-item-upgrade-row-root`, "u"),
  );
  assert.match(
    entrypointSource,
    new RegExp(`attack-service\\.js\\?v=${escapedVersion}-firearm-weight-threshold`, "u"),
  );
  assert.match(
    sheetSource,
    new RegExp(`held-items\\.js\\?v=${escapedVersion}-npc-held-natural`, "u"),
  );
  assert.match(
    attackSource,
    new RegExp(`held-items\\.js\\?v=${escapedVersion}-npc-held-natural`, "u"),
  );
});

test("item upgrade service and sheet integration preserve their released cache bust", async () => {
  const entrypointSource = await readCanonicalEntrypointSource();
  const sheetSource = await readFile(new URL("../scripts/integrations/dnd5e-sheet-extensions.js", import.meta.url), "utf8");
  const escapedVersion = RELEASED_CACHE_VERSION;

  assert.match(
    entrypointSource,
    new RegExp(`item-upgrade-service\\.js\\?v=${escapedVersion}-item-upgrades`, "u"),
  );
  assert.match(entrypointSource, /this\.itemUpgradeService = new ItemUpgradeService\(this\)/u);
  assert.match(entrypointSource, /installItemUpgrade\(hostItem, upgradeItem, options = \{\}\)/u);
  assert.match(entrypointSource, /removeItemUpgrade\(hostItem, upgradeItemOrId\)/u);
  assert.match(entrypointSource, /setItemUpgradeCapacity\(hostItem, capacity\)/u);
  assert.match(
    sheetSource,
    new RegExp(`item-upgrade-sheet\\.js\\?v=${escapedVersion}-item-upgrade-row-root`, "u"),
  );
  assert.match(sheetSource, /item-mods-tab\.hbs/u);
  assert.match(sheetSource, /bindItemUpgradeSheet\(root, app, moduleApi/u);
  assert.match(sheetSource, /bindItemUpgradeInventoryRows\(root, \{ actor, app, moduleApi, rerenderActorSheet \}/u);
  assert.match(sheetSource, /registerItemUpgradeFilterHook/u);
  assert.match(sheetSource, /registerItemUpgradeFilterHook\(\)/u);
  assert.match(sheetSource, /hideInstalledUpgradeInventoryRows\(root, actor\)/u);
});
