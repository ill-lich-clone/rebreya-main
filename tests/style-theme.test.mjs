import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const stylesheetUrl = new URL("../styles/main.css", import.meta.url);

test("Rebreya windows use an inherited dnd5e-inspired gray and gold theme", async () => {
  const css = await readFile(stylesheetUrl, "utf8");

  for (const token of [
    "--rm-color-ink",
    "--rm-color-dark",
    "--rm-color-surface",
    "--rm-color-surface-raised",
    "--rm-color-surface-hover",
    "--rm-color-gold",
    "--rm-color-gold-bright",
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
    "--rm-text-dim"
  ]) {
    assert.match(css, new RegExp(`${token}:`, "u"), `Missing theme token ${token}`);
    assert.doesNotMatch(
      css,
      new RegExp(`${token}:\\s*var\\(${token}\\)`, "u"),
      `Theme token ${token} must not reference itself`
    );
  }

  assert.match(css, /--rm-surface-window:[^;]*url\(["']?\/ui\/denim075\.png["']?\)/u);
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
    assert.equal(css.includes(legacyColor), false, `Legacy theme color remains: ${legacyColor}`);
  }
});
