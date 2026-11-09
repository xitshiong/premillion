import type { ClubRating } from "@/lib/ratings";

export type Fixture = { home: number; away: number };
export type MatchResult = Fixture & { homeGoals: number; awayGoals: number; week: number };
export type TableRow = {
  id: number;
  name: string;
  abbr: string | null;
  played: number;
  won: number;
  drawn: number;
  lost: number;
  goalsFor: number;
  goalsAgainst: number;
  points: number;
};

export function mulberry32(seed: number) {
  let state = seed >>> 0;
  return () => {
    state += 0x6d2b79f5;
    let next = state;
    next = Math.imul(next ^ (next >>> 15), next | 1);
    next ^= next + Math.imul(next ^ (next >>> 7), next | 61);
    return ((next ^ (next >>> 14)) >>> 0) / 4294967296;
  };
}

export function seasonWeeks(teamIds: number[]): Fixture[][] {
  const arr = [...teamIds];
  const count = arr.length;
  const firstHalf: Fixture[][] = [];
  for (let round = 0; round < count - 1; round += 1) {
    const pairs: Fixture[] = [];
    for (let index = 0; index < count / 2; index += 1) {
      const left = arr[index];
      const right = arr[count - 1 - index];
      if (round % 2 === 0) pairs.push({ home: left, away: right });
      else pairs.push({ home: right, away: left });
    }
    firstHalf.push(pairs);
    arr.splice(1, 0, arr.pop() as number);
  }
  const secondHalf = firstHalf.map((week) => week.map((fixture) => ({ home: fixture.away, away: fixture.home })));
  return [...firstHalf, ...secondHalf];
}

function poisson(lambda: number, random: () => number) {
  const limit = Math.exp(-lambda);
  let count = 0;
  let product = 1;
  do {
    count += 1;
    product *= random();
  } while (product > limit);
  return count - 1;
}

function expectedGoals(attack: number, defense: number, home: boolean, base: number) {
  const floor = 20;
  const rate = base * (Math.max(floor, attack) / Math.max(floor, defense)) * (home ? 1.1 : 0.9);
  return Math.min(3.8, Math.max(0.15, rate));
}

export function simulateSeason(args: {
  clubs: ClubRating[];
  userClubId: number;
  userAttack: number;
  userDefense: number;
  goalsPerTeamGame: number;
  seed: number;
}) {
  const ratings = new Map(args.clubs.map((club) => [club.id, club]));
  const userClub = ratings.get(args.userClubId);
  if (!userClub) throw new Error("Missing club");
  const attack = new Map<number, number>();
  const defense = new Map<number, number>();
  for (const club of args.clubs) {
    if (club.id === args.userClubId) {
      attack.set(club.id, (club.attack * club.squad + args.userAttack) / (club.squad + 1));
      defense.set(club.id, (club.defense * club.squad + args.userDefense) / (club.squad + 1));
    } else {
      attack.set(club.id, club.attack);
      defense.set(club.id, club.defense);
    }
  }

  const random = mulberry32(args.seed);
  const weeks = seasonWeeks(args.clubs.map((club) => club.id));
  const matches: MatchResult[] = [];
  weeks.forEach((week, index) => {
    for (const fixture of week) {
      const homeGoals = poisson(
        expectedGoals(attack.get(fixture.home) ?? 50, defense.get(fixture.away) ?? 50, true, args.goalsPerTeamGame),
        random,
      );
      const awayGoals = poisson(
        expectedGoals(attack.get(fixture.away) ?? 50, defense.get(fixture.home) ?? 50, false, args.goalsPerTeamGame),
        random,
      );
      matches.push({ ...fixture, homeGoals, awayGoals, week: index + 1 });
    }
  });

  const rows = new Map<number, TableRow>();
  for (const club of args.clubs) {
    rows.set(club.id, {
      id: club.id,
      name: club.name,
      abbr: club.abbr,
      played: 0,
      won: 0,
      drawn: 0,
      lost: 0,
      goalsFor: 0,
      goalsAgainst: 0,
      points: 0,
    });
  }
  for (const match of matches) {
    const home = rows.get(match.home);
    const away = rows.get(match.away);
    if (!home || !away) continue;
    home.played += 1;
    away.played += 1;
    home.goalsFor += match.homeGoals;
    home.goalsAgainst += match.awayGoals;
    away.goalsFor += match.awayGoals;
    away.goalsAgainst += match.homeGoals;
    if (match.homeGoals > match.awayGoals) {
      home.won += 1;
      home.points += 3;
      away.lost += 1;
    } else if (match.homeGoals < match.awayGoals) {
      away.won += 1;
      away.points += 3;
      home.lost += 1;
    } else {
      home.drawn += 1;
      away.drawn += 1;
      home.points += 1;
      away.points += 1;
    }
  }
  const table = [...rows.values()].sort((a, b) => {
    const goalDiff = b.goalsFor - b.goalsAgainst - (a.goalsFor - a.goalsAgainst);
    return b.points - a.points || goalDiff || b.goalsFor - a.goalsFor || a.name.localeCompare(b.name);
  });
  return { matches, table, weeks: weeks.length };
}
