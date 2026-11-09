"""Converte um .h5 para TF.js sem carregar Decision Forests (que falha no Windows)."""
import os
import sys
import types

h5_path, out_dir = sys.argv[1], sys.argv[2]
sys.modules["tensorflow_decision_forests"] = types.ModuleType("tensorflow_decision_forests")

from tensorflowjs.converters.converter import dispatch_keras_h5_to_tfjs_layers_model_conversion  # noqa: E402

os.makedirs(out_dir, exist_ok=True)
dispatch_keras_h5_to_tfjs_layers_model_conversion(h5_path, output_dir=out_dir)
for name in sorted(os.listdir(out_dir)):
    print(name, os.path.getsize(os.path.join(out_dir, name)))
