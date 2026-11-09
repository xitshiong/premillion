#!/usr/bin/env python3
"""Checks the built database against the feeds it was calculated from."""

from __future__ import annotations

import sqlite3
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DB = ROOT / "data" / "premier-league.sqlite"


def main() -> None:
    failures: list[str] = []

    def check(condition: bool, message: str) -> None:
        if not condition:
            failures.append(message)

    connection = sqlite3.connect(DB)
    connection.row_factory = sqlite3.Row

    teams = connection.execute("SELECT COUNT(*) AS n FROM teams").fetchone()["n"]
    check(teams == 20, f"expected 20 clubs, found {teams}")

    players = connection.execute("SELECT COUNT(*) AS n FROM players").fetchone()["n"]
    check(players >= 500, f"expected at least 500 players, found {players}")

    haaland = connection.execute("SELECT * FROM players WHERE id = 65970").fetchone()
    check(haaland is not None and haaland["goals"] == 9, "Haaland should have 9 Premier League goals")
    check(haaland is not None and haaland["assists"] == 0, "Haaland should have 0 assists in this feed")
    check(haaland is not None and haaland["minutes"] == 890, f"Haaland minutes changed: {None if haaland is None else haaland['minutes']}")
    xg = connection.execute("SELECT expected_goals, minutes FROM fpl_stats WHERE player_id = 65970").fetchone()
    check(xg is not None and abs(xg["expected_goals"] - 7.06) < 0.001, "Haaland expected goals should be 7.06")
    shooting = connection.execute(
        "SELECT value, percentile, eligible, minutes_used FROM rates WHERE player_id = 65970 AND rate_key = 'shooting'"
    ).fetchone()
    expected = 7.06 / (889 / 90)
    check(shooting is not None and abs(shooting["value"] - expected) < 1e-4, "Haaland shooting rate was not xG divided by FPL minutes")
    check(shooting is not None and shooting["eligible"] == 1 and shooting["percentile"] > 98, "Haaland shooting should rank near the top")

    dias_passes = {
        row["stat_name"]: row["value"]
        for row in connection.execute(
            "SELECT stat_name, value FROM player_stats WHERE player_id = 16431 AND stat_name IN ('accurate_pass', 'total_pass', 'goals', 'mins_played')"
        )
    }
    check(dias_passes.get("accurate_pass") == 862, "Dias completed passes should be 862")
    check(dias_passes.get("total_pass") == 943, "Dias attempted passes should be 943")
    check(dias_passes.get("goals") == 0, "Dias goals were omitted by the feed and should be stored as 0")
    check(dias_passes.get("mins_played") == 900, "Dias should have 900 minutes")
    dias_goals_reported = connection.execute(
        "SELECT reported FROM player_stats WHERE player_id = 16431 AND stat_name = 'goals'"
    ).fetchone()["reported"]
    check(dias_goals_reported == 0, "Dias goals should be marked as omitted by the feed")

    saves = connection.execute(
        "SELECT value FROM player_stats WHERE player_id = 55642 AND stat_name = 'saves'"
    ).fetchone()
    check(saves is not None and saves["value"] == 41, "Tzolakis should have 41 saves")

    bad_per90 = connection.execute(
        """
        SELECT COUNT(*) AS n
        FROM rates
        WHERE unit IN ('per 90', 'xG per 90', 'xA per 90')
          AND value IS NOT NULL
          AND COALESCE(minutes_used, 0) < 90
        """
    ).fetchone()["n"]
    check(bad_per90 == 0, f"{bad_per90} per-90 rates were published under 90 minutes")

    bad_percentile = connection.execute(
        """
        SELECT COUNT(*) AS n FROM rates
        WHERE (eligible = 1 AND percentile IS NULL)
           OR (eligible = 0 AND percentile IS NOT NULL)
           OR (percentile IS NOT NULL AND (percentile < 0 OR percentile > 100))
        """
    ).fetchone()["n"]
    check(bad_percentile == 0, f"{bad_percentile} percentile rows break the sample rule")

    over_complete = connection.execute(
        "SELECT COUNT(*) AS n FROM rates WHERE rate_key = 'pass_completion' AND value > 1"
    ).fetchone()["n"]
    check(over_complete == 0, "pass completion went above 100%")

    leaders = [
        row["name"]
        for row in connection.execute(
            """
            SELECT p.name FROM rates r
            JOIN players p ON p.id = r.player_id
            WHERE r.rate_key = 'shooting' AND r.eligible = 1
            ORDER BY r.value DESC LIMIT 3
            """
        )
    ]
    check("Erling Haaland" in leaders, f"Haaland missing from the shooting top 3: {leaders}")

    aerial = connection.execute(
        """
        SELECT p.name FROM rates r
        JOIN players p ON p.id = r.player_id
        WHERE r.rate_key = 'aerials' AND r.eligible = 1
        ORDER BY r.percentile DESC LIMIT 1
        """
    ).fetchone()["name"]
    check(aerial == "Dan Burn", f"aerial leader changed: {aerial}")

    dribble = connection.execute(
        """
        SELECT p.name FROM rates r
        JOIN players p ON p.id = r.player_id
        WHERE r.rate_key = 'dribbling' AND r.eligible = 1
        ORDER BY r.percentile DESC LIMIT 1
        """
    ).fetchone()["name"]
    check(dribble == "Jérémy Doku", f"dribbling leader changed: {dribble}")

    connection.close()
    if failures:
        print("FAILED")
        for failure in failures:
            print(f"- {failure}")
        sys.exit(1)
    print(f"ok: {players} players, {teams} clubs, anchor checks passed")


if __name__ == "__main__":
    main()
