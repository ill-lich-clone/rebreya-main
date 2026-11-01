const SELECTOR = "[data-rebreya-heroic-inspiration]";
const FLAG_SCOPE = "rebreya-main";
const GM_FLAG = "heroicInspiration";
const registeredHooks = new WeakSet();

function canToggle(player, viewer) {
  const actor = player?.character;
  return Boolean(player?.active && viewer && ((viewer.isGM && (actor || player.isGM))
    || (actor && viewer.id === player.id && actor.testUserPermission?.(viewer, "OWNER") === true)));
}

export function updateHeroicInspirationButton(button, player, viewer) {
  if (!button || !player?.active || (!player.character && !player.isGM)) return false;
  const active = player.character ? player.character.system?.attributes?.inspiration === true
    : player.getFlag?.(FLAG_SCOPE, GM_FLAG) === true;
  button.disabled = !canToggle(player, viewer);
  button.setAttribute("aria-pressed", String(active));
  button.setAttribute("aria-label", active ? "Героическое вдохновение: есть" : "Героическое вдохновение: нет");
  button.title = active ? "Героическое вдохновение: есть" : "Героическое вдохновение: нет";
  return true;
}

export async function toggleHeroicInspiration(player, viewer) {
  if (!canToggle(player, viewer)) return false;
  const actor = player.character;
  if (actor) await actor.update({ "system.attributes.inspiration": actor.system?.attributes?.inspiration !== true });
  else await player.setFlag(FLAG_SCOPE, GM_FLAG, player.getFlag?.(FLAG_SCOPE, GM_FLAG) !== true);
  return true;
}

export function refreshPlayerHeroicInspiration(root, game = globalThis.game, changedActor = null) {
  if (game?.system?.id !== "dnd5e" || !root?.querySelectorAll) return;
  for (const row of root.querySelectorAll("#players-active .players-list > li.player[data-user-id]")) {
    const player = game.users?.get?.(row.dataset.userId);
    if (changedActor && player?.character?.uuid !== changedActor.uuid) continue;
    let button = row.querySelector(SELECTOR);
    if (!player?.active || (!player.character && !player.isGM)) {
      button?.remove(); row.classList?.remove("rm-has-heroic-inspiration"); continue;
    }
    if (!button) {
      button = row.ownerDocument.createElement("button");
      button.type = "button";
      button.dataset.rebreyaHeroicInspiration = "true";
      button.className = "rm-player-heroic-inspiration";
      button.addEventListener("click", async event => {
        event.preventDefault();
        event.stopPropagation();
        if (button.disabled) return;
        button.disabled = true;
        try { await toggleHeroicInspiration(game.users?.get?.(row.dataset.userId), game.user); }
        catch (error) { console.error("rebreya-main | Не удалось переключить героическое вдохновение.", error); }
        finally { updateHeroicInspirationButton(button, game.users?.get?.(row.dataset.userId), game.user); }
      });
      row.prepend(button);
    }
    row.classList?.add("rm-has-heroic-inspiration");
    updateHeroicInspirationButton(button, player, game.user);
  }
}

export function registerPlayerHeroicInspirationHooks(hooks = globalThis.Hooks, game = globalThis.game) {
  if (!hooks?.on || game?.system?.id !== "dnd5e") return false;
  if (registeredHooks.has(hooks)) return true;
  registeredHooks.add(hooks);
  hooks.on("renderPlayers", (app, html) => refreshPlayerHeroicInspiration(app?.element ?? html?.[0] ?? html, game));
  hooks.on("updateActor", (actor, changes) => {
    if (!Object.hasOwn(changes ?? {}, "system.attributes.inspiration")
      && !Object.hasOwn(changes?.system?.attributes ?? {}, "inspiration")
      && !Object.hasOwn(changes?.["system.attributes"] ?? {}, "inspiration")) return;
    refreshPlayerHeroicInspiration(globalThis.ui?.players?.element, game, actor);
  });
  hooks.on("updateUser", () => refreshPlayerHeroicInspiration(globalThis.ui?.players?.element, game));
  return true;
}
