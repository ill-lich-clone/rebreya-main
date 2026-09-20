import {
  ACTIONS_COMPENDIUM_NAME,
  FEATS_COMPENDIUM_NAME,
  GLOSSARY_COMPENDIUM_NAME,
  MODULE_ID
} from "../constants.js";
import { buildFeatReferenceMatcher } from "./feat-reference-linker.js";
import { createStableGearDocumentId } from "./gear-document-ids.js";

const FOUNDRY_DOCUMENT_ID_PATTERN = /^[A-Za-z0-9]{16}$/u;

function cleanString(value) {
  return String(value ?? "").trim();
}

function validDocumentId(value) {
  const id = cleanString(value);
  return FOUNDRY_DOCUMENT_ID_PATTERN.test(id) ? id : "";
}

function readModuleFlag(document, key) {
  return document?.getFlag?.(MODULE_ID, key)
    ?? document?.flags?.[MODULE_ID]?.[key];
}

function isManagedDocument(document) {
  return readModuleFlag(document, "managed") === true;
}

function aliasesOf(value) {
  return Array.isArray(value)
    ? value.map(cleanString).filter(Boolean)
    : [];
}

function targetFromDocument(document, {
  packName,
  kind,
  sourceFlag
}) {
  if (!isManagedDocument(document)) {
    return null;
  }
  const documentId = validDocumentId(document?.id ?? document?._id);
  const sourceId = cleanString(readModuleFlag(document, sourceFlag));
  const canonicalName = cleanString(document?.name);
  if (!documentId || !sourceId || !canonicalName) {
    return null;
  }

  return {
    uuid: `Compendium.world.${packName}.Item.${documentId}`,
    canonicalName,
    aliases: aliasesOf(readModuleFlag(document, "aliases")),
    kind,
    sourceId
  };
}

function collectDocumentTargets(documents, options) {
  return (Array.isArray(documents) ? documents : [])
    .map((document) => targetFromDocument(document, options))
    .filter(Boolean);
}

function existingFeatIds(feats) {
  const candidatesByFeatId = new Map();
  for (const document of Array.isArray(feats) ? feats : []) {
    if (!isManagedDocument(document)) {
      continue;
    }
    const featId = cleanString(readModuleFlag(document, "featId"));
    const documentId = validDocumentId(document?.id ?? document?._id);
    if (!featId || !documentId) {
      continue;
    }
    const candidates = candidatesByFeatId.get(featId) ?? [];
    candidates.push(documentId);
    candidatesByFeatId.set(featId, candidates);
  }

  return new Map([...candidatesByFeatId].map(([featId, candidates]) => [
    featId,
    [...new Set(candidates)].sort((left, right) => left.localeCompare(right))[0]
  ]));
}

function desiredFeatAliases(feat) {
  return aliasesOf(
    feat?.aliases
    ?? feat?.flags?.[MODULE_ID]?.aliases
  );
}

export function buildCompendiumItemReferenceIndex({
  actions = [],
  glossary = [],
  feats = [],
  desiredFeats = []
} = {}) {
  const targets = [
    ...collectDocumentTargets(actions, {
      packName: ACTIONS_COMPENDIUM_NAME,
      kind: "action",
      sourceFlag: "actionId"
    }),
    ...collectDocumentTargets(glossary, {
      packName: GLOSSARY_COMPENDIUM_NAME,
      kind: "term",
      sourceFlag: "glossaryTermId"
    })
  ];
  const existingIdByFeatId = existingFeatIds(feats);
  const documentIdByFeatId = new Map();
  const desiredFeatIds = new Set();

  for (const feat of Array.isArray(desiredFeats) ? desiredFeats : []) {
    const featId = cleanString(feat?.featId);
    const canonicalName = cleanString(feat?.name);
    if (!featId || !canonicalName) {
      continue;
    }
    if (desiredFeatIds.has(featId)) {
      throw new Error(`Duplicate desired feat id: ${featId}`);
    }
    desiredFeatIds.add(featId);

    const documentId = existingIdByFeatId.get(featId)
      || validDocumentId(feat?.documentId)
      || createStableGearDocumentId(`feat:${featId}`);
    documentIdByFeatId.set(featId, documentId);
    targets.push({
      uuid: `Compendium.world.${FEATS_COMPENDIUM_NAME}.Item.${documentId}`,
      canonicalName,
      aliases: desiredFeatAliases(feat),
      kind: "feat",
      sourceId: featId
    });
  }

  for (const target of collectDocumentTargets(feats, {
    packName: FEATS_COMPENDIUM_NAME,
    kind: "feat",
    sourceFlag: "featId"
  })) {
    if (!desiredFeatIds.has(target.sourceId)) {
      targets.push(target);
    }
  }

  return Object.freeze({
    matcher: buildFeatReferenceMatcher(targets),
    targets: Object.freeze(targets.map((target) => Object.freeze({
      ...target,
      aliases: Object.freeze([...target.aliases])
    }))),
    documentIdByFeatId
  });
}
