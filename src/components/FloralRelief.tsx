/**
 * A second quiet wall texture, same use case and construction contract as
 * WallReliefPattern (fine, monochrome, low-opacity — background texture,
 * not a motif): use for large surfaces (the page background) rather than
 * accents. Where WallReliefPattern is the geometric girih family, this is
 * the other half of the same carved-stucco vocabulary seen at houses like
 * the Tabātabāei House — an eslimi scrolling-vine floral relief: a small
 * rosette at each tile center, four S-curved tendrils reaching from that
 * rosette out to the tile corners with a pair of leaves budding off each
 * curve, a smaller rosette at every corner, and a standalone floret
 * floating (unattached to any vine) at each edge midpoint to fill the
 * otherwise-empty space between the diamond lattice lines — the same role
 * GeometricPattern's filler star plays at its lozenge centers.
 *
 * Deliberately restrained per-vine: earlier drafts piled multiple leaf
 * pairs, side-branches, and curling hooks onto each tendril, and it read as
 * a dense tangle rather than a pattern you could parse at a glance. Detail
 * belongs in the *negative space* (the floret at each edge midpoint), not
 * stacked onto every line — keep the vine itself to one curve, one leaf
 * pair.
 *
 * The corner rosette and edge floret are drawn once per tile but sit on
 * shared grid points — corners shared by four tiles, edge midpoints shared
 * by two — so they complete into a whole shape from the surrounding tiles
 * exactly the way WallReliefPattern's corner star does — that's what makes
 * the repeat seamless without hand-aligning anything across the tile
 * boundary.
 *
 * IMPORTANT: same rule as WallReliefPattern — never layer this under
 * GeometricPattern (or WallReliefPattern itself). Give any surface using it
 * its own opaque background first. See docs/design-system.md.
 */

type Point = { x: number; y: number };

function cubicPoint(p0: Point, p1: Point, p2: Point, p3: Point, t: number): Point {
  const mt = 1 - t;
  const a = mt * mt * mt;
  const b = 3 * mt * mt * t;
  const c = 3 * mt * t * t;
  const d = t * t * t;
  return {
    x: a * p0.x + b * p1.x + c * p2.x + d * p3.x,
    y: a * p0.y + b * p1.y + c * p2.y + d * p3.y,
  };
}

function cubicTangentDeg(p0: Point, p1: Point, p2: Point, p3: Point, t: number): number {
  const mt = 1 - t;
  const dx = 3 * mt * mt * (p1.x - p0.x) + 6 * mt * t * (p2.x - p1.x) + 3 * t * t * (p3.x - p2.x);
  const dy = 3 * mt * mt * (p1.y - p0.y) + 6 * mt * t * (p2.y - p1.y) + 3 * t * t * (p3.y - p2.y);
  return (Math.atan2(dy, dx) * 180) / Math.PI;
}

/** Almond-shaped petal/leaf, base at the origin, tip pointing along +x. */
function almondPath(length: number, width: number): string {
  return `M0,0 Q${(length * 0.5).toFixed(2)},${(-width).toFixed(2)} ${length.toFixed(2)},0 Q${(length * 0.5).toFixed(2)},${width.toFixed(2)} 0,0 Z`;
}

function Rosette({
  petalCount,
  petalLength,
  petalWidth,
  centerR,
  color,
}: {
  petalCount: number;
  petalLength: number;
  petalWidth: number;
  centerR: number;
  color: string;
}) {
  const petal = almondPath(petalLength, petalWidth);
  return (
    <>
      {Array.from({ length: petalCount }, (_, i) => (i / petalCount) * 360).map((deg) => (
        <path key={deg} d={petal} fill={color} transform={`rotate(${deg}) translate(${centerR},0)`} />
      ))}
      <circle r={centerR} fill={color} />
    </>
  );
}

/** One S-curved tendril from the tile center out to a corner, with two budding leaves. */
function Tendril({ reach, color }: { reach: number; color: string }) {
  const amp = reach * 0.085;
  const p0: Point = { x: 0, y: 0 };
  const p1: Point = { x: reach * 0.33, y: -amp };
  const p2: Point = { x: reach * 0.66, y: amp };
  const p3: Point = { x: reach, y: 0 };
  const stemD = `M${p0.x},${p0.y} C${p1.x.toFixed(2)},${p1.y.toFixed(2)} ${p2.x.toFixed(2)},${p2.y.toFixed(2)} ${p3.x.toFixed(2)},${p3.y.toFixed(2)}`;
  const leaf = almondPath(reach * 0.16, reach * 0.055);

  const leaves = [0.32, 0.68].map((t, i) => {
    const pt = cubicPoint(p0, p1, p2, p3, t);
    const tangent = cubicTangentDeg(p0, p1, p2, p3, t);
    const side = i % 2 === 0 ? 1 : -1;
    return { pt, deg: tangent + side * 62, key: t };
  });

  return (
    <>
      <path d={stemD} fill="none" stroke={color} strokeWidth={reach * 0.014} strokeLinecap="round" />
      {leaves.map(({ pt, deg, key }) => (
        <path key={key} d={leaf} fill={color} transform={`translate(${pt.x.toFixed(2)},${pt.y.toFixed(2)}) rotate(${deg.toFixed(2)})`} />
      ))}
    </>
  );
}

export type FloralReliefProps = {
  /** Must be unique per instance on the page — becomes the SVG <pattern> id. */
  id: string;
  size?: number;
  color?: string;
  opacity?: number;
  className?: string;
};

export function FloralRelief({ id, size = 140, color = "var(--color-ink)", opacity = 0.09, className }: FloralReliefProps) {
  const half = size / 2;
  const cornerReach = half * Math.SQRT2;

  return (
    <svg aria-hidden="true" className={className} width="100%" height="100%" style={{ opacity }}>
      <defs>
        <pattern id={id} patternUnits="userSpaceOnUse" width={size} height={size}>
          <g transform={`translate(${half},${half})`}>
            {[45, 135, 225, 315].map((deg) => (
              <g key={deg} transform={`rotate(${deg})`}>
                <Tendril reach={cornerReach} color={color} />
              </g>
            ))}
            <Rosette petalCount={8} petalLength={half * 0.34} petalWidth={half * 0.13} centerR={half * 0.06} color={color} />
          </g>

          {[
            [0, 0],
            [size, 0],
            [0, size],
            [size, size],
          ].map(([cx, cy]) => (
            <g key={`${cx},${cy}`} transform={`translate(${cx},${cy})`}>
              <Rosette petalCount={6} petalLength={half * 0.2} petalWidth={half * 0.075} centerR={half * 0.045} color={color} />
            </g>
          ))}

          {/* Standalone florets at the four edge midpoints — fill the empty
              diamond-shaped gaps between the vine lines without touching
              them. Shared with the neighboring tile across each edge, same
              seamless-repeat trick as the corner rosettes above. */}
          {[
            [half, 0],
            [half, size],
            [0, half],
            [size, half],
          ].map(([cx, cy]) => (
            <g key={`${cx},${cy}`} transform={`translate(${cx},${cy})`}>
              <Rosette petalCount={5} petalLength={half * 0.13} petalWidth={half * 0.05} centerR={half * 0.025} color={color} />
            </g>
          ))}
        </pattern>
      </defs>
      <rect width="100%" height="100%" fill={`url(#${id})`} />
    </svg>
  );
}
