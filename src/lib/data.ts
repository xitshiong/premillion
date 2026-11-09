import fs from "node:fs";
import path from "node:path";

export type Rate = {
  key: string;
  label: string;
  group: string;
  value: number | null;
  unit: string;
  formula: string;
  source: string;
  peerGroup: string;
  featured: boolean;
  eligible: boolean;
  percentile: number | null;
  peerCount: number;
  minutesUsed: number | null;
  attemptsUsed: number | null;
};

export type IndexRate = {
  key: string;
  label: string;
  value: number | null;
  unit: string;
  eligible: boolean;
  percentile: number | null;
};

export type IndexPlayer = {
  id: number;
  name: string;
  position: string | null;
  positionInfo: string | null;
  shirtNumber: number | null;
  teamId: number;
  currentClubName: string | null;
  teamConflict: boolean;
  nationality: string | null;
  minutes: number;
  appearances: number;
  goals: number;
  assists: number;
  fplMatch: string;
  featured: IndexRate[];
};

export type Team = {
  id: number;
  name: string;
  short_name: string | null;
  abbr: string | null;
  fpl_id: number;
  fpl_name: string;
};

export type FplGap = {
  fplId: number;
  name: string;
  webName: string;
  team: string;
  opta: string | null;
  minutes: number;
  status: string;
  news: string;
  expectedGoals: number | null;
  expectedAssists: number | null;
  goals: number;
  assists: number;
};

export type Meta = {
  season: string;
  competition: string;
  fetchedAt: string;
  playerCount: number;
  teamCount: number;
  playersWithMinutes: number;
  fplMatched: number;
  fplUnmatchedCount: number;
  teamConflicts: number;
  minimumMinutes: number;
  currentGameweek: {
    id: number;
    name: string;
    finished: boolean;
    dataChecked: boolean;
    deadline: string;
  };
  finishedGameweeks: number[];
  zeroFillRule: string;
  ratingRule: string;
  notPublished: string[];
  sources: { name: string; url: string; usedFor: string }[];
  fplUnmatched: FplGap[];
};

export type FeaturedDefinition = {
  key: string;
  label: string;
  unit: string;
  formula: string;
  source: string;
  peerGroup: string;
  group: string;
};

export type IndexFile = {
  meta: Meta;
  teams: Team[];
  players: IndexPlayer[];
  featuredDefinitions: FeaturedDefinition[];
};

export type RawStat = {
  name: string;
  label: string;
  group: string;
  value: number;
  reported: boolean;
};

export type PlayerDetail = {
  id: number;
  name: string;
  firstName: string | null;
  lastName: string | null;
  position: string | null;
  positionInfo: string | null;
  shirtNumber: number | null;
  teamId: number;
  currentClubName: string | null;
  teamConflict: boolean;
  nationality: string | null;
  birthLabel: string | null;
  birthIso: string | null;
  heightCm: number | null;
  weightKg: number | null;
  loan: boolean;
  optaId: string | null;
  fplId: number | null;
  fplMatch: string;
  minutes: number;
  appearances: number;
  starts: number;
  goals: number;
  assists: number;
  fplMinutes: number | null;
  fpl: {
    minutes: number;
    expectedGoals: number | null;
    expectedAssists: number | null;
    expectedGoalsPer90Published: number | null;
    expectedAssistsPer90Published: number | null;
    goals: number;
    assists: number;
  } | null;
  featured: Rate[];
  supporting: Rate[];
  raw: RawStat[];
};

const dataDir = path.join(process.cwd(), "data");
let indexCache: IndexFile | null = null;

export function getIndex(): IndexFile {
  if (!indexCache) {
    indexCache = JSON.parse(fs.readFileSync(path.join(dataDir, "index.json"), "utf8")) as IndexFile;
  }
  return indexCache;
}

export function getTeam(id: number): Team | undefined {
  return getIndex().teams.find((team) => team.id === id);
}

export function getPlayer(id: string): PlayerDetail | null {
  if (!/^\d+$/.test(id)) return null;
  const file = path.join(dataDir, "players", `${id}.json`);
  if (!fs.existsSync(file)) return null;
  return JSON.parse(fs.readFileSync(file, "utf8")) as PlayerDetail;
}

export function playersForTeam(teamId: number): IndexPlayer[] {
  return getIndex().players.filter((player) => player.teamId === teamId);
}
