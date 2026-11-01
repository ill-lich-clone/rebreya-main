/** Extend dnd5e's canonical dice steps without replacing its shared array. */
export function registerExtendedDamageDice(config = globalThis.CONFIG?.DND5E) {
  const steps = config?.dieSteps;
  if (!Array.isArray(steps)) return false;
  for (const faces of [2, 3]) {
    if (steps.includes(faces)) continue;
    const index = steps.findIndex(step => Number(step) > faces);
    steps.splice(index < 0 ? steps.length : index, 0, faces);
  }
  return true;
}
