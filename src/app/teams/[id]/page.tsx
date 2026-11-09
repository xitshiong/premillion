import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getIndex, getTeam, playersForTeam } from "@/lib/data";
import { positionShort } from "@/lib/format";

type PageProps = { params: Promise<{ id: string }> };

export function generateStaticParams() {
  return getIndex().teams.map((team) => ({ id: String(team.id) }));
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { id } = await params;
  const team = getTeam(Number(id));
  return { title: team?.name ?? "Club" };
}

const ORDER = ["G", "D", "M", "F"];

export default async function TeamPage({ params }: PageProps) {
  const { id } = await params;
  const team = getTeam(Number(id));
  if (!team || !/^\d+$/.test(id)) notFound();
  const squad = playersForTeam(team.id).slice().sort((a, b) => {
    const left = ORDER.indexOf(a.position ?? "");
    const right = ORDER.indexOf(b.position ?? "");
    if (left !== right) return (left === -1 ? 9 : left) - (right === -1 ? 9 : right);
    return (a.shirtNumber ?? 999) - (b.shirtNumber ?? 999) || a.name.localeCompare(b.name);
  });
  const played = squad.filter((player) => player.minutes > 0).length;

  return (
    <div>
      <p className="text-sm text-muted-foreground">
        <Link href="/" className="hover:underline">
          Clubs
        </Link>
      </p>
      <h1 className="mt-2 font-serif text-5xl">{team.name}</h1>
      <p className="mt-2 text-muted-foreground">
        {squad.length} players on the Premier League list. {played} have minutes.
      </p>
      <div className="mt-6 overflow-x-auto rounded-xl border border-border bg-card">
        <table className="w-full min-w-[40rem] text-sm">
          <thead className="text-left text-muted-foreground">
            <tr>
              <th className="px-3 py-2 font-medium">No.</th>
              <th className="px-3 py-2 font-medium">Player</th>
              <th className="px-3 py-2 font-medium">Pos</th>
              <th className="px-3 py-2 text-right font-medium">Min</th>
              <th className="px-3 py-2 text-right font-medium">G</th>
              <th className="px-3 py-2 text-right font-medium">A</th>
            </tr>
          </thead>
          <tbody>
            {squad.map((player) => (
              <tr key={player.id} className="border-t border-border">
                <td className="px-3 py-2 tabular-nums">{player.shirtNumber ?? "—"}</td>
                <td className="px-3 py-2">
                  <Link href={`/players/${player.id}`} className="font-medium hover:underline">
                    {player.name}
                  </Link>
                  {player.teamConflict ? (
                    <span className="mt-0.5 block text-xs text-muted-foreground">Record names {player.currentClubName}</span>
                  ) : null}
                </td>
                <td className="px-3 py-2">{positionShort(player.position)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{player.minutes}</td>
                <td className="px-3 py-2 text-right tabular-nums">{player.goals}</td>
                <td className="px-3 py-2 text-right tabular-nums">{player.assists}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
