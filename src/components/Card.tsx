import { useId, type ReactNode } from "react";

/**
 * A recessed wall niche (taghche) — modeled on the arched niches at the
 * Tabātabāei House in Kashan (see docs/design-system.md for reference
 * photos). Earlier version put the ornament (eyebrow molding, medallion,
 * corner rosettes) on a small arch *inside* a plain rectangular card frame —
 * two competing frames, and the ornament read as clutter for something
 * meant to be a reusable card. This version drops the ornament entirely and
 * puts the taghche idea on the card's own outline instead: the whole card
 * is arch-shaped (no separate outer box), and the recess reads through
 * shading and a carved-edge stroke rather than decoration — an actual cut
 * into the wall, not a picture of one.
 *
 * `niche` renders low in the opening, resting near the base like something
 * actually sitting on a shelf, and is the focal element. `children` is the
 * label content below, inside the same continuous outline as the arch.
 *
 * Built as one self-contained SVG (arch geometry, clip path, and gradient
 * all in the same coordinate space) so it scales correctly at any rendered
 * size — a CSS clip-path on a separate element would need fixed pixel
 * coordinates that don't track the card's actual width. The arch's vertical
 * sides run the full card width so they line up with the label section's
 * border below, reading as one continuous outline rather than two frames.
 */

const VIEW_W = 300;
const VIEW_H = 130;
const BASE_Y = 130;
const SPRING_Y = 66;
const APEX_Y = 30;

/** Single round-topped arch: one elliptical arc from spring to spring, apex centered. */
function archPathD(slx: number, srx: number, springY: number, baseY: number, apexY: number): string {
  const rx = (srx - slx) / 2;
  const ry = springY - apexY;
  return `M ${slx},${baseY} L ${slx},${springY} A ${rx},${ry} 0 0,1 ${srx},${springY} L ${srx},${baseY}`;
}

export type CardProps = {
  /** Rendered low in the niche opening, resting near the base — the focal element. */
  niche?: ReactNode;
  children: ReactNode;
  className?: string;
};

export function Card({ niche, children, className = "" }: CardProps) {
  // useId(), not a module-level counter — see Button.tsx for why a counter
  // isn't SSR-safe (it produced the exact hydration mismatch this avoids).
  const id = `taghche-${useId()}`;
  const outerD = archPathD(0, VIEW_W, SPRING_Y, BASE_Y, APEX_Y);
  const outerClosed = `${outerD} L ${VIEW_W},${BASE_Y} L 0,${BASE_Y} Z`;

  return (
    <div className={`overflow-hidden rounded-b-md bg-paper ${className}`}>
      <div className="relative w-full" style={{ aspectRatio: `${VIEW_W} / ${VIEW_H}` }}>
        <svg viewBox={`0 0 ${VIEW_W} ${VIEW_H}`} preserveAspectRatio="none" className="absolute inset-0 h-full w-full">
          <defs>
            {/* Directional shading, not a pattern — light falls from above the
                opening and gathers as shadow under the arch, the actual depth
                cue for a cut into a wall rather than a flat illustration. */}
            <linearGradient id={`${id}-shade`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--color-ink)" stopOpacity={0.3} />
              <stop offset="45%" stopColor="var(--color-ink)" stopOpacity={0.04} />
              <stop offset="100%" stopColor="var(--color-ink)" stopOpacity={0.1} />
            </linearGradient>
            <clipPath id={`${id}-clip`}>
              <path d={outerClosed} />
            </clipPath>
          </defs>

          <g clipPath={`url(#${id}-clip)`}>
            <rect width={VIEW_W} height={VIEW_H} fill="var(--color-paper)" />
            <rect width={VIEW_W} height={VIEW_H} fill={`url(#${id}-shade)`} />
          </g>

          <path d={outerClosed} fill="none" stroke="var(--color-ink)" strokeOpacity={0.55} strokeWidth={2} />
        </svg>

        {niche && (
          <div className="absolute inset-x-0 bottom-0 flex flex-col items-center gap-1.5 pb-4">
            {niche}
            {/* grounding shadow — the object rests on the niche floor */}
            <div className="h-1.5 w-14 rounded-full bg-ink/15 blur-[2px]" />
          </div>
        )}
      </div>
      <div className="border-x border-b border-ink/20 rounded-b-md px-4 py-3 shadow-[inset_0_4px_8px_-6px_rgba(42,29,22,0.25)]">
        {children}
      </div>
    </div>
  );
}
