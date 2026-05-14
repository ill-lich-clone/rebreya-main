// Foundry macro: repair Barbarian (rework) HP advancement on specific actors.
// Usage: create a Script macro and paste this file contents.

(async () => {
  const ACTOR_IDS = [
    "Actor.Qs9MEdlcRaehl0WI",
    "Actor.wyiIRGPeBnPY7zCt",
    "Actor.2ufsppXnHk5qc40E"
  ];

  if (!game.user?.isGM) {
    ui.notifications?.warn("GM permissions are required.");
    return;
  }

  const api = game.rebreyaMain;
  if (!api?.repairBarbarianHitPoints) {
    ui.notifications?.error("rebreya-main API is unavailable. Reload world and ensure module is enabled.");
    return;
  }

  const result = await api.repairBarbarianHitPoints(ACTOR_IDS);
  console.log("rebreya-main | repairBarbarianHitPoints", result);

  if (!result) {
    ui.notifications?.warn("HP repair did not run.");
    return;
  }

  const summary = [
    `scanned=${result.scanned ?? 0}`,
    `updatedItems=${result.updatedItems ?? 0}`,
    `updatedActors=${result.updatedActors ?? 0}`,
    `failures=${result.failures ?? 0}`
  ].join(", ");

  const missing = Array.isArray(result.missingActorIds) && result.missingActorIds.length
    ? ` Missing/without barbarian class: ${result.missingActorIds.join(", ")}`
    : "";

  ui.notifications?.info(`Barbarian HP repair complete: ${summary}.${missing}`);
})().catch((error) => {
  console.error("rebreya-main | Barbarian HP repair macro failed", error);
  ui.notifications?.error("Barbarian HP repair failed. See console for details.");
});
