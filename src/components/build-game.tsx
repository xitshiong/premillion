"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { BUILD_STATS, buildRating, clubWithUser, strengthFrom, type ClubRating, type GameData, type RollPlayer, type RollStat } from "@/lib/ratings";
import { mulberry32, simulateSeason, type MatchResult, type TableRow } from "@/lib/simulate";

const PLAYER_REROLLS = 8;
const TEAM_REROLLS = 6;
const TICK_MS = 70;

type LockedStat = RollStat & { playerId: number; playerName: string; teamName: string };
type Spin = { kind: "team" | "player" | "club"; title: string; subtitle: string };

function tone(value: number) {
  if (value >= 85) return "text-[#f6c453]";
  if (value >= 75) return "text-[#7ee0a1]";
  if (value >= 65) return "text-[#8fd4ff]";
  return "text-[#ff8b9a]";
}

function pick<T>(list: T[], random: () => number = Math.random) {
  return list[Math.floor(random() * list.length)];
}

function Portrait({ url, name }: { url: string | null; name: string }) {
  const [failed, setFailed] = useState(false);
  if (!url || failed) {
    const initials = name
      .split(" ")
      .map((part) => part[0])
      .slice(0, 2)
      .join("");
    return <p className="absolute inset-0 grid place-items-center font-serif text-7xl text-[#2a527f]">{initials}</p>;
  }
  return <Image src={url} alt={name} fill unoptimized sizes="270px" className="object-contain object-bottom" onError={() => setFailed(true)} />;
}

function newSeed() {
  return Math.floor(Math.random() * 1_000_000_000);
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

export function BuildGame({ data, seed }: { data: GameData; seed: number }) {
  const byClub = useMemo(() => {
    const map = new Map<number, RollPlayer[]>();
    for (const player of data.players) map.set(player.teamId, [...(map.get(player.teamId) ?? []), player]);
    return map;
  }, [data.players]);
  const rollClubs = useMemo(() => data.clubs.filter((club) => (byClub.get(club.id)?.length ?? 0) > 0), [data.clubs, byClub]);
  const playerName = useMemo(() => new Map(data.players.map((player) => [player.id, player])), [data.players]);

  const [rolled, setRolled] = useState<RollPlayer>(() => {
    const random = mulberry32(seed);
    const club = pick(rollClubs, random);
    return pick(byClub.get(club.id) ?? data.players, random);
  });
  const [rollCount, setRollCount] = useState(0);
  const [spin, setSpin] = useState<Spin | null>(null);
  const [locked, setLocked] = useState<Record<string, LockedStat>>({});
  const [playerRerolls, setPlayerRerolls] = useState(PLAYER_REROLLS);
  const [teamRerolls, setTeamRerolls] = useState(TEAM_REROLLS);
  const [club, setClub] = useState<ClubRating | null>(null);
  const [season, setSeason] = useState<{ table: TableRow[]; matches: MatchResult[] } | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => () => {
    if (timer.current) clearInterval(timer.current);
  }, []);

  const taken = Object.keys(locked).length;
  const complete = taken === 10;
  const round = Math.min(taken + 1, 10);
  const spinning = spin !== null;
  const clubPool = byClub.get(rolled.teamId) ?? [];

  const runSpin = useCallback((frames: (() => Spin)[], land: () => void) => {
    if (timer.current) clearInterval(timer.current);
    let index = 0;
    setSpin(frames[0]());
    timer.current = setInterval(() => {
      index += 1;
      if (index >= frames.length) {
        if (timer.current) clearInterval(timer.current);
        timer.current = null;
        setSpin(null);
        land();
        setRollCount((count) => count + 1);
        return;
      }
      setSpin(frames[index]());
    }, TICK_MS);
  }, []);

  const teamFrames = useCallback(
    (target: ClubRating, count: number) =>
      Array.from({ length: count }, (_, index) => () => {
        const shown = index === count - 1 ? target : pick(rollClubs);
        return { kind: "team" as const, title: shown.name, subtitle: "Rolling a club" };
      }),
    [rollClubs],
  );

  const playerFrames = useCallback(
    (pool: RollPlayer[], target: RollPlayer, count: number) =>
      Array.from({ length: count }, (_, index) => () => {
        const shown = index === count - 1 ? target : pick(pool);
        return { kind: "player" as const, title: shown.name, subtitle: shown.teamName };
      }),
    [],
  );

  const rollFreshTeam = useCallback(
    (avoidClubId?: number) => {
      const clubs = rollClubs.filter((item) => item.id !== avoidClubId);
      const nextClub = pick(clubs.length ? clubs : rollClubs);
      const pool = byClub.get(nextClub.id) ?? [];
      const nextPlayer = pick(pool);
      runSpin([...teamFrames(nextClub, 8), ...playerFrames(pool, nextPlayer, 7)], () => setRolled(nextPlayer));
    },
    [byClub, playerFrames, rollClubs, runSpin, teamFrames],
  );

  function choose(stat: RollStat) {
    if (spinning || locked[stat.key] || complete) return;
    const next = { ...locked, [stat.key]: { ...stat, playerId: rolled.id, playerName: rolled.name, teamName: rolled.teamName } };
    setLocked(next);
    if (Object.keys(next).length < 10) rollFreshTeam();
  }

  function rerollPlayer() {
    if (spinning || complete || playerRerolls <= 0 || clubPool.length < 2) return;
    setPlayerRerolls((count) => count - 1);
    const others = clubPool.filter((player) => player.id !== rolled.id);
    const nextPlayer = pick(others);
    runSpin(playerFrames(clubPool, nextPlayer, 10), () => setRolled(nextPlayer));
  }

  function rerollTeam() {
    if (spinning || complete || teamRerolls <= 0) return;
    setTeamRerolls((count) => count - 1);
    rollFreshTeam(rolled.teamId);
  }

  function rollClub() {
    if (spinning || !complete) return;
    const target = pick(data.clubs);
    setSeason(null);
    runSpin(
      Array.from({ length: 16 }, (_, index) => () => {
        const shown = index === 15 ? target : pick(data.clubs);
        return { kind: "club" as const, title: shown.name, subtitle: "Rolling the club you join" };
      }),
      () => setClub(target),
    );
  }

  function restart() {
    if (timer.current) clearInterval(timer.current);
    timer.current = null;
    setSpin(null);
    setLocked({});
    setPlayerRerolls(PLAYER_REROLLS);
    setTeamRerolls(TEAM_REROLLS);
    setClub(null);
    setSeason(null);
    rollFreshTeam();
  }

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) return;
      const key = event.key.toLowerCase();
      if (key === "t") return rerollTeam();
      if (key === "y") return rerollPlayer();
      const index = key === "0" ? 9 : Number(key) - 1;
      if (!Number.isInteger(index) || index < 0 || index > 9) return;
      const stat = rolled.stats[index];
      if (stat) choose(stat);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const lockedStats = Object.values(locked);
  const rating = buildRating(lockedStats);
  const profile = complete ? strengthFrom(lockedStats) : null;
  const lineup = club && profile ? clubWithUser(club, profile) : null;
  const replaced = lineup?.replacedId ? playerName.get(lineup.replacedId) : undefined;

  function playSeason() {
    if (!club || !profile) return;
    setSeason(
      simulateSeason({
        clubs: data.clubs,
        userClubId: club.id,
        userAttack: profile.attack,
        userDefense: profile.defense,
        goalsPerTeamGame: data.goalsPerTeamGame,
        seed: newSeed(),
      }),
    );
  }

  const place = season && club ? season.table.findIndex((row) => row.id === club.id) + 1 : null;
  const yourMatches = season && club ? season.matches.filter((match) => match.home === club.id || match.away === club.id) : [];
  const shortName = new Map(data.clubs.map((item) => [item.id, item.abbr || item.name]));
  const rollSpin = spin && spin.kind !== "club" ? spin : null;

  return (
    <div className="min-h-screen bg-[#07111c] text-[#e7eef8]">
      <header className="border-b border-[#16304d] bg-[#091624]">
        <div className="mx-auto flex max-w-[1240px] items-center justify-between gap-3 px-3 py-3 sm:px-4">
          <div className="min-w-0">
            <p className="text-[11px] tracking-[0.18em] text-[#8fd4ff] uppercase">{data.season} Premier League</p>
            <p className="truncate font-serif text-lg">Build your player</p>
            <p className="text-xs tracking-[0.16em] text-[#9fb0c7] sm:hidden">Round {round} / 10</p>
          </div>
          <div className="hidden text-center sm:block">
            <p className="text-sm font-semibold tracking-[0.2em]">ROUND {round} / 10</p>
            <div className="mt-1.5 flex gap-1">
              {Array.from({ length: 10 }, (_, index) => (
                <span key={index} className={`h-1.5 w-5 rounded-full ${index < taken ? "bg-[#f6c453]" : index === taken && !complete ? "bg-[#f6c453]/40" : "bg-[#16304d]"}`} />
              ))}
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

      <div className="mx-auto grid max-w-[1240px] gap-3 px-3 py-3 lg:grid-cols-[270px_minmax(0,1fr)_290px] lg:px-4">
        <section className="overflow-hidden rounded-xl border border-[#1c3d62] bg-[#0c1b2e]">
          <p className="bg-gradient-to-r from-[#1d4ed8] to-[#0c1b2e] px-4 py-2 text-xs font-semibold tracking-[0.16em]">YOU ROLLED</p>
          <div key={rollSpin ? "spin" : `card-${rollCount}`} className={rollSpin ? "" : "animate-card-pop"}>
            <div className="relative mx-4 mt-4 aspect-[4/3.4] overflow-hidden rounded-lg border border-[#1c3d62] bg-gradient-to-b from-[#173253] to-[#0a1626]">
              {rollSpin ? (
                <div className="absolute inset-0 grid place-items-center">
                  <div className="animate-roll-glow absolute inset-0 bg-[radial-gradient(circle_at_50%_40%,rgba(246,196,83,0.35),transparent_60%)]" />
                  <p className="relative font-serif text-6xl text-[#f6c453]">?</p>
                </div>
              ) : (
                <>
                  <Portrait key={rolled.id} url={rolled.avatarUrl} name={rolled.name} />
                  <div className="absolute top-2 right-2 rounded-md border border-white/20 bg-[#0a1626]/85 px-2 py-1 text-center">
                    <p className="text-[10px] tracking-wide text-[#9fb0c7]">OVR</p>
                    <p className={`font-serif text-3xl leading-none tabular-nums ${tone(rolled.overall)}`}>{rolled.overall}</p>
                    <p className="mt-0.5 text-xs font-semibold">{rolled.eaPosition}</p>
                  </div>
                  <span className={`absolute top-2 left-2 rounded px-2 py-0.5 text-[11px] font-semibold tracking-wide uppercase ${rolled.role === "First team" ? "bg-[#f6c453] text-[#1a1404]" : "bg-[#2563eb] text-white"}`}>
                    {rolled.role}
                  </span>
                </>
              )}
            </div>
            <div className="p-4">
              <h1 className={`font-serif text-3xl leading-tight ${rollSpin ? "animate-ticker text-[#f6c453]" : ""}`}>{rollSpin ? rollSpin.title : rolled.name}</h1>
              <p className="mt-1 text-sm font-semibold tracking-wide text-[#8fd4ff] uppercase">{rollSpin ? rollSpin.subtitle : rolled.teamName}</p>
              {!rollSpin ? (
                <p className="mt-3 text-sm text-[#c5d2e4]">
                  {rolled.appearances} apps · {rolled.minutes} min · {rolled.goals} {rolled.goals === 1 ? "goal" : "goals"} · {rolled.assists}{" "}
                  {rolled.assists === 1 ? "assist" : "assists"}
                </p>
              ) : null}
            </div>
          </div>
        </section>

        <section className="rounded-xl border border-[#1c3d62] bg-[#10243d] p-4">
          <div className="rounded-lg border border-[#2a527f] bg-[#0c1b2e]/70 p-4 text-center">
            <p className="text-xs tracking-[0.16em] text-[#9fb0c7]">{complete ? "BUILD COMPLETE" : `PICK ${round} OF 10`}</p>
            <h2 className="mt-1 font-serif text-3xl leading-tight">
              {complete ? "Every attribute is locked" : rollSpin ? "Rolling…" : `You rolled ${rolled.name}`}
            </h2>
            {!complete ? (
              <div className="mt-3 flex flex-wrap justify-center gap-2">
                <button
                  type="button"
                  onClick={rerollTeam}
                  disabled={spinning || teamRerolls <= 0}
                  className="rounded-md bg-[#2563eb] px-3 py-2 text-sm font-semibold text-white transition hover:brightness-110 disabled:opacity-40"
                  title="New club and a new player from it (T)"
                >
                  Reroll team ({teamRerolls})
                </button>
                <button
                  type="button"
                  onClick={rerollPlayer}
                  disabled={spinning || playerRerolls <= 0 || clubPool.length < 2}
                  className="rounded-md bg-[#e11d6a] px-3 py-2 text-sm font-semibold text-white transition hover:brightness-110 disabled:opacity-40"
                  title={`Another ${rolled.teamName} player (Y)`}
                >
                  Reroll player ({playerRerolls})
                </button>
              </div>
            ) : null}
            {!complete ? (
              <p className="mt-2 text-xs text-[#7f93ab]">Reroll team gives a new club and a new player from it. Reroll player keeps {rolled.teamName}.</p>
            ) : null}
          </div>

          <p className="mt-4 text-xs font-semibold tracking-[0.14em] text-[#9fb0c7] uppercase">
            {complete ? (
              "Your last roll"
            ) : (
              <>
                Choose one attribute from <span className="text-[#8fd4ff]">{rollSpin ? "…" : rolled.name}</span>
              </>
            )}
          </p>
          <div className="mt-2 grid gap-2 sm:grid-cols-2">
            {rolled.stats.map((stat, index) => {
              const owned = locked[stat.key];
              const disabled = Boolean(owned) || complete || spinning;
              return (
                <button
                  key={`${stat.key}-${rollCount}`}
                  type="button"
                  disabled={disabled}
                  onClick={() => choose(stat)}
                  style={{ animationDelay: `${index * 35}ms` }}
                  className={`relative overflow-hidden rounded-lg border px-3 py-2 text-left transition ${spinning ? "" : "animate-tile-in"} ${
                    owned || complete ? "border-[#1c3d62] bg-[#0c1b2e]/70 opacity-60" : "border-[#2a527f] bg-[#0d2138] hover:-translate-y-0.5 hover:border-[#f6c453]"
                  }`}
                >
                  <span className="flex items-center justify-between gap-2">
                    <span className="text-sm font-semibold tracking-wide uppercase">{stat.label}</span>
                    <span className="rounded bg-[#1c3d62] px-1.5 text-[11px] text-[#9fb0c7]">{index === 9 ? 0 : index + 1}</span>
                  </span>
                  <span className="mt-1 flex items-end justify-between gap-2">
                    <span className="text-xs text-[#7f93ab]">{owned ? `Taken from ${owned.playerName}` : stat.detail}</span>
                    {spinning ? (
                      <span className="animate-roll-glow font-serif text-4xl leading-none text-[#3d5674]">??</span>
                    ) : (
                      <span className={`font-serif text-4xl leading-none tabular-nums ${tone(stat.value)}`}>{stat.value}</span>
                    )}
                  </span>
                </button>
              );
            })}
          </div>
          {!complete ? <p className="mt-3 text-xs text-[#7f93ab]">Keys 1–9 and 0 pick. T rerolls the team, Y rerolls the player.</p> : null}

          {complete && profile ? (
            <div className="mt-4 rounded-lg border border-[#f6c453]/40 bg-[#0c1b2e] p-4">
              {!club || spin?.kind === "club" ? (
                <>
                  <p className="text-xs tracking-[0.16em] text-[#9fb0c7] uppercase">Last roll</p>
                  <p className={`mt-1 font-serif text-3xl ${spin?.kind === "club" ? "animate-ticker text-[#f6c453]" : ""}`}>
                    {spin?.kind === "club" ? spin.title : "Which club do you join?"}
                  </p>
                  <button
                    type="button"
                    onClick={rollClub}
                    disabled={spinning}
                    className="mt-3 rounded-md bg-[#f6c453] px-4 py-2 font-semibold text-[#1a1404] disabled:opacity-50"
                  >
                    Roll your club
                  </button>
                </>
              ) : (
                <div key={`club-${rollCount}`} className="animate-card-pop">
                  <p className="text-xs tracking-[0.16em] text-[#9fb0c7] uppercase">You join</p>
                  <p className="mt-1 font-serif text-3xl text-[#f6c453]">{club.name}</p>
                  <p className="mt-2 text-sm text-[#c5d2e4]">
                    Your attack is {profile.attack.toFixed(1)} and your defence is {profile.defense.toFixed(1)}.
                    {replaced ? ` You take the place of ${replaced.name} (${replaced.overall}) among ${club.name}'s ${club.core.length} most-used outfielders.` : ""}
                  </p>
                  <button type="button" onClick={playSeason} className="mt-3 rounded-md bg-[#f6c453] px-4 py-2 font-semibold text-[#1a1404]">
                    {season ? "Simulate again" : "Play the 38 matchweeks"}
                  </button>
                </div>
              )}
            </div>
          ) : null}
        </section>

        <section className="rounded-xl border border-[#1c3d62] bg-[#0c1b2e] p-4">
          <div className="flex items-end justify-between">
            <div>
              <h2 className="font-serif text-2xl">Your build</h2>
              <p className="text-xs text-[#9fb0c7] tabular-nums">{taken} / 10 attributes</p>
            </div>
            <div className="text-right">
              <p className={`font-serif text-4xl leading-none tabular-nums ${taken ? tone(rating) : "text-[#3d5674]"}`}>{taken ? rating : "—"}</p>
              <p className="text-[10px] tracking-wide text-[#9fb0c7] uppercase">Build rating</p>
            </div>
          </div>
          <div className="mt-3 grid grid-cols-2 gap-2 lg:grid-cols-1">
            {BUILD_STATS.map((definition) => {
              const slot = locked[definition.key];
              return (
                <div
                  key={definition.key}
                  className={`flex items-center justify-between gap-2 rounded-lg border px-3 py-2 ${slot ? "animate-slot-fill border-[#2a527f] bg-[#10243d]" : "border-[#1c3d62] bg-[#0a1626]"}`}
                >
                  <div className="min-w-0">
                    <p className="text-xs font-semibold tracking-wide text-[#9fb0c7] uppercase">{definition.label}</p>
                    <p className="truncate text-xs">{slot ? slot.playerName : "Open"}</p>
                  </div>
                  <p className={`font-serif text-2xl tabular-nums ${slot ? tone(slot.value) : "text-[#3d5674]"}`}>{slot ? slot.value : "—"}</p>
                </div>
              );
            })}
          </div>
          <p className="mt-3 text-[11px] leading-relaxed text-[#7f93ab]">
            Ratings are EA SPORTS FC’s, copied from ea.com. The roll uses {data.firstTeam} first-team and {data.bench} bench outfielders, each with at least 270 Premier League minutes this season.
          </p>
        </section>
      </div>

      {season && club && place ? (
        <section className="mx-auto max-w-[1240px] px-3 pb-10 lg:px-4">
          <div className="animate-card-pop rounded-xl border border-[#f6c453]/50 bg-[#10243d] p-4 sm:p-6">
            <p className="text-xs tracking-[0.18em] text-[#f6c453] uppercase">{club.name}</p>
            <h2 className="mt-1 font-serif text-4xl sm:text-5xl">{place === 1 ? "You won the league." : `You finished ${ordinal(place)}.`}</h2>
            <p className="mt-2 max-w-3xl text-sm text-[#9fb0c7]">
              Each club is rated from the EA ratings of its {data.coreSize} most-used outfielders this season. Attack is pace, shooting, passing, dribbling, finishing, and vision. Defence is defending, physical, reactions, and heading. A match turns those into expected goals around {data.goalsPerTeamGame.toFixed(2)} per side, which is this season’s scoring rate so far. Home sides get 10% more, then the score is drawn at random. It is a simulation, not a forecast.
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
                const home = match.home === club.id;
                const yours = home ? match.homeGoals : match.awayGoals;
                const theirs = home ? match.awayGoals : match.homeGoals;
                const outcome = yours > theirs ? "W" : yours < theirs ? "L" : "D";
                return (
                  <p key={`${match.week}-${match.home}`} className="flex items-center justify-between rounded-md bg-[#0c1b2e] px-3 py-1.5 text-sm">
                    <span className="text-[#9fb0c7]">W{match.week}</span>
                    <span>
                      {home ? "H" : "A"} {shortName.get(home ? match.away : match.home)} {match.homeGoals}–{match.awayGoals}
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
