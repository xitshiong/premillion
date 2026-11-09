"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { BUILD_STATS, strengthFrom, type ClubRating, type GameData, type RollPlayer, type RollStat } from "@/lib/ratings";
import { mulberry32, simulateSeason, type MatchResult, type TableRow } from "@/lib/simulate";
import { formatRate, positionShort } from "@/lib/format";

const PLAYER_REROLLS = 8;
const TEAM_REROLLS = 6;

type LockedStat = RollStat & { playerId: number; playerName: string; teamName: string };

function tone(percentile: number) {
  if (percentile >= 80) return "text-[#f6c453]";
  if (percentile >= 45) return "text-[#8fd4ff]";
  return "text-[#ff8b9a]";
}

function drawPlayer(players: RollPlayer[], avoidId?: number, random: () => number = Math.random) {
  const pool = players.filter((player) => player.id !== avoidId);
  const source = pool.length > 0 ? pool : players;
  return source[Math.floor(random() * source.length)];
}

function drawClub(clubs: ClubRating[], avoidId?: number, random: () => number = Math.random) {
  const pool = clubs.filter((club) => club.id !== avoidId);
  const source = pool.length > 0 ? pool : clubs;
  return source[Math.floor(random() * source.length)];
}

export function BuildGame({ data, seed }: { data: GameData; seed: number }) {
  const [club, setClub] = useState(() => drawClub(data.clubs, undefined, mulberry32(seed)));
  const [rolled, setRolled] = useState(() => drawPlayer(data.players, undefined, mulberry32(seed + 1)));
  const [locked, setLocked] = useState<Record<string, LockedStat>>({});
  const [playerRerolls, setPlayerRerolls] = useState(PLAYER_REROLLS);
  const [teamRerolls, setTeamRerolls] = useState(TEAM_REROLLS);
  const [season, setSeason] = useState<{ table: TableRow[]; matches: MatchResult[] } | null>(null);

  const taken = Object.keys(locked).length;
  const round = Math.min(taken + 1, 10);
  const complete = taken === 10;

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (complete || !rolled) return;
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) return;
      const index = event.key === "0" ? 9 : Number(event.key) - 1;
      if (!Number.isInteger(index) || index < 0 || index > 9) return;
      const stat = rolled.stats[index];
      if (!stat || locked[stat.key]) return;
      choose(stat);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  function choose(stat: RollStat) {
    if (!rolled || locked[stat.key] || complete) return;
    const next = {
      ...locked,
      [stat.key]: { ...stat, playerId: rolled.id, playerName: rolled.name, teamName: rolled.teamName },
    };
    setLocked(next);
    setSeason(null);
    if (Object.keys(next).length < 10) setRolled(drawPlayer(data.players, rolled.id));
  }

  function rerollPlayer() {
    if (!rolled || playerRerolls <= 0 || complete) return;
    setPlayerRerolls((count) => count - 1);
    setRolled(drawPlayer(data.players, rolled.id));
  }

  function rerollTeam() {
    if (!club || teamRerolls <= 0) return;
    setTeamRerolls((count) => count - 1);
    setClub(drawClub(data.clubs, club.id));
    setSeason(null);
  }

  function restart() {
    setLocked({});
    setPlayerRerolls(PLAYER_REROLLS);
    setTeamRerolls(TEAM_REROLLS);
    setSeason(null);
    setClub(drawClub(data.clubs));
    setRolled(drawPlayer(data.players));
  }

  const profile = useMemo(() => {
    if (!complete) return null;
    return strengthFrom(Object.values(locked));
  }, [complete, locked]);

  function playSeason() {
    if (!club || !profile) return;
    const result = simulateSeason({
      clubs: data.clubs,
      userClubId: club.id,
      userAttack: profile.attack,
      userDefense: profile.defense,
      goalsPerTeamGame: data.goalsPerTeamGame,
      seed: Math.floor(Math.random() * 1_000_000_000),
    });
    setSeason(result);
  }

  const place = season && club ? season.table.findIndex((row) => row.id === club.id) + 1 : null;
  const yourMatches =
    season && club ? season.matches.filter((match) => match.home === club.id || match.away === club.id) : [];

  return (
    <div className="min-h-screen bg-[#07111c] text-[#e7eef8]">
      <header className="border-b border-[#16304d] bg-[#091624]">
        <div className="mx-auto flex max-w-[1200px] items-center justify-between gap-3 px-3 py-3 sm:px-4">
          <div className="min-w-0">
            <p className="text-[11px] tracking-[0.18em] text-[#8fd4ff] uppercase">{data.season} Premier League</p>
            <p className="truncate font-serif text-lg">Build your player</p>
            <p className="text-xs tracking-[0.16em] text-[#9fb0c7] sm:hidden">Round {round} / 10</p>
          </div>
          <div className="hidden text-center sm:block">
            <p className="text-xs tracking-[0.2em] text-[#9fb0c7]">ROUND {round} / 10</p>
            <div className="mt-1 h-1.5 w-40 overflow-hidden rounded-full bg-[#16304d]">
              <div className="h-full bg-[#f6c453]" style={{ width: `${taken * 10}%` }} />
            </div>
          </div>
          <div className="flex items-center gap-2 text-sm">
            <Link href="/book" className="hidden rounded-md px-2 py-1 text-[#9fb0c7] hover:text-white sm:inline">
              Stat book
            </Link>
            <button type="button" onClick={restart} className="rounded-md bg-[#f6c453] px-3 py-1.5 font-semibold text-[#1a1404]">
              Restart
            </button>
          </div>
        </div>
      </header>

      <div className="mx-auto grid max-w-[1200px] gap-3 px-3 py-3 lg:grid-cols-[250px_minmax(0,1fr)_280px] lg:px-4">
        <section className="rounded-xl border border-[#1c3d62] bg-[#0c1b2e] p-4">
          <p className="text-xs tracking-[0.16em] text-[#9fb0c7]">YOU ROLLED</p>
          {rolled ? (
            <>
              <div className="mt-3 flex items-start justify-between gap-2">
                <span className={`rounded px-2 py-0.5 text-[11px] font-semibold tracking-wide uppercase ${rolled.role === "First team" ? "bg-[#f6c453] text-[#1a1404]" : "bg-[#2563eb] text-white"}`}>
                  {rolled.role}
                </span>
                <span className="text-right">
                  <span className="block font-serif text-3xl leading-none text-[#f6c453] tabular-nums">{Math.round(rolled.average)}</span>
                  <span className="text-[10px] tracking-wide text-[#9fb0c7] uppercase">avg percentile</span>
                </span>
              </div>
              <h1 className="mt-4 font-serif text-4xl leading-none">{rolled.name}</h1>
              <p className="mt-2 text-sm text-[#9fb0c7]">
                {rolled.positionInfo || positionShort(rolled.position)} · {rolled.teamName}
              </p>
              <p className="mt-3 text-sm text-[#c5d2e4]">
                {rolled.appearances} appearances · {rolled.minutes} min · {rolled.goals} {rolled.goals === 1 ? "goal" : "goals"} · {rolled.assists}{" "}
                {rolled.assists === 1 ? "assist" : "assists"}
              </p>
              <Link href={`/players/${rolled.id}`} className="mt-3 inline-block text-sm text-[#8fd4ff] underline-offset-2 hover:underline">
                Open the full stat sheet
              </Link>
            </>
          ) : (
            <p className="mt-6 text-sm text-[#9fb0c7]">Drawing a name from the first team and the bench.</p>
          )}
          <p className="mt-4 text-xs leading-relaxed text-[#7f93ab]">
            {data.firstTeam} first-team and {data.bench} bench outfielders. Each has at least 270 minutes, so all ten numbers are percentiles. Players with no minutes are not in the roll.
          </p>
        </section>

        <section className="rounded-xl border border-[#1c3d62] bg-[#10243d] p-4">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <p className="text-xs tracking-[0.16em] text-[#9fb0c7]">{complete ? "BUILD COMPLETE" : `PICK ${round} OF 10`}</p>
              <h2 className="font-serif text-3xl leading-tight">{rolled ? `You rolled ${rolled.name}` : "Rolling"}</h2>
              <p className="text-sm text-[#9fb0c7]">{complete ? "Every attribute is locked." : "Pick one attribute from this player."}</p>
            </div>
            <div className="text-right text-sm">
              <p className="text-[#9fb0c7]">Your club</p>
              <p className="font-semibold">{club?.name ?? "…"}</p>
            </div>
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={rerollTeam}
              disabled={!club || teamRerolls <= 0}
              className="rounded-md bg-[#2563eb] px-3 py-2 text-sm font-semibold text-white disabled:opacity-40"
            >
              Reroll team ({teamRerolls})
            </button>
            <button
              type="button"
              onClick={rerollPlayer}
              disabled={!rolled || playerRerolls <= 0 || complete}
              className="rounded-md bg-[#e11d6a] px-3 py-2 text-sm font-semibold text-white disabled:opacity-40"
            >
              Reroll player ({playerRerolls})
            </button>
          </div>

          <div className="mt-4 grid gap-2 sm:grid-cols-2">
            {rolled?.stats.map((stat, index) => {
              const owned = locked[stat.key];
              const disabled = Boolean(owned) || complete;
              return (
                <button
                  key={stat.key}
                  type="button"
                  disabled={disabled}
                  onClick={() => choose(stat)}
                  className={`rounded-lg border px-3 py-2 text-left ${disabled ? "border-[#1c3d62] bg-[#0c1b2e]/70 opacity-70" : "border-[#2a527f] bg-[#0d2138] hover:border-[#f6c453]"}`}
                >
                  <span className="flex items-center justify-between gap-2 text-[11px] tracking-wide text-[#9fb0c7] uppercase">
                    <span>
                      {index + 1}. {stat.label}
                    </span>
                    <span>{owned ? (owned.playerId === rolled.id ? "Taken" : "Already picked") : "Open"}</span>
                  </span>
                  <span className="mt-1 flex items-end justify-between gap-2">
                    <span className={`font-serif text-4xl leading-none tabular-nums ${tone(stat.percentile)}`}>{Math.round(stat.percentile)}</span>
                    <span className="pb-1 text-right text-xs text-[#9fb0c7]">{rateCaption(stat.value, stat.unit)}</span>
                  </span>
                </button>
              );
            })}
          </div>
          {!complete ? <p className="mt-3 text-xs text-[#7f93ab]">Keys 1–9 and 0 pick an attribute. The number is the percentile. The small figure is the real rate.</p> : null}
          {complete && profile ? (
            <div className="mt-4 rounded-lg border border-[#f6c453]/40 bg-[#0c1b2e] p-4">
              <p className="text-sm text-[#c5d2e4]">
                Your attack score is {profile.attack.toFixed(1)} and your defensive score is {profile.defense.toFixed(1)}, from the ten percentiles you kept. {club?.name} already has {club?.squad} rated outfielders. You are added to that squad, then all 38 matchweeks are simulated.
              </p>
              <button type="button" onClick={playSeason} className="mt-3 rounded-md bg-[#f6c453] px-4 py-2 font-semibold text-[#1a1404]">
                {season ? "Simulate again" : "Play the 38 matchweeks"}
              </button>
            </div>
          ) : null}
        </section>

        <section className="rounded-xl border border-[#1c3d62] bg-[#0c1b2e] p-4">
          <div className="flex items-baseline justify-between">
            <h2 className="font-serif text-2xl">Your build</h2>
            <p className="text-sm text-[#f6c453] tabular-nums">{taken}/10</p>
          </div>
          <div className="mt-3 grid gap-2">
            {BUILD_STATS.map((definition) => {
              const pick = locked[definition.key];
              return (
                <div key={definition.key} className="flex items-center justify-between gap-2 rounded-lg border border-[#1c3d62] bg-[#10243d] px-3 py-2">
                  <div className="min-w-0">
                    <p className="text-xs tracking-wide text-[#9fb0c7] uppercase">{definition.label}</p>
                    <p className="truncate text-sm">{pick ? pick.playerName : "Open"}</p>
                  </div>
                  <p className={`font-serif text-2xl tabular-nums ${pick ? tone(pick.percentile) : "text-[#3d5674]"}`}>{pick ? Math.round(pick.percentile) : "—"}</p>
                </div>
              );
            })}
          </div>
        </section>
      </div>

      {season && club && place ? (
        <section className="mx-auto max-w-[1200px] px-3 pb-10 lg:px-4">
          <div className="rounded-xl border border-[#f6c453]/50 bg-[#10243d] p-4 sm:p-6">
            <p className="text-xs tracking-[0.18em] text-[#f6c453] uppercase">{club.name}</p>
            <h2 className="mt-1 font-serif text-4xl sm:text-5xl">{place === 1 ? "You finished first." : `You finished ${ordinal(place)}.`}</h2>
            <p className="mt-2 max-w-3xl text-sm text-[#9fb0c7]">
              Each club’s attack and defence come from the same percentiles as the roll. A match turns those into expected goals around {data.goalsPerTeamGame.toFixed(2)} per team, which is the goals already in the book spread over {data.recordedMatches} recorded matchweeks. Home sides get 10% more. Scores are then drawn at random. This is a simulation, not a forecast.
            </p>
            <div className="mt-5 overflow-x-auto">
              <table className="w-full min-w-[40rem] text-sm">
                <thead className="text-left text-[#9fb0c7]">
                  <tr>
                    {["#", "Club", "P", "W", "D", "L", "GF", "GA", "GD", "Pts"].map((heading) => (
                      <th key={heading} className="px-2 py-1 font-medium">
                        {heading}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {season.table.map((row, index) => {
                    const yours = row.id === club.id;
                    const diff = row.goalsFor - row.goalsAgainst;
                    return (
                      <tr key={row.id} className={yours ? "bg-[#f6c453] text-[#1a1404]" : "border-t border-[#1c3d62]"}>
                        <td className="px-2 py-1.5 tabular-nums">{index + 1}</td>
                        <td className="px-2 py-1.5 font-medium">{row.name}</td>
                        <td className="px-2 py-1.5 tabular-nums">{row.played}</td>
                        <td className="px-2 py-1.5 tabular-nums">{row.won}</td>
                        <td className="px-2 py-1.5 tabular-nums">{row.drawn}</td>
                        <td className="px-2 py-1.5 tabular-nums">{row.lost}</td>
                        <td className="px-2 py-1.5 tabular-nums">{row.goalsFor}</td>
                        <td className="px-2 py-1.5 tabular-nums">{row.goalsAgainst}</td>
                        <td className="px-2 py-1.5 tabular-nums">{diff > 0 ? `+${diff}` : diff}</td>
                        <td className="px-2 py-1.5 font-semibold tabular-nums">{row.points}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <h3 className="mt-6 font-serif text-2xl">Your 38 matchweeks</h3>
            <div className="mt-3 grid max-h-80 gap-1 overflow-y-auto pr-1 sm:grid-cols-2">
              {yourMatches.map((match) => {
                const names = new Map(data.clubs.map((item) => [item.id, item.abbr || item.name]));
                const home = match.home === club.id;
                const yours = home ? match.homeGoals : match.awayGoals;
                const theirs = home ? match.awayGoals : match.homeGoals;
                const outcome = yours > theirs ? "W" : yours < theirs ? "L" : "D";
                return (
                  <p key={`${match.week}-${match.home}`} className="flex items-center justify-between rounded-md bg-[#0c1b2e] px-3 py-1.5 text-sm">
                    <span className="text-[#9fb0c7]">W{match.week}</span>
                    <span>
                      {home ? "H" : "A"} {names.get(home ? match.away : match.home)} {match.homeGoals}–{match.awayGoals}
                    </span>
                    <span className={outcome === "W" ? "text-[#86efac]" : outcome === "L" ? "text-[#fda4af]" : "text-[#f6c453]"}>{outcome}</span>
                  </p>
                );
              })}
            </div>
          </div>
        </section>
      ) : null}
    </div>
  );
}

function rateCaption(value: number, unit: string) {
  if (unit === "ratio") return formatRate(value, unit);
  return `${formatRate(value, unit)} ${unit.replace(" per 90", "/90")}`;
}

function ordinal(place: number) {
  const mod100 = place % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${place}th`;
  const mod10 = place % 10;
  if (mod10 === 1) return `${place}st`;
  if (mod10 === 2) return `${place}nd`;
  if (mod10 === 3) return `${place}rd`;
  return `${place}th`;
}
