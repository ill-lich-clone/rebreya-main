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

function prepareDocumentUpdateData(document, data) {
  if (!data || typeof data !== "object") return data;
  const currentType = cleanId(document?.type);
  const nextType = cleanId(data.type);
  if (!currentType || !nextType || currentType === nextType) return data;
  if (!Object.hasOwn(data, "system")) return data;

  const update = { ...data, "==system": data.system };
  delete update.system;
  return update;
}

export async function syncManagedDocuments({
  pack,
  entries = [],
  documents = [],
  sourceIdOfEntry,
  sourceIdOfDocument,
  signatureOfEntry,
  signatureOfDocument,
  documentIdOfEntry = null,
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
  if (documentIdOfEntry != null) requireFunction(documentIdOfEntry, "documentIdOfEntry");
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
    const matches = documentsById.get(sourceId) ?? [];
    matches.push(document);
    documentsById.set(sourceId, matches);
  }

  const creates = [];
  const updates = [];
  let unchanged = 0;
  for (const [sourceId, entry] of entriesById) {
    const candidates = documentsById.get(sourceId) ?? [];
    const expectedDocumentId = cleanId(documentIdOfEntry?.(entry));
    const document = expectedDocumentId
      ? candidates.find((candidate) => documentId(candidate) === expectedDocumentId) ?? candidates[0]
      : candidates[0];
    if (!document) {
      creates.push(entry);
      continue;
    }
    documentsById.delete(sourceId);
    obsolete.push(...candidates.filter((candidate) => candidate !== document));
    if (expectedDocumentId && documentId(document) !== expectedDocumentId) {
      creates.push(entry);
      obsolete.push(document);
      continue;
    }
    if (String(signatureOfDocument(document) ?? "") === String(signatureOfEntry(entry) ?? "")) {
      unchanged += 1;
    }
    else {
      updates.push([document, entry]);
    }
  }
  obsolete.push(...Array.from(documentsById.values()).flat());

  if (prepareFolders) {
    await prepareFolders(sourceEntries);
  }

  const documentClass = pack.documentClass ?? globalThis.Item?.implementation;
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
    const data = await updateData(document, entry);
    await document.update(prepareDocumentUpdateData(document, data));
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

export async function syncFlaggedManagedDocuments({
  pack,
  entries = [],
  documents = [],
  moduleId,
  sourceIdFlag,
  buildData,
  prepareFolders = null,
  documentIdOfEntry = (entry) => entry?.documentId
} = {}) {
  requireFunction(buildData, "buildData");
  if (prepareFolders != null) requireFunction(prepareFolders, "prepareFolders");
  const scope = cleanId(moduleId);
  const flag = cleanId(sourceIdFlag);
  if (!scope || !flag) {
    throw new TypeError("moduleId and sourceIdFlag are required");
  }

  let folderContext;
  const build = (entry) => buildData(entry, folderContext);
  return syncManagedDocuments({
    pack,
    entries,
    documents,
    sourceIdOfEntry: (entry) => entry?.[flag],
    sourceIdOfDocument: (document) => (
      document?.getFlag?.(scope, "managed") ? document.getFlag(scope, flag) : ""
    ),
    signatureOfEntry: (entry) => entry?.signature,
    signatureOfDocument: (document) => document?.getFlag?.(scope, "signature"),
    documentIdOfEntry,
    prepareFolders: prepareFolders
      ? async (sourceEntries) => {
        folderContext = await prepareFolders(sourceEntries);
      }
      : null,
    createData: build,
    updateData: async (_document, entry) => {
      const data = await build(entry);
      delete data?._id;
      delete data?.id;
      return data;
    }
  });
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
