"""
Build a single self-contained RTL review page: <work>/review/index.html
One card per cut with an inline player for the SEAM (how the cut sounds) and for what's
REMOVED, plus timecode / reason / transcript excerpt. The editor opens it in a browser,
watches each seam, and writes keep / nudge / drop next to each card.

Usage:  python build_review_html.py <work_dir>
"""
import html, json, os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import load_json, fmt_tc


def main():
    work = sys.argv[1]
    plan = load_json(os.path.join(work, "edit_plan.json"))
    tj = load_json(os.path.join(work, "transcript.json"))
    segs = tj["segments"]

    def text_at(a, b, pad=6):
        return " ".join(s["text"] for s in segs
                        if s["start"] < b + pad and s["end"] > a - pad)

    cards = []
    for i, r in enumerate(plan["removals"], 1):
        a, b = r["start"], r["end"]
        excerpt = html.escape(text_at(a, b)[:400])
        reason = html.escape(r["reason"])
        cards.append(f"""
  <div class="card">
    <div class="hd"><span class="num">{i:02d}</span>
      <span class="tc">{fmt_tc(a)} → {fmt_tc(b)}</span>
      <span class="dur">({b-a:.1f}s)</span>
      <span class="decide">החלטה: ⬜ לאשר &nbsp; ⬜ להזיז ל־____ &nbsp; ⬜ לבטל</span>
    </div>
    <div class="reason">{reason}</div>
    <div class="vids">
      <figure><figcaption>התפר (איך הקאט יישמע)</figcaption>
        <video src="preview_{i:02d}.mp4" controls preload="none"></video></figure>
      <figure><figcaption>מה נמחק</figcaption>
        <video src="removed_{i:02d}.mp4" controls preload="none"></video></figure>
    </div>
    <details><summary>תמלול באזור</summary><p class="tr">{excerpt}</p></details>
  </div>""")

    doc = f"""<!doctype html><html lang="he" dir="rtl"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>עריכה בסיסית — בדיקת חיתוכים</title><style>
:root{{color-scheme:light dark}}
body{{font-family:'Assistant','Segoe UI',Arial,sans-serif;max-width:1000px;margin:0 auto;
padding:24px;line-height:1.5}}
h1{{margin:0 0 4px}} .sub{{opacity:.7;margin-bottom:20px}}
.card{{border:1px solid #8884;border-radius:12px;padding:16px;margin:14px 0}}
.hd{{display:flex;flex-wrap:wrap;gap:10px;align-items:center}}
.num{{background:#4f7cff;color:#fff;border-radius:8px;padding:2px 9px;font-weight:700}}
.tc{{font-family:monospace;font-size:1.05em;font-weight:700}}
.dur{{opacity:.6}} .decide{{margin-inline-start:auto;opacity:.85;font-size:.92em}}
.reason{{margin:8px 0;opacity:.9}}
.vids{{display:flex;gap:14px;flex-wrap:wrap}}
figure{{margin:0}} figcaption{{font-size:.85em;opacity:.7;margin-bottom:4px}}
video{{width:320px;max-width:46vw;border-radius:8px;background:#000}}
details{{margin-top:10px}} .tr{{opacity:.8;font-size:.92em;background:#8881;padding:10px;border-radius:8px}}
</style></head><body>
<h1>עריכה בסיסית — בדיקת חיתוכים</h1>
<div class="sub">גלם <b>{fmt_tc(plan['total_sec'])}</b> · אחרי חיתוך <b>{fmt_tc(plan['kept_sec'])}</b>
 · הוסר <b>{fmt_tc(plan['removed_sec'])}</b> ב־{plan['n_removals']} חיתוכים.
 עברו על כל תפר, וסמנו לאשר / להזיז / לבטל.</div>
{''.join(cards)}
</body></html>"""
    out = os.path.join(work, "review", "index.html")
    os.makedirs(os.path.dirname(out), exist_ok=True)
    with open(out, "w", encoding="utf-8") as f:
        f.write(doc)
    print(f"[review] -> {out}")


if __name__ == "__main__":
    main()
