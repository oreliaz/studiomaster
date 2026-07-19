import unittest

from ai_workers.edl import (
    build_edl,
    chapters_from_markers,
    complement,
    fix_windows,
    highlight_segments,
    merge_windows,
)
from ai_workers.models import DEFAULT_TEMPLATE, DeliverableTemplate, Marker


class TestMergeWindows(unittest.TestCase):
    def test_merges_overlapping_and_adjacent(self):
        self.assertEqual(
            merge_windows([(0, 100), (50, 150), (200, 300)]),
            [(0, 150), (200, 300)],
        )

    def test_empty(self):
        self.assertEqual(merge_windows([]), [])


class TestFixWindows(unittest.TestCase):
    def test_pads_clamps_and_merges(self):
        markers = [Marker(5000, "fix"), Marker(6000, "fix")]
        # pad 2000 → (3000,7000) & (4000,8000) merge → (3000,8000)
        self.assertEqual(fix_windows(markers, 60_000, pad_ms=2000), [(3000, 8000)])

    def test_clamps_to_bounds(self):
        self.assertEqual(fix_windows([Marker(500, "fix")], 10_000, pad_ms=2000), [(0, 2500)])


class TestComplement(unittest.TestCase):
    def test_keeps_gaps_between_removed_windows(self):
        keep = complement(10_000, [(2000, 4000)])
        self.assertEqual([(s.start_ms, s.end_ms) for s in keep], [(0, 2000), (4000, 10_000)])

    def test_remove_at_start(self):
        keep = complement(10_000, [(0, 3000)])
        self.assertEqual([(s.start_ms, s.end_ms) for s in keep], [(3000, 10_000)])

    def test_no_removals_keeps_whole(self):
        keep = complement(10_000, [])
        self.assertEqual([(s.start_ms, s.end_ms) for s in keep], [(0, 10_000)])


class TestHighlights(unittest.TestCase):
    def test_clip_per_marker_clamped(self):
        segs = highlight_segments([Marker(20_000, "highlight")], 60_000, pre_ms=15_000, post_ms=30_000)
        self.assertEqual([(s.start_ms, s.end_ms) for s in segs], [(5000, 50_000)])

    def test_limit(self):
        markers = [Marker(t, "highlight") for t in (20_000, 120_000, 220_000)]
        segs = highlight_segments(markers, 300_000, pre_ms=1000, post_ms=1000, limit=2)
        self.assertEqual(len(segs), 2)


class TestChapters(unittest.TestCase):
    def test_sorted_with_titles(self):
        markers = [Marker(9000, "chapter", "שני"), Marker(1000, "chapter", "ראשון")]
        chapters = chapters_from_markers(markers)
        self.assertEqual([(c.start_ms, c.title) for c in chapters], [(1000, "ראשון"), (9000, "שני")])

    def test_default_titles(self):
        chapters = chapters_from_markers([Marker(1000, "chapter")])
        self.assertEqual(chapters[0].title, "פרק 1")


class TestBuildEdl(unittest.TestCase):
    def test_respects_template(self):
        markers = [Marker(5000, "fix"), Marker(20_000, "highlight"), Marker(1000, "chapter", "פתיחה")]
        edl = build_edl("mix.mp4", markers, 60_000, DEFAULT_TEMPLATE)
        self.assertTrue(edl.full_edit)
        self.assertEqual(len(edl.highlights), 1)
        self.assertEqual(len(edl.chapters), 1)

    def test_template_disables_sections(self):
        template = DeliverableTemplate(full_edit=False, highlights=0, chapters=False)
        edl = build_edl("mix.mp4", [Marker(5000, "fix")], 60_000, template)
        self.assertEqual(edl.full_edit, [])
        self.assertEqual(edl.highlights, [])
        self.assertEqual(edl.chapters, [])


if __name__ == "__main__":
    unittest.main()
