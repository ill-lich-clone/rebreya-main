import { MODULE_ID } from "../constants.js";
import { isCorpseStorageTarget } from "../data/storage-corpse-target.js?v=1.5.19";
import { isActiveGmClient } from "../infrastructure/foundry/active-gm.js";

export function registerCreatureHarvestingHooks({ hooks = globalThis.Hooks, gameProvider = () => globalThis.game, records } = {}) {
  const lastState = new WeakMap();
  const queues = new WeakMap();
  const record = async token => {
    const game = gameProvider();
    if (game?.system?.id !== "dnd5e" || token?.actor?.type !== "npc") return;
    const dead = isCorpseStorageTarget(token);
    const previous = lastState.get(token);
    lastState.set(token, dead);
    if (dead === previous || !isActiveGmClient(game)) return;
    const now = game.time?.worldTime;
    const task = (queues.get(token) ?? Promise.resolve()).catch(() => {}).then(async () => {
      if (!isActiveGmClient(gameProvider())) return;
      const state = records.read(token.uuid);
      if (!dead && state) await records.patch(token.uuid, { diedAt: null,
        config: { ...state.config, diedAt: null } });
      if (dead && previous === false && Number.isFinite(now)) {
        await records.patch(token.uuid, { diedAt: now });
      }
    });
    queues.set(token, task);
    await task;
  };
  const run = token => record(token).catch(error => console.warn(`${MODULE_ID} | Corpse time update failed`, error));
  const remember = token => {
    if (token?.actor?.type === "npc") lastState.set(token, isCorpseStorageTarget(token));
  };
  for (const scene of gameProvider()?.scenes ?? []) for (const token of scene.tokens) remember(token);
  hooks.on("createToken", remember);
  hooks.on("deleteToken", token => {
    lastState.delete(token);
    const pending = queues.get(token);
    if (!isActiveGmClient(gameProvider()) || (!pending && !records.read(token.uuid))) return;
    (pending ?? Promise.resolve()).catch(() => {}).then(() => {
      if (isActiveGmClient(gameProvider())) return records.remove(token.uuid);
    })
      .catch(error => console.warn(`${MODULE_ID} | Corpse record cleanup failed`, error));
  });
  const actorTokens = actor => actor?.isToken ? [actor.token] : (actor?.getDependentTokens?.({ concreteOnly: true }) ?? []);
  const updateActor = actor => actorTokens(actor).forEach(run);
  const hpChanged = changes => Object.hasOwn(changes, "system.attributes.hp.value")
    || globalThis.foundry.utils.hasProperty(changes, "system.attributes.hp.value");
  hooks.on("updateActor", (actor, changes) => { if (hpChanged(changes)) updateActor(actor); });
  hooks.on("updateToken", (token, changes) => { if (hpChanged(changes.delta ?? {})) run(token); });
  for (const event of ["createActiveEffect", "updateActiveEffect", "deleteActiveEffect"]) {
    hooks.on(event, effect => {
      const actor = effect.parent?.actor ?? effect.parent;
      if (actor?.type === "npc") queueMicrotask(() => updateActor(actor));
    });
  }
}
