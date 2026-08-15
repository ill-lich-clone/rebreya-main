import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const stylesheetUrl = new URL("../styles/main.css", import.meta.url);

function withoutStandaloneTraderRules(css) {
  const characters = [...css];
  let cursor = 0;

  while (cursor < css.length) {
    const open = css.indexOf("{", cursor);
    if (open < 0) break;

    const boundary = Math.max(
      css.lastIndexOf("}", open - 1),
      css.lastIndexOf("{", open - 1),
      css.lastIndexOf(";", open - 1)
    );
    const selector = css.slice(boundary + 1, open);
    let close = open + 1;
    let depth = 1;

    while (close < css.length && depth > 0) {
      if (css[close] === "{") depth += 1;
      if (css[close] === "}") depth -= 1;
      close += 1;
    }

    if (/\.(?:rm-trader-v2|rebreya-trader-app-v2)\b/u.test(selector)) {
      characters.fill(" ", boundary + 1, close);
    }
    cursor = close;
  }

  return characters.join("");
}

test("Rebreya windows use the inherited graphite and brass redesign", async () => {
  const css = await readFile(stylesheetUrl, "utf8");
  const sharedThemeCss = withoutStandaloneTraderRules(css);

  for (const token of [
    "--rm-color-ink",
    "--rm-color-dark",
    "--rm-color-surface",
    "--rm-color-surface-raised",
    "--rm-color-surface-hover",
    "--rm-color-gold",
    "--rm-color-gold-bright",
    "--rm-surface-0",
    "--rm-surface-1",
    "--rm-surface-2",
    "--rm-surface-window",
    "--rm-surface-panel",
    "--rm-surface-panel-strong",
    "--rm-surface-row",
    "--rm-surface-input",
    "--rm-surface-subtle",
    "--rm-border-subtle",
    "--rm-border-default",
    "--rm-border-strong",
    "--rm-text-primary",
    "--rm-text-secondary",
    "--rm-text-dim",
    "--rm-hairline",
    "--rm-accent-strong"
  ]) {
    assert.match(css, new RegExp(`${token}:`, "u"), `Missing theme token ${token}`);
    assert.doesNotMatch(
      css,
      new RegExp(`${token}:\\s*var\\(${token}\\)`, "u"),
      `Theme token ${token} must not reference itself`
    );
  }

  assert.match(css, /--rm-color-ink:\s*#0f1116;/u);
  assert.match(css, /--rm-color-surface:\s*#1c2026;/u);
  assert.match(css, /--rm-color-surface-raised:\s*#242a32;/u);
  assert.match(css, /--rm-color-gold:\s*#e0b25e;/u);
  assert.match(css, /--rm-color-gold-bright:\s*#f1c477;/u);
  assert.match(css, /--rm-surface-window:[\s\S]*linear-gradient\(180deg, #181b20 0%, #121419 100%\);/u);
  assert.doesNotMatch(css, /--rm-surface-window:[^;]*denim075\.png/u);
  assert.match(css, /--rm-bg:\s*var\(--rm-surface-window\)/u);
  assert.match(css, /--rm-panel:\s*var\(--rm-surface-panel\)/u);
  assert.match(css, /--rm-panel-strong:\s*var\(--rm-surface-panel-strong\)/u);
  assert.match(css, /--rm-border:\s*var\(--rm-border-default\)/u);
  assert.match(css, /--rm-text:\s*var\(--rm-text-primary\)/u);
  assert.match(css, /--rm-muted:\s*var\(--rm-text-secondary\)/u);

  const semanticSurfaceUses = css.match(/var\(--rm-surface-(?:window|panel|panel-strong|row|row-hover|input|overlay|subtle)\)/gu) ?? [];
  const semanticBorderUses = css.match(/var\(--rm-border-(?:subtle|default|strong)\)/gu) ?? [];
  assert.ok(semanticSurfaceUses.length >= 20, "Component surfaces should consume shared theme tokens");
  assert.ok(semanticBorderUses.length >= 20, "Component borders should consume shared theme tokens");

  const directTokenCycles = [...css.matchAll(/^\s*(--[\w-]+):\s*var\(\1\)/gmu)];
  assert.deepEqual(
    directTokenCycles.map((match) => match[1]),
    [],
    "Custom properties must not directly reference themselves"
  );
  assert.doesNotMatch(
    css,
    /^\s*color:\s*var\(--rm-color-(?:surface|surface-raised|surface-hover)\)/gmu,
    "Dark surface tokens must not be used as foreground text colors"
  );

  for (const legacyColor of [
    "#4b2d1b",
    "#3d2516",
    "#352115",
    "#4f301e",
    "#5b3a23",
    "#6a4328",
    "#45c6b3",
    "rgba(48, 27, 16",
    "rgba(43, 160, 148",
    "rgba(69, 198, 179",
    "rgba(240, 128, 51"
  ]) {
    assert.equal(sharedThemeCss.includes(legacyColor), false, `Legacy theme color remains outside trader v2: ${legacyColor}`);
  }
});

test("Shared components consume the graphite and brass redesign primitives", async () => {
  const css = await readFile(stylesheetUrl, "utf8");

  assert.match(css, /\.rm-app-header\s*\{[^}]*border-top:\s*2px solid var\(--rm-accent\);[^}]*background:\s*linear-gradient\(180deg, var\(--rm-surface-2\), var\(--rm-surface-1\)\);/su);
  assert.match(css, /\.rm-button--primary\s*\{[^}]*background:\s*linear-gradient\(180deg, var\(--rm-accent-strong\), var\(--rm-accent\)\);[^}]*color:\s*#241a08;/su);
  assert.match(css, /\.rm-stat-card\s*\{[^}]*border-left:\s*3px solid var\(--rm-accent\);/su);
  assert.match(css, /\.rm-panel__header\s*\{[^}]*border-bottom:\s*1px solid var\(--rm-hairline\);/su);
  assert.match(css, /\.rm-field input,\s*\.rm-field select\s*\{[^}]*background:\s*var\(--rm-surface-0\);/su);
  assert.match(css, /\.rm-field input:focus,\s*\.rm-field select:focus,\s*\.rm-textarea:focus\s*\{[^}]*box-shadow:\s*0 0 0 3px rgba\(224, 178, 94, 0\.18\);/su);
});

test("item upgrade controls match the dark character sheet style", async () => {
  const css = await readFile(stylesheetUrl, "utf8");
  const itemUpgradeBlock = css.match(/\.rm-item-upgrades\s*\{(?<body>[^}]*)\}/su)?.groups?.body ?? "";

  assert.match(itemUpgradeBlock, /background:\s*linear-gradient\(180deg,\s*rgb\(var\(--rm-color-surface-raised-rgb\) \/ 0\.92\),\s*rgb\(var\(--rm-color-surface-rgb\) \/ 0\.96\)\);/su);
  assert.match(itemUpgradeBlock, /border:\s*1px solid var\(--rm-border-strong\);/su);
  assert.match(itemUpgradeBlock, /color:\s*var\(--rm-text-primary\);/su);
  assert.doesNotMatch(itemUpgradeBlock, /245 241 232|255 252 245|255 255 255 \/ 0\.58/u);

  const itemUpgradeInventoryBlock = css.match(
    /\.dnd5e2\.sheet\.actor \[data-item-id\]\.has-rebreya-installed-upgrades,\s*\.dnd5e\.sheet\.actor \[data-item-id\]\.has-rebreya-installed-upgrades\s*\{(?<body>[^}]*)\}/su
  )?.groups?.body ?? "";
  const itemUpgradeInventoryBadgeBlock = css.match(
    /\.dnd5e2\.sheet\.actor \[data-item-id\]\.has-rebreya-installed-upgrades::after,\s*\.dnd5e\.sheet\.actor \[data-item-id\]\.has-rebreya-installed-upgrades::after\s*\{(?<body>[^}]*)\}/su
  )?.groups?.body ?? "";

  assert.match(itemUpgradeInventoryBlock, /position:\s*relative;/u);
  assert.match(itemUpgradeInventoryBlock, /inset 3px 0 0 rgb\(var\(--rm-color-gold-rgb\) \/ 0\.78\)/u);
  assert.doesNotMatch(itemUpgradeInventoryBlock, /inset 0 0 0 1px/u);
  assert.match(itemUpgradeInventoryBadgeBlock, /content:\s*attr\(data-rebreya-item-upgrades-slots-short\);/u);
  assert.match(itemUpgradeInventoryBadgeBlock, /position:\s*absolute;/u);
  assert.match(itemUpgradeInventoryBadgeBlock, /border-radius:\s*4px;/u);
  assert.match(itemUpgradeInventoryBadgeBlock, /background:\s*rgb\(38 31 18 \/ 0\.92\);/u);
  assert.match(css, /\.dnd5e2\.sheet\.actor \[data-item-id\]\.is-rebreya-upgrade-installing/u);
  assert.match(css, /@keyframes rmItemUpgradeInstallPulse/u);
});

test("Trader v2 keeps its standalone parchment theme", async () => {
  const css = await readFile(stylesheetUrl, "utf8");

  assert.match(css, /\.rm-trader-v2-shell\s*\{[^}]*--rm-trader-v2-paper:\s*#f3e6c4;/su);
  assert.match(css, /\.rm-trader-v2-shell\s*\{[^}]*--rm-trader-v2-wine:\s*#7d1f2d;/su);
  assert.match(css, /\.rm-trader-v2-shell\s*\{[^}]*color-scheme:\s*light;/su);
  assert.match(css, /\.rebreya-trader-app-v2 \.rm-trader-v2-shell\s*\{[^}]*shop\.webp/su);
  assert.match(css, /\.rebreya-trader-app-v2 \.rm-trader-v2-texture\s*\{[^}]*opacity:\s*1;/su);
});

test("Status duration dialog wraps long action labels without spilling outside the window", async () => {
  const css = await readFile(stylesheetUrl, "utf8");

  assert.match(css, /\.rm-status-duration-dialog \.dialog-buttons\s*\{[^}]*flex-wrap:\s*wrap;[^}]*justify-content:\s*flex-start;[^}]*align-items:\s*stretch;/su);
  assert.match(css, /\.rm-status-duration-dialog \.dialog-buttons \.dialog-button,\s*\.rm-status-duration-dialog \.dialog-buttons button\s*\{[^}]*flex:\s*1 1 180px !important;[^}]*white-space:\s*normal;[^}]*text-wrap:\s*balance;/su);
});

test("Character sheet valued combat statuses use compact numeric inputs instead of toggle switches", async () => {
  const css = await readFile(stylesheetUrl, "utf8");

  assert.match(css, /\.dnd5e2 \.effects-element \.conditions-list \.condition\.rm-sheet-status--valued\s*\{[^}]*justify-content:\s*space-between;/su);
  assert.match(css, /\.rm-sheet-status-value-input\s*\{[^}]*width:\s*3\.5rem;[^}]*text-align:\s*center;[^}]*background:\s*var\(--rm-surface-input\);/su);
  assert.match(css, /\.dnd5e2 \.effects-element \.conditions-list \.condition \.name-stacked\s*\{[^}]*min-width:\s*0;/su);
  assert.match(css, /\.dnd5e2 \.effects-element \.conditions-list \.condition \.name-stacked \.title\s*\{[^}]*hyphens:\s*auto;[^}]*word-break:\s*normal;[^}]*overflow-wrap:\s*break-word;[^}]*text-wrap:\s*pretty;/su);
  assert.match(css, /\.dnd5e2 \.effects-element \.conditions-list \.condition \.name-stacked \.title\.rm-sheet-status-title--compact\s*\{[^}]*font-size:\s*var\(--font-size-12,\s*12px\);/su);
});

test("Calendar downtime statuses keep every compact marker visible in a narrow resizable window", async () => {
  const css = await readFile(stylesheetUrl, "utf8");

  assert.match(css, /\.rm-calendar-grid__day\s*\{[^}]*position:\s*relative;[^}]*box-sizing:\s*border-box;[^}]*overflow:\s*hidden;/su);
  assert.match(css, /\.rm-calendar-grid__total\s*\{[^}]*position:\s*absolute;[^}]*min-width:\s*16px;[^}]*height:\s*16px;/su);
  assert.match(css, /\.rm-calendar-grid\s*\{[^}]*grid-template-columns:\s*repeat\(7,\s*minmax\(60px,\s*1fr\)\);[^}]*overflow-x:\s*auto;/su);
  assert.match(css, /\.rm-calendar-grid__markers\s*\{[^}]*position:\s*absolute;[^}]*display:\s*grid;[^}]*grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\);[^}]*grid-auto-rows:\s*14px;[^}]*max-height:\s*46px;/su);
  assert.match(css, /\.rm-calendar-grid__marker\s*\{[^}]*min-width:\s*0;[^}]*height:\s*14px;[^}]*white-space:\s*nowrap;/su);
  assert.match(css, /\.rm-calendar-grid__day\s*\{[^}]*min-height:\s*76px;[^}]*padding:\s*6px 20px 50px 6px;/su);
  assert.match(css, /\.rm-calendar-grid__marker\s*\{[^}]*font-size:\s*8px;[^}]*overflow:\s*hidden;/su);
  assert.match(css, /\.rm-calendar-grid__day\.is-current\s*\{[^}]*border-color:\s*var\(--rm-border-strong\);[^}]*box-shadow:\s*inset 0 0 0 1px var\(--rm-accent\);/su);

  for (const status of ["free", "pending", "approved", "processed", "blocked"]) {
    assert.match(css, new RegExp(`\\.rm-calendar-grid__day\\.is-downtime-${status}\\s*\\{`, "u"));
    assert.match(css, new RegExp(`\\.rm-calendar-grid__marker\\.is-${status}\\s*\\{`, "u"));
  }

  assert.match(css, /\.rm-calendar-day-dialog\s*\{[^}]*display:\s*grid;/su);
  assert.match(css, /\.rm-calendar-day-entry\s*\{[^}]*border-left:\s*3px solid/u);
  assert.match(css, /\.rm-calendar-grid__day\s*\{\s*min-height:\s*76px;\s*font-size:\s*12px;/su);
  assert.doesNotMatch(css, /\.rm-calendar-grid__day\s*\{[^}]*min-height:\s*28px;/su);
});

test("Craft toolbar no longer reserves space for the removed process-day control", async () => {
  const css = await readFile(stylesheetUrl, "utf8");

  assert.match(css, /\.rm-craft-toolbar\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1\.5fr\) minmax\(200px, 0\.7fr\);/su);
  assert.doesNotMatch(css, /\.rm-craft-toolbar__actions/u);
});

test("Lootgen exposes broken equipment as a visible condition without renaming entries", async () => {
  const [css, template, chat] = await Promise.all([
    readFile(stylesheetUrl, "utf8"),
    readFile(new URL("../templates/lootgen-app.hbs", import.meta.url), "utf8"),
    readFile(new URL("../scripts/ui/lootgen-chat.js", import.meta.url), "utf8")
  ]);

  assert.match(template, /data-field="brokenEquipmentChance"/u);
  assert.match(template, /rm-lootgen-condition--broken[\s\S]*Сломано/u);
  assert.match(chat, /rm-chat-loot__condition--broken[\s\S]*Сломано/u);
  assert.match(css, /\.rm-lootgen-condition--broken\s*\{[^}]*color:\s*var\(--rm-warning\);/su);
  assert.match(css, /\.rm-chat-loot__row-main \.rm-chat-loot__condition--broken\s*\{[^}]*color:\s*var\(--rm-warning\) !important;/su);
  assert.doesNotMatch(template, /\{\{name\}\}\s*\(сломано\)/iu);
});

test("public city styles stay scoped to the canonical City app", async () => {
  const css = await readFile(stylesheetUrl, "utf8");

  for (const selector of [
    "rm-public-city-shell",
    "rm-public-city-hero",
    "rm-public-city-tabs",
    "rm-public-city-market",
    "rm-public-city-traders"
  ]) {
    assert.match(css, new RegExp(`\\.rebreya-city-app \\.${selector}`, "u"), selector);
  }
  const publicSelectorLines = css.split(/\r?\n/u).filter((line) => line.includes(".rm-public-city-"));
  assert.ok(publicSelectorLines.length > 0);
  assert.equal(publicSelectorLines.every((line) => line.trim().startsWith(".rebreya-city-app ")), true);
});
