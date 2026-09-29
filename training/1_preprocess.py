import os
import glob
import json
import numpy as np
from PIL import Image

SIZE = 32
RAW = "/home/claude/dataset_raw"
OUT = "/home/claude/dataset_processed"
os.makedirs(OUT, exist_ok=True)

# 클래스명 -> 실제로 화면에 표시할 문자
KOREAN_JAMO_MAP = {
    "g": "ㄱ", "gg": "ㄲ", "n": "ㄴ", "d": "ㄷ", "r": "ㄹ", "m": "ㅁ",
    "b": "ㅂ", "bb": "ㅃ", "s": "ㅅ", "ss": "ㅆ", "ng": "ㅇ", "j": "ㅈ",
    "ch": "ㅊ", "k": "ㅋ", "t": "ㅌ", "p": "ㅍ", "h": "ㅎ",
    "a": "ㅏ", "ae": "ㅐ", "ya": "ㅑ", "yae": "ㅒ", "eo": "ㅓ", "e": "ㅔ",
    "o": "ㅗ", "yo": "ㅛ", "u": "ㅜ", "yu": "ㅠ", "eu": "ㅡ", "i": "ㅣ", "ye": "ㅖ",
}
SYMBOL_MAP = {
    "plus": "+", "minus": "-", "lt": "<", "gt": ">",
    "lbracket": "[", "rbracket": "]", "lbrace": "{", "rbrace": "}",
    "bar": "|", "slash": "/",
}


def load_and_resize(path):
    im = Image.open(path).convert("L")
    # 정사각형으로 패딩 후 리사이즈 (비율 유지)
    w, h = im.size
    side = max(w, h)
    padded = Image.new("L", (side, side), 255)
    padded.paste(im, ((side - w) // 2, (side - h) // 2))
    padded = padded.resize((SIZE, SIZE), Image.LANCZOS)
    arr = np.asarray(padded, dtype=np.uint8)
    return arr


samples = []  # (array, class_name, display_char, source)

# 1) 한글 자모
for f in glob.glob(f"{RAW}/jamo/hangul_characters_v1/*.jpg"):
    base = os.path.basename(f)
    cls = base.rsplit("_", 2)[0]
    if cls not in KOREAN_JAMO_MAP:
        continue
    samples.append((load_and_resize(f), f"ko_{cls}", KOREAN_JAMO_MAP[cls], "jamo"))

# 2) 영문/숫자
for d in glob.glob(f"{RAW}/alnum/*"):
    cls = os.path.basename(d)
    if cls.endswith("_caps"):
        ch = cls[0].upper()
        name = f"up_{cls[0]}"
    elif cls.isdigit():
        ch = cls
        name = f"num_{cls}"
    else:
        ch = cls
        name = f"lo_{cls}"
    for f in glob.glob(f"{d}/*.png"):
        samples.append((load_and_resize(f), name, ch, "alnum"))

# 3) 기호
for d in glob.glob(f"{RAW}/symbols/*"):
    cls = os.path.basename(d)
    if cls not in SYMBOL_MAP:
        continue
    for f in glob.glob(f"{d}/*.png"):
        samples.append((load_and_resize(f), f"sym_{cls}", SYMBOL_MAP[cls], "symbol"))

print("total samples:", len(samples))

class_names = sorted(set(s[1] for s in samples))
class_to_idx = {c: i for i, c in enumerate(class_names)}
display_map = {}
for _, cls, ch, _ in samples:
    display_map[cls] = ch

print("total classes:", len(class_names))

# numpy 배열로 합치기
N = len(samples)
images = np.zeros((N, SIZE, SIZE), dtype=np.uint8)
labels = np.zeros((N,), dtype=np.int32)
for i, (arr, cls, ch, src) in enumerate(samples):
    images[i] = arr
    labels[i] = class_to_idx[cls]

# 셔플 후 저장
rng = np.random.default_rng(42)
perm = rng.permutation(N)
images = images[perm]
labels = labels[perm]

# 클래스별 최대 개수 제한 (학습 속도를 위해 - CPU 전용 환경)
CAP_PER_CLASS = 300  # 사실상 제한 없음 (가장 큰 클래스도 220장)
keep_idx = []
per_class_count = {}
for i in range(N):
    c = int(labels[i])
    cnt = per_class_count.get(c, 0)
    if cnt < CAP_PER_CLASS:
        keep_idx.append(i)
        per_class_count[c] = cnt + 1
keep_idx = np.array(keep_idx)
images = images[keep_idx]
labels = labels[keep_idx]
N = len(keep_idx)
print("capped total samples:", N)

images.tofile(f"{OUT}/images.bin")
labels.tofile(f"{OUT}/labels.bin")

with open(f"{OUT}/classes.json", "w", encoding="utf-8") as f:
    json.dump(
        {
            "classNames": class_names,
            "displayChars": [display_map[c] for c in class_names],
            "numSamples": N,
            "imageSize": SIZE,
        },
        f,
        ensure_ascii=False,
        indent=2,
    )

print("saved to", OUT)
