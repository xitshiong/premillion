import type { Metadata } from "next";
import Link from "next/link";
import { getIndex } from "@/lib/data";
import { melbourneTime } from "@/lib/format";

export const metadata: Metadata = { title: "How the numbers are made" };

export default function MethodPage() {
  const { meta, players, teams } = getIndex();
  const teamName = new Map(teams.map((team) => [team.id, team.name]));
  const conflicts = players.filter((player) => player.teamConflict);
  const playedElsewhere = meta.fplUnmatched.filter((player) => player.minutes > 0).sort((a, b) => b.minutes - a.minutes);
  const idleElsewhere = meta.fplUnmatched.filter((player) => player.minutes <= 0);

  return (
    <article className="max-w-3xl">
      <h1 className="font-serif text-5xl leading-tight">How the numbers are made</h1>
      <p className="mt-4 text-lg text-muted-foreground">
        Fetched {melbourneTime(meta.fetchedAt)}. Season {meta.season}. Nothing in the rating tables was estimated from a player’s reputation.
      </p>

      <h2 className="mt-8 font-serif text-3xl">Sources</h2>
      <ul className="mt-3 grid gap-3">
        {meta.sources.map((source) => (
          <li key={source.name} className="rounded-xl border border-border bg-card px-4 py-3">
            <p className="font-medium">{source.name}</p>
            <p className="text-sm text-muted-foreground">{source.usedFor}</p>
            <p className="mt-1 break-all font-mono text-xs text-muted-foreground">{source.url}</p>
          </li>
        ))}
      </ul>

      <h2 className="mt-8 font-serif text-3xl">What gets stored</h2>
      <p className="mt-3 text-muted-foreground">{meta.zeroFillRule}</p>
      <p className="mt-3 text-muted-foreground">
        Rúben Dias is the worked example. The feed published 862 completed passes out of 943, and 900 minutes, and it left goals off the payload. Goals are stored as 0 and marked “filled zero”, not as a typed guess.
      </p>
      <p className="mt-3 text-muted-foreground">{meta.ratingRule}</p>
      <ul className="mt-3 list-disc space-y-1 pl-5 text-muted-foreground">
        <li>Per-90 rates start at 90 minutes. One minute and one action is not turned into a rate.</li>
        <li>Percentiles start at {meta.minimumMinutes} minutes for counting rates.</li>
        <li>Pass completion also needs 50 passes. Shot accuracy needs 8 shots. Dribble success needs 8 attempts. Aerial win rate needs 8 duels. Tackle win rate needs 8 tackles. Duel win rate needs 10 duels. Save percentage needs 15 shots faced, counted as saves plus goals conceded.</li>
        <li>A percentile is a mid-rank from 0 to 100. The highest value in the group is 100. Ties share the middle of their ranks.</li>
        <li>Shooting and vision use expected goals and expected assists. Passing is completed passes into the final third per 90, because completion percentage rewards short passes and is stored separately.</li>
      </ul>

      <h2 className="mt-8 font-serif text-3xl">Left out on purpose</h2>
      <ul className="mt-3 list-disc space-y-1 pl-5 text-muted-foreground">
        {meta.notPublished.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>

      <h2 className="mt-8 font-serif text-3xl">Club list against the player record</h2>
      <p className="mt-3 text-muted-foreground">
        {conflicts.length} players are on a Premier League club list while their player record names a different current club. They stay in the book. The squad page says so.
      </p>
      <ul className="mt-3 grid gap-2 text-sm">
        {conflicts.map((player) => (
          <li key={player.id}>
            <Link href={`/players/${player.id}`} className="font-medium hover:underline">
              {player.name}
            </Link>
            <span className="text-muted-foreground">
              {" "}
              · listed by {teamName.get(player.teamId)} · record says {player.currentClubName} · {player.minutes} minutes
            </span>
          </li>
        ))}
      </ul>

      <h2 className="mt-8 font-serif text-3xl">Fantasy list, not on a club list</h2>
      <p className="mt-3 text-muted-foreground">
        {playedElsewhere.length} Fantasy Premier League players have minutes this season and are not on a current club list. Their event counts are not copied in as if the Premier League stat feed had published them.
      </p>
      <ul className="mt-3 grid gap-2 text-sm">
        {playedElsewhere.map((player) => (
          <li key={player.fplId} className="rounded-lg border border-border bg-card px-3 py-2">
            <span className="font-medium">{player.name}</span>
            <span className="text-muted-foreground">
              {" "}
              · {player.team} · {player.minutes} minutes · {player.goals} goals · {player.expectedGoals?.toFixed(2) ?? "—"} xG
            </span>
            {player.news ? <span className="mt-1 block text-muted-foreground">{player.news}</span> : null}
          </li>
        ))}
      </ul>
      <p className="mt-3 text-sm text-muted-foreground">
        Another {idleElsewhere.length} Fantasy Premier League names have no minutes and are not on a club list. They are in the database meta and not in the player pages.
      </p>
    </article>
  );
}
