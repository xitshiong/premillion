"use client";

import { useMemo, useState } from "react";
import { formatCount } from "@/lib/format";
import type { RawStat } from "@/lib/data";

export function RawStats({ stats }: { stats: RawStat[] }) {
  const [showZeroes, setShowZeroes] = useState(false);
  const groups = useMemo(() => {
    const visible = showZeroes ? stats : stats.filter((stat) => stat.value !== 0);
    const order: string[] = [];
    const byGroup = new Map<string, RawStat[]>();
    for (const stat of visible) {
      if (!byGroup.has(stat.group)) {
        order.push(stat.group);
        byGroup.set(stat.group, []);
      }
      byGroup.get(stat.group)?.push(stat);
    }
    return order.map((group) => ({ group, stats: byGroup.get(group) ?? [] }));
  }, [showZeroes, stats]);

  return (
    <section className="mt-10">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="font-serif text-2xl">Every published count</h2>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            A zero with “filled” was missing from this player’s feed. The Premier League omits a lot of zeroes, so those are stored as zero after a player has minutes. Nothing here was typed in.
          </p>
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={showZeroes}
            onChange={(event) => setShowZeroes(event.target.checked)}
            className="size-4 accent-[#143028]"
          />
          Show zeroes
        </label>
      </div>
      {groups.length === 0 ? (
        <p className="mt-4 rounded-xl border border-dashed border-border px-4 py-6 text-sm text-muted-foreground">
          No non-zero counts. Turn on zeroes to see the filled values, or this player has no season feed yet.
        </p>
      ) : (
        <div className="mt-4 grid gap-4">
          {groups.map(({ group, stats: rows }) => (
            <details key={group} open className="rounded-xl border border-border bg-card">
              <summary className="cursor-pointer px-4 py-3 font-medium">{group}</summary>
              <div className="overflow-x-auto border-t border-border">
                <table className="w-full min-w-[36rem] text-sm">
                  <thead className="text-left text-muted-foreground">
                    <tr>
                      <th className="px-4 py-2 font-medium">Stat</th>
                      <th className="px-4 py-2 font-medium">Feed name</th>
                      <th className="px-4 py-2 text-right font-medium">Value</th>
                      <th className="px-4 py-2 font-medium">In the feed</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((stat) => (
                      <tr key={stat.name} className="border-t border-border">
                        <td className="px-4 py-2">{stat.label}</td>
                        <td className="px-4 py-2 font-mono text-xs text-muted-foreground">{stat.name}</td>
                        <td className="px-4 py-2 text-right tabular-nums">{formatCount(stat.value)}</td>
                        <td className="px-4 py-2">{stat.reported ? "Published" : "Filled zero"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </details>
          ))}
        </div>
      )}
    </section>
  );
}
