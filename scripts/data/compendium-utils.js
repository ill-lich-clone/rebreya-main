function toFolderArray(path) {
  if (Array.isArray(path)) {
    return path.map((entry) => String(entry ?? "").trim()).filter(Boolean);
  }

  return String(path ?? "")
    .split(/[\\/]+/u)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function getPackFolders(pack) {
  if (pack?.folders?.contents) {
    return Array.from(pack.folders.contents);
  }

  if (typeof pack?.folders?.values === "function") {
    return Array.from(pack.folders.values());
  }

  if (Array.isArray(pack?.folders)) {
    return pack.folders;
  }

  return game.folders?.filter?.((folder) => (
    folder?.type === "Item"
    && folder?.pack === pack?.collection
  )) ?? [];
}

export function normalizeFolderPath(path) {
  return toFolderArray(path);
}

export async function ensureCompendiumFolders(pack, folderPaths = []) {
  const paths = folderPaths
    .map((path) => normalizeFolderPath(path))
    .filter((path) => path.length);
  if (!paths.length) {
    return new Map();
  }

  const existingFolders = getPackFolders(pack);
  const byKey = new Map(
    existingFolders.map((folder) => [
      `${folder.folder ?? "root"}::${String(folder.name ?? "").trim()}`,
      folder
    ])
  );
  const resolved = new Map();

  for (const path of paths) {
    let parentId = null;
    let currentFolder = null;

    for (const segment of path) {
      const key = `${parentId ?? "root"}::${segment}`;
      currentFolder = byKey.get(key) ?? null;

      if (!currentFolder) {
        currentFolder = await Folder.create({
          name: segment,
          type: "Item",
          folder: parentId,
          sorting: "a"
        }, {
          pack: pack.collection,
          render: false
        });

        byKey.set(key, currentFolder);
      }

      parentId = currentFolder?.id ?? null;
    }

    resolved.set(path.join("/"), currentFolder?.id ?? null);
  }

  return resolved;
}
