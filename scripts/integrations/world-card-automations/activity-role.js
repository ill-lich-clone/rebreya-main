// A saved Heat Metal variant has authored damage activities in place of CPR's utility triggers.
const heatMetalRoles = {
  "2jWlvr2titPfBMEm": ["heatMetal", "damage"],
  YPEmwJHX7g68307N: ["heatMetalPulse", "damage"],
  dnd5eactivity000: ["heatMetalHeld", "save"]
};

export function cardActivityRole(activity) {
  const flags = activity?.item?.flags?.["chris-premades"];
  const mapped = Object.entries(flags?.activityIdentifiers ?? {}).find(([, id]) => id === activity.id);
  if (mapped) return mapped[0];
  if (flags?.info?.identifier !== "heatMetal") return;
  const variant = heatMetalRoles[activity.id];
  if (variant?.[1] === activity.type) return variant[0];
}
