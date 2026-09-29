import importlib.util
import base64
from copy import deepcopy
import json
from pathlib import Path
import unittest
from unittest.mock import patch
from urllib.error import HTTPError


spec = importlib.util.spec_from_file_location(
    "update_tv_episodes", Path(__file__).with_name("update-tv-episodes.py")
)
updater = importlib.util.module_from_spec(spec)
spec.loader.exec_module(updater)


class EpisodeUpdateTests(unittest.TestCase):
    def setUp(self):
        self.watched_episode = {
            "id": 10, "season": 1, "number": 1, "name": "Pilot", "airdate": "2026-01-01",
            "runtime": 40, "rating": 9.0, "summary": "Existing summary",
        }
        self.payload = {
            "savedAt": "old", "dataUpdatedAt": "old",
            "shows": [
                {
                    "id": 1, "name": "Watching", "status": "watching",
                    "episodes": [self.watched_episode.copy()], "watched": {"10": True},
                    "pinned": True, "watchBaseUrl": "https://example.com/show", "lastWatchedAt": "old",
                },
                {"id": 2, "name": "Finished", "status": "finished", "episodes": [], "watched": {}},
            ],
        }
        self.new_episode = {
            "id": 11, "season": 1, "number": 2, "name": "Next", "airdate": "2026-01-08",
            "runtime": 43, "rating": None, "summary": "New summary",
        }

    def test_only_appends_to_watching_and_preserves_progress(self):
        original = self.payload["shows"][0].copy()
        added, changes = updater.add_new_episodes(self.payload, {1: [self.watched_episode, self.new_episode]})
        self.assertEqual((added, changes), (1, ["Watching: +1"]))
        show = self.payload["shows"][0]
        self.assertEqual(show["episodes"], [self.watched_episode, self.new_episode])
        for key in ("watched", "pinned", "watchBaseUrl", "lastWatchedAt", "status"):
            self.assertEqual(show[key], original[key])
        self.assertEqual(self.payload["shows"][1]["episodes"], [])
        self.assertNotEqual(self.payload["dataUpdatedAt"], "old")

    def test_no_new_episodes_is_no_op(self):
        added, changes = updater.add_new_episodes(self.payload, {1: [self.watched_episode]})
        self.assertEqual((added, changes), (0, []))
        self.assertEqual(self.payload["savedAt"], "old")
        self.assertEqual(self.payload["dataUpdatedAt"], "old")

    def test_tvmaze_normalization_ignores_specials(self):
        response = {
            "id": 1,
            "_embedded": {"episodes": [
                {"id": 11, "season": 1, "number": 2, "name": "Next", "airdate": "2026-01-08",
                 "runtime": 43, "rating": {"average": None}, "summary": "<p>New &amp; improved</p>"},
                {"id": 12, "type": "significant_special", "season": 0, "number": 1},
            ]},
        }
        with patch.object(updater, "request_json", return_value=response):
            episodes = updater.fetch_episodes(1)
        self.assertEqual(len(episodes), 1)
        self.assertEqual(episodes[0]["summary"], "New & improved")

    def test_preserves_repo_line_endings(self):
        data = updater.encode_payload({"a": 1}, b"\r\n", False)
        self.assertEqual(data, b'{\r\n  "a": 1\r\n}')

    def test_conflict_reapplies_new_episodes_to_latest_progress(self):
        latest = deepcopy(self.payload)
        latest["shows"][0]["watched"]["11"] = True
        versions = [
            (deepcopy(self.payload), "old-sha", b"\n", False),
            (latest, "new-sha", b"\n", False),
        ]
        writes = []

        def fake_request(url, token, method="GET", body=None):
            if method == "PUT":
                writes.append(body)
                if len(writes) == 1:
                    raise HTTPError(url, 409, "Conflict", {}, None)
            return {}

        with patch.object(updater, "github_file", side_effect=versions), \
             patch.object(updater, "fetch_episodes", return_value=[self.watched_episode, self.new_episode]), \
             patch.object(updater, "request_json", side_effect=fake_request):
            updater.run_github("owner/repo", "token")

        self.assertEqual(len(writes), 2)
        self.assertEqual(writes[1]["sha"], "new-sha")
        saved = json.loads(base64.b64decode(writes[1]["content"]))
        self.assertTrue(saved["shows"][0]["watched"]["11"])
        self.assertEqual(len(saved["shows"][0]["episodes"]), 2)


if __name__ == "__main__":
    unittest.main()
