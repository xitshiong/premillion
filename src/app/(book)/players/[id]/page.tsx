import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { RawStats } from "@/components/raw-stats";
import { StatBars } from "@/components/stat-bars";
import { getIndex, getPlayer, getTeam } from "@/lib/data";
import { formatCount, positionName, positionShort } from "@/lib/format";

type PageProps = { params: Promise<{ id: string }> };

export function generateStaticParams() {
  return getIndex().players.map((player) => ({ id: String(player.id) }));
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { id } = await params;
  const player = getPlayer(id);
  return { title: player?.name ?? "Player" };
}

const OUTFIELD = ["shooting", "passing", "pass_completion", "vision", "chance_creation", "dribbling", "carrying", "aerials", "tackling", "pressing"];
const KEEPER = ["saves", "save_percentage", "claims", "sweeper", "pass_completion"];

export default async function PlayerPage({ params }: PageProps) {
  const { id } = await params;
  const player = getPlayer(id);
  if (!player) notFound();
  const team = getTeam(player.teamId);
  const primaryKeys = player.position === "G" ? KEEPER : OUTFIELD;
  const primary = primaryKeys
    .map((key) => player.featured.find((stat) => stat.key === key))
    .filter((stat) => stat != null);
  const extra = player.supporting;

  return (
    <article>
      <p className="text-sm text-muted-foreground">
        <Link href="/players" className="hover:underline">
          Players
        </Link>
        {team ? (
          <>
            {" / "}
            <Link href={`/teams/${team.id}`} className="hover:underline">
              {team.name}
            </Link>
          </>
        ) : null}
      </p>
      <div className="mt-3 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="font-serif text-5xl leading-none">{player.name}</h1>
          <p className="mt-3 text-muted-foreground">
            {player.positionInfo || positionName(player.position)}
            {player.shirtNumber != null ? ` · No. ${player.shirtNumber}` : ""}
            {player.nationality ? ` · ${player.nationality}` : ""}
            {player.birthLabel ? ` · born ${player.birthLabel}` : ""}
          </p>
          {player.heightCm || player.weightKg ? (
            <p className="mt-1 text-sm text-muted-foreground">
              Measured build: {player.heightCm ? `${player.heightCm} cm` : "height not published"}
              {player.weightKg ? `, ${player.weightKg} kg` : ""}. This is body size, not a physicality rating.
            </p>
          ) : null}
        </div>
        <Badge variant="outline">{positionShort(player.position)}</Badge>
      </div>

      {player.teamConflict ? (
        <p className="mt-4 rounded-xl border border-amber-700/30 bg-amber-50 px-4 py-3 text-sm text-amber-950">
          On the {team?.name ?? "club"} list for this Premier League season. The player record currently names {player.currentClubName ?? "another club"}. Any minutes below are still {getIndex().meta.season} Premier League minutes.
        </p>
      ) : null}

      <dl className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-5">
        {[
          ["Appearances", player.appearances],
          ["Starts", player.starts],
          ["Minutes", player.minutes],
          ["Goals", player.goals],
          ["Assists", player.assists],
        ].map(([label, value]) => (
          <div key={String(label)} className="rounded-xl border border-border bg-card px-3 py-3">
            <dt className="text-xs text-muted-foreground">{label}</dt>
            <dd className="font-serif text-3xl tabular-nums">{formatCount(Number(value))}</dd>
          </div>
        ))}
      </dl>

      {player.minutes === 0 ? (
        <p className="mt-4 rounded-xl border border-dashed border-border px-4 py-4 text-sm text-muted-foreground">
          No Premier League minutes in this season’s feed, so there is no rate to calculate. Counts are not filled with guesses.
        </p>
      ) : null}

      {player.fpl ? (
        <p className="mt-4 text-sm text-muted-foreground">
          Fantasy Premier League, joined on Opta id {player.optaId}: {player.fpl.expectedGoals?.toFixed(2)} expected goals and {player.fpl.expectedAssists?.toFixed(2)} expected assists in {player.fpl.minutes} minutes. Shooting and vision use those totals. The goal and assist counts above come from the Premier League feed{player.fpl.goals !== player.goals || player.fpl.assists !== player.assists ? ", which can differ by a minute or a goal while gameweek data is still being checked" : ""}.
        </p>
      ) : (
        <p className="mt-4 text-sm text-muted-foreground">No Fantasy Premier League row matched this Opta id, so expected goals and expected assists are left blank.</p>
      )}

      <section className="mt-8">
        <h2 className="font-serif text-3xl">{player.position === "G" ? "Goalkeeper stats" : "Stats you can take"}</h2>
        <div className="mt-4">
          <StatBars rates={primary} />
        </div>
      </section>

      {extra.length > 0 ? (
        <section className="mt-8">
          <h2 className="font-serif text-3xl">Other measured rates</h2>
          <p className="mt-1 text-sm text-muted-foreground">Same rule: a rate from the counts, ranked only when the sample is large enough.</p>
          <div className="mt-4">
            <StatBars rates={extra} />
          </div>
        </section>
      ) : null}

      <RawStats stats={player.raw} />
    </article>
  );
}
