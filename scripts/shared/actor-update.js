import { MODULE_ID } from "../constants.js";

const turnFlagPath = new RegExp(`^flags\\.${MODULE_ID}\\.(?:==)?(?:weaponModMovement|reactionState)(?:\\..+)?$`, "u");
const flagContainers = new Set(["flags", `flags.${MODULE_ID}`, "flags.midi-qol", "flags.midi-qol.actions"]);

function onlyTurnFlags(changed, prefix) {
  if (!changed || typeof changed !== "object" || Array.isArray(changed)) return false;
  const fields = Object.entries(changed).filter(([key]) =>
    prefix || (key !== "_id" && key !== "_stats" && !key.startsWith("_stats."))
  );
  return fields.length > 0 && fields.every(([key, value]) => {
    const path = prefix + key;
    if (turnFlagPath.test(path) || path === "flags.midi-qol.actions.action") return true;
    return flagContainers.has(path) && onlyTurnFlags(value, `${path}.`);
  });
}

export function isTurnFlagOnlyUpdate(changed) {
  return onlyTurnFlags(changed, "");
}
