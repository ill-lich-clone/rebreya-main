#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
from dataclasses import dataclass
from pathlib import Path

import numpy as np
from PIL import Image


ROOT = Path(__file__).resolve().parents[1]
RACES_JSON = ROOT / "data" / "races-teyvankal-v01.json"
ICON_ROOT = ROOT / "templates" / "icons" / "Races"
RACE_DIR = ICON_ROOT / "Races"
FEATURE_DIR = ICON_ROOT / "Abilities"
SHEETS_DIR = ROOT / "tmp" / "imagegen" / "sheets"
CODEX_IMAGES = Path.home() / ".codex" / "generated_images"
SUPPORTED_EXTS = ("png", "webp", "jpg", "jpeg", "svg", "avif")
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
    cleaned = "".join(" " if ch in INVALID_FILENAME_CHARS else ch for ch in text)
    cleaned = " ".join(cleaned.split()).strip().rstrip(". ")
    if not cleaned:
        cleaned = "icon"
    if cleaned.upper() in WINDOWS_RESERVED_NAMES:
        cleaned = f"{cleaned}_"
    return cleaned


def target_dir(kind: str) -> Path:
    if kind == "race":
        return RACE_DIR
    if kind == "feature":
        return FEATURE_DIR
    raise ValueError(f"Unsupported kind: {kind}")


def load_source() -> dict:
    payload = json.loads(RACES_JSON.read_text(encoding="utf-8"))
    if not isinstance(payload, dict):
        return {"races": []}
    return payload


def unique_names(values: list[str]) -> list[str]:
    out: list[str] = []
    seen: set[str] = set()
    for value in values:
        name = str(value or "").strip()
        if not name:
            continue
        key = normalize_icon_name(name)
        if not key or key in seen:
            continue
        seen.add(key)
        out.append(name)
    return out


def load_names(kind: str) -> list[str]:
    data = load_source()
    races = data.get("races", [])
    if not isinstance(races, list):
        return []

    if kind == "race":
        return unique_names([str(r.get("name", "")) for r in races if isinstance(r, dict)])

    if kind == "feature":
        names: list[str] = []
        for race in races:
            if not isinstance(race, dict):
                continue
            abilities = race.get("abilities", [])
            if not isinstance(abilities, list):
                continue
            for ability in abilities:
                if not isinstance(ability, dict):
                    continue
                names.append(str(ability.get("name", "")))
                options = ability.get("options", [])
                if not isinstance(options, list):
                    continue
                for option in options:
                    if isinstance(option, dict):
                        names.append(str(option.get("name", "")))
        return unique_names(names)

    raise ValueError(f"Unsupported kind: {kind}")


def existing_icon_keys(kind: str) -> set[str]:
    folder = target_dir(kind)
    if not folder.exists():
        return set()
    keys: set[str] = set()
    for ext in SUPPORTED_EXTS:
        for p in folder.glob(f"*.{ext}"):
            key = normalize_icon_name(p.stem)
            if key:
                keys.add(key)
    return keys


def next_missing(kind: str, count: int) -> list[str]:
    wanted = load_names(kind)
    have = existing_icon_keys(kind)
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
    for run in picked:
        if run not in unique:
            unique.append(run)
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
    kind: str
    names: list[str]
    sheet_source: str | None = None
    preview: str | None = None

    def to_json(self) -> dict:
        return {
            "batchId": self.batch_id,
            "kind": self.kind,
            "names": self.names,
            "sheetSource": self.sheet_source,
            "preview": self.preview,
        }

    @staticmethod
    def from_file(path: Path) -> "Batch":
        data = json.loads(path.read_text(encoding="utf-8"))
        return Batch(
            batch_id=str(data["batchId"]),
            kind=str(data["kind"]),
            names=[str(x) for x in data["names"]],
            sheet_source=data.get("sheetSource"),
            preview=data.get("preview"),
        )


def next_batch_file(kind: str, count: int, out_file: Path | None) -> Path:
    SHEETS_DIR.mkdir(parents=True, exist_ok=True)
    existing = sorted(SHEETS_DIR.glob(f"{kind}-batch-*.json"))
    if existing:
        last = existing[-1].stem
        try:
            n = int(last.split("-")[-1]) + 1
        except Exception:
            n = len(existing) + 1
    else:
        n = 1
    batch_id = f"{kind}-batch-{n:03d}"
    names = next_missing(kind, count)
    batch = Batch(batch_id=batch_id, kind=kind, names=names)
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

    out_dir = target_dir(batch.kind)
    out_dir.mkdir(parents=True, exist_ok=True)
    stems = [safe_icon_stem(n) for n in batch.names]

    for idx, _name in enumerate(batch.names):
        r = idx // 5
        c = idx % 5
        if r >= 5:
            break
        x1, x2 = x_cells[c]
        y1, y2 = y_cells[r]
        tile = im.crop((x1, y1, x2 + 1, y2 + 1)).resize((256, 256), Image.Resampling.LANCZOS)
        tile.save(out_dir / f"{stems[idx]}.png", format="PNG")

    preview = Image.new("RGB", (5 * 256, 5 * 256), (0, 0, 0))
    for idx, _name in enumerate(batch.names[:25]):
        r = idx // 5
        c = idx % 5
        tile = Image.open(out_dir / f"{stems[idx]}.png").convert("RGB")
        preview.paste(tile, (c * 256, r * 256))
    preview_path = SHEETS_DIR / f"{batch.batch_id}-preview.png"
    preview.save(preview_path, format="PNG")

    batch.sheet_source = str(src)
    batch.preview = str(preview_path)
    batch_file.write_text(json.dumps(batch.to_json(), ensure_ascii=False, indent=2), encoding="utf-8")
    return preview_path


def cmd_next(args: argparse.Namespace) -> None:
    out = next_batch_file(args.kind, args.count, Path(args.out) if args.out else None)
    batch = Batch.from_file(out)
    print(out)
    print(f"kind={batch.kind}")
    print(f"count={len(batch.names)}")
    for i, n in enumerate(batch.names, 1):
        print(f"{i:02d}. {n}")


def cmd_apply(args: argparse.Namespace) -> None:
    preview = apply_batch(
        batch_file=Path(args.batch),
        source_image=Path(args.image) if args.image else None,
    )
    print(preview)


def cmd_remaining(args: argparse.Namespace) -> None:
    left = next_missing(args.kind, 10_000)
    print(len(left))
    for n in left[:30]:
        print(n)


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser()
    sp = p.add_subparsers(required=True)

    p_next = sp.add_parser("next")
    p_next.add_argument("--kind", choices=["race", "feature"], required=True)
    p_next.add_argument("--count", type=int, default=25)
    p_next.add_argument("--out", default="")
    p_next.set_defaults(func=cmd_next)

    p_apply = sp.add_parser("apply")
    p_apply.add_argument("--batch", required=True)
    p_apply.add_argument("--image", default="")
    p_apply.set_defaults(func=cmd_apply)

    p_remaining = sp.add_parser("remaining")
    p_remaining.add_argument("--kind", choices=["race", "feature"], required=True)
    p_remaining.set_defaults(func=cmd_remaining)

    return p


def main() -> None:
    parser = build_parser()
    args = parser.parse_args()
    args.func(args)


if __name__ == "__main__":
    main()
