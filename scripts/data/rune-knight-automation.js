const RUNE_SAVE_DC = "8 + @prof + @abilities.con.mod";

export const RUNE_KNIGHT_AUTOMATION_IDS = Object.freeze({
  bonusProficiencies: "rb_18bu0at",
  runeCarver: "rb_u2n3lx",
  giantMight: "rb_11bq5jy",
  runicShield: "rb_1n0gnxz",
  greatStature: "rb_1fn5ecu",
  masterOfRunes: "rb_hxk9fo",
  runicJuggernaut: "rb_1et55f3",
  runes: Object.freeze({
    stone: "rune-knight",
    frost: "rune-knight-2",
    cloud: "rune-knight-3",
    fire: "rune-knight-4",
    hill: "rune-knight-5",
    storm: "rune-knight-6"
  })
});

const SHORT_OR_LONG_REST = Object.freeze([
  Object.freeze({ period: "sr", type: "recoverAll", formula: "" }),
  Object.freeze({ period: "lr", type: "recoverAll", formula: "" })
]);

const LONG_REST = Object.freeze([
  Object.freeze({ period: "lr", type: "recoverAll", formula: "" })
]);

function freezeAutomation(specification) {
  return Object.freeze({
    ...specification,
    save: specification.save ? Object.freeze({ ...specification.save }) : null,
    recovery: Object.freeze((specification.recovery ?? []).map((entry) => Object.freeze({ ...entry }))),
    passive: specification.passive ? Object.freeze({ ...specification.passive }) : null
  });
}

const RUNE_AUTOMATION = Object.freeze({
  stone: freezeAutomation({
    kind: "rune",
    id: "stone",
    sourceId: RUNE_KNIGHT_AUTOMATION_IDS.runes.stone,
    activation: "reaction",
    trigger: "creature-turn-end",
    range: 30,
    duration: { value: 1, units: "minute" },
    save: { ability: "wis", dc: RUNE_SAVE_DC },
    usesMax: "1",
    recovery: SHORT_OR_LONG_REST,
    runtimeManagedPayment: true,
    passive: { insightAdvantage: true, darkvision: 120 }
  }),
  frost: freezeAutomation({
    kind: "rune",
    id: "frost",
    sourceId: RUNE_KNIGHT_AUTOMATION_IDS.runes.frost,
    activation: "bonus",
    trigger: "manual",
    range: null,
    duration: { value: 10, units: "minute" },
    save: { ability: "", dc: RUNE_SAVE_DC },
    usesMax: "1",
    recovery: SHORT_OR_LONG_REST,
    runtimeManagedPayment: true,
    passive: { animalHandlingAdvantage: true, performanceAdvantage: true }
  }),
  cloud: freezeAutomation({
    kind: "rune",
    id: "cloud",
    sourceId: RUNE_KNIGHT_AUTOMATION_IDS.runes.cloud,
    activation: "reaction",
    trigger: "attack-hit",
    range: 30,
    duration: { value: "", units: "inst" },
    save: { ability: "", dc: RUNE_SAVE_DC },
    usesMax: "1",
    recovery: SHORT_OR_LONG_REST,
    runtimeManagedPayment: true,
    passive: { sleightOfHandAdvantage: true, deceptionAdvantage: true }
  }),
  fire: freezeAutomation({
    kind: "rune",
    id: "fire",
    sourceId: RUNE_KNIGHT_AUTOMATION_IDS.runes.fire,
    activation: "special",
    trigger: "weapon-hit",
    range: null,
    duration: { value: 1, units: "minute" },
    save: { ability: "str", dc: RUNE_SAVE_DC },
    usesMax: "1",
    recovery: SHORT_OR_LONG_REST,
    runtimeManagedPayment: true,
    passive: { toolExpertise: true }
  }),
  hill: freezeAutomation({
    kind: "rune",
    id: "hill",
    sourceId: RUNE_KNIGHT_AUTOMATION_IDS.runes.hill,
    activation: "bonus",
    trigger: "manual",
    range: null,
    duration: { value: 1, units: "minute" },
    save: { ability: "", dc: RUNE_SAVE_DC },
    usesMax: "1",
    recovery: SHORT_OR_LONG_REST,
    runtimeManagedPayment: true,
    passive: { poisonSaveAdvantage: true, poisonResistance: true }
  }),
  storm: freezeAutomation({
    kind: "rune",
    id: "storm",
    sourceId: RUNE_KNIGHT_AUTOMATION_IDS.runes.storm,
    activation: "bonus",
    trigger: "manual",
    range: 60,
    duration: { value: 1, units: "minute" },
    save: { ability: "", dc: RUNE_SAVE_DC },
    usesMax: "1",
    recovery: SHORT_OR_LONG_REST,
    runtimeManagedPayment: true,
    passive: { arcanaAdvantage: true, cannotBeSurprised: true }
  })
});

const FEATURE_AUTOMATION = Object.freeze({
  [RUNE_KNIGHT_AUTOMATION_IDS.bonusProficiencies]: freezeAutomation({
    kind: "feature",
    id: "bonus-proficiencies",
    sourceId: RUNE_KNIGHT_AUTOMATION_IDS.bonusProficiencies,
    recovery: []
  }),
  [RUNE_KNIGHT_AUTOMATION_IDS.runeCarver]: freezeAutomation({
    kind: "feature",
    id: "rune-carver",
    sourceId: RUNE_KNIGHT_AUTOMATION_IDS.runeCarver,
    recovery: []
  }),
  [RUNE_KNIGHT_AUTOMATION_IDS.giantMight]: freezeAutomation({
    kind: "feature",
    id: "giant-might",
    sourceId: RUNE_KNIGHT_AUTOMATION_IDS.giantMight,
    activation: "bonus",
    trigger: "manual",
    range: null,
    duration: { value: 1, units: "minute" },
    usesMax: "@prof",
    recovery: LONG_REST,
    runtimeManagedPayment: true
  }),
  [RUNE_KNIGHT_AUTOMATION_IDS.runicShield]: freezeAutomation({
    kind: "feature",
    id: "runic-shield",
    sourceId: RUNE_KNIGHT_AUTOMATION_IDS.runicShield,
    activation: "reaction",
    trigger: "attack-hit",
    range: 60,
    duration: { value: "", units: "inst" },
    usesMax: "@prof",
    recovery: LONG_REST,
    runtimeManagedPayment: true
  }),
  [RUNE_KNIGHT_AUTOMATION_IDS.greatStature]: freezeAutomation({
    kind: "feature",
    id: "great-stature",
    sourceId: RUNE_KNIGHT_AUTOMATION_IDS.greatStature,
    recovery: []
  }),
  [RUNE_KNIGHT_AUTOMATION_IDS.masterOfRunes]: freezeAutomation({
    kind: "feature",
    id: "master-of-runes",
    sourceId: RUNE_KNIGHT_AUTOMATION_IDS.masterOfRunes,
    recovery: []
  }),
  [RUNE_KNIGHT_AUTOMATION_IDS.runicJuggernaut]: freezeAutomation({
    kind: "feature",
    id: "runic-juggernaut",
    sourceId: RUNE_KNIGHT_AUTOMATION_IDS.runicJuggernaut,
    recovery: []
  })
});

function featureSourceId(feature) {
  return String(feature?.featureId ?? feature?.sourceId ?? "").split("::").at(-1);
}

export function getRuneKnightRuneAutomation(feature) {
  if (feature?.sourceType !== "runeKnightRune") {
    return null;
  }

  const sourceId = featureSourceId(feature);
  return Object.values(RUNE_AUTOMATION).find((entry) => entry.sourceId === sourceId) ?? null;
}

export function getRuneKnightFeatureAutomation(feature) {
  if (feature?.sourceType !== "subclassFeature") {
    return null;
  }

  return FEATURE_AUTOMATION[featureSourceId(feature)] ?? null;
}
