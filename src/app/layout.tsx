import type { Metadata } from "next";
import { Anton, Archivo, Courier_Prime, Figtree, Newsreader } from "next/font/google";
import "./globals.css";

const sans = Figtree({
  subsets: ["latin"],
  variable: "--font-figtree",
});

const serif = Newsreader({
  subsets: ["latin"],
  variable: "--font-newsreader",
});

const display = Anton({ subsets: ["latin"], weight: "400", variable: "--nf-display" });
const type = Courier_Prime({ subsets: ["latin"], weight: ["400", "700"], variable: "--nf-type" });
const body = Archivo({ subsets: ["latin"], variable: "--nf-body" });

export const metadata: Metadata = {
  title: {
    default: "Frankenballer · stitch together a Premier League player",
    template: "%s · Player Book",
  },
  description: "Roll a first-team or bench Premier League player and take one attribute at a time, blended from EA SPORTS FC ratings and this season's form.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${sans.variable} ${serif.variable} ${display.variable} ${type.variable} ${body.variable} h-full antialiased`}>
      <body className="min-h-full">{children}</body>
    </html>
  );
}
