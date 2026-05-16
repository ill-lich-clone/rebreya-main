import { MODULE_ID } from "../constants.js";

const COIN_MULTIPLIERS = {
  pp: 1000,
  gp: 100,
  sp: 10,
  cp: 1
};

function escapeHtml(value) {
  return foundry.utils.escapeHTML(String(value ?? ""));
}

function toInteger(value, fallback = 0) {
  const numericValue = Number(value ?? fallback);
  return Number.isFinite(numericValue) ? Math.floor(numericValue) : fallback;
}

function normalizeCoins(coins = {}) {
  const result = {
    pp: Math.max(0, toInteger(coins.pp, 0)),
    gp: Math.max(0, toInteger(coins.gp, 0)),
    sp: Math.max(0, toInteger(coins.sp, 0)),
    cp: Math.max(0, toInteger(coins.cp, 0))
  };

  result.totalCopper = (result.pp * COIN_MULTIPLIERS.pp)
    + (result.gp * COIN_MULTIPLIERS.gp)
    + (result.sp * COIN_MULTIPLIERS.sp)
    + result.cp;

  return result;
}

function formatCoinsLabel(coins = {}) {
  const safeCoins = normalizeCoins(coins);
  const parts = [];
  if (safeCoins.pp > 0) parts.push(`${safeCoins.pp} пм`);
  if (safeCoins.gp > 0) parts.push(`${safeCoins.gp} зм`);
  if (safeCoins.sp > 0) parts.push(`${safeCoins.sp} см`);
  if (safeCoins.cp > 0) parts.push(`${safeCoins.cp} мм`);
  return parts.length ? parts.join(" ") : "0 мм";
}

function formatNumber(value) {
  return new Intl.NumberFormat("ru-RU", {
    maximumFractionDigits: 2
  }).format(Number(value ?? 0));
}

function resolveRoot(html) {
  if (html instanceof HTMLElement) {
    return html;
  }

  if (html?.jquery && html[0] instanceof HTMLElement) {
    return html[0];
  }

  if (Array.isArray(html) && html[0] instanceof HTMLElement) {
    return html[0];
  }

  return null;
}

function setDragData(event, payload) {
  if (!event?.dataTransfer) {
    return;
  }

  const serialized = JSON.stringify(payload);
  event.dataTransfer.effectAllowed = "copy";
  for (const mimeType of ["text/plain", "text", "application/json"]) {
    try {
      event.dataTransfer.setData(mimeType, serialized);
    }
    catch (_error) {
      // Foundry/Chromium builds differ in supported drag mime aliases.
    }
  }
}

function renderRow(row) {
  const claimed = Boolean(row.claimed);
  const itemUuid = String(row.itemUuid ?? "");
  const rowId = String(row.rowId ?? "");
  const image = String(row.img ?? "icons/svg/item-bag.svg");
  const quantity = Math.max(1, Number(row.quantity ?? 1));
  const metaParts = [
    row.typeLabel || "Предмет",
    `ранг ${formatNumber(row.rank ?? 0)}`,
    `x${formatNumber(quantity)}`,
    `${formatNumber(row.totalValue ?? row.value ?? 0)} value`
  ];

  return `
    <article
      class="rm-chat-loot__row ${claimed ? "is-claimed" : ""}"
      data-lootgen-chat-drag="${claimed ? "false" : "true"}"
      data-lootgen-chat-row-id="${escapeHtml(rowId)}"
      data-item-uuid="${escapeHtml(itemUuid)}"
      draggable="${claimed ? "false" : "true"}"
      title="${claimed ? "Этот предмет уже забрали." : "Перетащите предмет в лист персонажа."}"
    >
      <img src="${escapeHtml(image)}" alt="">
      <div class="rm-chat-loot__row-main">
        <strong>${escapeHtml(row.name || "Предмет")}</strong>
        <span>${escapeHtml(metaParts.filter(Boolean).join(" • "))}</span>
      </div>
      <span class="rm-chat-loot__state">${claimed ? "Забрано" : "Перетащить"}</span>
    </article>
  `.trim();
}

export function buildLootgenChatContent(state = {}) {
  const rows = Array.isArray(state.rows) ? state.rows : [];
  const availableRows = rows.filter((row) => !row.claimed);
  const coins = normalizeCoins(state.coins ?? {});
  const coinsClaimed = Boolean(state.coinsClaimed) || coins.totalCopper <= 0;
  const lootId = String(state.lootId ?? "");
  const generatedAt = String(state.generatedAt ?? "");

  return `
    <section class="rm-chat-loot" data-lootgen-chat-id="${escapeHtml(lootId)}">
      <header class="rm-chat-loot__header">
        <div>
          <p class="rm-chat-loot__eyebrow">Rebreya Loot</p>
          <h3>Найденные сокровища</h3>
          ${generatedAt ? `<p>${escapeHtml(generatedAt)}</p>` : ""}
        </div>
        <strong>${availableRows.length} / ${rows.length}</strong>
      </header>

      ${rows.length ? `
        <div class="rm-chat-loot__list">
          ${rows.map(renderRow).join("")}
        </div>
      ` : "<p class=\"rm-chat-loot__empty\">В этом результате нет предметов.</p>"}

      <footer class="rm-chat-loot__footer">
        <div>
          <span>Монеты</span>
          <strong>${escapeHtml(formatCoinsLabel(coins))}</strong>
        </div>
        <button
          type="button"
          class="rm-chat-loot__coin-button"
          data-lootgen-chat-action="claim-coins"
          data-lootgen-chat-id="${escapeHtml(lootId)}"
          ${coinsClaimed ? "disabled" : ""}
        >
          ${coinsClaimed ? "Монеты забраны" : "Добавить монеты в склад"}
        </button>
      </footer>
    </section>
  `.trim();
}

function bindLootgenChatMessage(message, html) {
  const root = resolveRoot(html);
  if (!root) {
    return;
  }

  const cards = root.matches?.(".rm-chat-loot")
    ? [root]
    : Array.from(root.querySelectorAll?.(".rm-chat-loot") ?? []);

  for (const card of cards) {
    if (card.dataset.rebreyaLootBound === "true") {
      continue;
    }

    card.dataset.rebreyaLootBound = "true";

    card.querySelectorAll("[data-lootgen-chat-drag='true']").forEach((row) => {
      row.addEventListener("dragstart", (event) => {
        const uuid = event.currentTarget.dataset.itemUuid;
        if (!uuid) {
          return;
        }

        setDragData(event, {
          type: "Item",
          uuid
        });
      });
    });

    card.querySelectorAll("[data-lootgen-chat-action='claim-coins']").forEach((button) => {
      button.addEventListener("click", async (event) => {
        event.preventDefault();
        const lootId = event.currentTarget.dataset.lootgenChatId
          || card.dataset.lootgenChatId
          || message.getFlag(MODULE_ID, "lootgenChat")?.lootId
          || "";
        if (!lootId) {
          return;
        }

        try {
          await game.rebreyaMain?.claimLootgenChatCoins?.(lootId);
        }
        catch (error) {
          console.error(`${MODULE_ID} | Failed to claim lootgen chat coins.`, error);
          ui.notifications?.error(error.message || "Не удалось забрать монеты из лута.");
        }
      });
    });
  }
}

export function registerLootgenChatHooks(moduleApi) {
  Hooks.on("renderChatMessage", (message, html) => {
    bindLootgenChatMessage(message, html);
  });

  Hooks.on("renderChatMessageHTML", (message, html) => {
    bindLootgenChatMessage(message, html);
  });

  Hooks.on("createItem", (item, _options, userId) => {
    moduleApi.handleLootgenChatItemCreated?.(item, userId).catch((error) => {
      console.error(`${MODULE_ID} | Failed to process lootgen chat item claim.`, error);
    });
  });
}
