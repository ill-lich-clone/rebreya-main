import test from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";

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
    'import "./main.js?v=1.4.93-npc-held-natural";',
    ""
  ].join("\n");

  assert.equal(manifest.version, latestEntrypointVersion);
  assert.deepEqual(manifest.esmodules, [expectedEntrypoint]);
  assert.equal(entrypointSource, expectedSource);
  assert.doesNotMatch(entrypointSource, /(?:class\s+RebreyaMainModule|Hooks\.(?:once|on)\s*\()/u);
});

test("legacy module entrypoints forward cached Foundry sessions to the current live entrypoint", async () => {
  const manifestUrl = new URL("../module.json", import.meta.url);
  const manifest = JSON.parse(await readFile(manifestUrl, "utf8"));
  const scripts = await readdir(new URL("../scripts/", import.meta.url));
  const legacyEntrypoints = scripts
    .map((fileName) => ({
      fileName,
      version: fileName.match(/^main-(\d+\.\d+\.\d+)\.js$/u)?.[1] ?? "",
    }))
    .filter(({ version }) => version
      && compareVersion(version, "1.4.67") >= 0
      && compareVersion(version, manifest.version) < 0)
    .sort((left, right) => compareVersion(left.version, right.version));
  const expectedSource = `import "./main.js?v=${manifest.version}-npc-held-natural";\n`;

  assert.ok(legacyEntrypoints.length > 0);
  for (const { fileName } of legacyEntrypoints) {
    const source = await readFile(new URL(`../scripts/${fileName}`, import.meta.url), "utf8");

    assert.equal(source, expectedSource, `${fileName} should delegate to current main.js`);
  }
});

test("canonical module entrypoint owns the live composition root", async () => {
  const canonicalSource = await readCanonicalEntrypointSource();

  assert.match(canonicalSource, /@rebreya-role canonical-composition-root/u);
  assert.match(canonicalSource, /export class RebreyaMainModule/u);
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

test("module stylesheet cache bust uses the live module style version", async () => {
  const manifestUrl = new URL("../module.json", import.meta.url);
  const manifest = JSON.parse(await readFile(manifestUrl, "utf8"));
  const entrypointSource = await readCanonicalEntrypointSource();
  const escapedVersion = manifest.version.replaceAll(".", "\\.");

  assert.match(entrypointSource, new RegExp(`const MODULE_STYLE_VERSION = "${escapedVersion}-item-upgrade-row-drop";`, "u"));
  assert.match(entrypointSource, /const stylesheetHref = `\$\{MODULE_STYLE_PATH\}\?v=\$\{encodeURIComponent\(MODULE_STYLE_VERSION\)\}`;/u);
  assert.doesNotMatch(entrypointSource, /module\?\.version\s*\?\?/u);
});

test("module entrypoint registers the live magic weapon template hook", async () => {
  const manifestUrl = new URL("../module.json", import.meta.url);
  const manifest = JSON.parse(await readFile(manifestUrl, "utf8"));
  const entrypointSource = await readCanonicalEntrypointSource();
  const escapedVersion = manifest.version.replaceAll(".", "\\.");

  assert.match(entrypointSource, /registerMagicWeaponTemplateHook/u);
  assert.match(
    entrypointSource,
    new RegExp(`magic-weapon-template\\.js\\?v=${escapedVersion}`, "u"),
  );
  assert.match(entrypointSource, /registerMagicWeaponTemplateHook\(moduleApi\)/u);
});

test("gear compendium import uses the firearm activity cache bust", async () => {
  const manifestUrl = new URL("../module.json", import.meta.url);
  const manifest = JSON.parse(await readFile(manifestUrl, "utf8"));
  const entrypointSource = await readCanonicalEntrypointSource();
  const escapedVersion = manifest.version.replaceAll(".", "\\.");

  assert.match(
    entrypointSource,
    new RegExp(`gear-compendium\\.js\\?v=${escapedVersion}-firearm-template-version-18`, "u"),
  );
});

test("combat automation imports use the current cache busts", async () => {
  const manifestUrl = new URL("../module.json", import.meta.url);
  const manifest = JSON.parse(await readFile(manifestUrl, "utf8"));
  const entrypointSource = await readCanonicalEntrypointSource();
  const statusServiceSource = await readFile(new URL("../scripts/combat/status-service.js", import.meta.url), "utf8");
  const escapedVersion = manifest.version.replaceAll(".", "\\.");

  assert.match(
    entrypointSource,
    new RegExp(`combat/hooks\\.js\\?v=${escapedVersion}-firearm-item-sheet-no-rerender`, "u"),
  );
  assert.match(
    entrypointSource,
    new RegExp(`attack-service\\.js\\?v=${escapedVersion}-firearm-card-notes`, "u"),
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
    statusServiceSource,
    new RegExp(`status-definitions\\.js\\?v=${escapedVersion}-surrounded-ac`, "u"),
  );
});

test("held item integrations use the current module cache bust", async () => {
  const manifestUrl = new URL("../module.json", import.meta.url);
  const manifest = JSON.parse(await readFile(manifestUrl, "utf8"));
  const entrypointSource = await readCanonicalEntrypointSource();
  const sheetSource = await readFile(new URL("../scripts/integrations/dnd5e-sheet-extensions.js", import.meta.url), "utf8");
  const attackSource = await readFile(new URL("../scripts/combat/attack-service.js", import.meta.url), "utf8");
  const escapedVersion = manifest.version.replaceAll(".", "\\.");

  assert.match(
    entrypointSource,
    new RegExp(`dnd5e-sheet-extensions\\.js\\?v=${escapedVersion}-spell-choice-filter`, "u"),
  );
  assert.match(
    entrypointSource,
    new RegExp(`attack-service\\.js\\?v=${escapedVersion}-firearm-card-notes`, "u"),
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

test("item upgrade service and sheet integration are wired into the live entrypoint", async () => {
  const manifestUrl = new URL("../module.json", import.meta.url);
  const manifest = JSON.parse(await readFile(manifestUrl, "utf8"));
  const entrypointSource = await readCanonicalEntrypointSource();
  const sheetSource = await readFile(new URL("../scripts/integrations/dnd5e-sheet-extensions.js", import.meta.url), "utf8");
  const escapedVersion = manifest.version.replaceAll(".", "\\.");

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
    new RegExp(`item-upgrade-sheet\\.js\\?v=${escapedVersion}-item-upgrade-row-drop`, "u"),
  );
  assert.match(sheetSource, /item-mods-tab\.hbs/u);
  assert.match(sheetSource, /bindItemUpgradeSheet\(root, app, moduleApi/u);
  assert.match(sheetSource, /bindItemUpgradeInventoryRows\(root, \{ actor, app, moduleApi, rerenderActorSheet \}/u);
  assert.match(sheetSource, /registerItemUpgradeFilterHook/u);
  assert.match(sheetSource, /registerItemUpgradeFilterHook\(\)/u);
  assert.match(sheetSource, /hideInstalledUpgradeInventoryRows\(root, actor\)/u);
});
