"""
Group word-level transcription into CAPTIONS, then expose them for human review.

Caption rule (per the brief):
  * Up to 4 words per caption.
  * A new caption ALWAYS starts when a new sentence starts (we never merge words
    from two different sentences into one caption).
  * If one more word lets the WHOLE sentence fit in a single caption, do it
    (i.e. a sentence of <=5 words becomes ONE caption of 5). For longer sentences
    we chunk by 4 but never leave a lonely 1-word caption at the end (we merge it
    up so the tail caption holds 5).

Sentence boundaries are detected by end punctuation (.?!:…׃) and by long pauses
(> PAUSE_GAP seconds) between words, so it works even when the model omits
punctuation.

Two modes:
  build  (default): read <work>/words/*.json -> write <work>/captions/<NN>.json
                    AND <work>/subs_review.txt  (apply fixes.json first).
  apply           : re-read the (possibly hand-edited) <work>/subs_review.txt and
                    rebuild <work>/captions/<NN>.json, keeping the original timings.

Usage:
  python build_captions.py build <work> [<fixes.json> ...]
  python build_captions.py apply <work>
"""
import glob, json, os, re, sys

MAX_WORDS = 4
SOFT_KEEP = 5          # a sentence up to this many words stays as ONE caption
PAUSE_GAP = 0.8        # seconds of silence that also starts a new caption
SENT_END = tuple(".?!:…׃")
NUM_RE = re.compile(r"^[‏‎]?[₪$€]?\d[\d,\.]*[%KkMm]?\+?[₪$€]?$")


# ----------------------------- grouping -----------------------------
def split_sentences(words):
    """words: [{start,end,word}] -> list of sentences (each a list of words)."""
    sents, cur = [], []
    for i, w in enumerate(words):
        cur.append(w)
        ends_punct = w["word"].rstrip("\"')]").endswith(SENT_END)
        gap_next = (i + 1 < len(words)) and (words[i + 1]["start"] - w["end"] > PAUSE_GAP)
        if ends_punct or gap_next:
            sents.append(cur); cur = []
    if cur:
        sents.append(cur)
    return sents


def chunk_sentence(words):
    """Apply the 4-word / +1 / no-orphan rule to ONE sentence."""
    n = len(words)
    if n <= SOFT_KEEP:
        return [words]
    caps, i = [], 0
    while i < n:
        chunk = words[i:i + MAX_WORDS]
        i += MAX_WORDS
        if i == n - 1:                 # exactly one word would be left over
            chunk = chunk + words[i:i + 1]   # absorb it -> tail caption of 5
            i += 1
        caps.append(chunk)
    return caps


def group_clip(words):
    caps = []
    for sent in split_sentences(words):
        for chunk in chunk_sentence(sent):
            if not chunk:
                continue
            text = " ".join(w["word"] for w in chunk).strip()
            caps.append({"start": round(chunk[0]["start"], 3),
                         "end": round(chunk[-1]["end"], 3), "text": text})
    return caps


# ----------------------------- fixes -----------------------------
def load_fixes(paths):
    fixes = {}
    for p in paths:
        if p and os.path.exists(p):
            try:
                fixes.update(json.load(open(p, encoding="utf-8")))
            except Exception as e:
                print(f"[captions] WARN bad fixes {p}: {e}", file=sys.stderr)
    return fixes


def apply_fixes(text, fixes):
    for bad, good in fixes.items():
        text = re.sub(rf"(?<!\w){re.escape(bad)}(?!\w)", good, text)
    return text


def to_html(text):
    out = []
    for tok in text.split(" "):
        if NUM_RE.match(tok):
            out.append(f"<span class='hl'>{tok}</span>")
        else:
            out.append(tok)
    return " ".join(out)


# ----------------------------- io -----------------------------
def all_clip_ids(work):
    ids = []
    for p in sorted(glob.glob(os.path.join(work, "words", "*_words.json"))):
        ids.append(re.match(r"(\d{2}|\w+)_words\.json", os.path.basename(p)).group(1))
    return ids


def write_captions(work, nn, caps):
    d = os.path.join(work, "captions")
    os.makedirs(d, exist_ok=True)
    for c in caps:
        c["html"] = to_html(c["text"])
    json.dump(caps, open(os.path.join(d, f"{nn}.json"), "w", encoding="utf-8"),
              ensure_ascii=False, indent=1)


REVIEW_HEADER = """\
### עריכת כתוביות — ערוך רק את הטקסט שמופיע אחרי ה"|" האחרון בכל שורה. ###
# אל תיגע במספרי השורות או בתגי הזמן (Z ...).
# למחיקת שורה: השאר את הטקסט ריק (רק "|" בלי כלום אחריו).
# כשתסיים: שמור את הקובץ וכתוב "סיימתי" בצ'אט.
# ---------------------------------------------------------------
"""


def fmt(t):
    m, s = divmod(float(t), 60)
    return f"{int(m)}:{s:05.2f}"


def build(work, fixes_paths):
    fixes = load_fixes(fixes_paths)
    lines = [REVIEW_HEADER]
    idx = 0
    for nn in all_clip_ids(work):
        data = json.load(open(os.path.join(work, "words", f"{nn}_words.json"), encoding="utf-8"))
        words = [w for s in data["segments"] for w in s["words"]]
        caps = group_clip(words)
        for c in caps:
            c["text"] = apply_fixes(c["text"], fixes)
        write_captions(work, nn, caps)
        lines.append(f"\n========== CLIP {nn} ==========")
        for c in caps:
            idx += 1
            lines.append(f"{idx:03d} | {nn} | Z {fmt(c['start'])} -> {fmt(c['end'])} | {c['text']}")
    out = os.path.join(work, "subs_review.txt")
    open(out, "w", encoding="utf-8").write("\n".join(lines) + "\n")
    print(f"[captions] built {idx} captions across {len(all_clip_ids(work))} clips")
    print(f"[captions] review file -> {out}")


LINE_RE = re.compile(r"^\d{3}\s*\|\s*(\S+)\s*\|\s*Z\s*([\d:.]+)\s*->\s*([\d:.]+)\s*\|(.*)$")


def parse_t(s):
    m, sec = s.split(":"); return round(int(m) * 60 + float(sec), 3)


def apply(work):
    review = os.path.join(work, "subs_review.txt")
    per_clip = {}
    for ln in open(review, encoding="utf-8"):
        m = LINE_RE.match(ln.strip())
        if not m:
            continue
        nn, a, b, text = m.group(1), m.group(2), m.group(3), m.group(4).strip()
        if not text:
            continue  # deleted line
        per_clip.setdefault(nn, []).append(
            {"start": parse_t(a), "end": parse_t(b), "text": text})
    for nn, caps in per_clip.items():
        write_captions(work, nn, caps)
    print(f"[captions] applied edits -> {sum(len(v) for v in per_clip.values())} "
          f"captions across {len(per_clip)} clips")


if __name__ == "__main__":
    mode = sys.argv[1] if len(sys.argv) > 1 else "build"
    work = sys.argv[2]
    if mode == "apply":
        apply(work)
    else:
        build(work, sys.argv[3:])
