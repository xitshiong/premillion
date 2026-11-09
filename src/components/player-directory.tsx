"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { formatRate, positionShort } from "@/lib/format";
import type { IndexPlayer, Team } from "@/lib/data";

const STATS = [
  { key: "shooting", label: "Shooting" },
  { key: "passing", label: "Passing" },
  { key: "vision", label: "Vision" },
  { key: "dribbling", label: "Dribbling" },
  { key: "aerials", label: "Aerials" },
] as const;

type Row = {
  id: number;
  name: string;
  position: string | null;
  positionInfo: string | null;
  teamId: number;
  teamName: string;
  minutes: number;
  goals: number;
  assists: number;
  teamConflict: boolean;
  stats: Record<string, { value: number | null; percentile: number | null; unit: string; eligible: boolean }>;
};

export function PlayerDirectory({ players, teams }: { players: IndexPlayer[]; teams: Team[] }) {
  const [query, setQuery] = useState("");
  const [position, setPosition] = useState("all");
  const [teamId, setTeamId] = useState("all");
  const [sample, setSample] = useState("all");
  const [sort, setSort] = useState("minutes");

  const teamName = useMemo(() => new Map(teams.map((team) => [team.id, team.name])), [teams]);
  const rows = useMemo<Row[]>(
    () =>
      players.map((player) => ({
        id: player.id,
        name: player.name,
        position: player.position,
        positionInfo: player.positionInfo,
        teamId: player.teamId,
        teamName: teamName.get(player.teamId) ?? "Unknown club",
        minutes: player.minutes,
        goals: player.goals,
        assists: player.assists,
        teamConflict: player.teamConflict,
        stats: Object.fromEntries(
          player.featured.map((stat) => [
            stat.key,
            { value: stat.value, percentile: stat.percentile, unit: stat.unit, eligible: stat.eligible },
          ]),
        ),
      })),
    [players, teamName],
  );

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const filtered = rows.filter((player) => {
      if (needle && !player.name.toLowerCase().includes(needle) && !player.teamName.toLowerCase().includes(needle)) return false;
      if (position !== "all" && player.position !== position) return false;
      if (teamId !== "all" && String(player.teamId) !== teamId) return false;
      if (sample === "played" && player.minutes <= 0) return false;
      if (sample === "rated" && player.minutes < 270) return false;
      return true;
    });
    const valueOf = (player: Row) => {
      if (sort === "name") return player.name;
      if (sort === "goals") return player.goals;
      if (sort === "minutes") return player.minutes;
      const stat = player.stats[sort];
      return stat?.percentile ?? -1;
    };
    filtered.sort((a, b) => {
      const left = valueOf(a);
      const right = valueOf(b);
      if (typeof left === "string" && typeof right === "string") return left.localeCompare(right);
      return Number(right) - Number(left);
    });
    return filtered;
  }, [position, query, rows, sample, sort, teamId]);

  return (
    <div>
      <div className="grid gap-3 md:grid-cols-[1.4fr_repeat(4,minmax(0,1fr))]">
        <label className="grid gap-1 text-sm">
          Search
          <Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Name or club" />
        </label>
        <label className="grid gap-1 text-sm">
          Position
          <select className="h-8 rounded-lg border border-input bg-card px-2" value={position} onChange={(event) => setPosition(event.target.value)}>
            <option value="all">All</option>
            <option value="G">Goalkeepers</option>
            <option value="D">Defenders</option>
            <option value="M">Midfielders</option>
            <option value="F">Forwards</option>
          </select>
        </label>
        <label className="grid gap-1 text-sm">
          Club
          <select className="h-8 rounded-lg border border-input bg-card px-2" value={teamId} onChange={(event) => setTeamId(event.target.value)}>
            <option value="all">All clubs</option>
            {teams.map((team) => (
              <option key={team.id} value={team.id}>
                {team.name}
              </option>
            ))}
          </select>
        </label>
        <label className="grid gap-1 text-sm">
          Sample
          <select className="h-8 rounded-lg border border-input bg-card px-2" value={sample} onChange={(event) => setSample(event.target.value)}>
            <option value="all">Whole club list</option>
            <option value="played">Has minutes</option>
            <option value="rated">270 minutes or more</option>
          </select>
        </label>
        <label className="grid gap-1 text-sm">
          Sort
          <select className="h-8 rounded-lg border border-input bg-card px-2" value={sort} onChange={(event) => setSort(event.target.value)}>
            <option value="minutes">Minutes</option>
            <option value="goals">Goals</option>
            <option value="name">Name</option>
            {STATS.map((stat) => (
              <option key={stat.key} value={stat.key}>
                {stat.label} percentile
              </option>
            ))}
          </select>
        </label>
      </div>
      <p className="mt-3 text-sm text-muted-foreground">
        {visible.length} {visible.length === 1 ? "player" : "players"}
      </p>
      {visible.length === 0 ? (
        <p className="mt-4 rounded-xl border border-dashed border-border px-4 py-8 text-sm text-muted-foreground">
          No one on a club list matches that. Clear a filter or search a different name.
        </p>
      ) : (
        <>
          <div className="mt-4 hidden overflow-x-auto rounded-xl border border-border bg-card md:block">
            <table className="w-full min-w-[64rem] text-sm">
              <thead className="text-left text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 font-medium">Player</th>
                  <th className="px-3 py-2 font-medium">Club</th>
                  <th className="px-3 py-2 font-medium">Pos</th>
                  <th className="px-3 py-2 text-right font-medium">Min</th>
                  <th className="px-3 py-2 text-right font-medium">G</th>
                  <th className="px-3 py-2 text-right font-medium">A</th>
                  {STATS.map((stat) => (
                    <th key={stat.key} className="px-3 py-2 text-right font-medium">
                      {stat.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {visible.map((player) => (
                  <tr key={player.id} className="border-t border-border">
                    <td className="px-3 py-2">
                      <Link href={`/players/${player.id}`} className="font-medium underline-offset-2 hover:underline">
                        {player.name}
                      </Link>
                      {player.teamConflict ? <span className="ml-2 text-xs text-muted-foreground">other club on record</span> : null}
                    </td>
                    <td className="px-3 py-2">
                      <Link href={`/teams/${player.teamId}`} className="hover:underline">
                        {player.teamName}
                      </Link>
                    </td>
                    <td className="px-3 py-2">{positionShort(player.position)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{player.minutes}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{player.goals}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{player.assists}</td>
                    {STATS.map((stat) => {
                      const value = player.stats[stat.key];
                      return (
                        <td key={stat.key} className="px-3 py-2 text-right tabular-nums">
                          <div>{formatRate(value?.value ?? null, value?.unit ?? "per 90")}</div>
                          <div className="text-xs text-muted-foreground">
                            {value?.eligible && value.percentile != null ? `${value.percentile.toFixed(0)} pct` : "not ranked"}
                          </div>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="mt-4 grid gap-3 md:hidden">
            {visible.map((player) => (
              <Link key={player.id} href={`/players/${player.id}`} className="rounded-xl border border-border bg-card p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="font-serif text-xl leading-tight">{player.name}</p>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {player.teamName} · {player.minutes} min · {player.goals} goals
                    </p>
                  </div>
                  <Badge variant="outline">{positionShort(player.position)}</Badge>
                </div>
              </Link>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
