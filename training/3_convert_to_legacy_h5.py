import os
os.environ["TMPDIR"] = "/home/claude/tmp"
import tf_keras as keras
m = keras.models.load_model("/home/claude/train_keras_v2/model.keras")
m.save("/home/claude/train_keras_v2/model_legacy.h5", save_format="h5")
print("legacy h5 저장 완료")
