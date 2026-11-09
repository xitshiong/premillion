import type { Metadata } from "next";
import { Figtree, JetBrains_Mono, Newsreader, Silkscreen, VT323 } from "next/font/google";
import "./globals.css";

const sans = Figtree({
  subsets: ["latin"],
  variable: "--font-figtree",
});

const serif = Newsreader({
  subsets: ["latin"],
  variable: "--font-newsreader",
});

const pixel = Silkscreen({ subsets: ["latin"], weight: ["400", "700"], variable: "--nf-pixel" });
const digits = VT323({ subsets: ["latin"], weight: "400", variable: "--nf-digits" });
const mono = JetBrains_Mono({ subsets: ["latin"], variable: "--font-ui-mono" });

export const metadata: Metadata = {
  title: {
    default: "Frankenballer · build a Premier League player",
    template: "%s · Player Book",
  },
  description: "Roll a first-team or bench Premier League player and take one published attribute at a time.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${sans.variable} ${serif.variable} ${pixel.variable} ${digits.variable} ${mono.variable} h-full antialiased`}>
      <body className="min-h-full">{children}</body>
    </html>
  );
}
