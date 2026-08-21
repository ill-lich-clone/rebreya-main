export const BROKEN_ITEM_NAME_SUFFIX = " (сломан)";

const BROKEN_ITEM_NAME_PATTERN = /\s*\(сломан\)$/iu;

export function formatDurabilityItemName(name, durability = null) {
  const source = String(name ?? "").trim();
  if (!source || !durability || typeof durability !== "object") return source;
  const baseName = source.replace(BROKEN_ITEM_NAME_PATTERN, "").trim() || source;
  const state = String(durability.state ?? "").trim().toLowerCase();
  return durability.eligible !== false && ["broken", "destroyed"].includes(state)
    ? `${baseName}${BROKEN_ITEM_NAME_SUFFIX}`
    : baseName;
}
