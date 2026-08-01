import test from "node:test";
import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";

function readWebpDimensions(bytes) {
  assert.equal(bytes.toString("ascii", 0, 4), "RIFF");
  assert.equal(bytes.toString("ascii", 8, 12), "WEBP");

  for (let offset = 12; offset + 8 <= bytes.length;) {
    const chunkType = bytes.toString("ascii", offset, offset + 4);
    const chunkSize = bytes.readUInt32LE(offset + 4);
    const payloadOffset = offset + 8;

    if (chunkType === "VP8 ") {
      assert.equal(bytes[payloadOffset + 3], 0x9d);
      assert.equal(bytes[payloadOffset + 4], 0x01);
      assert.equal(bytes[payloadOffset + 5], 0x2a);
      return {
        width: bytes.readUInt16LE(payloadOffset + 6) & 0x3fff,
        height: bytes.readUInt16LE(payloadOffset + 8) & 0x3fff
      };
    }

    if (chunkType === "VP8X") {
      return {
        width: 1 + bytes.readUIntLE(payloadOffset + 4, 3),
        height: 1 + bytes.readUIntLE(payloadOffset + 7, 3)
      };
    }

    offset = payloadOffset + chunkSize + (chunkSize % 2);
  }

  throw new Error("Unsupported WebP file without VP8 or VP8X dimensions");
}

test("Transport header ships one production 1920x700 WebP", async () => {
  const assetUrl = new URL("../assets/ui/rebreya-transport-steam-depot.webp", import.meta.url);
  const [metadata, bytes] = await Promise.all([stat(assetUrl), readFile(assetUrl)]);

  assert.ok(metadata.size > 100_000, "transport header must contain production artwork");
  assert.deepEqual(readWebpDimensions(bytes), { width: 1920, height: 700 });
});

test("Inventory and Transport headers use slow compositor-friendly CSS motion", async () => {
  const css = await readFile(new URL("../styles/main.css", import.meta.url), "utf8");

  assert.match(
    css,
    /--rm-transport-header-image:\s*url\("\.\.\/assets\/ui\/rebreya-transport-steam-depot\.webp"\);/u
  );
  assert.match(
    css,
    /\.rm-inventory-book__header--inventory::before\s*\{[^}]*animation:\s*rm-inventory-header-camera 22s ease-in-out infinite alternate;/su
  );
  assert.match(
    css,
    /\.rm-inventory-book__header--transport::before\s*\{[^}]*background-image:\s*var\(--rm-transport-header-image\);[^}]*animation:\s*rm-transport-header-camera 24s ease-in-out infinite alternate;/su
  );
  assert.match(
    css,
    /\.rm-inventory-book__header--inventory::before,\s*\.rebreya-inventory-app \.rm-inventory-book__header--transport::before\s*\{[^}]*inset:\s*-2\.5%;/su
  );

  const inventoryOverlay = css.match(/\.rm-inventory-book__header--inventory::after\s*\{([^}]*)\}/su);
  assert.ok(inventoryOverlay, "expected Inventory glare overlay");
  assert.match(inventoryOverlay[1], /radial-gradient/u);
  assert.match(inventoryOverlay[1], /linear-gradient/u);
  assert.match(inventoryOverlay[1], /animation:\s*rm-inventory-header-light 10s ease-in-out infinite alternate;/u);
  assert.doesNotMatch(inventoryOverlay[1], /steam|smoke|ellipse/iu);

  const transportOverlay = [...css.matchAll(/\.rm-inventory-book__header--transport::after\s*\{([^}]*)\}/gsu)]
    .map((match) => match[1])
    .find((block) => block.includes("background:"));
  assert.ok(transportOverlay, "expected Transport steam and glare overlay");
  assert.match(transportOverlay, /radial-gradient/u);
  assert.match(transportOverlay, /linear-gradient/u);
  assert.match(transportOverlay, /animation:\s*rm-transport-header-steam 12s ease-in-out infinite alternate;/u);

  assert.match(css, /@keyframes rm-inventory-header-light/u);
  assert.match(css, /@keyframes rm-transport-header-steam/u);
  assert.match(
    css,
    /@keyframes rm-inventory-header-camera\s*\{[\s\S]*?translate3d\(-2\.5%, 1%, 0\) scale\(1\.04\);[\s\S]*?translate3d\(2\.5%, -1\.5%, 0\) scale\(1\.12\);[\s\S]*?\n\}/u
  );
  assert.match(
    css,
    /@keyframes rm-transport-header-camera\s*\{[\s\S]*?translate3d\(-3%, 0\.8%, 0\) scale\(1\.03\);[\s\S]*?translate3d\(2%, -1\.2%, 0\) scale\(1\.11\);[\s\S]*?\n\}/u
  );

  for (const animationName of [
    "rm-inventory-header-camera",
    "rm-transport-header-camera",
    "rm-inventory-header-light",
    "rm-transport-header-steam"
  ]) {
    const keyframes = css.match(new RegExp(`@keyframes ${animationName}\\s*\\{([\\s\\S]*?)\\n\\}`, "u"));
    assert.ok(keyframes, `expected ${animationName} keyframes`);
    assert.doesNotMatch(keyframes[1], /\b-?\d+(?:\.\d+)?px\b/u);
    assert.doesNotMatch(keyframes[1], /filter:|background-position:|(?:width|height|inset|top|right|bottom|left):/u);
  }

  assert.match(
    css,
    /@media \(prefers-reduced-motion:\s*reduce\)\s*\{[\s\S]*?\.rm-inventory-book__header--inventory::before,[\s\S]*?\.rm-inventory-book__header--transport::after\s*\{[^}]*animation:\s*none;[^}]*will-change:\s*auto;/u
  );
});
