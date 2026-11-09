import type { BuildStatKey } from "@/lib/ratings";
import type { PickRecord } from "@/lib/quests";

export type ChemLink = {
  id: string;
  title: string;
  detail: string;
  boost: number;
  keys: BuildStatKey[] | "all";
  /** Player ids that trigger the link; only their matching locked stats receive the boost. */
  playerIds: number[];
};

const DEF_KEYS: BuildStatKey[] = ["def", "phy", "reactions", "headingAccuracy"];
const MID_KEYS: BuildStatKey[] = ["pas", "dri", "vision", "pac"];
const FWD_KEYS: BuildStatKey[] = ["sho", "finishing", "pac", "dri"];

function groupBy<T>(items: T[], key: (item: T) => string | number) {
  const map = new Map<string | number, T[]>();
  for (const item of items) {
    const group = key(item);
    map.set(group, [...(map.get(group) ?? []), item]);
  }
  return map;
}

function uniquePlayers(picks: PickRecord[]) {
  const seen = new Map<number, PickRecord>();
  for (const pick of picks) if (!seen.has(pick.playerId)) seen.set(pick.playerId, pick);
  return [...seen.values()];
}

/**
 * Chemistry is built only from published facts we already store: current club,
 * nationality, position, role, and whether a roll arrived as prime.
 * There is no invented "played together in 2019" history.
 */
export function evaluateChemistry(picks: PickRecord[]): ChemLink[] {
  if (picks.length < 2) return [];
  const links: ChemLink[] = [];
  const players = uniquePlayers(picks);

  for (const [teamId, group] of groupBy(players, (pick) => pick.teamId)) {
    if (group.length < 2) continue;
    const ids = group.map((pick) => pick.playerId);
    const club = group[0].teamName;
    if (group.length >= 4) {
      links.push({ id: `club4-${teamId}`, title: "Dressing room", detail: `4 ${club} players in the build`, boost: 3, keys: "all", playerIds: ids });
    } else if (group.length >= 3) {
      links.push({ id: `club3-${teamId}`, title: "Clubmates", detail: `3 ${club} players in the build`, boost: 2, keys: "all", playerIds: ids });
    } else {
      links.push({ id: `club2-${teamId}`, title: "Teammates", detail: `2 ${club} players in the build`, boost: 1, keys: "all", playerIds: ids });
    }
  }

  for (const [nation, group] of groupBy(
    players.filter((pick) => pick.nationality),
    (pick) => pick.nationality!,
  )) {
    if (group.length < 2) continue;
    const ids = group.map((pick) => pick.playerId);
    if (group.length >= 3) {
      links.push({ id: `nat3-${nation}`, title: "International", detail: `3 ${nation} players in the build`, boost: 2, keys: "all", playerIds: ids });
    } else {
      links.push({ id: `nat2-${nation}`, title: "Same passport", detail: `2 ${nation} players in the build`, boost: 1, keys: "all", playerIds: ids });
    }
  }

  // Club + country: two players who share both team and nationality.
  for (const [teamId, clubGroup] of groupBy(players, (pick) => pick.teamId)) {
    for (const [nation, nationGroup] of groupBy(
      clubGroup.filter((pick) => pick.nationality),
      (pick) => pick.nationality!,
    )) {
      if (nationGroup.length < 2) continue;
      links.push({
        id: `clubnat-${teamId}-${nation}`,
        title: "Club & country",
        detail: `2 ${nationGroup[0].teamName} / ${nation} teammates`,
        boost: 2,
        keys: "all",
        playerIds: nationGroup.map((pick) => pick.playerId),
      });
    }
  }

  const defenders = players.filter((pick) => pick.position === "D");
  if (defenders.length >= 2) {
    links.push({
      id: "backline",
      title: "Back line",
      detail: `${defenders.length} defenders stitching the defence`,
      boost: defenders.length >= 3 ? 2 : 1,
      keys: DEF_KEYS,
      playerIds: defenders.map((pick) => pick.playerId),
    });
  }

  const mids = players.filter((pick) => pick.position === "M");
  if (mids.length >= 2) {
    links.push({
      id: "engine",
      title: "Engine room",
      detail: `${mids.length} midfielders linking the play`,
      boost: mids.length >= 3 ? 2 : 1,
      keys: MID_KEYS,
      playerIds: mids.map((pick) => pick.playerId),
    });
  }

  const forwards = players.filter((pick) => pick.position === "F");
  if (forwards.length >= 2) {
    links.push({
      id: "frontline",
      title: "Front line",
      detail: `${forwards.length} attackers in the mix`,
      boost: forwards.length >= 3 ? 2 : 1,
      keys: FWD_KEYS,
      playerIds: forwards.map((pick) => pick.playerId),
    });
  }

  const hasFirst = players.some((pick) => pick.role === "First team");
  const hasBench = players.some((pick) => pick.role === "Bench");
  if (hasFirst && hasBench) {
    links.push({
      id: "squad-depth",
      title: "Squad depth",
      detail: "First-team and bench parts in the same build",
      boost: 1,
      keys: ["reactions", "phy"],
      playerIds: players.map((pick) => pick.playerId),
    });
  }

  const primes = players.filter((pick) => pick.prime);
  if (primes.length >= 2) {
    links.push({
      id: "prime-duo",
      title: "Prime partnership",
      detail: `${primes.length} prime rolls in the build`,
      boost: 2,
      keys: "all",
      playerIds: primes.map((pick) => pick.playerId),
    });
  }

  // Spine: at least one defender, midfielder and forward.
  const positions = new Set(players.map((pick) => pick.position));
  if (positions.has("D") && positions.has("M") && positions.has("F")) {
    links.push({
      id: "spine",
      title: "Full spine",
      detail: "Defender, midfielder and forward all contribute",
      boost: 1,
      keys: "all",
      playerIds: players.map((pick) => pick.playerId),
    });
  }

  return links;
}

/** Per locked stat key, total chemistry points (capped). Stacking links add up, then clamp. */
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
