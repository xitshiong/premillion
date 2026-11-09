import type { Metadata } from "next";
import { PlayerDirectory } from "@/components/player-directory";
import { getIndex } from "@/lib/data";

export const metadata: Metadata = { title: "Players" };

export default function PlayersPage() {
  const { players, teams, meta } = getIndex();
  return (
    <div>
      <h1 className="font-serif text-4xl">Players</h1>
      <p className="mt-2 max-w-2xl text-muted-foreground">
        Everyone on a {meta.season} Premier League club list. The five columns show the rate, and the percentile once a player has {meta.minimumMinutes} minutes. A dash means that rate is not published.
      </p>
      <div className="mt-6">
        <PlayerDirectory players={players} teams={teams} />
      </div>
    </div>
  );
}
