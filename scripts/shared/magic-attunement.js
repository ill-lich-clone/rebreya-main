export function formatMagicAttunement(value) {
  const text = String(value ?? "").trim();
  if (!text || text === "0" || /^\?+(?:\s+\?+)*$/u.test(text)) return "";
  return text === "1" ? "Требуется" : text;
}
