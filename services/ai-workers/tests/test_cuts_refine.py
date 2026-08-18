import unittest

from ai_workers.cuts_refine import cuts_to_txt, fallback_cuts
from ai_workers.models import Marker

SEGMENTS = [
    {"start": 0.0, "end": 5.0, "text": "שלום וברוכים הבאים"},
    {"start": 5.0, "end": 12.0, "text": "היום נדבר על עסקים אבל רגע"},
    {"start": 12.0, "end": 20.0, "text": "בוא נתחיל שוב היום נדבר על עסקים"},
]


class FallbackCutsTest(unittest.TestCase):
    def test_snaps_start_to_sentence_containing_marker(self):
        # Marker at 11.5s falls inside the 5-12 sentence -> cut removes 5..11.5.
        cuts = fallback_cuts([Marker(tc_ms=11500, category="fix", note="פספוס")], SEGMENTS)
        self.assertEqual(len(cuts), 1)
        start, end, reason = cuts[0]
        self.assertAlmostEqual(start, 5.0, places=1)
        self.assertAlmostEqual(end, 11.5, places=1)
        self.assertEqual(reason, "פספוס")

    def test_marker_at_sentence_start_uses_pre_window(self):
        # Marker at 5.05s is right at a sentence boundary -> fall back to pre-window.
        cuts = fallback_cuts([Marker(tc_ms=5050, category="fix")], SEGMENTS, pre_ms=4000)
        start, end, _ = cuts[0]
        self.assertAlmostEqual(end, 5.05, delta=0.2)
        self.assertAlmostEqual(start, 1.05, delta=0.2)  # 5.05 - 4.0

    def test_no_segments_uses_pre_window(self):
        cuts = fallback_cuts([Marker(tc_ms=30000, category="fix")], [], pre_ms=4000)
        start, end, _ = cuts[0]
        self.assertAlmostEqual(start, 26.0, places=1)
        self.assertAlmostEqual(end, 30.0, places=1)

    def test_cuts_to_txt_format_and_dropping(self):
        txt = cuts_to_txt([(5.0, 11.5, "פספוס"), (20.0, 20.0, "zero")])
        lines = txt.strip().split("\n")
        self.assertEqual(len(lines), 1)  # zero-length cut dropped
        self.assertTrue(lines[0].startswith("0:05.0 0:11.5 "))


if __name__ == "__main__":
    unittest.main()
