import {
  getStatusReferenceDefinition,
  renderStatusReferenceDescription
} from "../data/status-reference-data.js?v=1.4.316";

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/gu, "&amp;")
    .replace(/</gu, "&lt;")
    .replace(/>/gu, "&gt;")
    .replace(/"/gu, "&quot;")
    .replace(/'/gu, "&#39;");
}

function buildTooltipHtml({
  title = "",
  subtitle = "Состояние",
  icon = "icons/svg/aura.svg",
  descriptionHtml = ""
} = {}) {
  return `
    <section class="content">
      <section class="header">
        <div class="top">
          <img src="${escapeHtml(icon)}" alt="${escapeHtml(title)}">
          <div class="name name-stacked">
            <span class="title">${escapeHtml(title)}</span>
            <span class="subtitle">${escapeHtml(subtitle)}</span>
          </div>
        </div>
      </section>
      <section class="description">${descriptionHtml}</section>
    </section>
  `.trim();
}

function shouldUseCompactStatusTitle(label = "") {
  const safeLabel = String(label ?? "").trim();
  if (!safeLabel) {
    return false;
  }

  const longestWord = safeLabel
    .split(/\s+/u)
    .reduce((max, part) => Math.max(max, part.length), 0);

  return longestWord >= 11 || safeLabel.length >= 18;
}

export function getDnd5eSheetStatusPresentation(statusId, {
  label = "",
  icon = "",
  supportsValue = false
} = {}) {
  const safeStatusId = String(statusId ?? "").trim();
  const safeLabel = String(label ?? "").trim() || safeStatusId;
  if (!safeStatusId && !safeLabel) {
    return null;
  }

  const entry = getStatusReferenceDefinition(safeStatusId);
  const shouldUseRebreyaFallback = safeStatusId.startsWith("rebreya-") || supportsValue === true;
  if (!entry && !shouldUseRebreyaFallback) {
    return null;
  }

  const subtitle = entry?.subtitle
    ?? (safeStatusId.startsWith("rebreya-") || supportsValue ? "Состояние Rebreya" : "Состояние");
  const descriptionHtml = renderStatusReferenceDescription(entry ?? {
    paragraphs: [
      safeStatusId.startsWith("rebreya-") || supportsValue
        ? "Состояние использует правила Rebreya. Точные последствия задаёт наложивший его эффект."
        : "Используйте это состояние по правилам вашего мира и текущей сцены."
    ]
  });

  return {
    label: safeLabel,
    compactLabel: shouldUseCompactStatusTitle(safeLabel),
    tooltipHtml: buildTooltipHtml({
      title: safeLabel,
      subtitle,
      icon: icon || "icons/svg/aura.svg",
      descriptionHtml
    })
  };
}
