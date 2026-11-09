import Link from "next/link";

export default function NotFound() {
  return (
    <div>
      <h1 className="font-serif text-4xl">That page is not in the book.</h1>
      <p className="mt-3 text-muted-foreground">The player or club id does not match a 2026/27 Premier League list entry.</p>
      <Link href="/players" className="mt-4 inline-block text-primary underline">
        Back to the players
      </Link>
    </div>
  );
}
