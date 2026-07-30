from __future__ import annotations

import argparse
import math
from pathlib import Path
import subprocess

from PIL import Image, ImageChops, ImageDraw


CANVAS = (1920, 450)
FRAME_COUNT = 450
FPS = 15
MIDGROUND_TOP = 205
FOREGROUND_TOP = 345
SEAM_BLEND = 260
RESAMPLING = Image.Resampling


def _cover_resize(source: Image.Image, width: int, height: int) -> Image.Image:
    image = source.convert("RGB")
    scale = max(width / image.width, height / image.height)
    resized = image.resize(
        (math.ceil(image.width * scale), math.ceil(image.height * scale)),
        RESAMPLING.LANCZOS,
    )
    left = (resized.width - width) // 2
    top = (resized.height - height) // 2
    return resized.crop((left, top, left + width, top + height))


def make_seamless_tile(
    source: Image.Image,
    width: int,
    height: int,
    blend_px: int = SEAM_BLEND,
) -> Image.Image:
    base = _cover_resize(source, width, height)
    half = width // 2
    overlap = min(max(2, blend_px), half - 1)
    left_segment = base.crop((half, 0, width, height))
    right_segment = base.crop((0, 0, half, height))
    merged = Image.new("RGB", (width - overlap, height))
    merged.paste(left_segment, (0, 0))
    ramp = Image.new("L", (overlap, 1))
    ramp.putdata(
        [round(255 * index / max(1, overlap - 1)) for index in range(overlap)]
    )
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
    tile = merged.resize((width, height), RESAMPLING.LANCZOS)
    tile.paste(tile.crop((0, 0, 1, height)), (width - 1, 0))
    return tile


def _scroll(tile: Image.Image, offset: int) -> Image.Image:
    return ImageChops.offset(tile, -(offset % tile.width), 0)


def _feather_mask(size: tuple[int, int], top: int, feather: int) -> Image.Image:
    width, height = size
    mask = Image.new("L", size, 0)
    draw = ImageDraw.Draw(mask)
    opaque_top = min(height, top + feather)
    draw.rectangle((0, opaque_top, width, height), fill=255)
    for y in range(top, opaque_top):
        alpha = round(255 * (y - top) / max(1, feather - 1))
        draw.line((0, y, width, y), fill=alpha)
    return mask


def _horizontal_smear(image: Image.Image, distance: int = 4) -> Image.Image:
    left = ImageChops.offset(image, -distance, 0)
    right = ImageChops.offset(image, distance, 0)
    return Image.blend(Image.blend(left, image, 0.5), right, 1 / 3)


def render_frame(
    tile: Image.Image,
    frame_index: int,
    frame_count: int = FRAME_COUNT,
) -> Image.Image:
    if tile.size != CANVAS:
        tile = tile.resize(CANVAS, RESAMPLING.LANCZOS)
    progress = frame_index / frame_count
    width, _height = CANVAS
    far = _scroll(tile, 0)
    middle = _scroll(tile, round(progress * width))
    near = _horizontal_smear(_scroll(tile, round(progress * width * 2)))
    landscape = far.copy()
    landscape.paste(
        middle,
        (0, 0),
        _feather_mask(CANVAS, MIDGROUND_TOP, 70),
    )
    landscape.paste(
        near,
        (0, 0),
        _feather_mask(CANVAS, FOREGROUND_TOP, 65),
    )
    vibration = round(math.sin(2 * math.pi * progress * 5))
    if vibration:
        landscape = ImageChops.offset(landscape, 0, vibration)
    return landscape.convert("RGB")


def encode_landscape(
    source_path: Path,
    video_path: Path,
    poster_path: Path,
) -> None:
    source = Image.open(source_path)
    tile = make_seamless_tile(source, *CANVAS)
    video_path.parent.mkdir(parents=True, exist_ok=True)
    poster_path.parent.mkdir(parents=True, exist_ok=True)
    poster = render_frame(tile, 0)
    poster.save(poster_path, "WEBP", quality=88, method=6)
    command = [
        "ffmpeg", "-y", "-v", "error",
        "-f", "rawvideo", "-pix_fmt", "rgb24",
        "-s:v", f"{CANVAS[0]}x{CANVAS[1]}",
        "-r", str(FPS), "-i", "-",
        "-an", "-c:v", "libvpx-vp9",
        "-b:v", "0", "-crf", "34",
        "-deadline", "good", "-cpu-used", "2",
        "-row-mt", "1", "-pix_fmt", "yuv420p",
        str(video_path),
    ]
    process = subprocess.Popen(command, stdin=subprocess.PIPE)
    try:
        assert process.stdin is not None
        for index in range(FRAME_COUNT):
            process.stdin.write(render_frame(tile, index).tobytes())
        process.stdin.close()
        return_code = process.wait()
    except BaseException:
        process.kill()
        process.wait()
        raise
    if return_code != 0:
        raise RuntimeError(f"ffmpeg exited with status {return_code}")


def _parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Render one panoramic Rebreya travel landscape.",
    )
    parser.add_argument("--source", type=Path, required=True)
    parser.add_argument("--video", type=Path, required=True)
    parser.add_argument("--poster", type=Path, required=True)
    return parser.parse_args()


if __name__ == "__main__":
    args = _parse_args()
    encode_landscape(args.source, args.video, args.poster)
