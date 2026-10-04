import os
os.environ["TMPDIR"] = "/home/claude/tmp"
import tf_keras
from tensorflowjs.converters import save_keras_model
model = tf_keras.models.load_model("/home/claude/train_keras_v2/model_legacy.h5")
save_keras_model(model, "/home/claude/train_keras_v2/tfjs_model")
print("tfjs 변환 완료")
