import { MODULE_ID } from "../constants.js";

export const REBREYA_BLOODIED_STATUS_ID = "rebreya-bloodied";
export const REBREYA_DISCREET_STATUS_ID = "rebreya-discreet";

const STATUS_DEFINITIONS = Object.freeze([
  {
    id: REBREYA_DISCREET_STATUS_ID,
    key: "discreet",
    label: "Сдержанный",
    icon: "icons/svg/anchor.svg",
    supportsValue: true
  },
  {
    id: "rebreya-frightened",
    key: "frightened",
    label: "Испуг",
    icon: "systems/dnd5e/icons/svg/statuses/frightened.svg",
    supportsValue: true
  },
  {
    id: "rebreya-gaseous",
    key: "gaseous",
    label: "Газообразный",
    icon: "systems/dnd5e/icons/svg/statuses/ethereal.svg",
    supportsValue: false
  },
  {
    id: "rebreya-surrounded",
    key: "surrounded",
    label: "Окружённый",
    icon: "icons/svg/target.svg",
    supportsValue: false
  },
  {
    id: "rebreya-open-position",
    key: "openPosition",
    label: "Открытая позиция",
    icon: "icons/svg/unconscious.svg",
    supportsValue: false
  },
  {
    id: "rebreya-entangled-mind",
    key: "entangledMind",
    label: "Запутанный",
    icon: "icons/svg/daze.svg",
    supportsValue: false
  },
  {
    id: "rebreya-frostbitten",
    key: "frostbitten",
    label: "Окоченевший",
    icon: "icons/svg/paralysis.svg",
    supportsValue: true
  },
  {
    id: "rebreya-nauseated",
    key: "nauseated",
    label: "Тошнота",
    icon: "icons/svg/poison.svg",
    supportsValue: true
  },
  {
    id: "rebreya-hasted",
    key: "hasted",
    label: "Ускорен",
    icon: "icons/svg/wing.svg",
    supportsValue: false
  },
  {
    id: "rebreya-slowed",
    key: "slowed",
    label: "Замедлен",
    icon: "icons/svg/hazard.svg",
    supportsValue: false
  },
  {
    id: "rebreya-weakened",
    key: "weakened",
    label: "Ослабленный",
    icon: "icons/svg/downgrade.svg",
    supportsValue: true
  },
  {
    id: "rebreya-clumsy",
    key: "clumsy",
    label: "Неуклюжий",
    icon: "icons/svg/falling.svg",
    supportsValue: true
  },
  {
    id: "rebreya-decaying-damage",
    key: "decayingDamage",
    label: "Затихающий урон",
    icon: "icons/svg/fire.svg",
    supportsValue: true
  },
  {
    id: "rebreya-charged",
    key: "charged",
    label: "Заряженный",
    icon: "icons/svg/lightning.svg",
    supportsValue: false
  },
  {
    id: "rebreya-provoked",
    key: "provoked",
    label: "Спровоцированный",
    icon: "icons/svg/target.svg",
    supportsValue: true
  },
  {
    id: "rebreya-twisted",
    key: "twisted",
    label: "Скрученный",
    icon: "icons/svg/net.svg",
    supportsValue: true
  },
  {
    id: "rebreya-swallowed",
    key: "swallowed",
    label: "Проглоченный",
    icon: "systems/dnd5e/icons/svg/statuses/grappled.svg",
    supportsValue: true
  },
  {
    id: "rebreya-possessed",
    key: "possessed",
    label: "Одержимый",
    icon: "icons/svg/skull.svg",
    supportsValue: false
  }
]);

const STATUS_BY_ID = new Map(STATUS_DEFINITIONS.map((row) => [row.id, row]));
const STATUS_ALIAS_TO_ID = new Map();

function normalizeLookupText(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/['\u2019\u2018\u02BC\u02B9\u2032"\u201C\u201D\u00AB\u00BB]/gu, "")
    .replace(/[_\-\s]+/gu, " ")
    .replace(/\s+/gu, " ");
}

function registerAlias(alias, statusId) {
  const normalized = normalizeLookupText(alias);
  if (!normalized || !statusId) {
    return;
  }

  STATUS_ALIAS_TO_ID.set(normalized, statusId);
}

for (const row of STATUS_DEFINITIONS) {
  registerAlias(row.id, row.id);
  registerAlias(row.key, row.id);
  registerAlias(row.label, row.id);
}

registerAlias("затихающий урон", "rebreya-decaying-damage");
registerAlias("затухающий урон", "rebreya-decaying-damage");
registerAlias("провокация", "rebreya-provoked");
registerAlias("замедление", "rebreya-slowed");
registerAlias("ускорение", "rebreya-hasted");
registerAlias("испуг", "rebreya-frightened");
registerAlias("испуганный", "rebreya-frightened");
registerAlias("сдержанный", REBREYA_DISCREET_STATUS_ID);
registerAlias("rebreya-restrained", REBREYA_DISCREET_STATUS_ID);
registerAlias("газообразный", "rebreya-gaseous");

export const REBREYA_STATUS_DEFINITIONS = STATUS_DEFINITIONS.map((row) => ({ ...row }));

export function normalizeRebreyaStatusId(value, fallback = "") {
  const normalized = normalizeLookupText(value);
  if (!normalized) {
    return fallback;
  }

  return STATUS_ALIAS_TO_ID.get(normalized) ?? fallback;
}

export function getRebreyaStatusDefinition(statusId) {
  const resolvedId = normalizeRebreyaStatusId(statusId, String(statusId ?? "").trim());
  const row = STATUS_BY_ID.get(resolvedId);
  return row ? { ...row } : null;
}

export function buildRebreyaStatusConfig(statusId) {
  const definition = getRebreyaStatusDefinition(statusId);
  if (!definition) {
    return null;
  }

  return {
    id: definition.id,
    name: definition.label,
    img: definition.icon,
    icon: definition.icon,
    flags: {
      [MODULE_ID]: {
        managedStatusConfig: true,
        statusKey: definition.key
      }
    }
  };
}
