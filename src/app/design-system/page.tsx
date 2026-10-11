import { GeometricPattern } from "@/components/GeometricPattern";
import { WallReliefPattern } from "@/components/WallReliefPattern";
import { FloralRelief } from "@/components/FloralRelief";
import { Button } from "@/components/Button";
import { Card } from "@/components/Card";
import { OrsiWindow } from "@/components/OrsiWindow";
import { Input } from "@/components/Input";

const SWATCHES = [
  { name: "sand", var: "--color-sand", role: "background" },
  { name: "paper", var: "--color-paper", role: "surface" },
  { name: "ink", var: "--color-ink", role: "text" },
  { name: "cobalt", var: "--color-cobalt", role: "primary accent" },
  { name: "turquoise", var: "--color-turquoise", role: "decorative / large only" },
  { name: "turquoise-dark", var: "--color-turquoise-dark", role: "text-safe turquoise" },
  { name: "terracotta", var: "--color-terracotta", role: "accent" },
  { name: "gold", var: "--color-gold", role: "decorative only" },
  { name: "crimson", var: "--color-crimson", role: "emphasis / error" },
];

export default function DesignSystemPage() {
  return (
    <main className="relative z-0 min-h-screen bg-sand">
      {/*
        Swaps this page's background from layout.tsx's fixed WallReliefPattern
        to FloralRelief, to preview the new pattern at real page scale. Same
        technique as layout.tsx: fixed + negative z-index, with bg-sand on
        <main> itself so it fully overrides (not layers with) the pattern
        underneath in body — see the "never layer" note on both pattern
        components.

        z-0 (not just `relative`) is load-bearing here: without an explicit
        z-index, <main> doesn't form its own stacking context, so the
        negative-z FloralRelief below escapes to the root stacking context
        and paints *behind* <main>'s own bg-sand instead of on top of it —
        this is unlike layout.tsx's <body>, which gets a CSS special case
        (its background propagates to the canvas) that WallReliefPattern
        doesn't need to fight. Drop z-0 and the pattern silently disappears.
      */}
      <FloralRelief id="page-bg-floral" className="pointer-events-none fixed inset-0 -z-10" />

      {/*
        bg-sand here is load-bearing, not decorative: it blocks the fixed
        BrickPattern (page background, see layout.tsx) from showing through
        the gaps in GeometricPattern's linework. The two patterns must never
        composite together — any section using GeometricPattern needs an
        opaque background first. See docs/design-system.md.
      */}
      <section className="relative overflow-hidden border-b border-ink/10 bg-sand px-6 py-20">
        <GeometricPattern id="hero-pattern" className="absolute inset-0" opacity={0.4} />
        {/*
          Text never sits directly on the pattern above ~15-20% opacity — the
          lattice lines run straight through letterforms and wreck legibility.
          This glass panel (translucent sand + blur) is the fix: see
          docs/design-system.md, "text over pattern."
        */}
        <div className="relative mx-auto max-w-2xl rounded-2xl bg-sand/75 px-8 py-6 text-center backdrop-blur-sm">
          <h1
            className="text-4xl font-medium tracking-tight text-ink sm:text-5xl"
            style={{ fontFamily: "var(--font-display-latin)" }}
          >
            Persian Architecture
          </h1>
          <p className="mt-3 text-lg text-ink/70">
            Color, type, and pattern tokens — a working prototype, not yet final.
          </p>
        </div>
      </section>

      {/*
        Every text-bearing section below sits on an opaque bg-paper panel —
        not decorative, load-bearing: without it, body text sits directly on
        the page's WallReliefPattern background and the lattice lines run
        through the letterforms (this is the bug the "Typography" section
        shipped with — see docs/design-system.md, "text needs a quiet
        surface"). Only the hero (own translucent scrim) and the "Pattern"
        showcase (deliberately demonstrating the pattern itself) are exempt.
      */}
      <section className="mx-auto max-w-3xl bg-paper px-6 py-16">
        <h2 className="text-sm font-semibold uppercase tracking-widest text-ink/50">Color</h2>
        <p className="mt-2 text-sm text-ink/60">
          Each swatch sits inside a Card — modeled on the arched niches (taghche) at the
          Tabātabāei House in Kashan: a single round-topped arch cut into the wall, its own
          outline reading as a recess through shading and a carved-edge stroke rather than
          applied decoration.
        </p>
        <div className="mt-6 grid grid-cols-2 gap-5 sm:grid-cols-3">
          {SWATCHES.map((s) => (
            <Card
              key={s.name}
              niche={
                <div
                  className="h-16 w-16 rounded-full shadow-md ring-2 ring-paper"
                  style={{ background: `var(${s.var})`, boxShadow: "0 4px 10px -2px rgba(42,29,22,0.35)" }}
                />
              }
            >
              <p className="text-center font-mono text-xs text-ink">{s.name}</p>
              <p className="text-center text-xs text-ink/50">{s.role}</p>
            </Card>
          ))}
        </div>
      </section>

      <section className="mx-auto max-w-3xl bg-paper px-6 py-16">
        <h2 className="text-sm font-semibold uppercase tracking-widest text-ink/50">Typography</h2>
        <div className="mt-6 flex flex-col gap-8">
          <div>
            <p className="mb-1 text-xs text-ink/50">Display — Latin (Cinzel) / Persian (Noto Kufi Arabic)</p>
            <p className="text-3xl font-medium" style={{ fontFamily: "var(--font-display-latin)" }}>
              Speak like a Tehrani
            </p>
            <p dir="rtl" lang="fa" className="mt-1 text-3xl font-medium" style={{ fontFamily: "var(--font-display-fa)" }}>
              مثل یک تهرونی حرف بزن
            </p>
          </div>
          <div>
            <p className="mb-1 text-xs text-ink/50">Body — Latin (Manrope) / Persian (Vazirmatn)</p>
            <p className="max-w-md text-base" style={{ fontFamily: "var(--font-body-latin)" }}>
              A conversational tutor that adapts to your level, weaves in new vocabulary, and
              speaks with a real Tehrani accent.
            </p>
            <p dir="rtl" lang="fa" className="mt-1 max-w-md text-base" style={{ fontFamily: "var(--font-body-fa)" }}>
              یه معلم مکالمه که با سطح تو تنظیم می‌شه، کلمه‌های جدید یاد می‌ده، و با لهجه واقعی تهرونی حرف می‌زنه.
            </p>
          </div>
        </div>
      </section>

      <section className="border-t border-ink/10 bg-ink/10 px-6 py-16">
        <div className="mx-auto max-w-3xl">
          <h2 className="text-sm font-semibold uppercase tracking-widest text-ink/50">Pattern</h2>
          <p className="mt-2 text-sm text-ink/60">
            Girih star-and-cross lattice — the signature motif. Shown here at three densities.
          </p>
          <div className="mt-6 grid gap-4 sm:grid-cols-3">
            <div className="relative h-40 overflow-hidden rounded-lg border border-ink/10 bg-sand">
              <GeometricPattern id="pat-full" opacity={1} className="absolute inset-0" />
            </div>
            <div className="relative h-40 overflow-hidden rounded-lg border border-ink/10 bg-sand">
              <GeometricPattern id="pat-mid" opacity={0.4} className="absolute inset-0" />
            </div>
            <div className="relative h-40 overflow-hidden rounded-lg border border-ink/10 bg-sand">
              <GeometricPattern id="pat-subtle" opacity={0.1} className="absolute inset-0" />
            </div>
          </div>
        </div>
      </section>

      <section className="border-t border-ink/10 bg-ink/10 px-6 py-16">
        <div className="mx-auto max-w-3xl">
          <h2 className="text-sm font-semibold uppercase tracking-widest text-ink/50">Wall texture</h2>
          <p className="mt-2 text-sm text-ink/60">
            Two quiet, single-color background textures for large surfaces — never accents, always
            behind an opaque panel for text. Girih lattice (WallReliefPattern) and eslimi scrolling
            floral (FloralRelief) are the same subtle-relief treatment applied to Persian
            architecture&apos;s two ornament families.
          </p>
          <div className="mt-6 grid gap-4 sm:grid-cols-2">
            <div className="relative h-40 overflow-hidden rounded-lg border border-ink/10 bg-sand">
              <WallReliefPattern id="wall-showcase" opacity={0.35} className="absolute inset-0" />
              <p className="absolute bottom-2 left-2 font-mono text-xs text-ink/50">WallReliefPattern</p>
            </div>
            <div className="relative h-40 overflow-hidden rounded-lg border border-ink/10 bg-sand">
              <FloralRelief id="floral-showcase" opacity={0.35} className="absolute inset-0" />
              <p className="absolute bottom-2 left-2 font-mono text-xs text-ink/50">FloralRelief</p>
            </div>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-3xl bg-paper px-6 py-16">
        <h2 className="text-sm font-semibold uppercase tracking-widest text-ink/50">Card</h2>
        <p className="mt-2 text-sm text-ink/60">
          The same niche, used generically — not just for color swatches. <code className="text-xs">niche</code> is
          optional: with it, whatever you pass becomes the focal object resting in the opening;
          without it, the card is just a quiet arched surface for text content.
        </p>
        <div className="mt-6 grid gap-5 sm:grid-cols-3">
          <Card>
            <p className="text-center text-sm font-medium text-ink">No niche content</p>
            <p className="mt-1 text-center text-xs text-ink/60">
              Just the arch and frame, carrying ordinary text — a quiet surface rather than a
              display case.
            </p>
          </Card>
          <Card
            niche={
              <div className="flex h-14 w-14 items-center justify-center rounded-full bg-cobalt text-lg font-semibold text-sand">
                12
              </div>
            }
          >
            <p className="text-center text-sm font-medium text-ink">Due for review</p>
            <p className="text-center text-xs text-ink/50">items waiting</p>
          </Card>
          <Card
            niche={
              <div className="flex h-14 w-14 items-center justify-center rounded-full bg-terracotta text-2xl text-sand">
                ✓
              </div>
            }
          >
            <p className="text-center text-sm font-medium text-ink">Placement complete</p>
            <p className="text-center text-xs text-ink/50">level B1</p>
          </Card>
        </div>
      </section>

      <section className="mx-auto max-w-3xl bg-paper px-6 py-16">
        <h2 className="text-sm font-semibold uppercase tracking-widest text-ink/50">Button</h2>
        <p className="mt-2 text-sm text-ink/60">
          Arch-top silhouette, girih pattern inlaid at low opacity, a double-line tile frame (gold
          inner border, ink outer ring with a sand gap). Tab to it to see the focus ring; the
          pattern brightens on hover.
        </p>
        <div className="mt-6 flex flex-wrap items-center gap-6">
          <Button variant="primary">Start a conversation</Button>
          <Button variant="secondary">Take the placement test</Button>
          <Button variant="ghost">Review due items</Button>
          <Button variant="primary" disabled>
            Unavailable
          </Button>
        </div>
      </section>

      <section className="mx-auto max-w-3xl bg-paper px-6 py-16">
        <h2 className="text-sm font-semibold uppercase tracking-widest text-ink/50">Input</h2>
        <p className="mt-2 text-sm text-ink/60">
          A recessed trough rather than a flat rectangle — same carved-into-the-wall inset shadow
          as Card&apos;s label section, same double-ring focus recipe as Button. Tab through the
          fields to see it.
        </p>
        <div className="mt-6 grid gap-5 sm:grid-cols-2">
          <Input label="Email address" type="email" placeholder="you@example.com" autoComplete="email" />
          <Input
            label="Name"
            type="text"
            placeholder="Alex"
            description="Shown to your conversation partner."
          />
          <Input
            label="Word to look up"
            type="text"
            defaultValue="âب"
            error="That doesn't look like a Persian word."
          />
          <Input label="Unavailable" type="text" placeholder="Locked" disabled />
        </div>
      </section>

      <section className="border-t border-ink/10 bg-ink px-6 py-16">
        <div className="mx-auto max-w-3xl">
          <h2 className="text-sm font-semibold uppercase tracking-widest text-sand/50">Orsi window</h2>
          <p className="mt-2 text-sm text-sand/60">
            A stained-glass fanlight modeled on the orsi sash windows in the Tabātabāei House&apos;s
            reception room — the system&apos;s first color-forward ornament. Reserved for celebration
            moments (lesson complete, streak milestones), not ambient decoration: no screen uses it yet.
          </p>
          <div className="mt-8 grid gap-10 sm:grid-cols-2">
            <div className="mx-auto w-full max-w-xs">
              <OrsiWindow id="orsi-default" />
            </div>
            <div className="mx-auto w-full max-w-xs">
              <OrsiWindow id="orsi-plain" glow={false} rings={4} wedges={12} />
              <p className="mt-2 text-center font-mono text-xs text-sand/40">glow off, coarser facets</p>
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}
