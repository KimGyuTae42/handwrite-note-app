import os
os.environ["TMPDIR"] = "/home/claude/tmp"
import sys, json, time
T0 = time.time()
import numpy as np
from PIL import Image, ImageFilter
import tf_keras as keras
from tf_keras import layers

SIZE = 32
LIMIT_SEC = float(sys.argv[1]) if len(sys.argv) > 1 else 265.0  # 이번 실행에 쓸 수 있는 총 시간
OUT = "/home/claude/train_v3"
os.makedirs(OUT, exist_ok=True)
STATE = f"{OUT}/state.json"
CKPT = f"{OUT}/ckpt.weights.h5"
PREP = f"{OUT}/prepared.npz"
MIN_TARGET = 500
EXTRA_COPIES = 2

old = np.load("/home/claude/newdata/old_raw.npz")
new = np.load("/home/claude/newdata/new_data.npz")
display = json.load(open("/home/claude/newdata/old_display.json", encoding="utf-8"))

class_names = sorted(set(old.files) | {k for k in new.files if "__thin" not in k})
num_classes = len(class_names)
cidx = {c: i for i, c in enumerate(class_names)}
group_of = lambda name: name.split("_")[0]  # ko / lo / up / num / sym


def augment(img_u8, rng):
    im = Image.fromarray(img_u8, mode="L")
    im = im.rotate(rng.uniform(-12, 12), resample=Image.BILINEAR, fillcolor=255)
    new_size = max(8, int(SIZE * rng.uniform(0.9, 1.1)))
    im = im.resize((new_size, new_size), Image.BILINEAR)
    canvas = Image.new("L", (SIZE, SIZE), 255)
    off = ((SIZE - new_size) // 2 + int(rng.uniform(-2, 2)), (SIZE - new_size) // 2 + int(rng.uniform(-2, 2)))
    canvas.paste(im, off)
    r = rng.random()
    if r < 0.22:
        canvas = canvas.filter(ImageFilter.MinFilter(3))   # 획 굵게
    elif r < 0.44:
        canvas = canvas.filter(ImageFilter.MaxFilter(3))   # 획 얇게
    if rng.random() < 0.3:
        canvas = canvas.filter(ImageFilter.GaussianBlur(0.6))  # 캔버스의 안티앨리어싱 느낌
    return np.asarray(canvas, dtype=np.uint8)


def prep(x):
    x = x.astype("float32") / 255.0
    return (1.0 - x)[..., None]


# ---------------- 데이터 준비 (캐시) ----------------
if os.path.exists(PREP):
    d = np.load(PREP, allow_pickle=True)
    Xtr, ytr, Xva, yva, vgroup = d["Xtr"], d["ytr"], d["Xva"], d["yva"], d["vgroup"]
else:
    rng = np.random.default_rng(42)
    tr_x, tr_y, va_x, va_y, va_g = [], [], [], [], []
    old_train_by_class = {}
    for name in class_names:
        ci = cidx[name]
        # --- 기존(HASY/한글) 출처 ---
        arr = old[name] if name in old.files else np.zeros((0, SIZE, SIZE), np.uint8)
        if name == "lo_t":
            arr = np.zeros((0, SIZE, SIZE), np.uint8)  # HASY에 t가 없어서 비어있음 -> 합성본만 사용
        if len(arr):
            perm = rng.permutation(len(arr))
            n_val = max(2, int(round(len(arr) * 0.15)))
            for j in perm[:n_val]:
                va_x.append(arr[j]); va_y.append(ci); va_g.append(f"{group_of(name)}_기존")
            trn = arr[perm[n_val:]]
            old_train_by_class[ci] = trn
            for a in trn:
                tr_x.append(a); tr_y.append(ci)
        # --- 새 데이터 출처 (숫자/대문자 + 합성 t) ---
        if name in new.files:
            narr = new[name]
            if name == "lo_t":
                perm = rng.permutation(len(narr))
                n_val = 14
                for j in perm[:n_val]:
                    va_x.append(narr[j]); va_y.append(ci); va_g.append("lo_합성t")
                trn = narr[perm[n_val:]]
                old_train_by_class[ci] = trn  # 소량이라 아래 증강 대상에 포함
                for a in trn:
                    tr_x.append(a); tr_y.append(ci)
            else:
                n_val = 40
                for a in narr[-n_val:]:
                    va_x.append(a); va_y.append(ci); va_g.append(f"{group_of(name)}_신규")
                for a in narr[:-n_val]:
                    tr_x.append(a); tr_y.append(ci)
                thin = new[name + "__thin"]
                for a in thin[: (len(narr) - n_val) // 2]:   # 검증에 쓴 이미지의 얇은 버전은 제외
                    tr_x.append(a); tr_y.append(ci)

    tr_x = list(tr_x); tr_y = list(tr_y)
    counts = np.bincount(np.array(tr_y), minlength=num_classes)
    # 증강: 기존 출처 이미지마다 EXTRA_COPIES장 + 클래스 합계가 MIN_TARGET 미만이면 추가 보충
    for ci, imgs in old_train_by_class.items():
        for a in imgs:
            for _ in range(EXTRA_COPIES):
                tr_x.append(augment(a, rng)); tr_y.append(ci); counts[ci] += 1
        while counts[ci] < MIN_TARGET:
            tr_x.append(augment(imgs[rng.integers(0, len(imgs))], rng)); tr_y.append(ci); counts[ci] += 1

    tr_x = np.array(tr_x, np.uint8); tr_y = np.array(tr_y, np.int32)
    perm = rng.permutation(len(tr_x))
    Xtr, ytr = prep(tr_x[perm]), tr_y[perm]
    Xva, yva = prep(np.array(va_x, np.uint8)), np.array(va_y, np.int32)
    vgroup = np.array(va_g)
    np.savez_compressed(PREP, Xtr=Xtr, ytr=ytr, Xva=Xva, yva=yva, vgroup=vgroup)
    json.dump({"classNames": class_names,
               "displayChars": [display[c] for c in class_names],
               "numSamples": int(len(Xtr)), "imageSize": SIZE},
              open(f"{OUT}/classes.json", "w", encoding="utf-8"), ensure_ascii=False, indent=2)

counts = np.bincount(ytr, minlength=num_classes)
class_weight = {i: float(np.clip((MIN_TARGET / max(c, 1)) ** 0.5, 0.5, 1.5)) for i, c in enumerate(counts)}
print(f"[{time.time()-T0:.0f}s] train={len(Xtr)} val={len(Xva)} classes={num_classes} (최대/최소 클래스 {counts.max()}/{counts.min()})")


def build():
    m = keras.Sequential([
        keras.Input(shape=(SIZE, SIZE, 1)),
        layers.Conv2D(32, 3, padding="same"), layers.BatchNormalization(), layers.Activation("relu"),
        layers.MaxPooling2D(),
        layers.Conv2D(64, 3, padding="same"), layers.BatchNormalization(), layers.Activation("relu"),
        layers.MaxPooling2D(),
        layers.Conv2D(96, 3, padding="same"), layers.BatchNormalization(), layers.Activation("relu"),
        layers.Flatten(),
        layers.Dense(192, activation="relu"),
        layers.Dropout(0.4),
        layers.Dense(num_classes, activation="softmax"),
    ])
    m.compile(optimizer=keras.optimizers.Adam(1e-3), loss="sparse_categorical_crossentropy", metrics=["accuracy"])
    return m


model = build()
if os.path.exists(STATE):
    state = json.load(open(STATE))
    model.load_weights(CKPT)
    print(f"이어서 학습: {state['epochs_done']}에폭 완료, 최고 val={state['best_val']:.4f}")
else:
    state = {"epochs_done": 0, "best_val": 0.0, "log": []}


def lr_for(epoch):
    return 1e-3 if epoch < 8 else (5e-4 if epoch < 13 else (2e-4 if epoch < 18 else 1e-4))


class Runner(keras.callbacks.Callback):
    def __init__(self):
        super().__init__()
        self.t_epoch = 60.0

    def on_epoch_begin(self, epoch, logs=None):
        keras.backend.set_value(self.model.optimizer.learning_rate, lr_for(epoch))
        self.ts = time.time()

    def on_epoch_end(self, epoch, logs=None):
        self.t_epoch = time.time() - self.ts
        pred = np.argmax(self.model.predict(Xva, verbose=0, batch_size=512), axis=1)
        ok = pred == yva
        overall = float(ok.mean())
        groups = {g: float(ok[vgroup == g].mean()) for g in sorted(set(vgroup))}
        state["epochs_done"] = epoch + 1
        state["log"].append({"epoch": epoch + 1, "train_acc": float(logs["accuracy"]), "val_acc": overall, "groups": groups})
        if overall > state["best_val"]:
            state["best_val"] = overall
            self.model.save(f"{OUT}/best.keras")
            self.model.save_weights(f"{OUT}/best.weights.h5")
            state["best_epoch"] = epoch + 1
            state["best_groups"] = groups
        self.model.save_weights(CKPT)
        json.dump(state, open(STATE, "w"), ensure_ascii=False)
        print(f"  epoch {epoch+1}: train_acc={logs['accuracy']:.4f} val_acc={overall:.4f} (best {state['best_val']:.4f}@{state.get('best_epoch')}) "
              + " ".join(f"{g}={v:.3f}" for g, v in groups.items()), flush=True)
        if time.time() - T0 + self.t_epoch * 1.15 > LIMIT_SEC:
            self.model.stop_training = True


start = state["epochs_done"]
model.fit(Xtr, ytr, validation_data=None, initial_epoch=start, epochs=start + 40, batch_size=64,
          class_weight=class_weight, callbacks=[Runner()], verbose=0)
print(f"[{time.time()-T0:.0f}s] 이번 실행 종료 — 총 {state['epochs_done']}에폭, 최고 val={state['best_val']:.4f}@{state.get('best_epoch')}")
