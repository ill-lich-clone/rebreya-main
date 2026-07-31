import { MODULE_ID } from "../constants.js";

const DASH = "—";
const POUNDS_PER_TON = 2000;
const TRANSPORT_VERSION = 1;
const DOCUMENT_ID_PATTERN = /^lchtransport\d{4}$/u;
const SIGNATURE_FIELDS = Object.freeze([
  "sourceId",
  "documentId",
  "sourceRow",
  "name",
  "inventionYear",
  "type",
  "price",
  "rentalPrice",
  "rank",
  "weight",
  "hp",
  "ac",
  "combatSpeed",
  "acceleration",
  "travelSpeed",
  "breakdownThreshold",
  "consumption",
  "crew",
  "passengers",
  "strength",
  "size",
  "cargoCapacity",
  "description"
]);

const TYPE_ARTWORK = Object.freeze({
  "Скакун": "icons/svg/pawprint.svg",
  "Водный транспорт": "icons/svg/anchor.svg",
  "Воздушный транспорт": "icons/svg/wing.svg",
  "Механический транспорт": "icons/svg/clockwork.svg"
});

const SIZE_IDS = Object.freeze({
  "Крошечный": "tiny",
  "Маленький": "sm",
  "Средний": "med",
  "Большой": "lg",
  "Огромный": "huge",
  "Громадный": "grg"
});

function cleanText(value) {
  return String(value ?? "").trim();
}

function isMissing(value) {
  const clean = cleanText(value);
  return clean === "" || clean === DASH || clean === "-";
}

function parseLocalizedNumber(value) {
  const clean = cleanText(value)
    .replace(/\s+/gu, "")
    .replace(",", ".");
  if (!clean) return null;
  const fraction = clean.match(/^(-?\d+)\/(\d+)$/u);
  if (fraction) {
    const denominator = Number(fraction[2]);
    return denominator === 0 ? null : Number(fraction[1]) / denominator;
  }
  const number = Number(clean);
  return Number.isFinite(number) ? number : null;
}

function firstNumber(value) {
  const match = cleanText(value).match(/-?\d+(?:[.,]\d+)?(?:\/\d+)?/u);
  return match ? parseLocalizedNumber(match[0]) : null;
}

function parseOptionalNumber(value) {
  return isMissing(value) ? null : firstNumber(value);
}

function requireStableId(value, label) {
  const clean = cleanText(value);
  if (!clean) throw new TypeError(`Transport ${label} is required`);
  return clean;
}

function requireDocumentId(value) {
  const clean = requireStableId(value, "documentId");
  if (!DOCUMENT_ID_PATTERN.test(clean)) {
    throw new TypeError(`Invalid transport documentId: ${clean}`);
  }
  return clean;
}

function parsePrice(value) {
  if (isMissing(value)) return { value: null, denomination: "gp", raw: cleanText(value) };
  const amount = firstNumber(value);
  const clean = cleanText(value).toLowerCase();
  const denomination = clean.includes("мм")
    ? "cp"
    : clean.includes("см")
      ? "sp"
      : clean.includes("эм")
        ? "ep"
        : clean.includes("пм")
          ? "pp"
          : "gp";
  return { value: amount, denomination, raw: cleanText(value) };
}

function parseTravelSpeed(value) {
  return {
    value: isMissing(value) ? null : firstNumber(value),
    units: "mi",
    raw: cleanText(value)
  };
}

function parseConsumption(value, typeLabel) {
  const raw = cleanText(value);
  if (isMissing(raw)) {
    return { kind: "none", resource: "", amount: null, unit: "", cadence: "", raw };
  }
  const lower = raw.toLowerCase();
  const amount = firstNumber(raw);
  const unit = lower.includes("галлон")
    ? "gal"
    : lower.includes("фнт")
      ? "lb"
      : "";
  const resource = lower.includes("жидкий уголь")
    ? "Жидкий уголь"
    : lower.includes("уголь")
      ? "Уголь"
      : typeLabel === "Скакун"
        ? "Корм"
        : "";
  return {
    kind: typeLabel === "Скакун" ? "feed" : "fuel",
    resource,
    amount,
    unit,
    cadence: typeLabel === "Скакун" ? "day" : "mile",
    raw
  };
}

function movementMode(typeLabel) {
  if (typeLabel === "Водный транспорт") return "swim";
  if (typeLabel === "Воздушный транспорт") return "fly";
  return "walk";
}

function travelMode(typeLabel) {
  if (typeLabel === "Водный транспорт") return "water";
  if (typeLabel === "Воздушный транспорт") return "air";
  return "land";
}

function fnv1a(value) {
  let hash = 0x811c9dc5;
  for (const char of String(value)) {
    hash ^= char.codePointAt(0);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function buildTransportSignature(entry) {
  const source = Object.fromEntries(SIGNATURE_FIELDS.map((field) => [
    field,
    entry.source?.[field] ?? entry[field] ?? ""
  ]));
  return `transport-v${TRANSPORT_VERSION}:${fnv1a(JSON.stringify(source))}`;
}

function actorAbility(value) {
  return {
    value,
    proficient: 0,
    bonuses: { check: "", save: "" },
    max: null
  };
}

function buildDescription(entry) {
  if (!entry.description) return "";
  return `<p>${entry.description}</p>`;
}

export function parseTransportWeight(value) {
  const raw = cleanText(value);
  if (isMissing(raw)) return { value: null, units: "lb", raw };
  const amount = firstNumber(raw);
  if (amount == null) return { value: null, units: "lb", raw };
  return {
    value: /тонн/iu.test(raw) ? amount * POUNDS_PER_TON : amount,
    units: "lb",
    raw
  };
}

export function parseTransportCapacity(value) {
  const raw = cleanText(value);
  if (isMissing(raw)) {
    return { cargoCapacityLb: null, towedCapacityLb: null, raw };
  }
  const numbers = raw.match(/\d+(?:[.,]\d+)?/gu)?.map(parseLocalizedNumber).filter(Number.isFinite) ?? [];
  const multiplier = /тонн/iu.test(raw) ? POUNDS_PER_TON : 1;
  return {
    cargoCapacityLb: numbers[0] == null ? null : numbers[0] * multiplier,
    towedCapacityLb: numbers[1] == null ? null : numbers[1] * multiplier,
    raw
  };
}

export function parseTransportSpeed(value) {
  const raw = cleanText(value);
  if (isMissing(raw)) return { primaryFt: null, secondaryFt: null, raw };
  const numbers = raw.match(/\d+(?:[.,]\d+)?/gu)?.map(parseLocalizedNumber).filter(Number.isFinite) ?? [];
  return {
    primaryFt: numbers[0] ?? null,
    secondaryFt: numbers[1] ?? null,
    raw
  };
}

export function normalizeTransportEntry(raw = {}, index = 0) {
  const source = Object.fromEntries(Object.entries(raw).map(([key, value]) => [
    key,
    typeof value === "string" ? value.trim() : value
  ]));
  const typeLabel = cleanText(source.type);
  const hpMax = parseOptionalNumber(source.hp);
  const capacity = parseTransportCapacity(source.cargoCapacity);
  return {
    ...source,
    sourceId: requireStableId(source.sourceId, "sourceId"),
    documentId: requireDocumentId(source.documentId),
    sourceRow: Number(source.sourceRow) || index + 3,
    name: requireStableId(source.name, "name"),
    typeLabel,
    defaultGroupRole: typeLabel === "Скакун" ? "mount" : "transport",
    hpMax,
    ac: parseOptionalNumber(source.ac),
    crewMax: parseOptionalNumber(source.crew),
    passengerMax: parseOptionalNumber(source.passengers),
    strength: parseOptionalNumber(source.strength),
    rank: parseOptionalNumber(source.rank),
    breakdownThreshold: parseOptionalNumber(source.breakdownThreshold),
    combatSpeed: parseTransportSpeed(source.combatSpeed),
    accelerationFt: parseOptionalNumber(source.acceleration),
    travelSpeed: parseTravelSpeed(source.travelSpeed),
    weight: parseTransportWeight(source.weight),
    priceData: parsePrice(source.price),
    rentalPriceData: parsePrice(source.rentalPrice),
    feedOrFuel: parseConsumption(source.consumption, typeLabel),
    ...capacity,
    source
  };
}

export function resolveTransportDefaultArtwork(typeLabel) {
  return TYPE_ARTWORK[cleanText(typeLabel)] ?? "icons/svg/clockwork.svg";
}

export function buildTransportActorData(rawEntry) {
  const entry = normalizeTransportEntry(rawEntry);
  const hp = entry.hpMax == null
    ? { value: 0, max: 0, temp: 0, tempmax: 0, formula: "" }
    : { value: entry.hpMax, max: entry.hpMax, temp: 0, tempmax: 0, formula: "" };
  if (entry.breakdownThreshold != null) hp.mt = entry.breakdownThreshold;

  const artwork = resolveTransportDefaultArtwork(entry.typeLabel);
  const movement = {
    burrow: 0,
    climb: 0,
    fly: 0,
    swim: 0,
    walk: 0,
    units: "ft",
    hover: false
  };
  if (entry.combatSpeed.primaryFt != null) {
    movement[movementMode(entry.typeLabel)] = entry.combatSpeed.primaryFt;
  }

  const travelSpeeds = {};
  if (entry.travelSpeed.value != null) {
    travelSpeeds[travelMode(entry.typeLabel)] = entry.travelSpeed.value;
  }

  const cargo = { units: "lb" };
  if (entry.cargoCapacityLb != null) cargo.value = entry.cargoCapacityLb;

  const system = {
    abilities: {},
    attributes: {
      ac: { calc: "flat", flat: entry.ac ?? 0 },
      hp,
      capacity: { cargo },
      movement,
      travel: { speeds: travelSpeeds, units: "mi" }
    },
    crew: { value: 0, max: entry.crewMax ?? 0 },
    passengers: { value: 0, max: entry.passengerMax ?? 0 },
    details: {
      type: entry.typeLabel,
      biography: { value: buildDescription(entry), public: "" },
      source: {
        book: "Ребрея: Оружие, огнестрел и снаряжение",
        page: `Транспорт V0.1, строка ${entry.sourceRow}`,
        custom: "",
        revision: TRANSPORT_VERSION
      }
    },
    traits: {
      size: SIZE_IDS[cleanText(entry.size)] ?? "",
      weight: {
        value: entry.weight.value,
        units: entry.weight.units
      }
    },
    price: {
      value: entry.priceData.value ?? 0,
      denomination: entry.priceData.denomination
    }
  };
  if (entry.strength != null) system.abilities.str = actorAbility(entry.strength);

  return {
    _id: entry.documentId,
    name: entry.name,
    type: "vehicle",
    img: artwork,
    ownership: { default: 0 },
    flags: {
      [MODULE_ID]: {
        managed: true,
        sourceId: entry.sourceId,
        signature: buildTransportSignature(entry),
        transport: {
          version: TRANSPORT_VERSION,
          sourceId: entry.sourceId,
          sourceRow: entry.sourceRow,
          instance: false,
          defaultGroupRole: entry.defaultGroupRole,
          rank: entry.rank,
          inventionYear: entry.inventionYear,
          rentalPrice: entry.rentalPriceData,
          combatSpeed: entry.combatSpeed,
          accelerationFt: entry.accelerationFt,
          travelSpeed: entry.travelSpeed,
          breakdownThreshold: entry.breakdownThreshold,
          consumption: entry.feedOrFuel,
          cargoCapacityLb: entry.cargoCapacityLb,
          towedCapacityLb: entry.towedCapacityLb,
          raw: {
            weight: entry.weight.raw,
            hp: entry.source.hp,
            ac: entry.source.ac,
            price: entry.source.price,
            rentalPrice: entry.source.rentalPrice,
            size: entry.source.size,
            crew: entry.source.crew,
            passengers: entry.source.passengers,
            strength: entry.source.strength,
            description: entry.source.description
          }
        }
      }
    },
    prototypeToken: {
      name: entry.name,
      actorLink: true,
      disposition: 1,
      texture: { src: artwork },
      width: 1,
      height: 1,
      displayName: 20,
      displayBars: 20,
      bar1: { attribute: "attributes.hp" }
    },
    system,
    items: [],
    effects: []
  };
}
