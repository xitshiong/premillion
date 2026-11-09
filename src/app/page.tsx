import { cache } from "react";
import type { Metadata } from "next";
import { BuildGame } from "@/components/build-game";
import { getGameData } from "@/lib/game-data";

const openingSeed = cache(() => Math.floor(Math.random() * 1_000_000_000));

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Build your player",
  description: "Roll a Premier League first-team or bench player and take one real attribute at a time.",
};

export default function HomePage() {
  return <BuildGame data={getGameData()} seed={openingSeed()} />;
}
