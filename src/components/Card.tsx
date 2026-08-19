import { useId, type ReactNode } from "react";

/**
 * A recessed wall niche (taghche) — modeled on the arched niches at the
 * Tabātabāei House in Kashan (see docs/design-system.md for reference
 * photos), not a generic "rounded corner" card. A proper two-centered
 * pointed arch, a carved double-line "eyebrow" molding, a small medallion at
 * the crown, and quiet corner rosettes marking the spandrels — but the
 * interior stays CALM (a soft shadow gradient, not a second competing
 * pattern) because the point of a niche is the object displayed in it.
 * `niche` renders low in the opening, resting near the base like something
 * actually sitting on a shelf, and is the focal element — everything else
 * here is restrained on purpose. `children` is the label content below.
 *
 * Earlier version filled the whole interior with the same dense lattice as
 * the wall texture; it read as noise and fought the niche content for
 * attention. Real taghche photos concentrate ornament at the frame/medallion
 * and leave the interior plain — see docs/design-system.md.
 *
 * Built as one self-contained SVG (arch geometry, clip path, and gradient
 * all in the same coordinate space) so it scales correctly at any rendered
 * size — a CSS clip-path on a separate element would need fixed pixel
 * coordinates that don't track the card's actual width.
 */

const VIEW_W = 300;
const VIEW_H = 170;
const MARGIN_X = 24;
const BASE_Y = 160;
const SPRING_Y = 84;
const APEX_Y = 44;
const INSET = 10;

/** Two-centered arch: centers lie on the springline, solved for a target apex height. */
function archPathD(slx: number, srx: number, springY: number, baseY: number, apexY: number): string {
  const midx = (slx + srx) / 2;
  const rise = springY - apexY;
  const cxLeft = (midx * midx + rise * rise - slx * slx) / (2 * (midx - slx));
  const r = cxLeft - slx;
  return `M ${slx},${baseY} L ${slx},${springY} A ${r},${r} 0 0,1 ${midx},${apexY} A ${r},${r} 0 0,1 ${srx},${springY} L ${srx},${baseY}`;
}

function spandrelStar(cx: number, cy: number, r: number): string {
  const pts: string[] = [];
  for (let i = 0; i < 12; i++) {
    const rad = i % 2 === 0 ? r : r * 0.42;
    const a = (i / 12) * Math.PI * 2 - Math.PI / 2;
    pts.push(`${cx + rad * Math.cos(a)},${cy + rad * Math.sin(a)}`);
  }
  return pts.join(" ");
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
  const slx = MARGIN_X;
  const srx = VIEW_W - MARGIN_X;
  const apexX = VIEW_W / 2;
  const outerD = archPathD(slx, srx, SPRING_Y, BASE_Y, APEX_Y);
  const outerClosed = `${outerD} L ${srx},${BASE_Y} L ${slx},${BASE_Y} Z`;
  const insetD = archPathD(slx + INSET, srx - INSET, SPRING_Y + 2, BASE_Y, APEX_Y + 6);
  const medallionY = APEX_Y + 20;

  return (
    <div className={`overflow-hidden rounded-md border border-ink/10 bg-paper ${className}`}>
      <div className="relative w-full" style={{ aspectRatio: `${VIEW_W} / ${VIEW_H}` }}>
        <svg viewBox={`0 0 ${VIEW_W} ${VIEW_H}`} preserveAspectRatio="none" className="absolute inset-0 h-full w-full">
          <defs>
            {/* Soft shadow, not a pattern — real depth cue, doesn't compete with the niche content. */}
            <radialGradient id={`${id}-shade`} cx="50%" cy="30%" r="75%">
              <stop offset="0%" stopColor="var(--color-paper)" />
              <stop offset="70%" stopColor="var(--color-paper)" />
              <stop offset="100%" stopColor="var(--color-ink)" stopOpacity={0.12} />
            </radialGradient>
            <clipPath id={`${id}-clip`}>
              <path d={outerClosed} />
            </clipPath>
          </defs>

          <g clipPath={`url(#${id}-clip)`}>
            <rect width={VIEW_W} height={VIEW_H} fill={`url(#${id}-shade)`} />
          </g>

          <path d={outerClosed} fill="none" stroke="var(--color-ink)" strokeWidth={2} />
          <path d={insetD} fill="none" stroke="var(--color-gold)" strokeWidth={1.2} opacity={0.8} />

          <path
            d={`M ${apexX - 15},${medallionY} A 15,15 0 0,1 ${apexX + 15},${medallionY}`}
            fill="none"
            stroke="var(--color-gold)"
            strokeWidth={1.1}
            opacity={0.8}
          />
          <circle cx={apexX} cy={medallionY} r={2.5} fill="var(--color-turquoise)" />

          <polygon points={spandrelStar(15, 17, 7)} fill="var(--color-turquoise)" opacity={0.6} />
          <polygon points={spandrelStar(VIEW_W - 15, 17, 7)} fill="var(--color-turquoise)" opacity={0.6} />
        </svg>

        {niche && (
          <div className="absolute inset-x-0 bottom-0 flex flex-col items-center gap-1.5 pb-4">
            {niche}
            {/* grounding shadow — the object rests on the niche floor */}
            <div className="h-1.5 w-14 rounded-full bg-ink/15 blur-[2px]" />
          </div>
        )}
      </div>
      <div className="px-4 py-3">{children}</div>
    </div>
  );
}
