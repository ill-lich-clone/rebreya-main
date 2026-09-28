#!/usr/bin/env python3
"""Import the approved feats Google Doc DOCX export into the Foundry JSON sources."""

from __future__ import annotations

import argparse
import copy
import datetime as dt
import html
import json
import re
import unicodedata
from collections import Counter
from pathlib import Path

from docx import Document
from docx.table import Table
from docx.text.paragraph import Paragraph
from docx.oxml.table import CT_Tbl
from docx.oxml.text.paragraph import CT_P


SECTION_KEYS = {
    "Младшие черты": "minor",
    "Общие черты": "general",
    "Старшие черты": "major",
    "Мультиклассовые черты": "multiclass",
    "Расовые черты": "racial",
    "Черты боевых стилей": "fightingStyle",
    "Культурные черты": "cultural",
    "Устаревшие материалы": "general",
}
SOURCE_NAME = "Черты V0.9"
EMPTY_MULTICLASS_FEATS = {"Рыцарь смерти", "Путь лича"}
IDENTIFIER_OVERRIDES = {
    "Посвящение в жречество": "posvyaschenie-v-zhrechestvo",
    "Посвящение в жреческую магию": "posvyaschenie-v-zhrecheskuyu-magiyu",
    "Посвящение в домен жреца": "posvyaschenie-v-domen-zhretsa",
    "Продолжение домена жреца": "prodolzhenie-domena-zhretsa",
    "Посвящение в божественный канал жреца": "posvyaschenie-v-bozhestvennyy-kanal-zhretsa",
    "Дикая медицина": "dikaya-meditsina",
    "Анонимность": "anonimnost",
}


def read_json(path: Path):
    return json.loads(path.read_text(encoding="utf-8"))


def write_json(path: Path, value) -> None:
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def write_sidecars(bundle_path: Path, summary: dict, feats: list[dict]) -> None:
    summary_path = bundle_path.with_name(bundle_path.name.replace("-bundle.json", "-summary.json"))
    report_path = bundle_path.with_name(bundle_path.name.replace("-bundle.json", "-problem-report.md"))
    write_json(summary_path, summary)
    lines = [
        f"# Отчёт по импорту «{SOURCE_NAME}»", "",
        f"- Всего исходных черт: **{len(feats)}**",
        "- Правила: **D&D 5e 2014**",
        "- Источник: утверждённая ревизия Google Docs, экспортированная в DOCX.",
        "- Стабильные identifiers и доступные метки сохранены из предыдущей версии.",
        "", "## Количество по разделам", "",
    ]
    lines.extend(f"- {name}: {count}" for name, count in summary["sections"].items())
    for title, predicate in (
        ("Пустые черты", lambda feat: not feat["description"]),
        ("Черты со звёздочкой / ручной проверкой", lambda feat: feat["wip"]),
        ("Черты с таблицами", lambda feat: feat["hasTables"]),
        ("Огнестрельные черты", lambda feat: feat["firearm"]),
    ):
        lines.extend(["", f"## {title}", ""])
        lines.extend(f"- {feat['name']}" for feat in feats if predicate(feat))
    lines.extend([
        "", "## Совместимость с правилами 2014", "",
        "- Везунчик сохраняет прежний текст Lucky 2014 вместо несовместимой версии PHB 2024.",
    ])
    report_path.write_text("\n".join(lines) + "\n", encoding="utf-8")


def normalize_name(value: str) -> str:
    return re.sub(r"\s+", " ", value.strip().rstrip("?")).casefold()


def parse_heading(raw_heading: str) -> dict:
    raw = re.sub(r"\s+", " ", raw_heading.strip())
    firearm = "🔫" in raw
    wip = raw.startswith("*") or raw.endswith("*")
    source_match = re.search(r"\[([^\]]+)]\s*\**\s*$", raw)
    source_raw = source_match.group(1).strip() if source_match else ""
    source_plus = source_raw.endswith("+")
    source = source_raw[:-1] if source_plus else source_raw
    name = re.sub(r"\s*\[[^\]]+]\s*\**\s*$", "", raw)
    name = name.replace("🔫", "").strip(" *\t")
    return {
        "name": re.sub(r"\s+", " ", name),
        "sourceRaw": source_raw,
        "source": source,
        "sourcePlus": source_plus,
        "firearm": firearm,
        "wip": wip,
    }


TRANSLITERATION = str.maketrans({
    "а": "a", "б": "b", "в": "v", "г": "g", "д": "d", "е": "e", "ё": "e",
    "ж": "zh", "з": "z", "и": "i", "й": "y", "к": "k", "л": "l", "м": "m",
    "н": "n", "о": "o", "п": "p", "р": "r", "с": "s", "т": "t", "у": "u",
    "ф": "f", "х": "h", "ц": "ts", "ч": "ch", "ш": "sh", "щ": "sch",
    "ъ": "", "ы": "y", "ь": "", "э": "e", "ю": "yu", "я": "ya",
})


def build_identifier(name: str) -> str:
    if name in IDENTIFIER_OVERRIDES:
        return IDENTIFIER_OVERRIDES[name]
    value = unicodedata.normalize("NFKD", name.casefold()).translate(TRANSLITERATION)
    value = "".join(char for char in value if not unicodedata.combining(char))
    return re.sub(r"[^a-z0-9]+", "-", value).strip("-")


def iter_body(document):
    for child in document.element.body.iterchildren():
        if isinstance(child, CT_P):
            yield Paragraph(child, document)
        elif isinstance(child, CT_Tbl):
            yield Table(child, document)


def paragraph_is_list(paragraph: Paragraph) -> bool:
    props = paragraph._p.pPr
    return bool(props is not None and props.numPr is not None)


def paragraph_html(paragraph: Paragraph) -> str:
    text = paragraph.text.strip()
    if not text:
        return ""
    return html.escape(text).replace("\n", "<br>")


def table_html(table: Table) -> str:
    rows = []
    for row in table.rows:
        cells = []
        for cell in row.cells:
            value = "<br>".join(filter(None, (paragraph_html(p) for p in cell.paragraphs)))
            cells.append(f"<td>{value}</td>")
        rows.append(f"<tr>{''.join(cells)}</tr>")
    return f"<table><tbody>{''.join(rows)}</tbody></table>"


def render_blocks(blocks) -> tuple[str, str | None, bool]:
    rendered = []
    list_items = []
    requirements = None
    has_tables = False

    def flush_list() -> None:
        nonlocal list_items
        if list_items:
            rendered.append("<ul>" + "".join(f"<li><p>{item}</p></li>" for item in list_items) + "</ul>")
            list_items = []

    for block in blocks:
        if isinstance(block, Table):
            flush_list()
            rendered.append(table_html(block))
            has_tables = True
            continue

        text = block.text.strip()
        if not text or re.fullmatch(r"Метки:\s*[,\s]*", text, flags=re.IGNORECASE):
            continue
        escaped = paragraph_html(block)
        requirement_match = re.match(r"^(Требовани(?:е|я)):\s*(.*)$", text, flags=re.IGNORECASE)
        if requirement_match and requirements is None:
            requirements = requirement_match.group(2).strip() or None
        if paragraph_is_list(block):
            list_items.append(escaped)
        else:
            flush_list()
            rendered.append(f"<p>{escaped}</p>")

    flush_list()
    return "".join(rendered), requirements, has_tables


def collect_feats(document) -> list[dict]:
    feats = []
    current_section = None
    current_subsection = None
    current = None

    def finish() -> None:
        nonlocal current
        if current is None:
            return
        description, requirements, has_tables = render_blocks(current.pop("blocks"))
        current.update(description=description, requirements=requirements, hasTables=has_tables)
        feats.append(current)
        current = None

    for block in iter_body(document):
        if isinstance(block, Paragraph):
            style = block.style.name
            text = block.text.strip()
            if style == "Heading 2":
                finish()
                current_section = text if text in SECTION_KEYS else None
                current_subsection = None
                continue
            if current_section is None:
                continue
            if current_section == "Мультиклассовые черты" and style == "Heading 3":
                parsed = parse_heading(text)
                if parsed["name"] in EMPTY_MULTICLASS_FEATS:
                    finish()
                    current = {**parsed, "rawHeading": text, "section": current_section,
                               "subsection": current_subsection, "blocks": []}
                else:
                    finish()
                    current_subsection = text
                continue
            is_feat_heading = style == "Heading 4" if current_section == "Мультиклассовые черты" else style == "Heading 3"
            if is_feat_heading:
                finish()
                parsed = parse_heading(text)
                current = {**parsed, "rawHeading": text, "section": current_section,
                           "subsection": current_subsection, "blocks": []}
                continue
        if current is not None:
            current["blocks"].append(block)

    finish()
    return feats


def blank_system(identifier: str, source: str, description: str, requirements: str | None) -> dict:
    return {
        "description": {"value": description, "chat": ""},
        "source": {"custom": source},
        "identifier": identifier,
        "type": {"value": "feat", "subtype": ""},
        "requirements": requirements,
        "prerequisites": {"items": [], "level": 0, "repeatable": False},
        "properties": [],
        "activities": {},
        "uses": {"spent": 0, "max": "", "recovery": []},
        "advancement": {},
    }


def build_item(feat: dict, existing: dict | None) -> dict:
    identifier = existing.get("system", {}).get("identifier") if existing else build_identifier(feat["name"])
    item = copy.deepcopy(existing) if existing else {
        "name": feat["name"], "type": "feat", "img": "icons/svg/book.svg", "folder": None,
        "effects": [], "flags": {},
    }
    item["name"] = feat["name"]
    item["type"] = "feat"
    item.setdefault("img", "icons/svg/book.svg")
    item["folder"] = None

    preserve_lucky_2014 = feat["name"] == "Везунчик" and existing is not None
    if not preserve_lucky_2014:
        prior_system = item.get("system", {})
        new_system = blank_system(identifier, feat["source"], feat["description"], feat["requirements"])
        for key in ("type", "prerequisites", "properties", "uses", "advancement"):
            if key in prior_system:
                new_system[key] = copy.deepcopy(prior_system[key])
        new_system["identifier"] = identifier
        new_system["activities"] = {}
        item["system"] = new_system
        item["effects"] = []

    flags = item.setdefault("flags", {})
    old_teyvankal = flags.get("teyvankal", {})
    parser_notes = list(old_teyvankal.get("parserNotes", []))
    if preserve_lucky_2014 and "Заменено на Lucky 2014" not in parser_notes:
        parser_notes.append("Заменено на Lucky 2014")
    flags["teyvankal"] = {
        "ruleset": "dnd5e-2014",
        "sourceDocument": SOURCE_NAME,
        "section": feat["section"],
        "sectionKey": SECTION_KEYS[feat["section"]],
        "subsection": feat["subsection"],
        "tags": copy.deepcopy(old_teyvankal.get("tags", [])),
        "sourceRaw": feat["sourceRaw"],
        "source": feat["source"],
        "sourcePlus": feat["sourcePlus"],
        "firearm": feat["firearm"],
        "wip": feat["wip"],
        "empty": not bool(feat["description"]),
        "deprecated": feat["section"] == "Устаревшие материалы",
        "rawHeading": feat["rawHeading"],
        "requiredFeatNames": copy.deepcopy(old_teyvankal.get("requiredFeatNames", [])),
        "hasTables": feat["hasTables"],
        "parserNotes": parser_notes,
    }
    flags.pop("rebreya-main", None)
    return item


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", required=True, type=Path)
    parser.add_argument("--bundle", required=True, type=Path)
    parser.add_argument("--items", required=True, type=Path)
    parser.add_argument("--document-id", required=True)
    parser.add_argument("--revision-id", required=True)
    args = parser.parse_args()

    bundle = read_json(args.bundle)
    old_items = [item for item in bundle["items"] if not item.get("flags", {}).get("rebreya-main", {}).get("choiceOption")]
    old_by_name = {normalize_name(item["name"]): item for item in old_items}
    feats = collect_feats(Document(args.input))
    if len(feats) != 411:
        raise RuntimeError(f"Expected 411 feats, parsed {len(feats)}")
    if len({normalize_name(feat['name']) for feat in feats}) != len(feats):
        raise RuntimeError("Duplicate feat names found in DOCX")

    imported = [build_item(feat, old_by_name.get(normalize_name(feat["name"]))) for feat in feats]
    identifiers = [item["system"]["identifier"] for item in imported]
    duplicates = [name for name, count in Counter(identifiers).items() if count > 1]
    if duplicates:
        raise RuntimeError(f"Duplicate identifiers: {duplicates}")

    section_counts = Counter(feat["section"] for feat in feats)
    generated_at = dt.datetime.now(dt.timezone.utc).isoformat()
    summary = {
        "sourceFile": SOURCE_NAME,
        "generatedAt": generated_at,
        "ruleset": "dnd5e-2014",
        "itemCount": len(imported),
        "sections": dict(section_counts),
        "emptyCount": sum(not feat["description"] for feat in feats),
        "wipCount": sum(feat["wip"] for feat in feats),
        "tableFeatCount": sum(feat["hasTables"] for feat in feats),
        "firearmCount": sum(feat["firearm"] for feat in feats),
        "notes": [
            "Все элементы созданы как Item type=feat.",
            "Основной текст сохранён в system.description.value.",
            "Требования сохранены в system.requirements и продублированы в начале описания.",
            "Стабильные identifiers и доступные метки сохранены из предыдущей версии.",
            "Везунчик сохранён в совместимой версии Lucky по правилам 2014 года.",
            "Пустые черты созданы только с названием.",
        ],
    }
    bundle.update({
        "schema": bundle.get("schema", "foundry-vtt-item-bundle-v1"),
        "ruleset": "dnd5e-2014",
        "sourceFile": SOURCE_NAME,
        "sourceDocumentId": args.document_id,
        "sourceRevisionId": args.revision_id,
        "generatedAt": generated_at,
        "summary": summary,
        "items": imported,
    })
    write_json(args.items, imported)
    write_json(args.bundle, bundle)
    write_sidecars(args.bundle, summary, feats)

    old_names = set(old_by_name)
    new_names = {normalize_name(feat["name"]): feat["name"] for feat in feats}
    print(json.dumps({
        "count": len(imported),
        "sections": dict(section_counts),
        "added": sorted(name for key, name in new_names.items() if key not in old_names),
        "removed": sorted(item["name"] for key, item in old_by_name.items() if key not in new_names),
    }, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
