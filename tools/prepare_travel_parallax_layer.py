from __future__ import annotations

import argparse
import math
from pathlib import Path

from PIL import Image


CANVAS = (1920, 450)
SEAM_BLEND = 192
RESAMPLING = Image.Resampling


def cover_resize(source: Image.Image, *, opaque: bool) -> Image.Image:
    if not opaque:
        image = source.convert("RGBA")
        alpha_bounds = image.getchannel("A").getbbox()
        if alpha_bounds is None:
            raise ValueError("Transparent parallax layer contains no visible pixels")
        subject_top = alpha_bounds[1]
        subject = image.crop((0, subject_top, image.width, image.height))
        subject_height_ratio = subject.height / image.height
        target_height = max(1, round(CANVAS[1] * subject_height_ratio))
        resized = subject.resize((CANVAS[0], target_height), RESAMPLING.LANCZOS)
        canvas = Image.new("RGBA", CANVAS, (0, 0, 0, 0))
        canvas.paste(resized, (0, CANVAS[1] - target_height))
        return canvas

    image = source.convert("RGB")
    scale = max(CANVAS[0] / image.width, CANVAS[1] / image.height)
    resized = image.resize(
        (math.ceil(image.width * scale), math.ceil(image.height * scale)),
        RESAMPLING.LANCZOS,
    )
    left = (resized.width - CANVAS[0]) // 2
    top = (resized.height - CANVAS[1]) // 2
    return resized.crop((left, top, left + CANVAS[0], top + CANVAS[1]))


def make_horizontal_tile(source: Image.Image, *, opaque: bool) -> Image.Image:
    base = cover_resize(source, opaque=opaque)
    width, height = CANVAS
    half = width // 2
    overlap = min(SEAM_BLEND, half - 1)
    left_segment = base.crop((half, 0, width, height))
    right_segment = base.crop((0, 0, half, height))
    merged = Image.new(base.mode, (width - overlap, height))
    merged.paste(left_segment, (0, 0))

    ramp = Image.new("L", (overlap, 1))
    ramp.putdata([
        round(255 * index / max(1, overlap - 1))
        for index in range(overlap)
    ])
    ramp = ramp.resize((overlap, height))
    overlap_x = left_segment.width - overlap
    blended = Image.composite(
        right_segment.crop((0, 0, overlap, height)),
        left_segment.crop((overlap_x, 0, left_segment.width, height)),
        ramp,
    )
    merged.paste(blended, (overlap_x, 0))
    merged.paste(
        right_segment.crop((overlap, 0, right_segment.width, height)),
        (left_segment.width, 0),
    )

    tile = merged.resize(CANVAS, RESAMPLING.LANCZOS)
    tile.paste(tile.crop((0, 0, 1, height)), (width - 1, 0))
    return tile


def prepare_layer(source_path: Path, output_path: Path, *, opaque: bool) -> None:
    with Image.open(source_path) as source:
        layer = make_horizontal_tile(source, opaque=opaque)

    if layer.size != CANVAS:
        raise ValueError(f"Expected {CANVAS}, got {layer.size}")
    if not opaque:
        if "A" not in layer.getbands():
            raise ValueError("Transparent parallax layers require an alpha channel")
        if layer.getchannel("A").getextrema()[0] == 255:
            raise ValueError("Transparent parallax layers require transparent pixels")

    output_path.parent.mkdir(parents=True, exist_ok=True)
    layer.save(
        output_path,
        "WEBP",
        lossless=not opaque,
        quality=90,
        method=6,
        exact=True,
    )


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Prepare one independently generated travel parallax layer.",
    )
    parser.add_argument("--source", type=Path, required=True)
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--opaque", action="store_true")
    return parser.parse_args()


if __name__ == "__main__":
    args = parse_args()
    prepare_layer(args.source, args.out, opaque=args.opaque)
