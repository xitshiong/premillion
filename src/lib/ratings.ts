export const BUILD_STATS = [
  { key: "pac", label: "Pace", detail: "Acceleration + sprint speed", group: "attack" },
  { key: "sho", label: "Shooting", detail: "Finishing, power, long shots", group: "attack" },
  { key: "pas", label: "Passing", detail: "Vision, short and long passing", group: "attack" },
  { key: "dri", label: "Dribbling", detail: "Agility, control, balance", group: "attack" },
  { key: "def", label: "Defending", detail: "Tackling, interceptions, awareness", group: "defense" },
  { key: "phy", label: "Physical", detail: "Strength, stamina, jumping", group: "defense" },
  { key: "finishing", label: "Finishing", detail: "In-game sub-stat", group: "attack" },
  { key: "vision", label: "Vision", detail: "In-game sub-stat", group: "attack" },
  { key: "reactions", label: "Reactions", detail: "In-game sub-stat", group: "defense" },
  { key: "headingAccuracy", label: "Heading", detail: "In-game sub-stat", group: "defense" },
] as const;

export type BuildStatKey = (typeof BUILD_STATS)[number]["key"];

export type RollStat = {
  key: BuildStatKey;
  label: string;
  detail: string;
  value: number;
};

export type RollPlayer = {
  id: number;
  name: string;
  position: string;
  eaPosition: string;
  overall: number;
  avatarUrl: string | null;
  teamId: number;
  teamName: string;
  minutes: number;
  appearances: number;
  goals: number;
  assists: number;
  role: "First team" | "Bench";
  stats: RollStat[];
};

export type ClubRating = {
  id: number;
  name: string;
  abbr: string | null;
  squad: number;
  core: { id: number; attack: number; defense: number; overall: number }[];
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
  coreSize: number;
  eaFetchedAt: string;
};

const ATTACK_KEYS: BuildStatKey[] = ["pac", "sho", "pas", "dri", "finishing", "vision"];
const DEFENSE_KEYS: BuildStatKey[] = ["def", "phy", "reactions", "headingAccuracy"];

export function strengthFrom(stats: { key: string; value: number }[]) {
  const byKey = new Map(stats.map((stat) => [stat.key, stat.value]));
  const mean = (keys: string[]) => keys.reduce((sum, key) => sum + (byKey.get(key) ?? 0), 0) / keys.length;
  return { attack: mean(ATTACK_KEYS), defense: mean(DEFENSE_KEYS) };
}

export function buildRating(stats: { value: number }[]) {
  if (stats.length === 0) return 0;
  return Math.round(stats.reduce((sum, stat) => sum + stat.value, 0) / stats.length);
}

/** The user's player replaces the lowest-rated of the club's most-used outfielders. */
export function clubWithUser(club: ClubRating, user: { attack: number; defense: number }) {
  const core = [...club.core].sort((a, b) => a.overall - b.overall);
  const kept = core.slice(1);
  const attack = (kept.reduce((sum, player) => sum + player.attack, 0) + user.attack) / (kept.length + 1);
  const defense = (kept.reduce((sum, player) => sum + player.defense, 0) + user.defense) / (kept.length + 1);
  return { attack, defense, replacedId: core[0]?.id ?? null };
}
