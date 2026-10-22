import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import vm from "node:vm";

export async function loadInstalledFunction(relativeFile, name, globals = {}) {
  const path = process.env.REBREYA_FOUNDRY_DATA_ROOT
    ? join(process.env.REBREYA_FOUNDRY_DATA_ROOT, "modules", relativeFile)
    : fileURLToPath(new URL(`../../../${relativeFile}`, import.meta.url));
  const source = await readFile(path, "utf8");
  const match = source.match(new RegExp(`(?:export )?(?:async )?function ${name}\\([^]*?^\\}`, "mu"));
  if (!match) throw new Error(`Installed provider contract not found: ${relativeFile}:${name}`);
  return vm.runInNewContext(`(${match[0].replace(/^export /u, "")})`, globals, { filename: path });
}

export async function loadInstalledClass(relativeFile, name, globals = {}) {
  const path = process.env.REBREYA_FOUNDRY_DATA_ROOT
    ? join(process.env.REBREYA_FOUNDRY_DATA_ROOT, "modules", relativeFile)
    : fileURLToPath(new URL(`../../../${relativeFile}`, import.meta.url));
  const source = await readFile(path, "utf8");
  const match = source.match(new RegExp(`(?:export )?class ${name}(?: extends [\\w.]+)? \\{[^]*?^\\}`, "mu"));
  if (!match) throw new Error(`Installed provider class not found: ${relativeFile}:${name}`);
  return vm.runInNewContext(`(${match[0].replace(/^export /u, "")})`, globals, { filename: path });
}
