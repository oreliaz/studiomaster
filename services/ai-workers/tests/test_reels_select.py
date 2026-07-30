import unittest

from ai_workers.reels_select import ClipPick, normalize_clips


class NormalizeClipsTest(unittest.TestCase):
    def test_lengths_pulled_into_bounds(self):
        raw = [
            {"start": 10, "end": 12, "hook": "too short", "title": "A"},   # 2s -> min
            {"start": 200, "end": 400, "hook": "too long", "title": "B"},  # 200s -> max
        ]
        picks = normalize_clips(raw, duration_s=1000, count=10, min_s=40, max_s=70)
        self.assertEqual(len(picks), 2)
        self.assertAlmostEqual(picks[0].end_s - picks[0].start_s, 40, delta=0.1)
        self.assertAlmostEqual(picks[1].end_s - picks[1].start_s, 70, delta=0.1)

    def test_overlaps_are_dropped(self):
        raw = [
            {"start": 0, "end": 50, "title": "A"},
            {"start": 30, "end": 90, "title": "B"},   # overlaps A -> dropped
            {"start": 100, "end": 150, "title": "C"},
        ]
        picks = normalize_clips(raw, duration_s=1000, count=10, min_s=40, max_s=70)
        self.assertEqual([p.start_s for p in picks], [0.0, 100.0])

    def test_count_cap_and_sort(self):
        raw = [
            {"start": 300, "end": 350, "title": "late"},
            {"start": 10, "end": 60, "title": "early"},
            {"start": 150, "end": 200, "title": "mid"},
        ]
        picks = normalize_clips(raw, duration_s=1000, count=2, min_s=40, max_s=70)
        self.assertEqual(len(picks), 2)
        self.assertEqual([p.start_s for p in picks], [10.0, 150.0])  # sorted, capped

    def test_clamped_to_duration(self):
        raw = [{"start": 980, "end": 1100, "title": "tail"}]
        picks = normalize_clips(raw, duration_s=1000, count=5, min_s=40, max_s=70)
        self.assertTrue(all(p.end_s <= 1000 for p in picks))

    def test_bad_entries_skipped(self):
        raw = [
            {"start": "x", "end": 50, "title": "bad-start"},
            {"end": 50, "title": "no-start"},
            {"start": 60, "end": 30, "title": "reversed"},
            {"start": 100, "end": 160, "title": "ok"},
        ]
        picks = normalize_clips(raw, duration_s=1000, count=5, min_s=40, max_s=70)
        self.assertEqual(len(picks), 1)
        self.assertIsInstance(picks[0], ClipPick)

    def test_ascii_slug_fallback_for_non_ascii_title(self):
        raw = [{"start": 10, "end": 60, "hook": "שלום", "title": "כותרת בעברית"}]
        picks = normalize_clips(raw, duration_s=1000, count=5, min_s=40, max_s=70)
        self.assertEqual(picks[0].slug, "clip01")    # non-ascii -> deterministic fallback
        self.assertEqual(picks[0].hook, "שלום")       # hook keeps the original language


if __name__ == "__main__":
    unittest.main()
