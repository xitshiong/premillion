const POSITIONS: Record<string, string> = {
  G: "Goalkeeper",
  D: "Defender",
  M: "Midfielder",
  F: "Forward",
};

export function positionName(code: string | null): string {
  if (!code) return "Position not listed";
  return POSITIONS[code] ?? code;
}

export function positionShort(code: string | null): string {
  if (code === "G") return "GK";
  if (code === "D") return "DEF";
  if (code === "M") return "MID";
  if (code === "F") return "FWD";
  return "—";
}

export function formatRate(value: number | null, unit: string): string {
  if (value == null || Number.isNaN(value)) return "—";
  if (unit === "ratio") return `${(value * 100).toFixed(1)}%`;
  return value.toFixed(2);
}

export function unitLabel(unit: string): string {
  if (unit === "ratio") return "";
  if (unit === "per 90") return "per 90";
  return unit;
}

export function peerLabel(peer: string): string {
  if (peer === "outfield") return "outfield players";
  if (peer === "goalkeeper") return "goalkeepers";
  return "players";
}

export function melbourneTime(iso: string): string {
  const formatted = new Intl.DateTimeFormat("en-AU", {
    timeZone: "Australia/Melbourne",
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(iso));
  return `${formatted} Melbourne`;
}

export function formatCount(value: number): string {
  return new Intl.NumberFormat("en-AU", { maximumFractionDigits: 0 }).format(value);
}
