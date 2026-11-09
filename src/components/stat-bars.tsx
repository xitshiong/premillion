import { formatRate, peerLabel, unitLabel } from "@/lib/format";
import type { Rate } from "@/lib/data";

function note(rate: Rate): string {
  if (rate.eligible && rate.percentile != null) {
    return `${rate.percentile.toFixed(1)} percentile among ${rate.peerCount} ${peerLabel(rate.peerGroup)}.`;
  }
  if (rate.value == null) {
    if (rate.key === "shooting" || rate.key === "vision") {
      return "Blank when Fantasy Premier League has no matching record, or under 90 minutes in that feed.";
    }
    if (rate.unit === "ratio") return "Blank until the attempt minimum in the formula is reached.";
    return "Blank under 90 minutes. The season count is still in the raw table.";
  }
  const minutes = rate.minutesUsed ?? 0;
  return `Calculated from ${minutes} minutes. Rankings start at 270 minutes, so this is not ranked.`;
}

export function StatBars({ rates }: { rates: Rate[] }) {
  return (
    <div className="grid gap-3">
      {rates.map((rate) => {
        const width = rate.eligible && rate.percentile != null ? Math.max(0, Math.min(100, rate.percentile)) : 0;
        return (
          <article key={rate.key} className="rounded-xl border border-border bg-card px-4 py-3">
            <div className="flex items-baseline justify-between gap-3">
              <h3 className="font-medium">{rate.label}</h3>
              <p className="text-right font-serif text-2xl leading-none tabular-nums">
                {formatRate(rate.value, rate.unit)}
                {rate.value != null && unitLabel(rate.unit) ? (
                  <span className="ml-1 font-sans text-xs font-normal text-muted-foreground">{unitLabel(rate.unit)}</span>
                ) : null}
              </p>
            </div>
            <div className="mt-3 h-2 overflow-hidden rounded-full bg-muted">
              <div className="h-full rounded-full bg-primary" style={{ width: `${width}%` }} />
            </div>
            <p className="mt-2 text-sm text-muted-foreground">{note(rate)}</p>
            <p className="mt-1 text-xs text-muted-foreground">{rate.formula}</p>
          </article>
        );
      })}
    </div>
  );
}
