/** Club home kit colours for jersey backs (not official trademarks — approximate matchday palette). */
export type Kit = {
  primary: string;
  secondary: string;
  number: string;
  stripe?: string;
};

const DEFAULT_KIT: Kit = {
  primary: "#123024",
  secondary: "#3ecf6e",
  number: "#f1f7ef",
};

/** Premier League 2026/27 clubs keyed by Pulse team id. */
export const TEAM_KITS: Record<number, Kit> = {
  1: { primary: "#EF0107", secondary: "#FFFFFF", number: "#FFFFFF" }, // Arsenal
  2: { primary: "#670E36", secondary: "#95BFE5", number: "#95BFE5" }, // Aston Villa
  127: { primary: "#DA291C", secondary: "#000000", number: "#000000" }, // Bournemouth
  130: { primary: "#E30613", secondary: "#FBB928", number: "#FFFFFF" }, // Brentford
  131: { primary: "#0057B8", secondary: "#FFFFFF", number: "#FFFFFF" }, // Brighton
  4: { primary: "#034694", secondary: "#FFFFFF", number: "#FFFFFF" }, // Chelsea
  5: { primary: "#77C3EC", secondary: "#FFFFFF", number: "#FFFFFF" }, // Coventry
  6: { primary: "#1B458F", secondary: "#C4122E", number: "#FFFFFF", stripe: "#C4122E" }, // Crystal Palace
  7: { primary: "#003399", secondary: "#FFFFFF", number: "#FFFFFF" }, // Everton
  34: { primary: "#FFFFFF", secondary: "#000000", number: "#000000" }, // Fulham
  41: { primary: "#F5A623", secondary: "#000000", number: "#000000" }, // Hull
  8: { primary: "#0033A0", secondary: "#FFFFFF", number: "#FFFFFF" }, // Ipswich
  9: { primary: "#FFCD00", secondary: "#1D428A", number: "#1D428A" }, // Leeds
  10: { primary: "#C8102E", secondary: "#FFFFFF", number: "#FFFFFF" }, // Liverpool
  11: { primary: "#6CABDD", secondary: "#FFFFFF", number: "#FFFFFF" }, // Man City
  12: { primary: "#DA291C", secondary: "#FFFFFF", number: "#FFFFFF" }, // Man United
  23: { primary: "#241F20", secondary: "#FFFFFF", number: "#FFFFFF", stripe: "#FFFFFF" }, // Newcastle
  15: { primary: "#DD0000", secondary: "#FFFFFF", number: "#FFFFFF" }, // Nott'm Forest
  29: { primary: "#EB172B", secondary: "#FFFFFF", number: "#FFFFFF" }, // Sunderland
  21: { primary: "#132257", secondary: "#FFFFFF", number: "#FFFFFF" }, // Tottenham
};

export function kitForTeam(teamId: number): Kit {
  return TEAM_KITS[teamId] ?? DEFAULT_KIT;
}

const PARTICLES = new Set(["van", "von", "de", "da", "di", "del", "della", "dos", "das", "la", "le", "el", "al", "bin", "binti", "mc", "mac"]);

/** Shirt-back surname: last token, keeping Dutch/Spanish particles. */
export function jerseyName(fullName: string): string {
  const parts = fullName
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^A-Za-z\s'-]/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (!parts.length) return "PLAYER";
  if (parts.length === 1) return parts[0].toUpperCase();
  let start = parts.length - 1;
  while (start > 0 && PARTICLES.has(parts[start - 1].toLowerCase().replace(/\./g, ""))) start -= 1;
  return parts.slice(start).join(" ").toUpperCase();
}
