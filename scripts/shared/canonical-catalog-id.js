const TRANSLIT_MAP = {
  а: "a", б: "b", в: "v", г: "g", д: "d", е: "e", ё: "yo", ж: "zh", з: "z", и: "i", й: "y",
  к: "k", л: "l", м: "m", н: "n", о: "o", п: "p", р: "r", с: "s", т: "t", у: "u", ф: "f",
  х: "kh", ц: "ts", ч: "ch", ш: "sh", щ: "shch", ъ: "", ы: "y", ь: "", э: "e", ю: "yu", я: "ya"
};

export function canonicalCatalogId(value) {
  const text = String(value ?? "").trim().toLowerCase();
  let result = "";
  for (const character of text) {
    if (TRANSLIT_MAP[character]) {
      result += TRANSLIT_MAP[character];
      continue;
    }
    if (/[a-z0-9]/u.test(character)) {
      result += character;
      continue;
    }
    result += "-";
  }
  return result.replace(/-+/gu, "-").replace(/^-|-$/gu, "") || "entry";
}
