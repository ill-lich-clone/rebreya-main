import { combatantsOf } from "./turn-group-rules.js";

export function planRebreyaCombatAutomation(moduleApi, combat, phase) {
  const steps = [], members = combatantsOf(combat).filter(c => phase.memberIds.includes(c.id));
  const add = (id, combatantId, run) => steps.push({ id, combatantId, run });
  if (phase.kind === "each-turn") {
    add("race", null, () => moduleApi.raceAutomationService?.handleCombatTurnChange(combat));
    add("weapon-turn", null, () => moduleApi.combatAttackService?.handleGroupedCombatPhase(combat, phase));
    add("smoke-lifetime", null, () => moduleApi.craftsmanGadgetZoneService?.handleGroupedCombatPhase(combat, phase));
    add("gadgets", null, async () => {
      await moduleApi.craftsmanGadgetService?.handleCombatTurnChange?.(combat);
      await moduleApi.craftsmanVehicleService?.handleCombatTurnChange?.(`${combat.id}:${combat.round}:${combat.turn}`);
    });
  }
  if (phase.kind === "turn-start" || phase.kind === "turn-end") for (const c of members) {
    const context = { combatant: c, combatantId: c.id, round: phase.round, turn: combat.turns?.findIndex(member => member.id === c.id) ?? combat.turn };
    const memberPhase = { ...phase, memberIds: [c.id] };
    for (const [id, owner] of Object.entries({ attack: moduleApi.combatAttackService, rune: moduleApi.runeKnightAutomationService,
      curse: moduleApi.curseUpgradeAutomationService, implant: moduleApi.implantAutomationService, smoke: moduleApi.craftsmanGadgetZoneService })) {
      if (owner?.handleGroupedCombatPhase) add(id, c.id, () => owner.handleGroupedCombatPhase(combat, memberPhase));
    }
    if (phase.kind === "turn-start") for (const [id, owner] of Object.entries({ fighter: moduleApi.fighterAutomationService, paladin: moduleApi.paladinAutomationService, sorcerer: moduleApi.sorcererAutomationService })) {
      if (owner?.handleCombatTurnChange) add(id, c.id, () => owner.handleCombatTurnChange(combat, context, { direction: 1 }));
    }
  }
  return steps;
}
