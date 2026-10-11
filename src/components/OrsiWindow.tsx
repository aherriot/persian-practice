import { useId } from "react";

/**
 * A radiant stained-glass fanlight, modeled on the orsi sash windows in the
 * Tabātabāei House's reception room: a semicircular fan of leaded glass
 * facets in jewel tones (crimson, gold, cobalt, turquoise, terracotta)
 * rising from a wood-toned sill, with colored light pooling on the floor
 * below. Unlike GeometricPattern / WallReliefPattern / FloralRelief — all
 * monochrome linework standing in for carved stucco or tile — this is the
 * system's first color-forward ornament, so it's scoped to celebration
 * moments (lesson complete, streak milestones) rather than ambient texture:
 * the saturated palette only reads as special if it stays rare. No screen
 * uses it yet — nothing in the app currently has a completion/milestone
 * moment to hang it on — so for now it's demonstrated on /design-system only.
 *
 * Facets are straight-edged annular sectors, not true arcs — in a leaded-
 * glass fanlight that's not an approximation shortcut, it's the actual
 * construction: individual cut panes catching light at slightly different
 * angles, not a smooth gradient. The floor dapples below use a fixed
 * pseudo-pattern (index-derived offsets, not Math.random) so server and
 * client render identical output — real randomness here would hydration-
 * mismatch the same way a module-level id counter would (see Card.tsx).
 */

const PALETTE = [
  "var(--color-crimson)",
  "var(--color-gold)",
  "var(--color-cobalt)",
  "var(--color-turquoise)",
  "var(--color-terracotta)",
];

function polar(cx: number, cy: number, r: number, deg: number): [number, number] {
  const rad = (deg * Math.PI) / 180;
  return [cx + r * Math.cos(rad), cy - r * Math.sin(rad)];
}

function facetPath(cx: number, cy: number, r0: number, r1: number, a0: number, a1: number): string {
  const [x0, y0] = polar(cx, cy, r0, a0);
  const [x1, y1] = polar(cx, cy, r1, a0);
  const [x2, y2] = polar(cx, cy, r1, a1);
  const [x3, y3] = polar(cx, cy, r0, a1);
  return `M${x0.toFixed(2)},${y0.toFixed(2)} L${x1.toFixed(2)},${y1.toFixed(2)} L${x2.toFixed(2)},${y2.toFixed(2)} L${x3.toFixed(2)},${y3.toFixed(2)} Z`;
}

export type OrsiWindowProps = {
  /** Must be unique per instance on the page — namespaces internal ids. */
  id: string;
  /** Concentric color bands from sill to apex. */
  rings?: number;
  /** Radial facet cuts across the 180° sweep. */
  wedges?: number;
  /** Blurred colored light pools beneath the sill, like sun through glass. */
  glow?: boolean;
  className?: string;
};

export function OrsiWindow({ id, rings = 5, wedges = 18, glow = true, className = "" }: OrsiWindowProps) {
  const reactId = useId();
  const uid = `orsi-${id}-${reactId}`;

  const VIEW_W = 300;
  const R = 150;
  const cx = VIEW_W / 2;
  const springY = 160;
  const sillH = 16;
  const footerH = glow ? 46 : 0;
  const VIEW_H = springY + sillH + footerH;

  const rInner = R * 0.12;
  const ringStep = (R - rInner) / rings;
  const wedgeStep = 180 / wedges;

  const facets: { d: string; fill: string; opacity: number }[] = [];
  for (let ri = 0; ri < rings; ri++) {
    const r0 = rInner + ri * ringStep;
    const r1 = r0 + ringStep;
    const color = PALETTE[ri % PALETTE.length];
    for (let wi = 0; wi < wedges; wi++) {
      const a0 = 180 - wi * wedgeStep;
      const a1 = a0 - wedgeStep;
      facets.push({
        d: facetPath(cx, springY, r0, r1, a0, a1),
        fill: color,
        opacity: wi % 2 === 0 ? 1 : 0.78,
      });
    }
  }

  const archD = `M0,${springY} A${R},${R} 0 0,1 ${VIEW_W},${springY}`;
  const archClosed = `${archD} L${VIEW_W},${springY} L0,${springY} Z`;
  const innerR = R - 7;
  const innerArcD = `M${cx - innerR},${springY} A${innerR},${innerR} 0 0,1 ${cx + innerR},${springY}`;

  const dapples = glow
    ? Array.from({ length: 7 }, (_, i) => ({
        x: 20 + ((i * 37) % (VIEW_W - 40)),
        y: springY + sillH + 8 + ((i * 17) % Math.max(footerH - 16, 1)),
        color: PALETTE[i % PALETTE.length],
        w: 10 + (i % 3) * 6,
      }))
    : [];

  return (
    <svg
      aria-hidden="true"
      viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
      preserveAspectRatio="xMidYMin meet"
      className={className}
      width="100%"
      height="100%"
    >
      <defs>
        <clipPath id={`${uid}-clip`}>
          <path d={archClosed} />
        </clipPath>
        {glow && (
          <filter id={`${uid}-blur`} x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="4.5" />
          </filter>
        )}
      </defs>

      <g clipPath={`url(#${uid}-clip)`}>
        {facets.map((f, i) => (
          <path
            key={i}
            d={f.d}
            fill={f.fill}
            opacity={f.opacity}
            stroke="var(--color-ink)"
            strokeWidth={0.75}
            strokeOpacity={0.45}
          />
        ))}
      </g>

      <path d={archD} fill="none" stroke="var(--color-ink)" strokeWidth={3} strokeOpacity={0.7} />
      <path d={innerArcD} fill="none" stroke="var(--color-gold)" strokeWidth={1.5} strokeOpacity={0.85} />

      <rect x={0} y={springY} width={VIEW_W} height={sillH} fill="var(--color-ink)" opacity={0.18} />
      <rect x={0} y={springY} width={VIEW_W} height={1.5} fill="var(--color-gold)" opacity={0.6} />

      {glow && (
        <g filter={`url(#${uid}-blur)`}>
          {dapples.map((d, i) => (
            <rect
              key={i}
              x={d.x}
              y={d.y}
              width={d.w}
              height={d.w}
              fill={d.color}
              opacity={0.4}
              transform={`rotate(45 ${d.x + d.w / 2} ${d.y + d.w / 2})`}
            />
          ))}
        </g>
      )}
    </svg>
  );
}
