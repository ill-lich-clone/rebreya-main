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

const SUPPORTED_ICON_EXTENSIONS = new Set(["webp", "png", "jpg", "jpeg", "svg", "avif"]);
const namedIconCacheByRoot = new Map();

function normalizeAssetPath(path) {
  return String(path ?? "").replace(/\\/gu, "/").replace(/\/{2,}/gu, "/").replace(/\/+$/gu, "");
}

function safeDecodeUriComponent(value) {
  try {
    return decodeURIComponent(value);
  }
  catch (_error) {
    return value;
  }
}

function decodePath(path) {
  return normalizeAssetPath(path)
    .split("/")
    .filter(Boolean)
    .map((segment) => safeDecodeUriComponent(segment))
    .join("/");
}

function normalizeIconName(value) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/\u0451/gu, "\u0435")
    .replace(/['"\u2019\u2018\u02BC\u02B9\u2032\u201C\u201D\u00AB\u00BB]/gu, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
}

function buildEncodedIconPath(rootPath, filePath) {
  const normalizedRoot = normalizeAssetPath(rootPath);
  const decodedRoot = decodePath(rootPath);
  const decodedFile = decodePath(filePath);
  const rootPrefix = `${decodedRoot}/`;

  if (!decodedFile.toLowerCase().startsWith(rootPrefix.toLowerCase())) {
    return normalizeAssetPath(filePath);
  }

  const decodedRelative = decodedFile.slice(rootPrefix.length);
  const encodedRelative = decodedRelative
    .split("/")
    .filter(Boolean)
    .map((segment) => encodeURIComponent(segment))
    .join("/");

  return `${normalizedRoot}/${encodedRelative}`;
}

function registerNamedIcon(filePath, rootPath, iconLookup) {
  const normalizedFilePath = normalizeAssetPath(filePath);
  if (!normalizedFilePath) {
    return;
  }

  const filename = safeDecodeUriComponent(normalizedFilePath.split("/").pop() ?? "");
  const extensionIndex = filename.lastIndexOf(".");
  if (extensionIndex <= 0) {
    return;
  }

  const extension = filename.slice(extensionIndex + 1).toLowerCase();
  if (!SUPPORTED_ICON_EXTENSIONS.has(extension)) {
    return;
  }

  const iconName = filename.slice(0, extensionIndex);
  const iconKey = normalizeIconName(iconName);
  if (!iconKey || iconLookup.has(iconKey)) {
    return;
  }

  iconLookup.set(iconKey, buildEncodedIconPath(rootPath, normalizedFilePath));
}

async function browseDirectory(path) {
  let lastError = null;
  for (const source of ["data", "public"]) {
    try {
      return await FilePicker.browse(source, path);
    }
    catch (error) {
      lastError = error;
    }
  }

  throw lastError ?? new Error(`Unable to browse directory: ${path}`);
}

async function scanIconRoot(rootPath) {
  const normalizedRoot = normalizeAssetPath(rootPath);
  const iconLookup = new Map();

  if (!normalizedRoot) {
    return iconLookup;
  }

  if (typeof FilePicker !== "function" || typeof FilePicker.browse !== "function") {
    return iconLookup;
  }

  const pendingPaths = [normalizedRoot];
  const visitedPaths = new Set();

  while (pendingPaths.length) {
    const currentPath = pendingPaths.shift();
    if (!currentPath || visitedPaths.has(currentPath)) {
      continue;
    }
    visitedPaths.add(currentPath);

    try {
      const browseResult = await browseDirectory(currentPath);
      const files = Array.isArray(browseResult?.files) ? browseResult.files : [];
      const directories = Array.isArray(browseResult?.dirs) ? browseResult.dirs : [];
      files.forEach((filePath) => registerNamedIcon(filePath, normalizedRoot, iconLookup));
      directories.forEach((directoryPath) => {
        const normalizedDirectoryPath = normalizeAssetPath(directoryPath);
        if (normalizedDirectoryPath && !visitedPaths.has(normalizedDirectoryPath)) {
          pendingPaths.push(normalizedDirectoryPath);
        }
      });
    }
    catch (_error) {
      continue;
    }
  }

  return iconLookup;
}

function unique(values = []) {
  return Array.from(new Set((Array.isArray(values) ? values : []).filter(Boolean)));
}

export async function buildNamedIconLookup(searchRoots = [], { forceRefresh = false } = {}) {
  const roots = unique(searchRoots.map((path) => normalizeAssetPath(path)));
  const resolvedLookup = new Map();

  for (const rootPath of roots) {
    if (forceRefresh) {
      namedIconCacheByRoot.delete(rootPath);
    }

    let rootLookup = namedIconCacheByRoot.get(rootPath);
    if (!rootLookup) {
      rootLookup = await scanIconRoot(rootPath);
      namedIconCacheByRoot.set(rootPath, rootLookup);
    }

    for (const [iconName, iconPath] of rootLookup.entries()) {
      if (!resolvedLookup.has(iconName)) {
        resolvedLookup.set(iconName, iconPath);
      }
    }
  }

  return resolvedLookup;
}

export function resolveNamedIcon(name, iconLookup, fallbackIcon = "") {
  const iconName = normalizeIconName(name);
  if (!iconName) {
    return fallbackIcon;
  }

  if (iconLookup instanceof Map) {
    return iconLookup.get(iconName) ?? fallbackIcon;
  }

  return fallbackIcon;
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
