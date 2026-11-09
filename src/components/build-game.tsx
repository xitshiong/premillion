"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import Image from "next/image";
import Link from "next/link";
import { BookOpen, RotateCcw, Trophy, Volume2, VolumeX } from "lucide-react";
import { PixelStadium } from "@/components/pixel-stadium";
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
import { rolledChemHints, tileChemHint, withChemistry, type ChemHint } from "@/lib/chemistry";
import { ACHIEVEMENTS, profileStore, type AchievementId } from "@/lib/profile";
import { BUILD_STATS, PRIME_CHANCE, asPrime, buildRating, clubWithUser, strengthFrom, type ClubRating, type GameData, type RollPlayer, type RollStat } from "@/lib/ratings";
import { muteStore, sfx } from "@/lib/sfx";
import { mulberry32, simulateSeason, tableAt, type MatchResult } from "@/lib/simulate";

const PLAYER_REROLLS = 5;
const TEAM_REROLLS = 5;
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
type Toast = { id: number; title: string; reward?: Reward; banked?: boolean; kind: "quest" | "achievement" };
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
    return <p className="absolute inset-0 grid place-items-center font-pixel text-4xl text-line lg:text-6xl">{initials}</p>;
  }
  return <Image src={url} alt={name} fill unoptimized loading="eager" sizes="280px" className="object-contain object-bottom" onError={() => setFailed(true)} />;
}

function Key({ children, className = "inline-grid" }: { children: React.ReactNode; className?: string }) {
  return <span className={`h-5 min-w-5 place-items-center border border-line bg-night px-1 font-ui text-[11px] text-haze ${className}`}>{children}</span>;
}

function IconButton({ label, onClick, href, children }: { label: string; onClick?: () => void; href?: string; children: React.ReactNode }) {
  const className = "btn-game grid size-8 shrink-0 place-items-center border border-line bg-stand text-haze hover:border-flood hover:text-flood sm:size-9";
  if (href) {
    return (
      <Link href={href} aria-label={label} title={label} className={className} onMouseEnter={() => sfx().play("hover")} onPointerDown={() => sfx().play("click")}>
        {children}
      </Link>
    );
  }
  return (
    <button
      type="button"
      onClick={onClick}
      onMouseEnter={() => sfx().play("hover")}
      onPointerDown={() => sfx().play("click")}
      aria-label={label}
      title={label}
      className={className}
    >
      {children}
    </button>
  );
}

function RewardChip({ reward, muted = false }: { reward: Reward; muted?: boolean }) {
  return <span className={`shrink-0 font-pixel text-[11px] tracking-[0.12em] ${muted ? "text-dim" : "text-gold"}`}>{rewardText(reward).toUpperCase()}</span>;
}

function ChemBar({ hint, compact = false, tip }: { hint: ChemHint; compact?: boolean; tip?: string }) {
  const ratio = Math.min(1, hint.current / hint.target);
  const fill = hint.complete ? "bg-gold" : hint.color;
  const howto = tip ?? hint.howto;
  return (
    <div className={`group/chem relative ${compact ? "" : "z-10"}`}>
      <div
        className={`relative overflow-hidden bg-night/85 ${compact ? "h-4" : "h-6"}`}
        title={howto}
      >
        <div className={`absolute inset-y-0 left-0 ${fill}`} style={{ width: `${Math.max(ratio * 100, 12)}%` }} />
        <p
          className={`relative z-[1] truncate px-1.5 font-pixel tracking-[0.04em] ${compact ? "text-[10px] leading-4" : "text-[11px] leading-6"} ${
            hint.complete || ratio >= 0.4 ? "text-night" : "text-chalk"
          }`}
        >
          {hint.label} {hint.current}/{hint.target}
        </p>
      </div>
      {!compact && howto ? (
        <div className="pointer-events-none absolute right-0 bottom-full z-30 mb-1 hidden w-[min(240px,70vw)] border border-line bg-night px-2.5 py-2 shadow-[0_8px_24px_rgba(0,0,0,0.45)] group-hover/chem:block">
          <p className="font-pixel text-[10px] tracking-[0.18em] text-grass">
            {hint.label.toUpperCase()} {hint.current}/{hint.target}
          </p>
          <p className="mt-1 text-xs leading-snug text-chalk/90">{howto}</p>
          {!hint.complete ? <p className="mt-1 text-[11px] text-gold">+{hint.boost} when complete</p> : null}
        </div>
      ) : null}
    </div>
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
  const career = useSyncExternalStore(profileStore.subscribe, profileStore.get, profileStore.getServer);
  const [nameDraft, setNameDraft] = useState(career.name);
  const [sawPrime, setSawPrime] = useState(false);
  const [freshUnlocks, setFreshUnlocks] = useState<AchievementId[]>([]);
  const [openQuestId, setOpenQuestId] = useState<string | null>(null);

  function maybePrime(player: RollPlayer, random: () => number = Math.random) {
    if (random() >= PRIME_CHANCE) return player;
    setSawPrime(true);
    return asPrime(player);
  }

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
  const chemistry = withChemistry(lockedStats);
  const rating = buildRating(chemistry.boosted);
  const profile = complete ? strengthFrom(chemistry.boosted) : null;

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
      const nextPlayer = maybePrime(pick(pool));
      const teamFrames = Array.from({ length: 8 }, (_, index) => () => {
        const shown = index === 7 ? nextClub : pick(rollClubs);
        return { kind: "team" as const, title: shown.name, subtitle: nextPlayer.prime && index === 7 ? "prime incoming" : "drawing a club" };
      });
      sfx().play("whoosh");
      runSpin([...teamFrames, ...playerFrames(pool, nextPlayer, 7)], () => {
        setRolled(nextPlayer);
        if (nextPlayer.prime) sfx().play("pick-world");
        else sfx().play("land");
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
    setSawPrime(false);
    setFreshUnlocks([]);
    setOpenQuestId(null);
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
    setToast({ id: quests.done.length + picks.length * 100, kind: "quest", title: finished.map((quest) => questById(quest.id).title).join(" + "), reward, banked: buildDone });
    finished.forEach((quest) => {
      const unlocked = profileStore.noteQuest(quest.id);
      if (unlocked.length) setFreshUnlocks((list) => [...list, ...unlocked]);
    });
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
      nationality: rolled.nationality,
      role: rolled.role,
      position: rolled.position,
      overall: rolled.overall,
      goals: rolled.goals,
      assists: rolled.assists,
      prime: rolled.prime,
    };
    const next = { ...locked, [stat.key]: entry };
    const picks = Object.values(next);
    setLocked(next);
    setLastPick(entry);
    sfx().play(stat.value >= 90 ? "pick-world" : stat.value >= 85 ? "pick-elite" : "pick");
    const questDone = settleQuests(picks, picks.length === 10);
    if (picks.length === 10) {
      const final = withChemistry(picks).boosted;
      const unlocked = profileStore.noteBuild(
        buildRating(final),
        final.filter((pick) => pick.value >= 90).length,
        quests.done.length + (questDone ? 1 : 0),
        sawPrime || picks.some((pick) => pick.prime),
      );
      if (unlocked.length) {
        setFreshUnlocks((list) => [...list, ...unlocked]);
        setToast({ id: picks.length * 1000, kind: "achievement", title: unlocked.map((id) => ACHIEVEMENTS.find((item) => item.id === id)?.title ?? id).join(" · ") });
        setTimeout(() => sfx().play("europe"), 280);
      }
    }
    if (picks.length < 10) setTimeout(() => rollFreshTeam(), questDone ? 650 : 260);
  }

  function rerollPlayer() {
    if (phase !== "build" || spinning || complete) return;
    if (playerRerolls <= 0 || clubPool.length < 2) return deny();
    setPlayerRerolls((count) => count - 1);
    setLastRerollAt(taken);
    const nextPlayer = maybePrime(pick(clubPool.filter((player) => player.id !== rolled.id)));
    sfx().play("whoosh");
    runSpin(playerFrames(clubPool, nextPlayer, 10), () => {
      setRolled(nextPlayer);
      if (nextPlayer.prime) sfx().play("pick-world");
      else sfx().play("land");
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
    const unlocked = profileStore.noteSeason(place, signed.name);
    if (unlocked.length) {
      setFreshUnlocks((list) => [...list, ...unlocked]);
      setToast({ id: place * 10_000 + runs.length, kind: "achievement", title: unlocked.map((id) => ACHIEVEMENTS.find((item) => item.id === id)?.title ?? id).join(" · ") });
    }
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

  const header = (
    <header className="sticky top-0 z-30 border-b border-line bg-night/90 backdrop-blur">
      <div className="mx-auto flex max-w-[1320px] 2xl:max-w-[1560px] items-center justify-between gap-2 px-3 py-2 sm:gap-3 sm:px-5">
        <button type="button" onClick={() => setPhase("intro")} className="title-split shrink-0 font-pixel text-sm tracking-[0.04em] text-chalk sm:text-xl sm:tracking-[0.12em]">
          PREMILLION
        </button>
        {phase === "build" ? (
          <div className="min-w-0 text-center">
            <p className="font-pixel text-[11px] tracking-[0.14em] whitespace-nowrap text-chalk sm:text-sm sm:tracking-[0.3em]">
              {complete ? "BUILT" : `ROUND ${round}/10`}
            </p>
            <div className="mt-1 flex justify-center gap-0.5 sm:gap-1">
              {Array.from({ length: 10 }, (_, index) => (
                <span key={index} className={`h-1.5 w-1.5 sm:w-4 ${index < taken ? "bg-flood" : index === taken && !complete ? "animate-blink bg-flood/50" : "bg-line"}`} />
              ))}
            </div>
          </div>
        ) : null}
        <div className="flex shrink-0 items-center gap-1 sm:gap-1.5">
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
    <div key={toast.id} className="animate-toast pointer-events-none fixed top-16 left-1/2 z-40 w-[min(92vw,420px)] border border-gold bg-night/95 px-4 py-3 text-center shadow-[0_0_24px_rgba(255,209,102,0.35)]">
      <p className="font-pixel text-[10px] tracking-[0.3em] text-gold">{toast.kind === "achievement" ? "ACHIEVEMENT" : "QUEST COMPLETE"}</p>
      <p className="mt-1 font-pixel text-sm tracking-[0.12em] text-chalk">{toast.title.toUpperCase()}</p>
      {toast.reward ? (
        <p className="mt-1 text-[11px] text-haze">
          {rerollText(toast.reward)}
          {toast.banked ? " · banked for your next run" : ""}
        </p>
      ) : (
        <p className="mt-1 text-[11px] text-haze">saved to your profile</p>
      )}
    </div>
  ) : null;

  if (phase === "intro") {
    const unlocked = new Set(career.unlocked);
    return (
      <div className="crt relative flex min-h-screen flex-col overflow-hidden bg-night font-ui text-chalk">
        {header}
        <div className="relative flex flex-1 flex-col">
          <div className="relative">
            <PixelStadium className="h-[32vh] min-h-[200px] sm:h-[42vh] sm:min-h-[260px]" />
            <div className="absolute inset-0 flex flex-col items-center justify-center px-4 text-center">
              <h1 className="title-split animate-flicker font-pixel text-[12vw] leading-none tracking-[0.04em] text-chalk sm:text-7xl lg:text-8xl">PREMILLION</h1>
              <p className="mt-3 inline-block border border-flood/40 bg-night/85 px-3 py-1.5 font-pixel text-[10px] tracking-[0.4em] text-flood sm:text-sm">{data.season}</p>
            </div>
          </div>

          <div className="relative mx-auto flex w-full max-w-[720px] flex-1 flex-col items-center px-4 pt-6 pb-8">
            <button
              type="button"
              onClick={kickOff}
              onMouseEnter={() => sfx().play("hover")}
              onPointerDown={() => sfx().play("click")}
              className="btn-game btn-pulse glow-flood w-full max-w-md bg-turf py-5 font-pixel text-xl tracking-[0.35em] text-chalk hover:bg-stand sm:text-2xl"
            >
              ▶ {taken > 0 || season ? "RESUME" : "KICK OFF"} ◀
            </button>
            <p className="mt-3 max-w-md text-center font-pixel text-[11px] tracking-[0.14em] text-haze sm:text-xs">
              CAN YOU WIN THE PREM WITH YOUR PLAYER?
            </p>

            <section className="pixel-frame mt-8 w-full bg-turf p-4 sm:p-5">
              <div className="flex flex-wrap items-end justify-between gap-3">
                <div>
                  <p className="font-pixel text-[10px] tracking-[0.3em] text-flood">MANAGER</p>
                  <input
                    value={nameDraft}
                    onChange={(event) => setNameDraft(event.target.value)}
                    onBlur={() => profileStore.setName(nameDraft)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") event.currentTarget.blur();
                    }}
                    maxLength={24}
                    className="mt-1 w-full max-w-xs border-b border-line bg-transparent font-digits text-4xl uppercase outline-none placeholder:text-dim focus:border-flood"
                    placeholder="NAME"
                    aria-label="Manager name"
                  />
                </div>
                <p className="font-pixel text-[10px] tracking-[0.18em] text-dim">
                  {career.runs}S · {career.builds}B
                </p>
              </div>
              <div className="mt-4 grid grid-cols-4 gap-2">
                {[
                  { label: "best", value: career.bestPlace ? ordinal(career.bestPlace) : "—" },
                  { label: "titles", value: String(career.champions) },
                  { label: "top 4", value: String(career.topFour) },
                  { label: "primes", value: String(career.primesSeen) },
                ].map((stat) => (
                  <div key={stat.label} className="border border-line bg-night/50 px-2 py-2 text-center sm:px-3">
                    <p className="font-pixel text-[9px] tracking-[0.2em] text-haze">{stat.label.toUpperCase()}</p>
                    <p className="font-digits text-3xl leading-none text-chalk">{stat.value}</p>
                  </div>
                ))}
              </div>
              <div className="mt-4 flex items-center gap-2">
                <Trophy className="size-3.5 text-gold" />
                <p className="font-pixel text-[10px] tracking-[0.28em] text-gold">
                  {career.unlocked.length}/{ACHIEVEMENTS.length}
                </p>
              </div>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {ACHIEVEMENTS.map((item) => {
                  const got = unlocked.has(item.id);
                  return (
                    <span
                      key={item.id}
                      title={item.detail}
                      className={`border px-2 py-1 font-pixel text-[9px] tracking-[0.08em] ${got ? "border-gold/60 bg-gold/15 text-gold" : "border-line/70 text-dim"}`}
                    >
                      {item.title.toUpperCase()}
                    </span>
                  );
                })}
              </div>
            </section>
          </div>
        </div>
        <footer className="border-t border-line px-4 py-2 text-center text-[10px] tracking-wide text-dim">fan project · not affiliated</footer>
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
      { key: "N", title: "NEW RUN", detail: `${TEAM_REROLLS + bank.team}T / ${PLAYER_REROLLS + bank.player}P`, glow: "glow-kit" },
      { key: "R", title: "RUN IT BACK", detail: "same build", glow: "glow-flood" },
      { key: "C", title: "NEW CLUB", detail: "new club roll", glow: "glow-flood" },
    ];
    return (
      <div className="crt min-h-screen bg-night font-ui text-chalk">
        {header}
        <div className="mx-auto grid max-w-[1320px] 2xl:max-w-[1560px] gap-3 px-3 py-3 sm:py-4 lg:grid-cols-[minmax(0,1fr)_400px] lg:px-5">
          <div className="flex min-w-0 flex-col gap-3">
            <section className="pixel-frame bg-turf p-4 sm:p-6">
              <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                <p className="font-pixel text-xs tracking-[0.3em] text-flood">{club.name.toUpperCase()}</p>
                <p className="text-[11px] text-dim">
                  build <span className={tier(rating).text}>{rating}</span> · attack {profile?.attack.toFixed(1)} · defence {profile?.defense.toFixed(1)}
                </p>
              </div>
              <div className="mt-3 flex flex-wrap items-end justify-between gap-4">
                <div>
                  <p className="text-xs text-haze uppercase">{done ? "full time" : `matchweek ${week} / 38`}</p>
                  <p className={`font-digits text-7xl leading-none sm:text-8xl ${done ? end.color : "text-chalk"}`}>{place ? ordinal(place) : "—"}</p>
                  <p className="mt-1 font-digits text-xl text-haze">
                    <span className="text-grass">{record.w}W</span> <span className="text-gold">{record.d}D</span> <span className="text-kit">{record.l}L</span> · {table[place - 1]?.points ?? 0} pts
                  </p>
                </div>
                {!done ? (
                  <div className="flex flex-col items-end gap-2">
                    {latest ? (
                      <p key={latest.week} className="animate-tile-in font-digits text-3xl text-haze">
                        {shortName.get(latest.home)} {latest.homeGoals}–{latest.awayGoals} {shortName.get(latest.away)}
                      </p>
                    ) : null}
                    <button
                      type="button"
                      onClick={() => finishSeason(season.matches, club)}
                      onMouseEnter={() => sfx().play("hover")}
                      onPointerDown={() => sfx().play("click")}
                      className="btn-game border border-line px-3 py-1.5 font-pixel text-xs tracking-[0.2em] text-haze hover:border-flood hover:text-flood"
                    >
                      SKIP ▶▶
                    </button>
                  </div>
                ) : null}
              </div>
              {done ? (
                <div className="animate-card-pop mt-4">
                  <p className={`title-split font-pixel text-2xl tracking-[0.12em] sm:text-4xl ${end.color}`}>{end.title.toUpperCase()}</p>
                  <p className="mt-1 text-sm text-haze">── {end.line}</p>
                </div>
              ) : null}
              <div className="mt-5 grid grid-cols-[repeat(19,minmax(0,1fr))] gap-1 sm:flex sm:flex-wrap" aria-label="Form">
                {mine.map((match) => {
                  const home = match.home === club.id;
                  const diff = (home ? match.homeGoals : match.awayGoals) - (home ? match.awayGoals : match.homeGoals);
                  const played = match.week <= week;
                  return (
                    <span
                      key={match.week}
                      title={`W${match.week} ${home ? "vs" : "at"} ${shortName.get(home ? match.away : match.home)} ${match.homeGoals}–${match.awayGoals}`}
                      className={`aspect-square sm:size-3.5 ${!played ? "bg-line/60" : diff > 0 ? "bg-grass" : diff < 0 ? "bg-kit" : "bg-gold"}`}
                    />
                  );
                })}
              </div>
            </section>

            {done ? (
              <section className="animate-card-pop pixel-frame border-gold/40 bg-turf p-4 sm:p-5">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <p className="font-pixel text-sm tracking-[0.3em] text-chalk">WHAT NOW?</p>
                  <p className="text-[11px] text-dim">
                    season {runs.length} this session{bestRun ? ` · best ${ordinal(bestRun.place)} with ${bestRun.clubName}` : ""}
                    {freshUnlocks.length ? ` · +${freshUnlocks.length} achievement${freshUnlocks.length > 1 ? "s" : ""}` : ""}
                  </p>
                </div>
                <div className="mt-3 grid gap-2 sm:grid-cols-3">
                  {options.map((option) => (
                    <button
                      key={option.key}
                      type="button"
                      onClick={() => afterSeason(option.key)}
                      onMouseEnter={() => sfx().play("hover")}
                      onPointerDown={() => sfx().play("click")}
                      className={`btn-game ${option.glow} group flex items-center justify-between gap-3 bg-stand px-4 py-3 text-left hover:bg-[#163528] sm:flex-col sm:items-start`}
                    >
                      <span>
                        <span className="block font-pixel text-sm tracking-[0.2em] text-chalk">{option.title}</span>
                        <span className="mt-1 block text-[11px] text-haze">{option.detail}</span>
                      </span>
                      <Key className="hidden sm:inline-grid">{option.key}</Key>
                    </button>
                  ))}
                </div>
                <p className="mt-3 text-[11px] text-haze">
                  {seasonNote?.fresh ? (
                    seasonNote.reward.team + seasonNote.reward.player > 0 ? (
                      <>
                        season bonus banked for your next run: <span className="text-gold">{rerollText(seasonNote.reward)}</span>.
                      </>
                    ) : (
                      "no season bonus this time. finish top seven to bank extra rerolls."
                    )
                  ) : (
                    "this build already paid its season bonus. a new run can earn another."
                  )}
                  {hasBank ? <span className="text-dim"> total banked: {rewardText(bank)}.</span> : null}
                </p>
              </section>
            ) : null}

            <section className="pixel-frame bg-turf p-3 sm:p-4">
              <p className="mb-2 font-pixel text-[10px] tracking-[0.3em] text-haze">RESULTS</p>
              <div className="grid max-h-64 gap-1 overflow-y-auto pr-1 sm:grid-cols-2 lg:max-h-[19rem]">
                {[...shown].reverse().map((match) => {
                  const home = match.home === club.id;
                  const diff = (home ? match.homeGoals : match.awayGoals) - (home ? match.awayGoals : match.homeGoals);
                  return (
                    <p key={match.week} className="flex items-center justify-between border border-line bg-night/60 px-3 py-1 text-xs">
                      <span className="w-10 text-dim">MW{match.week}</span>
                      <span className="flex-1 text-center">
                        {home ? "vs" : "at"} {shortName.get(home ? match.away : match.home)}
                      </span>
                      <span className={`font-digits text-lg ${diff > 0 ? "text-grass" : diff < 0 ? "text-kit" : "text-gold"}`}>
                        {match.homeGoals}–{match.awayGoals}
                      </span>
                    </p>
                  );
                })}
                {!shown.length ? <p className="text-xs text-dim">kick-off…</p> : null}
              </div>
              <p className="mt-4 max-w-2xl text-[11px] leading-relaxed text-dim">
                how it works: each club is rated from the EA ratings of its {data.coreSize} most-used outfielders, and you replace the weakest of {club.name}&apos;s. attack is pace, shooting, passing, dribbling, finishing and vision. defence is defending, physical, reactions and heading. a match turns those into expected goals around {data.goalsPerTeamGame.toFixed(2)} a side (this season&apos;s real scoring rate), home sides get a 10% bump, and the score is drawn at random. a simulation, not a prediction.
              </p>
            </section>
          </div>

          <section className="pixel-frame self-start bg-turf p-3 lg:sticky lg:top-16">
            <p className="mb-1 px-1.5 font-pixel text-[10px] tracking-[0.3em] text-haze">TABLE</p>
            <table className="w-full table-fixed text-xs">
              <thead className="text-dim">
                <tr>
                  <th className="w-7 px-1.5 py-1 text-left font-normal" />
                  <th className="px-1.5 py-1 text-left font-normal uppercase">club</th>
                  <th className="w-8 px-1.5 py-1 text-right font-normal uppercase">p</th>
                  <th className="w-10 px-1.5 py-1 text-right font-normal uppercase">gd</th>
                  <th className="w-10 px-1.5 py-1 text-right font-normal uppercase">pts</th>
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
                      <td className="truncate px-1.5 py-1">
                        <span className="sm:hidden">{row.abbr || row.name}</span>
                        <span className="hidden sm:inline">{row.name}</span>
                      </td>
                      <td className="px-1.5 py-1 text-right tabular-nums">{row.played}</td>
                      <td className="px-1.5 py-1 text-right tabular-nums">{diff > 0 ? `+${diff}` : diff}</td>
                      <td className="px-1.5 py-1 text-right font-digits text-lg leading-none">{row.points}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 px-1.5 text-[10px] text-dim">
              <span className="flex items-center gap-1">
                <span className="h-2 w-0.5 bg-gold" /> champions
              </span>
              <span className="flex items-center gap-1">
                <span className="h-2 w-0.5 bg-flood" /> champions league
              </span>
              <span className="flex items-center gap-1">
                <span className="h-2 w-0.5 bg-kit" /> relegation
              </span>
            </div>
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
        onMouseEnter={() => sfx().play("hover")}
        onPointerDown={() => {
          if (!spinning && teamRerolls > 0) sfx().play("click");
        }}
        disabled={spinning || teamRerolls <= 0}
        className={`btn-game glow-flood flex items-center justify-center gap-2 bg-turf font-pixel tracking-[0.15em] hover:bg-stand disabled:opacity-35 ${compact ? "flex-1 px-2 py-2.5 text-[11px]" : "px-3 py-2 text-xs"}`}
        title="New club and a new player from it"
      >
        {compact ? "TEAM" : "REROLL TEAM"} <span className="font-digits text-2xl leading-none text-flood">{teamRerolls}</span>
        {compact ? null : <Key>T</Key>}
      </button>
      <button
        type="button"
        onClick={rerollPlayer}
        onMouseEnter={() => sfx().play("hover")}
        onPointerDown={() => {
          if (!spinning && playerRerolls > 0 && clubPool.length >= 2) sfx().play("click");
        }}
        disabled={spinning || playerRerolls <= 0 || clubPool.length < 2}
        className={`btn-game glow-kit flex items-center justify-center gap-2 bg-turf font-pixel tracking-[0.15em] hover:bg-stand disabled:opacity-35 ${compact ? "flex-1 px-2 py-2.5 text-[11px]" : "px-3 py-2 text-xs"}`}
        title={`Another ${rolled.teamName} player`}
      >
        {compact ? "PLAYER" : "REROLL PLAYER"} <span className="font-digits text-2xl leading-none text-kit">{playerRerolls}</span>
        {compact ? null : <Key>Y</Key>}
      </button>
    </>
  );

  const latestDone = quests.done[quests.done.length - 1];
  const rollHints = !complete && !rollSpin ? rolledChemHints(rolled, lockedStats) : [];

  return (
    <div className="crt min-h-screen bg-night pb-24 font-ui text-chalk lg:pb-0">
      {header}
      {toastNode}
      <div className="relative hidden sm:block">
        <PixelStadium className="h-20 opacity-90 lg:h-24" />
        <p className="absolute inset-x-0 bottom-2.5 text-center text-xs text-chalk/80">── {complete ? "ten pulls done. one footballer. allegedly." : ROUND_LINES[taken]}</p>
      </div>

      <div className="mx-auto grid max-w-[1320px] 2xl:max-w-[1560px] gap-3 px-3 py-3 lg:grid-cols-[300px_minmax(0,1fr)_300px] lg:px-5 xl:grid-cols-[320px_minmax(0,1fr)_320px] 2xl:grid-cols-[360px_minmax(0,1fr)_360px]">
        <div className="contents lg:flex lg:flex-col lg:gap-3">
          <section className="pixel-frame order-1 bg-turf lg:order-none">
            <p className="hidden border-b border-line px-4 py-2 font-pixel text-xs tracking-[0.3em] text-haze lg:block">YOU ROLLED</p>
            <div key={rollSpin ? "spin" : `card-${rollCount}`} className={`flex gap-3 p-3 lg:block lg:p-0 ${rollSpin ? "" : "animate-card-pop"}`}>
              <div className="relative size-28 shrink-0 overflow-hidden border border-line bg-[linear-gradient(180deg,#14284a_0%,#0b1424_100%)] sm:size-36 lg:mx-3 lg:mt-3 lg:aspect-[4/3.4] lg:size-auto">
                {rollSpin ? (
                  <div className="absolute inset-0 grid place-items-center">
                    <div className="animate-roll-glow absolute inset-0 bg-[radial-gradient(circle_at_50%_45%,rgba(94,230,255,0.32),transparent_60%)]" />
                    <p className="relative font-pixel text-4xl text-flood lg:text-6xl">?</p>
                  </div>
                ) : (
                  <>
                    <Portrait key={rolled.id} url={rolled.avatarUrl} name={rolled.name} />
                    <div className="absolute top-2 right-2 hidden border border-line bg-night/85 px-2 py-1 text-center lg:block">
                      <p className="font-pixel text-[10px] tracking-widest text-haze">OVR</p>
                      <p className={`font-digits text-4xl leading-none ${tier(rolled.overall).text}`}>{rolled.overall}</p>
                      <p className="font-pixel text-[11px] text-chalk">{rolled.eaPosition}</p>
                    </div>
                    <span className={`absolute top-1.5 left-1.5 px-1.5 py-0.5 font-pixel text-[9px] tracking-widest lg:top-2 lg:left-2 lg:text-[10px] ${rolled.prime ? "bg-kit text-night" : rolled.role === "First team" ? "bg-gold text-night" : "bg-flood text-night"}`}>
                      {rolled.prime ? "PRIME" : rolled.role.toUpperCase()}
                    </span>
                  </>
                )}
              </div>
              <div className="min-w-0 flex-1 self-center lg:px-4 lg:pt-3 lg:pb-4">
                <h1 className={`font-digits text-4xl leading-none uppercase sm:text-5xl ${rollSpin ? "animate-ticker text-flood" : "text-chalk"}`}>{rollSpin ? rollSpin.title : rolled.name}</h1>
                <p className="mt-1.5 truncate font-pixel text-xs tracking-[0.2em] text-kit sm:text-sm">{(rollSpin ? rollSpin.subtitle : rolled.teamName).toUpperCase()}</p>
                {!rollSpin ? (
                  <>
                    <p className="mt-2 flex flex-wrap items-center gap-2 lg:hidden">
                      <span className={`font-digits text-4xl leading-none ${tier(rolled.overall).text}`}>{rolled.overall}</span>
                      <span className="font-pixel text-[11px] tracking-widest text-haze">OVR · {rolled.eaPosition}</span>
                      {rolled.prime ? <span className="bg-kit px-1.5 py-0.5 font-pixel text-[9px] tracking-widest text-night">PRIME</span> : null}
                    </p>
                    <p className="mt-2 text-xs text-haze lg:mt-3">
                      {rolled.nationality ?? "—"} · {rolled.appearances} apps · {rolled.minutes}&apos; · {rolled.goals}g · {rolled.assists}a · EA {rolled.eaOverall}
                      {rolled.formDelta ? ` · form ${rolled.formDelta > 0 ? "+" : ""}${rolled.formDelta}` : ""}
                    </p>
                    {rollHints.length ? (
                      <div className="mt-2 space-y-1">
                        {rollHints.slice(0, 3).map((hint) => (
                          <ChemBar key={hint.id} hint={hint} compact />
                        ))}
                      </div>
                    ) : null}
                  </>
                ) : null}
              </div>
            </div>
          </section>

          <section className="pixel-frame order-3 bg-turf p-3 lg:order-none">
            <div className="flex items-baseline justify-between gap-2 px-0.5">
              <p className="font-pixel text-xs tracking-[0.3em] text-gold">QUESTS</p>
              <p className="text-[11px] text-dim">{quests.done.length} done · tap for how</p>
            </div>
            <div className="mt-2 grid gap-1.5 sm:grid-cols-3 lg:grid-cols-1">
              {quests.active.map((active) => {
                const quest = questById(active.id);
                const progress = complete ? 0 : questProgress(active, lockedStats, lastRerollAt);
                const open = openQuestId === active.id;
                return (
                  <button
                    key={`${active.id}-${active.since}`}
                    type="button"
                    disabled={complete}
                    onClick={() => {
                      if (complete) return;
                      sfx().play("click");
                      setOpenQuestId(open ? null : active.id);
                    }}
                    className={`btn-game border px-2.5 py-2 text-left ${complete ? "border-line/60 opacity-50" : open ? "animate-tile-in border-flood bg-stand" : "animate-tile-in border-line bg-stand hover:border-flood/70"}`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <p className="font-pixel text-xs tracking-[0.12em] text-chalk">{quest.title.toUpperCase()}</p>
                      <RewardChip reward={quest.reward} muted={complete} />
                    </div>
                    <div className="mt-1.5 flex gap-0.5">
                      {Array.from({ length: quest.target }, (_, index) => (
                        <span key={index} className={`h-1 flex-1 ${index < progress ? "bg-gold" : "bg-line"}`} />
                      ))}
                    </div>
                    {open ? (
                      <div className="mt-2 border-t border-line/80 pt-2">
                        <p className="text-xs leading-snug text-chalk/90">{quest.detail}</p>
                        <p className="mt-1 text-[11px] text-haze">
                          {progress}/{quest.target}
                          {quest.id === "streak" ? " · resets if you reroll" : ""}
                        </p>
                      </div>
                    ) : null}
                  </button>
                );
              })}
            </div>
            {quests.done.length ? (
              <ul className="mt-2 space-y-1">
                {quests.done.map((done) => (
                  <li key={done.id} className={`flex items-center justify-between gap-2 px-2 py-1 text-[10px] text-dim ${done === latestDone ? "animate-quest-done" : ""}`}>
                    <span>
                      <span className="text-grass">✓</span> {questById(done.id).title.toLowerCase()}
                    </span>
                    <span className="text-gold/80">{done.banked ? "banked" : rewardText(questById(done.id).reward)}</span>
                  </li>
                ))}
              </ul>
            ) : null}
            {hasBank ? <p className="mt-2 px-0.5 text-[10px] text-gold/80">banked: {rewardText(bank)}</p> : null}
          </section>
        </div>

        <section className="pixel-frame order-2 bg-turf p-3 sm:p-4 lg:order-none">
          <div className="border border-line bg-night/50 px-4 py-3 text-center sm:py-4">
            <p className="font-pixel text-xs tracking-[0.35em] text-haze">{complete ? "BUILD COMPLETE" : `PICK ${round} OF 10`}</p>
            <h2 className="mt-1.5 font-pixel text-xl tracking-[0.12em] text-chalk sm:text-2xl">{complete ? "SIGN FOR A CLUB" : rollSpin ? "ROLLING…" : "PICK AN ATTRIBUTE"}</h2>
            {!complete ? (
              <div key={denied} className={`mt-4 hidden flex-wrap justify-center gap-2 lg:flex ${denied ? "animate-shake" : ""}`}>
                {rerollButtons(false)}
              </div>
            ) : null}
            {lastPick && !complete ? (
              <p key={`${lastPick.key}-${taken}`} className="animate-tile-in mt-2 text-[11px] text-haze lg:mt-3">
                last pull: <span className={tier(lastPick.value).text}>{lastPick.value} {lastPick.label.toLowerCase()}</span> from {lastPick.playerName}
              </p>
            ) : !complete ? (
              <p className="mt-2 text-[11px] text-haze sm:hidden">── {ROUND_LINES[taken]}</p>
            ) : null}
          </div>

          {!complete ? (
            <>
              <p className="mt-3 truncate font-pixel text-xs tracking-[0.25em] text-haze sm:mt-4">
                CHOOSE ONE FROM <span className="text-flood">{rollSpin ? "…" : rolled.name.toUpperCase()}</span>
              </p>
              <div className="mt-2 grid grid-cols-2 gap-1.5 sm:gap-2">
                {rolled.stats.map((stat, index) => {
                  const owned = locked[stat.key];
                  const info = tier(stat.value);
                  const delta = stat.value - stat.ea;
                  const hint = !owned && !spinning ? tileChemHint(rolled, lockedStats, stat.key) : null;
                  return (
                    <button
                      key={`${stat.key}-${rollCount}`}
                      type="button"
                      disabled={spinning}
                      onClick={() => choose(stat)}
                      onMouseEnter={() => {
                        if (!owned && !spinning) sfx().play("hover");
                      }}
                      style={{ animationDelay: `${index * 30}ms` }}
                      className={`btn-game group relative min-w-0 border px-2.5 py-2 text-left sm:px-3 ${spinning ? "" : "animate-tile-in"} ${
                        owned
                          ? "cursor-not-allowed border-line/60 bg-night/40"
                          : rolled.prime
                            ? "border-kit/70 bg-stand hover:border-gold hover:bg-[#163528]"
                            : "border-line bg-stand hover:border-flood hover:bg-[#163528]"
                      }`}
                    >
                      <span className="flex items-start justify-between gap-2">
                        <span className="min-w-0">
                          <span className={`block truncate font-pixel text-xs tracking-[0.12em] sm:text-sm sm:tracking-[0.15em] ${owned ? "text-haze" : "text-chalk"}`}>{stat.label.toUpperCase()}</span>
                          <span className={`mt-0.5 block truncate text-xs ${owned ? "text-haze" : "text-chalk/75"} ${owned ? "" : "hidden sm:block"}`}>
                            {owned ? `locked · ${owned.playerName}` : stat.detail.toLowerCase()}
                          </span>
                        </span>
                        <Key className="hidden lg:inline-grid">{index === 9 ? 0 : index + 1}</Key>
                      </span>
                      <span className="mt-1 flex items-end justify-between gap-1">
                        {owned || spinning ? (
                          <span />
                        ) : (
                          <span className="min-w-0 font-pixel text-[11px] tracking-widest sm:text-xs">
                            <span className={`block ${info.text}`}>{info.label.toUpperCase()}</span>
                            <span className="mt-0.5 block truncate text-xs normal-case tracking-normal text-chalk/80">
                              {stat.form === null ? `EA ${stat.ea}` : `EA ${stat.ea} · form ${stat.form}`}
                              {delta ? ` · ${delta > 0 ? "+" : "−"}${Math.abs(delta)}` : ""}
                            </span>
                          </span>
                        )}
                        {spinning ? (
                          <span className="animate-roll-glow font-digits text-4xl leading-none text-haze sm:text-5xl">??</span>
                        ) : (
                          <span className={`font-digits text-4xl leading-none sm:text-5xl ${owned ? "text-haze line-through decoration-1" : info.text}`}>{stat.value}</span>
                        )}
                      </span>
                      {hint ? (
                        <div className="mt-2 -mx-2.5 -mb-2 sm:-mx-3">
                          <ChemBar hint={hint} compact />
                        </div>
                      ) : null}
                    </button>
                  );
                })}
              </div>
              <p className="mt-3 hidden text-[10px] tracking-wide text-dim lg:block">1–0 to pick · T new club · Y same club, new player · M mute</p>
            </>
          ) : profile ? (
            <div className="mt-4 border border-line bg-night/50 p-4">
              {!club || spin?.kind === "club" ? (
                <div className="text-center">
                  <p className="font-pixel text-[10px] tracking-[0.3em] text-haze">THE LAST ROLL</p>
                  <p className={`mt-3 min-h-12 font-digits text-4xl uppercase sm:text-5xl ${spin?.kind === "club" ? "animate-ticker text-flood" : "text-dim"}`}>{spin?.kind === "club" ? spin.title : "which club signs you?"}</p>
                  <button
                    type="button"
                    onClick={rollClub}
                    onMouseEnter={() => sfx().play("hover")}
                    onPointerDown={() => sfx().play("click")}
                    disabled={spinning}
                    className="btn-game btn-pulse glow-flood mt-4 w-full bg-turf py-3 font-pixel text-sm tracking-[0.3em] hover:bg-stand disabled:opacity-40"
                  >
                    ▶ ROLL YOUR CLUB ◀
                  </button>
                </div>
              ) : (
                <div key={`club-${rollCount}`} className="animate-card-pop text-center">
                  <p className="font-pixel text-[10px] tracking-[0.3em] text-haze">YOU SIGN FOR</p>
                  <p className="title-split mt-2 font-pixel text-2xl tracking-[0.08em] text-chalk sm:text-3xl">{club.name.toUpperCase()}</p>
                  <p className="mx-auto mt-3 max-w-md text-xs leading-relaxed text-haze">
                    attack {profile.attack.toFixed(1)} · defence {profile.defense.toFixed(1)}.{replaced ? ` ${replaced.name} (${replaced.overall}) is dropped to make room.` : ""}
                  </p>
                  <p className="mx-auto mt-2 max-w-md text-[11px] text-dim">
                    season bonus: <span className="text-gold/80">champions +2 team +2 player · top four +1 each · top seven +1 player</span>
                  </p>
                  <button
                    type="button"
                    onClick={playSeason}
                    onMouseEnter={() => sfx().play("hover")}
                    onPointerDown={() => sfx().play("click")}
                    className="btn-game btn-pulse glow-flood mt-4 w-full bg-turf py-3 font-pixel text-sm tracking-[0.3em] hover:bg-stand"
                  >
                    ▶ PLAY 38 MATCHWEEKS ◀
                  </button>
                </div>
              )}
            </div>
          ) : null}
        </section>

        <section className="pixel-frame order-4 bg-turf p-3 lg:order-none">
          <div className="flex items-end justify-between border-b border-line px-1 pb-3">
            <div>
              <p className="font-pixel text-xs tracking-[0.3em] text-haze">YOUR BUILD</p>
              <p className="mt-1 text-[11px] text-dim">
                {taken} / 10 attributes
                {chemistry.links.length ? ` · ${chemistry.links.length} chem` : ""}
              </p>
            </div>
            <div className="text-right">
              <p className={`font-digits text-5xl leading-none lg:text-6xl ${taken ? tier(rating).text : "text-line"}`}>{taken ? rating : "--"}</p>
              <p className={`font-pixel text-[10px] tracking-widest ${taken ? tier(rating).text : "text-dim"}`}>{taken ? tier(rating).label.toUpperCase() : "UNBUILT"}</p>
            </div>
          </div>
          <div className="mt-2 grid grid-cols-5 gap-1 lg:grid-cols-1 lg:gap-1.5">
            {BUILD_STATS.map((definition) => {
              const slot = locked[definition.key];
              const chem = chemistry.boosts.get(definition.key) ?? 0;
              const shown = slot ? Math.min(99, slot.value + chem) : null;
              return (
                <div
                  key={definition.key}
                  title={slot ? `${definition.label} ${shown}${chem ? ` (+${chem} chem)` : ""} · ${slot.playerName}` : definition.label}
                  className={`flex flex-col items-center gap-0.5 border px-1 py-1.5 lg:flex-row lg:justify-between lg:gap-2 lg:px-2.5 ${slot ? "animate-slot-fill border-line bg-stand" : "border-dashed border-line/70"} ${chem ? "border-grass/60" : ""}`}
                >
                  <div className="min-w-0 text-center lg:text-left">
                    <p className={`font-pixel text-[10px] tracking-[0.12em] lg:text-xs lg:tracking-[0.15em] ${slot ? "text-chalk" : "text-dim"}`}>
                      <span className="lg:hidden">{SHORT_LABEL[definition.key]}</span>
                      <span className="hidden lg:inline">{definition.label.toUpperCase()}</span>
                    </p>
                    <p className="hidden truncate text-[11px] text-dim lg:block">{slot ? `${slot.playerName}${chem ? ` · +${chem}` : ""}` : "open"}</p>
                  </div>
                  <p className={`font-digits text-2xl leading-none lg:text-3xl ${shown !== null ? tier(shown).text : "text-line"}`}>{shown ?? "--"}</p>
                </div>
              );
            })}
          </div>
          <div className="mt-3 border-t border-line pt-2">
            <p className="font-pixel text-xs tracking-[0.25em] text-grass">CHEMISTRY</p>
            {chemistry.links.length ? (
              <ul className="mt-1.5 space-y-1">
                {chemistry.links.map((link) => (
                  <li key={link.id}>
                    <ChemBar
                      hint={{
                        id: link.id as ChemHint["id"],
                        label: link.title,
                        current: link.current,
                        target: link.target,
                        boost: link.boost,
                        complete: link.current >= link.target,
                        color: link.color,
                        howto: link.howto,
                      }}
                      tip={link.howto}
                    />
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-1.5 text-[11px] text-dim">bars light up as teammates x/3 once you stack clubmates, internationals or a back line.</p>
            )}
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
      <footer className="mx-auto max-w-[1320px] 2xl:max-w-[1560px] px-4 pb-6 text-[10px] text-dim lg:px-5">ratings: EA SPORTS FC via ea.com · minutes &amp; goals: premierleague.com {data.season} · a fan project, not affiliated with either</footer>

      {!complete ? (
        <div className="fixed inset-x-0 bottom-0 z-20 border-t border-line bg-night/95 backdrop-blur lg:hidden">
          <div key={denied} className={`mx-auto flex max-w-xl items-center gap-2 px-3 pt-2 pb-[calc(0.5rem+env(safe-area-inset-bottom))] ${denied ? "animate-shake" : ""}`}>
            <div className="w-14 shrink-0 text-center">
              <p className={`font-digits text-3xl leading-none ${taken ? tier(rating).text : "text-line"}`}>{taken ? rating : "--"}</p>
              <p className="font-pixel text-[8px] tracking-widest text-dim">BUILD</p>
            </div>
            {rerollButtons(true)}
          </div>
        </div>
      ) : null}
    </div>
  );
}
