const flags = effect => effect?.flags?.["chris-premades"];
const effects = actor => Array.from(actor?.effects?.values?.() ?? []);

export async function releaseMovedCardGrapples(token) {
  if (!token.actor?.isOwner) return false;
  let released = false;
  for (const effect of effects(token.actor)) {
    const role = flags(effect)?.info?.identifier;
    if (role !== "grappled" && role !== "grappling") continue;
    const other = token.document.parent?.tokens?.get(flags(effect).grapple?.tokenId);
    if (!other?.actor || other.actor.uuid === token.actor.uuid) continue;
    const partner = effects(other.actor).find(candidate => candidate.uuid === effect.flags?.dnd5e?.dependentOn);
    if (!partner || partner.flags?.dnd5e?.dependentOn !== effect.uuid || flags(partner)?.grapple?.tokenId !== token.id) continue;
    const holding = role === "grappling" ? effect : partner;
    const held = role === "grappled" ? effect : partner;
    if (flags(holding)?.info?.identifier !== "grappling" || flags(held)?.info?.identifier !== "grappled"
      || holding.origin !== holding.parent?.uuid || held.origin !== holding.origin) continue;
    // dnd5e removes the verified reciprocal dependent when this Actor's effect ends.
    await effect.delete();
    released = true;
  }
  return released;
}
