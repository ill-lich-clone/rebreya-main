import test from "node:test";
import assert from "node:assert/strict";
import { normalizeSheetArt, sheetArtGeometry, sheetArtPreview, saveSheetArt } from "../scripts/data/character-sheet-art.js";
import { createSheetArtSvg } from "../scripts/ui/character-sheet-art.js";

test("invalid artwork cannot inject URLs or unbounded mask geometry", () => {
  for (const src of ["javascript:alert(1)", "data:text/html,x", "//evil.test/a.png"]) {
    assert.equal(normalizeSheetArt({ src, enabled: true }).enabled, false);
  }
  const art = normalizeSheetArt({ src: "assets/dragon.png", enabled: true, scale: Infinity,
    x: -999, strokes: [{ radius: 99, points: [[0.5, 0.4], [NaN, 2]] }] });
  assert.equal(art.scale, 1);
  assert.equal(art.x, -1);
  assert.equal(art.strokes[0].radius, 0.25);
  assert.deepEqual(art.strokes[0].points, [[0.5, 0.4]]);
});

test("image is centered with preserved aspect, mask coordinates follow resizing", () => {
  const art = normalizeSheetArt({ src: "assets/dragon.png", scale: 1.2, x: 0.1, y: -0.1, aspect: 2, frameAspect: 1.25 });
  assert.deepEqual(sheetArtGeometry(art, 1000, 800), { x: 0, y: 20, width: 1200, height: 600 });
  assert.deepEqual(sheetArtGeometry(art, 500, 400), { x: 0, y: 10, width: 600, height: 300 });
  assert.deepEqual(sheetArtGeometry(art, 1000, 1000), { x: 0, y: 25, width: 1500, height: 750 });
});

test("horizontal sheet resizing keeps artwork size and left-anchored position", () => {
  const art = normalizeSheetArt({ src: "assets/dragon.png", scale: 1.2, aspect: 2, frameAspect: 1.25 });
  const narrow = sheetArtGeometry(art, 800, 800);
  const wide = sheetArtGeometry(art, 1400, 800);

  assert.deepEqual(narrow, { x: -100, y: 100, width: 1200, height: 600 });
  assert.deepEqual(wide, { x: -100, y: 100, width: 1200, height: 600 });
  assert.equal(narrow.width / narrow.height, 2);
  assert.equal(wide.width / wide.height, 2);
});

test("preview zoom and pan map to sheet coordinates without changing artwork", () => {
  assert.deepEqual(sheetArtPreview(800, 600, { zoom: 2, panX: 100, panY: -50 }),
    { x: 200, y: 25, width: 600, height: 450 });
});
test("saving requires current ownership and writes only the module art flag", async () => {
  const writes = [];
  const actor = { type: "character", isOwner: false, setFlag: async (...args) => writes.push(args) };
  await assert.rejects(saveSheetArt(actor, { src: "assets/a.png" }), /владелец/);
  assert.equal(writes.length, 0);
  actor.isOwner = true;
  await saveSheetArt(actor, { src: "assets/a.png", enabled: true, malicious: "discard" });
  assert.equal(writes.length, 1);
  assert.deepEqual(writes[0].slice(0, 2), ["rebreya-main", "sheetArt"]);
  assert.equal(writes[0][2].malicious, undefined);
  assert.equal(writes[0][2].version, 1);
});

test("normalization detaches saved strokes from the editable draft and bounds payload", () => {
  const input = { src: "assets/a.png", strokes: [{ radius: 0.05, points: [[0.1, 0.2]] }] };
  const art = normalizeSheetArt(input);
  art.strokes[0].points[0][0] = 0.8;
  assert.equal(input.strokes[0].points[0][0], 0.1);
  assert.equal(normalizeSheetArt({ strokes: Array(201).fill(input.strokes[0]) }).strokes.length, 200);
});

test("rendered image exposes exterior freely and paints only the interior", () => {
  const original = globalThis.document;
  // Only the SVG DOM boundary is substituted; geometry and renderer are production code.
  globalThis.document = { createElementNS(_ns, tag) {
    return { tag, attributes: {}, children: [],
      setAttribute(key, value) { this.attributes[key] = value; },
      append(...children) { this.children.push(...children); } };
  } };
  try {
    const art = normalizeSheetArt({ src: "assets/dragon.png", enabled: true, aspect: 2, frameAspect: 1, strokes: [
      { radius: 0.1, points: [[0.2, 0.3]] },
      { erase: true, radius: 0.04, points: [[0.2, 0.3], [0.4, 0.3]] }
    ] });
    const svg = createSheetArtSvg(art, 800, 700);
    const defs = svg.children.find(node => node.tag === "defs");
    const clip = defs.children.find(node => node.tag === "clipPath");
    assert.equal(clip, undefined);
    const mask = defs.children.find(node => node.tag === "mask");
    assert.equal(mask.children[0].attributes.fill, "white");
    assert.equal(mask.children[0].attributes.transform, "translate(0 175) scale(700 700)");
    assert.equal(mask.children[0].attributes.cy, "0.15");
    assert.equal(mask.children[1].attributes.stroke, "black");
    assert.equal(mask.children.at(-1).attributes["fill-rule"], "evenodd");
    const image = svg.children.find(node => node.tag === "image");
    assert.equal(image.attributes.mask, `url(#${mask.attributes.id})`);
    assert.equal(image.attributes.href, "assets/dragon.png");
  } finally { globalThis.document = original; }
});
