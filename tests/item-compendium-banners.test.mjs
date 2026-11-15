import test from "node:test";
import assert from "node:assert/strict";
import { access } from "node:fs/promises";
import { applyItemCompendiumBanners, ITEM_COMPENDIUM_BANNERS } from "../scripts/data/item-compendium-banners.js";

test("defaults decorate both item packs with distinct shipped assets and rerender an open sidebar once", async () => {
  const gear = { metadata: { type: "Item", flags: { custom: true } }, locked: true };
  const magic = { metadata: { type: "Item" } };
  const other = { metadata: { type: "Item" } };
  const packs = new Map([["world.rebreya-gear", gear], ["world.rebreya-magic-items", magic], ["world.other", other]]);
  let renders = 0;
  const sidebar = { rendered: true, render() { renders++; } };

  applyItemCompendiumBanners(packs, sidebar);
  applyItemCompendiumBanners(packs, sidebar);

  assert.notEqual(gear.metadata.banner, magic.metadata.banner);
  for (const [id, banner] of Object.entries(ITEM_COMPENDIUM_BANNERS)) {
    assert.equal(packs.get(id).metadata.banner, banner);
    assert.match(banner, /^modules\/rebreya-main\/assets\//u);
    await access(new URL(`../${banner.slice("modules/rebreya-main/".length)}`, import.meta.url));
  }
  assert.deepEqual(gear.metadata.flags, { custom: true });
  assert.equal(gear.locked, true);
  assert.equal(other.metadata.banner, undefined);
  assert.equal(renders, 1);
});

test("existing overrides including an intentionally hidden banner take precedence", () => {
  const custom = { metadata: { type: "Item", banner: "worlds/custom.png" } };
  const hidden = { metadata: { type: "Item", banner: null } };
  const sidebar = { rendered: true, render() { assert.fail("Unchanged settings should not redraw the sidebar"); } };
  applyItemCompendiumBanners(new Map([["world.rebreya-gear", custom], ["world.rebreya-magic-items", hidden]]), sidebar);
  assert.equal(custom.metadata.banner, "worlds/custom.png");
  assert.equal(hidden.metadata.banner, null);
});

test("a missing pack or a different pack type can be left alone", () => {
  const scene = { metadata: { type: "Scene" } };
  applyItemCompendiumBanners(new Map([["world.rebreya-gear", scene]]), null);
  assert.equal(scene.metadata.banner, undefined);
});
