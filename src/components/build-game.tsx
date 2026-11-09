"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import Image from "next/image";
import Link from "next/link";
import { BookOpen, RotateCcw, Volume2, VolumeX } from "lucide-react";
import { PixelStadium } from "@/components/pixel-stadium";
import { BUILD_STATS, buildRating, clubWithUser, strengthFrom, type ClubRating, type GameData, type RollPlayer, type RollStat } from "@/lib/ratings";
import { muteStore, sfx } from "@/lib/sfx";
import { mulberry32, simulateSeason, tableAt, type MatchResult } from "@/lib/simulate";

const PLAYER_REROLLS = 8;
const TEAM_REROLLS = 6;
const TICK_MS = 70;
const WEEK_MS = 150;

const ROUND_LINES = [
  "first pull. no pressure.",
  "the scouts are watching.",
  "plenty of time to fix that.",
  "the gaffer keeps asking about pace.",
  "halfway. the stitches are holding.",
  "the group chat has opinions.",
  "deadline day energy.",
  "three left. choose well.",
  "nearly a whole footballer.",
  "last pull. make it count.",
];

type LockedStat = RollStat & { playerId: number; playerName: string; teamName: string };
type Spin = { kind: "team" | "player" | "club"; title: string; subtitle: string };
type Phase = "intro" | "build" | "season";

const TIERS = [
  { min: 90, label: "World class", text: "text-tier-world", bg: "bg-tier-world" },
  { min: 85, label: "Elite", text: "text-tier-elite", bg: "bg-tier-elite" },
  { min: 80, label: "Starter", text: "text-tier-starter", bg: "bg-tier-starter" },
  { min: 70, label: "Squad", text: "text-tier-squad", bg: "bg-tier-squad" },
  { min: 0, label: "Rotation", text: "text-tier-bench", bg: "bg-tier-bench" },
];

function tier(value: number) {
  return TIERS.find((item) => value >= item.min) ?? TIERS[TIERS.length - 1];
}

function pick<T>(list: T[], random: () => number = Math.random) {
  return list[Math.floor(random() * list.length)];
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

function verdict(place: number) {
  if (place === 1) return { title: "Champions", line: "stitched together from ten blokes and it won the league.", sound: "champion" as const, color: "text-gold" };
  if (place <= 4) return { title: "Champions League", line: "not bad for a lad made of spare parts.", sound: "europe" as const, color: "text-flood" };
  if (place <= 7) return { title: "Europe", line: "thursday nights it is.", sound: "europe" as const, color: "text-flood" };
  if (place <= 17) return { title: "Mid-table", line: "nobody is writing songs about this one.", sound: "midtable" as const, color: "text-chalk" };
  return { title: "Relegated", line: "the stitches didn't hold.", sound: "relegated" as const, color: "text-kit" };
}

function Portrait({ url, name }: { url: string | null; name: string }) {
  const [failed, setFailed] = useState(false);
  if (!url || failed) {
    const initials = name
      .split(" ")
      .map((part) => part[0])
      .slice(0, 2)
      .join("");
    return <p className="absolute inset-0 grid place-items-center font-pixel text-6xl text-line">{initials}</p>;
  }
  return <Image src={url} alt={name} fill unoptimized loading="eager" sizes="280px" className="object-contain object-bottom" onError={() => setFailed(true)} />;
}

function Key({ children }: { children: React.ReactNode }) {
  return <span className="inline-grid h-5 min-w-5 place-items-center border border-line bg-night px-1 font-ui text-[10px] text-haze">{children}</span>;
}

function IconButton({ label, onClick, href, children }: { label: string; onClick?: () => void; href?: string; children: React.ReactNode }) {
  const className = "grid size-9 place-items-center border border-line bg-stand text-haze transition hover:border-flood hover:text-flood";
  if (href) {
    return (
      <Link href={href} aria-label={label} title={label} className={className}>
        {children}
      </Link>
    );
  }
  return (
    <button type="button" onClick={onClick} aria-label={label} title={label} className={className}>
      {children}
    </button>
  );
}

export function BuildGame({ data, seed }: { data: GameData; seed: number }) {
  const byClub = useMemo(() => {
    const map = new Map<number, RollPlayer[]>();
    for (const player of data.players) map.set(player.teamId, [...(map.get(player.teamId) ?? []), player]);
    return map;
  }, [data.players]);
  const rollClubs = useMemo(() => data.clubs.filter((club) => (byClub.get(club.id)?.length ?? 0) > 0), [data.clubs, byClub]);
  const playerById = useMemo(() => new Map(data.players.map((player) => [player.id, player])), [data.players]);
  const shortName = useMemo(() => new Map(data.clubs.map((item) => [item.id, item.abbr || item.name])), [data.clubs]);

  const [phase, setPhase] = useState<Phase>("intro");
  const [rolled, setRolled] = useState<RollPlayer>(() => {
    const random = mulberry32(seed);
    const club = pick(rollClubs, random);
    return pick(byClub.get(club.id) ?? data.players, random);
  });
  const [rollCount, setRollCount] = useState(0);
  const [spin, setSpin] = useState<Spin | null>(null);
  const [locked, setLocked] = useState<Record<string, LockedStat>>({});
  const [lastPick, setLastPick] = useState<LockedStat | null>(null);
  const [playerRerolls, setPlayerRerolls] = useState(PLAYER_REROLLS);
  const [teamRerolls, setTeamRerolls] = useState(TEAM_REROLLS);
  const [club, setClub] = useState<ClubRating | null>(null);
  const [season, setSeason] = useState<{ matches: MatchResult[] } | null>(null);
  const [week, setWeek] = useState(0);
  const [denied, setDenied] = useState(0);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const weekTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const muted = useSyncExternalStore(muteStore.subscribe, muteStore.get, muteStore.getServer);

  useEffect(
    () => () => {
      if (timer.current) clearInterval(timer.current);
      if (weekTimer.current) clearInterval(weekTimer.current);
    },
    [],
  );

  const taken = Object.keys(locked).length;
  const complete = taken === 10;
  const round = Math.min(taken + 1, 10);
  const spinning = spin !== null;
  const clubPool = byClub.get(rolled.teamId) ?? [];

  const runSpin = useCallback((frames: (() => Spin)[], land: () => void, sound: "tick" | "drum" = "tick") => {
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
      sfx().play(sound, 1 + index / frames.length);
      setSpin(frames[index]());
    }, TICK_MS);
  }, []);

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
      const teamFrames = Array.from({ length: 8 }, (_, index) => () => {
        const shown = index === 7 ? nextClub : pick(rollClubs);
        return { kind: "team" as const, title: shown.name, subtitle: "drawing a club" };
      });
      sfx().play("whoosh");
      runSpin([...teamFrames, ...playerFrames(pool, nextPlayer, 7)], () => {
        setRolled(nextPlayer);
        sfx().play("land");
      });
    },
    [byClub, playerFrames, rollClubs, runSpin],
  );

  function deny() {
    sfx().play("deny");
    setDenied((count) => count + 1);
  }

  function kickOff() {
    setPhase("build");
    sfx().play("kickoff");
    rollFreshTeam();
  }

  function choose(stat: RollStat) {
    if (phase !== "build" || spinning || complete) return;
    if (locked[stat.key]) return deny();
    const entry = { ...stat, playerId: rolled.id, playerName: rolled.name, teamName: rolled.teamName };
    const next = { ...locked, [stat.key]: entry };
    setLocked(next);
    setLastPick(entry);
    sfx().play(stat.value >= 90 ? "pick-world" : stat.value >= 85 ? "pick-elite" : "pick");
    if (Object.keys(next).length < 10) setTimeout(() => rollFreshTeam(), 260);
  }

  function rerollPlayer() {
    if (phase !== "build" || spinning || complete) return;
    if (playerRerolls <= 0 || clubPool.length < 2) return deny();
    setPlayerRerolls((count) => count - 1);
    const nextPlayer = pick(clubPool.filter((player) => player.id !== rolled.id));
    sfx().play("whoosh");
    runSpin(playerFrames(clubPool, nextPlayer, 10), () => {
      setRolled(nextPlayer);
      sfx().play("land");
    });
  }

  function rerollTeam() {
    if (phase !== "build" || spinning || complete) return;
    if (teamRerolls <= 0) return deny();
    setTeamRerolls((count) => count - 1);
    rollFreshTeam(rolled.teamId);
  }

  function rollClub() {
    if (spinning || !complete) return;
    const target = pick(data.clubs);
    runSpin(
      Array.from({ length: 18 }, (_, index) => () => {
        const shown = index === 17 ? target : pick(data.clubs);
        return { kind: "club" as const, title: shown.name, subtitle: "" };
      }),
      () => {
        setClub(target);
        sfx().play("reveal");
      },
      "drum",
    );
  }

  function stopWeeks() {
    if (weekTimer.current) clearInterval(weekTimer.current);
    weekTimer.current = null;
  }

  function finishSeason(matches: MatchResult[], clubId: number) {
    stopWeeks();
    setWeek(38);
    const place = tableAt(data.clubs, matches, 38).findIndex((row) => row.id === clubId) + 1;
    sfx().play(verdict(place).sound);
  }

  function playSeason() {
    if (!club || !profile) return;
    const result = simulateSeason({
      clubs: data.clubs,
      userClubId: club.id,
      userAttack: profile.attack,
      userDefense: profile.defense,
      goalsPerTeamGame: data.goalsPerTeamGame,
      seed: newSeed(),
    });
    setSeason({ matches: result.matches });
    setPhase("season");
    setWeek(0);
    sfx().play("kickoff");
    stopWeeks();
    let current = 0;
    weekTimer.current = setInterval(() => {
      current += 1;
      if (current >= 38) return finishSeason(result.matches, club.id);
      setWeek(current);
      const match = result.matches.find((item) => item.week === current && (item.home === club.id || item.away === club.id));
      if (match) {
        const home = match.home === club.id;
        const diff = (home ? match.homeGoals : match.awayGoals) - (home ? match.awayGoals : match.homeGoals);
        sfx().play(diff > 0 ? "win" : diff < 0 ? "loss" : "draw");
      }
    }, WEEK_MS);
  }

  function restart() {
    if (timer.current) clearInterval(timer.current);
    timer.current = null;
    stopWeeks();
    setSpin(null);
    setLocked({});
    setLastPick(null);
    setPlayerRerolls(PLAYER_REROLLS);
    setTeamRerolls(TEAM_REROLLS);
    setClub(null);
    setSeason(null);
    setWeek(0);
    setPhase("build");
    rollFreshTeam();
  }

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement || event.metaKey || event.ctrlKey) return;
      const key = event.key.toLowerCase();
      if (phase === "intro" && (key === "enter" || key === " ")) {
        event.preventDefault();
        return kickOff();
      }
      if (key === "m") return muteStore.toggle();
      if (phase !== "build") return;
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
  const replaced = lineup?.replacedId ? playerById.get(lineup.replacedId) : undefined;
  const rollSpin = spin && spin.kind !== "club" ? spin : null;

  const header = (
    <header className="relative z-10 border-b border-line bg-night/90 backdrop-blur">
      <div className="mx-auto flex max-w-[1260px] items-center justify-between gap-3 px-3 py-2.5 sm:px-4">
        <button type="button" onClick={() => setPhase("intro")} className="title-split font-pixel text-lg tracking-[0.12em] text-chalk sm:text-xl">
          FRANKENBALLER
        </button>
        {phase === "build" ? (
          <div className="hidden text-center md:block">
            <p className="font-pixel text-sm tracking-[0.3em] text-chalk">
              ROUND {round} / 10
            </p>
            <div className="mt-1 flex justify-center gap-1">
              {Array.from({ length: 10 }, (_, index) => (
                <span key={index} className={`h-1.5 w-4 ${index < taken ? "bg-flood" : index === taken && !complete ? "animate-blink bg-flood/50" : "bg-line"}`} />
              ))}
            </div>
          </div>
        ) : null}
        <div className="flex items-center gap-1.5">
          <IconButton label={muted ? "Sound off (M)" : "Sound on (M)"} onClick={() => muteStore.toggle()}>
            {muted ? <VolumeX className="size-4" /> : <Volume2 className="size-4" />}
          </IconButton>
          {phase !== "intro" ? (
            <IconButton label="Start a new player" onClick={restart}>
              <RotateCcw className="size-4" />
            </IconButton>
          ) : null}
          <IconButton label="The stat book" href="/book">
            <BookOpen className="size-4" />
          </IconButton>
        </div>
      </div>
    </header>
  );

  if (phase === "intro") {
    return (
      <div className="crt relative flex min-h-screen flex-col overflow-hidden bg-night font-ui text-chalk">
        {header}
        <div className="relative flex flex-1 flex-col">
          <div className="relative">
            <PixelStadium className="h-[46vh] min-h-[260px]" />
            <div className="absolute inset-x-0 top-[8%] px-4 text-center">
              <h1 className="title-split animate-flicker font-pixel text-[13vw] leading-none tracking-[0.04em] text-chalk sm:text-7xl lg:text-8xl">FRANKENBALLER</h1>
              <p className="mt-4 inline-block border border-flood/40 bg-night/85 px-3 py-1.5 font-pixel text-xs tracking-[0.5em] text-flood sm:text-sm">THE {data.season} BUILD</p>
            </div>
          </div>
          <div className="relative mx-auto w-full max-w-xl flex-1 px-4 pt-8 pb-10 text-center">
            <p className="text-sm text-haze">
              ten real premier league players · one attribute from each · <span className="text-chalk">38 matchweeks to prove it</span>
            </p>
            <button
              type="button"
              onClick={kickOff}
              className="glow-flood mt-7 w-full bg-turf py-4 font-pixel text-lg tracking-[0.3em] text-chalk transition hover:bg-stand"
            >
              ▶ KICK OFF ◀
            </button>
            <div className="mt-6 space-y-2 text-left text-xs leading-relaxed text-haze">
              <p>── each round draws a club, then one of its players. take one of his ten EA FC ratings. pace from one, finishing from another.</p>
              <p>── reroll team for a new club. reroll player to stay at the same club.</p>
              <p>── only lads who actually play: at least 270 league minutes this season. {data.firstTeam} first-teamers, {data.bench} off the bench.</p>
              <p>── then you sign for a random club and we play the whole season.</p>
            </div>
            <p className="mt-8 text-[10px] tracking-[0.2em] text-dim uppercase">enter to start · m to mute · sound recommended</p>
          </div>
        </div>
        <footer className="border-t border-line px-4 py-3 text-center text-[10px] tracking-wide text-dim">
          ratings: EA SPORTS FC via ea.com · minutes &amp; goals: premierleague.com · a fan project, not affiliated with either
        </footer>
      </div>
    );
  }

  if (phase === "season" && season && club) {
    const table = tableAt(data.clubs, season.matches, week);
    const place = table.findIndex((row) => row.id === club.id) + 1;
    const done = week >= 38;
    const mine = season.matches.filter((match) => match.home === club.id || match.away === club.id).sort((a, b) => a.week - b.week);
    const shown = mine.filter((match) => match.week <= week);
    const latest = shown[shown.length - 1];
    const end = verdict(place);
    return (
      <div className="crt min-h-screen bg-night font-ui text-chalk">
        {header}
        <div className="mx-auto grid max-w-[1260px] gap-3 px-3 py-4 lg:grid-cols-[minmax(0,1fr)_380px] lg:px-4">
          <section className="pixel-frame bg-turf p-4 sm:p-6">
            <p className="font-pixel text-xs tracking-[0.3em] text-flood">{club.name.toUpperCase()}</p>
            <div className="mt-2 flex flex-wrap items-end justify-between gap-4">
              <div>
                <p className="text-xs text-haze uppercase">{done ? "full time" : `matchweek ${week} / 38`}</p>
                <p className={`font-digits text-8xl leading-none ${done ? end.color : "text-chalk"}`}>{place ? ordinal(place) : "—"}</p>
              </div>
              {latest && !done ? (
                <p key={latest.week} className="animate-tile-in font-digits text-3xl text-haze">
                  {shortName.get(latest.home)} {latest.homeGoals}–{latest.awayGoals} {shortName.get(latest.away)}
                </p>
              ) : null}
              {!done ? (
                <button type="button" onClick={() => finishSeason(season.matches, club.id)} className="border border-line px-3 py-1.5 font-pixel text-xs tracking-[0.2em] text-haze hover:border-flood hover:text-flood">
                  SKIP ▶▶
                </button>
              ) : null}
            </div>
            {done ? (
              <div className="animate-card-pop mt-4">
                <p className={`title-split font-pixel text-3xl tracking-[0.12em] sm:text-4xl ${end.color}`}>{end.title.toUpperCase()}</p>
                <p className="mt-1 text-sm text-haze">── {end.line}</p>
              </div>
            ) : null}

            <div className="mt-5 flex flex-wrap gap-1" aria-label="Form">
              {mine.map((match) => {
                const home = match.home === club.id;
                const diff = (home ? match.homeGoals : match.awayGoals) - (home ? match.awayGoals : match.homeGoals);
                const played = match.week <= week;
                return (
                  <span
                    key={match.week}
                    title={`W${match.week} ${home ? "vs" : "at"} ${shortName.get(home ? match.away : match.home)} ${match.homeGoals}–${match.awayGoals}`}
                    className={`size-3.5 ${!played ? "bg-line/60" : diff > 0 ? "bg-grass" : diff < 0 ? "bg-kit" : "bg-gold"}`}
                  />
                );
              })}
            </div>

            <div className="mt-5 grid max-h-[22rem] gap-1 overflow-y-auto pr-1 sm:grid-cols-2">
              {[...shown].reverse().map((match) => {
                const home = match.home === club.id;
                const diff = (home ? match.homeGoals : match.awayGoals) - (home ? match.awayGoals : match.homeGoals);
                return (
                  <p key={match.week} className="flex items-center justify-between border border-line bg-night/60 px-3 py-1 text-xs">
                    <span className="text-dim">MW{match.week}</span>
                    <span>
                      {home ? "vs" : "at"} {shortName.get(home ? match.away : match.home)}
                    </span>
                    <span className={`font-digits text-lg ${diff > 0 ? "text-grass" : diff < 0 ? "text-kit" : "text-gold"}`}>
                      {match.homeGoals}–{match.awayGoals}
                    </span>
                  </p>
                );
              })}
            </div>

            {done ? (
              <div className="mt-5 flex flex-wrap gap-2">
                <button type="button" onClick={playSeason} className="glow-flood bg-turf px-4 py-2.5 font-pixel text-sm tracking-[0.2em] hover:bg-stand">
                  RUN IT BACK
                </button>
                <button type="button" onClick={restart} className="glow-kit bg-turf px-4 py-2.5 font-pixel text-sm tracking-[0.2em] hover:bg-stand">
                  NEW PLAYER
                </button>
              </div>
            ) : null}
            <p className="mt-5 max-w-2xl text-[11px] leading-relaxed text-dim">
              how it works: each club is rated from the EA ratings of its {data.coreSize} most-used outfielders, and you replace the weakest of {club.name}&apos;s. attack is pace, shooting, passing, dribbling, finishing and vision. defence is defending, physical, reactions and heading. a match turns those into expected goals around {data.goalsPerTeamGame.toFixed(2)} a side (this season&apos;s real scoring rate), home sides get a 10% bump, and the score is drawn at random. a simulation, not a prediction.
            </p>
          </section>

          <section className="pixel-frame bg-turf p-3">
            <table className="w-full text-xs">
              <thead className="text-dim">
                <tr>
                  {["", "club", "p", "gd", "pts"].map((heading) => (
                    <th key={heading} className="px-1.5 py-1 text-left font-normal uppercase">
                      {heading}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {table.map((row, index) => {
                  const yours = row.id === club.id;
                  const diff = row.goalsFor - row.goalsAgainst;
                  const zone = index === 0 ? "border-l-gold" : index < 4 ? "border-l-flood" : index >= 17 ? "border-l-kit" : "border-l-transparent";
                  return (
                    <tr key={row.id} className={`border-l-2 ${zone} ${yours ? "bg-flood/15 text-flood" : "text-chalk/85"}`}>
                      <td className="px-1.5 py-1 font-digits text-base text-dim">{index + 1}</td>
                      <td className="truncate px-1.5 py-1">{row.name}</td>
                      <td className="px-1.5 py-1 tabular-nums">{row.played}</td>
                      <td className="px-1.5 py-1 tabular-nums">{diff > 0 ? `+${diff}` : diff}</td>
                      <td className="px-1.5 py-1 font-digits text-lg leading-none">{row.points}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </section>
        </div>
      </div>
    );
  }

  return (
    <div className="crt min-h-screen bg-night font-ui text-chalk">
      {header}
      <div className="relative">
        <PixelStadium className="h-24 opacity-90 sm:h-28" />
        <p className="absolute inset-x-0 bottom-3 text-center text-xs text-chalk/80">
          ── {complete ? "ten pulls done. one footballer. allegedly." : ROUND_LINES[taken]}
        </p>
      </div>

      <div className="mx-auto -mt-1 grid max-w-[1260px] gap-3 px-3 py-3 lg:grid-cols-[280px_minmax(0,1fr)_290px] lg:px-4">
        <section className="pixel-frame bg-turf">
          <p className="border-b border-line px-4 py-2 font-pixel text-[11px] tracking-[0.3em] text-haze">YOU ROLLED</p>
          <div key={rollSpin ? "spin" : `card-${rollCount}`} className={rollSpin ? "" : "animate-card-pop"}>
            <div className="relative mx-3 mt-3 aspect-[16/9] overflow-hidden lg:aspect-[4/3.3] border border-line bg-[linear-gradient(180deg,#14284a_0%,#0b1424_100%)]">
              {rollSpin ? (
                <div className="absolute inset-0 grid place-items-center">
                  <div className="animate-roll-glow absolute inset-0 bg-[radial-gradient(circle_at_50%_45%,rgba(94,230,255,0.32),transparent_60%)]" />
                  <p className="relative font-pixel text-6xl text-flood">?</p>
                </div>
              ) : (
                <>
                  <Portrait key={rolled.id} url={rolled.avatarUrl} name={rolled.name} />
                  <div className="absolute top-2 right-2 border border-line bg-night/85 px-2 py-1 text-center">
                    <p className="font-pixel text-[9px] tracking-widest text-haze">OVR</p>
                    <p className={`font-digits text-4xl leading-none ${tier(rolled.overall).text}`}>{rolled.overall}</p>
                    <p className="font-pixel text-[10px] text-chalk">{rolled.eaPosition}</p>
                  </div>
                  <span className={`absolute top-2 left-2 px-1.5 py-0.5 font-pixel text-[9px] tracking-widest ${rolled.role === "First team" ? "bg-gold text-night" : "bg-flood text-night"}`}>
                    {rolled.role.toUpperCase()}
                  </span>
                </>
              )}
            </div>
            <div className="px-4 pt-3 pb-4">
              <h1 className={`font-digits text-4xl leading-none uppercase ${rollSpin ? "animate-ticker text-flood" : "text-chalk"}`}>{rollSpin ? rollSpin.title : rolled.name}</h1>
              <p className="mt-1.5 font-pixel text-[11px] tracking-[0.2em] text-kit">{(rollSpin ? rollSpin.subtitle : rolled.teamName).toUpperCase()}</p>
              {!rollSpin ? (
                <p className="mt-3 text-[11px] text-haze">
                  {rolled.appearances} apps · {rolled.minutes}&apos; · {rolled.goals}g · {rolled.assists}a this season
                </p>
              ) : null}
            </div>
          </div>
        </section>

        <section className="pixel-frame bg-turf p-3 sm:p-4">
          <div className="border border-line bg-night/50 px-4 py-4 text-center">
            <p className="font-pixel text-[10px] tracking-[0.35em] text-haze">{complete ? "BUILD COMPLETE" : `PICK ${round} OF 10`}</p>
            <h2 className="mt-1.5 font-pixel text-xl tracking-[0.12em] text-chalk sm:text-2xl">{complete ? "SIGN FOR A CLUB" : rollSpin ? "ROLLING…" : "PICK AN ATTRIBUTE"}</h2>
            {!complete ? (
              <div key={denied} className={`mt-4 flex flex-wrap justify-center gap-2 ${denied ? "animate-shake" : ""}`}>
                <button
                  type="button"
                  onClick={rerollTeam}
                  disabled={spinning || teamRerolls <= 0}
                  className="glow-flood flex items-center gap-2 bg-turf px-3 py-2 font-pixel text-[11px] tracking-[0.15em] transition hover:bg-stand disabled:opacity-35"
                  title="New club and a new player from it"
                >
                  REROLL TEAM <span className="font-digits text-lg leading-none text-flood">{teamRerolls}</span> <Key>T</Key>
                </button>
                <button
                  type="button"
                  onClick={rerollPlayer}
                  disabled={spinning || playerRerolls <= 0 || clubPool.length < 2}
                  className="glow-kit flex items-center gap-2 bg-turf px-3 py-2 font-pixel text-[11px] tracking-[0.15em] transition hover:bg-stand disabled:opacity-35"
                  title={`Another ${rolled.teamName} player`}
                >
                  REROLL PLAYER <span className="font-digits text-lg leading-none text-kit">{playerRerolls}</span> <Key>Y</Key>
                </button>
              </div>
            ) : null}
            {lastPick && !complete ? (
              <p key={`${lastPick.key}-${taken}`} className="animate-tile-in mt-3 text-[11px] text-haze">
                last pull: <span className={tier(lastPick.value).text}>{lastPick.value} {lastPick.label.toLowerCase()}</span> from {lastPick.playerName}
              </p>
            ) : null}
          </div>

          {!complete ? (
            <>
              <p className="mt-4 font-pixel text-[10px] tracking-[0.25em] text-haze">
                CHOOSE ONE FROM <span className="text-flood">{rollSpin ? "…" : rolled.name.toUpperCase()}</span>
              </p>
              <div className="mt-2 grid gap-2 sm:grid-cols-2">
                {rolled.stats.map((stat, index) => {
                  const owned = locked[stat.key];
                  const info = tier(stat.value);
                  return (
                    <button
                      key={`${stat.key}-${rollCount}`}
                      type="button"
                      disabled={spinning}
                      onClick={() => choose(stat)}
                      style={{ animationDelay: `${index * 30}ms` }}
                      className={`group relative border px-3 py-2 text-left transition ${spinning ? "" : "animate-tile-in"} ${
                        owned ? "cursor-not-allowed border-line/60 bg-night/40" : "border-line bg-stand hover:-translate-y-0.5 hover:border-flood hover:bg-[#13223b]"
                      }`}
                    >
                      <span className="flex items-start justify-between gap-2">
                        <span>
                          <span className={`block font-pixel text-xs tracking-[0.15em] ${owned ? "text-dim" : "text-chalk"}`}>{stat.label.toUpperCase()}</span>
                          <span className="mt-0.5 block text-[10px] text-dim">{owned ? `locked · ${owned.playerName}` : stat.detail.toLowerCase()}</span>
                        </span>
                        <Key>{index === 9 ? 0 : index + 1}</Key>
                      </span>
                      <span className="mt-1 flex items-end justify-between">
                        <span className={`font-pixel text-[9px] tracking-widest ${owned || spinning ? "text-transparent" : info.text} opacity-80`}>{info.label.toUpperCase()}</span>
                        {spinning ? (
                          <span className="animate-roll-glow font-digits text-5xl leading-none text-dim">??</span>
                        ) : (
                          <span className={`font-digits text-5xl leading-none ${owned ? "text-dim line-through decoration-1" : info.text}`}>{stat.value}</span>
                        )}
                      </span>
                    </button>
                  );
                })}
              </div>
              <p className="mt-3 text-[10px] tracking-wide text-dim">1–0 to pick · T new club · Y same club, new player · M mute</p>
            </>
          ) : profile ? (
            <div className="mt-4 border border-line bg-night/50 p-4">
              {!club || spin?.kind === "club" ? (
                <div className="text-center">
                  <p className="font-pixel text-[10px] tracking-[0.3em] text-haze">THE LAST ROLL</p>
                  <p className={`mt-3 min-h-12 font-digits text-5xl uppercase ${spin?.kind === "club" ? "animate-ticker text-flood" : "text-dim"}`}>
                    {spin?.kind === "club" ? spin.title : "which club signs you?"}
                  </p>
                  <button type="button" onClick={rollClub} disabled={spinning} className="glow-flood mt-4 w-full bg-turf py-3 font-pixel text-sm tracking-[0.3em] hover:bg-stand disabled:opacity-40">
                    ▶ ROLL YOUR CLUB ◀
                  </button>
                </div>
              ) : (
                <div key={`club-${rollCount}`} className="animate-card-pop text-center">
                  <p className="font-pixel text-[10px] tracking-[0.3em] text-haze">YOU SIGN FOR</p>
                  <p className="title-split mt-2 font-pixel text-3xl tracking-[0.08em] text-chalk">{club.name.toUpperCase()}</p>
                  <p className="mx-auto mt-3 max-w-md text-xs leading-relaxed text-haze">
                    attack {profile.attack.toFixed(1)} · defence {profile.defense.toFixed(1)}.
                    {replaced ? ` ${replaced.name} (${replaced.overall}) is dropped to make room.` : ""}
                  </p>
                  <button type="button" onClick={playSeason} className="glow-flood mt-4 w-full bg-turf py-3 font-pixel text-sm tracking-[0.3em] hover:bg-stand">
                    ▶ PLAY 38 MATCHWEEKS ◀
                  </button>
                </div>
              )}
            </div>
          ) : null}
        </section>

        <section className="pixel-frame bg-turf p-3">
          <div className="flex items-end justify-between border-b border-line px-1 pb-3">
            <div>
              <p className="font-pixel text-[11px] tracking-[0.3em] text-haze">YOUR BUILD</p>
              <p className="mt-1 text-[10px] text-dim">{taken} / 10 attributes</p>
            </div>
            <div className="text-right">
              <p className={`font-digits text-6xl leading-none ${taken ? tier(rating).text : "text-line"}`}>{taken ? rating : "--"}</p>
              <p className={`font-pixel text-[9px] tracking-widest ${taken ? tier(rating).text : "text-dim"}`}>{taken ? tier(rating).label.toUpperCase() : "UNBUILT"}</p>
            </div>
          </div>
          <div className="mt-2 grid grid-cols-2 gap-1.5 lg:grid-cols-1">
            {BUILD_STATS.map((definition) => {
              const slot = locked[definition.key];
              return (
                <div key={definition.key} className={`flex items-center justify-between gap-2 border px-2.5 py-1.5 ${slot ? "animate-slot-fill border-line bg-stand" : "border-dashed border-line/70"}`}>
                  <div className="min-w-0">
                    <p className={`font-pixel text-[10px] tracking-[0.15em] ${slot ? "text-chalk" : "text-dim"}`}>{definition.label.toUpperCase()}</p>
                    <p className="truncate text-[10px] text-dim">{slot ? slot.playerName : "open"}</p>
                  </div>
                  <p className={`font-digits text-3xl leading-none ${slot ? tier(slot.value).text : "text-line"}`}>{slot ? slot.value : "--"}</p>
                </div>
              );
            })}
          </div>
          <div className="mt-3 flex gap-1" aria-hidden="true">
            {TIERS.map((item) => (
              <span key={item.label} className="flex flex-1 flex-col items-center gap-1">
                <span className={`h-1 w-full ${item.bg}`} />
                <span className="text-[8px] text-dim">{item.min ? `${item.min}+` : "<70"}</span>
              </span>
            ))}
          </div>
        </section>
      </div>
      <footer className="mx-auto max-w-[1260px] px-4 pb-6 text-[10px] text-dim">
        ratings: EA SPORTS FC via ea.com · minutes &amp; goals: premierleague.com {data.season} · a fan project, not affiliated with either
      </footer>
    </div>
  );
}
