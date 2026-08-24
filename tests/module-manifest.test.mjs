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

test("module manifest exposes only native subclass Items for Craftsman", async () => {
  const manifest = JSON.parse(await readFile(new URL("../module.json", import.meta.url), "utf8"));

  for (const type of ["research", "specialty"]) {
    assert.equal(manifest.documentTypes.Item[type], undefined);
  }
  await assert.rejects(
    readFile(new URL("../scripts/integrations/craftsman-archetype-types.js", import.meta.url), "utf8"),
    { code: "ENOENT" }
  );
});

test("module manifest declares the physical Craftsman gadget Item type", async () => {
  const manifest = JSON.parse(await readFile(new URL("../module.json", import.meta.url), "utf8"));

  assert.deepEqual(manifest.documentTypes.Item.gadget, {
    htmlFields: ["description.value", "description.chat"]
  });
});

test("module manifest loads the stable canonical entrypoint", async () => {
  const manifestUrl = new URL("../module.json", import.meta.url);
  const manifest = JSON.parse(await readFile(manifestUrl, "utf8"));
  const [entrypoint] = manifest.esmodules;

  assert.equal(manifest.version, "1.4.157");
  assert.deepEqual(manifest.esmodules, ["scripts/main-1.4.157.js"]);
  assert.doesNotMatch(entrypoint, /[?#]/u);

  const entrypointSource = await readFile(new URL(entrypoint, manifestUrl), "utf8");
  assert.equal(
    entrypointSource,
    [
      "// @rebreya-role versioned-entrypoint-cache-forwarder",
      'import "./main.js?v=1.4.157-firearm-io-batching";',
      ""
    ].join("\n")
  );
});

test("canonical entrypoint cache-busts the player-list inventory token launcher", async () => {
  const entrypointSource = await readCanonicalEntrypointSource();

  assert.match(
    entrypointSource,
    /hooks\.js\?v=1\.4\.149-round-player-utilities/u
  );
  assert.match(
    entrypointSource,
    /game\.rebreyaMain = moduleApi;[\s\S]*?refreshPlayerInventoryQuickButton\(moduleApi\);/u
  );
});

test("production wiring uses native Craftsman advancement and lifecycle without actor migration", async () => {
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
    /registerCraftsmanClassCardIntegration,\s+registerCraftsmanTidyContent\s+\} from "\.\/craftsman-archetype-sheet\.js\?v=1\.4\.109-native-standard";/u
  );
  assert.match(sheetSource, /registerCraftsmanSubclassAdvancements\(\);/u);
  assert.match(sheetSource, /registerCraftsmanMultiSubclassIntegration\(\);/u);
  assert.match(sheetSource, /registerCraftsmanClassCardIntegration\(CharacterActorSheet\);/u);
  assert.match(sheetSource, /registerCraftsmanTidyContent\(\);/u);

  assert.doesNotMatch(entrypointSource, /CraftsmanSubclassMigrationService/u);
  assert.doesNotMatch(entrypointSource, /craftsmanSubclassMigration/u);
  assert.doesNotMatch(entrypointSource, /migrateWorldActors/u);
  await assert.rejects(
    readFile(new URL("../scripts/data/craftsman-subclass-migration.js", import.meta.url), "utf8"),
    { code: "ENOENT" }
  );
});

test("production registers the hidden GiantTribe advancement before race compendiums are materialized", async () => {
  const [entrypointSource, sheetSource, advancementSource, automationSource] = await Promise.all([
    readCanonicalEntrypointSource(),
    readFile(new URL("../scripts/integrations/dnd5e-sheet-extensions.js", import.meta.url), "utf8"),
    readFile(new URL("../scripts/integrations/giant-tribe-advancement.js", import.meta.url), "utf8"),
    readFile(new URL("../scripts/combat/race-automation-service.js", import.meta.url), "utf8")
  ]);

  assert.match(
    sheetSource,
    /import \{ registerGiantTribeAdvancement \} from "\.\/giant-tribe-advancement\.js\?v=1\.4\.110-giant-tribe-cache-fixes-2";/u
  );
  assert.match(
    sheetSource,
    /extendDnd5eItemTypes[\s\S]*?registerGiantTribeAdvancement\(\);/u
  );
  assert.match(
    entrypointSource,
    /dnd5e-sheet-extensions\.js\?v=1\.4\.147-native-ammunition/u
  );
  assert.match(
    entrypointSource,
    /data\/races-compendium\.js\?v=1\.4\.110-giant-tribe-cache-fixes-2/u
  );
  assert.match(
    advancementSource,
    /race-automation-service\.js\?v=1\.4\.110-giant-tribe-cache-fixes-2/u
  );
  assert.match(
    automationSource,
    /data\/races-compendium\.js\?v=1\.4\.110-giant-tribe-cache-fixes-2/u
  );
});

test("production does not register legacy Craftsman choice advancements", async () => {
  const productionFiles = await readJavaScriptTree("../scripts/");

  for (const legacyType of ["ResearchChoice", "SpecialtyChoice"]) {
    const references = productionFiles.filter(({ source }) => source.includes(legacyType));
    assert.deepEqual(references.map(({ path }) => path), [], `${legacyType} must not exist in production`);
  }
});

test("production has no preload, sheet part, or template reference to retired Craftsman templates", async () => {
  const productionFiles = await readJavaScriptTree("../scripts/");
  const manifestSource = await readFile(new URL("../module.json", import.meta.url), "utf8");
  const templateNames = [
    "craftsman-archetypes.hbs",
    "craftsman-archetypes-standard.hbs",
    "craftsman-character-features.hbs",
    "craftsman-actor-classes.hbs"
  ];

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

test("production has no legacy Craftsman compendium retirement path", async () => {
  const productionFiles = await readJavaScriptTree("../scripts/");
  const literalReferences = productionFiles.filter(({ source }) => source.includes("rebreya-craftsman-archetypes"));
  const constantReferences = productionFiles.filter(({ source }) => (
    source.includes("LEGACY_CRAFTSMAN_ARCHETYPES_COMPENDIUM_NAME")
  ));
  const classesSource = await readFile(new URL("../scripts/data/classes-compendium.js", import.meta.url), "utf8");

  assert.deepEqual(literalReferences.map(({ path }) => path), []);
  assert.deepEqual(constantReferences.map(({ path }) => path), []);
  assert.doesNotMatch(classesSource, /retireLegacyCraftsmanArchetypesPack|syncCraftsmanArchetypesPack/u);
});

test("current entrypoint cache-busts the changed craft durability and transfer graph", async () => {
  const canonicalSource = await readCanonicalEntrypointSource();
  const traderServiceSource = await readFile(new URL("../scripts/data/trader-service.js", import.meta.url), "utf8");
  const durabilityServiceSource = await readFile(new URL("../scripts/data/durability-service.js", import.meta.url), "utf8");
  const durabilityHooksSource = await readFile(new URL("../scripts/integrations/durability-hooks.js", import.meta.url), "utf8");
  const nativeObjectDurabilitySource = await readFile(
    new URL("../scripts/data/native-object-durability-service.js", import.meta.url),
    "utf8"
  );
  const inventoryServiceSource = await readFile(new URL("../scripts/data/inventory-service.js", import.meta.url), "utf8");
  const lootgenAppSource = await readFile(new URL("../scripts/ui/lootgen-app.js", import.meta.url), "utf8");
  const lootgenGeneratorSource = await readFile(new URL("../scripts/data/lootgen-generator.js", import.meta.url), "utf8");
  const groundPileServiceSource = await readFile(
    new URL("../scripts/data/storage-ground-pile-service.js", import.meta.url),
    "utf8"
  );

  assert.match(
    canonicalSource,
    /integrations\/dnd5e-sheet-extensions\.js\?v=1\.4\.147-native-ammunition/u
  );

  for (const importPath of [
    "data/trader-service.js?v=1.4.109-lazy-trader-restock",
    "data/downtime-service.js?v=1.4.96-craft-calendar",
    "data/inventory-service.js?v=1.4.156-inventory-folder-exports",
    "data/durability-service.js?v=1.4.154-corpse-storage-broken-name",
    "data/corpse-storage-materializer.js?v=1.4.154-corpse-storage-broken-name",
    "data/native-object-durability-service.js?v=1.4.153-corpse-creature",
    "data/crafting-service.js?v=1.4.96-craft-calendar",
    "data/craft-downtime-service.js?v=1.4.96-craft-calendar",
    "data/calendar-transition-coordinator.js?v=1.4.96-craft-calendar",
    "integrations/durability-hooks.js?v=1.4.153-corpse-creature",
    "integrations/storage-token-hooks.js?v=1.4.154-corpse-storage-broken-name",
    "integrations/inventory-sync.js?v=1.4.96-durable-transfer",
    "data/gear-compendium.js?v=1.4.145-coin-icons-storage-sound",
    "data/storage-open-sound-service.js?v=1.4.145-coin-icons-storage-sound",
    "data/storage-service.js?v=1.4.152-dead-npc-looting",
    "data/storage-ground-pile-service.js?v=1.4.155-journal-pile-presentation",
    "data/storage-container-item-service.js?v=1.4.130-storage-player-fixes",
    "data/storage-deposit-source.js?v=1.4.144-spreadsheet-coins-ground-repair",
    "data/storage-command-service.js?v=1.4.152-dead-npc-looting",
    "integrations/storage-transfer-drop.js?v=1.4.144-spreadsheet-coins-ground-repair",
    "integrations/storage-token-drop.js?v=1.4.132-storage-owned-character-resolution"
  ]) {
    assert.equal(canonicalSource.includes(importPath), true, importPath);
  }
  assert.equal(
    durabilityServiceSource.includes("durability-rules.js?v=1.4.144-spreadsheet-coins-ground-repair"),
    true,
    "durability rule changes need their own browser module cache key"
  );
  assert.equal(
    durabilityHooksSource.includes("data/storage-object-kind.js?v=1.4.153-corpse-creature"),
    true,
    "corpse object classification changes need their own browser module cache key"
  );
  assert.equal(
    nativeObjectDurabilitySource.includes("storage-object-kind.js?v=1.4.153-corpse-creature"),
    true,
    "native object resolution must share the corpse-safe classifier"
  );
  for (const [source, importPath] of [
    [inventoryServiceSource, "lootgen-durability.js?v=1.4.154-corpse-storage-broken-name"],
    [lootgenAppSource, "data/lootgen-durability.js?v=1.4.154-corpse-storage-broken-name"],
    [lootgenAppSource, "data/lootgen-generator.js?v=1.4.154-corpse-storage-broken-name"],
    [lootgenGeneratorSource, "lootgen-durability.js?v=1.4.154-corpse-storage-broken-name"]
  ]) {
    assert.equal(source.includes(importPath), true, importPath);
  }
  assert.equal(
    groundPileServiceSource.includes("storage-pile-presentation.js?v=1.4.155-journal-pile-presentation"),
    true,
    "ground-pile presentation changes need their own browser module cache key"
  );

  assert.match(
    canonicalSource,
    /import\(`\.\/ui\/lootgen-app\.js\?v=\$\{encodeURIComponent\(moduleVersion\)\}`\)/u
  );
  assert.match(
    canonicalSource,
    /storage-app\.js\?v=\$\{encodeURIComponent\(`\$\{moduleVersion\}-storage-window-drops`\)\}/u
  );
  assert.match(
    traderServiceSource,
    /engine\/trader-engine\.js\?v=1\.4\.109-lazy-trader-restock/u
  );
});

test("module keeps recent published entrypoint URLs as canonical compatibility forwarders", async () => {
  const manifestUrl = new URL("../module.json", import.meta.url);
  const manifest = JSON.parse(await readFile(manifestUrl, "utf8"));

  assert.deepEqual(manifest.esmodules, ["scripts/main-1.4.157.js"]);

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

test("the currently running 1.4.122 entrypoint forwards to the fixed storage graph", async () => {
  const source = await readFile(new URL("../scripts/main-1.4.122.js", import.meta.url), "utf8");

  assert.equal(
    source,
    [
      "// @rebreya-role versioned-entrypoint-cache-forwarder",
      'export * from "./main.js?v=1.4.123-storage-ground-item-transfer";',
      ""
    ].join("\n")
  );
});

test("the 1.4.123 entrypoint forwards to the immediate storage-token drop graph", async () => {
  const source = await readFile(new URL("../scripts/main-1.4.123.js", import.meta.url), "utf8");

  assert.equal(
    source,
    [
      "// @rebreya-role versioned-entrypoint-cache-forwarder",
      'export * from "./main.js?v=1.4.126-native-container-copies";',
      ""
    ].join("\n")
  );
});

test("the currently running 1.4.124 entrypoint forwards to the immediate storage-token drop graph", async () => {
  const source = await readFile(new URL("../scripts/main-1.4.124.js", import.meta.url), "utf8");

  assert.equal(
    source,
    [
      "// @rebreya-role versioned-entrypoint-cache-forwarder",
      'export * from "./main.js?v=1.4.126-native-container-copies";',
      ""
    ].join("\n")
  );
});

test("the 1.4.125 entrypoint forwards to the native-container copy graph", async () => {
  const source = await readFile(new URL("../scripts/main-1.4.125.js", import.meta.url), "utf8");

  assert.equal(
    source,
    [
      "// @rebreya-role versioned-entrypoint-cache-forwarder",
      'export * from "./main.js?v=1.4.126-native-container-copies";',
      ""
    ].join("\n")
  );
});

test("module entrypoint cache-busts stale ActiveEffect deletion handling", async () => {
  const entrypointSource = await readCanonicalEntrypointSource();

  assert.match(
    entrypointSource,
    /combat\/status-service\.js\?v=1\.4\.100-hp-dead-overlay/u
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
  assert.match(canonicalSource, /import \{ DurabilityService \} from "\.\/data\/durability-service\.js\?v=1\.4\.154-corpse-storage-broken-name";/u);
  assert.match(canonicalSource, /this\.inventoryService = new InventoryService\(this\);\s+this\.durabilityService = new DurabilityService\(this\);/u);
  assert.match(canonicalSource, /game\.settings\.register\(MODULE_ID, SETTINGS_KEYS\.DURABILITY_MUTATION_JOURNAL,/u);
  for (const method of ["initializeItem", "damageItem", "breakItem", "destroyItem", "getDurability", "isBroken"]) {
    assert.match(canonicalSource, new RegExp(`\\n  ${method}\\(item`, "u"));
  }
});

test("canonical entrypoint has no Item Piles integration lifecycle", async () => {
  const canonicalSource = await readCanonicalEntrypointSource();

  assert.doesNotMatch(canonicalSource, /item.?piles|itempiles/iu);
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

test("module stylesheet cache bust loads the storage deposit interaction styles", async () => {
  const entrypointSource = await readCanonicalEntrypointSource();

  assert.match(entrypointSource, /const MODULE_STYLE_VERSION = "1\.4\.120-storage-character-drop";/u);
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

test("gear compendium import uses the current spreadsheet coin cache bust", async () => {
  const entrypointSource = await readCanonicalEntrypointSource();

  assert.match(
    entrypointSource,
    /gear-compendium\.js\?v=1\.4\.145-coin-icons-storage-sound/u,
  );
});

test("combat automation imports preserve their released cache busts", async () => {
  const entrypointSource = await readCanonicalEntrypointSource();
  const statusServiceSource = await readFile(new URL("../scripts/combat/status-service.js", import.meta.url), "utf8");
  const escapedVersion = RELEASED_CACHE_VERSION;

  assert.match(
    entrypointSource,
    /combat\/hooks\.js\?v=1\.4\.147-race-damage/u,
  );
  assert.match(
    entrypointSource,
    /attack-service\.js\?v=1\.4\.157-firearm-io-batching/u,
  );
  assert.match(
    entrypointSource,
    new RegExp(`environment-automation-service\\.js\\?v=${escapedVersion}-environment-stable-statuses`, "u"),
  );
  assert.match(
    entrypointSource,
    /mechanus-rolls\.js\?v=1\.4\.140-mechanus-dnd5e-activity-repair/u,
  );
  assert.match(
    entrypointSource,
    /status-service\.js\?v=1\.4\.100-hp-dead-overlay/u,
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

test("character size automation is wired into module initialization and combat hooks", async () => {
  const [entrypointSource, hooksSource] = await Promise.all([
    readCanonicalEntrypointSource(),
    readFile(new URL("../scripts/combat/hooks.js", import.meta.url), "utf8")
  ]);

  assert.match(
    entrypointSource,
    /import \{ SizeAutomationService \} from "\.\/combat\/size-automation-service\.js\?v=[^"]+";/u
  );
  assert.match(entrypointSource, /this\.sizeAutomationService = new SizeAutomationService\(this\);/u);
  assert.match(entrypointSource, /await this\.sizeAutomationService\.initialize\(\);/u);
  assert.match(hooksSource, /const hasSizeService = Boolean\(moduleApi\?\.sizeAutomationService\);/u);
  assert.match(hooksSource, /Hooks\.on\("updateActor"[\s\S]+handleActorUpdated/u);
  assert.match(hooksSource, /Hooks\.on\("createActiveEffect"[\s\S]+handleActiveEffectChanged/u);
  assert.match(hooksSource, /Hooks\.on\("deleteActiveEffect"[\s\S]+handleActiveEffectChanged/u);
  assert.match(hooksSource, /sizeAutomationService\.syncActor/u);
});

test("paladin dogma automation is constructed and routed through the current combat hooks import", async () => {
  const [entrypointSource, hooksSource] = await Promise.all([
    readCanonicalEntrypointSource(),
    readFile(new URL("../scripts/combat/hooks.js", import.meta.url), "utf8")
  ]);

  assert.match(
    entrypointSource,
    /import \{ PaladinDogmaAutomationService \} from "\.\/combat\/paladin-dogma-automation-service\.js\?v=1\.4\.111-paladin-dogmas";/u
  );
  assert.match(
    entrypointSource,
    /combat\/hooks\.js\?v=1\.4\.147-race-damage/u
  );
  assert.match(
    entrypointSource,
    /this\.paladinDogmaAutomationService = new PaladinDogmaAutomationService\(this\);/u
  );
  assert.match(
    hooksSource,
    /const hasPaladinDogmaService = Boolean\(moduleApi\?\.paladinDogmaAutomationService\);/u
  );
  assert.match(
    hooksSource,
    /paladinDogmaAutomationService\.handleCreatedItem\(item, options, userId\)/u
  );
  assert.match(
    hooksSource,
    /paladinDogmaAutomationService\.handleUpdatedItem\(item, changed, options, userId\)/u
  );
});

test("owned race and Giant Tribe configuration is wired to create and sheet repair hooks", async () => {
  const [entrypointSource, hooksSource] = await Promise.all([
    readCanonicalEntrypointSource(),
    readFile(new URL("../scripts/combat/hooks.js", import.meta.url), "utf8")
  ]);

  assert.match(entrypointSource, /race-automation-service\.js\?v=1\.4\.147-race-damage/u);
  assert.match(
    hooksSource,
    /moduleApi\.raceAutomationService\.handleCreatedItem\(item, options, userId\)/u
  );
  assert.match(hooksSource, /moduleApi\.raceAutomationService\.repairActor\(actor\)/u);
  assert.match(hooksSource, /CHARACTER_SHEET_RENDER_HOOKS/u);
});

test("held item integrations preserve their released cache bust", async () => {
  const entrypointSource = await readCanonicalEntrypointSource();
  const sheetSource = await readFile(new URL("../scripts/integrations/dnd5e-sheet-extensions.js", import.meta.url), "utf8");
  const attackSource = await readFile(new URL("../scripts/combat/attack-service.js", import.meta.url), "utf8");
  const escapedVersion = RELEASED_CACHE_VERSION;

  assert.match(
    entrypointSource,
    /dnd5e-sheet-extensions\.js\?v=1\.4\.147-native-ammunition/u,
  );
  assert.match(
    entrypointSource,
    /attack-service\.js\?v=1\.4\.157-firearm-io-batching/u,
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
    new RegExp(`item-upgrade-sheet\\.js\\?v=${escapedVersion}-item-upgrade-readable`, "u"),
  );
  assert.match(sheetSource, /item-mods-tab\.hbs/u);
  assert.match(sheetSource, /bindItemUpgradeSheet\(root, app, moduleApi/u);
  assert.match(sheetSource, /bindItemUpgradeInventoryRows\(root, \{ actor, app, moduleApi, rerenderActorSheet \}/u);
  assert.match(sheetSource, /registerItemUpgradeFilterHook/u);
  assert.match(sheetSource, /registerItemUpgradeFilterHook\(\)/u);
  assert.match(sheetSource, /hideInstalledUpgradeInventoryRows\(root, actor\)/u);
});
