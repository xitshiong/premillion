import fs from "node:fs";
import path from "node:path";
import { getIndex } from "@/lib/data";
import { BUILD_STATS, strengthFrom, type ClubRating, type GameData, type RollPlayer, type RollStat } from "@/lib/ratings";

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

export function getGameData(): GameData {
  const { meta, teams, players } = getIndex();
  const ea = getEa();
  const teamName = new Map(teams.map((team) => [team.id, team.name]));
  const rollPlayers: RollPlayer[] = [];

  for (const player of players) {
    if (player.teamConflict || (player.position !== "D" && player.position !== "M" && player.position !== "F")) continue;
    if (player.appearances < MIN_APPEARANCES || player.minutes < MIN_MINUTES) continue;
    const rating = ea.players[String(player.id)];
    if (!rating) continue;
    const stats: RollStat[] = [];
    for (const definition of BUILD_STATS) {
      const value = rating.stats[definition.key];
      if (typeof value !== "number") break;
      stats.push({ key: definition.key, label: definition.label, detail: definition.detail, value });
    }
    if (stats.length !== BUILD_STATS.length) continue;
    rollPlayers.push({
      id: player.id,
      name: player.name,
      position: player.position,
      eaPosition: rating.position,
      overall: rating.overall,
      avatarUrl: rating.avatarUrl,
      teamId: player.teamId,
      teamName: teamName.get(player.teamId) ?? "Unknown",
      minutes: player.minutes,
      appearances: player.appearances,
      goals: player.goals,
      assists: player.assists,
      role: player.appearances >= FIRST_TEAM_APPEARANCES ? "First team" : "Bench",
      stats,
    });
  }

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
  return {
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
}
