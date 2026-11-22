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

/** Yes/no dialog. Returns true on «Да». Defaults to true if DialogV2 is absent. */
async function confirmDialog(title, message) {
  const DV2 = dialogV2();
  if (!DV2) return true;
  const res = await DV2.wait({
    window: { title },
    content: `<p>${escapeHtml(message)}</p>`,
    buttons: [
      { action: "yes", label: "Да", default: true },
      { action: "no", label: "Нет" },
    ].map((b) => ({ ...b, callback: () => b.action })),
    rejectClose: false,
  });
  return res === "yes";
}

/** One-line RU summary of a site state object for the conflict dialog. */
function describeState(state) {
  if (!state) return "";
  const bits = [];
  if (state.currentHp != null || state.maxHp != null) bits.push(`хиты ${state.currentHp ?? "?"}/${state.maxHp ?? "?"}`);
  if (state.exhaustion) bits.push(`истощение ${state.exhaustion}`);
  if (state.inspiration) bits.push("вдохновение");
  const ds = state.deathSaves;
  if (ds && (ds.success || ds.failure)) bits.push(`спасброски со смертью ${ds.success ?? 0}/${ds.failure ?? 0}`);
  return escapeHtml(bits.join(", "));
}

/**
 * State-push conflict resolution dialog (integration ТЗ §9.3). MVP actions:
 * «Оставить Foundry» (force-push), «Принять сайт» (pull), «Отменить».
 */
export async function resolveStateConflict(actor, moduleApi, conflict) {
  const DV2 = dialogV2();
  const characterSync = moduleApi?.characterSync;
  if (!DV2) { await notify("error", "DialogV2 недоступен в этой версии Foundry."); return; }
  const remote = conflict?.remote ?? null;
  const summary = describeState(remote);
  const decision = await DV2.wait({
    window: { title: "Rebreya — конфликт состояния" },
    content: `
      <div class="rebreya-site-conflict">
        <p>Состояние персонажа на <strong>rebreya.com изменилось</strong> после последней синхронизации.</p>
        <ul>
          <li><strong>Оставить Foundry</strong> — перезаписать сайт данными из Foundry.</li>
          <li><strong>Принять сайт</strong> — загрузить состояние с сайта в Foundry.</li>
        </ul>
        ${summary ? `<p class="notes">Сейчас на сайте: ${summary}.</p>` : ""}
      </div>`,
    buttons: [
      { action: "keep", label: "Оставить Foundry", default: true },
      { action: "accept", label: "Принять сайт" },
      { action: "cancel", label: "Отменить" },
    ].map((b) => ({ ...b, callback: () => b.action })),
    rejectClose: false,
  });
  if (!decision || decision === "cancel") return;
  try {
    if (decision === "keep") {
      await characterSync.pushState(actor, { force: true });
      await notify("info", "Состояние Foundry отправлено на сайт (перезапись).");
    } else if (decision === "accept") {
      const res = await characterSync.applySiteState(actor, remote);
      await notify("info", "Состояние сайта загружено в Foundry.");
      for (const w of res?.warnings ?? []) await notify("warn", w);
    }
  } catch (error) {
    await notify("error", `Не удалось разрешить конфликт: ${error.message}`);
  }
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

/** Ask for a share code made on the site. Returns the typed code or null. */
async function promptShareCode() {
  const DV2 = dialogV2();
  if (!DV2) return null;
  const content = `
    <div class="rebreya-site-code">
      <p>На <strong>rebreya.com</strong> откройте своего персонажа и нажмите <strong>«В Foundry»</strong> — сайт покажет код на 15 минут.</p>
      <div class="form-group"><label>Код</label><input type="text" name="code" placeholder="K7QM-2XPA" autocomplete="off" autocapitalize="characters" spellcheck="false" /></div>
      <p class="notes">Пароль от сайта вводить не нужно. Код одноразовый.</p>
    </div>`;
  const result = await DV2.wait({
    window: { title: "Rebreya — импорт по коду" },
    content,
    buttons: [
      { action: "ok", label: "Импортировать", default: true, callback: (_e, b) => b.form.code.value.trim() },
      { action: "cancel", label: "Отмена" },
    ],
    rejectClose: false,
  });
  if (!result || result === "cancel") return null;
  return result;
}

function reportImport(name, res) {
  const classes = res?.classes?.length ? ` Классы: ${escapeHtml(res.classes.join(", "))}.` : "";
  notify("info", `Импортировано: ${escapeHtml(name)}.${classes} Предметов листа: ${res?.itemsCreated ?? 0}, заклинаний: ${res?.spellsAdded ?? 0}.`);
  for (const w of res?.warnings ?? []) notify("warn", w);
}

/**
 * Share-code import, shared by the Actors directory button (new Actor) and the
 * sheet panel (link this Actor). Opens the sheet on success.
 */
export async function runShareCodeImport(moduleApi, { actor = null } = {}) {
  const service = moduleApi?.siteShareImport;
  if (!service) { await notify("error", "Импорт по коду недоступен: модуль не инициализирован."); return null; }
  const code = await promptShareCode();
  if (!code) return null;
  try {
    const { actor: target, result, route } = await service.importByCode(code, { actor });
    reportImport(target?.name ?? "", result);
    if (route === "gm") notify("info", "Персонажа создал ГМ, он принадлежит вам.");
    if (!actor) target?.sheet?.render?.(true);
    return target;
  } catch (error) {
    await notify("error", `Импорт по коду не удался: ${error.message}`);
    return null;
  }
}

/** One-line auto-sync status for the panel. */
function autoSyncLabel(actor, moduleApi, link) {
  const auto = moduleApi?.siteAutoSync;
  if (link.autoSync === false) return "выключена для персонажа";
  if (auto && !auto.isWorldEnabled()) return "выключена в настройках мира";
  if (auto?.isElected?.(actor)) return "включена (синхронизирует этот браузер)";
  return "включена (синхронизирует браузер игрока, связавшего персонажа)";
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
  const hasToken = Boolean(characterSync?.getLinkToken?.(actor));
  const canSync = hasToken || authed;
  const baseUrl = site?.api?.baseUrl ?? "https://rebreya.com";

  const statusRows = [
    `<div><strong>Связь:</strong> ${link ? `персонаж #${escapeHtml(String(link.id))}${link.slug ? ` (${escapeHtml(link.slug)})` : ""}` : "не связан"}</div>`,
    `<div><strong>Доступ:</strong> ${hasToken ? "по коду (в этом браузере)" : authed ? "вход по паролю" : "нет — свяжите по коду"}</div>`,
    link?.lastSyncAt ? `<div><strong>Последняя синхронизация:</strong> ${escapeHtml(new Date(link.lastSyncAt).toLocaleString())}</div>` : "",
    link ? `<div><strong>Автосинхронизация:</strong> ${autoSyncLabel(actor, moduleApi, link)}</div>` : "",
  ].filter(Boolean).join("");

  const buttons = [];
  if (link && canSync) {
    buttons.push({ action: "refresh", label: "Обновить билд", default: true });
    buttons.push({ action: "push", label: "Отправить состояние" });
  }
  buttons.push({ action: "code", label: link ? "Связать заново по коду" : "Связать по коду", default: !(link && canSync) });
  if (authed && !link) buttons.push({ action: "link", label: "Выбрать из аккаунта" });
  if (!authed) buttons.push({ action: "login", label: "Войти паролем" });
  if (link && hasToken) buttons.push({ action: "autosync", label: link.autoSync === false ? "Включить автосинхронизацию" : "Выключить автосинхронизацию" });
  if (link) buttons.push({ action: "open", label: "Открыть на сайте" });
  buttons.push({ action: "close", label: "Закрыть" });

  const action = await DV2.wait({
    window: { title: "Rebreya — синхронизация персонажа" },
    content: `<div class="rebreya-site-sync-status">${statusRows}</div>`,
    buttons: buttons.map((b) => ({ ...b, callback: () => b.action })),
    rejectClose: false,
  });

  if (!action || action === "close") return;

  if (action === "code") {
    await runShareCodeImport(moduleApi, { actor });
    return;
  }
  if (action === "autosync") {
    const on = link.autoSync === false;
    await actor.update({ [`flags.${MODULE_ID}.siteCharacter.autoSync`]: on }, { rebreyaSiteSync: true });
    await notify("info", on ? "Автосинхронизация включена." : "Автосинхронизация выключена для этого персонажа.");
    if (on) moduleApi?.siteAutoSync?.pullActor?.(actor);
    return;
  }
  if (action === "login") {
    if (await promptLogin(site)) return openSyncDialog(actor, moduleApi);
    return;
  }
  if (action === "open") {
    const url = `${baseUrl}/characters/${link.id}`;
    globalThis.open?.(url, "_blank", "noopener");
    return;
  }
  if (action === "push") {
    try {
      const res = await characterSync.pushState(actor);
      if (res?.conflict) {
        await resolveStateConflict(actor, moduleApi, res);
      } else {
        await notify("info", "Состояние отправлено на сайт rebreya.com.");
      }
      return;
    } catch (error) {
      await notify("error", `Не удалось отправить состояние: ${error.message}`);
      return;
    }
  }
  if (action === "refresh") {
    try {
      const res = await characterSync.refreshBuild(actor, { overrideAc: false });
      reportImport(res.character?.name ?? actor.name, res);
    } catch (error) {
      await notify("error", `Обновление не удалось: ${error.message}`);
    }
    return;
  }
  if (action === "link") {
    const character = await pickCharacter(characterSync);
    if (!character) return;
    // Link conflicts (ТЗ §9.3): this Actor is already linked elsewhere, or the
    // chosen site character is already linked to another Actor.
    const existing = characterSync.getLink(actor);
    if (existing?.id != null && Number(existing.id) !== Number(character.id)) {
      const ok = await confirmDialog(
        "Rebreya — перепривязка",
        `Этот Actor уже связан с персонажем сайта #${existing.id}. Перепривязать к «${character.name}»?`,
      );
      if (!ok) return;
    }
    const other = characterSync.findActorLinkedTo(character.id, actor.id);
    if (other) {
      const ok = await confirmDialog(
        "Rebreya — персонаж уже связан",
        `Персонаж «${character.name}» уже связан с актёром «${other.name}». Всё равно связать текущий Actor?`,
      );
      if (!ok) return;
    }
    try {
      const res = await characterSync.importBuild(actor, character, { overrideAc: false });
      reportImport(character.name, res);
    } catch (error) {
      await notify("error", `Импорт не удался: ${error.message}`);
    }
  }
}

/**
 * «Импорт по коду» button in the Actors directory, for players too (the Actor
 * is created by the GM when the player may not create Actors). Idempotent.
 */
export function bindActorDirectoryShareButton(root, moduleApi) {
  try {
    const element = root instanceof HTMLElement ? root : root?.[0] ?? null;
    if (!element?.querySelector) return;
    const existing = element.querySelector("[data-rebreya-share-import='true']");
    if (!moduleApi?.site?.isEnabled?.()) { existing?.remove?.(); return; }
    if (existing) return;
    const anchor = element.querySelector(".header-actions") ?? element.querySelector(".directory-header") ?? element.querySelector("header");
    if (!anchor) return;
    const button = document.createElement("button");
    button.type = "button";
    button.dataset.rebreyaShareImport = "true";
    button.classList.add("rebreya-share-import-button");
    button.title = "Импортировать персонажа с rebreya.com по коду — без пароля";
    button.innerHTML = `<i class="fa-solid fa-globe"></i> <span>Импорт с rebreya.com</span>`;
    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      runShareCodeImport(moduleApi);
    });
    anchor.appendChild(button);
  } catch (error) {
    console.error(`${MODULE_ID} | Failed to bind share-code import button.`, error);
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
