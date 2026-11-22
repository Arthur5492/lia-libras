"""Train the LSTM model on a release.

Run from the training folder:
    python -m libras_train.train <release_folder> --out <output_folder>
TensorFlow loads only here, so the other modules and their tests do not need it.
"""
from __future__ import annotations

import argparse
import json
import datetime as dt
from pathlib import Path

import numpy as np

from .data import load_release
from .dataset import Split, build, choose_signs, split_by_person
from .features import FEATURE_SIZE, FEATURE_VERSION


def build_model(frames: int, classes: int):
    # Same shape as the old model of lstm_libras: two small LSTM layers, with dropout, because the data is small.
    from tensorflow.keras.layers import LSTM, Dense, Dropout
    from tensorflow.keras.models import Sequential
    from tensorflow.keras.optimizers import Adam

    model = Sequential([
        LSTM(64, return_sequences=True, recurrent_dropout=0.25, input_shape=(frames, FEATURE_SIZE)),
        Dropout(0.2),
        LSTM(32, recurrent_dropout=0.25),
        Dropout(0.2),
        Dense(32, activation="relu"),
        Dropout(0.2),
        Dense(classes, activation="softmax"),
    ])
    model.compile(optimizer=Adam(learning_rate=5e-4, clipnorm=1.0), loss="sparse_categorical_crossentropy",
                  metrics=["accuracy"])
    return model


def accuracy(model, x: np.ndarray, y: np.ndarray) -> float | None:
    if len(x) == 0:
        return None
    return float((np.argmax(model.predict(x, verbose=0), axis=1) == y).mean())


def evaluate(model, split: Split, class_names: list[str]) -> dict:
    """Accuracy on persons that the model never saw, with the real hand and with the other hand."""
    if len(split.x) == 0:
        return {"recordings": 0}
    predicted = np.argmax(model.predict(split.x, verbose=0), axis=1)
    matrix = np.zeros((len(class_names), len(class_names)), dtype=int)
    for truth, guess in zip(split.y, predicted):
        matrix[truth, guess] += 1
    recall = {
        name: (float(matrix[i, i] / matrix[i].sum()) if matrix[i].sum() else None)
        for i, name in enumerate(class_names)
    }
    return {
        "recordings": int(len(split.x)),
        "persons": int(len(set(split.persons))),
        "accuracy": float((predicted == split.y).mean()),
        "accuracy_mirrored": accuracy(model, split.x_mirrored, split.y),
        "recall_by_sign": recall,
        "confusion_matrix": matrix.tolist(),
    }


def train(release: str, out: str, frames: int = 30, epochs: int = 300, minimum: int = 6, seed: int = 42,
          mirror_training: bool = True) -> dict:
    import tensorflow as tf
    from tensorflow.keras.callbacks import EarlyStopping, ReduceLROnPlateau

    tf.keras.utils.set_random_seed(seed)
    recordings, signs = load_release(release)
    sign_ids = choose_signs(recordings, minimum)
    if len(sign_ids) < 2:
        raise SystemExit(f"Need at least 2 signs with {minimum} recordings from 2 persons. Found {len(sign_ids)}.")
    names = {s["id"]: s for s in signs}
    dropped = sorted({r.sign_id for r in recordings} - set(sign_ids))
    print(f"{len(recordings)} recordings, {len(sign_ids)} signs used, {len(dropped)} signs dropped (too few recordings).")

    kept = [r for r in recordings if r.sign_id in sign_ids]
    assignment = split_by_person([r.uuid for r in kept], seed)
    sets = build(kept, sign_ids, frames, assignment)
    for name, part in sets.items():
        print(f"  {name}: {len(part.x)} recordings, {len(set(part.persons))} persons")
    train_set, val_set, test_set = sets["train"], sets["val"], sets["test"]
    if len(train_set.x) == 0 or len(val_set.x) == 0:
        raise SystemExit("The train or the validation set is empty. Collect more recordings.")

    # The mirrored copies teach the model that the sign is the same with the other hand.
    x_train, y_train = train_set.x, train_set.y
    if mirror_training:
        x_train = np.concatenate([x_train, train_set.x_mirrored])
        y_train = np.concatenate([y_train, train_set.y])

    model = build_model(frames, len(sign_ids))
    model.fit(
        x_train, y_train, epochs=epochs, batch_size=16, verbose=2,
        validation_data=(val_set.x, val_set.y),
        callbacks=[
            EarlyStopping(monitor="val_loss", patience=40, restore_best_weights=True),
            ReduceLROnPlateau(monitor="val_loss", factor=0.5, patience=15, min_lr=1e-5),
        ],
    )

    class_names = [names.get(s, {}).get("slug", s) for s in sign_ids]
    metrics = {"validation": evaluate(model, val_set, class_names), "test": evaluate(model, test_set, class_names)}
    print(json.dumps({k: {m: v for m, v in d.items() if m in ("recordings", "persons", "accuracy", "accuracy_mirrored")}
                      for k, d in metrics.items()}, indent=2))

    folder = Path(out)
    folder.mkdir(parents=True, exist_ok=True)
    model.save(folder / "model.h5")
    classes = [{"id": s, "slug": names.get(s, {}).get("slug", s), "name": names.get(s, {}).get("name", s)}
               for s in sign_ids]
    meta = {
        "feature_version": FEATURE_VERSION, "feature_size": FEATURE_SIZE, "frames": frames, "classes": classes,
        "trained_at": dt.datetime.now(dt.timezone.utc).isoformat(), "release": str(release),
        "mirror_training": mirror_training, "seed": seed, "metrics": metrics,
    }
    (folder / "meta.json").write_text(json.dumps(meta, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"Saved model.h5 and meta.json in {folder}.")
    return meta


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("release", help="folder made by `npm run release -- download`")
    parser.add_argument("--out", required=True, help="output folder")
    parser.add_argument("--frames", type=int, default=30)
    parser.add_argument("--epochs", type=int, default=300)
    parser.add_argument("--min-recordings", type=int, default=6, help="minimum recordings for a sign")
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument("--no-mirror", action="store_true", help="do not train with the mirrored copies")
    args = parser.parse_args(argv)
    train(args.release, args.out, args.frames, args.epochs, args.min_recordings, args.seed, not args.no_mirror)


if __name__ == "__main__":
    main()
