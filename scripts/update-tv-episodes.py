"""Add new TVMaze episodes to watching shows in the repo-backed tracker."""

import argparse
import base64
from datetime import datetime, timezone
from html.parser import HTMLParser
import json
import os
from pathlib import Path
import time
from urllib.error import HTTPError
from urllib.request import Request, urlopen


DATA_PATH = "tv-data.json"
SPECIAL_TYPES = {"significant_special", "insignificant_special"}


class TextExtractor(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.parts = []

    def handle_starttag(self, tag, attrs):
        if tag in {"br", "p", "div", "li"}:
            self.parts.append(" ")

    def handle_data(self, data):
        self.parts.append(data)


def strip_html(value):
    parser = TextExtractor()
    parser.feed(value or "")
    return " ".join("".join(parser.parts).split())


def normalize_episode(episode):
    rating = (episode.get("rating") or {}).get("average")
    return {
        "id": int(episode["id"]),
        "season": int(episode.get("season") or 0),
        "number": int(episode.get("number") or 0),
        "name": episode.get("name") or "Untitled episode",
        "airdate": episode.get("airdate") or "",
        "runtime": episode.get("runtime") or None,
        "rating": rating if isinstance(rating, (int, float)) and rating > 0 else None,
        "summary": strip_html(episode.get("summary")),
    }


def request_json(url, token=None, method="GET", body=None):
    headers = {
        "Accept": "application/vnd.github+json" if token else "application/json",
        "User-Agent": "katamartini-tv-episode-update",
    }
    if token:
        headers["Authorization"] = f"Bearer {token}"
        headers["X-GitHub-Api-Version"] = "2022-11-28"
    if body is not None:
        headers["Content-Type"] = "application/json"
    request = Request(
        url,
        data=json.dumps(body).encode("utf-8") if body is not None else None,
        headers=headers,
        method=method,
    )
    for attempt in range(3):
        try:
            with urlopen(request, timeout=30) as response:
                data = response.read()
                return json.loads(data) if data else None
        except HTTPError as error:
            if error.code not in {429, 500, 502, 503, 504} or attempt == 2:
                raise
            retry_after = error.headers.get("Retry-After", "")
            time.sleep(int(retry_after) if retry_after.isdigit() else 2 ** attempt)


def fetch_episodes(show_id):
    show = request_json(f"https://api.tvmaze.com/shows/{show_id}?embed=episodes")
    if not isinstance(show, dict) or show.get("id") != show_id:
        raise ValueError(f"TVMaze returned the wrong show for {show_id}")
    episodes = show.get("_embedded", {}).get("episodes")
    if not isinstance(episodes, list):
        raise ValueError(f"TVMaze returned no episode list for {show_id}")
    return [normalize_episode(item) for item in episodes if item.get("type") not in SPECIAL_TYPES]


def add_new_episodes(payload, episode_lists):
    added = 0
    changed_shows = []
    for show in payload["shows"]:
        if show.get("status") != "watching":
            continue
        existing = show["episodes"]
        known_ids = {episode["id"] for episode in existing}
        fresh = [episode for episode in episode_lists[show["id"]] if episode["id"] not in known_ids]
        if not fresh:
            continue
        existing.extend(fresh)
        existing.sort(key=lambda episode: (episode["season"], episode["number"], episode["id"]))
        added += len(fresh)
        changed_shows.append(f'{show["name"]}: +{len(fresh)}')

    if added:
        timestamp = datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")
        payload["savedAt"] = timestamp
        payload["dataUpdatedAt"] = timestamp
    return added, changed_shows


def update_payload(payload, cache):
    watching = [show for show in payload["shows"] if show.get("status") == "watching"]
    for index, show in enumerate(watching):
        if show["id"] not in cache:
            if index:
                time.sleep(0.6)
            cache[show["id"]] = fetch_episodes(show["id"])
    return add_new_episodes(payload, cache)


def github_file(repo, token):
    url = f"https://api.github.com/repos/{repo}/contents/{DATA_PATH}?ref=main"
    metadata = request_json(url, token)
    if not metadata.get("sha") or not metadata.get("git_url"):
        raise ValueError("GitHub did not return the tracker file SHA and blob URL")
    blob = request_json(metadata["git_url"], token)
    if blob.get("encoding") != "base64" or not blob.get("content"):
        raise ValueError("GitHub did not return base64 tracker data")
    raw = base64.b64decode(blob["content"])
    return json.loads(raw), metadata["sha"], b"\r\n" if b"\r\n" in raw else b"\n", raw.endswith(b"\n")


def encode_payload(payload, newline, trailing_newline):
    data = json.dumps(payload, ensure_ascii=False, indent=2).encode("utf-8")
    if newline == b"\r\n":
        data = data.replace(b"\n", b"\r\n")
    return data + (newline if trailing_newline else b"")


def run_github(repo, token):
    url = f"https://api.github.com/repos/{repo}/contents/{DATA_PATH}"
    cache = {}
    for attempt in range(3):
        payload, sha, newline, trailing_newline = github_file(repo, token)
        added, changes = update_payload(payload, cache)
        if not added:
            print("No new episodes for watching shows.")
            return
        body = {
            "message": "Update watching show episodes",
            "content": base64.b64encode(encode_payload(payload, newline, trailing_newline)).decode("ascii"),
            "sha": sha,
            "branch": "main",
        }
        try:
            request_json(url, token, method="PUT", body=body)
        except HTTPError as error:
            if error.code not in {409, 422} or attempt == 2:
                raise
            print("Tracker changed during update; retrying with the latest repo data.")
            continue
        print(f"Added {added} episode(s): {', '.join(changes)}")
        request_json(f"https://api.github.com/repos/{repo}/pages/builds", token, method="POST")
        return
    raise RuntimeError("Could not update the tracker after three attempts")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dry-run", action="store_true", help="Check the local tracker without saving")
    parser.add_argument("--data-path", type=Path, default=Path(DATA_PATH))
    args = parser.parse_args()
    if args.dry_run:
        payload = json.loads(args.data_path.read_text(encoding="utf-8"))
        added, changes = update_payload(payload, {})
        print(f"Would add {added} episode(s): {', '.join(changes)}" if added else "No new episodes for watching shows.")
    else:
        repo = os.environ["GITHUB_REPOSITORY"]
        token = os.environ["GITHUB_TOKEN"]
        run_github(repo, token)


if __name__ == "__main__":
    main()
