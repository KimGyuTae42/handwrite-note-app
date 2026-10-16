import io, zipfile, os, csv
import numpy as np
from PIL import Image

SIZE = 32
PER_CLASS_CAP = 150  # HASY는 클래스당 최대 이만큼만 사용 (이전 학습과 동일한 방침)

KOREAN_JAMO_MAP = {
    "g": "ㄱ", "gg": "ㄲ", "n": "ㄴ", "d": "ㄷ", "r": "ㄹ", "m": "ㅁ",
    "b": "ㅂ", "bb": "ㅃ", "s": "ㅅ", "ss": "ㅆ", "ng": "ㅇ", "j": "ㅈ",
    "ch": "ㅊ", "k": "ㅋ", "t": "ㅌ", "p": "ㅍ", "h": "ㅎ",
    "a": "ㅏ", "ae": "ㅐ", "ya": "ㅑ", "yae": "ㅒ", "eo": "ㅓ", "e": "ㅔ",
    "o": "ㅗ", "yo": "ㅛ", "u": "ㅜ", "yu": "ㅠ", "eu": "ㅡ", "i": "ㅣ", "ye": "ㅖ",
}
# HASY latex -> (클래스명, 표시문자)
HASY_SYMBOLS = {
    "+": ("sym_plus", "+"), "-": ("sym_minus", "-"), "<": ("sym_lt", "<"), ">": ("sym_gt", ">"),
    "[": ("sym_lbracket", "["), "]": ("sym_rbracket", "]"),
    "\\{": ("sym_lbrace", "{"), "\\}": ("sym_rbrace", "}"),
    "|": ("sym_bar", "|"), "/": ("sym_slash", "/"),
}


def load_square32(raw_bytes):
    im = Image.open(io.BytesIO(raw_bytes)).convert("L")
    w, h = im.size
    side = max(w, h)
    padded = Image.new("L", (side, side), 255)
    padded.paste(im, ((side - w) // 2, (side - h) // 2))
    padded = padded.resize((SIZE, SIZE), Image.LANCZOS)
    return np.asarray(padded, dtype=np.uint8)


out = {}      # class_name -> list of arrays
display = {}  # class_name -> display char

# ---------- 한글 자모 (archive.zip) ----------
with zipfile.ZipFile("/mnt/user-data/uploads/archive.zip") as z:
    for n in z.namelist():
        if not n.endswith(".jpg"):
            continue
        base = os.path.basename(n)
        cls = base.rsplit("_", 2)[0]
        if cls not in KOREAN_JAMO_MAP:
            continue
        name = f"ko_{cls}"
        out.setdefault(name, []).append(load_square32(z.read(n)))
        display[name] = KOREAN_JAMO_MAP[cls]
print("한글 자모 클래스:", sum(1 for k in out if k.startswith("ko_")))

# ---------- HASY (archive__2_.zip) ----------
rng = np.random.default_rng(42)
with zipfile.ZipFile("/mnt/user-data/uploads/archive__2_.zip") as z:
    rows = list(csv.DictReader(io.StringIO(z.read("hasy-data-labels.csv").decode("utf-8"))))
    by_latex = {}
    for r in rows:
        by_latex.setdefault(r["latex"], []).append(r["path"])

    def take(latex):
        paths = by_latex.get(latex, [])
        paths = list(paths)
        rng.shuffle(paths)
        return paths[:PER_CLASS_CAP]

    # 숫자
    for d in "0123456789":
        name = f"num_{d}"
        out[name] = [load_square32(z.read(p)) for p in take(d)]
        display[name] = d
    # 영문 대/소문자
    for i in range(26):
        up, lo = chr(65 + i), chr(97 + i)
        out[f"up_{up}"] = [load_square32(z.read(p)) for p in take(up)]
        display[f"up_{up}"] = up
        out[f"lo_{lo}"] = [load_square32(z.read(p)) for p in take(lo)]
        display[f"lo_{lo}"] = lo
    # 기호
    for latex, (name, ch) in HASY_SYMBOLS.items():
        out[name] = [load_square32(z.read(p)) for p in take(latex)]
        display[name] = ch

total = 0
for k in sorted(out):
    total += len(out[k])
print("클래스 수:", len(out), "총 샘플:", total)
small = {k: len(v) for k, v in out.items() if len(v) < 40}
print("샘플 40장 미만 클래스:", small)

np.savez_compressed(
    "/home/claude/newdata/old_raw.npz",
    **{k: np.array(v, dtype=np.uint8) for k, v in out.items()},
)
import json
json.dump(display, open("/home/claude/newdata/old_display.json", "w", encoding="utf-8"), ensure_ascii=False)
print("저장 완료")
