"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import Image from "next/image";
import Link from "next/link";
import { BookOpen, RotateCcw, Volume2, VolumeX } from "lucide-react";
import {
  ACTIVE_QUESTS,
  questById,
  questProgress,
  rerollText,
  rewardText,
  seasonBonus,
  shuffledQuestIds,
  type ActiveQuest,
  type DoneQuest,
  type PickRecord,
  type Reward,
} from "@/lib/quests";
import { BUILD_STATS, buildRating, clubWithUser, strengthFrom, type ClubRating, type GameData, type RollPlayer, type RollStat } from "@/lib/ratings";
import { muteStore, sfx } from "@/lib/sfx";
import { mulberry32, simulateSeason, tableAt, type MatchResult } from "@/lib/simulate";

const PLAYER_REROLLS = 8;
const TEAM_REROLLS = 6;
const TICK_MS = 70;
const WEEK_MS = 150;
const NO_REWARD: Reward = { team: 0, player: 0 };

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

const SHORT_LABEL: Record<string, string> = {
  pac: "PAC",
  sho: "SHO",
  pas: "PAS",
  dri: "DRI",
  def: "DEF",
  phy: "PHY",
  finishing: "FIN",
  vision: "VIS",
  reactions: "REA",
  headingAccuracy: "HEA",
};

type Spin = { kind: "team" | "player" | "club"; title: string; subtitle: string };
type Phase = "intro" | "build" | "season";
type QuestState = { active: ActiveQuest[]; queue: string[]; done: DoneQuest[] };
type Toast = { id: number; title: string; reward: Reward; banked: boolean };
type RunRecord = { place: number; clubName: string; rating: number };

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

function freshQuests(random: () => number): QuestState {
  const ids = shuffledQuestIds(random);
  return { active: ids.slice(0, ACTIVE_QUESTS).map((id) => ({ id, since: 0 })), queue: ids.slice(ACTIVE_QUESTS), done: [] };
}

function addReward(a: Reward, b: Reward): Reward {
  return { team: a.team + b.team, player: a.player + b.player };
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
  if (place === 1) return { title: "Champions!", line: "stitched together from ten blokes, and it won the league.", sound: "champion" as const, color: "text-red" };
  if (place <= 4) return { title: "Champions League", line: "not bad for a lad made of spare parts.", sound: "europe" as const, color: "text-sky" };
  if (place <= 7) return { title: "Into Europe", line: "thursday nights it is. pack a coat.", sound: "europe" as const, color: "text-pitch" };
  if (place <= 17) return { title: "Mid-table", line: "nobody is writing songs about this one.", sound: "midtable" as const, color: "text-ink" };
  return { title: "Relegated", line: "the stitches didn't hold.", sound: "relegated" as const, color: "text-red" };
}

function Portrait({ url, name, sizes = "280px" }: { url: string | null; name: string; sizes?: string }) {
  const [failed, setFailed] = useState(false);
  if (!url || failed) {
    const initials = name
      .split(" ")
      .map((part) => part[0])
      .slice(0, 2)
      .join("");
    return <p className="absolute inset-0 grid place-items-center font-display text-5xl text-sheet/70 lg:text-7xl">{initials}</p>;
  }
  return <Image src={url} alt={name} fill unoptimized loading="eager" sizes={sizes} className="object-contain object-bottom" onError={() => setFailed(true)} />;
}

function Key({ children, className = "inline-grid" }: { children: React.ReactNode; className?: string }) {
  return <span className={`h-5 min-w-5 place-items-center border border-ink/40 bg-sheet px-1 font-type text-[11px] leading-none text-ink-soft ${className}`}>{children}</span>;
}

function IconButton({ label, onClick, href, children }: { label: string; onClick?: () => void; href?: string; children: React.ReactNode }) {
  const className = "sticker-sm press grid size-8 shrink-0 place-items-center text-ink sm:size-9";
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

function RewardChip({ reward, muted = false }: { reward: Reward; muted?: boolean }) {
  return <span className={`shrink-0 px-1 font-type text-[11px] font-bold ${muted ? "text-ink-faint" : "marker text-ink"}`}>{rewardText(reward)}</span>;
}

const BANDS = [
  { clip: "inset(0 0 56% 0)", shift: "translateX(-4%) rotate(-1.5deg)", label: "the eyes of" },
  { clip: "inset(44% 0 33% 0)", shift: "translateX(3.5%) rotate(1deg)", label: "the smile of" },
  { clip: "inset(67% 0 0 0)", shift: "translateX(-2%)", label: "the shoulders of" },
];

/** Three real portraits cut into bands and sewn back together: the game's whole premise in one picture. */
function StitchedHero({ parts }: { parts: RollPlayer[] }) {
  return (
    <div className="relative mx-auto w-full max-w-[380px]">
      <div className="sticker tape animate-wobble relative aspect-[4/4.6] overflow-hidden">
        <div className="halftone absolute inset-0" />
        {parts.map((player, index) => (
          <div key={player.id} className="absolute inset-0" style={{ clipPath: BANDS[index].clip, transform: BANDS[index].shift }}>
            <Portrait url={player.avatarUrl} name={player.name} sizes="380px" />
          </div>
        ))}
        <div className="seam absolute inset-x-0 top-[44%] -translate-y-1/2" />
        <div className="seam absolute inset-x-0 top-[67%] -translate-y-1/2" />
        <p className="absolute bottom-2 left-2 bg-ink px-2 py-0.5 font-type text-[11px] text-sheet">specimen no. 27</p>
      </div>
      <ul className="mt-4 grid grid-cols-3 gap-2 font-type text-[11px] leading-tight text-ink-soft">
        {parts.map((player, index) => (
          <li key={player.id} className="border-t-2 border-dashed border-red pt-1.5">
            {BANDS[index].label}
            <span className="block font-body text-xs font-bold text-ink">{player.name}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function StatSource({ stat }: { stat: RollStat }) {
  if (stat.form === null) return <>EA {stat.ea} · no season data</>;
  return (
    <>
      EA {stat.ea} · form {stat.form}
    </>
  );
}

function FormChip({ delta }: { delta: number }) {
  if (delta > 0) return <span className="bg-pitch px-1.5 py-0.5 font-type text-[11px] font-bold text-sheet">IN FORM +{delta}</span>;
  if (delta < 0) return <span className="bg-red px-1.5 py-0.5 font-type text-[11px] font-bold text-sheet">OFF FORM −{Math.abs(delta)}</span>;
  return <span className="bg-ink px-1.5 py-0.5 font-type text-[11px] font-bold text-sheet">AS RATED</span>;
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
  const [locked, setLocked] = useState<Record<string, PickRecord>>({});
  const [lastPick, setLastPick] = useState<PickRecord | null>(null);
  const [playerRerolls, setPlayerRerolls] = useState(PLAYER_REROLLS);
  const [teamRerolls, setTeamRerolls] = useState(TEAM_REROLLS);
  const [quests, setQuests] = useState<QuestState>(() => freshQuests(mulberry32(seed ^ 0x5eed)));
  const [lastRerollAt, setLastRerollAt] = useState(0);
  const [toast, setToast] = useState<Toast | null>(null);
  const [bank, setBank] = useState<Reward>(NO_REWARD);
  const [club, setClub] = useState<ClubRating | null>(null);
  const [season, setSeason] = useState<{ matches: MatchResult[] } | null>(null);
  const [week, setWeek] = useState(0);
  const [seasonNote, setSeasonNote] = useState<{ reward: Reward; fresh: boolean } | null>(null);
  const [runs, setRuns] = useState<RunRecord[]>([]);
  const [denied, setDenied] = useState(0);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const weekTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const bonusPaid = useRef(false);
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
  const lockedStats = Object.values(locked);
  const rating = buildRating(lockedStats);
  const profile = complete ? strengthFrom(lockedStats) : null;

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

  function stopTimers() {
    if (timer.current) clearInterval(timer.current);
    timer.current = null;
    if (weekTimer.current) clearInterval(weekTimer.current);
    weekTimer.current = null;
  }

  function startRun() {
    stopTimers();
    setSpin(null);
    setLocked({});
    setLastPick(null);
    setTeamRerolls(TEAM_REROLLS + bank.team);
    setPlayerRerolls(PLAYER_REROLLS + bank.player);
    setBank(NO_REWARD);
    setQuests(freshQuests(mulberry32(newSeed())));
    setLastRerollAt(0);
    setToast(null);
    setClub(null);
    setSeason(null);
    setSeasonNote(null);
    setWeek(0);
    bonusPaid.current = false;
    setPhase("build");
    rollFreshTeam();
  }

  function kickOff() {
    sfx().play("kickoff");
    if (taken > 0 || season) {
      setPhase(season ? "season" : "build");
      return;
    }
    setPhase("build");
    rollFreshTeam();
  }

  function settleQuests(picks: PickRecord[], buildDone: boolean) {
    const finished = quests.active.filter((quest) => questProgress(quest, picks, lastRerollAt) >= questById(quest.id).target);
    if (!finished.length) return false;
    const reward = finished.reduce((sum, quest) => addReward(sum, questById(quest.id).reward), NO_REWARD);
    if (buildDone) setBank((current) => addReward(current, reward));
    else {
      setTeamRerolls((count) => count + reward.team);
      setPlayerRerolls((count) => count + reward.player);
    }
    const queue = [...quests.queue];
    const active = quests.active.map((quest) => (finished.includes(quest) ? (queue.length ? { id: queue.shift()!, since: picks.length } : null) : quest)).filter((quest): quest is ActiveQuest => quest !== null);
    setQuests({ active, queue, done: [...quests.done, ...finished.map((quest) => ({ id: quest.id, at: picks.length, banked: buildDone }))] });
    setToast({ id: quests.done.length + picks.length * 100, title: finished.map((quest) => questById(quest.id).title).join(" + "), reward, banked: buildDone });
    setTimeout(() => sfx().play("quest"), 220);
    return true;
  }

  function choose(stat: RollStat) {
    if (phase !== "build" || spinning || complete) return;
    if (locked[stat.key]) return deny();
    const entry: PickRecord = {
      ...stat,
      order: taken,
      playerId: rolled.id,
      playerName: rolled.name,
      teamId: rolled.teamId,
      teamName: rolled.teamName,
      role: rolled.role,
      position: rolled.position,
      overall: rolled.overall,
      goals: rolled.goals,
      assists: rolled.assists,
    };
    const next = { ...locked, [stat.key]: entry };
    const picks = Object.values(next);
    setLocked(next);
    setLastPick(entry);
    sfx().play(stat.value >= 90 ? "pick-world" : stat.value >= 85 ? "pick-elite" : "pick");
    const questDone = settleQuests(picks, picks.length === 10);
    if (picks.length < 10) setTimeout(() => rollFreshTeam(), questDone ? 650 : 260);
  }

  function rerollPlayer() {
    if (phase !== "build" || spinning || complete) return;
    if (playerRerolls <= 0 || clubPool.length < 2) return deny();
    setPlayerRerolls((count) => count - 1);
    setLastRerollAt(taken);
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
    setLastRerollAt(taken);
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

  function finishSeason(matches: MatchResult[], signed: ClubRating) {
    if (weekTimer.current) clearInterval(weekTimer.current);
    weekTimer.current = null;
    setWeek(38);
    const place = tableAt(data.clubs, matches, 38).findIndex((row) => row.id === signed.id) + 1;
    sfx().play(verdict(place).sound);
    setRuns((list) => [...list, { place, clubName: signed.name, rating }]);
    if (bonusPaid.current) {
      setSeasonNote({ reward: NO_REWARD, fresh: false });
      return;
    }
    bonusPaid.current = true;
    const reward = seasonBonus(place);
    setBank((current) => addReward(current, reward));
    setSeasonNote({ reward, fresh: true });
  }

  function playSeason() {
    if (!club || !profile) return;
    const signed = club;
    const result = simulateSeason({
      clubs: data.clubs,
      userClubId: signed.id,
      userAttack: profile.attack,
      userDefense: profile.defense,
      goalsPerTeamGame: data.goalsPerTeamGame,
      seed: newSeed(),
    });
    stopTimers();
    setSeason({ matches: result.matches });
    setSeasonNote(null);
    setPhase("season");
    setWeek(0);
    sfx().play("kickoff");
    let current = 0;
    weekTimer.current = setInterval(() => {
      current += 1;
      if (current >= 38) return finishSeason(result.matches, signed);
      setWeek(current);
      const match = result.matches.find((item) => item.week === current && (item.home === signed.id || item.away === signed.id));
      if (match) {
        const home = match.home === signed.id;
        const diff = (home ? match.homeGoals : match.awayGoals) - (home ? match.awayGoals : match.homeGoals);
        sfx().play(diff > 0 ? "win" : diff < 0 ? "loss" : "draw");
      }
    }, WEEK_MS);
  }

  function tryAnotherClub() {
    stopTimers();
    setClub(null);
    setSeason(null);
    setSeasonNote(null);
    setWeek(0);
    setPhase("build");
    rollClub();
  }

  function afterSeason(choice: string) {
    if (choice === "N") startRun();
    else if (choice === "R") playSeason();
    else if (choice === "C") tryAnotherClub();
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
      if (phase === "season" && week >= 38) return afterSeason(key.toUpperCase());
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

  const lineup = club && profile ? clubWithUser(club, profile) : null;
  const replaced = lineup?.replacedId ? playerById.get(lineup.replacedId) : undefined;
  const rollSpin = spin && spin.kind !== "club" ? spin : null;
  const bestRun = runs.reduce<RunRecord | null>((best, run) => (!best || run.place < best.place ? run : best), null);
  const hasBank = bank.team > 0 || bank.player > 0;

  const heroParts = useMemo(() => {
    const random = mulberry32(seed ^ 0xface);
    const stars = data.players.filter((player) => player.avatarUrl && player.eaOverall >= 83);
    const chosen: RollPlayer[] = [];
    while (chosen.length < 3 && stars.length > chosen.length) {
      const next = pick(stars, random);
      if (!chosen.includes(next)) chosen.push(next);
    }
    return chosen;
  }, [data.players, seed]);

  const header = (
    <header className="sticky top-0 z-30 border-b-2 border-ink bg-sheet">
      <div className="mx-auto flex max-w-[1320px] items-center justify-between gap-2 px-3 py-2 sm:gap-3 sm:px-5 2xl:max-w-[1560px]">
        <button type="button" onClick={() => setPhase("intro")} className="shrink-0 font-display text-xl leading-none tracking-wide text-ink uppercase sm:text-2xl" aria-label="Frankenballer, back to the cover">
          Franken<span className="text-red">baller</span>
        </button>
        {phase === "build" ? (
          <div className="min-w-0 text-center">
            <p className="font-type text-[11px] font-bold whitespace-nowrap text-ink sm:text-xs">{complete ? "all ten stitched" : `pick ${round} of 10`}</p>
            <div className="mt-1 flex justify-center gap-[3px]">
              {Array.from({ length: 10 }, (_, index) => (
                <span key={index} className={`h-1 w-2 sm:w-3.5 ${index < taken ? "bg-red" : index === taken && !complete ? "animate-blink bg-ink" : "bg-rule"}`} />
              ))}
            </div>
          </div>
        ) : (
          <p className="hidden font-type text-xs text-ink-soft md:block">a premier league build game · {data.season}</p>
        )}
        <div className="flex shrink-0 items-center gap-1.5 sm:gap-2">
          <IconButton label={muted ? "Sound off (M)" : "Sound on (M)"} onClick={() => muteStore.toggle()}>
            {muted ? <VolumeX className="size-4" /> : <Volume2 className="size-4" />}
          </IconButton>
          {phase !== "intro" ? (
            <IconButton label="Start a new run" onClick={startRun}>
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

  const toastNode = toast ? (
    <div key={toast.id} className="animate-stamp pointer-events-none fixed top-16 left-1/2 z-40 w-[min(88vw,360px)] border-4 border-red bg-sheet/95 px-4 py-2.5 text-center text-red shadow-[4px_4px_0_rgba(27,24,19,0.25)]">
      <p className="font-display text-2xl leading-none tracking-wide uppercase">Quest done</p>
      <p className="mt-1 font-type text-sm font-bold">{toast.title.toLowerCase()}</p>
      <p className="font-type text-xs text-ink">
        {rerollText(toast.reward)}
        {toast.banked ? ", banked for next run" : ""}
      </p>
    </div>
  ) : null;

  if (phase === "intro") {
    return (
      <div className="newsprint flex min-h-screen flex-col font-body text-ink">
        {header}
        <main className="mx-auto grid w-full max-w-[1180px] flex-1 items-center gap-10 px-5 py-8 sm:py-12 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)] lg:gap-16">
          <div>
            <p className="font-type text-sm text-ink-soft">
              issue {data.season} · <span className="marker px-0.5 text-ink">one player, ten donors</span>
            </p>
            <h1 className="mt-3 font-display text-[22vw] leading-[0.84] tracking-tight uppercase sm:text-[9rem] lg:text-[10.5rem]">
              Franken
              <br />
              <span className="text-red">baller</span>
            </h1>
            <div className="seam mt-5 max-w-md" />
            <p className="mt-5 max-w-lg text-lg leading-snug text-ink-soft">
              Roll a real Premier League player. Steal <strong className="text-ink">one</strong> of his attributes. Do it ten times, sew the bits together, and see if the monster can win the league.
            </p>
            <div className="mt-7 lg:hidden">
              <StitchedHero parts={heroParts} />
            </div>
            <button type="button" onClick={kickOff} className="sticker press mt-8 flex w-full max-w-md items-center justify-between bg-red px-6 py-4 text-left text-sheet">
              <span className="font-display text-3xl tracking-wide uppercase">{taken > 0 || season ? "Back to it" : "Kick off"}</span>
              <span className="font-type text-sm">press enter ↵</span>
            </button>
            <ol className="mt-8 max-w-lg space-y-2.5 font-type text-[13px] leading-snug text-ink-soft">
              <li>
                <span className="font-bold text-red">01</span> each round draws a club, then one of its players. take one of his ten stats.
              </li>
              <li>
                <span className="font-bold text-red">02</span> stats are his EA SPORTS FC rating blended with how he is <em>actually</em> playing this season. bad form drags him down.
              </li>
              <li>
                <span className="font-bold text-red">03</span> reroll the team for a new club, or the player to stay at the same one. quests pay out extra rerolls.
              </li>
              <li>
                <span className="font-bold text-red">04</span> then a random club signs you, and we play all 38 matchweeks.
              </li>
            </ol>
          </div>
          <div className="hidden lg:block">
            <StitchedHero parts={heroParts} />
          </div>
        </main>
        <footer className="border-t-2 border-ink bg-sheet px-4 py-3 text-center font-type text-[11px] text-ink-soft">
          ratings: EA SPORTS FC via ea.com · form: premierleague.com and fantasy premier league · {data.firstTeam} first-teamers and {data.bench} squad players with 270+ minutes · a fan project, not affiliated with any of them
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
    const record = shown.reduce(
      (sum, match) => {
        const home = match.home === club.id;
        const diff = (home ? match.homeGoals : match.awayGoals) - (home ? match.awayGoals : match.homeGoals);
        return diff > 0 ? { ...sum, w: sum.w + 1 } : diff < 0 ? { ...sum, l: sum.l + 1 } : { ...sum, d: sum.d + 1 };
      },
      { w: 0, d: 0, l: 0 },
    );
    const options = [
      { key: "N", title: "New run", detail: `fresh monster · ${TEAM_REROLLS + bank.team} team / ${PLAYER_REROLLS + bank.player} player rerolls`, tone: "bg-red text-sheet" },
      { key: "R", title: "Run it back", detail: "same player, same club, new season", tone: "bg-sheet text-ink" },
      { key: "C", title: "New club", detail: "same player, roll another club", tone: "bg-sheet text-ink" },
    ];
    return (
      <div className="newsprint min-h-screen font-body text-ink">
        {header}
        <div className="mx-auto grid max-w-[1320px] gap-5 px-3 py-4 sm:px-5 sm:py-6 lg:grid-cols-[minmax(0,1fr)_400px] 2xl:max-w-[1560px]">
          <div className="flex min-w-0 flex-col gap-5">
            <section className="sticker p-4 sm:p-6">
              <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b-2 border-ink pb-2 font-type text-xs">
                <span className="font-bold uppercase">the frankenballer gazette · {club.name}</span>
                <span className="text-ink-soft">
                  build {rating} · attack {profile?.attack.toFixed(1)} · defence {profile?.defense.toFixed(1)}
                </span>
              </div>
              <div className="mt-4 flex flex-wrap items-end justify-between gap-4">
                <div>
                  <p className="font-type text-sm text-ink-soft">{done ? "full time. final position:" : `matchweek ${week} of 38`}</p>
                  <p className={`font-display text-8xl leading-[0.9] uppercase sm:text-9xl ${done ? end.color : "text-ink"}`}>{place ? ordinal(place) : "—"}</p>
                  <p className="mt-1 font-type text-sm font-bold">
                    <span className="text-pitch">{record.w}W</span> · <span className="text-ink-soft">{record.d}D</span> · <span className="text-red">{record.l}L</span> · {table[place - 1]?.points ?? 0} pts
                  </p>
                </div>
                {!done ? (
                  <div className="flex flex-col items-end gap-2">
                    {latest ? (
                      <p key={latest.week} className="animate-tile-in font-display text-4xl uppercase">
                        {shortName.get(latest.home)} {latest.homeGoals}–{latest.awayGoals} {shortName.get(latest.away)}
                      </p>
                    ) : null}
                    <button type="button" onClick={() => finishSeason(season.matches, club)} className="sticker-sm press px-3 py-1.5 font-type text-sm font-bold">
                      skip to full time ▸▸
                    </button>
                  </div>
                ) : null}
              </div>
              {done ? (
                <div className="animate-card-pop mt-4">
                  <p className={`font-display text-5xl leading-none uppercase sm:text-6xl ${end.color}`}>{end.title}</p>
                  <p className="mt-2 font-type text-base text-ink-soft">“{end.line}”</p>
                </div>
              ) : null}
              <div className="mt-5 grid grid-cols-[repeat(19,minmax(0,1fr))] gap-[3px]" aria-label="Form">
                {mine.map((match) => {
                  const home = match.home === club.id;
                  const diff = (home ? match.homeGoals : match.awayGoals) - (home ? match.awayGoals : match.homeGoals);
                  const played = match.week <= week;
                  return (
                    <span
                      key={match.week}
                      title={`MW${match.week} ${home ? "vs" : "at"} ${shortName.get(home ? match.away : match.home)} ${match.homeGoals}–${match.awayGoals}`}
                      className={`grid aspect-square place-items-center border border-ink/70 font-type text-[9px] font-bold sm:text-[10px] ${!played ? "border-dashed border-rule bg-transparent text-transparent" : diff > 0 ? "bg-pitch text-sheet" : diff < 0 ? "bg-red text-sheet" : "bg-marker text-ink"}`}
                    >
                      {played ? (diff > 0 ? "W" : diff < 0 ? "L" : "D") : ""}
                    </span>
                  );
                })}
              </div>
            </section>

            {done ? (
              <section className="animate-card-pop sticker relative p-4 sm:p-5">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <p className="font-display text-3xl tracking-wide uppercase">What now?</p>
                  <p className="font-type text-xs text-ink-soft">
                    season {runs.length} this session{bestRun ? ` · best: ${ordinal(bestRun.place)} with ${bestRun.clubName}` : ""}
                  </p>
                </div>
                <div className="mt-3 grid gap-3 sm:grid-cols-3">
                  {options.map((option) => (
                    <button key={option.key} type="button" onClick={() => afterSeason(option.key)} className={`sticker press flex items-center justify-between gap-3 px-4 py-3 text-left sm:flex-col sm:items-start ${option.tone}`}>
                      <span>
                        <span className="block font-display text-2xl leading-none tracking-wide uppercase">{option.title}</span>
                        <span className="mt-1.5 block font-type text-xs opacity-80">{option.detail}</span>
                      </span>
                      <Key className="hidden sm:inline-grid">{option.key}</Key>
                    </button>
                  ))}
                </div>
                <p className="mt-4 font-type text-xs text-ink-soft">
                  {seasonNote?.fresh ? (
                    seasonNote.reward.team + seasonNote.reward.player > 0 ? (
                      <>
                        season bonus banked for your next run: <span className="marker px-0.5 font-bold text-ink">{rerollText(seasonNote.reward)}</span>.
                      </>
                    ) : (
                      "no season bonus this time. finish top seven to bank extra rerolls."
                    )
                  ) : (
                    "this build already paid its season bonus. a new run can earn another."
                  )}
                  {hasBank ? <span> total banked: {rewardText(bank)}.</span> : null}
                </p>
              </section>
            ) : null}

            <section className="sticker p-4 sm:p-5">
              <p className="font-display text-xl tracking-wide uppercase">Results</p>
              <div className="mt-2 grid max-h-64 gap-x-6 overflow-y-auto pr-1 font-type text-sm sm:grid-cols-2 lg:max-h-[19rem]">
                {[...shown].reverse().map((match) => {
                  const home = match.home === club.id;
                  const diff = (home ? match.homeGoals : match.awayGoals) - (home ? match.awayGoals : match.homeGoals);
                  return (
                    <p key={match.week} className="flex items-center justify-between border-b border-dashed border-rule py-1">
                      <span className="w-12 text-ink-faint">mw{match.week}</span>
                      <span className="flex-1">
                        {home ? "vs" : "at"} {shortName.get(home ? match.away : match.home)}
                      </span>
                      <span className={`font-bold ${diff > 0 ? "text-pitch" : diff < 0 ? "text-red" : "text-ink-soft"}`}>
                        {match.homeGoals}–{match.awayGoals}
                      </span>
                    </p>
                  );
                })}
                {!shown.length ? <p className="text-ink-faint">kick-off…</p> : null}
              </div>
              <p className="mt-4 max-w-2xl font-type text-[11px] leading-relaxed text-ink-faint">
                how it works: each club is rated from the blended ratings of its {data.coreSize} most-used outfielders, and you replace the weakest of {club.name}&apos;s. attack is pace, shooting, passing, dribbling, finishing and vision. defence is defending, physical, reactions and heading. a match turns those into expected goals around {data.goalsPerTeamGame.toFixed(2)} a side (this season&apos;s real scoring rate), home sides get a 10% bump, and the score is drawn at random. a simulation, not a prediction.
              </p>
            </section>
          </div>

          <section className="sticker self-start p-3 sm:p-4 lg:sticky lg:top-20">
            <p className="border-b-2 border-ink pb-1.5 font-display text-xl tracking-wide uppercase">The table</p>
            <table className="mt-1 w-full table-fixed font-type text-[13px]">
              <thead className="text-ink-faint">
                <tr>
                  <th className="w-7 py-1 text-left font-normal" />
                  <th className="py-1 text-left font-normal">club</th>
                  <th className="w-8 py-1 text-right font-normal">p</th>
                  <th className="w-11 py-1 text-right font-normal">gd</th>
                  <th className="w-11 py-1 text-right font-normal">pts</th>
                </tr>
              </thead>
              <tbody>
                {table.map((row, index) => {
                  const yours = row.id === club.id;
                  const diff = row.goalsFor - row.goalsAgainst;
                  const zone = index === 3 ? "border-b-2 border-b-ink" : index === 16 ? "border-b-2 border-b-red" : "border-b border-b-rule/70";
                  return (
                    <tr key={row.id} className={`${zone} ${yours ? "marker font-bold text-ink" : "text-ink-soft"}`}>
                      <td className="py-1 font-display text-base text-ink">{index + 1}</td>
                      <td className="truncate py-1">
                        <span className="sm:hidden">{row.abbr || row.name}</span>
                        <span className="hidden sm:inline">{row.name}</span>
                      </td>
                      <td className="py-1 text-right tabular-nums">{row.played}</td>
                      <td className="py-1 text-right tabular-nums">{diff > 0 ? `+${diff}` : diff}</td>
                      <td className="py-1 text-right font-display text-lg leading-none text-ink">{row.points}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <p className="mt-2 font-type text-[11px] text-ink-faint">top four above the black line · bottom three below the red one</p>
          </section>
        </div>
      </div>
    );
  }

  const rerollButtons = (compact: boolean) => (
    <>
      <button
        type="button"
        onClick={rerollTeam}
        disabled={spinning || teamRerolls <= 0}
        className={`press flex items-center justify-center gap-2 border-2 border-ink bg-ink text-sheet disabled:opacity-35 ${compact ? "flex-1 px-2 py-2" : "px-3.5 py-2 shadow-[3px_3px_0_var(--color-red)]"}`}
        title="New club and a new player from it"
      >
        <span className="font-display text-base tracking-wide uppercase sm:text-lg">{compact ? "New club" : "Reroll team"}</span>
        <span className="bg-sheet px-1.5 font-type text-sm font-bold text-ink">{teamRerolls}</span>
        {compact ? null : <span className="inline-grid h-5 min-w-5 place-items-center border border-sheet/40 px-1 font-type text-[11px] leading-none text-sheet/70">T</span>}
      </button>
      <button
        type="button"
        onClick={rerollPlayer}
        disabled={spinning || playerRerolls <= 0 || clubPool.length < 2}
        className={`press flex items-center justify-center gap-2 border-2 border-ink bg-sheet text-ink disabled:opacity-35 ${compact ? "flex-1 px-2 py-2" : "px-3.5 py-2 shadow-[3px_3px_0_var(--color-sky)]"}`}
        title={`Another ${rolled.teamName} player`}
      >
        <span className="font-display text-base tracking-wide uppercase sm:text-lg">{compact ? "New player" : "Reroll player"}</span>
        <span className="bg-sky px-1.5 font-type text-sm font-bold text-sheet">{playerRerolls}</span>
        {compact ? null : <Key>Y</Key>}
      </button>
    </>
  );

  const latestDone = quests.done[quests.done.length - 1];

  return (
    <div className="newsprint min-h-screen pb-24 font-body text-ink lg:pb-0">
      {header}
      {toastNode}

      <div className="mx-auto grid max-w-[1320px] gap-5 px-3 py-4 sm:px-5 lg:grid-cols-[300px_minmax(0,1fr)_290px] lg:py-6 xl:grid-cols-[320px_minmax(0,1fr)_310px] 2xl:max-w-[1560px] 2xl:grid-cols-[360px_minmax(0,1fr)_340px]">
        <div className="contents lg:flex lg:flex-col lg:gap-5">
          <section className="sticker order-1 lg:order-none">
            <div key={rollSpin ? "spin" : `card-${rollCount}`} className={`flex gap-3 p-3 lg:block lg:p-0 ${rollSpin ? "" : "animate-card-pop"}`}>
              <div className="halftone relative size-28 shrink-0 overflow-hidden border-2 border-ink sm:size-36 lg:aspect-[4/3.6] lg:size-auto lg:border-0 lg:border-b-2">
                {rollSpin ? (
                  <div className="absolute inset-0 grid place-items-center">
                    <p className="animate-roll-glow font-display text-6xl text-sheet lg:text-8xl">?</p>
                  </div>
                ) : (
                  <>
                    <Portrait key={rolled.id} url={rolled.avatarUrl} name={rolled.name} />
                    <div className="absolute top-2.5 right-2.5 hidden size-[74px] rotate-6 flex-col items-center justify-center rounded-full border-[3px] border-sheet bg-red text-sheet shadow-[2px_2px_0_var(--color-ink)] lg:flex">
                      <span className="font-display text-3xl leading-none">{rolled.overall}</span>
                      <span className="font-type text-[10px] font-bold">{rolled.eaPosition}</span>
                    </div>
                    <span className={`absolute top-2 left-2 px-1.5 py-0.5 font-type text-[10px] font-bold uppercase lg:text-[11px] ${rolled.role === "First team" ? "bg-marker text-ink" : "bg-sheet text-ink"}`}>{rolled.role}</span>
                  </>
                )}
              </div>
              <div className="min-w-0 flex-1 self-center lg:px-4 lg:pt-3 lg:pb-4">
                <h1 className={`font-display text-3xl leading-[0.95] tracking-wide uppercase sm:text-4xl ${rollSpin ? "animate-ticker text-red" : "text-ink"}`}>{rollSpin ? rollSpin.title : rolled.name}</h1>
                <p className="mt-1 truncate font-type text-sm font-bold text-red">{rollSpin ? rollSpin.subtitle : rolled.teamName}</p>
                {!rollSpin ? (
                  <>
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      <span className="font-display text-2xl leading-none lg:hidden">
                        {rolled.overall} <span className="font-type text-xs font-bold text-ink-soft">{rolled.eaPosition}</span>
                      </span>
                      <FormChip delta={rolled.formDelta} />
                    </div>
                    <p className="mt-2 font-type text-xs text-ink-soft">
                      {rolled.appearances} apps · {rolled.minutes} mins · {rolled.goals}g {rolled.assists}a · EA {rolled.eaOverall}
                    </p>
                  </>
                ) : null}
              </div>
            </div>
          </section>

          <section className="sticker lined order-3 p-4 lg:order-none">
            <div className="flex items-baseline justify-between gap-2">
              <p className="font-display text-2xl tracking-wide uppercase">Quests</p>
              <p className="font-type text-[11px] text-ink-soft">{quests.done.length} done · paid in rerolls</p>
            </div>
            <ul className="mt-2 grid gap-2 sm:grid-cols-3 lg:grid-cols-1">
              {quests.active.map((active) => {
                const quest = questById(active.id);
                const progress = complete ? 0 : questProgress(active, lockedStats, lastRerollAt);
                return (
                  <li key={`${active.id}-${active.since}`} className={`border-2 border-ink bg-sheet px-3 py-2 ${complete ? "opacity-45" : "animate-tile-in"}`}>
                    <div className="flex items-start justify-between gap-2">
                      <p className="font-body text-sm font-bold leading-tight">{quest.title}</p>
                      <RewardChip reward={quest.reward} muted={complete} />
                    </div>
                    <p className="mt-0.5 font-type text-xs leading-snug text-ink-soft">{quest.detail.toLowerCase()}</p>
                    <div className="mt-1.5 flex items-center gap-1">
                      {Array.from({ length: quest.target }, (_, index) => (
                        <span key={index} className={`grid size-4 place-items-center border-2 border-ink text-[10px] leading-none font-bold ${index < progress ? "bg-red text-sheet" : "bg-sheet"}`}>
                          {index < progress ? "✕" : ""}
                        </span>
                      ))}
                    </div>
                  </li>
                );
              })}
            </ul>
            {quests.done.length ? (
              <ul className="mt-2 space-y-0.5 font-type text-xs">
                {quests.done.map((done) => (
                  <li key={done.id} className={`flex items-center justify-between gap-2 px-1 ${done === latestDone ? "animate-quest-done" : ""}`}>
                    <span className="text-ink-soft line-through decoration-red decoration-2">{questById(done.id).title.toLowerCase()}</span>
                    <span className="font-bold text-red">{done.banked ? "banked" : rewardText(questById(done.id).reward)}</span>
                  </li>
                ))}
              </ul>
            ) : null}
            <p className="mt-2 font-type text-[11px] text-ink-faint">
              {complete ? "build complete. quests closed for this run." : "the streak quest resets whenever you reroll."}
              {hasBank ? <span className="font-bold text-ink"> banked for next run: {rewardText(bank)}.</span> : null}
            </p>
          </section>
        </div>

        <section className="order-2 min-w-0 lg:order-none">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <p className="font-type text-sm text-ink-soft">{complete ? "the monster is finished." : rollSpin ? "the scouts are rummaging…" : lastPick ? `last stitch: ${lastPick.value} ${lastPick.label.toLowerCase()} from ${lastPick.playerName}` : ROUND_LINES[taken]}</p>
              <h2 className="font-display text-4xl leading-none tracking-wide uppercase sm:text-5xl">
                {complete ? (
                  "Sign for a club"
                ) : (
                  <>
                    Steal <span className="marker px-1">one</span> stat
                  </>
                )}
              </h2>
            </div>
            {!complete ? (
              <div key={denied} className={`hidden gap-3 lg:flex ${denied ? "animate-shake" : ""}`}>
                {rerollButtons(false)}
              </div>
            ) : null}
          </div>

          {!complete ? (
            <>
              <div className="mt-4 grid grid-cols-2 gap-2.5 sm:gap-3">
                {rolled.stats.map((stat, index) => {
                  const owned = locked[stat.key];
                  const info = tier(stat.value);
                  const delta = stat.value - stat.ea;
                  return (
                    <button
                      key={`${stat.key}-${rollCount}`}
                      type="button"
                      disabled={spinning}
                      onClick={() => choose(stat)}
                      style={{ animationDelay: `${index * 30}ms` }}
                      className={`relative min-w-0 overflow-hidden px-3 py-2.5 text-left ${spinning ? "sticker-sm" : "animate-tile-in"} ${owned ? "cursor-not-allowed border-2 border-dashed border-ink-faint bg-paper/60" : "sticker-sm press"}`}
                    >
                      <span className="flex items-start justify-between gap-2">
                        <span className="min-w-0">
                          <span className={`block truncate font-display text-lg leading-none tracking-wide uppercase sm:text-xl ${owned ? "text-ink-faint" : "text-ink"}`}>{stat.label}</span>
                          <span className="mt-1 hidden truncate font-type text-[11px] text-ink-soft sm:block">{stat.detail.toLowerCase()}</span>
                        </span>
                        <Key className="hidden lg:inline-grid">{index === 9 ? 0 : index + 1}</Key>
                      </span>
                      <span className="mt-1.5 flex items-end justify-between gap-1">
                        {owned || spinning ? (
                          <span />
                        ) : (
                          <span className="font-type text-[10px] leading-tight text-ink-faint sm:text-[11px]">
                            <span className={`block font-bold ${info.text}`}>{info.label.toLowerCase()}</span>
                            <span className="hidden sm:block">
                              <StatSource stat={stat} />
                            </span>
                            <span className="sm:hidden">{stat.form === null ? "EA only" : delta === 0 ? "as rated" : `${delta > 0 ? "+" : "−"}${Math.abs(delta)} form`}</span>
                          </span>
                        )}
                        {spinning ? (
                          <span className="animate-roll-glow font-display text-5xl leading-none text-ink-faint sm:text-6xl">??</span>
                        ) : (
                          <span className={`font-display text-5xl leading-none sm:text-6xl ${owned ? "text-ink-faint/60" : info.text}`}>{stat.value}</span>
                        )}
                      </span>
                      {owned && !spinning ? (
                        <span className="pointer-events-none absolute inset-0 grid place-items-center">
                          <span className="-rotate-12 border-[3px] border-red bg-sheet/85 px-2 py-0.5 text-center text-red">
                            <span className="block font-display text-xl leading-none tracking-widest uppercase">Taken</span>
                            <span className="block max-w-[9rem] truncate font-type text-[10px] font-bold">{owned.playerName}</span>
                          </span>
                        </span>
                      ) : null}
                    </button>
                  );
                })}
              </div>
              <p className="mt-3 hidden font-type text-xs text-ink-faint lg:block">keys: 1–0 pick · T new club · Y same club, new player · M mute</p>
            </>
          ) : profile ? (
            <div className="sticker mt-4 p-5 sm:p-6">
              {!club || spin?.kind === "club" ? (
                <div className="text-center">
                  <p className="font-type text-sm text-ink-soft">the last roll. who&apos;s brave enough?</p>
                  <p className={`mt-3 min-h-14 font-display text-5xl leading-none uppercase sm:text-6xl ${spin?.kind === "club" ? "animate-ticker text-red" : "text-ink-faint"}`}>{spin?.kind === "club" ? spin.title : "which club signs him?"}</p>
                  <button type="button" onClick={rollClub} disabled={spinning} className="sticker press mt-5 w-full bg-red py-3.5 font-display text-2xl tracking-wide text-sheet uppercase disabled:opacity-40">
                    Roll your club
                  </button>
                </div>
              ) : (
                <div key={`club-${rollCount}`} className="animate-card-pop text-center">
                  <p className="font-type text-sm text-ink-soft">signed, sealed, stitched. you join</p>
                  <p className="mt-1 font-display text-5xl leading-none tracking-wide text-red uppercase sm:text-6xl">{club.name}</p>
                  <p className="mx-auto mt-3 max-w-md font-type text-sm leading-relaxed text-ink-soft">
                    attack {profile.attack.toFixed(1)} · defence {profile.defense.toFixed(1)}.{replaced ? ` ${replaced.name} (${replaced.overall}) is dropped to make room. he's fuming.` : ""}
                  </p>
                  <p className="mx-auto mt-2 max-w-md font-type text-xs text-ink-faint">season bonus: champions +2 team +2 player · top four +1 each · top seven +1 player</p>
                  <button type="button" onClick={playSeason} className="sticker press mt-5 w-full bg-pitch py-3.5 font-display text-2xl tracking-wide text-sheet uppercase">
                    Play 38 matchweeks
                  </button>
                </div>
              )}
            </div>
          ) : null}
        </section>

        <section className="sticker order-4 p-4 lg:order-none lg:self-start">
          <div className="flex items-end justify-between border-b-2 border-ink pb-2">
            <div>
              <p className="font-display text-2xl leading-none tracking-wide uppercase">The monster</p>
              <p className="mt-1 font-type text-xs text-ink-soft">{taken} of 10 parts sewn on</p>
            </div>
            <div className="text-right">
              <p className={`font-display text-6xl leading-none ${taken ? tier(rating).text : "text-rule"}`}>{taken ? rating : "--"}</p>
              <p className={`font-type text-[11px] font-bold ${taken ? tier(rating).text : "text-ink-faint"}`}>{taken ? tier(rating).label.toLowerCase() : "unbuilt"}</p>
            </div>
          </div>
          <div className="mt-3 grid grid-cols-5 gap-1.5 lg:grid-cols-1">
            {BUILD_STATS.map((definition) => {
              const slot = locked[definition.key];
              return (
                <div
                  key={definition.key}
                  title={slot ? `${definition.label} ${slot.value} · ${slot.playerName}` : definition.label}
                  className={`flex flex-col items-center gap-0.5 px-1 py-1.5 lg:flex-row lg:justify-between lg:gap-2 lg:px-2.5 ${slot ? "animate-slot-fill border-2 border-ink bg-sheet" : "border-2 border-dashed border-rule"}`}
                >
                  <div className="min-w-0 text-center lg:text-left">
                    <p className={`font-type text-[10px] font-bold uppercase lg:text-xs ${slot ? "text-ink" : "text-ink-faint"}`}>
                      <span className="lg:hidden">{SHORT_LABEL[definition.key]}</span>
                      <span className="hidden lg:inline">{definition.label}</span>
                    </p>
                    <p className="hidden truncate font-type text-[11px] text-ink-soft lg:block">{slot ? `from ${slot.playerName}` : "stick here"}</p>
                  </div>
                  <p className={`font-display text-2xl leading-none lg:text-3xl ${slot ? tier(slot.value).text : "text-rule"}`}>{slot ? slot.value : "--"}</p>
                </div>
              );
            })}
          </div>
          <div className="mt-3 flex flex-wrap gap-x-3 gap-y-1 font-type text-[10px] text-ink-soft">
            {TIERS.map((item) => (
              <span key={item.label} className="flex items-center gap-1">
                <span className={`size-2 ${item.bg}`} /> {item.min ? `${item.min}+` : "<70"} {item.label.toLowerCase()}
              </span>
            ))}
          </div>
        </section>
      </div>
      <footer className="mx-auto max-w-[1320px] px-4 pb-6 font-type text-[11px] text-ink-faint sm:px-5 2xl:max-w-[1560px]">
        stats = EA SPORTS FC rating blended with {data.season} league form (up to half weight from 900 minutes; pace has no season data, so it stays EA). ratings via ea.com · form via premierleague.com and fantasy premier league · a fan project.
      </footer>

      {!complete ? (
        <div className="fixed inset-x-0 bottom-0 z-20 border-t-2 border-ink bg-sheet lg:hidden">
          <div key={denied} className={`mx-auto flex max-w-xl items-center gap-2 px-3 pt-2 pb-[calc(0.5rem+env(safe-area-inset-bottom))] ${denied ? "animate-shake" : ""}`}>
            <div className="w-14 shrink-0 text-center">
              <p className={`font-display text-3xl leading-none ${taken ? tier(rating).text : "text-rule"}`}>{taken ? rating : "--"}</p>
              <p className="font-type text-[10px] text-ink-soft">build</p>
            </div>
            {rerollButtons(true)}
          </div>
        </div>
      ) : null}
    </div>
  );
}
