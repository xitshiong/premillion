import fs from "node:fs";
import path from "node:path";
import { getIndex, getPlayer } from "@/lib/data";
import { BUILD_STATS, FORM_WEIGHT, FULL_FORM_MINUTES, strengthFrom, type BuildStatKey, type ClubRating, type GameData, type RollPlayer, type RollStat } from "@/lib/ratings";

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

/** Mean percentile of the eligible season measures behind one stat, or undefined when none were published. */
function formPercentile(rates: Map<string, number>, keys: readonly string[]) {
  const values = keys.map((key) => rates.get(key)).filter((value): value is number => typeof value === "number");
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : undefined;
}

/**
 * Converts a season percentile into a rating by reading the EA value at the same rank in the roll pool,
 * so a player in the league's 80th percentile for take-ons gets what an 80th-percentile EA dribbler has.
 */
function quantile(sorted: number[], percentile: number) {
  const index = Math.round((percentile / 100) * (sorted.length - 1));
  return sorted[Math.min(sorted.length - 1, Math.max(0, index))];
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
      if (value !== undefined) percentile[definition.key] = value;
    }
    candidates.push({ player, rating, percentile });
  }

  const eaSorted = new Map(BUILD_STATS.map((definition) => [definition.key, candidates.map((item) => item.rating.stats[definition.key]).sort((a, b) => a - b)]));

  // Averaging several percentiles pulls everyone toward the middle, so the averages are re-ranked within the pool.
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
    const stats: RollStat[] = BUILD_STATS.map((definition) => {
      const eaValue = rating.stats[definition.key];
      const rank = percentile[definition.key];
      const form = rank === undefined ? null : quantile(eaSorted.get(definition.key)!, rank);
      const value = form === null ? eaValue : Math.round((1 - weight) * eaValue + weight * form);
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
      avatarUrl: rating.avatarUrl,
      teamId: player.teamId,
      teamName: teamName.get(player.teamId) ?? "Unknown",
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
  };
  return gameCache;
}
