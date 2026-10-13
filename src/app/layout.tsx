import type { Metadata, Viewport } from "next";
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
  preload: false,
});

// Latin body — clean, warm geometric sans, quiet next to the display face.
// The one font preloaded: it is on screen the moment any page paints. The
// others are fetched when something first uses them — a heading may not come
// until a page has finished loading its data, and Persian not until a lesson
// starts — and a preload that goes unused for a few seconds is wasted, and
// warned about in the console.
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
  preload: false,
});

// Persian body — Vazirmatn, purpose-built for Persian UI legibility at small
// sizes; this is what carries every tutor reply and every input field.
const bodyFa = Vazirmatn({
  variable: "--font-body-fa",
  subsets: ["arabic"],
  weight: ["400", "500", "600"],
  preload: false,
});

export const metadata: Metadata = {
  title: "Persian Practice",
  description: "Short daily lessons in spoken Persian: one new word at a time, with spaced review.",
  appleWebApp: { title: "Persian", statusBarStyle: "default" },
};

// The sand of the page, so a phone's status bar continues the wall.
export const viewport: Viewport = { themeColor: "#ede3d2" };

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
