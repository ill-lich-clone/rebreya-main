import test from "node:test";
import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";

const RELEASED_CACHE_VERSION = "1\\.4\\.96";

async function readCanonicalEntrypointSource() {
  return readFile(new URL("../scripts/main.js", import.meta.url), "utf8");
}

async function readJavaScriptTree(relativeDirectory) {
  const root = new URL(relativeDirectory, import.meta.url);
  const files = [];

  async function visit(directory, relativePath = "") {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const entryPath = new URL(entry.name, directory.href.endsWith("/") ? directory : new URL(`${directory.href}/`));
      const relativeEntryPath = relativePath ? `${relativePath}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        await visit(new URL(`${entryPath.href}/`), relativeEntryPath);
      }
      else if (entry.isFile() && entry.name.endsWith(".js")) {
        files.push({
          path: `${relativeDirectory.replace(/^\.\.\//u, "")}${relativeEntryPath}`,
          source: await readFile(entryPath, "utf8")
        });
      }
    }
  }

  await visit(root);
  return files;
}

test("module manifest enables the Foundry module socket namespace", async () => {
  const manifest = JSON.parse(await readFile(new URL("../module.json", import.meta.url), "utf8"));

  assert.equal(manifest.socket, true);
});

test("module manifest keeps both legacy Craftsman item types readable for migration compatibility", async () => {
  const manifest = JSON.parse(await readFile(new URL("../module.json", import.meta.url), "utf8"));
  const legacyTypeSource = await readFile(
    new URL("../scripts/integrations/craftsman-archetype-types.js", import.meta.url),
    "utf8"
  );

  for (const type of ["research", "specialty"]) {
    assert.deepEqual(manifest.documentTypes.Item[type].htmlFields, [
      "description.value",
      "description.chat"
    ]);
  }
  assert.match(legacyTypeSource, /export function registerLegacyCraftsmanArchetypeTypes/u);
  assert.doesNotMatch(legacyTypeSource, /ResearchChoice|SpecialtyChoice/u);
});

test("module manifest loads the stable canonical entrypoint", async () => {
  const manifestUrl = new URL("../module.json", import.meta.url);
  const manifest = JSON.parse(await readFile(manifestUrl, "utf8"));
  const entrypointSource = await readFile(new URL("scripts/main.js", manifestUrl), "utf8");

  assert.equal(manifest.version, "1.4.108");
  assert.deepEqual(manifest.esmodules, ["scripts/main.js"]);
  assert.match(entrypointSource, /@rebreya-role canonical-composition-root/u);
  assert.match(entrypointSource, /export class RebreyaMainModule/u);
});

test("production wiring uses native Craftsman advancement, lifecycle, and migration modules", async () => {
  const [entrypointSource, sheetSource] = await Promise.all([
    readCanonicalEntrypointSource(),
    readFile(new URL("../scripts/integrations/dnd5e-sheet-extensions.js", import.meta.url), "utf8")
  ]);

  assert.match(
    sheetSource,
    /import \{ registerCraftsmanSubclassAdvancements \} from "\.\/craftsman-subclass-advancements\.js";/u
  );
  assert.match(
    sheetSource,
    /import \{ registerCraftsmanMultiSubclassIntegration \} from "\.\/craftsman-multi-subclass\.js";/u
  );
  assert.match(
    sheetSource,
    /registerCraftsmanClassCardIntegration,\s+registerCraftsmanTidyContent\s+\} from "\.\/craftsman-archetype-sheet\.js";/u
  );
  assert.match(sheetSource, /registerCraftsmanSubclassAdvancements\(\);/u);
  assert.match(sheetSource, /registerCraftsmanMultiSubclassIntegration\(\);/u);
  assert.match(sheetSource, /registerCraftsmanClassCardIntegration\(CharacterActorSheet\);/u);
  assert.match(sheetSource, /registerCraftsmanTidyContent\(\);/u);

  assert.match(
    entrypointSource,
    /import \{ CraftsmanSubclassMigrationService \} from "\.\/data\/craftsman-subclass-migration\.js";/u
  );
  assert.match(entrypointSource, /this\.craftsmanSubclassMigration = new CraftsmanSubclassMigrationService\(\);/u);
  assert.match(entrypointSource, /await this\.craftsmanSubclassMigration\.migrateWorldActors\(\);/u);
});

test("production does not register legacy Craftsman choice advancements", async () => {
  const productionFiles = await readJavaScriptTree("../scripts/");

  for (const legacyType of ["ResearchChoice", "SpecialtyChoice"]) {
    const references = productionFiles.filter(({ source }) => source.includes(legacyType));
    assert.deepEqual(
      references.map(({ path }) => path),
      ["scripts/data/craftsman-subclass-migration.js"],
      `${legacyType} must remain migration input only`
    );
  }
});

test("production has no preload, sheet part, or template reference to retired Craftsman templates", async () => {
  const productionFiles = await readJavaScriptTree("../scripts/");
  const manifestSource = await readFile(new URL("../module.json", import.meta.url), "utf8");
  const templateNames = ["craftsman-archetypes.hbs", "craftsman-archetypes-standard.hbs"];

  for (const templateName of templateNames) {
    assert.equal(
      productionFiles.some(({ source }) => source.includes(templateName)),
      false,
      templateName
    );
    assert.equal(manifestSource.includes(templateName), false, templateName);
    await assert.rejects(readFile(new URL(`../templates/${templateName}`, import.meta.url), "utf8"), { code: "ENOENT" });
  }
  assert.equal(
    productionFiles.some(({ source }) => /craftsmanArchetypes/u.test(source)),
    false,
    "retired craftsmanArchetypes sheet part"
  );
});

test("legacy Craftsman compendium identifier is restricted to retirement and migration diagnostics", async () => {
  const productionFiles = await readJavaScriptTree("../scripts/");
  const literalReferences = productionFiles.filter(({ source }) => source.includes("rebreya-craftsman-archetypes"));
  const constantReferences = productionFiles.filter(({ source }) => (
    source.includes("LEGACY_CRAFTSMAN_ARCHETYPES_COMPENDIUM_NAME")
  ));
  const classesSource = await readFile(new URL("../scripts/data/classes-compendium.js", import.meta.url), "utf8");

  assert.deepEqual(literalReferences.map(({ path }) => path), ["scripts/constants.js"]);
  assert.deepEqual(constantReferences.map(({ path }) => path).sort(), [
    "scripts/constants.js",
    "scripts/data/classes-compendium.js"
  ]);
  assert.match(classesSource, /LEGACY_CRAFTSMAN_ARCHETYPES_COMPENDIUM_NAME/u);
  assert.match(classesSource, /retireLegacyCraftsmanArchetypesPack/u);
  assert.doesNotMatch(classesSource, /syncCraftsmanArchetypesPack/u);
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

test("module keeps recent published entrypoint URLs as canonical compatibility forwarders", async () => {
  const manifestUrl = new URL("../module.json", import.meta.url);
  const manifest = JSON.parse(await readFile(manifestUrl, "utf8"));

  assert.deepEqual(manifest.esmodules, ["scripts/main.js"]);

  for (const fileName of ["main-1.4.98.js", "main-1.4.99.js", "main-1.4.100.js"]) {
    const forwarderSource = await readFile(new URL(`../scripts/${fileName}`, import.meta.url), "utf8");

    assert.equal(
      forwarderSource,
      [
        "// @rebreya-role legacy-entrypoint-compatibility-forwarder",
        'import "./main.js";',
        ""
      ].join("\n"),
      fileName
    );
    assert.doesNotMatch(forwarderSource, /\?v=/u, `${fileName} must not instantiate a second composition root`);
  }
});

test("module entrypoint cache-busts stale ActiveEffect deletion handling", async () => {
  const entrypointSource = await readCanonicalEntrypointSource();

  assert.match(
    entrypointSource,
    /combat\/status-service\.js\?v=1\.4\.100-stale-active-effect-delete/u
  );
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
    /status-service\.js\?v=1\.4\.100-stale-active-effect-delete/u,
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
