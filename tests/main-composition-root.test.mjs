import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

async function readCanonicalEntrypointSource() {
  return readFile(new URL("../scripts/main.js", import.meta.url), "utf8");
}

test("map object token service is composed with Foundry providers", async () => {
  const source = await readCanonicalEntrypointSource();

  assert.match(source, /import \{ MapObjectTokenService \} from "\.\/data\/map-object-token-service\.js\?v=1\.4\.97-map-object-token";/u);
  assert.match(source, /this\.mapObjectTokenService = new MapObjectTokenService\(\{\s+gameProvider: \(\) => globalThis\.game,\s+actorProvider: \(\) => globalThis\.Actor,\s+macroProvider: \(\) => globalThis\.Macro,\s+isActiveGmClient\s+\}\);/u);
});

test("initialization delegates managed map object synchronization to the active-GM-gated service", async () => {
  const source = await readCanonicalEntrypointSource();

  assert.match(source, /try \{\s+await this\.mapObjectTokenService\.syncManagedDocuments\(\);\s+\}\s+catch \(error\) \{\s+console\.warn\(`\$\{MODULE_ID\} \| Failed to sync managed map object documents\.`, error\);\s+\}/u);
});

test("public map object token API delegates to the macro runner with overridable defaults", async () => {
  const source = await readCanonicalEntrypointSource();

  assert.match(source, /import \{ runMapObjectTokenMacro \} from "\.\/integrations\/map-object-token-macro\.js\?v=1\.4\.97-map-object-token";/u);
  assert.match(source, /\n  createMapObjectToken\(options = \{\}\) \{\s+return runMapObjectTokenMacro\(\{\s+service: this\.mapObjectTokenService,\s+\.\.\.options\s+\}\);\s+\}/u);
});
