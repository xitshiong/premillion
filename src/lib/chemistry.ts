import type { BuildStatKey } from "@/lib/ratings";
import type { PickRecord } from "@/lib/quests";
import type { RollPlayer } from "@/lib/ratings";

export type ChemTrackId =
  | "teammates"
  | "nation"
  | "club-country"
  | "back-line"
  | "engine"
  | "front-line"
  | "primes"
  | "spine"
  | "squad-depth";

export type ChemTrack = {
  id: ChemTrackId;
  label: string;
  target: number;
  boost: number;
  keys: BuildStatKey[] | "all";
  /** How many unique matching players are already in the build. */
  count: (players: ChemPlayer[]) => number;
  /** Whether the rolled player belongs on this track. */
  includes: (player: ChemPlayer) => boolean;
  color: string;
};

export type ChemPlayer = {
  playerId: number;
  teamId: number;
  teamName: string;
  nationality: string | null;
  position: string;
  role: "First team" | "Bench";
  prime?: boolean;
};

export type ChemHint = {
  id: ChemTrackId;
  label: string;
  current: number;
  target: number;
  boost: number;
  complete: boolean;
  color: string;
};

export type ChemLink = {
  id: string;
  title: string;
  detail: string;
  boost: number;
  keys: BuildStatKey[] | "all";
  playerIds: number[];
  current: number;
  target: number;
  color: string;
};

const DEF_KEYS: BuildStatKey[] = ["def", "phy", "reactions", "headingAccuracy"];
const MID_KEYS: BuildStatKey[] = ["pas", "dri", "vision", "pac"];
const FWD_KEYS: BuildStatKey[] = ["sho", "finishing", "pac", "dri"];

function uniquePlayers(picks: PickRecord[]): ChemPlayer[] {
  const seen = new Map<number, ChemPlayer>();
  for (const pick of picks) {
    if (seen.has(pick.playerId)) continue;
    seen.set(pick.playerId, {
      playerId: pick.playerId,
      teamId: pick.teamId,
      teamName: pick.teamName,
      nationality: pick.nationality,
      position: pick.position,
      role: pick.role,
      prime: pick.prime,
    });
  }
  return [...seen.values()];
}

function asChemPlayer(player: RollPlayer): ChemPlayer {
  return {
    playerId: player.id,
    teamId: player.teamId,
    teamName: player.teamName,
    nationality: player.nationality,
    position: player.position,
    role: player.role,
    prime: player.prime,
  };
}

/** Fixed chemistry tracks with clear targets, shown as teammates 1/3 style bars. */
export function chemTracksFor(player: ChemPlayer): ChemTrack[] {
  return [
    {
      id: "teammates",
      label: "teammates",
      target: 3,
      boost: 2,
      keys: "all",
      color: "bg-grass",
      count: (players) => players.filter((item) => item.teamId === player.teamId).length,
      includes: (item) => item.teamId === player.teamId,
    },
    // Note: label stays "teammates" on tiles as the hint; completed links can name the club in detail.
    {
      id: "nation",
      label: player.nationality ? player.nationality.toLowerCase() : "nation",
      target: 3,
      boost: 2,
      keys: "all",
      color: "bg-flood",
      count: (players) => players.filter((item) => item.nationality && item.nationality === player.nationality).length,
      includes: (item) => Boolean(player.nationality && item.nationality === player.nationality),
    },
    {
      id: "club-country",
      label: "club & country",
      target: 2,
      boost: 2,
      keys: "all",
      color: "bg-gold",
      count: (players) =>
        players.filter((item) => item.teamId === player.teamId && item.nationality && item.nationality === player.nationality).length,
      includes: (item) => item.teamId === player.teamId && Boolean(player.nationality && item.nationality === player.nationality),
    },
    {
      id: "back-line",
      label: "back line",
      target: 3,
      boost: 2,
      keys: DEF_KEYS,
      color: "bg-flood",
      count: (players) => players.filter((item) => item.position === "D").length,
      includes: (item) => item.position === "D",
    },
    {
      id: "engine",
      label: "engine",
      target: 3,
      boost: 2,
      keys: MID_KEYS,
      color: "bg-grass",
      count: (players) => players.filter((item) => item.position === "M").length,
      includes: (item) => item.position === "M",
    },
    {
      id: "front-line",
      label: "front line",
      target: 3,
      boost: 2,
      keys: FWD_KEYS,
      color: "bg-kit",
      count: (players) => players.filter((item) => item.position === "F").length,
      includes: (item) => item.position === "F",
    },
    {
      id: "primes",
      label: "primes",
      target: 2,
      boost: 2,
      keys: "all",
      color: "bg-kit",
      count: (players) => players.filter((item) => item.prime).length,
      includes: (item) => Boolean(item.prime),
    },
    {
      id: "squad-depth",
      label: "squad",
      target: 2,
      boost: 1,
      keys: ["reactions", "phy"],
      color: "bg-gold",
      count: (players) => {
        const first = players.some((item) => item.role === "First team");
        const bench = players.some((item) => item.role === "Bench");
        return (first ? 1 : 0) + (bench ? 1 : 0);
      },
      includes: () => true,
    },
    {
      id: "spine",
      label: "spine",
      target: 3,
      boost: 1,
      keys: "all",
      color: "bg-grass",
      count: (players) => new Set(players.map((item) => item.position).filter((position) => position === "D" || position === "M" || position === "F")).size,
      includes: (item) => item.position === "D" || item.position === "M" || item.position === "F",
    },
  ];
}

function trackProgress(track: ChemTrack, players: ChemPlayer[]): ChemHint {
  const current = Math.min(track.target, track.count(players));
  return {
    id: track.id,
    label: track.label,
    current,
    target: track.target,
    boost: track.boost,
    complete: current >= track.target,
    color: track.color,
  };
}

/** Active / completed chemistry for the build panel. */
export function evaluateChemistry(picks: PickRecord[]): ChemLink[] {
  const players = uniquePlayers(picks);
  if (!players.length) return [];
  const seen = new Set<string>();
  const links: ChemLink[] = [];

  for (const player of players) {
    for (const track of chemTracksFor(player)) {
      const key =
        track.id === "teammates"
          ? `teammates-${player.teamId}`
          : track.id === "nation"
            ? `nation-${player.nationality}`
            : track.id === "club-country"
              ? `club-country-${player.teamId}-${player.nationality}`
              : track.id;
      if (seen.has(key)) continue;
      const hint = trackProgress(track, players);
      const minShow = track.id === "spine" || track.id === "squad-depth" ? track.target : 2;
      if (hint.current < minShow) continue;
      const memberIds = players.filter((item) => track.includes(item)).map((item) => item.playerId);
      if (memberIds.length < 2 && track.id !== "spine" && track.id !== "squad-depth") continue;
      seen.add(key);
      const title =
        track.id === "teammates"
          ? `teammates · ${player.teamName.split(" ").slice(-1)[0]?.toLowerCase()}`
          : track.id === "nation"
            ? (player.nationality ?? "nation").toLowerCase()
            : track.label;
      links.push({
        id: key,
        title,
        detail: `${hint.current}/${hint.target}`,
        boost: hint.complete ? track.boost : Math.max(1, Math.floor(track.boost / 2)),
        keys: track.keys,
        playerIds: memberIds,
        current: hint.current,
        target: track.target,
        color: track.color,
      });
    }
  }

  return links;
}

/** Tracks that belong on attribute tiles — clubmates / nation / lines, not meta spine/squad. */
const TILE_TRACKS = new Set<ChemTrackId>([
  "teammates",
  "nation",
  "club-country",
  "back-line",
  "engine",
  "front-line",
  "primes",
]);

/**
 * Progress bars for the rolled player's attribute tiles.
 * Prefers the closest unfinished track that this player advances.
 */
export function tileChemHint(rolled: RollPlayer, picks: PickRecord[], statKey: BuildStatKey): ChemHint | null {
  const players = uniquePlayers(picks);
  const candidate = asChemPlayer(rolled);
  // Progress is how many matching players are already locked. Bars appear once a set has started,
  // and only on tiles that would keep building that set (Roblox-style teammates 1/3).
  const hints = chemTracksFor(candidate)
    .filter((track) => TILE_TRACKS.has(track.id))
    .filter((track) => track.includes(candidate))
    .filter((track) => track.keys === "all" || track.keys.includes(statKey))
    .map((track) => trackProgress(track, players))
    .filter((hint) => hint.current > 0);

  if (!hints.length) return null;
  const prefer = (id: ChemTrackId) =>
    id === "teammates" ? 0 : id === "nation" ? 1 : id === "club-country" ? 2 : id === "primes" ? 3 : 4;
  hints.sort((a, b) => {
    if (a.complete !== b.complete) return a.complete ? 1 : -1;
    if (prefer(a.id) !== prefer(b.id)) return prefer(a.id) - prefer(b.id);
    return b.current / b.target - a.current / a.target || b.current - a.current;
  });
  return hints[0];
}

/** Tracks already started that this rolled player can keep filling. */
export function rolledChemHints(rolled: RollPlayer, picks: PickRecord[]): ChemHint[] {
  const players = uniquePlayers(picks);
  const candidate = asChemPlayer(rolled);
  const seen = new Set<string>();
  const hints: ChemHint[] = [];
  for (const track of chemTracksFor(candidate)) {
    if (!TILE_TRACKS.has(track.id)) continue;
    if (!track.includes(candidate) || seen.has(track.id)) continue;
    seen.add(track.id);
    const hint = trackProgress(track, players);
    if (hint.current <= 0) continue;
    hints.push(hint);
  }
  return hints.sort((a, b) => {
    const prefer = (id: ChemTrackId) =>
      id === "teammates" ? 0 : id === "nation" ? 1 : id === "club-country" ? 2 : id === "primes" ? 3 : 4;
    return prefer(a.id) - prefer(b.id) || b.current / b.target - a.current / a.target;
  });
}

export function chemistryBoosts(picks: PickRecord[], links = evaluateChemistry(picks)) {
  const boosts = new Map<string, number>();
  for (const pick of picks) {
    let total = 0;
    for (const link of links) {
      if (!link.playerIds.includes(pick.playerId)) continue;
      if (link.keys !== "all" && !link.keys.includes(pick.key)) continue;
      total += link.boost;
    }
    boosts.set(pick.key, Math.min(4, total));
  }
  return boosts;
}

export function withChemistry(picks: PickRecord[]) {
  const links = evaluateChemistry(picks);
  const boosts = chemistryBoosts(picks, links);
  const boosted = picks.map((pick) => ({
    ...pick,
    baseValue: pick.value,
    value: Math.min(99, pick.value + (boosts.get(pick.key) ?? 0)),
    chem: boosts.get(pick.key) ?? 0,
  }));
  return { links, boosts, boosted };
}
