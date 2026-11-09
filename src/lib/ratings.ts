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

/**
 * EA stores GK face stats in the same pac/sho/pas/dri/def/phy fields as outfielders:
 * Diving, Handling, Kicking, Reflexes, Speed, Positioning — not pace/dribbling.
 */
export const GK_FACE_STATS: Partial<Record<BuildStatKey, { label: string; detail: string }>> = {
  pac: { label: "Diving", detail: "EA GK diving (stored in the pace slot)" },
  sho: { label: "Handling", detail: "EA GK handling (stored in the shooting slot)" },
  pas: { label: "Kicking", detail: "EA GK kicking (stored in the passing slot)" },
  dri: { label: "Reflexes", detail: "EA GK reflexes (stored in the dribbling slot)" },
  def: { label: "Speed", detail: "EA GK speed (stored in the defending slot)" },
  phy: { label: "Positioning", detail: "EA GK positioning (stored in the physical slot)" },
  reactions: { label: "Reactions", detail: "Shot reactions and alertness" },
  vision: { label: "Vision", detail: "Distribution awareness" },
  finishing: { label: "Finishing", detail: "Not a keeper primary — usually very low" },
  headingAccuracy: { label: "Heading", detail: "Not a keeper primary — usually very low" },
};

export function labelsForPlayer(position: string, key: BuildStatKey) {
  const base = BUILD_STATS.find((stat) => stat.key === key)!;
  if (position === "G") {
    const gk = GK_FACE_STATS[key];
    if (gk) return gk;
  }
  return { label: base.label, detail: base.detail };
}

/** Form is a light nudge. At full minutes it is 28% of the rating; it cannot drag EA more than MAX_FORM_DRAG. */
export const FORM_WEIGHT = 0.28;
export const FULL_FORM_MINUTES = 900;
export const MAX_FORM_DRAG = 5;
export const MAX_FORM_BOOST = 10;
/** Chance that a rolled player arrives in his prime (best-ever card). */
export const PRIME_CHANCE = 0.12;

/** Position primaries get a soft floor so a CB can't fall to 50 defending off a quiet tackle count. */
export const POSITION_KEYS: Record<string, BuildStatKey[]> = {
  D: ["def", "phy", "reactions", "headingAccuracy"],
  M: ["pas", "dri", "vision", "pac"],
  F: ["sho", "finishing", "pac", "dri"],
  // GK face slots: diving / reflexes / positioning / kicking (EA pac/dri/phy/pas).
  G: ["pac", "dri", "phy", "pas"],
};

export type RollStat = {
  key: BuildStatKey;
  label: string;
  detail: string;
  value: number;
  ea: number;
  form: number | null;
};

/** Precomputed best-ever card so every rollable player always has a prime variant. */
export type PrimeVariant = {
  overall: number;
  formDelta: number;
  stats: RollStat[];
};

export type RollPlayer = {
  id: number;
  name: string;
  position: string;
  eaPosition: string;
  overall: number;
  eaOverall: number;
  formDelta: number;
  prime: boolean;
  /** Always set for players in the roll pool. */
  primeVariant: PrimeVariant;
  avatarUrl: string | null;
  shirtNumber: number | null;
  jerseyName: string;
  teamId: number;
  teamName: string;
  nationality: string | null;
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
  primeChance: number;
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

/**
 * Best-ever card for a roll: every attribute uses the player's peak reading (EA or form),
 * and position primaries climb to their personal best — the best number they have on the card.
 * Never invents a ceiling above that personal best.
 */
export function buildPrimeVariant(player: Pick<RollPlayer, "position" | "eaOverall" | "stats">): PrimeVariant {
  const readings = player.stats.flatMap((stat) => [stat.ea, ...(stat.form !== null ? [stat.form] : [])]);
  const personalBest = Math.max(player.eaOverall, ...readings);
  const primaries = new Set(POSITION_KEYS[player.position] ?? []);
  const stats = player.stats.map((stat) => {
    // Best this attribute has ever shown in our data (card EA or season form mapped to EA scale).
    const ownBest = Math.max(stat.ea, stat.form ?? 0);
    if (primaries.has(stat.key)) {
      // Primaries play their career-best game: sit on / next to the player's peak attribute.
      return { ...stat, value: Math.min(99, Math.max(ownBest, personalBest - 1, Math.round(ownBest + (personalBest - ownBest) * 0.85))) };
    }
    // Secondaries also rise — a prime night — but stay below the personal-best ceiling.
    const lift = Math.round(ownBest + (personalBest - ownBest) * 0.45);
    return { ...stat, value: Math.min(99, Math.max(ownBest, lift)) };
  });
  const formDelta = Math.round(stats.reduce((sum, stat) => sum + stat.value - stat.ea, 0) / stats.length);
  const overall = Math.min(99, Math.max(player.eaOverall + 2, buildRating(stats), personalBest - 1));
  return { overall, formDelta, stats };
}

export function asPrime(player: RollPlayer): RollPlayer {
  if (player.prime) return player;
  const variant = player.primeVariant ?? buildPrimeVariant(player);
  return {
    ...player,
    prime: true,
    primeVariant: variant,
    overall: variant.overall,
    formDelta: variant.formDelta,
    stats: variant.stats,
  };
}
