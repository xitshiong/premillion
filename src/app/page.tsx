import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import { getIndex } from "@/lib/data";
import { formatRate, melbourneTime, positionShort } from "@/lib/format";

const SPOTLIGHT = [
  { key: "shooting", blurb: "Expected goals per 90" },
  { key: "dribbling", blurb: "Completed dribbles per 90" },
  { key: "aerials", blurb: "Aerial duels won per 90" },
] as const;

export default function HomePage() {
  const { meta, teams, players, featuredDefinitions } = getIndex();
  const rated = players.filter((player) => player.minutes >= meta.minimumMinutes).length;
  const leaders = SPOTLIGHT.map((item) => {
    const ranked = players
      .map((player) => ({ player, stat: player.featured.find((stat) => stat.key === item.key) }))
      .filter((row) => row.stat?.eligible && row.stat.percentile != null)
      .sort((a, b) => (b.stat?.percentile ?? 0) - (a.stat?.percentile ?? 0));
    return { ...item, leader: ranked[0] };
  });

  return (
    <div>
      <p className="text-sm font-medium tracking-[0.16em] text-primary uppercase">{meta.season} Premier League</p>
      <h1 className="mt-2 max-w-3xl font-serif text-5xl leading-[1.05] text-balance">Every player on a club list, with the season’s published numbers.</h1>
      <p className="mt-4 max-w-2xl text-lg text-muted-foreground">
        This is the database for the build-a-player game. Roll a Premier League footballer later. First, the counts those picks have to come from, fetched on {melbourneTime(meta.fetchedAt)}.
      </p>
      <div className="mt-6 flex flex-wrap gap-3">
        <Link href="/players" className={buttonVariants()}>
          Browse {meta.playerCount} players
        </Link>
        <Link href="/method" className={buttonVariants({ variant: "outline" })}>
          How a stat is calculated
        </Link>
      </div>

      <dl className="mt-8 grid gap-3 sm:grid-cols-3">
        {[
          [meta.playerCount, "On the twenty club lists"],
          [meta.playersWithMinutes, "Have played minutes"],
          [rated, `At least ${meta.minimumMinutes} minutes, so they can be ranked`],
        ].map(([value, label]) => (
          <div key={String(label)} className="rounded-xl border border-border bg-card px-4 py-4">
            <dt className="font-serif text-4xl tabular-nums">{value}</dt>
            <dd className="mt-1 text-sm text-muted-foreground">{label}</dd>
          </div>
        ))}
      </dl>

      <section className="mt-10">
        <h2 className="font-serif text-3xl">Where the book stands</h2>
        <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
          Gameweeks {meta.finishedGameweeks[0]}–{meta.finishedGameweeks.at(-1)} are marked finished. {meta.currentGameweek.name} is the current gameweek
          {meta.currentGameweek.dataChecked ? " and its data is checked." : " and its data was not checked yet, so a few match totals can still move."}
        </p>
        <div className="mt-4 grid gap-3 md:grid-cols-3">
          {leaders.map((item) => {
            const leader = item.leader;
            if (!leader?.stat) return null;
            const team = teams.find((club) => club.id === leader.player.teamId);
            return (
              <Link key={item.key} href={`/players/${leader.player.id}`} className="rounded-xl border border-border bg-card p-4 hover:border-primary">
                <p className="text-xs tracking-wide text-muted-foreground uppercase">{item.blurb}</p>
                <p className="mt-2 font-serif text-2xl">{leader.player.name}</p>
                <p className="text-sm text-muted-foreground">
                  {team?.name} · {positionShort(leader.player.position)}
                </p>
                <p className="mt-3 font-serif text-3xl tabular-nums">
                  {formatRate(leader.stat.value, leader.stat.unit)}
                  <span className="ml-2 font-sans text-sm text-muted-foreground">{leader.stat.percentile?.toFixed(1)} pct</span>
                </p>
              </Link>
            );
          })}
        </div>
      </section>

      <section className="mt-10">
        <h2 className="font-serif text-3xl">The stats you will be able to take</h2>
        <p className="mt-2 max-w-2xl text-muted-foreground">
          Ten outfield measures, plus four for goalkeepers. Each one is a rate from a published count. The percentile compares players who cleared the sample. It is not an official rating.
        </p>
        <div className="mt-4 grid gap-3 md:grid-cols-2">
          {featuredDefinitions.map((stat) => (
            <article key={stat.key} className="rounded-xl border border-border bg-card px-4 py-3">
              <h3 className="font-medium">{stat.label}</h3>
              <p className="mt-1 text-sm text-muted-foreground">{stat.formula}</p>
              <p className="mt-2 text-xs text-muted-foreground">{stat.source}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="mt-10">
        <h2 className="font-serif text-3xl">Clubs</h2>
        <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
          {teams.map((team) => (
            <Link key={team.id} href={`/teams/${team.id}`} className="rounded-lg border border-border bg-card px-3 py-3 text-sm hover:border-primary">
              <span className="block font-medium">{team.name}</span>
              <span className="text-muted-foreground">{team.abbr}</span>
            </Link>
          ))}
        </div>
      </section>
    </div>
  );
}
