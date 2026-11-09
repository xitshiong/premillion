/**
 * Export every rollable player with base and prime stats to Excel.
 * Run: npx tsx scripts/export-player-stats.ts
 */
import fs from "fs";
import path from "path";
import * as XLSX from "xlsx";
import { getGameData } from "../src/lib/game-data";
import { BUILD_STATS, asPrime } from "../src/lib/ratings";

const data = getGameData();

const rows = data.players
  .slice()
  .sort((a, b) => b.overall - a.overall || a.name.localeCompare(b.name))
  .map((player) => {
    const prime = asPrime(player);
    const baseByKey = Object.fromEntries(player.stats.map((stat) => [stat.key, stat]));
    const primeByKey = Object.fromEntries(prime.stats.map((stat) => [stat.key, stat]));
    const row: Record<string, string | number | null> = {
      id: player.id,
      name: player.name,
      team: player.teamName,
      nationality: player.nationality ?? "",
      position: player.position,
      ea_position: player.eaPosition,
      role: player.role,
      appearances: player.appearances,
      minutes: player.minutes,
      goals: player.goals,
      assists: player.assists,
      overall: player.overall,
      ea_overall: player.eaOverall,
      form_delta: player.formDelta,
      prime_overall: prime.overall,
      prime_form_delta: prime.formDelta,
    };
    for (const definition of BUILD_STATS) {
      const base = baseByKey[definition.key];
      const peak = primeByKey[definition.key];
      row[definition.key] = base.value;
      row[`${definition.key}_ea`] = base.ea;
      row[`${definition.key}_form`] = base.form;
      row[`prime_${definition.key}`] = peak.value;
    }
    return row;
  });

const sheet = XLSX.utils.json_to_sheet(rows);
sheet["!cols"] = Object.keys(rows[0] ?? {}).map((key) => ({
  wch: Math.min(28, Math.max(10, key.length + 2)),
}));

const book = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(book, sheet, "Players");

const legend = XLSX.utils.aoa_to_sheet([
  ["Premillion player stats"],
  ["Season", data.season],
  ["Players", rows.length],
  ["Generated", new Date().toISOString()],
  [],
  ["Column notes"],
  ["overall", "Current blended rating used in the build game"],
  ["ea_overall / *_ea", "EA SPORTS FC card rating"],
  ["*_form", "Season form mapped onto the EA rating scale (blank if no form feed)"],
  ["prime_* / prime_overall", "Best-ever prime card: max of EA/form, primaries lifted to personal best"],
  ["role", "First team = 7+ appearances; otherwise Bench"],
]);
XLSX.utils.book_append_sheet(book, legend, "Notes");

const outDir = path.resolve("exports");
fs.mkdirSync(outDir, { recursive: true });
const filename = `premillion-player-stats-${data.season.replace("/", "-")}.xlsx`;
const outPath = path.join(outDir, filename);
XLSX.writeFile(book, outPath);

const artifactPath = `/opt/cursor/artifacts/${filename}`;
fs.copyFileSync(outPath, artifactPath);

console.log(JSON.stringify({ players: rows.length, outPath, artifactPath }, null, 2));
