#!/usr/bin/env python3
"""Join EA SPORTS FC ratings onto the Premier League club lists.

Source: https://drop-api.ea.com/rating/ea-sports-fc, the feed behind
ea.com/games/ea-sports-fc/ratings. Every rating is copied as published.

A Premier League player is matched to an EA player on the same birth date
whose name agrees (same surname, or every EA name word appears in the
Premier League name, or the reverse). Ambiguous matches are dropped.

Output: data/ea-ratings.json keyed by Premier League player id.
"""

from __future__ import annotations

import json
import sys
import time
import unicodedata
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "data"
RAW = DATA / "raw" / "ea"
OUT = DATA / "ea-ratings.json"
API = "https://drop-api.ea.com/rating/ea-sports-fc"
PAGE = 100

KEEP_STATS = [
    "pac", "sho", "pas", "dri", "def", "phy",
    "acceleration", "sprintSpeed", "finishing", "shotPower", "longShots", "positioning",
    "vision", "shortPassing", "longPassing", "crossing", "ballControl", "agility",
    "composure", "reactions", "headingAccuracy", "jumping", "strength", "stamina",
    "standingTackle", "slidingTackle", "interceptions", "defensiveAwareness", "aggression",
]


def fetch_page(offset: int, refresh: bool) -> dict:
    path = RAW / f"page-{offset:05d}.json"
    if path.exists() and not refresh:
        return json.loads(path.read_text())
    url = f"{API}?locale=en&limit={PAGE}&offset={offset}"
    request = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    for attempt in range(4):
        try:
            with urllib.request.urlopen(request, timeout=30) as response:
                payload = json.loads(response.read())
            path.write_text(json.dumps(payload))
            return payload
        except Exception:
            if attempt == 3:
                raise
            time.sleep(2 ** (attempt + 1))
    raise RuntimeError("unreachable")


def words(text: str) -> list[str]:
    plain = unicodedata.normalize("NFKD", text).encode("ascii", "ignore").decode().lower()
    cleaned = "".join(ch if ch.isalnum() else " " for ch in plain)
    return [word for word in cleaned.split() if word]


def ea_birth(label: str | None) -> str | None:
    if not label:
        return None
    try:
        return datetime.strptime(label.split(" ")[0], "%m/%d/%Y").date().isoformat()
    except ValueError:
        return None


def names_agree(pl: dict, ea: dict) -> bool:
    pl_words = set(words(pl["name"])) | set(words(pl.get("firstName") or "")) | set(words(pl.get("lastName") or ""))
    ea_full = words(" ".join(filter(None, [ea.get("firstName"), ea.get("lastName")])))
    ea_common = words(ea.get("commonName") or "")
    pl_last = words(pl.get("lastName") or "")
    if pl_last and set(pl_last) <= set(ea_full + ea_common):
        return True
    if ea_common and set(ea_common) <= pl_words:
        return True
    if ea_full and set(words(ea.get("lastName") or "")) <= pl_words:
        return True
    return False


def first_name_agrees(pl: dict, ea: dict) -> bool:
    pl_first = words(pl.get("firstName") or "")
    ea_first = words(ea.get("firstName") or "")
    return bool(pl_first) and bool(ea_first) and pl_first[0] == ea_first[0]


def main() -> None:
    refresh = "--refresh" in sys.argv
    RAW.mkdir(parents=True, exist_ok=True)
    first = fetch_page(0, refresh)
    total = first["totalItems"]
    offsets = list(range(PAGE, total, PAGE))
    with ThreadPoolExecutor(max_workers=8) as pool:
        pages = [first, *pool.map(lambda offset: fetch_page(offset, refresh), offsets)]
    items = [item for page in pages for item in page.get("items", []) if item.get("gender", {}).get("id") == 0]

    by_birth: dict[str, list[dict]] = {}
    by_year: dict[str, list[dict]] = {}
    for item in items:
        birth = ea_birth(item.get("birthdate"))
        if birth:
            by_birth.setdefault(birth, []).append(item)
            by_year.setdefault(birth[:4], []).append(item)

    index = json.loads((DATA / "index.json").read_text())
    matched: dict[str, dict] = {}
    unmatched = []
    for player in index["players"]:
        detail = json.loads((DATA / "players" / f"{player['id']}.json").read_text())
        birth = detail.get("birthIso") or ""
        candidates = [item for item in by_birth.get(birth, []) if names_agree(detail, item)]
        if len(candidates) > 1:
            candidates = [item for item in candidates if first_name_agrees(detail, item)]
        if not candidates and birth:
            # EA sometimes stores a birth date a few days off. Fall back to the
            # same first and last name in the same birth year, only if unique.
            candidates = [
                item for item in by_year.get(birth[:4], [])
                if first_name_agrees(detail, item) and set(words(detail.get("lastName") or "_")) <= set(words(item.get("lastName") or ""))
            ]
        if len(candidates) != 1:
            unmatched.append({"id": player["id"], "name": player["name"], "minutes": player["minutes"], "candidates": len(candidates)})
            continue
        item = candidates[0]
        matched[str(player["id"])] = {
            "eaId": item["id"],
            "eaName": item.get("commonName") or f"{item.get('firstName', '')} {item.get('lastName', '')}".strip(),
            "overall": item["overallRating"],
            "position": item["position"]["shortLabel"],
            "positionType": item["position"]["positionType"]["id"],
            "eaTeam": (item.get("team") or {}).get("label"),
            "skillMoves": item.get("skillMoves"),
            "weakFoot": item.get("weakFootAbility"),
            "avatarUrl": item.get("avatarUrl"),
            "stats": {key: item["stats"][key]["value"] for key in KEEP_STATS if key in item["stats"]},
        }

    with_minutes = [row for row in unmatched if row["minutes"] > 0]
    OUT.write_text(json.dumps({
        "source": API,
        "fetchedAt": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "eaPlayers": len(items),
        "matched": len(matched),
        "unmatchedWithMinutes": with_minutes,
        "players": matched,
    }, ensure_ascii=False, separators=(",", ":")))
    print(f"ea players {len(items)}, matched {len(matched)} of {len(index['players'])}, unmatched with minutes {len(with_minutes)}")
    for row in sorted(with_minutes, key=lambda r: -r["minutes"])[:25]:
        print("  ", row)


if __name__ == "__main__":
    main()
