import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import test from "node:test";

import { buildGearIconLookup, resolveGearItemIcon, resolveGearNamedIcon } from "../scripts/data/gear-icon-resolver.js";
import { resolveNamedIcon } from "../scripts/data/compendium-utils.js";

const moduleRoot = resolve(import.meta.dirname, "..");
const modulePrefix = "modules/rebreya-main/";
const gear = JSON.parse(readFileSync(join(moduleRoot, "data/gear.json"), "utf8"));
const materials = JSON.parse(readFileSync(join(moduleRoot, "data/materials.json"), "utf8"));

function moduleFilePath(iconPath) {
  assert.ok(iconPath.startsWith(modulePrefix), `external fallback: ${iconPath}`);
  return join(moduleRoot, decodeURIComponent(iconPath.slice(modulePrefix.length)));
}

test("every canonical gear and material item resolves to an existing module icon", async () => {
  const originalFilePicker = globalThis.FilePicker;
  globalThis.FilePicker = class MockFilePicker {};
  globalThis.FilePicker.browse = async (_source, directory) => {
    const relativeDirectory = decodeURIComponent(directory).slice(modulePrefix.length);
    const localDirectory = join(moduleRoot, relativeDirectory);
    const entries = readdirSync(localDirectory, { withFileTypes: true });
    const toModulePath = (entry) => `${modulePrefix}${relative(moduleRoot, join(localDirectory, entry.name)).split(sep).join("/")}`;
    return {
      files: entries.filter((entry) => entry.isFile()).map(toModulePath),
      dirs: entries.filter((entry) => entry.isDirectory()).map(toModulePath)
    };
  };

  try {
    const icons = await buildGearIconLookup({ forceRefresh: true });
    assert.equal(gear.length, 808);
    assert.equal(materials.length, 612);
    for (const item of gear) {
      const icon = resolveGearNamedIcon(item, icons) || resolveGearItemIcon(item, { iconLookup: icons });
      assert.ok(existsSync(moduleFilePath(icon)), `gear ${item.id}: ${icon}`);
    }
    for (const material of materials) {
      const icon = resolveNamedIcon(material.name, icons, "");
      assert.ok(existsSync(moduleFilePath(icon)), `material ${material.id}: ${icon}`);
    }
  }
  finally {
    globalThis.FilePicker = originalFilePicker;
  }
});
