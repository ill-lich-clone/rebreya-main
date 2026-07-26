import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const MODULE_DIR = new URL("../", import.meta.url);

test("PowerShell gear import selects the named base sheet and maps columns by header", () => {
  const tempDirectory = mkdtempSync(join(tmpdir(), "rebreya-gear-import-"));
  const outputPath = join(tempDirectory, "gear.json");
  const upgradesOutputPath = join(tempDirectory, "upgrades.json");
  const scriptPath = new URL("../tools/import-gear.ps1", import.meta.url);
  const workbookPath = new URL(
    "../docs/Ребрея_ Оружие, огнестрел и снаряжение.xlsx",
    import.meta.url
  );
  const materialsPath = new URL("../data/materials.json", import.meta.url);
  const enrichmentPath = new URL("../data/gear.json", import.meta.url);

  try {
    const result = spawnSync("powershell.exe", [
      "-NoProfile",
      "-ExecutionPolicy", "Bypass",
      "-File", fileURLToPath(scriptPath),
      "-WorkbookPath", fileURLToPath(workbookPath),
      "-MaterialsPath", fileURLToPath(materialsPath),
      "-EnrichmentSourcePath", fileURLToPath(enrichmentPath),
      "-OutputPath", outputPath,
      "-UpgradesOutputPath", upgradesOutputPath,
      "-AllowUnmatchedProfiles"
    ], {
      cwd: MODULE_DIR,
      encoding: "utf8"
    });

    assert.equal(result.status, 0, result.stderr || result.stdout);
    const output = readFileSync(outputPath, "utf8");
    assert.notEqual(output.trim(), "", "gear import must produce a JSON catalog");
    const gear = JSON.parse(output);
    const expectedCurses = [
      "Проклятье молниеносной реакции",
      "Проклятье преследующего успеха",
      "Проклятье жизни и смерти",
      "Проклятье тяжести жизни",
      "Проклятье кровопускания",
      "Проклятье скорбящего прошлого",
      "Проклятье притягивание снарядов",
      "Проклятье огненной души",
      "Проклятье воли к жизни",
      "Проклятье цепей",
      "Проклятье обсидиана"
    ];
    assert.deepEqual(
      expectedCurses.filter((name) => !gear.some((entry) => entry.name === name)),
      [],
      "current common gear sheet must import every curse product"
    );
    assert.equal(new Set(gear.map((entry) => entry.id)).size, gear.length);
    assert.equal(
      gear.some((entry) => /транспорт|скакун/iu.test(entry.equipmentType)),
      false,
      "deferred transport rows must stay outside the gear catalog"
    );
    const silvering = gear.find((entry) => entry.name === "Серебрение оружия");
    const tendon = gear.find((entry) => entry.name === "Сухожилие чудовища");

    assert.ok(silvering);
    assert.equal(silvering.priceGoldEquivalent, 125);
    assert.equal(silvering.predominantMaterialId, "serebro");
    assert.ok(tendon);
    assert.equal(tendon.priceGoldEquivalent, 250);
    assert.equal(tendon.predominantMaterialId, "material-28");
    const quarterstaff = gear.find((entry) => entry.name === "Боевой посох");
    assert.ok(quarterstaff);
    assert.ok(
      quarterstaff.weapon,
      `quarterstaff enrichment missing: ${JSON.stringify(quarterstaff)}\n${result.stdout}`
    );
    assert.equal(quarterstaff.weapon.damageFormula, "1d6");

    assert.equal(existsSync(upgradesOutputPath), true, "gear import must produce upgrades.json");
    const upgrades = JSON.parse(readFileSync(upgradesOutputPath, "utf8"));
    const silverUpgrade = upgrades.find((entry) => entry.name === "Серебро");
    const tendonUpgrade = upgrades.find((entry) => entry.name === "Сухожилие чудовища");

    assert.ok(
      silverUpgrade,
      `missing silver upgrade; got: ${upgrades.map((entry) => entry.name).join(" | ")}\n${result.stdout}`
    );
    assert.ok(tendonUpgrade, `missing tendon upgrade; got: ${upgrades.map((entry) => entry.name).join(" | ")}`);
    assert.equal(silverUpgrade.canonicalName, "Серебрение оружия");
    assert.deepEqual(silverUpgrade.upgrade, {
      rank: 2,
      appliesTo: "Оружие",
      effect: "У некоторых чудовищ есть иммунитет или сопротивление немагическому оружию или уязвимость перед серебряным оружием, поэтому осторожные искатели приключений за дополнительную плату покрывают своё оружие серебром. Кроме того, когда вы атакуете нежить или исчадие таким оружием, то оно считается магическим",
      priceGold: 125,
      sourceMaterialName: "Серебро",
      sourceMaterialId: "serebro",
      type: "Материал",
      sourceSheet: "Усовершенствования V0.21",
      sourceSheetRow: 6
    });
    assert.equal(tendonUpgrade.canonicalName, "Сухожилие чудовища");
    assert.equal(tendonUpgrade.upgrade.priceGold, 250);
  }
  finally {
    rmSync(tempDirectory, { recursive: true, force: true });
  }
});
