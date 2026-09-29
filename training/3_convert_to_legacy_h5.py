from tensorflow import keras as keras3
import tf_keras
from tf_keras import layers

SIZE = 32
NUM_CLASSES = 102

# 원본 학습된 모델(Keras3) 로드해서 가중치만 추출
orig = keras3.models.load_model("/home/claude/train_keras/model.keras")
weights = orig.get_weights()

# 동일한 구조를 tf_keras(레거시 Keras2 호환)로 재구성
model = tf_keras.Sequential([
    tf_keras.Input(shape=(SIZE, SIZE, 1)),
    layers.Conv2D(24, 3, activation="relu", padding="same"),
    layers.MaxPooling2D(2),
    layers.Conv2D(48, 3, activation="relu", padding="same"),
    layers.MaxPooling2D(2),
    layers.Conv2D(64, 3, activation="relu", padding="same"),
    layers.Flatten(),
    layers.Dense(160, activation="relu"),
    layers.Dropout(0.35),
    layers.Dense(NUM_CLASSES, activation="softmax"),
])
model.set_weights(weights)
model.compile(optimizer="adam", loss="sparse_categorical_crossentropy", metrics=["accuracy"])

model.save("/home/claude/train_keras/model_legacy.h5", save_format="h5")
print("legacy h5 저장 완료")
