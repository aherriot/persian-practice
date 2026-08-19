import type { Metadata } from "next";
import { Cinzel, Manrope, Vazirmatn, Noto_Kufi_Arabic } from "next/font/google";
import { WallReliefPattern } from "@/components/WallReliefPattern";
import "./globals.css";

// Latin display — Cinzel, a monumental lapidary face (its letterforms trace
// back to carved Roman inscriptional capitals). Swapped in for Space Grotesk,
// which read as a tech/SaaS geometric sans rather than anything carved or
// old — see docs/design-system.md. Used for headings only; body text stays
// on Manrope for legibility, so the "ancient" character is concentrated
// where it belongs instead of fighting readability everywhere.
const displayLatin = Cinzel({
  variable: "--font-display-latin",
  subsets: ["latin"],
  weight: ["500", "700"],
});

// Latin body — clean, warm geometric sans, quiet next to the display face.
const bodyLatin = Manrope({
  variable: "--font-body-latin",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
});

// Persian display — Kufic-derived, monumental and geometric. Used sparingly,
// for Persian headlines only.
const displayFa = Noto_Kufi_Arabic({
  variable: "--font-display-fa",
  subsets: ["arabic"],
  weight: ["500", "700"],
});

// Persian body — Vazirmatn, purpose-built for Persian UI legibility at small
// sizes; this is what carries every tutor reply and every input field.
const bodyFa = Vazirmatn({
  variable: "--font-body-fa",
  subsets: ["arabic"],
  weight: ["400", "500", "600"],
});

export const metadata: Metadata = {
  title: "Persian Practice",
  description: "A conversational Persian tutor.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${displayLatin.variable} ${bodyLatin.variable} ${displayFa.variable} ${bodyFa.variable} h-full antialiased`}
    >
      <body className="relative min-h-full flex flex-col bg-sand text-ink">
        <WallReliefPattern id="page-bg-relief" className="pointer-events-none fixed inset-0 -z-50" />
        {children}
      </body>
    </html>
  );
}
