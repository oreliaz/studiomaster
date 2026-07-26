import unittest

from ai_workers.cuts import marker_to_cut_line, markers_to_cuts_txt
from ai_workers.models import Marker


class TestCuts(unittest.TestCase):
    def test_line_window_ends_at_marker(self):
        line = marker_to_cut_line(Marker(12_700, "fix", "טעות בשם"), pre_ms=4000)
        self.assertEqual(line, "0:08.7 0:12.7 טעות בשם")

    def test_clamps_start_to_zero(self):
        line = marker_to_cut_line(Marker(2000, "fix"), pre_ms=4000)
        self.assertEqual(line, "0:00.0 0:02.0 editor-marked")

    def test_minutes_formatting(self):
        line = marker_to_cut_line(Marker(125_400, "fix", "x"), pre_ms=0)
        self.assertEqual(line, "2:05.4 2:05.4 x")

    def test_only_fix_markers_sorted(self):
        markers = [
            Marker(20_000, "highlight"),
            Marker(9000, "fix", "b"),
            Marker(1000, "fix", "a"),
            Marker(5000, "chapter"),
        ]
        txt = markers_to_cuts_txt(markers, pre_ms=1000)
        self.assertEqual(txt, "0:00.0 0:01.0 a\n0:08.0 0:09.0 b\n")

    def test_empty(self):
        self.assertEqual(markers_to_cuts_txt([]), "")


if __name__ == "__main__":
    unittest.main()
