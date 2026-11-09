import type { RollPlayer, RollStat } from "@/lib/ratings";

export type PickRecord = RollStat & {
  order: number;
  playerId: number;
  playerName: string;
  teamId: number;
  teamName: string;
  role: RollPlayer["role"];
  position: string;
  overall: number;
  goals: number;
  assists: number;
};

export type Reward = { team: number; player: number };

export type QuestDef = {
  id: string;
  title: string;
  detail: string;
  target: number;
  reward: Reward;
  count: (picks: PickRecord[]) => number;
};

export type ActiveQuest = { id: string; since: number };
export type DoneQuest = { id: string; at: number; banked: boolean };

const countWhere = (test: (pick: PickRecord) => boolean) => (picks: PickRecord[]) => picks.filter(test).length;

export const QUESTS: QuestDef[] = [
  { id: "world", title: "Top drawer", detail: "Lock any stat rated 88+", target: 1, reward: { team: 1, player: 0 }, count: countWhere((pick) => pick.value >= 88) },
  { id: "bench", title: "Off the bench", detail: "Take a stat from a bench player", target: 1, reward: { team: 0, player: 1 }, count: countWhere((pick) => pick.role === "Bench") },
  { id: "backline", title: "Built from the back", detail: "Take 2 stats from defenders", target: 2, reward: { team: 1, player: 0 }, count: countWhere((pick) => pick.position === "D") },
  { id: "engine", title: "Engine room", detail: "Take 2 stats from midfielders", target: 2, reward: { team: 0, player: 1 }, count: countWhere((pick) => pick.position === "M") },
  { id: "scorer", title: "Goal getter", detail: "Take a stat from a player with 2+ league goals", target: 1, reward: { team: 0, player: 1 }, count: countWhere((pick) => pick.goals >= 2) },
  { id: "creator", title: "Creator", detail: "Take a stat from a player with 2+ league assists", target: 1, reward: { team: 0, player: 1 }, count: countWhere((pick) => pick.assists >= 2) },
  { id: "rapid", title: "Rapid", detail: "Lock pace at 85+", target: 1, reward: { team: 0, player: 1 }, count: countWhere((pick) => pick.key === "pac" && pick.value >= 85) },
  { id: "diamond", title: "Rough diamond", detail: "Take an 80+ stat from a player rated 75 or lower", target: 1, reward: { team: 1, player: 0 }, count: countWhere((pick) => pick.value >= 80 && pick.overall <= 75) },
  { id: "elite", title: "Elite pair", detail: "Lock two stats rated 85+", target: 2, reward: { team: 0, player: 2 }, count: countWhere((pick) => pick.value >= 85) },
  {
    id: "loyal",
    title: "One-club man",
    detail: "Take 2 stats from the same club",
    target: 2,
    reward: { team: 2, player: 0 },
    count: (picks) => {
      const clubs = new Map<number, number>();
      for (const pick of picks) clubs.set(pick.teamId, (clubs.get(pick.teamId) ?? 0) + 1);
      return Math.max(0, ...clubs.values());
    },
  },
];

const QUEST_BY_ID = new Map(QUESTS.map((quest) => [quest.id, quest]));
export const questById = (id: string) => QUEST_BY_ID.get(id)!;

export const STREAK_QUEST: QuestDef = {
  id: "streak",
  title: "No second thoughts",
  detail: "Make 3 picks in a row without rerolling",
  target: 3,
  reward: { team: 1, player: 1 },
  count: (picks) => picks.length,
};
QUEST_BY_ID.set(STREAK_QUEST.id, STREAK_QUEST);

export const ACTIVE_QUESTS = 3;

/** The streak quest always opens a run so every build has one quest that is reachable without lucky rolls. */
export function shuffledQuestIds(random: () => number) {
  const ids = QUESTS.map((quest) => quest.id);
  for (let index = ids.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(random() * (index + 1));
    [ids[index], ids[swap]] = [ids[swap], ids[index]];
  }
  ids.splice(Math.floor(random() * ACTIVE_QUESTS), 0, STREAK_QUEST.id);
  return ids;
}

/** Progress only counts picks made while the quest was active; the streak quest also restarts after any reroll. */
export function questProgress(active: ActiveQuest, picks: PickRecord[], lastRerollAt: number) {
  const quest = questById(active.id);
  const from = quest.id === STREAK_QUEST.id ? Math.max(active.since, lastRerollAt) : active.since;
  return Math.min(quest.target, quest.count(picks.filter((pick) => pick.order >= from)));
}

export function rewardText(reward: Reward) {
  const parts = [];
  if (reward.team) parts.push(`+${reward.team} team`);
  if (reward.player) parts.push(`+${reward.player} player`);
  return parts.join(" · ");
}

export function rerollText(reward: Reward) {
  return `${rewardText(reward)} reroll${reward.team + reward.player > 1 ? "s" : ""}`;
}

export function seasonBonus(place: number): Reward {
  if (place === 1) return { team: 2, player: 2 };
  if (place <= 4) return { team: 1, player: 1 };
  if (place <= 7) return { team: 0, player: 1 };
  return { team: 0, player: 0 };
}
