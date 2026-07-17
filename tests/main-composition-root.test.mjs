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

test("global reaction services are composed before combat providers", async () => {
  const source = await readCanonicalEntrypointSource();

  assert.match(source, /import \{ ReactionCapabilityIndex \} from "\.\/combat\/reaction-capability-index\.js";/u);
  assert.match(source, /import \{ ReactionQueueService \} from "\.\/combat\/reaction-queue-service\.js";/u);
  const indexPosition = source.indexOf("this.reactionCapabilityIndex = new ReactionCapabilityIndex()");
  const queuePosition = source.indexOf("this.reactionQueueService = new ReactionQueueService(this");
  const attackPosition = source.indexOf("this.combatAttackService = new CombatAttackService(this)");
  assert.ok(indexPosition >= 0);
  assert.ok(queuePosition > indexPosition);
  assert.ok(attackPosition > queuePosition);
  assert.match(source, /await this\.reactionQueueService\.initialize\(\);/u);
  assert.match(source, /this\.reactionCapabilityIndex\.rebuildScene\(globalThis\.canvas\?\.scene\);/u);
});

test("Rune Knight automation is composed on the shared reaction foundation", async () => {
  const source = await readCanonicalEntrypointSource();

  assert.match(source, /import \{ RuneKnightAutomationService \} from "\.\/combat\/rune-knight-automation-service\.js";/u);
  const queuePosition = source.indexOf("this.reactionQueueService = new ReactionQueueService(this");
  const runePosition = source.indexOf("this.runeKnightAutomationService = new RuneKnightAutomationService(this)");
  assert.ok(queuePosition >= 0);
  assert.ok(runePosition > queuePosition);
  assert.match(source, /await this\.runeKnightAutomationService\.initialize\(\);/u);
});

test("global reactions own socket routing and public trigger registration", async () => {
  const source = await readCanonicalEntrypointSource();

  const reactionSocketPosition = source.indexOf("this.reactionQueueService.handleSocketMessage(message, senderId)");
  const spellSocketPosition = source.indexOf("this.spellAutomationService.handleSocketMessage(message, senderId)");
  assert.ok(reactionSocketPosition >= 0);
  assert.equal(spellSocketPosition, -1);
  assert.match(source, /resolveReactionTrigger\(request = \{\}\) \{\s+return this\.reactionQueueService\.resolve\(request\);\s+\}/u);
  assert.match(source, /registerReactionType\(kind, provider\) \{\s+return this\.reactionQueueService\.registerType\(kind, provider\);\s+\}/u);
  assert.match(source, /registerReactionCapability\(kind, resolver, options = \{\}\) \{\s+return this\.reactionCapabilityIndex\.registerProvider\(kind, resolver, options\);\s+\}/u);
});
