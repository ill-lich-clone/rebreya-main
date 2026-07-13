import { isActiveGmClient } from "../infrastructure/foundry/active-gm.js";

function cleanId(value) {
  return typeof value === "string" ? value.trim() : String(value ?? "").trim();
}

function requireFunction(value, name) {
  if (typeof value !== "function") {
    throw new TypeError(`${name} must be a function`);
  }
}

function documentId(document) {
  return cleanId(document?.id ?? document?._id);
}

export async function syncManagedDocuments({
  pack,
  entries = [],
  documents = [],
  sourceIdOfEntry,
  sourceIdOfDocument,
  signatureOfEntry,
  signatureOfDocument,
  createData,
  updateData,
  prepareFolders = null
} = {}) {
  if (!pack || !cleanId(pack.collection)) {
    throw new TypeError("pack with a collection id is required");
  }
  for (const [name, operation] of Object.entries({
    sourceIdOfEntry,
    sourceIdOfDocument,
    signatureOfEntry,
    signatureOfDocument,
    createData,
    updateData
  })) {
    requireFunction(operation, name);
  }
  if (prepareFolders != null) requireFunction(prepareFolders, "prepareFolders");
  const sourceEntries = Array.isArray(entries) ? entries : [];
  const currentDocuments = Array.isArray(documents) ? documents : [];
  const entriesById = new Map();
  for (const entry of sourceEntries) {
    const sourceId = cleanId(sourceIdOfEntry(entry));
    if (!sourceId) throw new Error("Managed compendium entry is missing its source id");
    if (entriesById.has(sourceId)) throw new Error(`Duplicate managed compendium entry id: ${sourceId}`);
    entriesById.set(sourceId, entry);
  }

  const documentsById = new Map();
  const obsolete = [];
  for (const document of currentDocuments) {
    const sourceId = cleanId(sourceIdOfDocument(document));
    if (!sourceId) continue;
    if (documentsById.has(sourceId)) {
      obsolete.push(document);
      continue;
    }
    documentsById.set(sourceId, document);
  }

  const creates = [];
  const updates = [];
  let unchanged = 0;
  for (const [sourceId, entry] of entriesById) {
    const document = documentsById.get(sourceId);
    if (!document) {
      creates.push(entry);
      continue;
    }
    documentsById.delete(sourceId);
    if (String(signatureOfDocument(document) ?? "") === String(signatureOfEntry(entry) ?? "")) {
      unchanged += 1;
    }
    else {
      updates.push([document, entry]);
    }
  }
  obsolete.push(...documentsById.values());

  if (prepareFolders) {
    await prepareFolders(sourceEntries);
  }

  const documentClass = pack.documentClass;
  if (creates.length > 0) {
    if (typeof documentClass?.createDocuments !== "function") {
      throw new TypeError("pack.documentClass.createDocuments is required for creates");
    }
    const data = [];
    for (const entry of creates) data.push(await createData(entry));
    await documentClass.createDocuments(data, { pack: pack.collection, keepId: true });
  }

  for (const [document, entry] of updates) {
    if (typeof document?.update !== "function") {
      throw new TypeError(`Managed compendium document ${documentId(document)} cannot be updated`);
    }
    await document.update(await updateData(document, entry));
  }

  const obsoleteIds = obsolete.map(documentId).filter(Boolean);
  if (obsoleteIds.length > 0) {
    if (typeof documentClass?.deleteDocuments !== "function") {
      throw new TypeError("pack.documentClass.deleteDocuments is required for deletes");
    }
    await documentClass.deleteDocuments(obsoleteIds, { pack: pack.collection });
  }

  return {
    unchanged,
    created: creates.length,
    updated: updates.length,
    deleted: obsoleteIds.length
  };
}

export async function syncManagedDocumentsOnActiveGm(game, options) {
  if (!isActiveGmClient(game)) {
    return {
      skipped: true,
      unchanged: 0,
      created: 0,
      updated: 0,
      deleted: 0
    };
  }
  return syncManagedDocuments(options);
}
