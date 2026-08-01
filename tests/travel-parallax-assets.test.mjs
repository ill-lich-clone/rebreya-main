import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";

const NAMES = [
  "mountain-sky.webp",
  "mountain-far-mountains.webp",
  "mountain-middle-ridges.webp",
  "mountain-valley.webp",
  "mountain-foreground.webp"
];

test("travel parallax ships five distinct nonempty WebP layers", async () => {
  const layers = await Promise.all(NAMES.map(async (name) => {
    const url = new URL(`../assets/ui/travel-parallax/${name}`, import.meta.url);
    const [metadata, bytes] = await Promise.all([stat(url), readFile(url)]);
    assert.ok(metadata.size > 32_768, `${name} must contain production artwork`);
    assert.equal(bytes.subarray(0, 4).toString("ascii"), "RIFF");
    assert.equal(bytes.subarray(8, 12).toString("ascii"), "WEBP");
    return createHash("sha256").update(bytes).digest("hex");
  }));

  assert.equal(new Set(layers).size, NAMES.length);
});

test("moving travel parallax layers preserve lossless tile edges", async () => {
  for (const name of NAMES.slice(1)) {
    const bytes = await readFile(
      new URL(`../assets/ui/travel-parallax/${name}`, import.meta.url)
    );
    assert.equal(
      bytes.includes(Buffer.from("VP8L", "ascii")),
      true,
      `${name} must use lossless WebP encoding`
    );
  }
});

test("obsolete travel videos and posters are removed", async () => {
  const obsoleteFiles = [
    "../assets/ui/rebreya-travel-city-poster.webp",
    "../assets/ui/rebreya-travel-city.webm",
    "../assets/ui/rebreya-travel-industrial-poster.webp",
    "../assets/ui/rebreya-travel-industrial.webm",
    "../assets/ui/rebreya-travel-wilderness-poster.webp",
    "../assets/ui/rebreya-travel-wilderness.webm",
    "../tools/render_travel_landscapes.py"
  ];

  for (const relativePath of obsoleteFiles) {
    await assert.rejects(
      stat(new URL(relativePath, import.meta.url)),
      { code: "ENOENT" },
      `${relativePath} must not ship with the layered parallax`
    );
  }
});
