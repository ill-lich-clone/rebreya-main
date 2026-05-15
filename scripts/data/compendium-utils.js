function toFolderArray(path) {
  if (Array.isArray(path)) {
    return path.map((entry) => String(entry ?? "").trim()).filter(Boolean);
  }

  return String(path ?? "")
    .split(/[\\/]+/u)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function resolveParentFolderId(folder) {
  return folder?.folder?.id ?? folder?.folder ?? null;
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

function getCompendiumSidebarFolders() {
  return game.folders?.filter?.((folder) => (
    folder?.type === "Compendium"
    && !folder?.pack
  )) ?? [];
}

export function normalizeFolderPath(path) {
  return toFolderArray(path);
}

export async function ensureCompendiumSidebarFolder(path) {
  const segments = normalizeFolderPath(path);
  if (!segments.length) {
    return null;
  }

  let parentId = null;
  let currentFolder = null;

  for (const segment of segments) {
    const existing = getCompendiumSidebarFolders()
      .filter((folder) => resolveParentFolderId(folder) === parentId)
      .filter((folder) => String(folder.name ?? "").trim() === segment)
      .sort((left, right) => (left.sort ?? 0) - (right.sort ?? 0) || String(left.id).localeCompare(String(right.id)));

    currentFolder = existing[0] ?? null;
    if (!currentFolder) {
      currentFolder = await Folder.create({
        name: segment,
        type: "Compendium",
        folder: parentId,
        sorting: "a"
      }, {
        render: false
      });
    }

    parentId = currentFolder?.id ?? null;
  }

  return currentFolder;
}

export async function ensurePackSidebarFolder(pack, folderPath) {
  if (!pack || typeof pack.setFolder !== "function") {
    return null;
  }

  const folder = await ensureCompendiumSidebarFolder(folderPath);
  if (!folder?.id) {
    return null;
  }

  const currentFolderId = pack.folder?.id ?? pack.config?.folder ?? null;
  if (currentFolderId !== folder.id) {
    await pack.setFolder(folder.id);
  }

  return folder;
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
