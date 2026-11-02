import { MODULE_ID, SPELLS_COMPENDIUM_NAME } from "../constants.js";

export const ANTAGONIZE_DOCUMENT_ID = "rbrAntagonize001";
export const ANTAGONIZE_UUID = `Compendium.world.${SPELLS_COMPENDIUM_NAME}.Item.${ANTAGONIZE_DOCUMENT_ID}`;
const LEGACY_UUID = "Compendium.chris-premades.CPRSpells.Item.bJRgW6qhbNU3KgoR";
const DESCRIPTION =
  "<p>Цель в пределах 30 футов совершает спасбросок Мудрости. При провале она получает 4к4 психического урона и должна немедленно потратить реакцию на рукопашную атаку по другому существу, которое выбрал и видит заклинатель. Если атака невозможна, цель получает помеху на следующий бросок атаки до начала следующего хода заклинателя.</p><p>При успехе цель получает только половину урона. Каждый уровень ячейки выше 3-го добавляет 1к4 урона.</p>";

export function buildAntagonizeSpellItem() {
  const saveId = "dnd5eactivity000";
  return {
    _id: ANTAGONIZE_DOCUMENT_ID,
    name: "Враждебность / Antagonize",
    type: "spell",
    img: "icons/magic/control/debuff-energy-hold-levitate-teal-blue.webp",
    ownership: { default: 2 },
    system: {
      identifier: "antagonize",
      level: 3,
      school: "enc",
      source: { custom: "The Book of Many Things", page: "50", rules: "2014" },
      description: { value: DESCRIPTION, chat: "" },
      activation: { type: "action", value: 1 },
      duration: { units: "inst" },
      range: { value: "30", units: "ft" },
      target: { affects: { type: "creature", count: "1" } },
      properties: ["vocal", "somatic", "material"],
      activities: {
        [saveId]: {
          _id: saveId,
          type: "save",
          consumption: { spellSlot: true, targets: [] },
          save: { ability: ["wis"], dc: { calculation: "spellcasting", formula: "8 + @mod + @prof" } },
          damage: {
            onSave: "half",
            parts: [
              {
                number: 4,
                denomination: 4,
                types: ["psychic"],
                bonus: "",
                scaling: { mode: "whole", number: 1, formula: "" }
              }
            ]
          }
        }
      }
    },
    effects: [],
    flags: {
      [MODULE_ID]: { managed: true, spellId: "antagonize-rebreya" },
      "chris-premades": {
        info: { identifier: "antagonize", name: "Antagonize" },
        macros: { midi: { item: ["antagonize"] } }
      }
    }
  };
}

// The system deletes a cast's old cache when spell.uuid changes. Rebind the matching
// cache first so dnd5e finds the existing Item when it reconciles the updated mantle.
export async function prepareAntagonizeCastMigration(actor, mantle, update, fromUuid = globalThis.fromUuid) {
  const cast = update.system?.activities?.r4dqh51772ngy000;
  if (cast?.type !== "cast" || !cast.spell?.uuid) return;
  const relativeUuid = `.Item.${mantle.id}.Activity.${cast._id}`;
  const items = Array.from(actor.items?.contents ?? actor.items?.values?.() ?? actor.items ?? []);
  const caches = items.filter((item) => item.type === "spell" && item.flags?.dnd5e?.cachedFor === relativeUuid);
  const old = caches.find((item) => item._stats?.compendiumSource === LEGACY_UUID);
  if (
    !old &&
    (mantle.system?.activities?.get?.(cast._id)?.spell?.uuid ?? mantle.system?.activities?.[cast._id]?.spell?.uuid) ===
      cast.spell.uuid
  )
    return;
  const source = await fromUuid(cast.spell.uuid);
  if (source?.flags?.[MODULE_ID]?.spellId !== "antagonize-rebreya") throw new Error("Missing local Antagonize spell");
  if (!old) return;
  if (caches.length !== 1) throw new Error("Ambiguous cached Antagonize spells");
  const patch = { _id: old.id, "_stats.compendiumSource": source.uuid };
  if (!old.system?.description?.value) patch["system.description.value"] = source.system.description.value;
  await actor.updateEmbeddedDocuments("Item", [patch]);
  if ((actor.items.get?.(old.id) ?? old)._stats?.compendiumSource !== source.uuid) {
    throw new Error("Could not rebind the cached Antagonize spell");
  }
}
