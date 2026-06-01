import test from "node:test";
import assert from "node:assert/strict";

function installFoundryStubs() {
  const previousActor = globalThis.Actor;
  const previousItem = globalThis.Item;
  const previousFoundry = globalThis.foundry;
  const previousGame = globalThis.game;

  globalThis.Actor = class FakeActor {};
  globalThis.Item = class FakeItem {};
  globalThis.game = {
    i18n: {
      lang: "ru"
    }
  };
  globalThis.foundry = {
    utils: {
      deepClone(value) {
        return value == null ? value : JSON.parse(JSON.stringify(value));
      },
      mergeObject(base, source, { inplace = true } = {}) {
        const target = inplace ? base : this.deepClone(base);
        for (const [key, value] of Object.entries(source ?? {})) {
          if (value && typeof value === "object" && !Array.isArray(value)) {
            target[key] = this.mergeObject(target[key] ?? {}, value, { inplace: true });
          }
          else {
            target[key] = value;
          }
        }
        return target;
      },
      getProperty(source, path) {
        return String(path ?? "").split(".").reduce((current, part) => (
          current && typeof current === "object" ? current[part] : undefined
        ), source);
      },
      hasProperty(source, path) {
        return this.getProperty(source, path) !== undefined;
      }
    }
  };

  return () => {
    globalThis.Actor = previousActor;
    globalThis.Item = previousItem;
    globalThis.foundry = previousFoundry;
    globalThis.game = previousGame;
  };
}

function createActor({ id = "actor-a", name = "Hero", type = "character" } = {}) {
  return new class extends globalThis.Actor {
    constructor() {
      super();
      this.id = id;
      this.name = name;
      this.type = type;
      this.items = {
        contents: [],
        get: () => null
      };
    }

    getFlag() {
      return {};
    }
  }();
}

test("HeroDollService snapshot stays focused on equipment and does not query downtime", async () => {
  const restore = installFoundryStubs();
  try {
    const { HeroDollService } = await import(`../scripts/data/hero-doll-service.js?hero-doll-no-downtime=${Date.now()}`);
    const calls = [];
    const service = new HeroDollService({
      getDowntimeSnapshot() {
        calls.push(["getDowntimeSnapshot"]);
        throw new Error("Hero doll must not ask for downtime.");
      }
    });

    const snapshot = service.getActorSnapshot(createActor({ id: "actor-a" }));

    assert.deepEqual(calls, []);
    assert.equal(Object.hasOwn(snapshot, "downtime"), false);
  }
  finally {
    restore();
  }
});
