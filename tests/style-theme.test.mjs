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
});
