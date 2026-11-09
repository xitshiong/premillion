/**
 * `form` lists the 2026/27 Premier League measures a stat is blended with. Each is the player's
 * percentile among league outfielders; pace has no measured equivalent in either feed, so it stays EA only.
 */
export const BUILD_STATS = [
  { key: "pac", label: "Pace", detail: "Acceleration + sprint speed", group: "attack", form: [] },
  { key: "sho", label: "Shooting", detail: "xG, shots, shots on target", group: "attack", form: ["shooting", "shooting_shots", "shots_on_target"] },
  { key: "pas", label: "Passing", detail: "Final-third passes, completion, through balls", group: "attack", form: ["passing", "pass_completion", "through_balls"] },
  { key: "dri", label: "Dribbling", detail: "Take-ons won, success rate, carries", group: "attack", form: ["dribbling", "dribble_success", "carrying"] },
  { key: "def", label: "Defending", detail: "Tackles, interceptions, recoveries", group: "defense", form: ["tackling", "interceptions", "tackle_win_rate", "recoveries"] },
  { key: "phy", label: "Physical", detail: "Duels and aerials won", group: "defense", form: ["duel_win_rate", "aerials"] },
  { key: "finishing", label: "Finishing", detail: "Goals per 90, shot accuracy", group: "attack", form: ["goals_per_90", "shot_accuracy"] },
  { key: "vision", label: "Vision", detail: "xA, chances and big chances created", group: "attack", form: ["vision", "chance_creation", "big_chances_created", "assists_per_90"] },
  { key: "reactions", label: "Reactions", detail: "Recoveries, high regains", group: "defense", form: ["recoveries", "pressing"] },
  { key: "headingAccuracy", label: "Heading", detail: "Aerials won, aerial win rate", group: "defense", form: ["aerials", "aerial_win_rate"] },
] as const;

export type BuildStatKey = (typeof BUILD_STATS)[number]["key"];

/** Form counts for at most half of a stat, reaching that weight at FULL_FORM_MINUTES league minutes. */
export const FORM_WEIGHT = 0.5;
export const FULL_FORM_MINUTES = 900;

export type RollStat = {
  key: BuildStatKey;
  label: string;
  detail: string;
  value: number;
  ea: number;
  form: number | null;
};

export type RollPlayer = {
  id: number;
  name: string;
  position: string;
  eaPosition: string;
  overall: number;
  eaOverall: number;
  formDelta: number;
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
