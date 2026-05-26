function cleanString(value) {
  return String(value ?? "").trim();
}

function hash32(value) {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }

  return (hash >>> 0).toString(16).padStart(8, "0");
}

export function createStableGearDocumentId(gearId) {
  const seed = cleanString(gearId) || "gear";
  return `r${hash32(`gear:${seed}`)}${hash32(`rebreya:${seed}`)}`.slice(0, 16);
}
