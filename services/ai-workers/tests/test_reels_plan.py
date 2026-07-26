import unittest

from ai_workers.models import Marker
from ai_workers.reels_plan import propose_specs, spec_to_arg


class TestReelsPlan(unittest.TestCase):
    def test_uses_highlight_markers_as_centers(self):
        markers = [Marker(120_000, "highlight"), Marker(300_000, "highlight")]
        specs = propose_specs(markers, 600_000, count=2, min_s=40, max_s=70)
        self.assertEqual(len(specs), 2)
        # 55s clip centered on 120s → [92.5, 147.5]
        self.assertEqual(specs[0][1], 92.5)
        self.assertEqual(specs[0][2], 147.5)

    def test_fills_when_not_enough_markers(self):
        specs = propose_specs([Marker(60_000, "highlight")], 600_000, count=5)
        self.assertEqual(len(specs), 5)

    def test_clamps_to_bounds(self):
        specs = propose_specs([Marker(1000, "highlight")], 600_000, count=1, min_s=40, max_s=70)
        self.assertEqual(specs[0][1], 0.0)  # start clamps to 0
        self.assertEqual(specs[0][2], 55.0)

    def test_spec_to_arg(self):
        self.assertEqual(spec_to_arg((1, 92.5, 147.5, "clip01")), "01:92.5:147.5:clip01")

    def test_empty_duration(self):
        self.assertEqual(propose_specs([Marker(1000, "highlight")], 0, count=5), [])


if __name__ == "__main__":
    unittest.main()
