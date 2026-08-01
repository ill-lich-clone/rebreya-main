from argparse import ArgumentParser
from pathlib import Path

from PIL import Image, ImageOps


def main() -> None:
    parser = ArgumentParser(description="Prepare the Transport header artwork.")
    parser.add_argument("--input", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    args = parser.parse_args()

    with Image.open(args.input) as source:
        rgb = source.convert("RGB")
        prepared = ImageOps.fit(
            rgb,
            (1920, 700),
            method=Image.Resampling.LANCZOS,
            centering=(0.52, 0.5),
        )

    args.output.parent.mkdir(parents=True, exist_ok=True)
    prepared.save(args.output, format="WEBP", quality=90, method=6)


if __name__ == "__main__":
    main()
