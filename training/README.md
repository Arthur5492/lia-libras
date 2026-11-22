# Training

Train the sign recognition model on a dataset release. The training runs on your computer, not in the cloud.

## 1. Get a release
Publish a release first (see `contract/release.md`), then download it:

```bash
npm run release -- publish
npm run release -- download latest training/data
```

## 2. Train
Use an environment with TensorFlow (for example, the one of `lstm_libras`). Run from this folder:

```bash
cd training
python -m libras_train.train data --out out/v1
```

Options: `--frames 30`, `--epochs 300`, `--min-recordings 6`, `--seed 42`, `--no-mirror`.

What the script does:
1. Keep the signs that have enough recordings from at least 2 persons. It reports the other signs as dropped.
2. Split **by person**: each person is only in the train set, the validation set or the test set. At least 3 persons are necessary. A split by recording would give a number that is too good, because one person makes almost the same movement each time.
3. Take 30 frames at equal steps of time from each recording, and compute 196 numbers for each frame (`libras_train/features.py`).
4. Train on the real recordings and on the mirrored copies. A mirrored copy is the same sign as if the other hand made it.
5. Report the accuracy on the test persons, with the real hand and with the mirrored copy. Compare with `--no-mirror` to see if the mirror helps.
6. Write `model.h5` and `meta.json` (classes, frames, feature version, metrics) to the output folder.

## 3. Use the model in the site
Convert the model with `tools/convert_h5.py` in a separate environment (see `contract/stage-0-results.md`), and publish it:

```bash
python -I tools/convert_h5.py out/v1/model.h5 out/v1/tfjs
hf buckets cp out/v1/meta.json hf://buckets/<owner>/<bucket>/models/v1/meta.json
```

The site must compute the same features as `libras_train/features.py`. If you change the features, change `FEATURE_VERSION` and the code of the site together.

## Tests
```bash
cd training
python -m unittest discover -s tests -t .
```
The tests use fake recordings (`tests/synthetic.py`). The test of the full training is skipped if TensorFlow is not installed.
