/**
 * Rebreya Site sync panel on the dnd5e character sheet (integration ТЗ §5.3).
 *
 * A compact control injected into the sheet header opens a dialog with the
 * integration status and actions: log in, link to a site character, import /
 * refresh the build, open on the site. Kept isolated from the big
 * dnd5e-sheet-extensions.js — bound from its onRenderActorSheet with one call.
 *
 * All Foundry-app access goes through game.rebreyaMain (site + characterSync +
 * siteSpellsCompendium); this file is pure glue + UI.
 */
import { MODULE_ID } from "../constants.js";

const escapeHtml = (value) =>
  String(value ?? "")
    .replace(/&/gu, "&amp;")
    .replace(/</gu, "&lt;")
    .replace(/>/gu, "&gt;")
    .replace(/"/gu, "&quot;")
    .replace(/'/gu, "&#39;");

function dialogV2() {
  return globalThis.foundry?.applications?.api?.DialogV2 ?? null;
}

async function notify(kind, message) {
  ui.notifications?.[kind]?.(message);
}

/** Ask for site credentials and log in. Returns true on success. */
async function promptLogin(site) {
  const DV2 = dialogV2();
  const content = `
    <div class="rebreya-site-login">
      <p>Вход на <strong>rebreya.com</strong> для синхронизации персонажей.</p>
      <div class="form-group"><label>Логин</label><input type="text" name="username" autocomplete="off" /></div>
      <div class="form-group"><label>Пароль</label><input type="password" name="password" autocomplete="off" /></div>
    </div>`;
  if (!DV2) return false;
  const result = await DV2.wait({
    window: { title: "Rebreya — вход" },
    content,
    buttons: [
      {
        action: "login",
        label: "Войти",
        default: true,
        callback: (_event, button) => {
          const form = button.form;
          return { username: form.username.value.trim(), password: form.password.value };
        },
      },
      { action: "cancel", label: "Отмена" },
    ],
    rejectClose: false,
  });
  if (!result || result === "cancel" || !result.username) return false;
  try {
    await site.login(result.username, result.password);
    await notify("info", "Вход на rebreya.com выполнен.");
    return true;
  } catch (error) {
    await notify("error", `Не удалось войти: ${error.message}`);
    return false;
  }
}

/** Let the user pick one of their site characters. Returns the record or null. */
async function pickCharacter(characterSync) {
  const DV2 = dialogV2();
  let characters = [];
  try {
    characters = await characterSync.listCharacters();
  } catch (error) {
    await notify("error", error.message);
    return null;
  }
  if (!characters.length) {
    await notify("warn", "На сайте нет персонажей для этого аккаунта.");
    return null;
  }
  const options = characters
    .map((c) => `<option value="${escapeHtml(String(c.id))}">${escapeHtml(c.name)} — ${escapeHtml(c.gameClass ?? "")} ${escapeHtml(String(c.level ?? ""))}</option>`)
    .join("");
  const result = await DV2.wait({
    window: { title: "Rebreya — выбор персонажа" },
    content: `<div class="form-group"><label>Персонаж сайта</label><select name="cid">${options}</select></div>`,
    buttons: [
      { action: "pick", label: "Выбрать", default: true, callback: (_e, b) => b.form.cid.value },
      { action: "cancel", label: "Отмена" },
    ],
    rejectClose: false,
  });
  if (!result || result === "cancel") return null;
  return characters.find((c) => String(c.id) === String(result)) ?? null;
}

/** Build the status + actions dialog for a linked/unlinked actor. */
async function openSyncDialog(actor, moduleApi) {
  const DV2 = dialogV2();
  if (!DV2) {
    await notify("error", "DialogV2 недоступен в этой версии Foundry.");
    return;
  }
  const site = moduleApi?.site;
  const characterSync = moduleApi?.characterSync;
  const link = characterSync?.getLink(actor) ?? null;
  const authed = Boolean(site?.isAuthenticated?.());
  const baseUrl = site?.api?.baseUrl ?? "https://rebreya.com";

  const statusRows = [
    `<div><strong>Авторизация:</strong> ${authed ? "выполнена" : "нет"}</div>`,
    `<div><strong>Связь:</strong> ${link ? `персонаж #${escapeHtml(String(link.id))}${link.slug ? ` (${escapeHtml(link.slug)})` : ""}` : "не связан"}</div>`,
    link?.lastSyncAt ? `<div><strong>Последняя синхронизация:</strong> ${escapeHtml(new Date(link.lastSyncAt).toLocaleString())}</div>` : "",
  ].filter(Boolean).join("");

  const buttons = [];
  if (!authed) {
    buttons.push({ action: "login", label: "Войти на сайт", default: true });
  } else {
    buttons.push({ action: link ? "refresh" : "link", label: link ? "Обновить билд" : "Связать и импортировать", default: true });
  }
  if (link) buttons.push({ action: "open", label: "Открыть на сайте" });
  buttons.push({ action: "close", label: "Закрыть" });

  const action = await DV2.wait({
    window: { title: "Rebreya — синхронизация персонажа" },
    content: `<div class="rebreya-site-sync-status">${statusRows}</div>`,
    buttons: buttons.map((b) => ({ ...b, callback: () => b.action })),
    rejectClose: false,
  });

  if (!action || action === "close") return;

  if (action === "login") {
    if (await promptLogin(site)) return openSyncDialog(actor, moduleApi);
    return;
  }
  if (action === "open") {
    const url = `${baseUrl}/characters/${link.id}`;
    globalThis.open?.(url, "_blank", "noopener");
    return;
  }
  if (action === "link" || action === "refresh") {
    let character = null;
    if (action === "refresh" && link) {
      // pull the latest build for the already-linked character
      character = await characterSync.listCharacters().then(
        (list) => list.find((c) => String(c.id) === String(link.id)) ?? null,
      ).catch(() => null);
      if (!character) { await notify("warn", "Связанный персонаж не найден на сайте."); return; }
    } else {
      character = await pickCharacter(characterSync);
      if (!character) return;
    }
    try {
      const res = await characterSync.importBuild(actor, character, { overrideAc: false });
      await notify("info", `Импортировано: ${escapeHtml(character.name)}. Заклинаний перенесено: ${res.spellsAdded}.`);
      for (const w of res.warnings ?? []) await notify("warn", w);
    } catch (error) {
      await notify("error", `Импорт не удался: ${error.message}`);
    }
  }
}

/**
 * Inject the compact «Rebreya» control into the character sheet header.
 * Idempotent — safe to call on every render.
 */
export function bindSiteSyncPanel(root, app, moduleApi) {
  try {
    if (!root || app?.actor?.type !== "character") return;
    // Only show when the integration is enabled in world settings.
    if (!moduleApi?.site?.isEnabled?.()) {
      root.querySelector?.("[data-rebreya-site-sync='true']")?.remove?.();
      return;
    }
    const anchor = root.querySelector?.(".sheet-header > .left") ?? root.querySelector?.(".sheet-header");
    if (!anchor) return;
    if (anchor.querySelector?.("[data-rebreya-site-sync='true']")) return; // already injected

    const link = moduleApi?.characterSync?.getLink?.(app.actor) ?? null;
    const button = document.createElement("button");
    button.type = "button";
    button.dataset.rebreyaSiteSync = "true";
    button.classList.add("rebreya-site-sync-button");
    button.title = "Синхронизация с rebreya.com";
    button.innerHTML = `<i class="fa-solid fa-globe"></i> <span>Rebreya${link ? " ✓" : ""}</span>`;
    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      openSyncDialog(app.actor, moduleApi);
    });
    anchor.appendChild(button);
  } catch (error) {
    console.error(`${MODULE_ID} | Failed to bind Rebreya site sync panel.`, error);
  }
}
