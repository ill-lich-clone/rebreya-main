import csv
import importlib.util
import json
import tempfile
import unittest
from pathlib import Path

from PIL import Image


SCRIPT = Path(__file__).resolve().parents[1] / "tools" / "icon-pipeline.py"
SPEC = importlib.util.spec_from_file_location("icon_pipeline", SCRIPT)
pipeline = importlib.util.module_from_spec(SPEC)
import sys
sys.modules[SPEC.name] = pipeline
SPEC.loader.exec_module(pipeline)


class BadgeAssetPreparationTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.review = self.root / "review.csv"
        self.pack_index = self.root / "packs.json"
        self.markers = self.root / "markers"
        self.markers.mkdir()
        for name in ("classes", "gear"):
            Image.new("RGBA", (256, 256), "#ffffff").save(self.markers / f"{name}.png")
        art = self.root / "class.png"
        Image.new("RGB", (256, 256), "#5b2633").save(art)
        with self.review.open("w", encoding="utf-8", newline="") as file:
            writer = csv.DictWriter(file, fieldnames=["packId", "persistedDocumentId", "persistedImg", "squareArtworkFile"])
            writer.writeheader()
            writer.writerow({"packId": "world.rebreya-classes", "persistedDocumentId": "class123", "persistedImg": "old/class.webp", "squareArtworkFile": str(art)})
        (self.root / "ordinary.webp").write_bytes(b"source")
        self.pack_index.write_text(json.dumps({"packs": [
            {"packId": "world.rebreya-classes", "documents": [{"documentId": "class123", "img": "old/class.webp"}]},
            {"packId": "world.rebreya-gear", "documents": [{"documentId": "gear123", "img": "ordinary.webp"}]}
        ]}), encoding="utf-8")

    def tearDown(self):
        self.temp.cleanup()

    def test_exact_document_mapping_and_shared_gear_badge(self):
        result = pipeline.prepare_badge_assets(self.review, self.pack_index, self.markers, self.root / "output", self.root)
        rows = result["targets"]
        self.assertEqual([(row["packId"], row["documentId"], row["badgeId"]) for row in rows], [
            ("world.rebreya-classes", "class123", "classes"),
            ("world.rebreya-gear", "gear123", "gear")
        ])
        self.assertEqual(rows[0]["baselineImg"], "old/class.webp")
        self.assertTrue((self.root / "output" / rows[0]["sourcePath"].split("modules/rebreya-main/", 1)[1]).exists())

    def test_duplicate_document_identity_is_rejected(self):
        lines = self.review.read_text(encoding="utf-8").splitlines()
        self.review.write_text("\n".join([*lines, lines[-1]]) + "\n", encoding="utf-8")
        with self.assertRaisesRegex(ValueError, "Duplicate badge target"):
            pipeline.prepare_badge_assets(self.review, self.pack_index, self.markers, self.root / "output", self.root)

    def test_missing_artwork_is_rejected(self):
        (self.root / "class.png").unlink()
        with self.assertRaisesRegex(ValueError, "Missing reviewed artwork"):
            pipeline.prepare_badge_assets(self.review, self.pack_index, self.markers, self.root / "output", self.root)

    def test_prepare_badge_assets_command_is_exposed(self):
        parser = pipeline.build_parser()
        args = parser.parse_args([
            "prepare-badge-assets", "--review-manifest", str(self.review),
            "--pack-index", str(self.pack_index), "--markers", str(self.markers),
            "--output-root", str(self.root / "output"), "--data-root", str(self.root)
        ])
        self.assertEqual(args.func(args), 0)
        self.assertTrue((self.root / "output" / "data" / "icon-badge-targets.json").exists())


if __name__ == "__main__":
    unittest.main()
