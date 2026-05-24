import test from "node:test";
import assert from "node:assert/strict";

import { patchSmAirshipRenderSettingsHook } from "../scripts/integrations/sm-airship-compat.js";

test("sm-airship renderSettings hook receives a jQuery-compatible html wrapper", () => {
  const previousDollar = globalThis.$;
  const htmlElement = { id: "settings-root" };
  const jqueryHtml = {
    find() {
      return { length: 0 };
    },
    append() {}
  };
  let receivedHtml = null;

  globalThis.$ = (value) => {
    assert.equal(value, htmlElement);
    return jqueryHtml;
  };

  const hookEntry = {
    fn: (_app, html) => {
      if (html.find(".sm-airship-settings-launch").length) return;
      receivedHtml = html;
    }
  };
  const Hooks = {
    events: {
      renderSettings: [
        hookEntry,
        { fn: () => undefined }
      ]
    }
  };

  try {
    assert.equal(patchSmAirshipRenderSettingsHook(Hooks), 1);
    assert.equal(patchSmAirshipRenderSettingsHook(Hooks), 0);

    hookEntry.fn({}, htmlElement);

    assert.equal(receivedHtml, jqueryHtml);
  }
  finally {
    globalThis.$ = previousDollar;
  }
});
