import unittest

from ai_workers.models import Segment
from ai_workers.render import clip_args, trim_concat_args, vertical_reframe_args


class TestTrimConcat(unittest.TestCase):
    def test_builds_filter_complex_for_each_segment(self):
        args = trim_concat_args("in.mp4", [Segment(0, 2000), Segment(4000, 6000)], "out.mp4")
        self.assertEqual(args[0], "ffmpeg")
        self.assertIn("-filter_complex", args)
        fg = args[args.index("-filter_complex") + 1]
        self.assertIn("trim=start=0.000:end=2.000", fg)
        self.assertIn("trim=start=4.000:end=6.000", fg)
        self.assertIn("concat=n=2:v=1:a=1[outv][outa]", fg)
        self.assertIn("[outv]", args)
        self.assertIn("[outa]", args)

    def test_raises_without_segments(self):
        with self.assertRaises(ValueError):
            trim_concat_args("in.mp4", [], "out.mp4")


class TestClip(unittest.TestCase):
    def test_seek_before_input(self):
        args = clip_args("in.mp4", Segment(5000, 8000), "clip.mp4")
        self.assertEqual(args[:2], ["ffmpeg", "-y"])
        self.assertIn("-ss", args)
        self.assertEqual(args[args.index("-ss") + 1], "5.000")
        self.assertEqual(args[args.index("-to") + 1], "8.000")
        # -ss must come before -i for fast seeking
        self.assertLess(args.index("-ss"), args.index("-i"))


class TestVerticalReframe(unittest.TestCase):
    def test_crop_to_9_16(self):
        args = vertical_reframe_args("in.mp4", "short.mp4", width=1080, height=1920)
        vf = args[args.index("-vf") + 1]
        self.assertIn("crop=1080:1920", vf)


if __name__ == "__main__":
    unittest.main()
