import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

export const ALCHEMY_CATALOG_PATH = "data/alchemy-products.json";

function orderedProducts(products) {
  if (!Array.isArray(products)) throw new Error("Alchemy catalog must be an array");
  const seen = new Set();
  for (const product of products) {
    if (!Number.isInteger(product?.sourceNumber)) {
      throw new Error("Every alchemy product requires an integer sourceNumber");
    }
    if (seen.has(product.sourceNumber)) throw new Error(`Duplicate alchemy source number: ${product.sourceNumber}`);
    seen.add(product.sourceNumber);
  }
  return [...products].sort((left, right) => left.sourceNumber - right.sourceNumber);
}

export function serializeAlchemyCatalog(products) {
  return `${JSON.stringify(orderedProducts(products), null, 2)}\n`;
}

export async function writeAlchemyCatalogAtomic({ cwd, content, fsImpl = fs }) {
  if (typeof content !== "string") throw new Error("Alchemy catalog content must be a string");
  JSON.parse(content);
  const target = path.resolve(cwd, ...ALCHEMY_CATALOG_PATH.split("/"));
  const temporary = `${target}.${randomUUID()}.tmp`;
  await fsImpl.mkdir(path.dirname(target), { recursive: true });
  try {
    await fsImpl.writeFile(temporary, content, "utf8");
    await fsImpl.rename(temporary, target);
  } catch (error) {
    await fsImpl.rm(temporary, { force: true }).catch(() => {});
    throw error;
  }
  return target;
}
