#!/usr/bin/env python3
"""
Icon pipeline for Foundry module content.

What it does:
1) Audits coverage of icons for feats/races/racial features.
2) Builds JSONL batch jobs for the bundled image generation CLI.

Usage examples:
  python tools/icon-pipeline.py audit
  python tools/icon-pipeline.py jobs --category feats --chunk-size 40 --missing-only
  python tools/icon-pipeline.py jobs --category races --include-race-features --chunk-size 40 --missing-only
"""

from __future__ import annotations

import argparse
import json
import re
from collections import OrderedDict, defaultdict
from dataclasses import dataclass
from pathlib import Path
from typing import Dict, Iterable, List, Sequence, Tuple


SUPPORTED_ICON_EXTENSIONS = {".webp", ".png", ".jpg", ".jpeg", ".svg", ".avif"}
DEFAULT_IMAGE_EXTENSION = ".png"
DEFAULT_SIZE = "1024x1024"
DEFAULT_QUALITY = "medium"

ROOT_DIR = Path(__file__).resolve().parents[1]
ICONS_DIR = ROOT_DIR / "templates" / "icons"
FEATS_SOURCE = ROOT_DIR / "cherty-v08-foundry-2014-import-pack" / "cherty-v08-foundry-2014-items.json"
RACES_SOURCE = ROOT_DIR / "data" / "races-teyvankal-v01.json"

FEATS_OUTPUT_SUBDIR = "Feats"
RACES_OUTPUT_SUBDIR = "Races"

QUOTE_PATTERN = re.compile(r"['\"\u2019\u2018\u02BC\u02B9\u2032\u201C\u201D\u00AB\u00BB]+", re.UNICODE)
NON_ALNUM_PATTERN = re.compile(r"[^\w\d\u0400-\u04FF]+", re.UNICODE)
WHITESPACE_PATTERN = re.compile(r"\s+", re.UNICODE)
INVALID_FILENAME_CHARS_PATTERN = re.compile(r'[<>:"/\\|?*\x00-\x1F]')


@dataclass(frozen=True)
class IconTarget:
    category: str
    name: str
    normalized_key: str
    filename_stem: str
    output_subdir: str
    sources: Tuple[str, ...]

    @property
    def output_filename(self) -> str:
        return f"{self.filename_stem}{DEFAULT_IMAGE_EXTENSION}"

    @property
    def output_rel_path(self) -> str:
        return str(Path("templates") / "icons" / self.output_subdir / self.output_filename).replace("\\", "/")


def normalize_icon_name(value: str) -> str:
    text = str(value or "").lower().replace("ё", "е")
    text = QUOTE_PATTERN.sub("", text)
    text = NON_ALNUM_PATTERN.sub(" ", text)
    text = WHITESPACE_PATTERN.sub(" ", text).strip()
    return text


def sanitize_filename_stem(value: str, fallback: str = "icon") -> str:
    text = str(value or "").strip()
    text = INVALID_FILENAME_CHARS_PATTERN.sub(" ", text)
    text = WHITESPACE_PATTERN.sub(" ", text).strip().rstrip(". ")
    return text or fallback


def iter_icon_files(root: Path) -> Iterable[Path]:
    if not root.exists():
        return []
    files = [path for path in root.rglob("*") if path.is_file() and path.suffix.lower() in SUPPORTED_ICON_EXTENSIONS]
    files.sort(key=lambda path: str(path).lower())
    return files


def build_icon_lookup(search_roots: Sequence[Path]) -> Dict[str, Path]:
    lookup: Dict[str, Path] = {}
    for root in search_roots:
        for file_path in iter_icon_files(root):
            key = normalize_icon_name(file_path.stem)
            if key and key not in lookup:
                lookup[key] = file_path
    return lookup


def unique_ordered(values: Iterable[str]) -> List[str]:
    ordered = OrderedDict()
    for value in values:
        text = str(value or "").strip()
        if text:
            ordered.setdefault(text, None)
    return list(ordered.keys())


def load_feats_names(path: Path) -> List[str]:
    payload = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(payload, list):
        return []
    return unique_ordered(item.get("name", "") for item in payload if isinstance(item, dict))


def load_races_payload(path: Path) -> dict:
    payload = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(payload, dict):
        return {}
    return payload


def load_race_names(path: Path) -> List[str]:
    payload = load_races_payload(path)
    races = payload.get("races", [])
    if not isinstance(races, list):
        return []
    return unique_ordered(race.get("name", "") for race in races if isinstance(race, dict))


def load_race_feature_names(path: Path) -> List[str]:
    payload = load_races_payload(path)
    races = payload.get("races", [])
    if not isinstance(races, list):
        return []

    names: List[str] = []
    for race in races:
        if not isinstance(race, dict):
            continue
        for ability in race.get("abilities", []) or []:
            if not isinstance(ability, dict):
                continue
            names.append(str(ability.get("name", "")).strip())
            for option in ability.get("options", []) or []:
                if isinstance(option, dict):
                    names.append(str(option.get("name", "")).strip())

    return unique_ordered(names)


def build_targets_for_names(
    names: Sequence[str],
    category: str,
    output_subdir: str,
    source_label: str
) -> List[IconTarget]:
    by_key: "OrderedDict[str, IconTarget]" = OrderedDict()
    for name in names:
        clean_name = str(name or "").strip()
        if not clean_name:
            continue
        key = normalize_icon_name(clean_name)
        if not key:
            continue

        stem = sanitize_filename_stem(clean_name, fallback=key.replace(" ", "-"))
        existing = by_key.get(key)
        if existing is None:
            by_key[key] = IconTarget(
                category=category,
                name=clean_name,
                normalized_key=key,
                filename_stem=stem,
                output_subdir=output_subdir,
                sources=(source_label,)
            )
        else:
            merged_sources = tuple(OrderedDict.fromkeys([*existing.sources, source_label]).keys())
            by_key[key] = IconTarget(
                category=existing.category,
                name=existing.name,
                normalized_key=existing.normalized_key,
                filename_stem=existing.filename_stem,
                output_subdir=existing.output_subdir,
                sources=merged_sources
            )
    return list(by_key.values())


def compose_races_targets(include_race_features: bool) -> List[IconTarget]:
    race_names = load_race_names(RACES_SOURCE)
    race_targets = build_targets_for_names(race_names, "races", RACES_OUTPUT_SUBDIR, "race")
    if not include_race_features:
        return race_targets

    feature_names = load_race_feature_names(RACES_SOURCE)
    feature_targets = build_targets_for_names(
        feature_names,
        "race_features",
        RACES_OUTPUT_SUBDIR,
        "race_feature"
    )

    merged: "OrderedDict[str, IconTarget]" = OrderedDict()
    for target in race_targets + feature_targets:
        existing = merged.get(target.normalized_key)
        if existing is None:
            merged[target.normalized_key] = target
            continue

        # If there is overlap between race name and feature name, keep race name for filename/title.
        winner = existing
        if existing.category != "races" and target.category == "races":
            winner = target

        sources = tuple(OrderedDict.fromkeys([*existing.sources, *target.sources]).keys())
        merged[target.normalized_key] = IconTarget(
            category=winner.category,
            name=winner.name,
            normalized_key=winner.normalized_key,
            filename_stem=winner.filename_stem,
            output_subdir=winner.output_subdir,
            sources=sources
        )

    return list(merged.values())


def compose_feats_targets() -> List[IconTarget]:
    feat_names = load_feats_names(FEATS_SOURCE)
    return build_targets_for_names(feat_names, "feats", FEATS_OUTPUT_SUBDIR, "feat")


def build_targets(category: str, include_race_features: bool) -> List[IconTarget]:
    if category == "feats":
        return compose_feats_targets()
    if category == "races":
        return compose_races_targets(include_race_features=include_race_features)
    if category == "all":
        return compose_feats_targets() + compose_races_targets(include_race_features=include_race_features)
    raise ValueError(f"Unsupported category: {category}")


def icon_lookup_for_category(category: str) -> Dict[str, Path]:
    if category == "feats":
        return build_icon_lookup([ICONS_DIR / FEATS_OUTPUT_SUBDIR, ICONS_DIR])
    if category == "races":
        return build_icon_lookup([ICONS_DIR / RACES_OUTPUT_SUBDIR, ICONS_DIR])
    if category == "all":
        # "all" is only for audit summary; use generic lookup to detect any available icon.
        return build_icon_lookup([ICONS_DIR])
    raise ValueError(f"Unsupported category: {category}")


def infer_subject_type(category: str) -> str:
    if category == "feats":
        return "черты персонажа"
    if category == "races":
        return "расы"
    if category == "race_features":
        return "расовой особенности"
    return "способности"


def build_prompt(target: IconTarget) -> str:
    subject_type = infer_subject_type(target.category)
    return (
        f'Создай квадратную фэнтези-иконку для {subject_type} "{target.name}" в стиле темного эпического фэнтези. '
        "Один центральный понятный образ или действие, хорошо читаемый на маленьком размере. "
        "Палитра: черный фон, бронза, золото, оранжевое свечение, высокий контраст, глубокие тени. "
        "Добавь декоративную позолоченную рамку по краю и кинематографичное освещение. "
        "Текстуры детализированные: металл, ткань, кожа, магические частицы по теме. "
        "Без текста, букв, цифр, логотипов, водяных знаков и интерфейсных элементов."
    )


def split_chunks(items: Sequence[IconTarget], chunk_size: int) -> List[List[IconTarget]]:
    if chunk_size <= 0:
        return [list(items)]
    return [list(items[i : i + chunk_size]) for i in range(0, len(items), chunk_size)]


def ensure_dir(path: Path) -> None:
    path.mkdir(parents=True, exist_ok=True)


def write_json(path: Path, payload: dict) -> None:
    ensure_dir(path.parent)
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")


def write_jsonl(path: Path, rows: Sequence[dict]) -> None:
    ensure_dir(path.parent)
    with path.open("w", encoding="utf-8", newline="\n") as handle:
        for row in rows:
            handle.write(json.dumps(row, ensure_ascii=False))
            handle.write("\n")


def summarize_targets(targets: Sequence[IconTarget], lookup: Dict[str, Path]) -> dict:
    by_category_total = defaultdict(int)
    by_category_missing = defaultdict(int)
    missing_targets: List[IconTarget] = []
    for target in targets:
        by_category_total[target.category] += 1
        if target.normalized_key not in lookup:
            by_category_missing[target.category] += 1
            missing_targets.append(target)

    return {
        "total": len(targets),
        "missing": len(missing_targets),
        "by_category_total": dict(sorted(by_category_total.items())),
        "by_category_missing": dict(sorted(by_category_missing.items())),
        "missing_targets": missing_targets
    }


def command_audit(args: argparse.Namespace) -> int:
    include_race_features = args.include_race_features
    feats_targets = compose_feats_targets()
    races_targets = compose_races_targets(include_race_features=include_race_features)

    feats_lookup = icon_lookup_for_category("feats")
    races_lookup = icon_lookup_for_category("races")

    feats_summary = summarize_targets(feats_targets, feats_lookup)
    races_summary = summarize_targets(races_targets, races_lookup)

    all_targets = feats_targets + races_targets
    all_lookup = icon_lookup_for_category("all")
    all_summary = summarize_targets(all_targets, all_lookup)

    print("Icon audit:")
    print(f"  Feats: {feats_summary['total']} total, {feats_summary['missing']} missing")
    print(f"  Races(+features={include_race_features}): {races_summary['total']} total, {races_summary['missing']} missing")
    print(f"  Combined unique targets: {all_summary['total']} total, {all_summary['missing']} missing")

    if args.show_examples > 0:
        missing = all_summary["missing_targets"][: args.show_examples]
        if missing:
            print("")
            print("Sample missing:")
            for target in missing:
                print(f"  - [{target.category}] {target.name}")

    if args.out_manifest:
        payload = {
            "generatedAt": "local",
            "includeRaceFeatures": include_race_features,
            "summary": {
                "feats": {
                    "total": feats_summary["total"],
                    "missing": feats_summary["missing"],
                    "byCategoryTotal": feats_summary["by_category_total"],
                    "byCategoryMissing": feats_summary["by_category_missing"]
                },
                "races": {
                    "total": races_summary["total"],
                    "missing": races_summary["missing"],
                    "byCategoryTotal": races_summary["by_category_total"],
                    "byCategoryMissing": races_summary["by_category_missing"]
                },
                "combined": {
                    "total": all_summary["total"],
                    "missing": all_summary["missing"]
                }
            },
            "targets": [
                {
                    "category": target.category,
                    "name": target.name,
                    "normalizedKey": target.normalized_key,
                    "outputRelPath": target.output_rel_path,
                    "sources": list(target.sources)
                }
                for target in all_targets
            ]
        }
        write_json(Path(args.out_manifest), payload)
        print(f"  Manifest written: {Path(args.out_manifest)}")

    return 0


def command_jobs(args: argparse.Namespace) -> int:
    targets = build_targets(args.category, include_race_features=args.include_race_features)

    if args.category == "feats":
        lookup = icon_lookup_for_category("feats")
    elif args.category == "races":
        lookup = icon_lookup_for_category("races")
    else:
        lookup = icon_lookup_for_category("all")

    selected = []
    for target in targets:
        if args.missing_only and target.normalized_key in lookup:
            continue
        selected.append(target)

    if args.limit is not None and args.limit >= 0:
        selected = selected[: args.limit]

    output_dir = Path(args.out_dir)
    ensure_dir(output_dir)

    if not selected:
        print("No targets selected. Nothing to write.")
        return 0

    chunks = split_chunks(selected, args.chunk_size)
    written_files: List[Path] = []

    for chunk_index, chunk in enumerate(chunks, start=1):
        rows = []
        for target in chunk:
            rows.append(
                {
                    "prompt": build_prompt(target),
                    "out": target.output_filename,
                    "size": args.size,
                    "quality": args.quality
                }
            )

        filename = f"{args.category}-icons-{chunk_index:03d}.jsonl"
        file_path = output_dir / filename
        write_jsonl(file_path, rows)
        written_files.append(file_path)

    print(f"Selected targets: {len(selected)}")
    print(f"Chunks written: {len(written_files)} (chunk size: {args.chunk_size})")
    for path in written_files:
        print(f"  - {path}")

    if args.print_commands:
        print("")
        print("Run commands:")
        image_cli = args.image_cli or r"$CODEX_HOME/skills/.system/imagegen/scripts/image_gen.py"
        if args.category == "feats":
            out_target = ICONS_DIR / FEATS_OUTPUT_SUBDIR
        elif args.category == "races":
            out_target = ICONS_DIR / RACES_OUTPUT_SUBDIR
        else:
            out_target = ICONS_DIR

        for path in written_files:
            print(
                "python \"{cli}\" generate-batch --input \"{inp}\" --out-dir \"{outdir}\" --concurrency {conc} "
                "--size {size} --quality {quality}".format(
                    cli=image_cli,
                    inp=path.resolve(),
                    outdir=out_target.resolve(),
                    conc=args.concurrency,
                    size=args.size,
                    quality=args.quality
                )
            )

    return 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Audit and prepare icon generation jobs.")
    subparsers = parser.add_subparsers(dest="command", required=True)

    audit = subparsers.add_parser("audit", help="Show icon coverage summary.")
    audit.add_argument(
        "--include-race-features",
        action=argparse.BooleanOptionalAction,
        default=True,
        help="Include race ability/option items in race targets (default: on)."
    )
    audit.add_argument("--show-examples", type=int, default=15, help="How many missing names to print.")
    audit.add_argument(
        "--out-manifest",
        default=str(ROOT_DIR / "tmp" / "imagegen" / "icon-audit-manifest.json"),
        help="Optional path to write manifest JSON."
    )
    audit.set_defaults(func=command_audit)

    jobs = subparsers.add_parser("jobs", help="Build JSONL files for batch image generation.")
    jobs.add_argument("--category", choices=["feats", "races"], default="feats")
    jobs.add_argument(
        "--include-race-features",
        action=argparse.BooleanOptionalAction,
        default=True,
        help="Include race ability/option items in race targets (default: on)."
    )
    jobs.add_argument("--missing-only", action="store_true", help="Generate jobs only for missing icons.")
    jobs.add_argument("--limit", type=int, default=None, help="Limit number of selected targets.")
    jobs.add_argument("--chunk-size", type=int, default=40, help="Targets per JSONL file.")
    jobs.add_argument("--size", default=DEFAULT_SIZE, help="Image size for jobs.")
    jobs.add_argument("--quality", default=DEFAULT_QUALITY, help="Image quality for jobs.")
    jobs.add_argument("--concurrency", type=int, default=4, help="Suggested concurrency for batch runs.")
    jobs.add_argument(
        "--out-dir",
        default=str(ROOT_DIR / "tmp" / "imagegen" / "jobs"),
        help="Directory where JSONL files will be written."
    )
    jobs.add_argument("--print-commands", action="store_true", help="Print ready-to-run CLI commands.")
    jobs.add_argument(
        "--image-cli",
        default="",
        help="Optional explicit path to image_gen.py. If omitted, prints $CODEX_HOME variant."
    )
    jobs.set_defaults(func=command_jobs)

    return parser


def main() -> int:
    parser = build_parser()
    args = parser.parse_args()
    return args.func(args)


if __name__ == "__main__":
    raise SystemExit(main())
