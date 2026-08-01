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
    /\.rm-inventory-book__header--inventory::before\s*\{[^}]*animation:\s*rm-inventory-header-camera 37s ease-in-out infinite;/su
  );
  assert.match(
    css,
    /\.rm-inventory-book__header--transport::before\s*\{[^}]*background-image:\s*var\(--rm-transport-header-image\);[^}]*animation:\s*rm-transport-header-camera 41s ease-in-out infinite;/su
  );
  assert.match(
    css,
    /\.rm-inventory-book__header--inventory::before,\s*\.rebreya-inventory-app \.rm-inventory-book__header--transport::before\s*\{[^}]*inset:\s*-2\.5%;/su
  );

  const inventoryOverlay = css.match(/\.rm-inventory-book__header--inventory::after\s*\{([^}]*)\}/su);
  assert.ok(inventoryOverlay, "expected Inventory glare overlay");
  assert.match(inventoryOverlay[1], /radial-gradient/u);
  assert.match(inventoryOverlay[1], /linear-gradient/u);
  assert.match(inventoryOverlay[1], /animation:\s*rm-inventory-header-light 17s ease-in-out infinite;/u);
  assert.doesNotMatch(inventoryOverlay[1], /steam|smoke|ellipse/iu);

  const transportOverlay = [...css.matchAll(/\.rm-inventory-book__header--transport::after\s*\{([^}]*)\}/gsu)]
    .map((match) => match[1])
    .find((block) => block.includes("background:"));
  assert.ok(transportOverlay, "expected Transport steam and glare overlay");
  assert.match(transportOverlay, /radial-gradient/u);
  assert.match(transportOverlay, /linear-gradient/u);
  assert.match(transportOverlay, /animation:\s*rm-transport-header-steam 19s ease-in-out infinite;/u);

  assert.match(css, /@keyframes rm-inventory-header-light/u);
  assert.match(css, /@keyframes rm-transport-header-steam/u);
  const animationNames = [
    "rm-inventory-header-camera",
    "rm-transport-header-camera",
    "rm-inventory-header-light",
    "rm-transport-header-steam"
  ];
  const animationStops = new Map();

  for (const animationName of animationNames) {
    const keyframes = css.match(new RegExp(`@keyframes ${animationName}\\s*\\{([\\s\\S]*?)\\n\\}`, "u"));
    assert.ok(keyframes, `expected ${animationName} keyframes`);
    assert.doesNotMatch(keyframes[1], /\b-?\d+(?:\.\d+)?px\b/u);
    assert.doesNotMatch(keyframes[1], /filter:|background-position:|(?:width|height|inset|top|right|bottom|left):/u);

    const stops = [...keyframes[1].matchAll(/(\d+(?:\.\d+)?)%\s*\{([^}]*)\}/gsu)].map((match) => ({
      offset: Number(match[1]),
      declarations: match[2],
      transform: match[2].match(/transform:\s*([^;]+);/u)?.[1],
      opacity: match[2].match(/opacity:\s*([^;]+);/u)?.[1]
    }));
    animationStops.set(animationName, stops);

    const minimumStops = animationName.includes("camera") ? 7 : 5;
    assert.ok(stops.length >= minimumStops, `${animationName} must have at least ${minimumStops} stops`);
    assert.equal(stops[0].offset, 0, `${animationName} must start at 0%`);
    assert.equal(stops.at(-1).offset, 100, `${animationName} must end at 100%`);
    assert.equal(stops[0].transform, stops.at(-1).transform, `${animationName} transform must close seamlessly`);

    const transforms = stops.map((stop) => {
      assert.ok(stop.transform, `${animationName} ${stop.offset}% must define transform`);
      const transform = stop.transform.match(
        /^translate3d\((-?\d+(?:\.\d+)?)%,\s*(-?\d+(?:\.\d+)?)%,\s*0\)\s+scale\((\d+(?:\.\d+)?)\)$/u
      );
      assert.ok(transform, `${animationName} ${stop.offset}% must use percentage x/y translate3d and scale`);
      return { x: Number(transform[1]), y: Number(transform[2]), scale: Number(transform[3]) };
    });

    const horizontalPositions = transforms.map(({ x }) => x);
    assert.ok(Math.min(...horizontalPositions) >= -2.5, `${animationName} must stay inside left overscan`);
    assert.ok(Math.max(...horizontalPositions) <= 2.5, `${animationName} must stay inside right overscan`);
    assert.ok(
      Math.max(...horizontalPositions) - Math.min(...horizontalPositions) <= 5,
      `${animationName} horizontal travel must not exceed five percentage points`
    );

    if (animationName.includes("camera")) {
      const modifier = animationName.includes("inventory") ? "inventory" : "transport";
      const cameraRule = [...css.matchAll(
        new RegExp(`\\.rm-inventory-book__header--${modifier}::before\\s*\\{([^}]*)\\}`, "gsu")
      )].map((match) => match[1]).find((block) => block.includes("transform-origin:"));
      assert.ok(cameraRule, `expected ${modifier} camera rule`);
      const origin = cameraRule.match(/transform-origin:\s*(\d+(?:\.\d+)?)%\s+(\d+(?:\.\d+)?)%;/u);
      assert.ok(origin, `${animationName} must define percentage transform-origin`);

      const layerStart = -0.025;
      const layerSize = 1.05;
      const originX = layerStart + layerSize * Number(origin[1]) / 100;
      const originY = layerStart + layerSize * Number(origin[2]) / 100;

      for (const [index, transform] of transforms.entries()) {
        const translateX = layerSize * transform.x / 100;
        const translateY = layerSize * transform.y / 100;
        const left = originX + (layerStart - originX) * transform.scale + translateX;
        const right = originX + (layerStart + layerSize - originX) * transform.scale + translateX;
        const top = originY + (layerStart - originY) * transform.scale + translateY;
        const bottom = originY + (layerStart + layerSize - originY) * transform.scale + translateY;
        const offset = stops[index].offset;

        assert.ok(left <= 0, `${animationName} ${offset}% must cover the left edge`);
        assert.ok(right >= 1, `${animationName} ${offset}% must cover the right edge`);
        assert.ok(top <= 0, `${animationName} ${offset}% must cover the top edge`);
        assert.ok(bottom >= 1, `${animationName} ${offset}% must cover the bottom edge`);
      }
    }

    if (!animationName.includes("camera")) {
      for (const stop of stops) {
        assert.match(stop.opacity ?? "", /^(?:0|1|0?\.\d+)$/u, `${animationName} ${stop.offset}% must define opacity`);
      }
      assert.equal(stops[0].opacity, stops.at(-1).opacity, `${animationName} opacity must close seamlessly`);
    }
  }

  for (const animationName of ["rm-inventory-header-camera", "rm-transport-header-camera"]) {
    const scales = animationStops.get(animationName).map((stop) => Number(stop.transform.match(/scale\(([^)]+)\)/u)[1]));
    const scaleDeltas = scales.slice(1).map((scale, index) => scale - scales[index]);
    assert.ok(scaleDeltas.some((delta) => delta > 0), `${animationName} must include a zoom-in`);
    assert.ok(scaleDeltas.some((delta) => delta < 0), `${animationName} must include a pull-back`);
  }

  assert.notDeepEqual(
    animationStops.get("rm-inventory-header-camera").map((stop) => stop.transform),
    animationStops.get("rm-transport-header-camera").map((stop) => stop.transform),
    "Inventory and Transport must use distinct camera flights"
  );

  assert.match(
    css,
    /@media \(prefers-reduced-motion:\s*reduce\)\s*\{[\s\S]*?\.rm-inventory-book__header--inventory::before,[\s\S]*?\.rm-inventory-book__header--transport::after\s*\{[^}]*animation:\s*none;[^}]*will-change:\s*auto;/u
  );
});
