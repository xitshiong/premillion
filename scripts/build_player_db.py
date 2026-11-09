#!/usr/bin/env python3
"""Build the Premier League player database from published feeds.

Sources, fetched live:
  * Premier League player stats (footballapi.pulselive.com), competition
    season 841 (2026/27). Counting stats and percentages come from here.
  * Fantasy Premier League bootstrap-static. Expected goals, expected
    assists, and the Opta id used to join a player come from here.

Nothing in the rating tables is typed in by hand. A missing count on a
player who has already played is stored as zero, because this feed omits
zeroes. Players with no minutes keep null ratings.
"""

from __future__ import annotations

import json
import math
import sqlite3
import time
import unicodedata
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "data"
RAW = DATA / "raw"
DB_PATH = DATA / "premier-league.sqlite"

SEASON_ID = 841
SEASON_LABEL = "2026/27"
COMPETITION = "Premier League"

PULSE = "https://footballapi.pulselive.com"
FPL_URL = "https://fantasy.premierleague.com/api/bootstrap-static/"

# Identity crosswalk only. These are club names, not statistics.
FPL_TEAM_TO_PULSE = {
    "Arsenal": "Arsenal",
    "Aston Villa": "Aston Villa",
    "Bournemouth": "Bournemouth",
    "Brentford": "Brentford",
    "Brighton": "Brighton & Hove Albion",
    "Chelsea": "Chelsea",
    "Coventry City": "Coventry City",
    "Crystal Palace": "Crystal Palace",
    "Everton": "Everton",
    "Fulham": "Fulham",
    "Hull City": "Hull City",
    "Ipswich Town": "Ipswich Town",
    "Leeds": "Leeds United",
    "Liverpool": "Liverpool",
    "Man City": "Manchester City",
    "Man Utd": "Manchester United",
    "Newcastle": "Newcastle United",
    "Nott'm Forest": "Nottingham Forest",
    "Spurs": "Tottenham Hotspur",
    "Sunderland": "Sunderland",
}

HEADERS = {
    "User-Agent": "Mozilla/5.0 (compatible; pl-player-db/1.0; +https://www.premierleague.com)",
    "Accept": "application/json",
    "Origin": "https://www.premierleague.com",
    "Referer": "https://www.premierleague.com/",
}

# Human labels for official feed keys. The key is what the API sends.
# Labels stay with the published meaning and do not add a new measurement.
STAT_LABELS = {
    "appearances": "Appearances",
    "game_started": "Starts",
    "mins_played": "Minutes",
    "goals": "Goals",
    "goal_assist": "Assists",
    "winning_goal": "Winning goals",
    "goals_openplay": "Open-play goals",
    "att_hd_goal": "Headed goals",
    "total_scoring_att": "Shots",
    "ontarget_scoring_att": "Shots on target",
    "shot_off_target": "Shots off target",
    "blocked_scoring_att": "Blocked shots",
    "attempts_ibox": "Shots inside the box",
    "attempts_obox": "Shots outside the box",
    "big_chance_scored": "Big chances scored",
    "big_chance_missed": "Big chances missed",
    "att_hd_total": "Headed shots",
    "att_hd_target": "Headed shots on target",
    "total_pass": "Passes attempted",
    "accurate_pass": "Passes completed",
    "total_final_third_passes": "Final-third passes attempted",
    "successful_final_third_passes": "Final-third passes completed",
    "total_long_balls": "Long passes attempted",
    "accurate_long_balls": "Long passes completed",
    "total_through_ball": "Through balls attempted",
    "successful_put_through": "Through balls completed",
    "put_through": "Through balls",
    "total_fwd_zone_pass": "Opposition-half passes attempted",
    "accurate_fwd_zone_pass": "Opposition-half passes completed",
    "total_back_zone_pass": "Own-half passes attempted",
    "accurate_back_zone_pass": "Own-half passes completed",
    "open_play_pass": "Open-play passes attempted",
    "successful_open_play_pass": "Open-play passes completed",
    "fwd_pass": "Forward passes",
    "backward_pass": "Backward passes",
    "leftside_pass": "Passes to the left",
    "rightside_pass": "Passes to the right",
    "total_chipped_pass": "Chipped passes attempted",
    "accurate_chipped_pass": "Chipped passes completed",
    "total_cross": "Crosses attempted",
    "accurate_cross": "Crosses completed",
    "total_att_assist": "Shot-creating passes",
    "att_assist_openplay": "Open-play shot-creating passes",
    "ontarget_att_assist": "Shot-creating passes, shot on target",
    "offtarget_att_assist": "Shot-creating passes, shot off target",
    "shot_created": "Shots created",
    "big_chance_created": "Big chances created",
    "total_contest": "Dribbles attempted",
    "won_contest": "Dribbles completed",
    "carries": "Carries",
    "progressive_carries": "Progressive carries",
    "touches": "Touches",
    "touches_in_final_third": "Touches in the final third",
    "touches_in_opp_box": "Touches in the opposition box",
    "dispossessed": "Dispossessed",
    "times_tackled": "Times tackled",
    "unsuccessful_touch": "Unsuccessful touches",
    "poss_lost_ctrl": "Possession lost",
    "poss_lost_all": "Possession lost, all",
    "turnover": "Turnovers",
    "aerial_won": "Aerial duels won",
    "aerial_lost": "Aerial duels lost",
    "duel_won": "Duels won",
    "duel_lost": "Duels lost",
    "was_fouled": "Fouls won",
    "fouls": "Fouls committed",
    "fouled_final_third": "Fouls won in the final third",
    "total_tackle": "Tackles attempted",
    "won_tackle": "Tackles won",
    "challenge_lost": "Challenges lost",
    "attempted_tackle_foul": "Tackle fouls",
    "interception": "Interceptions",
    "interception_won": "Interceptions won",
    "total_clearance": "Clearances",
    "effective_clearance": "Effective clearances",
    "effective_head_clearance": "Effective headed clearances",
    "head_clearance": "Headed clearances",
    "outfielder_block": "Blocks",
    "six_yard_block": "Six-yard blocks",
    "ball_recovery": "Recoveries",
    "poss_won_att_3rd": "Possession won in the attacking third",
    "poss_won_mid_3rd": "Possession won in the middle third",
    "poss_won_def_3rd": "Possession won in the defensive third",
    "clean_sheet": "Clean sheets",
    "goals_conceded": "Goals conceded",
    "saves": "Saves",
    "saved_ibox": "Saves inside the box",
    "saved_obox": "Saves outside the box",
    "diving_save": "Diving saves",
    "dive_save": "Dive saves",
    "dive_catch": "Dive catches",
    "stand_save": "Standing saves",
    "big_chance_saves": "Big-chance saves",
    "punches": "Punches",
    "good_high_claim": "Successful high claims",
    "total_high_claim": "High claims",
    "keeper_pick_up": "Keeper pick-ups",
    "accurate_keeper_sweeper": "Sweeper actions completed",
    "total_keeper_sweeper": "Sweeper actions",
    "accurate_keeper_throws": "Throws completed",
    "keeper_throws": "Throws",
    "goal_kicks": "Goal kicks",
    "accurate_goal_kicks": "Accurate goal kicks",
    "penalty_faced": "Penalties faced",
    "penalty_save": "Penalties saved",
    "error_lead_to_goal": "Errors leading to a goal",
    "yellow_card": "Yellow cards",
    "red_card": "Red cards",
    "total_offside": "Offsides",
    "own_goals": "Own goals",
}

STAT_GROUPS = {
    "playing_time": "Playing time",
    "shooting": "Shooting",
    "passing": "Passing",
    "creation": "Chance creation",
    "possession": "Dribbling and carrying",
    "duels": "Duels",
    "defending": "Defending",
    "goalkeeping": "Goalkeeping",
    "discipline": "Discipline",
    "other": "Other published counts",
}

STAT_GROUP_OF = {
    "appearances": "playing_time",
    "game_started": "playing_time",
    "mins_played": "playing_time",
    "goals": "shooting",
    "goal_assist": "creation",
    "winning_goal": "shooting",
    "goals_openplay": "shooting",
    "att_hd_goal": "shooting",
    "total_scoring_att": "shooting",
    "ontarget_scoring_att": "shooting",
    "shot_off_target": "shooting",
    "blocked_scoring_att": "shooting",
    "attempts_ibox": "shooting",
    "attempts_obox": "shooting",
    "big_chance_scored": "shooting",
    "big_chance_missed": "shooting",
    "att_hd_total": "shooting",
    "att_hd_target": "shooting",
    "total_pass": "passing",
    "accurate_pass": "passing",
    "total_final_third_passes": "passing",
    "successful_final_third_passes": "passing",
    "total_long_balls": "passing",
    "accurate_long_balls": "passing",
    "total_through_ball": "creation",
    "successful_put_through": "creation",
    "put_through": "creation",
    "total_fwd_zone_pass": "passing",
    "accurate_fwd_zone_pass": "passing",
    "total_back_zone_pass": "passing",
    "accurate_back_zone_pass": "passing",
    "open_play_pass": "passing",
    "successful_open_play_pass": "passing",
    "fwd_pass": "passing",
    "backward_pass": "passing",
    "leftside_pass": "passing",
    "rightside_pass": "passing",
    "total_chipped_pass": "passing",
    "accurate_chipped_pass": "passing",
    "total_cross": "passing",
    "accurate_cross": "passing",
    "total_att_assist": "creation",
    "att_assist_openplay": "creation",
    "ontarget_att_assist": "creation",
    "offtarget_att_assist": "creation",
    "shot_created": "creation",
    "big_chance_created": "creation",
    "total_contest": "possession",
    "won_contest": "possession",
    "carries": "possession",
    "progressive_carries": "possession",
    "touches": "possession",
    "touches_in_final_third": "possession",
    "touches_in_opp_box": "possession",
    "dispossessed": "possession",
    "times_tackled": "possession",
    "unsuccessful_touch": "possession",
    "poss_lost_ctrl": "possession",
    "poss_lost_all": "possession",
    "turnover": "possession",
    "aerial_won": "duels",
    "aerial_lost": "duels",
    "duel_won": "duels",
    "duel_lost": "duels",
    "was_fouled": "duels",
    "fouls": "discipline",
    "fouled_final_third": "duels",
    "total_tackle": "defending",
    "won_tackle": "defending",
    "challenge_lost": "defending",
    "attempted_tackle_foul": "defending",
    "interception": "defending",
    "interception_won": "defending",
    "total_clearance": "defending",
    "effective_clearance": "defending",
    "effective_head_clearance": "defending",
    "head_clearance": "defending",
    "outfielder_block": "defending",
    "six_yard_block": "defending",
    "ball_recovery": "defending",
    "poss_won_att_3rd": "defending",
    "poss_won_mid_3rd": "defending",
    "poss_won_def_3rd": "defending",
    "clean_sheet": "goalkeeping",
    "goals_conceded": "goalkeeping",
    "saves": "goalkeeping",
    "saved_ibox": "goalkeeping",
    "saved_obox": "goalkeeping",
    "diving_save": "goalkeeping",
    "dive_save": "goalkeeping",
    "dive_catch": "goalkeeping",
    "stand_save": "goalkeeping",
    "big_chance_saves": "goalkeeping",
    "punches": "goalkeeping",
    "good_high_claim": "goalkeeping",
    "total_high_claim": "goalkeeping",
    "keeper_pick_up": "goalkeeping",
    "accurate_keeper_sweeper": "goalkeeping",
    "total_keeper_sweeper": "goalkeeping",
    "accurate_keeper_throws": "goalkeeping",
    "keeper_throws": "goalkeeping",
    "goal_kicks": "goalkeeping",
    "accurate_goal_kicks": "goalkeeping",
    "penalty_faced": "goalkeeping",
    "penalty_save": "goalkeeping",
    "error_lead_to_goal": "goalkeeping",
    "yellow_card": "discipline",
    "red_card": "discipline",
    "total_offside": "discipline",
    "own_goals": "discipline",
}

MIN_MINUTES = 270
MIN_PASSES = 50
MIN_SHOTS = 8
MIN_DRIBBLES = 8
MIN_AERIALS = 8
MIN_TACKLES = 8
MIN_DUELS = 10
MIN_SAVE_DENOM = 15


def norm_name(value: str) -> str:
    text = unicodedata.normalize("NFKD", value or "")
    text = "".join(ch for ch in text if not unicodedata.combining(ch))
    out = []
    for ch in text.lower():
        if ch.isalnum() or ch.isspace():
            out.append(ch)
        else:
            out.append(" ")
    return " ".join("".join(out).split())


def fetch(url: str, cache: Path | None, refresh: bool = False) -> dict:
    if cache and cache.exists() and not refresh:
        return json.loads(cache.read_text())
    last_error = None
    for attempt in range(5):
        request = urllib.request.Request(url, headers=HEADERS)
        try:
            with urllib.request.urlopen(request, timeout=60) as response:
                body = response.read()
            payload = json.loads(body)
            if cache:
                cache.parent.mkdir(parents=True, exist_ok=True)
                cache.write_text(json.dumps(payload))
            return payload
        except urllib.error.HTTPError as error:
            last_error = error
            if error.code not in (429, 500, 502, 503, 504) or attempt == 4:
                raise
            time.sleep(1.5 * (attempt + 1))
        except (urllib.error.URLError, TimeoutError, json.JSONDecodeError) as error:
            last_error = error
            if attempt == 4:
                raise
            time.sleep(1.5 * (attempt + 1))
    raise RuntimeError(f"failed to fetch {url}: {last_error}")


def as_int(value) -> int | None:
    if value is None or value == "":
        return None
    return int(value)


def as_float(value) -> float | None:
    if value is None or value == "":
        return None
    return float(value)


def iso_from_millis(millis) -> str | None:
    if millis is None:
        return None
    stamp = datetime.fromtimestamp(float(millis) / 1000, tz=timezone.utc)
    return stamp.date().isoformat()


def load_teams(refresh: bool) -> list[dict]:
    payload = fetch(
        f"{PULSE}/football/teams?compSeasons={SEASON_ID}&pageSize=100&altIds=true&page=0",
        RAW / "teams.json",
        refresh,
    )
    teams = []
    for row in payload["content"]:
        if row.get("teamType") != "FIRST":
            continue
        teams.append(
            {
                "id": int(row["id"]),
                "name": row.get("name") or row["club"]["name"],
                "short_name": row.get("shortName") or row["club"].get("shortName"),
                "abbr": row["club"].get("abbr"),
            }
        )
    teams.sort(key=lambda team: team["name"])
    return teams


def load_squad(team: dict, refresh: bool) -> list[dict]:
    payload = fetch(
        f"{PULSE}/football/teams/{team['id']}/compseasons/{SEASON_ID}/staff",
        RAW / "squads" / f"{team['id']}.json",
        refresh,
    )
    players = []
    seen = set()
    for row in payload.get("players", []):
        player_id = int(row["id"])
        if player_id in seen:
            continue
        seen.add(player_id)
        info = row.get("info") or {}
        name = row.get("name") or {}
        national = row.get("nationalTeam") or {}
        birth = row.get("birth") or {}
        birth_date = (birth.get("date") or {})
        players.append(
            {
                "id": player_id,
                "opta_player_id": row.get("playerId"),
                "name": name.get("display") or f"{name.get('first', '')} {name.get('last', '')}".strip(),
                "first_name": name.get("first"),
                "last_name": name.get("last"),
                "position": info.get("position"),
                "position_info": info.get("positionInfo"),
                "shirt_number": as_int(info.get("shirtNum")),
                "team_id": team["id"],
                "nationality": national.get("country"),
                "country_iso": national.get("isoCode"),
                "birth_label": birth_date.get("label"),
                "birth_iso": iso_from_millis(birth_date.get("millis")),
                "height_cm": as_int(row.get("height")),
                "weight_kg": as_int(row.get("weight")),
                "loan": 1 if info.get("loan") else 0,
            }
        )
    return players


def load_player_detail(player_id: int, refresh: bool) -> dict:
    return fetch(
        f"{PULSE}/football/players/{player_id}?altIds=true&compSeasons={SEASON_ID}",
        RAW / "players" / f"{player_id}.json",
        refresh,
    )


def load_player_stats(player_id: int, refresh: bool) -> dict:
    return fetch(
        f"{PULSE}/football/stats/player/{player_id}?comps=1&compSeasons={SEASON_ID}",
        RAW / "stats" / f"{player_id}.json",
        refresh,
    )


def parallel_map(items, worker, workers: int = 8):
    results = {}
    errors = []
    with ThreadPoolExecutor(max_workers=workers) as pool:
        futures = {pool.submit(worker, item): item for item in items}
        done = 0
        total = len(futures)
        for future in as_completed(futures):
            item = futures[future]
            done += 1
            try:
                results[item] = future.result()
            except Exception as error:  # noqa: BLE001 - keep the batch going
                errors.append({"item": item, "error": str(error)})
            if done % 50 == 0 or done == total:
                print(f"  fetched {done}/{total}", flush=True)
    return results, errors


def zero_fill(raw_by_player: dict[int, dict[str, float]]) -> tuple[dict[int, dict[str, tuple[float, int]]], list[str]]:
    """Return value, reported flag. Missing counts become 0 after a player has minutes."""
    catalog = sorted({name for stats in raw_by_player.values() for name in stats})
    filled = {}
    for player_id, stats in raw_by_player.items():
        minutes = stats.get("mins_played", 0) or 0
        appearances = stats.get("appearances", 0) or 0
        played = minutes > 0 or appearances > 0
        row = {}
        if played:
            for name in catalog:
                if name in stats:
                    row[name] = (float(stats[name]), 1)
                else:
                    row[name] = (0.0, 0)
        else:
            for name, value in stats.items():
                row[name] = (float(value), 1)
        filled[player_id] = row
    return filled, catalog


def per90(count: float, minutes: float) -> float | None:
    if minutes <= 0:
        return None
    return count / (minutes / 90.0)


def ratio(numerator: float, denominator: float) -> float | None:
    if denominator <= 0:
        return None
    return numerator / denominator


def peer_ok(position: str | None, peer: str) -> bool:
    if peer == "outfield":
        return position in {"D", "M", "F"}
    if peer == "goalkeeper":
        return position == "G"
    if peer == "all":
        return position in {"G", "D", "M", "F"}
    return False


def assign_percentiles(rows: list[dict]) -> None:
    groups: dict[tuple[str, str], list[dict]] = {}
    for row in rows:
        if row["value"] is None or not row["eligible"]:
            row["percentile"] = None
            row["peer_count"] = 0
            continue
        groups.setdefault((row["rate_key"], row["peer_group"]), []).append(row)
    for bucket in groups.values():
        ordered = sorted(bucket, key=lambda item: item["value"])
        count = len(ordered)
        index = 0
        while index < count:
            end = index
            while end + 1 < count and ordered[end + 1]["value"] == ordered[index]["value"]:
                end += 1
            # Mid-rank percentile on 0..100. One eligible player has no comparison.
            if count == 1:
                percentile = None
            else:
                start_rank = index + 1
                end_rank = end + 1
                mid_rank = (start_rank + end_rank) / 2
                percentile = 100 * (mid_rank - 1) / (count - 1)
            for item in ordered[index : end + 1]:
                item["percentile"] = None if percentile is None else round(percentile, 2)
                item["peer_count"] = count
            index = end + 1


def rate_row(
    player: dict,
    key: str,
    label: str,
    group: str,
    value: float | None,
    unit: str,
    formula: str,
    source: str,
    peer: str,
    featured: int,
    minutes_used: float | None,
    attempts_used: float | None,
    eligible: bool,
    sort_order: int,
) -> dict:
    return {
        "player_id": player["id"],
        "rate_key": key,
        "label": label,
        "group_name": group,
        "value": None if value is None else round(float(value), 6),
        "unit": unit,
        "formula": formula,
        "source": source,
        "peer_group": peer,
        "featured": featured,
        "minutes_used": None if minutes_used is None else int(round(minutes_used)),
        "attempts_used": None if attempts_used is None else round(float(attempts_used), 3),
        "eligible": 1 if eligible and value is not None and peer_ok(player.get("position"), peer) else 0,
        "percentile": None,
        "peer_count": 0,
        "sort_order": sort_order,
    }


def build_rates(player: dict, stats: dict[str, tuple[float, int]], fpl: dict | None) -> list[dict]:
    def count(name: str) -> float:
        if name not in stats:
            return 0.0
        return stats[name][0]

    minutes = count("mins_played")
    played = minutes > 0
    rows = []
    order = 0

    def add(**kwargs):
        nonlocal order
        order += 1
        kwargs.setdefault("minutes_used", minutes if played else None)
        rows.append(rate_row(player, sort_order=order, **kwargs))

    def add_per90(key, label, group, stat, formula, peer, featured, source="Premier League match feed, 2026/27"):
        # One minute on the pitch turns a single action into a huge per-90 rate.
        # The count stays in player_stats. The rate is published from 90 minutes.
        value = per90(count(stat), minutes) if minutes >= 90 else None
        eligible = minutes >= MIN_MINUTES and value is not None and peer_ok(player.get("position"), peer)
        add(
            key=key,
            label=label,
            group=group,
            value=value,
            unit="per 90",
            formula=formula,
            source=source,
            peer=peer,
            featured=featured,
            attempts_used=count(stat) if played else None,
            eligible=eligible,
        )

    add_per90(
        "shooting_shots",
        "Shots",
        "Shooting",
        "total_scoring_att",
        "total_scoring_att / (mins_played / 90)",
        "outfield",
        0,
    )
    add_per90(
        "shots_on_target",
        "Shots on target",
        "Shooting",
        "ontarget_scoring_att",
        "ontarget_scoring_att / (mins_played / 90)",
        "outfield",
        0,
    )
    shots = count("total_scoring_att") if played else 0
    shot_acc = ratio(count("ontarget_scoring_att"), shots) if shots >= MIN_SHOTS else None
    add(
        key="shot_accuracy",
        label="Shot accuracy",
        group="Shooting",
        value=shot_acc,
        unit="ratio",
        formula="ontarget_scoring_att / total_scoring_att, published once total_scoring_att reaches 8",
        source="Premier League match feed, 2026/27",
        peer="outfield",
        featured=0,
        attempts_used=shots if played else None,
        eligible=shot_acc is not None and peer_ok(player.get("position"), "outfield"),
    )
    add_per90("goals_per_90", "Goals", "Shooting", "goals", "goals / (mins_played / 90)", "outfield", 0)
    add_per90("assists_per_90", "Assists", "Chance creation", "goal_assist", "goal_assist / (mins_played / 90)", "outfield", 0)

    # Passing. Completion is a share of attempts. Final-third volume is the
    # build stat called Passing, because raw completion rewards short passes.
    passes = count("total_pass") if played else 0
    completion = ratio(count("accurate_pass"), passes) if passes >= MIN_PASSES and minutes >= MIN_MINUTES else None
    add(
        key="pass_completion",
        label="Pass completion",
        group="Passing",
        value=completion,
        unit="ratio",
        formula="accurate_pass / total_pass, published at 270 minutes and at least 50 passes",
        source="Premier League match feed, 2026/27",
        peer="all",
        featured=1,
        attempts_used=passes if played else None,
        eligible=completion is not None and peer_ok(player.get("position"), "all"),
    )
    add_per90(
        "passing",
        "Passing",
        "Passing",
        "successful_final_third_passes",
        "successful_final_third_passes / (mins_played / 90)",
        "outfield",
        1,
    )
    add_per90(
        "through_balls",
        "Completed through balls",
        "Chance creation",
        "successful_put_through",
        "successful_put_through / (mins_played / 90)",
        "outfield",
        0,
    )
    add_per90(
        "chance_creation",
        "Chance creation",
        "Chance creation",
        "total_att_assist",
        "total_att_assist / (mins_played / 90). total_att_assist is the feed's shot-creating pass count.",
        "outfield",
        1,
    )
    add_per90(
        "big_chances_created",
        "Big chances created",
        "Chance creation",
        "big_chance_created",
        "big_chance_created / (mins_played / 90)",
        "outfield",
        0,
    )

    add_per90(
        "dribbling",
        "Dribbling",
        "Dribbling and carrying",
        "won_contest",
        "won_contest / (mins_played / 90)",
        "outfield",
        1,
    )
    dribbles = count("total_contest") if played else 0
    dribble_rate = ratio(count("won_contest"), dribbles) if dribbles >= MIN_DRIBBLES else None
    add(
        key="dribble_success",
        label="Dribble success",
        group="Dribbling and carrying",
        value=dribble_rate,
        unit="ratio",
        formula="won_contest / total_contest, published once total_contest reaches 8",
        source="Premier League match feed, 2026/27",
        peer="outfield",
        featured=0,
        attempts_used=dribbles if played else None,
        eligible=dribble_rate is not None and peer_ok(player.get("position"), "outfield"),
    )
    add_per90(
        "carrying",
        "Carrying",
        "Dribbling and carrying",
        "progressive_carries",
        "progressive_carries / (mins_played / 90)",
        "outfield",
        1,
    )

    add_per90("aerials", "Aerial duels", "Duels", "aerial_won", "aerial_won / (mins_played / 90)", "all", 1)
    aerials_faced = (count("aerial_won") + count("aerial_lost")) if played else 0
    aerial_rate = ratio(count("aerial_won"), aerials_faced) if aerials_faced >= MIN_AERIALS else None
    add(
        key="aerial_win_rate",
        label="Aerial win rate",
        group="Duels",
        value=aerial_rate,
        unit="ratio",
        formula="aerial_won / (aerial_won + aerial_lost), published once the player contests 8 aerials",
        source="Premier League match feed, 2026/27",
        peer="all",
        featured=0,
        attempts_used=aerials_faced if played else None,
        eligible=aerial_rate is not None and peer_ok(player.get("position"), "all"),
    )
    duels_faced = (count("duel_won") + count("duel_lost")) if played else 0
    duel_rate = ratio(count("duel_won"), duels_faced) if duels_faced >= MIN_DUELS else None
    add(
        key="duel_win_rate",
        label="Duel win rate",
        group="Duels",
        value=duel_rate,
        unit="ratio",
        formula="duel_won / (duel_won + duel_lost), published once the player contests 10 duels",
        source="Premier League match feed, 2026/27",
        peer="all",
        featured=0,
        attempts_used=duels_faced if played else None,
        eligible=duel_rate is not None and peer_ok(player.get("position"), "all"),
    )
    add_per90("fouls_won", "Fouls won", "Duels", "was_fouled", "was_fouled / (mins_played / 90)", "all", 0)

    add_per90("tackling", "Tackling", "Defending", "won_tackle", "won_tackle / (mins_played / 90)", "all", 1)
    tackles = count("total_tackle") if played else 0
    tackle_rate = ratio(count("won_tackle"), tackles) if tackles >= MIN_TACKLES else None
    add(
        key="tackle_win_rate",
        label="Tackle win rate",
        group="Defending",
        value=tackle_rate,
        unit="ratio",
        formula="won_tackle / total_tackle, published once total_tackle reaches 8",
        source="Premier League match feed, 2026/27",
        peer="all",
        featured=0,
        attempts_used=tackles if played else None,
        eligible=tackle_rate is not None and peer_ok(player.get("position"), "all"),
    )
    add_per90("interceptions", "Interceptions", "Defending", "interception", "interception / (mins_played / 90)", "all", 0)
    add_per90("recoveries", "Recoveries", "Defending", "ball_recovery", "ball_recovery / (mins_played / 90)", "all", 0)
    add_per90("clearances", "Clearances", "Defending", "total_clearance", "total_clearance / (mins_played / 90)", "all", 0)
    add_per90(
        "pressing",
        "Pressing",
        "Defending",
        "poss_won_att_3rd",
        "poss_won_att_3rd / (mins_played / 90)",
        "outfield",
        1,
    )

    # Expected goals and assists are published by Fantasy Premier League, not
    # by the match-count feed. They stay null when the player cannot be joined.
    fpl_minutes = float(fpl["minutes"]) if fpl else 0.0
    xg = as_float(fpl["expected_goals"]) if fpl else None
    xa = as_float(fpl["expected_assists"]) if fpl else None
    xg90 = per90(xg, fpl_minutes) if fpl and xg is not None and fpl_minutes >= 90 else None
    xa90 = per90(xa, fpl_minutes) if fpl and xa is not None and fpl_minutes >= 90 else None
    add(
        key="shooting",
        label="Shooting",
        group="Shooting",
        value=xg90,
        unit="xG per 90",
        formula="expected_goals / (fpl_minutes / 90)",
        source="Fantasy Premier League bootstrap-static, Opta expected goals, 2026/27",
        peer="outfield",
        featured=1,
        minutes_used=fpl_minutes if fpl else None,
        attempts_used=xg,
        eligible=bool(fpl) and fpl_minutes >= MIN_MINUTES and xg90 is not None and peer_ok(player.get("position"), "outfield"),
    )
    add(
        key="vision",
        label="Vision",
        group="Chance creation",
        value=xa90,
        unit="xA per 90",
        formula="expected_assists / (fpl_minutes / 90)",
        source="Fantasy Premier League bootstrap-static, Opta expected assists, 2026/27",
        peer="outfield",
        featured=1,
        minutes_used=fpl_minutes if fpl else None,
        attempts_used=xa,
        eligible=bool(fpl) and fpl_minutes >= MIN_MINUTES and xa90 is not None and peer_ok(player.get("position"), "outfield"),
    )

    if player.get("position") == "G":
        add_per90("saves", "Shot stopping", "Goalkeeping", "saves", "saves / (mins_played / 90)", "goalkeeper", 1)
        shots_faced = (count("saves") + count("goals_conceded")) if played else 0
        save_rate = ratio(count("saves"), shots_faced) if shots_faced >= MIN_SAVE_DENOM else None
        add(
            key="save_percentage",
            label="Save percentage",
            group="Goalkeeping",
            value=save_rate,
            unit="ratio",
            formula="saves / (saves + goals_conceded), published once that denominator reaches 15. Own goals are not removed; the feed does not publish a separate own-goal split on every goalkeeper.",
            source="Premier League match feed, 2026/27",
            peer="goalkeeper",
            featured=1,
            attempts_used=shots_faced if played else None,
            eligible=save_rate is not None and player.get("position") == "G",
        )
        add_per90(
            "claims",
            "High claims",
            "Goalkeeping",
            "good_high_claim",
            "good_high_claim / (mins_played / 90)",
            "goalkeeper",
            1,
        )
        add_per90(
            "sweeper",
            "Sweeper keeping",
            "Goalkeeping",
            "accurate_keeper_sweeper",
            "accurate_keeper_sweeper / (mins_played / 90)",
            "goalkeeper",
            1,
        )
        add_per90(
            "goals_conceded_rate",
            "Goals conceded",
            "Goalkeeping",
            "goals_conceded",
            "goals_conceded / (mins_played / 90)",
            "goalkeeper",
            0,
        )

    return rows


def write_database(payload: dict) -> None:
    if DB_PATH.exists():
        DB_PATH.unlink()
    connection = sqlite3.connect(DB_PATH)
    connection.execute("PRAGMA foreign_keys = ON")
    connection.executescript(
        """
        CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
        CREATE TABLE teams (
          id INTEGER PRIMARY KEY,
          name TEXT NOT NULL,
          short_name TEXT,
          abbr TEXT,
          fpl_id INTEGER,
          fpl_name TEXT
        );
        CREATE TABLE players (
          id INTEGER PRIMARY KEY,
          opta_id TEXT,
          opta_player_number INTEGER,
          fpl_id INTEGER,
          fpl_match TEXT,
          name TEXT NOT NULL,
          first_name TEXT,
          last_name TEXT,
          position TEXT,
          position_info TEXT,
          shirt_number INTEGER,
          team_id INTEGER,
          detail_team_id INTEGER,
          current_club_name TEXT,
          team_conflict INTEGER NOT NULL,
          nationality TEXT,
          country_iso TEXT,
          birth_label TEXT,
          birth_iso TEXT,
          height_cm INTEGER,
          weight_kg INTEGER,
          loan INTEGER NOT NULL,
          minutes INTEGER NOT NULL,
          appearances INTEGER NOT NULL,
          starts INTEGER NOT NULL,
          goals INTEGER NOT NULL,
          assists INTEGER NOT NULL,
          fpl_minutes INTEGER,
          FOREIGN KEY (team_id) REFERENCES teams(id)
        );
        CREATE TABLE player_stats (
          player_id INTEGER NOT NULL,
          stat_name TEXT NOT NULL,
          value REAL NOT NULL,
          reported INTEGER NOT NULL,
          PRIMARY KEY (player_id, stat_name)
        );
        CREATE TABLE stat_catalog (
          stat_name TEXT PRIMARY KEY,
          label TEXT NOT NULL,
          group_key TEXT NOT NULL,
          group_label TEXT NOT NULL
        );
        CREATE TABLE fpl_stats (
          player_id INTEGER PRIMARY KEY,
          fpl_id INTEGER NOT NULL,
          minutes INTEGER,
          goals_scored INTEGER,
          assists INTEGER,
          expected_goals REAL,
          expected_assists REAL,
          expected_goal_involvements REAL,
          expected_goals_conceded REAL,
          expected_goals_per_90_published REAL,
          expected_assists_per_90_published REAL,
          influence REAL,
          creativity REAL,
          threat REAL,
          ict_index REAL,
          tackles INTEGER,
          clearances_blocks_interceptions INTEGER,
          recoveries INTEGER,
          defensive_contribution INTEGER,
          saves INTEGER,
          goals_conceded INTEGER,
          clean_sheets INTEGER,
          starts INTEGER
        );
        CREATE TABLE rates (
          player_id INTEGER NOT NULL,
          rate_key TEXT NOT NULL,
          label TEXT NOT NULL,
          group_name TEXT NOT NULL,
          value REAL,
          unit TEXT NOT NULL,
          formula TEXT NOT NULL,
          source TEXT NOT NULL,
          peer_group TEXT NOT NULL,
          featured INTEGER NOT NULL,
          eligible INTEGER NOT NULL,
          percentile REAL,
          peer_count INTEGER NOT NULL,
          minutes_used INTEGER,
          attempts_used REAL,
          sort_order INTEGER NOT NULL,
          PRIMARY KEY (player_id, rate_key)
        );
        CREATE INDEX idx_players_team ON players(team_id);
        CREATE INDEX idx_rates_key ON rates(rate_key, eligible);
        """
    )
    for key, value in payload["meta"].items():
        connection.execute("INSERT INTO meta (key, value) VALUES (?, ?)", (key, value if isinstance(value, str) else json.dumps(value)))
    connection.executemany(
        "INSERT INTO teams (id, name, short_name, abbr, fpl_id, fpl_name) VALUES (?, ?, ?, ?, ?, ?)",
        [
            (team["id"], team["name"], team["short_name"], team["abbr"], team.get("fpl_id"), team.get("fpl_name"))
            for team in payload["teams"]
        ],
    )
    connection.executemany(
        """
        INSERT INTO players (
          id, opta_id, opta_player_number, fpl_id, fpl_match, name, first_name, last_name,
          position, position_info, shirt_number, team_id, detail_team_id, current_club_name, team_conflict,
          nationality, country_iso, birth_label, birth_iso, height_cm, weight_kg, loan,
          minutes, appearances, starts, goals, assists, fpl_minutes
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        [player["row"] for player in payload["players"]],
    )
    stat_rows = []
    for player in payload["players"]:
        for name, (value, reported) in player["stats"].items():
            stat_rows.append((player["id"], name, value, reported))
    connection.executemany(
        "INSERT INTO player_stats (player_id, stat_name, value, reported) VALUES (?, ?, ?, ?)",
        stat_rows,
    )
    connection.executemany(
        "INSERT INTO stat_catalog (stat_name, label, group_key, group_label) VALUES (?, ?, ?, ?)",
        payload["catalog"],
    )
    connection.executemany(
        """
        INSERT INTO fpl_stats (
          player_id, fpl_id, minutes, goals_scored, assists, expected_goals, expected_assists,
          expected_goal_involvements, expected_goals_conceded, expected_goals_per_90_published,
          expected_assists_per_90_published, influence, creativity, threat, ict_index, tackles,
          clearances_blocks_interceptions, recoveries, defensive_contribution, saves,
          goals_conceded, clean_sheets, starts
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        payload["fpl_rows"],
    )
    rate_rows = []
    for player in payload["players"]:
        for rate in player["rates"]:
            rate_rows.append(
                (
                    rate["player_id"],
                    rate["rate_key"],
                    rate["label"],
                    rate["group_name"],
                    rate["value"],
                    rate["unit"],
                    rate["formula"],
                    rate["source"],
                    rate["peer_group"],
                    rate["featured"],
                    rate["eligible"],
                    rate["percentile"],
                    rate["peer_count"],
                    rate["minutes_used"],
                    rate["attempts_used"],
                    rate["sort_order"],
                )
            )
    connection.executemany(
        """
        INSERT INTO rates (
          player_id, rate_key, label, group_name, value, unit, formula, source, peer_group,
          featured, eligible, percentile, peer_count, minutes_used, attempts_used, sort_order
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        rate_rows,
    )
    connection.commit()
    connection.close()


def export_app_json(payload: dict) -> None:
    players_dir = DATA / "players"
    players_dir.mkdir(parents=True, exist_ok=True)
    for old in players_dir.glob("*.json"):
        old.unlink()

    index_players = []
    for player in payload["players"]:
        featured = []
        supporting = []
        for rate in sorted(player["rates"], key=lambda item: item["sort_order"]):
            packed = {
                "key": rate["rate_key"],
                "label": rate["label"],
                "group": rate["group_name"],
                "value": rate["value"],
                "unit": rate["unit"],
                "formula": rate["formula"],
                "source": rate["source"],
                "peerGroup": rate["peer_group"],
                "featured": bool(rate["featured"]),
                "eligible": bool(rate["eligible"]),
                "percentile": rate["percentile"],
                "peerCount": rate["peer_count"],
                "minutesUsed": rate["minutes_used"],
                "attemptsUsed": rate["attempts_used"],
            }
            if rate["featured"]:
                featured.append(packed)
            else:
                supporting.append(packed)
        raw = []
        for name, (value, reported) in sorted(player["stats"].items(), key=lambda item: item[0]):
            group_key = STAT_GROUP_OF.get(name, "other")
            raw.append(
                {
                    "name": name,
                    "label": STAT_LABELS.get(name, name.replace("_", " ")),
                    "group": STAT_GROUPS[group_key],
                    "value": value,
                    "reported": bool(reported),
                }
            )
        detail = {
            "id": player["id"],
            "name": player["name"],
            "firstName": player["first_name"],
            "lastName": player["last_name"],
            "position": player["position"],
            "positionInfo": player["position_info"],
            "shirtNumber": player["shirt_number"],
            "teamId": player["team_id"],
            "detailTeamId": player["detail_team_id"],
            "currentClubName": player["current_club_name"],
            "teamConflict": bool(player["team_conflict"]),
            "nationality": player["nationality"],
            "birthLabel": player["birth_label"],
            "birthIso": player["birth_iso"],
            "heightCm": player["height_cm"],
            "weightKg": player["weight_kg"],
            "loan": bool(player["loan"]),
            "optaId": player["opta_id"],
            "fplId": player["fpl_id"],
            "fplMatch": player["fpl_match"],
            "minutes": player["minutes"],
            "appearances": player["appearances"],
            "starts": player["starts"],
            "goals": player["goals"],
            "assists": player["assists"],
            "fplMinutes": player["fpl_minutes"],
            "fpl": player["fpl_public"],
            "featured": featured,
            "supporting": supporting,
            "raw": raw,
        }
        (players_dir / f"{player['id']}.json").write_text(json.dumps(detail))
        index_players.append(
            {
                "id": player["id"],
                "name": player["name"],
                "position": player["position"],
                "positionInfo": player["position_info"],
                "shirtNumber": player["shirt_number"],
                "teamId": player["team_id"],
                "currentClubName": player["current_club_name"],
                "teamConflict": bool(player["team_conflict"]),
                "nationality": player["nationality"],
                "minutes": player["minutes"],
                "appearances": player["appearances"],
                "goals": player["goals"],
                "assists": player["assists"],
                "fplMatch": player["fpl_match"],
                "featured": [
                    {
                        "key": rate["key"],
                        "label": rate["label"],
                        "value": rate["value"],
                        "unit": rate["unit"],
                        "eligible": rate["eligible"],
                        "percentile": rate["percentile"],
                    }
                    for rate in featured
                ],
            }
        )

    index = {
        "meta": payload["meta"],
        "teams": payload["teams"],
        "players": index_players,
        "featuredDefinitions": payload["featured_definitions"],
    }
    (DATA / "index.json").write_text(json.dumps(index))
    print(f"wrote {DB_PATH}")
    print(f"wrote {DATA / 'index.json'} and {len(index_players)} player files")


def main() -> None:
    import argparse

    parser = argparse.ArgumentParser()
    parser.add_argument("--refresh", action="store_true")
    args = parser.parse_args()
    refresh = args.refresh
    RAW.mkdir(parents=True, exist_ok=True)
    fetched_at = datetime.now(timezone.utc).isoformat()

    print("teams", flush=True)
    teams = load_teams(refresh)
    if len(teams) != 20:
        raise SystemExit(f"expected 20 Premier League clubs, got {len(teams)}")

    print("squads", flush=True)
    squads, squad_errors = parallel_map([team["id"] for team in teams], lambda team_id: load_squad(next(team for team in teams if team["id"] == team_id), refresh))
    if squad_errors:
        raise SystemExit(f"squad fetch failed: {squad_errors}")

    players = []
    for team in teams:
        players.extend(squads[team["id"]])
    # Staff lists can repeat a player. Keep the first squad entry.
    unique = {}
    duplicate_ids = []
    for player in players:
        if player["id"] in unique:
            duplicate_ids.append(player["id"])
            continue
        unique[player["id"]] = player
    players = list(unique.values())
    print(f"unique players on club lists: {len(players)}", flush=True)

    print("player details and season stats", flush=True)
    ids = [player["id"] for player in players]
    details, detail_errors = parallel_map(ids, lambda player_id: load_player_detail(player_id, refresh))
    stats_payloads, stat_errors = parallel_map(ids, lambda player_id: load_player_stats(player_id, refresh))
    if detail_errors or stat_errors:
        (RAW / "errors.json").write_text(json.dumps({"details": detail_errors, "stats": stat_errors}, indent=2))
        raise SystemExit(f"player fetch failed: details {len(detail_errors)} stats {len(stat_errors)}")

    print("fantasy premier league", flush=True)
    fpl = fetch(FPL_URL, RAW / "fpl-bootstrap.json", refresh)
    fpl_teams = {team["id"]: team for team in fpl["teams"]}
    pulse_by_name = {team["name"]: team for team in teams}
    for team in teams:
        match = next((name for name, pulse_name in FPL_TEAM_TO_PULSE.items() if pulse_name == team["name"]), None)
        fpl_team = next((row for row in fpl["teams"] if row["name"] == match), None) if match else None
        if not fpl_team:
            raise SystemExit(f"no Fantasy Premier League club match for {team['name']}")
        team["fpl_id"] = fpl_team["id"]
        team["fpl_name"] = fpl_team["name"]

    fpl_by_opta = {row["opta_code"]: row for row in fpl["elements"] if row.get("opta_code")}
    fpl_by_team_name: dict[tuple[int, str], list[dict]] = {}
    for row in fpl["elements"]:
        names = {
            norm_name(row["web_name"]),
            norm_name(f"{row['first_name']} {row['second_name']}"),
            norm_name(row.get("known_name") or ""),
        }
        for name in names:
            if name:
                fpl_by_team_name.setdefault((row["team"], name), []).append(row)

    raw_by_player = {}
    for player in players:
        detail = details[player["id"]]
        alt = (detail.get("altIds") or {}).get("opta")
        player["opta_id"] = alt
        player["opta_player_number"] = int(alt[1:]) if isinstance(alt, str) and alt.startswith("p") and alt[1:].isdigit() else None
        current_team = detail.get("currentTeam") or {}
        current = current_team.get("id")
        player["detail_team_id"] = int(current) if current else None
        player["current_club_name"] = current_team.get("name")
        player["team_conflict"] = int(player["detail_team_id"] not in (None, player["team_id"]))
        # Prefer measured height and weight from the player record when the squad row lacked them.
        if player["height_cm"] is None:
            player["height_cm"] = as_int(detail.get("height"))
        if player["weight_kg"] is None:
            player["weight_kg"] = as_int(detail.get("weight"))
        if not player["nationality"]:
            national = detail.get("nationalTeam") or {}
            player["nationality"] = national.get("country")
            player["country_iso"] = national.get("isoCode")
        stat_map = {}
        for item in stats_payloads[player["id"]].get("stats", []):
            stat_map[item["name"]] = float(item["value"])
        raw_by_player[player["id"]] = stat_map

        fpl_row = fpl_by_opta.get(player["opta_id"]) if player["opta_id"] else None
        match_method = "opta" if fpl_row else None
        if fpl_row is None:
            team = next(item for item in teams if item["id"] == player["team_id"])
            candidate_names = {
                norm_name(player["name"]),
                norm_name(f"{player['first_name'] or ''} {player['last_name'] or ''}"),
            }
            found = []
            for name in candidate_names:
                found.extend(fpl_by_team_name.get((team["fpl_id"], name), []))
            distinct = {row["id"]: row for row in found}
            if len(distinct) == 1:
                fpl_row = next(iter(distinct.values()))
                match_method = "name"
        player["fpl_row"] = fpl_row
        player["fpl_match"] = match_method or "none"
        player["fpl_id"] = fpl_row["id"] if fpl_row else None

    filled, catalog = zero_fill(raw_by_player)
    matched_fpl_ids = set()
    rate_bucket = []
    prepared = []
    fpl_rows = []
    for player in players:
        stats = filled[player["id"]]
        fpl_row = player["fpl_row"]
        if fpl_row:
            matched_fpl_ids.add(fpl_row["id"])
            fpl_public = {
                "minutes": fpl_row["minutes"],
                "expectedGoals": as_float(fpl_row["expected_goals"]),
                "expectedAssists": as_float(fpl_row["expected_assists"]),
                "expectedGoalsPer90Published": fpl_row.get("expected_goals_per_90"),
                "expectedAssistsPer90Published": fpl_row.get("expected_assists_per_90"),
                "goals": fpl_row["goals_scored"],
                "assists": fpl_row["assists"],
            }
            fpl_rows.append(
                (
                    player["id"],
                    fpl_row["id"],
                    fpl_row["minutes"],
                    fpl_row["goals_scored"],
                    fpl_row["assists"],
                    as_float(fpl_row["expected_goals"]),
                    as_float(fpl_row["expected_assists"]),
                    as_float(fpl_row["expected_goal_involvements"]),
                    as_float(fpl_row["expected_goals_conceded"]),
                    fpl_row.get("expected_goals_per_90"),
                    fpl_row.get("expected_assists_per_90"),
                    as_float(fpl_row["influence"]),
                    as_float(fpl_row["creativity"]),
                    as_float(fpl_row["threat"]),
                    as_float(fpl_row["ict_index"]),
                    fpl_row.get("tackles"),
                    fpl_row.get("clearances_blocks_interceptions"),
                    fpl_row.get("recoveries"),
                    fpl_row.get("defensive_contribution"),
                    fpl_row.get("saves"),
                    fpl_row.get("goals_conceded"),
                    fpl_row.get("clean_sheets"),
                    fpl_row.get("starts"),
                )
            )
        else:
            fpl_public = None
        rates = build_rates(player, stats, fpl_row)
        rate_bucket.extend(rates)
        minutes = int(stats.get("mins_played", (0, 1))[0]) if "mins_played" in stats else 0
        appearances = int(stats.get("appearances", (0, 1))[0]) if "appearances" in stats else 0
        starts = int(stats.get("game_started", (0, 1))[0]) if "game_started" in stats else 0
        goals = int(stats.get("goals", (0, 1))[0]) if "goals" in stats else 0
        assists = int(stats.get("goal_assist", (0, 1))[0]) if "goal_assist" in stats else 0
        # Players who have not played do not get zero-filled stats, so the
        # headline counts stay zero rather than null.
        if minutes == 0 and appearances == 0:
            goals = 0
            assists = 0
            starts = 0
        player.update(
            {
                "stats": stats,
                "rates": rates,
                "minutes": minutes,
                "appearances": appearances,
                "starts": starts,
                "goals": goals,
                "assists": assists,
                "fpl_minutes": fpl_row["minutes"] if fpl_row else None,
                "fpl_public": fpl_public,
            }
        )
        prepared.append(player)

    assign_percentiles(rate_bucket)

    events = []
    for event in fpl["events"]:
        if event["id"] <= 12:
            events.append(
                {
                    "id": event["id"],
                    "name": event["name"],
                    "finished": event["finished"],
                    "current": event["is_current"],
                    "dataChecked": event["data_checked"],
                    "deadline": event["deadline_time"],
                }
            )
    current = next(event for event in fpl["events"] if event["is_current"])
    finished = [event["id"] for event in fpl["events"] if event["finished"]]
    unmatched_fpl = []
    for row in fpl["elements"]:
        if row["id"] in matched_fpl_ids:
            continue
        team = fpl_teams[row["team"]]
        unmatched_fpl.append(
                {
                    "fplId": row["id"],
                    "name": f"{row['first_name']} {row['second_name']}",
                    "webName": row["web_name"],
                    "team": team["name"],
                    "opta": row.get("opta_code"),
                    "minutes": row["minutes"],
                    "status": row.get("status"),
                    "news": row.get("news") or "",
                    "expectedGoals": as_float(row.get("expected_goals")),
                    "expectedAssists": as_float(row.get("expected_assists")),
                    "goals": row.get("goals_scored"),
                    "assists": row.get("assists"),
                }
            )

    catalog_rows = []
    for name in catalog:
        group_key = STAT_GROUP_OF.get(name, "other")
        catalog_rows.append((name, STAT_LABELS.get(name, name.replace("_", " ")), group_key, STAT_GROUPS[group_key]))

    featured_definitions = []
    seen_keys = set()
    for rate in rate_bucket:
        if not rate["featured"] or rate["rate_key"] in seen_keys:
            continue
        seen_keys.add(rate["rate_key"])
        featured_definitions.append(
            {
                "key": rate["rate_key"],
                "label": rate["label"],
                "unit": rate["unit"],
                "formula": rate["formula"],
                "source": rate["source"],
                "peerGroup": rate["peer_group"],
                "group": rate["group_name"],
            }
        )
    featured_order = [
        "shooting",
        "passing",
        "pass_completion",
        "vision",
        "chance_creation",
        "dribbling",
        "carrying",
        "aerials",
        "tackling",
        "pressing",
        "saves",
        "save_percentage",
        "claims",
        "sweeper",
    ]
    featured_definitions.sort(key=lambda item: featured_order.index(item["key"]) if item["key"] in featured_order else 99)

    meta = {
        "season": SEASON_LABEL,
        "competition": COMPETITION,
        "compSeasonId": SEASON_ID,
        "fetchedAt": fetched_at,
        "playerCount": len(prepared),
        "teamCount": len(teams),
        "playersWithMinutes": sum(1 for player in prepared if player["minutes"] > 0),
        "fplMatched": sum(1 for player in prepared if player["fpl_match"] != "none"),
        "fplMatchedByOpta": sum(1 for player in prepared if player["fpl_match"] == "opta"),
        "fplMatchedByName": sum(1 for player in prepared if player["fpl_match"] == "name"),
        "fplUnmatchedCount": len(unmatched_fpl),
        "teamConflicts": sum(1 for player in prepared if player["team_conflict"]),
        "duplicateSquadRows": duplicate_ids,
        "minimumMinutes": MIN_MINUTES,
        "currentGameweek": {
            "id": current["id"],
            "name": current["name"],
            "finished": current["finished"],
            "dataChecked": current["data_checked"],
            "deadline": current["deadline_time"],
        },
        "finishedGameweeks": finished,
        "gameweeks": events,
        "zeroFillRule": "The Premier League stat feed omits many zeroes. If a player has minutes or appearances, a catalog stat missing from their payload is stored as 0 with reported=false. Players with neither minutes nor appearances are not zero-filled.",
        "ratingRule": "Per-90 rates are published from 90 minutes. Percentiles are mid-ranks from 270 minutes, among players in that stat's peer group. Ratios are published only once the attempt minimum is met. These percentiles are calculated from the published numbers. They are not official Premier League ratings.",
        "notPublished": [
            "Pace is not in either feed.",
            "A single strength or physicality attribute is not in either feed. Aerial duels and body measurements are stored instead.",
            "Post-shot expected goals and goals prevented are not in either feed, so they are not calculated.",
        ],
        "sources": [
            {
                "name": "Premier League player stats",
                "url": f"{PULSE}/football/stats/player/{{id}}?comps=1&compSeasons={SEASON_ID}",
                "usedFor": "Season counting stats for every player on a 2026/27 club list",
            },
            {
                "name": "Premier League squads",
                "url": f"{PULSE}/football/teams/{{teamId}}/compseasons/{SEASON_ID}/staff",
                "usedFor": "Who is on each club list",
            },
            {
                "name": "Fantasy Premier League bootstrap-static",
                "url": FPL_URL,
                "usedFor": "Expected goals, expected assists, and Opta ids",
            },
        ],
        "fplUnmatched": unmatched_fpl,
    }

    db_players = []
    for player in prepared:
        db_players.append(
            {
                **player,
                "row": (
                    player["id"],
                    player["opta_id"],
                    player["opta_player_number"],
                    player["fpl_id"],
                    player["fpl_match"],
                    player["name"],
                    player["first_name"],
                    player["last_name"],
                    player["position"],
                    player["position_info"],
                    player["shirt_number"],
                    player["team_id"],
                    player["detail_team_id"],
                    player["current_club_name"],
                    player["team_conflict"],
                    player["nationality"],
                    player["country_iso"],
                    player["birth_label"],
                    player["birth_iso"],
                    player["height_cm"],
                    player["weight_kg"],
                    player["loan"],
                    player["minutes"],
                    player["appearances"],
                    player["starts"],
                    player["goals"],
                    player["assists"],
                    player["fpl_minutes"],
                ),
            }
        )

    payload = {
        "meta": meta,
        "teams": teams,
        "players": db_players,
        "catalog": catalog_rows,
        "fpl_rows": fpl_rows,
        "featured_definitions": featured_definitions,
    }
    write_database(payload)
    export_app_json(payload)

    print("summary")
    print(" players", len(prepared))
    print(" with minutes", meta["playersWithMinutes"])
    print(" fpl matched", meta["fplMatched"], "opta", meta["fplMatchedByOpta"], "name", meta["fplMatchedByName"])
    print(" fpl unmatched", len(unmatched_fpl))
    print(" team conflicts", meta["teamConflicts"])
    print(" catalog stats", len(catalog))
    featured_keys = [item["key"] for item in featured_definitions]
    connection = sqlite3.connect(DB_PATH)
    for key in featured_keys:
        eligible, rated, maximum = connection.execute(
            "SELECT SUM(eligible), SUM(CASE WHEN percentile IS NOT NULL THEN 1 ELSE 0 END), MAX(value) FROM rates WHERE rate_key = ?",
            (key,),
        ).fetchone()
        print(f"  {key}: eligible {eligible} rated {rated} max {maximum}")
    connection.close()


if __name__ == "__main__":
    main()
