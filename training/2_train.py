import os
os.environ["TMPDIR"] = "/home/claude/tmp"
import json
import numpy as np
from PIL import Image
import tf_keras as keras
from tf_keras import layers
from sklearn.model_selection import train_test_split

SIZE = 32
DATA = "/home/claude/dataset_processed"
OUT = "/home/claude/train_keras_v2"
os.makedirs(OUT, exist_ok=True)

classes = json.load(open(f"{DATA}/classes.json", encoding="utf-8"))
class_names = classes["classNames"]
num_classes = len(class_names)

images = np.fromfile(f"{DATA}/images.bin", dtype=np.uint8).reshape(-1, SIZE, SIZE)
labels = np.fromfile(f"{DATA}/labels.bin", dtype=np.int32)
print("원본 샘플 수:", len(images), "클래스 수:", num_classes)

# ---------- 1) 먼저 검증셋을 떼어놓기 (증강 전의 "진짜" 데이터로만 검증) ----------
X_train, X_val, y_train, y_val = train_test_split(
    images, labels, test_size=0.15, random_state=42, stratify=labels
)
print("train:", len(X_train), "val:", len(X_val))


def augment(img_u8, rng):
    im = Image.fromarray(img_u8, mode="L")
    angle = rng.uniform(-12, 12)
    tx = rng.uniform(-2, 2)
    ty = rng.uniform(-2, 2)
    scale = rng.uniform(0.9, 1.1)

    im = im.rotate(angle, resample=Image.BILINEAR, fillcolor=255)
    new_size = max(8, int(SIZE * scale))
    im = im.resize((new_size, new_size), Image.BILINEAR)
    canvas = Image.new("L", (SIZE, SIZE), 255)
    off = ((SIZE - new_size) // 2 + int(tx), (SIZE - new_size) // 2 + int(ty))
    canvas.paste(im, off)
    return np.asarray(canvas, dtype=np.uint8)


# ---------- 2) 학습 데이터 증강: 적은 클래스는 더 많이 보강, 전체적으로도 다양성 추가 ----------
rng = np.random.default_rng(42)
MIN_TARGET = 180  # 클래스당 최소 이만큼은 채움 (실데이터+증강 합쳐서)
EXTRA_COPIES = 2  # 그 외에도 모든 이미지마다 기본으로 몇 장씩 증강본 추가

by_class = {}
for img, lab in zip(X_train, y_train):
    by_class.setdefault(int(lab), []).append(img)

aug_images = []
aug_labels = []
for cls_idx, imgs in by_class.items():
    # 기본 증강: 모든 실제 이미지마다 EXTRA_COPIES장씩
    for img in imgs:
        for _ in range(EXTRA_COPIES):
            aug_images.append(augment(img, rng))
            aug_labels.append(cls_idx)
    # 부족한 클래스는 MIN_TARGET까지 추가로 더 채움
    current_total = len(imgs) * (1 + EXTRA_COPIES)
    while current_total < MIN_TARGET:
        src = imgs[rng.integers(0, len(imgs))]
        aug_images.append(augment(src, rng))
        aug_labels.append(cls_idx)
        current_total += 1

aug_images = np.array(aug_images, dtype=np.uint8)
aug_labels = np.array(aug_labels, dtype=np.int32)

X_train_full = np.concatenate([X_train, aug_images], axis=0)
y_train_full = np.concatenate([y_train, aug_labels], axis=0)
print("증강 후 학습 샘플 수:", len(X_train_full), "(원본 train 대비 x%.1f)" % (len(X_train_full) / len(X_train)))

# 셔플
perm = rng.permutation(len(X_train_full))
X_train_full = X_train_full[perm]
y_train_full = y_train_full[perm]


def prep(x):
    x = x.astype("float32") / 255.0
    x = 1.0 - x  # 잉크=1, 배경=0
    return x[..., None]


Xtr = prep(X_train_full)
Xva = prep(X_val)
ytr = y_train_full
yva = y_val

# ---------- 3) 모델 (BatchNorm 추가, 약간 더 큰 용량) ----------
model = keras.Sequential([
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
model.compile(optimizer=keras.optimizers.Adam(1e-3), loss="sparse_categorical_crossentropy", metrics=["accuracy"])
model.summary()

callbacks = [
    keras.callbacks.EarlyStopping(monitor="val_accuracy", patience=7, restore_best_weights=True),
    keras.callbacks.ReduceLROnPlateau(monitor="val_accuracy", factor=0.5, patience=3, min_lr=1e-5),
]

history = model.fit(
    Xtr, ytr,
    validation_data=(Xva, yva),
    epochs=45,
    batch_size=64,
    callbacks=callbacks,
    verbose=2,
)

model.save(f"{OUT}/model.keras")
with open(f"{OUT}/history.json", "w") as f:
    json.dump({k: [float(v) for v in vals] for k, vals in history.history.items()}, f)

best_val_acc = max(history.history["val_accuracy"])
print("=== 최종 결과 ===")
print("train_accuracy:", history.history["accuracy"][-1])
print("val_accuracy(최종):", history.history["val_accuracy"][-1])
print("val_accuracy(최고):", best_val_acc)
