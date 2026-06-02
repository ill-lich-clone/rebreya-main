import { MODULE_ID } from "../constants.js";

export const REBREYA_BLOODIED_STATUS_ID = "rebreya-bloodied";
export const REBREYA_DISCREET_STATUS_ID = "rebreya-discreet";
export const REBREYA_FRIGHTENED_STATUS_ID = "frightened";
export const LEGACY_REBREYA_FRIGHTENED_STATUS_ID = "rebreya-frightened";

const STATUS_DEFINITIONS = Object.freeze([
  {
    id: REBREYA_DISCREET_STATUS_ID,
    foundryId: "rbDiscreet",
    key: "discreet",
    label: "Сдержанный",
    icon: "icons/svg/anchor.svg",
    supportsValue: true
  },
  {
    id: REBREYA_FRIGHTENED_STATUS_ID,
    key: "frightened",
    label: "Испуганный",
    icon: "systems/dnd5e/icons/svg/statuses/frightened.svg",
    supportsValue: true
  },
  {
    id: "rebreya-gaseous",
    foundryId: "rbGaseous",
    key: "gaseous",
    label: "Газообразный",
    icon: "systems/dnd5e/icons/svg/statuses/ethereal.svg",
    supportsValue: false
  },
  {
    id: "rebreya-surrounded",
    foundryId: "rbSurround",
    key: "surrounded",
    label: "Окружённый",
    icon: "icons/svg/target.svg",
    supportsValue: false
  },
  {
    id: "rebreya-open-position",
    foundryId: "rbOpenPos",
    key: "openPosition",
    label: "Открытая позиция",
    icon: "icons/svg/unconscious.svg",
    supportsValue: false
  },
  {
    id: "rebreya-entangled-mind",
    foundryId: "rbEntMind",
    key: "entangledMind",
    label: "Запутанный",
    icon: "icons/svg/daze.svg",
    supportsValue: false
  },
  {
    id: "rebreya-frostbitten",
    foundryId: "rbFrost",
    key: "frostbitten",
    label: "Окоченевший",
    icon: "icons/svg/paralysis.svg",
    supportsValue: true
  },
  {
    id: "rebreya-nauseated",
    foundryId: "rbNausea",
    key: "nauseated",
    label: "Тошнота",
    icon: "icons/svg/poison.svg",
    supportsValue: true
  },
  {
    id: "rebreya-hasted",
    foundryId: "rbHasted",
    key: "hasted",
    label: "Ускорен",
    icon: "icons/svg/wing.svg",
    supportsValue: false
  },
  {
    id: "rebreya-slowed",
    foundryId: "rbSlowed",
    key: "slowed",
    label: "Замедлен",
    icon: "icons/svg/hazard.svg",
    supportsValue: false
  },
  {
    id: "rebreya-weakened",
    foundryId: "rbWeak",
    key: "weakened",
    label: "Ослабленный",
    icon: "icons/svg/downgrade.svg",
    supportsValue: true
  },
  {
    id: "rebreya-clumsy",
    foundryId: "rbClumsy",
    key: "clumsy",
    label: "Неуклюжий",
    icon: "icons/svg/falling.svg",
    supportsValue: true
  },
  {
    id: "rebreya-decaying-damage",
    foundryId: "rbDecayDmg",
    key: "decayingDamage",
    label: "Затихающий урон",
    icon: "icons/svg/fire.svg",
    supportsValue: true
  },
  {
    id: "rebreya-charged",
    foundryId: "rbCharged",
    key: "charged",
    label: "Заряженный",
    icon: "icons/svg/lightning.svg",
    supportsValue: false
  },
  {
    id: "rebreya-provoked",
    foundryId: "rbProvoked",
    key: "provoked",
    label: "Спровоцированный",
    icon: "icons/svg/target.svg",
    supportsValue: true
  },
  {
    id: "rebreya-twisted",
    foundryId: "rbTwisted",
    key: "twisted",
    label: "Скрученный",
    icon: "icons/svg/net.svg",
    supportsValue: true
  },
  {
    id: "rebreya-swallowed",
    foundryId: "rbSwallow",
    key: "swallowed",
    label: "Проглоченный",
    icon: "systems/dnd5e/icons/svg/statuses/grappled.svg",
    supportsValue: true
  },
  {
    id: "rebreya-possessed",
    foundryId: "rbPossess",
    key: "possessed",
    label: "Одержимый",
    icon: "icons/svg/skull.svg",
    supportsValue: false
  }
]);

const STATUS_BY_ID = new Map(STATUS_DEFINITIONS.map((row) => [row.id, row]));
const STATUS_ALIAS_TO_ID = new Map();

function buildDnd5eStatusEffectDocumentId(statusId) {
  const rawId = `dnd5e${String(statusId ?? "").trim()}`;
  return rawId.length >= 16 ? rawId.slice(0, 16) : rawId.padEnd(16, "0");
}

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
  registerAlias(row.foundryId, row.id);
  registerAlias(row.key, row.id);
  registerAlias(row.label, row.id);
}

registerAlias("затихающий урон", "rebreya-decaying-damage");
registerAlias("затухающий урон", "rebreya-decaying-damage");
registerAlias("провокация", "rebreya-provoked");
registerAlias("замедление", "rebreya-slowed");
registerAlias("ускорение", "rebreya-hasted");
registerAlias("испуг", REBREYA_FRIGHTENED_STATUS_ID);
registerAlias("испуганный", REBREYA_FRIGHTENED_STATUS_ID);
registerAlias(LEGACY_REBREYA_FRIGHTENED_STATUS_ID, REBREYA_FRIGHTENED_STATUS_ID);
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

  const foundryStatusId = definition.foundryId ?? definition.id;
  const statusConfig = {
    _id: buildDnd5eStatusEffectDocumentId(foundryStatusId),
    id: foundryStatusId,
    name: definition.label,
    img: definition.icon,
    icon: definition.icon,
    flags: {
      [MODULE_ID]: {
        managedStatusConfig: true,
        statusKey: definition.key,
        statusId: definition.id
      }
    }
  };

  if (foundryStatusId !== definition.id) {
    statusConfig.statuses = [definition.id];
  }

  return statusConfig;
}
