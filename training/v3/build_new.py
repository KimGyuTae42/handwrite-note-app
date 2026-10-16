import glob, random, json
import numpy as np
from PIL import Image, ImageDraw, ImageFont, ImageFilter

SIZE = 32
N_PER_CLASS = 400
rng = np.random.default_rng(2026)


def tight32(white_on_black_u8):
    """MNIST/NIST(검은 배경+흰 잉크) -> 글자 영역만 잘라 정사각형으로 맞춘 32x32 (흰 배경+검은 잉크).
    앱의 cnn.js 전처리(글자 영역 크롭 -> 정사각형 -> 리사이즈)와 최대한 같게 만든다."""
    a = white_on_black_u8
    ys, xs = np.where(a > 40)
    if len(ys) == 0:
        return None
    y0, y1, x0, x1 = ys.min(), ys.max() + 1, xs.min(), xs.max() + 1
    crop = a[y0:y1, x0:x1]
    h, w = crop.shape
    side = max(h, w)
    margin = max(1, int(round(side * 0.06)))
    canvas = np.zeros((side + 2 * margin, side + 2 * margin), dtype=np.uint8)
    oy = margin + (side - h) // 2
    ox = margin + (side - w) // 2
    canvas[oy:oy + h, ox:ox + w] = crop
    im = Image.fromarray(canvas, mode="L").resize((SIZE, SIZE), Image.LANCZOS)
    return 255 - np.asarray(im, dtype=np.uint8)


def thin(img_dark_on_white):
    """획을 1px 정도 가늘게 (NIST의 굵은 획 -> 캔버스의 얇은 획에 가깝게)"""
    im = Image.fromarray(img_dark_on_white, mode="L").filter(ImageFilter.MaxFilter(3))
    return np.asarray(im, dtype=np.uint8)


out = {}

# ---------- 숫자 (archive__4_ trainingSet) ----------
for d in range(10):
    files = glob.glob(f"/home/claude/newdata/mnist/trainingSet/trainingSet/{d}/*.jpg")
    random.Random(100 + d).shuffle(files)
    imgs, thins = [], []
    for f in files:
        if len(imgs) >= N_PER_CLASS:
            break
        a = np.asarray(Image.open(f).convert("L"), dtype=np.uint8)
        t = tight32(a)
        if t is None:
            continue
        imgs.append(t)
        if len(imgs) % 2 == 0:
            thins.append(thin(t))
    out[f"num_{d}"] = np.array(imgs, dtype=np.uint8)
    out[f"num_{d}__thin"] = np.array(thins, dtype=np.uint8)
print("숫자 완료")

# ---------- 대문자 (archive__3__1 CSV) ----------
arr = np.load("/home/claude/newdata/az_all.npy", mmap_mode="r")
lab = np.asarray(arr[:, 0])
for c in range(26):
    ch = chr(65 + c)
    idx = np.where(lab == c)[0]
    idx = rng.choice(idx, size=min(len(idx), N_PER_CLASS * 2), replace=False)
    imgs, thins = [], []
    for i in idx:
        if len(imgs) >= N_PER_CLASS:
            break
        a = np.asarray(arr[i, 1:], dtype=np.uint8).reshape(28, 28)
        t = tight32(a)
        if t is None:
            continue
        imgs.append(t)
        if len(imgs) % 2 == 0:
            thins.append(thin(t))
    out[f"up_{ch}"] = np.array(imgs, dtype=np.uint8)
    out[f"up_{ch}__thin"] = np.array(thins, dtype=np.uint8)
print("대문자 완료")

# ---------- 소문자 t 합성 (HASY에 t가 없음) : 꼬리가 굽은 t 글리프를 가진 시스템 폰트(+기울임) 사용 ----------
fonts = ["/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
         "/usr/share/fonts/truetype/freefont/FreeSerifItalic.ttf",
         "/usr/share/texmf/fonts/opentype/public/tex-gyre/texgyrecursor-italic.otf",
         "/usr/share/texmf/fonts/opentype/public/lm/lmroman8-italic.otf"]
t_imgs = []
for fp in fonts:
    for k in range(35):
        size = int(rng.integers(90, 160))
        font = ImageFont.truetype(fp, size)
        im = Image.new("L", (260, 260), 0)
        ImageDraw.Draw(im).text((70, 40), "t", font=font, fill=255)
        im = im.rotate(float(rng.uniform(-12, 12)), resample=Image.BILINEAR)
        # 약간 기울이기(shear)
        sh = float(rng.uniform(-0.2, 0.2))
        im = im.transform(im.size, Image.AFFINE, (1, sh, -sh * 130, 0, 1, 0), resample=Image.BILINEAR)
        if k % 3 == 0:
            im = im.filter(ImageFilter.MaxFilter(3))  # 일부는 굵게
        t = tight32(np.asarray(im, dtype=np.uint8))
        if t is not None:
            t_imgs.append(t)
out["lo_t"] = np.array(t_imgs, dtype=np.uint8)
print("lo_t 합성:", len(t_imgs))

np.savez_compressed("/home/claude/newdata/new_data.npz", **out)
print({k: len(v) for k, v in list(out.items())[:6]}, "...")
