import os
os.environ["TMPDIR"] = "/home/claude/tmp"
import tf_keras as keras
from tensorflowjs.converters import save_keras_model
m = keras.models.load_model("/home/claude/train_v3/best.keras")
m.save("/home/claude/train_v3/model_legacy.h5", save_format="h5")
m2 = keras.models.load_model("/home/claude/train_v3/model_legacy.h5")
save_keras_model(m2, "/home/claude/train_v3/tfjs_model")
print("변환 완료")
