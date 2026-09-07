const CURRENCY_MULTIPLIERS = Object.freeze({ pp: 1000, gp: 100, sp: 10, cp: 1 });
const CURRENCY_DENOMINATIONS = new Set(Object.keys(CURRENCY_MULTIPLIERS));
const MAX_VISIBLE_RESULTS = 100;

export function resolveInventoryAddDialogHeight(viewportHeight) {
  const availableHeight = Number.isFinite(Number(viewportHeight)) ? Math.floor(Number(viewportHeight)) - 80 : 720;
  return Math.min(720, Math.max(240, availableHeight));
}

function cleanText(value) {
  return String(value ?? "").trim();
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function roundValue(value, digits = 5) {
  const factor = 10 ** digits;
  return Math.round((Number(value) + Number.EPSILON) * factor) / factor;
}

function parseDecimal(value, fieldLabel, { min = 0 } = {}) {
  const text = cleanText(value).replace(",", ".");
  if (!/^(?:\d+(?:\.\d+)?|\.\d+)$/u.test(text)) {
    throw new Error(`${fieldLabel}: укажите неотрицательное число.`);
  }
  const number = Number(text);
  if (!Number.isFinite(number) || number < min) {
    throw new Error(`${fieldLabel}: укажите неотрицательное число.`);
  }
  return roundValue(number);
}

function parsePositiveInteger(value) {
  const text = cleanText(value);
  if (!/^\d+$/u.test(text) || !Number.isSafeInteger(Number(text)) || Number(text) <= 0) {
    throw new Error("Количество должно быть положительным целым числом.");
  }
  return Number(text);
}

export function normalizeInventoryAddSearchText(value) {
  return cleanText(value)
    .toLocaleLowerCase("ru")
    .replace(/[‘’‚‛]/gu, "'")
    .replace(/[“”„‟«»]/gu, '"')
    .replace(/\s+/gu, " ");
}

function catalogEntryId(entry) {
  return cleanText(entry?.id) || `${cleanText(entry?.sourceType)}:${cleanText(entry?.sourceId)}`;
}

function similarScore(normalizedName, normalizedQuery) {
  if (!normalizedQuery) return 1;
  if (normalizedName.startsWith(normalizedQuery)) return 400 - normalizedName.length;
  const at = normalizedName.indexOf(normalizedQuery);
  if (at >= 0) return 300 - at;
  const queryWords = normalizedQuery.split(" ").filter(Boolean);
  const nameWords = new Set(normalizedName.split(" ").filter(Boolean));
  if (queryWords.length > 0 && queryWords.every((word) => nameWords.has(word))) return 200 - normalizedName.length;
  if (queryWords.length > 0 && queryWords.every((word) => normalizedName.includes(word))) return 100 - normalizedName.length;
  return 0;
}

export function searchInventoryAddCatalog(catalog, query) {
  const normalizedQuery = normalizeInventoryAddSearchText(query);
  const entries = (Array.isArray(catalog) ? catalog : [])
    .filter((entry) => cleanText(entry?.sourceType) && cleanText(entry?.sourceId) && cleanText(entry?.name))
    .map((entry) => ({
      ...entry,
      id: catalogEntryId(entry),
      normalizedName: normalizeInventoryAddSearchText(entry.name)
    }));
  const exactMatches = normalizedQuery
    ? entries.filter((entry) => entry.normalizedName === normalizedQuery)
    : [];
  const exactIds = new Set(exactMatches.map((entry) => entry.id));
  const similarMatches = entries
    .filter((entry) => !exactIds.has(entry.id))
    .map((entry) => ({ entry, score: similarScore(entry.normalizedName, normalizedQuery) }))
    .filter(({ score }) => score > 0)
    .sort((left, right) => right.score - left.score
      || left.entry.name.localeCompare(right.entry.name, "ru", { sensitivity: "base", numeric: true }))
    .slice(0, MAX_VISIBLE_RESULTS)
    .map(({ entry }) => entry);
  return Object.freeze({
    query: normalizedQuery,
    exactMatches: Object.freeze(exactMatches),
    similarMatches: Object.freeze(similarMatches),
    autoSelectedId: exactMatches.length === 1 ? exactMatches[0].id : "",
    canAddManual: exactMatches.length === 0
  });
}

export function validateManualInventoryEntry(values = {}) {
  const name = cleanText(values.name);
  if (!name) throw new Error("Укажите название предмета.");
  const quantity = parsePositiveInteger(values.quantity ?? 1);
  const unitWeight = parseDecimal(values.unitWeight ?? 0, "Вес");
  const unitPriceValue = parseDecimal(values.unitPriceValue ?? 0, "Цена");
  const unitPriceDenomination = cleanText(values.unitPriceDenomination || "gp").toLocaleLowerCase();
  if (!CURRENCY_DENOMINATIONS.has(unitPriceDenomination)) {
    throw new Error("Выберите допустимый номинал цены.");
  }
  const unitPriceCopper = Math.round(unitPriceValue * CURRENCY_MULTIPLIERS[unitPriceDenomination]);
  return {
    name,
    quantity,
    unitWeight,
    totalWeight: roundValue(unitWeight * quantity),
    unitPriceValue,
    unitPriceDenomination,
    unitPriceCopper,
    totalPriceCopper: unitPriceCopper * quantity,
    itemType: cleanText(values.itemType) || "Прочее",
    material: cleanText(values.material)
  };
}

function formatNumber(value) {
  return new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 5 }).format(Number(value) || 0);
}

function formatCatalogPrice(entry, quantity = 1) {
  const value = Math.max(0, Number(entry?.unitPriceValue) || 0) * quantity;
  const denomination = CURRENCY_DENOMINATIONS.has(entry?.unitPriceDenomination)
    ? entry.unitPriceDenomination
    : "gp";
  return `${formatNumber(value)} ${denomination}`;
}

function buildDialogContent(targetLabel) {
  return `
    <form class="rm-inventory-item-add-dialog" data-inventory-item-add-form>
      <p class="rm-inventory-item-add-dialog__target">Куда: <strong>${escapeHtml(targetLabel || "склад группы")}</strong></p>
      <label class="rm-field rm-inventory-item-add-dialog__search">
        <span>Название предмета</span>
        <input type="search" data-field="inventory-item-search" autocomplete="off" autofocus placeholder="Введите точное или похожее название">
      </label>
      <div class="rm-inventory-item-add-dialog__status" data-add-catalog-status role="status" aria-live="polite">Загрузка каталога…</div>
      <button type="button" class="rm-button" data-action="retry-add-catalog" hidden>Повторить загрузку</button>
      <div class="rm-inventory-item-add-dialog__results" data-add-catalog-results role="listbox" aria-label="Результаты каталога"></div>
      <label class="rm-inventory-item-add-dialog__manual-toggle" data-add-manual-toggle>
        <input type="checkbox" data-field="inventory-add-manual-mode">
        <span>Добавить как текстовую запись</span>
      </label>
      <section class="rm-inventory-item-add-dialog__manual" data-add-manual-fields hidden>
        <div class="rm-field"><label>Название</label><input type="text" data-field="manual-name" autocomplete="off"></div>
        <div class="rm-inventory-item-add-dialog__manual-grid">
          <div class="rm-field"><label>Вес единицы, фнт.</label><input type="text" inputmode="decimal" value="0" data-field="manual-weight"></div>
          <div class="rm-field"><label>Цена единицы</label><input type="text" inputmode="decimal" value="0" data-field="manual-price"></div>
          <div class="rm-field"><label>Номинал</label><select data-field="manual-denomination"><option value="pp">пм</option><option value="gp" selected>зм</option><option value="sp">см</option><option value="cp">мм</option></select></div>
          <div class="rm-field"><label>Тип</label><input type="text" value="Прочее" data-field="manual-type"></div>
          <div class="rm-field"><label>Материал</label><input type="text" value="" data-field="manual-material"></div>
        </div>
      </section>
      <div class="rm-field rm-inventory-item-add-dialog__quantity"><label>Количество</label><input type="number" min="1" step="1" value="1" data-field="inventory-add-quantity"></div>
      <div class="rm-inventory-item-add-dialog__totals" data-add-totals aria-live="polite"></div>
      <p class="rm-inline-status rm-inline-status--error" data-add-error role="alert" hidden></p>
      <div class="rm-inventory-item-add-dialog__actions">
        <button type="submit" class="rm-button rm-button--primary" data-action="submit-inventory-add">Добавить</button>
        <button type="button" class="rm-button" data-action="cancel-inventory-add">Отмена</button>
      </div>
    </form>`;
}

function resolveDialogRoot(html) {
  if (typeof globalThis.HTMLElement === "function" && html instanceof globalThis.HTMLElement) return html;
  if (typeof globalThis.HTMLElement === "function" && html?.[0] instanceof globalThis.HTMLElement) return html[0];
  return html?.querySelector ? html : null;
}

function createOperationId(prefix) {
  const id = cleanText(globalThis.crypto?.randomUUID?.() ?? globalThis.randomID?.());
  if (!id) throw new Error(`Не удалось создать идентификатор операции ${prefix}.`);
  return `${prefix}-${id}`;
}

export function resolveInventoryAddAttempt(previousAttempt, fingerprint, operationIdFactory = createOperationId) {
  const safeFingerprint = cleanText(fingerprint);
  if (!safeFingerprint) throw new Error("Не удалось определить содержимое операции добавления.");
  if (previousAttempt?.fingerprint === safeFingerprint) return previousAttempt;
  return Object.freeze({
    fingerprint: safeFingerprint,
    batchMutationId: operationIdFactory("inventory-add"),
    manualEntryId: operationIdFactory("manual-entry")
  });
}

export function promptInventoryItemAddition({
  loadCatalog,
  submitCatalogItem,
  submitManualItem,
  targetLabel = "",
  DialogClass = globalThis.Dialog,
  operationIdFactory = createOperationId
} = {}) {
  if (typeof DialogClass !== "function") throw new Error("Диалог добавления предмета недоступен.");
  if (typeof loadCatalog !== "function" || typeof submitCatalogItem !== "function" || typeof submitManualItem !== "function") {
    throw new Error("Диалог добавления предмета настроен не полностью.");
  }
  return new Promise((resolve) => {
    let settled = false;
    let root = null;
    let catalog = [];
    let loadError = "";
    let loading = true;
    let loadRevision = 0;
    let selectedId = "";
    let manualMode = false;
    let submitting = false;
    let attempt = null;

    const element = (selector) => root?.querySelector?.(selector) ?? null;
    const fieldValue = (name) => element(`[data-field='${name}']`)?.value ?? "";
    const setError = (message = "") => {
      const node = element("[data-add-error]");
      if (!node) return;
      node.textContent = cleanText(message);
      node.hidden = !node.textContent;
    };
    const invalidateAttempt = () => { attempt = null; setError(); };

    const currentSearch = () => searchInventoryAddCatalog(catalog, fieldValue("inventory-item-search"));
    const currentSelected = () => catalog.find((entry) => catalogEntryId(entry) === selectedId) ?? null;
    const renderTotals = () => {
      const node = element("[data-add-totals]");
      if (!node) return;
      try {
        const quantity = parsePositiveInteger(fieldValue("inventory-add-quantity") || 1);
        if (manualMode) {
          const unitWeight = parseDecimal(fieldValue("manual-weight") || 0, "Вес");
          const unitPrice = parseDecimal(fieldValue("manual-price") || 0, "Цена");
          const denomination = cleanText(fieldValue("manual-denomination")) || "gp";
          node.textContent = `Итого: ${formatNumber(unitWeight * quantity)} фнт. · ${formatNumber(unitPrice * quantity)} ${denomination}`;
        }
        else {
          const selected = currentSelected();
          node.textContent = selected
            ? `Итого: ${formatNumber((Number(selected.unitWeight) || 0) * quantity)} фнт. · ${formatCatalogPrice(selected, quantity)}`
            : "";
        }
      }
      catch {
        node.textContent = "";
      }
    };

    const renderState = () => {
      if (!root) return;
      const result = currentSearch();
      if (result.exactMatches.length === 1 && !manualMode) selectedId = result.autoSelectedId;
      if (result.exactMatches.length > 1 && !result.exactMatches.some((entry) => entry.id === selectedId)) selectedId = "";
      if (result.exactMatches.length > 0) manualMode = false;
      const status = element("[data-add-catalog-status]");
      const retry = element("[data-action='retry-add-catalog']");
      if (status) {
        status.textContent = loading
          ? "Загрузка каталога…"
          : loadError
            ? loadError
            : result.exactMatches.length > 1
              ? `Найдено ${result.exactMatches.length} точных совпадения. Выберите нужное.`
              : `Точных: ${result.exactMatches.length}; похожих: ${result.similarMatches.length}.`;
      }
      if (retry) retry.hidden = !loadError;
      const rows = [...result.exactMatches, ...result.similarMatches];
      const resultsNode = element("[data-add-catalog-results]");
      if (resultsNode) {
        resultsNode.innerHTML = rows.map((entry) => `
          <button type="button" class="rm-inventory-item-add-result${entry.id === selectedId ? " is-selected" : ""}" data-action="select-inventory-add-result" data-entry-id="${escapeHtml(entry.id)}" role="option" aria-selected="${entry.id === selectedId}">
            <img src="${escapeHtml(entry.img || "icons/svg/item-bag.svg")}" alt="">
            <span><strong>${escapeHtml(entry.name)}</strong><small>${escapeHtml([entry.itemTypeLabel, entry.materialLabel].filter(Boolean).join(" · ") || "Прочее")}</small></span>
            <span class="rm-inventory-item-add-result__metrics"><small>${formatNumber(entry.unitWeight)} фнт.</small><small>${escapeHtml(formatCatalogPrice(entry))}</small></span>
          </button>`).join("") || (!loading && !loadError ? "<p class=\"rm-empty\">Совпадений в каталоге нет.</p>" : "");
      }
      const manualToggle = element("[data-add-manual-toggle]");
      const manualCheckbox = element("[data-field='inventory-add-manual-mode']");
      if (manualToggle) manualToggle.hidden = !result.canAddManual;
      if (manualCheckbox) manualCheckbox.checked = manualMode;
      const manualFields = element("[data-add-manual-fields]");
      if (manualFields) manualFields.hidden = !manualMode;
      const submit = element("[data-action='submit-inventory-add']");
      if (submit) submit.disabled = submitting || loading;
      renderTotals();
    };

    const load = async () => {
      const revision = ++loadRevision;
      loading = true;
      loadError = "";
      renderState();
      try {
        const nextCatalog = await loadCatalog();
        if (revision !== loadRevision) return;
        catalog = Array.isArray(nextCatalog) ? nextCatalog : [];
      }
      catch (error) {
        if (revision !== loadRevision) return;
        loadError = error?.message || "Не удалось загрузить каталог.";
      }
      finally {
        if (revision === loadRevision) {
          loading = false;
          renderState();
        }
      }
    };

    const submit = async () => {
      if (submitting) return;
      setError();
      try {
        const quantity = parsePositiveInteger(fieldValue("inventory-add-quantity"));
        let request;
        if (manualMode) {
          const manual = validateManualInventoryEntry({
            name: fieldValue("manual-name"),
            quantity,
            unitWeight: fieldValue("manual-weight"),
            unitPriceValue: fieldValue("manual-price"),
            unitPriceDenomination: fieldValue("manual-denomination"),
            itemType: fieldValue("manual-type"),
            material: fieldValue("manual-material")
          });
          request = { kind: "manual", manual };
        }
        else {
          const selected = currentSelected();
          if (!selected) throw new Error("Выберите предмет из каталога или включите текстовую запись.");
          request = { kind: "catalog", entry: selected, quantity };
        }
        const fingerprint = JSON.stringify(request.kind === "manual" ? request.manual : {
          sourceType: request.entry.sourceType,
          sourceId: request.entry.sourceId,
          quantity: request.quantity
        });
        attempt = resolveInventoryAddAttempt(attempt, fingerprint, operationIdFactory);
        submitting = true;
        renderState();
        const result = request.kind === "manual"
          ? await submitManualItem({ ...request.manual, manualEntryId: attempt.manualEntryId }, attempt)
          : await submitCatalogItem(request.entry, request.quantity, attempt);
        settled = true;
        dialog.close?.();
        resolve(result);
      }
      catch (error) {
        setError(error?.message || "Не удалось добавить предмет.");
      }
      finally {
        submitting = false;
        renderState();
      }
    };

    const dialog = new DialogClass({
      title: "Добавить предмет",
      content: buildDialogContent(targetLabel),
      buttons: {},
      render: (html) => {
        root = resolveDialogRoot(html);
        const form = element("[data-inventory-item-add-form]");
        form?.addEventListener("submit", (event) => {
          event.preventDefault();
          event.stopPropagation();
          void submit();
        });
        root?.addEventListener?.("click", (event) => {
          const action = event.target?.closest?.("[data-action]")?.dataset?.action;
          if (action === "select-inventory-add-result") {
            selectedId = cleanText(event.target.closest("[data-entry-id]")?.dataset?.entryId);
            manualMode = false;
            invalidateAttempt();
            renderState();
          }
          else if (action === "retry-add-catalog") void load();
          else if (action === "cancel-inventory-add") dialog.close?.();
        });
        element("[data-field='inventory-item-search']")?.addEventListener("input", () => {
          selectedId = "";
          invalidateAttempt();
          renderState();
        });
        element("[data-field='inventory-add-manual-mode']")?.addEventListener("change", (event) => {
          manualMode = event.currentTarget.checked === true;
          if (manualMode && !cleanText(fieldValue("manual-name"))) {
            element("[data-field='manual-name']").value = cleanText(fieldValue("inventory-item-search"));
          }
          invalidateAttempt();
          renderState();
          if (manualMode) element("[data-field='manual-name']")?.focus?.();
        });
        form?.querySelectorAll?.("input, select")?.forEach((input) => {
          if (["inventory-item-search", "inventory-add-manual-mode"].includes(input.dataset?.field)) return;
          input.addEventListener("input", () => { invalidateAttempt(); renderTotals(); });
          input.addEventListener("change", () => { invalidateAttempt(); renderTotals(); });
        });
        renderState();
        element("[data-field='inventory-item-search']")?.focus?.();
        void load();
      },
      close: () => {
        loadRevision += 1;
        if (!settled) resolve(null);
      }
    }, {
      classes: ["rebreya-main", "rebreya-trader-dialog", "rm-inventory-item-add-window"],
      width: 720,
      height: resolveInventoryAddDialogHeight(globalThis.innerHeight)
    });
    dialog.render(true);
  });
}
