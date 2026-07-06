import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("heroic d20 configureModifiers patch prefers libWrapper over direct replacement", async () => {
  const source = await readFile(new URL("../scripts/integrations/dnd5e-sheet-extensions.js", import.meta.url), "utf8");

  assert.match(
    source,
    /libWrapper\.register\(\s*MODULE_ID,\s*"CONFIG\.Dice\.D20Roll\.prototype\.configureModifiers"/u
  );
});
