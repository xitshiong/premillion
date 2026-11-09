import type { Metadata } from "next";
import { Bebas_Neue, Figtree, Newsreader, Roboto_Condensed, Share_Tech_Mono } from "next/font/google";
import "./globals.css";

const sans = Figtree({
  subsets: ["latin"],
  variable: "--font-figtree",
});

const serif = Newsreader({
  subsets: ["latin"],
  variable: "--font-newsreader",
});

const display = Bebas_Neue({ subsets: ["latin"], weight: "400", variable: "--nf-display" });
const condensed = Roboto_Condensed({ subsets: ["latin"], weight: ["400", "700"], variable: "--nf-condensed" });
const mono = Share_Tech_Mono({ subsets: ["latin"], weight: "400", variable: "--nf-mono" });

export const metadata: Metadata = {
  title: {
    default: "Frankenballer · stitch a Premier League player",
    template: "%s · Player Book",
  },
  description: "Roll Premier League players, steal attributes, build chemistry, and play the season.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${sans.variable} ${serif.variable} ${display.variable} ${condensed.variable} ${mono.variable} h-full antialiased`}>
      <body className="min-h-full">{children}</body>
    </html>
  );
}
