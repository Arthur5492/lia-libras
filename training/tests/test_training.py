"""Tests for the training code. Run from the training folder: python -m unittest discover -s tests -t ."""
import json
import tempfile
import unittest
import warnings
from pathlib import Path

import numpy as np

from libras_train.data import load_release
from libras_train.dataset import build, choose_signs, split_by_person
from libras_train.features import FEATURE_SIZE, features, mirror, resample
from tests.synthetic import make_arrays, write_release


class FeatureTests(unittest.TestCase):
    def test_resample_gives_equal_steps_from_first_to_last(self):
        small = resample(make_arrays("a", 1, frames=47), 30)
        self.assertEqual(len(small["pose_mask"]), 30)
        self.assertEqual(small["timestamps_ms"][0], 0)
        self.assertEqual(small["timestamps_ms"][-1], 46 * 50)
        self.assertTrue(np.all(np.diff(small["timestamps_ms"]) > 0))

    def test_features_have_the_fixed_size(self):
        self.assertEqual(features(resample(make_arrays("a", 1), 30)).shape, (30, FEATURE_SIZE))
        self.assertEqual(FEATURE_SIZE, 196)

    def test_a_frame_without_detections_gives_zeros(self):
        arrays = make_arrays("a", 1)
        arrays["pose_mask"][5] = 0
        arrays["right_mask"][5] = 0
        row = features(arrays)[5]
        self.assertFalse(row.any())

    def test_mirror_twice_gives_the_same_recording(self):
        arrays = make_arrays("a", 1)
        back = mirror(mirror(arrays))
        for key in ("pose", "pose_world", "right_hand", "right_hand_world", "right_mask", "left_mask"):
            np.testing.assert_allclose(back[key], arrays[key], atol=1e-6, err_msg=key)

    def test_mirror_moves_the_hand_to_the_other_channel(self):
        mirrored = mirror(make_arrays("a", 1))
        self.assertEqual(int(mirrored["left_mask"].sum()), 40)
        self.assertEqual(int(mirrored["right_mask"].sum()), 0)
        self.assertEqual(int(mirrored["pose"].shape[0]), 40)

    def test_mirror_changes_the_features_of_the_body_but_not_the_shape_of_the_hand(self):
        arrays = make_arrays("a", 1)
        original, flipped = features(arrays)[0], features(mirror(arrays))[0]
        # Block order: body (42), left hand (63 + 14), right hand (63 + 14).
        original_right_shape = original[42 + 77 + 63:]
        flipped_left_shape = flipped[42 + 63:42 + 77]
        self.assertFalse(np.allclose(original[:42], flipped[:42]))
        # A mirrored hand has the same finger distances and flexions.
        np.testing.assert_allclose(flipped_left_shape[:12], original_right_shape[:12], atol=1e-4)


class DatasetTests(unittest.TestCase):
    def test_split_by_person_never_shares_a_person(self):
        persons = [f"p{i}" for i in range(10) for _ in range(4)]
        assignment = split_by_person(persons, seed=1)
        self.assertEqual(set(assignment.values()), {"train", "val", "test"})
        self.assertEqual(len(assignment), 10)
        self.assertEqual(sum(v == "test" for v in assignment.values()), 2)

    def test_split_needs_three_persons(self):
        with self.assertRaisesRegex(ValueError, "at least 3 persons"):
            split_by_person(["a", "b", "a"])

    def test_split_is_the_same_for_the_same_seed(self):
        persons = [f"p{i}" for i in range(9)]
        self.assertEqual(split_by_person(persons, 7), split_by_person(persons, 7))

    def test_choose_signs_needs_recordings_and_persons(self):
        with tempfile.TemporaryDirectory() as folder:
            write_release(Path(folder), persons=3, per_person=2)
            recordings, _ = load_release(folder)
        self.assertEqual(choose_signs(recordings, minimum=6), ["sign-a", "sign-b"])
        self.assertEqual(choose_signs(recordings, minimum=7), [])
        self.assertEqual(choose_signs(recordings, minimum=1, min_persons=4), [])

    def test_load_release_reads_the_files_and_skips_a_missing_one(self):
        with tempfile.TemporaryDirectory() as folder:
            write_release(Path(folder), persons=3, per_person=2)
            (Path(folder) / "a" / "person0" / "01.npz").unlink()
            with warnings.catch_warnings(record=True) as caught:
                warnings.simplefilter("always")
                recordings, signs = load_release(folder)
        self.assertEqual(len(recordings), 11)
        self.assertEqual(len(signs), 2)
        self.assertEqual(recordings[0].arrays["meta"]["schema_version"], "2.0")
        self.assertTrue(any("skipped" in str(w.message) for w in caught))

    def test_build_makes_arrays_for_each_set(self):
        with tempfile.TemporaryDirectory() as folder:
            write_release(Path(folder), persons=6, per_person=2)
            recordings, _ = load_release(folder)
        assignment = split_by_person([r.uuid for r in recordings])
        sets = build(recordings, ["sign-a", "sign-b"], 30, assignment)
        self.assertEqual(sum(len(s.x) for s in sets.values()), 24)
        for part in sets.values():
            self.assertEqual(part.x.shape[1:], (30, FEATURE_SIZE))
            self.assertEqual(part.x.shape, part.x_mirrored.shape)
        self.assertEqual(set(sets["train"].persons) & set(sets["test"].persons), set())


class TrainingSmokeTest(unittest.TestCase):
    def test_training_runs_and_writes_the_output(self):
        try:
            import tensorflow  # noqa: F401
        except ImportError:
            self.skipTest("TensorFlow is not installed")
        from libras_train.train import train

        with tempfile.TemporaryDirectory() as folder:
            release, out = Path(folder) / "release", Path(folder) / "out"
            write_release(release, persons=8, per_person=3)
            meta = train(str(release), str(out), frames=30, epochs=25, minimum=6)
            self.assertTrue((out / "model.h5").exists())
            saved = json.loads((out / "meta.json").read_text(encoding="utf-8"))
            self.assertEqual(saved["feature_size"], FEATURE_SIZE)
            self.assertEqual([c["slug"] for c in saved["classes"]], ["a", "b"])
            test = meta["metrics"]["test"]
            self.assertGreater(test["persons"], 0)
            # The two fake signs move in different directions, so the model must learn them.
            self.assertGreaterEqual(test["accuracy"], 0.8)
            self.assertIsNotNone(test["accuracy_mirrored"])


if __name__ == "__main__":
    unittest.main()
