import Link from "next/link";

export function SiteHeader() {
  return (
    <header className="border-b border-[#1d4034] bg-[#143028] text-[#f6f1e6]">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3">
        <Link href="/" className="font-serif text-xl tracking-tight">
          Player Book
        </Link>
        <nav className="flex items-center gap-4 text-sm">
          <Link href="/players" className="hover:underline">
            Players
          </Link>
          <Link href="/method" className="hover:underline">
            How the numbers are made
          </Link>
        </nav>
      </div>
    </header>
  );
}
