from pathlib import Path
import sys
import unittest

from PIL import Image, ImageChops, ImageStat

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "tools"))

from render_travel_landscapes import (  # noqa: E402
    CANVAS,
    FRAME_COUNT,
    make_seamless_tile,
    render_frame,
)


class TravelLandscapeRendererTests(unittest.TestCase):
    def setUp(self):
        self.source = Image.new("RGB", (960, 540))
        pixels = self.source.load()
        for y in range(self.source.height):
            for x in range(self.source.width):
                pixels[x, y] = (
                    x % 256,
                    y % 256,
                    (x + y) % 256,
                )

    def test_renderer_targets_the_inventory_header_aspect_ratio(self):
        self.assertEqual(CANVAS, (1920, 450))
        self.assertEqual(FRAME_COUNT, 450)
        tile = make_seamless_tile(self.source, *CANVAS)
        frame = render_frame(tile, 0)
        self.assertEqual(frame.size, CANVAS)
        self.assertEqual(frame.mode, "RGB")

    def test_tile_edges_match_for_a_loop_safe_horizontal_wrap(self):
        tile = make_seamless_tile(self.source, *CANVAS)
        edge_delta = ImageChops.difference(
            tile.crop((0, 0, 1, tile.height)),
            tile.crop((tile.width - 1, 0, tile.width, tile.height)),
        )
        self.assertLessEqual(sum(ImageStat.Stat(edge_delta).mean), 1.0)

    def test_renderer_does_not_draw_a_baked_window_frame(self):
        tile = make_seamless_tile(self.source, *CANVAS)
        frame = render_frame(tile, 0)
        self.assertNotEqual(
            frame.getpixel((0, 0)),
            frame.getpixel((CANVAS[0] // 2, 0)),
        )

    def test_last_frame_transitions_to_first_as_smoothly_as_adjacent_frames(self):
        tile = make_seamless_tile(self.source, *CANVAS)
        first = render_frame(tile, 0)
        adjacent = render_frame(tile, 1)
        last = render_frame(tile, FRAME_COUNT - 1)
        adjacent_difference = sum(
            ImageStat.Stat(ImageChops.difference(first, adjacent)).mean
        )
        boundary_difference = sum(
            ImageStat.Stat(ImageChops.difference(last, first)).mean
        )
        self.assertLessEqual(boundary_difference, adjacent_difference * 1.25)


if __name__ == "__main__":
    unittest.main()
