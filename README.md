# Frankenballer

A Premier League build game. You stitch one footballer together from ten real players, then play a season with him. It sits on top of a database of the players on 2026/27 Premier League club lists, and the stat book at `/book` lets you browse that data.

The look is a night matchday board: pitch greens, floodlight amber, condensed scoreboard type, and a pixel stadium. It keeps a dark game energy without copying krillion's cyan/pink CRT look. The intro opens on your profile and achievements first. Every sound is synthesized live with the Web Audio API, so there are no audio files. Sound starts when you press Kick Off. M mutes it, and the setting is remembered. Keys: Enter starts, T rerolls the team, Y rerolls the player, 1–9 and 0 pick a stat.

The season is still going. Gameweeks 1–9 were finished when the feeds were fetched. Gameweek 10 was the current gameweek and was not marked data-checked, so a few totals can still move. Rates are per 90 minutes, and a percentile is only stored once a player has 270 minutes.

The home page is the build game. Each round rolls a club, then a player from that club, and you take one of his ten stats (pace, shooting, passing, dribbling, defending, physical, finishing, vision, reactions, heading).

Each stat is the player's EA SPORTS FC rating lightly blended with his form this season. Form uses the league percentiles in the database (mapping in `BUILD_STATS` in `src/lib/ratings.ts`). Form reaches 28% weight at 900 minutes, cannot drag a rating more than a few points, and never pulls a 90+ EA rating below 90. Position primaries (for example defending for a centre-back) have a soft floor so quiet tackle counts cannot dump a rated defender into the 50s. Pace stays EA only.

About 12% of rolls arrive in their **prime**: each stat takes the better of EA and form, then primary position stats get a small lift toward that player's own highest EA attribute. Primes are marked on the card and feed a quest. Reroll team (5 per build) gives a new club and a new player. Reroll player (5 per build) keeps the club. Only outfielders with at least 3 appearances and 270 Premier League minutes this season are in the roll. 7 or more appearances counts as first team, the rest as bench.

Chemistry boosts locked stats when the build shares real links: current clubmates, same nationality, club-and-country pairs, back/mid/front lines, first-team plus bench, two primes, or a full D-M-F spine. Attribute tiles show progress bars like `teammates 1/3` or `back line 2/3` once a set has started — a hint that picking this player keeps filling that link. The right panel lists completed sets. Boosts stack up to +4 on a single attribute and feed the season rating.

Three quests are open at a time, and each pays out extra team or player rerolls (for example, take a stat from a bench player, or make 3 picks in a row without rerolling). When one is done, the next quest in the queue takes its place. A quest finished on the tenth pick banks its reward for the next run. Finishing top seven also banks bonus rerolls: champions +2 team and +2 player, top four +1 of each, and top seven +1 player. This bonus is paid once per build.

After ten picks you roll the club you join, and all 38 matchweeks are simulated. At full time you choose New run (a fresh build with any banked rerolls), Run it back (same build and club), or New club (same build, a new club roll). The keys are N, R and C. Each club is rated from the blended ratings of its 10 most-used outfielders, and you replace the lowest-rated of them. A match turns attack against defence into expected goals at this season’s scoring rate, and the score is drawn at random. It is a simulation, not a forecast.

The EA ratings come from `drop-api.ea.com/rating/ea-sports-fc`, the feed behind ea.com’s ratings page. Players are matched to the Premier League squads by birth date and name. Rebuild with `python3 scripts/fetch_ea_ratings.py` (`--refresh` downloads again). About 20 players with minutes have no EA entry and are left out of the roll.

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
