#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable

import numpy as np
from PIL import Image


ROOT = Path(__file__).resolve().parents[1]
FEATS_JSON = ROOT / "cherty-v08-foundry-2014-import-pack" / "cherty-v08-foundry-2014-items.json"
FEATS_DIR = ROOT / "templates" / "icons" / "Feats"
SHEETS_DIR = ROOT / "tmp" / "imagegen" / "sheets"
CODEX_IMAGES = Path.home() / ".codex" / "generated_images"
INVALID_FILENAME_CHARS = '<>:"/\\|?*'
WINDOWS_RESERVED_NAMES = {
    "CON",
    "PRN",
    "AUX",
    "NUL",
    "COM1",
    "COM2",
    "COM3",
    "COM4",
    "COM5",
    "COM6",
    "COM7",
    "COM8",
    "COM9",
    "LPT1",
    "LPT2",
    "LPT3",
    "LPT4",
    "LPT5",
    "LPT6",
    "LPT7",
    "LPT8",
    "LPT9",
}


def normalize_icon_name(value: str) -> str:
    text = str(value or "").lower().replace("ё", "е")
    for ch in "'\"\u2019\u2018\u02BC\u02B9\u2032\u201C\u201D\u00AB\u00BB":
        text = text.replace(ch, "")
    out = []
    last_space = False
    for ch in text:
        if ch.isalnum() or ("\u0400" <= ch <= "\u04ff"):
            out.append(ch)
            last_space = False
        else:
            if not last_space:
                out.append(" ")
                last_space = True
    return "".join(out).strip()


def safe_icon_stem(value: str) -> str:
    text = str(value or "")
    cleaned = "".join("_" if ch in INVALID_FILENAME_CHARS else ch for ch in text)
    cleaned = " ".join(cleaned.split()).strip().rstrip(". ")
    if not cleaned:
        cleaned = "icon"
    if cleaned.upper() in WINDOWS_RESERVED_NAMES:
        cleaned = f"{cleaned}_"
    return cleaned


def load_feat_names() -> list[str]:
    payload = json.loads(FEATS_JSON.read_text(encoding="utf-8"))
    if not isinstance(payload, list):
        return []
    names: list[str] = []
    seen: set[str] = set()
    for item in payload:
        if not isinstance(item, dict):
            continue
        name = str(item.get("name", "")).strip()
        if not name:
            continue
        key = normalize_icon_name(name)
        if not key or key in seen:
            continue
        seen.add(key)
        names.append(name)
    return names


def existing_icon_keys() -> set[str]:
    keys: set[str] = set()
    for p in FEATS_DIR.glob("*.png"):
        keys.add(normalize_icon_name(p.stem))
    for p in FEATS_DIR.glob("*.webp"):
        keys.add(normalize_icon_name(p.stem))
    return {k for k in keys if k}


def next_missing(count: int) -> list[str]:
    wanted = load_feat_names()
    have = existing_icon_keys()
    missing = [name for name in wanted if normalize_icon_name(name) not in have]
    return missing[:count]


def latest_generated_image() -> Path:
    images = sorted(CODEX_IMAGES.rglob("*.png"), key=lambda p: p.stat().st_mtime, reverse=True)
    if not images:
        raise FileNotFoundError(f"No generated images found under {CODEX_IMAGES}")
    return images[0]


def gap_runs(ratio: np.ndarray, threshold: float = 0.92) -> list[tuple[int, int]]:
    idx = np.where(ratio > threshold)[0]
    if len(idx) == 0:
        return []
    runs: list[tuple[int, int]] = []
    s = p = int(idx[0])
    for raw in idx[1:]:
        i = int(raw)
        if i <= p + 1:
            p = i
        else:
            runs.append((s, p))
            s = p = i
    runs.append((s, p))
    return runs


def pick_runs(runs: list[tuple[int, int]], expected: list[float], size: int) -> list[tuple[int, int]]:
    if not runs:
        step = size / 5
        synthetic = [(int(round(i * step)), int(round(i * step))) for i in range(6)]
        synthetic[-1] = (size - 1, size - 1)
        return synthetic

    picked: list[tuple[int, int]] = []
    for ex in expected:
        best = min(runs, key=lambda r: min(abs(r[0] - ex), abs(r[1] - ex), abs(((r[0] + r[1]) / 2) - ex)))
        picked.append(best)
    unique: list[tuple[int, int]] = []
    for r in picked:
        if r not in unique:
            unique.append(r)
    unique = sorted(unique, key=lambda r: r[0])
    if len(unique) != 6:
        step = size / 5
        unique = [(int(round(i * step)), int(round(i * step))) for i in range(6)]
        unique[-1] = (size - 1, size - 1)
    return unique


def compute_cells(im: Image.Image) -> tuple[list[tuple[int, int]], list[tuple[int, int]]]:
    a = np.array(im.convert("RGB"))
    lum = (0.2126 * a[:, :, 0] + 0.7152 * a[:, :, 1] + 0.0722 * a[:, :, 2])
    col_runs = gap_runs((lum < 12).mean(axis=0), 0.92)
    row_runs = gap_runs((lum < 12).mean(axis=1), 0.92)

    w, h = im.size
    x_expected = [0, w * 0.2, w * 0.4, w * 0.6, w * 0.8, w - 1]
    y_expected = [0, h * 0.2, h * 0.4, h * 0.6, h * 0.8, h - 1]

    col_runs = pick_runs(col_runs, x_expected, w)
    row_runs = pick_runs(row_runs, y_expected, h)

    x_cells: list[tuple[int, int]] = []
    for i in range(5):
        x1 = col_runs[i][1] + 1
        x2 = col_runs[i + 1][0] - 1
        if x2 <= x1:
            x1 = int(round(i * w / 5))
            x2 = int(round((i + 1) * w / 5)) - 1
        x_cells.append((x1, x2))

    y_cells: list[tuple[int, int]] = []
    for i in range(5):
        y1 = row_runs[i][1] + 1
        y2 = row_runs[i + 1][0] - 1
        if y2 <= y1:
            y1 = int(round(i * h / 5))
            y2 = int(round((i + 1) * h / 5)) - 1
        y_cells.append((y1, y2))

    return x_cells, y_cells


@dataclass
class Batch:
    batch_id: str
    names: list[str]
    sheet_source: str | None = None
    preview: str | None = None

    def to_json(self) -> dict:
        return {
            "batchId": self.batch_id,
            "names": self.names,
            "sheetSource": self.sheet_source,
            "preview": self.preview,
        }

    @staticmethod
    def from_file(path: Path) -> "Batch":
        data = json.loads(path.read_text(encoding="utf-8"))
        return Batch(
            batch_id=str(data["batchId"]),
            names=[str(x) for x in data["names"]],
            sheet_source=data.get("sheetSource"),
            preview=data.get("preview"),
        )


def next_batch_file(count: int, out_file: Path | None) -> Path:
    SHEETS_DIR.mkdir(parents=True, exist_ok=True)
    existing = sorted(SHEETS_DIR.glob("feats-batch-*.json"))
    if existing:
        last = existing[-1].stem
        try:
            n = int(last.split("-")[-1]) + 1
        except Exception:
            n = len(existing) + 1
    else:
        n = 1
    batch_id = f"feats-batch-{n:03d}"
    names = next_missing(count)
    batch = Batch(batch_id=batch_id, names=names)
    out = out_file or (SHEETS_DIR / f"{batch_id}.json")
    out.write_text(json.dumps(batch.to_json(), ensure_ascii=False, indent=2), encoding="utf-8")
    return out


def apply_batch(batch_file: Path, source_image: Path | None) -> Path:
    batch = Batch.from_file(batch_file)
    if not batch.names:
        raise RuntimeError("Batch has zero names; nothing to apply.")

    src = source_image or latest_generated_image()
    im = Image.open(src).convert("RGB")
    x_cells, y_cells = compute_cells(im)

    FEATS_DIR.mkdir(parents=True, exist_ok=True)
    stems = [safe_icon_stem(n) for n in batch.names]
    for idx, name in enumerate(batch.names):
        r = idx // 5
        c = idx % 5
        if r >= 5:
            break
        x1, x2 = x_cells[c]
        y1, y2 = y_cells[r]
        tile = im.crop((x1, y1, x2 + 1, y2 + 1)).resize((256, 256), Image.Resampling.LANCZOS)
        tile.save(FEATS_DIR / f"{stems[idx]}.png", format="PNG")

    preview = Image.new("RGB", (5 * 256, 5 * 256), (0, 0, 0))
    for idx, _name in enumerate(batch.names[:25]):
        r = idx // 5
        c = idx % 5
        tile = Image.open(FEATS_DIR / f"{stems[idx]}.png").convert("RGB")
        preview.paste(tile, (c * 256, r * 256))
    preview_path = SHEETS_DIR / f"{batch.batch_id}-preview.png"
    preview.save(preview_path, format="PNG")

    batch.sheet_source = str(src)
    batch.preview = str(preview_path)
    batch_file.write_text(json.dumps(batch.to_json(), ensure_ascii=False, indent=2), encoding="utf-8")
    return preview_path


def cmd_next(args: argparse.Namespace) -> None:
    out = next_batch_file(args.count, Path(args.out) if args.out else None)
    batch = Batch.from_file(out)
    print(out)
    print(f"count={len(batch.names)}")
    for i, n in enumerate(batch.names, 1):
        print(f"{i:02d}. {n}")


def cmd_apply(args: argparse.Namespace) -> None:
    preview = apply_batch(
        batch_file=Path(args.batch),
        source_image=Path(args.image) if args.image else None,
    )
    print(preview)


def cmd_remaining(_args: argparse.Namespace) -> None:
    left = next_missing(10_000)
    print(len(left))
    for n in left[:30]:
        print(n)


def cmd_prompt(args: argparse.Namespace) -> None:
    batch = Batch.from_file(Path(args.batch))
    lines = [
        "Create one square fantasy RPG sprite sheet with exactly 25 icons in a strict 5x5 grid (left-to-right, top-to-bottom).",
        "Each cell must contain one icon for the corresponding feat name in this exact order:",
    ]
    for idx, name in enumerate(batch.names[:25], 1):
        lines.append(f"{idx}) {name}")
    lines.extend(
        [
            "",
            "Style: dark fantasy painterly icon art, high detail, dramatic contrast, warm orange-gold highlights, black/bronze palette, ornate golden frame style consistent in all cells.",
            "Keep each icon centered with safe margins inside its own cell.",
            "No text, no letters, no numbers, no watermark.",
        ]
    )
    print("\n".join(lines))


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser()
    sp = p.add_subparsers(required=True)

    p_next = sp.add_parser("next")
    p_next.add_argument("--count", type=int, default=25)
    p_next.add_argument("--out", default="")
    p_next.set_defaults(func=cmd_next)

    p_apply = sp.add_parser("apply")
    p_apply.add_argument("--batch", required=True)
    p_apply.add_argument("--image", default="")
    p_apply.set_defaults(func=cmd_apply)

    p_remaining = sp.add_parser("remaining")
    p_remaining.set_defaults(func=cmd_remaining)

    p_prompt = sp.add_parser("prompt")
    p_prompt.add_argument("--batch", required=True)
    p_prompt.set_defaults(func=cmd_prompt)
    return p


def main() -> None:
    parser = build_parser()
    args = parser.parse_args()
    args.func(args)


if __name__ == "__main__":
    main()
