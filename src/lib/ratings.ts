export const BUILD_STATS = [
  { key: "shooting", label: "Shooting", group: "attack" },
  { key: "dribbling", label: "Dribbling", group: "attack" },
  { key: "passing", label: "Passing", group: "control" },
  { key: "vision", label: "Vision", group: "attack" },
  { key: "chance_creation", label: "Chance creation", group: "attack" },
  { key: "carrying", label: "Carrying", group: "control" },
  { key: "aerials", label: "Aerials", group: "defense" },
  { key: "tackling", label: "Tackling", group: "defense" },
  { key: "pressing", label: "Pressing", group: "defense" },
  { key: "pass_completion", label: "Pass completion", group: "control" },
] as const;

export type BuildStatKey = (typeof BUILD_STATS)[number]["key"];

export type RollStat = {
  key: BuildStatKey;
  label: string;
  group: "attack" | "control" | "defense";
  percentile: number;
  value: number;
  unit: string;
};

export type RollPlayer = {
  id: number;
  name: string;
  position: string;
  positionInfo: string | null;
  teamId: number;
  teamName: string;
  minutes: number;
  appearances: number;
  goals: number;
  assists: number;
  role: "First team" | "Bench";
  average: number;
  stats: RollStat[];
};

export type ClubRating = {
  id: number;
  name: string;
  abbr: string | null;
  squad: number;
  attack: number;
  defense: number;
};

export type GameData = {
  season: string;
  players: RollPlayer[];
  clubs: ClubRating[];
  goalsPerTeamGame: number;
  firstTeam: number;
  bench: number;
  recordedMatches: number;
};

const ATTACK_KEYS: BuildStatKey[] = ["shooting", "vision", "chance_creation", "dribbling"];
const CONTROL_KEYS: BuildStatKey[] = ["passing", "pass_completion", "carrying"];
const DEFENSE_KEYS: BuildStatKey[] = ["tackling", "aerials", "pressing"];

export function strengthFrom(stats: { key: string; percentile: number }[]) {
  const byKey = new Map(stats.map((stat) => [stat.key, stat.percentile]));
  const mean = (keys: string[]) => keys.reduce((sum, key) => sum + (byKey.get(key) ?? 0), 0) / keys.length;
  const attack = mean(ATTACK_KEYS);
  const control = mean(CONTROL_KEYS);
  const defense = mean(DEFENSE_KEYS);
  return {
    attack: attack * 0.75 + control * 0.25,
    defense: defense * 0.75 + control * 0.25,
  };
}
