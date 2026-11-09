# Premier League Player Book

A database of the players on 2026/27 Premier League club lists, and a browser for those numbers.

The season is still going. Gameweeks 1–9 were finished when the feeds were fetched. Gameweek 10 was the current gameweek and was not marked data-checked, so a few totals can still move. Rates are per 90 minutes, and a percentile is only stored once a player has 270 minutes.

This is the player book the build-a-player game will draw from. The matchweek simulator is not in this version.

## Where the numbers come from

- Premier League club lists and season counting stats, competition season 841, from `footballapi.pulselive.com`.
- Expected goals and expected assists from the Fantasy Premier League `bootstrap-static` feed, joined on the Opta id.

No pace, strength, or goals-prevented figure is stored. Those are not in either feed. Height and weight are stored when the player record publishes them. Aerial duels are the physical contest that is actually counted.

The Premier League feed omits a lot of zeroes. After a player has minutes, a missing count is stored as 0 and marked as filled. Players with no minutes are not filled in.

## The ten outfield stats

| Stat | Calculation |
| --- | --- |
| Shooting | Expected goals / (Fantasy Premier League minutes / 90) |
| Passing | Completed final-third passes per 90 |
| Pass completion | Completed passes / attempted passes, from 270 minutes and 50 passes |
| Vision | Expected assists / (Fantasy Premier League minutes / 90) |
| Chance creation | Shot-creating passes (`total_att_assist`) per 90 |
| Dribbling | Completed dribbles (`won_contest`) per 90 |
| Carrying | Progressive carries per 90 |
| Aerial duels | Aerials won per 90 |
| Tackling | Tackles won per 90 |
| Pressing | Possession won in the attacking third per 90 |

Goalkeepers also have saves per 90, save percentage (saves / (saves + goals conceded)), successful high claims per 90, and completed sweeper actions per 90.

A percentile is a mid-rank from 0 to 100 among players who clear that stat’s sample. It is calculated here. It is not an official Premier League rating.

## Run the browser

```bash
npm install
npm run dev
```

Open [http://127.0.0.1:4317](http://127.0.0.1:4317).

## Rebuild the database

The cached responses live in `data/raw/` and are not committed. A normal rebuild uses that cache. `--refresh` downloads again.

```bash
python3 scripts/build_player_db.py
python3 scripts/validate_player_db.py
```

`data/premier-league.sqlite` is the database. `data/index.json` and `data/players/` are what the site reads.
