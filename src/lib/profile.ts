export type AchievementId =
  | "first_stitch"
  | "world_steal"
  | "prime_time"
  | "champion"
  | "europe"
  | "midtable_hero"
  | "relegated"
  | "quest_hunter"
  | "monster_85"
  | "monster_90"
  | "ten_runs"
  | "loyal_fan";

export type Achievement = {
  id: AchievementId;
  title: string;
  detail: string;
};

export const ACHIEVEMENTS: Achievement[] = [
  { id: "first_stitch", title: "First stitch", detail: "Finish a ten-stat build" },
  { id: "world_steal", title: "World steal", detail: "Lock a 90+ attribute" },
  { id: "prime_time", title: "Prime time", detail: "Roll a player in his prime" },
  { id: "champion", title: "Champions", detail: "Win the league" },
  { id: "europe", title: "Europe nights", detail: "Finish in the top four" },
  { id: "midtable_hero", title: "Mid-table hero", detail: "Finish between 8th and 14th" },
  { id: "relegated", title: "The drop", detail: "Get relegated" },
  { id: "quest_hunter", title: "Quest hunter", detail: "Clear 5 quests in one build" },
  { id: "monster_85", title: "Elite monster", detail: "Build an 85+ player" },
  { id: "monster_90", title: "World monster", detail: "Build a 90+ player" },
  { id: "ten_runs", title: "Serial stitcher", detail: "Play 10 seasons" },
  { id: "loyal_fan", title: "Loyal fan", detail: "Complete the one-club-man quest" },
];

export type Profile = {
  name: string;
  runs: number;
  builds: number;
  bestPlace: number | null;
  champions: number;
  topFour: number;
  primesSeen: number;
  worldPicks: number;
  questsDone: number;
  unlocked: AchievementId[];
  lastClub: string | null;
  updatedAt: number;
};

const KEY = "premillion:profile";
const LEGACY_KEY = "frankenballer:profile";
const DEFAULT: Profile = {
  name: "Manager",
  runs: 0,
  builds: 0,
  bestPlace: null,
  champions: 0,
  topFour: 0,
  primesSeen: 0,
  worldPicks: 0,
  questsDone: 0,
  unlocked: [],
  lastClub: null,
  updatedAt: 0,
};

const listeners = new Set<() => void>();
let cache: Profile | null = null;

function read(): Profile {
  if (cache) return cache;
  if (typeof window === "undefined") return DEFAULT;
  try {
    const raw = window.localStorage.getItem(KEY) ?? window.localStorage.getItem(LEGACY_KEY);
    cache = raw ? { ...DEFAULT, ...JSON.parse(raw) } : { ...DEFAULT };
  } catch {
    cache = { ...DEFAULT };
  }
  return cache!;
}

function write(next: Profile) {
  cache = { ...next, updatedAt: Date.now() };
  if (typeof window !== "undefined") window.localStorage.setItem(KEY, JSON.stringify(cache));
  listeners.forEach((listener) => listener());
}

export const profileStore = {
  subscribe(listener: () => void) {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
  get: () => read(),
  getServer: () => DEFAULT,
  setName(name: string) {
    write({ ...read(), name: name.trim().slice(0, 24) || "Manager" });
  },
  unlock(ids: AchievementId[]) {
    const profile = read();
    const fresh = ids.filter((id) => !profile.unlocked.includes(id));
    if (!fresh.length) return [] as AchievementId[];
    write({ ...profile, unlocked: [...profile.unlocked, ...fresh] });
    return fresh;
  },
  noteBuild(rating: number, worldPicks: number, quests: number, hadPrime: boolean) {
    const profile = read();
    const unlocked: AchievementId[] = ["first_stitch"];
    if (worldPicks > 0) unlocked.push("world_steal");
    if (hadPrime) unlocked.push("prime_time");
    if (quests >= 5) unlocked.push("quest_hunter");
    if (rating >= 85) unlocked.push("monster_85");
    if (rating >= 90) unlocked.push("monster_90");
    write({
      ...profile,
      builds: profile.builds + 1,
      worldPicks: profile.worldPicks + worldPicks,
      questsDone: profile.questsDone + quests,
      primesSeen: profile.primesSeen + (hadPrime ? 1 : 0),
    });
    return this.unlock(unlocked);
  },
  noteSeason(place: number, clubName: string) {
    const profile = read();
    const unlocked: AchievementId[] = [];
    if (place === 1) unlocked.push("champion");
    if (place <= 4) unlocked.push("europe");
    if (place >= 8 && place <= 14) unlocked.push("midtable_hero");
    if (place >= 18) unlocked.push("relegated");
    const runs = profile.runs + 1;
    if (runs >= 10) unlocked.push("ten_runs");
    write({
      ...profile,
      runs,
      champions: profile.champions + (place === 1 ? 1 : 0),
      topFour: profile.topFour + (place <= 4 ? 1 : 0),
      bestPlace: profile.bestPlace === null ? place : Math.min(profile.bestPlace, place),
      lastClub: clubName,
    });
    return this.unlock(unlocked);
  },
  noteQuest(id: string) {
    if (id === "loyal") return this.unlock(["loyal_fan"]);
    return [] as AchievementId[];
  },
};
