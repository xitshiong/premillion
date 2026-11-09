import fs from "node:fs";
import path from "node:path";
import { getIndex, getPlayer } from "@/lib/data";
import { jerseyName } from "@/lib/kits";
import {
  BUILD_STATS,
  FORM_WEIGHT,
  FULL_FORM_MINUTES,
  MAX_FORM_BOOST,
  MAX_FORM_DRAG,
  POSITION_KEYS,
  PRIME_CHANCE,
  strengthFrom,
  type BuildStatKey,
  type ClubRating,
  type GameData,
  type RollPlayer,
  type RollStat,
} from "@/lib/ratings";

export type { ClubRating, GameData, RollPlayer, RollStat };

type EaRating = {
  eaId: number;
  eaName: string;
  overall: number;
  position: string;
  avatarUrl: string | null;
  stats: Record<string, number>;
};

type EaFile = { fetchedAt: string; players: Record<string, EaRating> };

const MIN_APPEARANCES = 3;
const MIN_MINUTES = 270;
const FIRST_TEAM_APPEARANCES = 7;
const CORE_SIZE = 10;

let eaCache: EaFile | null = null;
function getEa(): EaFile {
  if (!eaCache) {
    eaCache = JSON.parse(fs.readFileSync(path.join(process.cwd(), "data", "ea-ratings.json"), "utf8")) as EaFile;
  }
  return eaCache;
}

type Candidate = {
  player: ReturnType<typeof getIndex>["players"][number];
  rating: EaRating;
  percentile: Partial<Record<BuildStatKey, number>>;
};

function formPercentile(rates: Map<string, number>, keys: readonly string[]) {
  const values = keys.map((key) => rates.get(key)).filter((value): value is number => typeof value === "number");
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : undefined;
}

function quantile(sorted: number[], percentile: number) {
  const index = Math.round((percentile / 100) * (sorted.length - 1));
  return sorted[Math.min(sorted.length - 1, Math.max(0, index))];
}

/** Stretch high percentiles so excellent form can still produce world-class ratings. */
function stretchPercentile(raw: number) {
  return Math.min(100, Math.pow(raw / 100, 0.82) * 100);
}

function blendValue(ea: number, form: number | null, weight: number, primary: boolean) {
  if (form === null) return ea;
  const raw = Math.round((1 - weight) * ea + weight * form);
  // World-class EA ratings never fall below 90; form can only polish them further.
  const drag =
    ea >= 90 ? 0 : ea >= 88 ? 2 : ea >= 85 ? 3 : primary ? Math.min(MAX_FORM_DRAG, 4) : MAX_FORM_DRAG;
  const floor = ea - drag;
  const ceiling = ea + MAX_FORM_BOOST;
  let value = Math.min(ceiling, Math.max(floor, raw));
  // Strong form can still reach the form rating itself when it beats EA.
  if (form > ea) value = Math.max(value, Math.min(form, ea + MAX_FORM_BOOST));
  // Soft floor for position primaries: never drop a rated starter attribute into the 50s.
  if (primary && ea >= 75) value = Math.max(value, Math.min(ea, 72));
  if (primary && ea >= 85) value = Math.max(value, Math.min(ea, 80));
  return value;
}

let gameCache: GameData | null = null;

export function getGameData(): GameData {
  if (gameCache) return gameCache;
  const { meta, teams, players } = getIndex();
  const ea = getEa();
  const teamName = new Map(teams.map((team) => [team.id, team.name]));

  const candidates: Candidate[] = [];
  for (const player of players) {
    if (player.teamConflict || (player.position !== "D" && player.position !== "M" && player.position !== "F")) continue;
    if (player.appearances < MIN_APPEARANCES || player.minutes < MIN_MINUTES) continue;
    const rating = ea.players[String(player.id)];
    if (!rating || BUILD_STATS.some((definition) => typeof rating.stats[definition.key] !== "number")) continue;
    const detail = getPlayer(String(player.id));
    const rates = new Map<string, number>();
    for (const rate of [...(detail?.featured ?? []), ...(detail?.supporting ?? [])]) {
      if (rate.eligible && typeof rate.percentile === "number") rates.set(rate.key, rate.percentile);
    }
    const percentile: Candidate["percentile"] = {};
    for (const definition of BUILD_STATS) {
      const value = formPercentile(rates, definition.form);
      if (value !== undefined) percentile[definition.key] = stretchPercentile(value);
    }
    candidates.push({ player, rating, percentile });
  }

  const eaSorted = new Map(BUILD_STATS.map((definition) => [definition.key, candidates.map((item) => item.rating.stats[definition.key]).sort((a, b) => a - b)]));

  // Re-rank averaged percentiles so the top formers stay near the top of the EA curve.
  for (const definition of BUILD_STATS) {
    const scored = candidates.filter((item) => item.percentile[definition.key] !== undefined);
    const sorted = scored.map((item) => item.percentile[definition.key]!).sort((a, b) => a - b);
    for (const item of scored) {
      const value = item.percentile[definition.key]!;
      const below = sorted.findIndex((entry) => entry >= value);
      const through = sorted.findLastIndex((entry) => entry <= value);
      item.percentile[definition.key] = sorted.length > 1 ? (((below + through) / 2) / (sorted.length - 1)) * 100 : 50;
    }
  }

  const rollPlayers: RollPlayer[] = candidates.map(({ player, rating, percentile }) => {
    const weight = FORM_WEIGHT * Math.min(1, player.minutes / FULL_FORM_MINUTES);
    const primaries = new Set(POSITION_KEYS[player.position ?? ""] ?? []);
    const stats: RollStat[] = BUILD_STATS.map((definition) => {
      const eaValue = rating.stats[definition.key];
      const rank = percentile[definition.key];
      const form = rank === undefined ? null : quantile(eaSorted.get(definition.key)!, rank);
      const value = blendValue(eaValue, form, weight, primaries.has(definition.key));
      return { key: definition.key, label: definition.label, detail: definition.detail, value, ea: eaValue, form };
    });
    const formDelta = Math.round(stats.reduce((sum, stat) => sum + stat.value - stat.ea, 0) / stats.length);
    return {
      id: player.id,
      name: player.name,
      position: player.position ?? "",
      eaPosition: rating.position,
      overall: rating.overall + formDelta,
      eaOverall: rating.overall,
      formDelta,
      prime: false,
      avatarUrl: rating.avatarUrl,
      shirtNumber: player.shirtNumber,
      jerseyName: jerseyName(player.name),
      teamId: player.teamId,
      teamName: teamName.get(player.teamId) ?? "Unknown",
      nationality: player.nationality ?? null,
      minutes: player.minutes,
      appearances: player.appearances,
      goals: player.goals,
      assists: player.assists,
      role: player.appearances >= FIRST_TEAM_APPEARANCES ? "First team" : "Bench",
      stats,
    };
  });

  const clubs: ClubRating[] = teams.map((team) => {
    const squad = rollPlayers.filter((player) => player.teamId === team.id);
    const core = [...squad]
      .sort((a, b) => b.minutes - a.minutes)
      .slice(0, CORE_SIZE)
      .map((player) => ({ id: player.id, overall: player.overall, ...strengthFrom(player.stats) }));
    const mean = (key: "attack" | "defense") => (core.length ? core.reduce((sum, player) => sum + player[key], 0) / core.length : 70);
    return { id: team.id, name: team.name, abbr: team.abbr, squad: squad.length, core, attack: mean("attack"), defense: mean("defense") };
  });

  const recordedMatches = 10;
  const goals = players.reduce((sum, player) => sum + player.goals, 0);
  gameCache = {
    season: meta.season,
    players: rollPlayers,
    clubs,
    goalsPerTeamGame: goals / (teams.length * recordedMatches),
    firstTeam: rollPlayers.filter((player) => player.role === "First team").length,
    bench: rollPlayers.filter((player) => player.role === "Bench").length,
    recordedMatches,
    coreSize: CORE_SIZE,
    eaFetchedAt: ea.fetchedAt,
    primeChance: PRIME_CHANCE,
  };
  return gameCache;
}
