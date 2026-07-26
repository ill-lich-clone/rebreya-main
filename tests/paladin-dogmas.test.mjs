import test from "node:test";
import assert from "node:assert/strict";
import {
  PALADIN_DOGMA_LEVELS,
  PALADIN_OATHS,
  getPaladinDogma,
  getPaladinDogmas,
  getPaladinOath
} from "../scripts/data/paladin-dogmas.js";

test("paladin dogma catalog exposes two complete dogmas for every oath threshold", () => {
  assert.deepEqual(PALADIN_DOGMA_LEVELS, [3, 5, 9, 13, 17]);
  assert.deepEqual(
    PALADIN_OATHS.map((oath) => oath.id),
    ["devotion", "vengeance", "glory", "oathbreaker", "nirkadu", "arcana", "magistrate"]
  );

  const dogmas = PALADIN_OATHS.flatMap((oath) => (
    PALADIN_DOGMA_LEVELS.flatMap((level) => {
      const levelDogmas = getPaladinDogmas(oath.id, level);
      assert.equal(levelDogmas.length, 2, `${oath.id} level ${level}`);
      for (const dogma of levelDogmas) {
        assert.equal(dogma.oathId, oath.id);
        assert.equal(dogma.oathName, oath.name);
        assert.equal(dogma.level, level);
        assert.match(dogma.tenet, /^«.+»/u);
        assert.match(dogma.spell.identifier, /^[a-z0-9]+(?:-[a-z0-9]+)*$/u);
        assert.notEqual(dogma.spell.nameEn.trim(), "");
        assert.notEqual(dogma.spell.nameRu.trim(), "");
        assert.equal(getPaladinDogma(dogma.id), dogma);
      }
      return levelDogmas;
    })
  ));

  assert.equal(dogmas.length, 70);
  assert.equal(new Set(dogmas.map((dogma) => dogma.id)).size, 70);
});

test("paladin dogma lookup preserves the authoritative source text and spell mapping", () => {
  assert.equal(getPaladinOath("arcana")?.name, "Аркана");
  assert.equal(getPaladinOath("missing"), null);
  assert.deepEqual(getPaladinDogmas("missing", 3), []);
  assert.equal(getPaladinDogma("missing"), null);

  assert.deepEqual(getPaladinDogma("devotion-3-protection-from-evil-and-good"), {
    id: "devotion-3-protection-from-evil-and-good",
    oathId: "devotion",
    oathName: "Преданность",
    level: 3,
    tenet: "«Я не жду награды за добрые дела. Моё предназначение – творить справедливость, даже если никто этого не увидит»",
    spell: {
      identifier: "protection-from-evil-and-good",
      nameEn: "Protection from evil and good",
      nameRu: "Защита от зла и добра"
    }
  });

  assert.deepEqual(getPaladinDogma("magistrate-17-scrying"), {
    id: "magistrate-17-scrying",
    oathId: "magistrate",
    oathName: "Магистрат",
    level: 17,
    tenet: "«Когда истина скрыта за стенами, расстоянием и чужой властью, я всё равно найду путь к ней»",
    spell: {
      identifier: "scrying",
      nameEn: "Scrying",
      nameRu: "Наблюдение"
    }
  });
});
