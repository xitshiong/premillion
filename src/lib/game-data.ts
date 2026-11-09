import { getIndex } from "@/lib/data";
import { BUILD_STATS, strengthFrom, type ClubRating, type GameData, type RollPlayer, type RollStat } from "@/lib/ratings";

export type { ClubRating, GameData, RollPlayer, RollStat };

export function getGameData(): GameData {
  const { meta, teams, players } = getIndex();
  const teamName = new Map(teams.map((team) => [team.id, team]));
  const rollPlayers: RollPlayer[] = [];

  for (const player of players) {
    if (player.teamConflict || (player.position !== "D" && player.position !== "M" && player.position !== "F")) continue;
    const featured = new Map(player.featured.map((stat) => [stat.key, stat]));
    const stats: RollStat[] = [];
    let complete = true;
    for (const definition of BUILD_STATS) {
      const stat = featured.get(definition.key);
      if (!stat?.eligible || stat.percentile == null || stat.value == null) {
        complete = false;
        break;
      }
      stats.push({
        key: definition.key,
        label: definition.label,
        group: definition.group,
        percentile: stat.percentile,
        value: stat.value,
        unit: stat.unit,
      });
    }
    if (!complete || !player.position) continue;
    const average = stats.reduce((sum, stat) => sum + stat.percentile, 0) / stats.length;
    rollPlayers.push({
      id: player.id,
      name: player.name,
      position: player.position,
      positionInfo: player.positionInfo,
      teamId: player.teamId,
      teamName: teamName.get(player.teamId)?.name ?? "Unknown",
      minutes: player.minutes,
      appearances: player.appearances,
      goals: player.goals,
      assists: player.assists,
      role: player.appearances >= 8 ? "First team" : "Bench",
      average: Math.round(average * 10) / 10,
      stats,
    });
  }

  const clubs: ClubRating[] = teams.map((team) => {
    const squad = rollPlayers.filter((player) => player.teamId === team.id);
    const profiles = squad.map((player) => strengthFrom(player.stats));
    const attack = profiles.length ? profiles.reduce((sum, profile) => sum + profile.attack, 0) / profiles.length : 50;
    const defense = profiles.length ? profiles.reduce((sum, profile) => sum + profile.defense, 0) / profiles.length : 50;
    return {
      id: team.id,
      name: team.name,
      abbr: team.abbr,
      squad: squad.length,
      attack,
      defense,
    };
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
  };
}
