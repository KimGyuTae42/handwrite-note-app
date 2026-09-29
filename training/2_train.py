import json
import time
import numpy as np
import tensorflow as tf
from tensorflow import keras
from tensorflow.keras import layers

DATA_DIR = "/home/claude/dataset_processed"
SIZE = 32

classes = json.load(open(f"{DATA_DIR}/classes.json", encoding="utf-8"))
num_classes = len(classes["classNames"])
N = classes["numSamples"]
print("samples:", N, "classes:", num_classes)

images = np.fromfile(f"{DATA_DIR}/images.bin", dtype=np.uint8).reshape(N, SIZE, SIZE, 1)
labels = np.fromfile(f"{DATA_DIR}/labels.bin", dtype=np.int32)

images = 1.0 - (images.astype("float32") / 255.0)  # 잉크=1, 배경=0

val_count = int(N * 0.12)
train_count = N - val_count
x_train, y_train = images[:train_count], labels[:train_count]
x_val, y_val = images[train_count:], labels[train_count:]

model = keras.Sequential([
    keras.Input(shape=(SIZE, SIZE, 1)),
    layers.Conv2D(24, 3, activation="relu", padding="same"),
    layers.MaxPooling2D(2),
    layers.Conv2D(48, 3, activation="relu", padding="same"),
    layers.MaxPooling2D(2),
    layers.Conv2D(64, 3, activation="relu", padding="same"),
    layers.Flatten(),
    layers.Dense(160, activation="relu"),
    layers.Dropout(0.35),
    layers.Dense(num_classes, activation="softmax"),
])

model.compile(optimizer="adam", loss="sparse_categorical_crossentropy", metrics=["accuracy"])
model.summary()

t0 = time.time()
history = model.fit(
    x_train, y_train,
    validation_data=(x_val, y_val),
    epochs=30,
    batch_size=64,
    verbose=2,
)
print("학습 시간:", time.time() - t0, "s")

model.save("/home/claude/train_keras/model.keras")
print("Keras 모델 저장 완료")

with open("/home/claude/train_keras/history.json", "w") as f:
    json.dump(history.history, f)
