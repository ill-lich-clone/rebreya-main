import test from "node:test";
import assert from "node:assert/strict";

import {
  cleanText,
  cloneFoundryValue,
  collectionValues,
  escapeFoundryHtml,
  finiteNumber
} from "../scripts/shared/foundry-values.js";

test("collectionValues normalizes Foundry collections, iterables, and plain objects", () => {
  const array = [{ id: "array" }];
  const contents = [{ id: "contents" }];

  assert.equal(collectionValues(array), array);
  assert.equal(collectionValues({ contents }), contents);
  assert.deepEqual(collectionValues(new Set(["first", "second"])), ["first", "second"]);
  assert.deepEqual(collectionValues(new Map([["a", 1], ["b", 2]])), [1, 2]);
  assert.deepEqual(collectionValues({ first: 1, second: 2 }), [1, 2]);
  assert.deepEqual(collectionValues(null), []);
});

test("cloneFoundryValue prefers Foundry deepClone and falls back to a detached JSON clone", () => {
  const previousFoundry = globalThis.foundry;
  let foundryCalls = 0;
  globalThis.foundry = {
    utils: {
      deepClone(value) {
        foundryCalls += 1;
        return { ...value, clonedBy: "foundry" };
      }
    }
  };

  try {
    assert.deepEqual(cloneFoundryValue({ value: 1 }), { value: 1, clonedBy: "foundry" });
    assert.equal(foundryCalls, 1);

    delete globalThis.foundry;
    const source = { nested: { value: 2 } };
    const cloned = cloneFoundryValue(source);
    cloned.nested.value = 3;
    assert.equal(source.nested.value, 2);
    assert.equal(cloneFoundryValue(null), null);
    assert.equal(cloneFoundryValue(undefined), undefined);
  }
  finally {
    if (previousFoundry === undefined) delete globalThis.foundry;
    else globalThis.foundry = previousFoundry;
  }
});

test("escapeFoundryHtml escapes HTML consistently with and without Foundry", () => {
  const previousFoundry = globalThis.foundry;
  const calls = [];
  globalThis.foundry = {
    utils: {
      escapeHTML(value) {
        calls.push(value);
        return `escaped:${value}`;
      }
    }
  };

  try {
    assert.equal(escapeFoundryHtml(42), "escaped:42");
    assert.deepEqual(calls, ["42"]);

    delete globalThis.foundry;
    assert.equal(escapeFoundryHtml(`<tag a="b">Tom & 'Jerry'</tag>`), "&lt;tag a=&quot;b&quot;&gt;Tom &amp; &#39;Jerry&#39;&lt;/tag&gt;");
  }
  finally {
    if (previousFoundry === undefined) delete globalThis.foundry;
    else globalThis.foundry = previousFoundry;
  }
});

test("cleanText trims values and a blank fallback", () => {
  assert.equal(cleanText("  value  ", "fallback"), "value");
  assert.equal(cleanText("   ", "  fallback  "), "fallback");
  assert.equal(cleanText(null), "");
});

test("finiteNumber uses the fallback for nullish and non-finite values", () => {
  assert.equal(finiteNumber("12.5", 0), 12.5);
  assert.equal(finiteNumber(null, 7), 7);
  assert.equal(finiteNumber(undefined, 8), 8);
  assert.equal(finiteNumber(Number.POSITIVE_INFINITY, 9), 9);
  assert.equal(finiteNumber("not-a-number", 10), 10);
});
