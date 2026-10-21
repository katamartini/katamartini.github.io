"""Read a Google Sheets XLSX export and prepare the DLNS history import.

Usage: python scripts/import-dlns-history.py path/to/source.xlsx
The workbook is read only. SQL output goes to .cache/dlns/import-history.sql.
"""

import argparse
import base64
import collections
import csv
import datetime
import io
import json
from pathlib import Path
import xml.etree.ElementTree as ET
import zipfile


NS = {"s": "http://schemas.openxmlformats.org/spreadsheetml/2006/main"}
REL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
SOURCE = "https://docs.google.com/spreadsheets/d/1jEG0It6vK-yJbzs4ihGYR2Hz8d4PVtI7Awcu0vdJRX8/edit"
FIRST_ACTIONS = {0, 2, 5, 6, 9, 11, 12, 15}
ORDERS = [1, 2, 1, 2, 3, 4, 5, 6, 3, 4, 7, 8, 9, 10, 11, 12]


def read_sheets(path):
    with zipfile.ZipFile(path) as archive:
        strings = ["".join(node.itertext()) for node in ET.fromstring(archive.read("xl/sharedStrings.xml"))]
        relationships = {node.attrib["Id"]: node.attrib["Target"] for node in ET.fromstring(archive.read("xl/_rels/workbook.xml.rels"))}
        sheets = {}
        for tab in ET.fromstring(archive.read("xl/workbook.xml")).find("s:sheets", NS):
            target = relationships[tab.attrib[f"{{{REL}}}id"]]
            target = target.lstrip("/") if target.startswith("/") else "xl/" + target
            cells = {}
            for cell in ET.fromstring(archive.read(target)).findall(".//s:sheetData/s:row/s:c", NS):
                value = cell.find("s:v", NS)
                if value is None or value.text is None:
                    continue
                cells[cell.attrib["r"]] = strings[int(value.text)] if cell.get("t") == "s" else value.text
            sheets[tab.attrib["name"]] = cells
    return sheets


def chronology(match_id):
    week, region, phase, game = match_id.split("-")
    return int(week) * 100000 + (2000 if region == "NA" else 0) + (1000 if phase == "F" else 0) + int(game)


def prepare(source, repo):
    sheets = read_sheets(source)
    catalog = sheets["hero_stats"]
    heroes = [{"name": catalog[f"C{row}"], "first_available": catalog[f"A{row}"]} for row in range(2, 40)]
    availability = {hero["name"]: chronology(hero["first_available"]) for hero in heroes}
    rows = sheets["drafts"]
    events = collections.defaultdict(list)
    max_row = max(int("".join(filter(str.isdigit, cell))) for cell in rows)
    for row in range(2, max_row + 1):
        hero = rows.get(f"J{row}", "").strip()
        if not hero:
            continue
        if hero not in availability:
            raise ValueError(f"Unknown hero at drafts!J{row}: {hero}")
        match_id = rows.get(f"B{row}", "").strip()
        if not match_id:
            raise ValueError(f"Missing match ID at drafts row {row}")
        events[match_id].append({
            "sq": int(float(rows[f"A{row}"])), "type": rows[f"H{row}"].lower(),
            "order": int(float(rows[f"I{row}"])), "hero": hero,
            "player": rows.get(f"L{row}", "").strip(), "team": rows[f"G{row}"].strip(),
        })
    metadata = sheets["matches_auto"]
    matches = []
    for row in range(2, 1001):
        match_id = metadata.get(f"B{row}", "").strip()
        if not match_id:
            continue
        left, right = metadata[f"G{row}"].strip(), metadata[f"H{row}"].strip()
        winner = metadata.get(f"I{row}", "").strip()
        if winner and winner not in (left, right):
            raise ValueError(f"Unknown winner for {match_id}")
        actions = sorted(events.pop(match_id, []), key=lambda a: a["sq"])
        if len(actions) != 16 or len({a["hero"] for a in actions}) != 16:
            raise ValueError(f"{match_id} does not have 16 distinct actions")
        first = "left" if actions[0]["team"] == left else "right"
        for index, action in enumerate(actions):
            if action["team"] not in (left, right):
                raise ValueError(f"Unknown team for {match_id}: {action['team']}")
            side = "left" if action.pop("team") == left else "right"
            expected_side = first if index in FIRST_ACTIONS else ("right" if first == "left" else "left")
            expected_type = "ban" if index in (0, 1, 8, 9) else "pick"
            if action.pop("sq") != index + 1 or side != expected_side or action["type"] != expected_type or action["order"] != ORDERS[index]:
                raise ValueError(f"Unexpected draft sequence at {match_id}, action {index + 1}")
            if chronology(match_id) < availability[action["hero"]]:
                raise ValueError(f"Hero unavailable for {match_id}: {action['hero']}")
            action["side"] = side
        matches.append({
            "match_id": match_id, "week": int(float(metadata[f"D{row}"])),
            "region": metadata[f"C{row}"], "round": metadata[f"E{row}"],
            "game": int(float(metadata[f"F{row}"])), "left_team": left, "right_team": right,
            "first_pick": first, "winner": ("left" if winner == left else "right") if winner else None,
            "actions": actions, "revision": 1, "source": "google-sheet",
        })
    if events:
        raise ValueError(f"Drafts missing from the match registry: {list(events)}")
    matches.sort(key=lambda match: chronology(match["match_id"]))
    exported = datetime.datetime.now(datetime.timezone.utc).isoformat()
    snapshot = {"source": SOURCE, "exported_at": exported, "heroes": heroes, "matches": matches}
    output_dir = repo / "dlns"
    output_dir.mkdir(exist_ok=True)
    (output_dir / "history.json").write_text(json.dumps(snapshot, ensure_ascii=True, separators=(",", ":")) + "\n", encoding="utf-8")

    cache = repo / ".cache" / "dlns"
    cache.mkdir(parents=True, exist_ok=True)
    payload = json.dumps(matches, ensure_ascii=True, separators=(",", ":"))
    if "$dlnshistory$" in payload:
        raise ValueError("SQL delimiter collision in source data")
    sql = """begin;
insert into public.dlns_matches (match_id,week,region,round,game,left_team,right_team,first_pick,winner,actions,source)
select v->>'match_id',(v->>'week')::integer,v->>'region',v->>'round',(v->>'game')::integer,
  v->>'left_team',v->>'right_team',v->>'first_pick',nullif(v->>'winner',''),v->'actions','google-sheet'
from jsonb_array_elements($dlnshistory$""" + payload + """$dlnshistory$::jsonb) as item(v)
on conflict (match_id) do nothing;
commit;
select count(*) as matches,sum(jsonb_array_length(actions)) as draft_actions from public.dlns_matches;
"""
    (cache / "import-history.sql").write_text(sql, encoding="utf-8")

    csv_text = io.StringIO(newline="")
    fields = ["sq", "matchid", "region", "week", "round", "game", "team", "type", "order", "hero", "matchresult", "player"]
    writer = csv.DictWriter(csv_text, fieldnames=fields, lineterminator="\n")
    writer.writeheader()
    missing_players = 0
    for match in matches:
        for index, action in enumerate(match["actions"]):
            result = ""
            if action["type"] == "pick":
                missing_players += not bool(action["player"])
                if match["winner"]:
                    result = "Win" if action["side"] == match["winner"] else "Loss"
            writer.writerow({
                "sq": index + 1, "matchid": match["match_id"], "region": match["region"],
                "week": match["week"], "round": match["round"], "game": match["game"],
                "team": match[f"{action['side']}_team"], "type": action["type"].title(),
                "order": action["order"], "hero": action["hero"], "matchresult": result, "player": action["player"],
            })
    encoded = base64.b64encode(csv_text.getvalue().encode("utf-8")).decode("ascii")
    (repo / "DLNS.snapshot.js").write_text(f"// Offline history snapshot. Exported {exported}.\nwindow.EMBEDDED_CSV_B64='{encoded}';\n", encoding="ascii")
    print(json.dumps({"matches": len(matches), "actions": len(matches) * 16, "missing_player_assignments": missing_players, "sql": str(cache / "import-history.sql")}))


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("workbook", type=Path)
    arguments = parser.parse_args()
    prepare(arguments.workbook, Path(__file__).resolve().parent.parent)
