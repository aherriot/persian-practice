/**
 * The signature background texture: a compound girih star-and-cross lattice —
 * the geometric tile pattern underlying Persian architectural surfaces (dome
 * tilework, iwan spandrels, muqarnas cells). Each grid vertex carries a
 * 16-point compound star (an 8-point cobalt star with a smaller turquoise
 * star nested inside, rotated half a step — the classic way two overlapping
 * stars read as one richer rosette), a gilt center jewel, and a double-line
 * lozenge lattice with a small gold filler star at each cell center. Tiles as
 * a true square repeat via SVG `<pattern>` — vertex stars are drawn once per
 * vertex and rely on the pattern's own tiling to complete across the seam.
 *
 * Kept as an SVG (not a raster image) so it stays crisp at any scale and can
 * recolor via CSS custom properties — see docs/design-system.md before
 * changing this file, it's the one visual signature every themed surface
 * shares.
 */
function starPoints(rOuter: number, rInner: number, spikes: number, rotationDeg: number): string {
  const pts: string[] = [];
  const step = Math.PI / spikes;
  const rot = (rotationDeg * Math.PI) / 180;
  for (let i = 0; i < spikes * 2; i++) {
    const r = i % 2 === 0 ? rOuter : rInner;
    const a = i * step + rot;
    pts.push(`${(r * Math.cos(a)).toFixed(2)},${(r * Math.sin(a)).toFixed(2)}`);
  }
  return pts.join(" ");
}

export type GeometricPatternProps = {
  /** Must be unique per instance on the page — becomes the SVG <pattern> id. */
  id: string;
  /** Tile size in px (pattern coordinate space, scales with the SVG). */
  size?: number;
  /** Overall opacity of the whole pattern. */
  opacity?: number;
  outerStarColor?: string;
  innerStarColor?: string;
  latticeColor?: string;
  latticeAccentColor?: string;
  centerColor?: string;
  className?: string;
};

export function GeometricPattern({
  id,
  size = 170,
  opacity = 0.4,
  outerStarColor = "var(--color-cobalt)",
  innerStarColor = "var(--color-turquoise)",
  latticeColor = "var(--color-ink)",
  latticeAccentColor = "var(--color-crimson)",
  centerColor = "var(--color-gold)",
  className,
}: GeometricPatternProps) {
  const half = size / 2;
  const outerStar = starPoints(size * 0.3, size * 0.13, 8, -90);
  const innerStar = starPoints(size * 0.2, size * 0.085, 8, -90 + 22.5);
  const fillerStar = starPoints(size * 0.075, size * 0.03, 4, -45);
  const lozenge = `${half},0 ${size},${half} ${half},${size} 0,${half}`;
  const insetMargin = (size * (1 - 0.72)) / 2;
  const insetLozenge = `${half},${insetMargin} ${size - insetMargin},${half} ${half},${size - insetMargin} ${insetMargin},${half}`;

  return (
    <svg aria-hidden="true" className={className} width="100%" height="100%" style={{ opacity }}>
      <defs>
        <pattern id={id} patternUnits="userSpaceOnUse" width={size} height={size}>
          <polygon points={lozenge} fill="none" stroke={latticeColor} strokeWidth={size * 0.01} />
          <polygon
            points={insetLozenge}
            fill="none"
            stroke={latticeAccentColor}
            strokeWidth={size * 0.008}
            opacity={0.7}
          />
          <polygon points={fillerStar} fill={centerColor} opacity={0.9} transform={`translate(${half} ${half})`} />

          {/* four corners, each clipped by the tile — reassemble into full compound stars at every vertex */}
          {[
            [0, 0],
            [size, 0],
            [0, size],
            [size, size],
          ].map(([cx, cy]) => (
            <g key={`${cx},${cy}`} transform={`translate(${cx} ${cy})`}>
              <polygon
                points={outerStar}
                fill="none"
                stroke={outerStarColor}
                strokeWidth={size * 0.016}
                strokeLinejoin="round"
              />
              <polygon
                points={innerStar}
                fill="none"
                stroke={innerStarColor}
                strokeWidth={size * 0.013}
                strokeLinejoin="round"
              />
              <circle r={size * 0.028} fill={centerColor} stroke={latticeColor} strokeWidth={size * 0.004} />
            </g>
          ))}
        </pattern>
      </defs>
      <rect width="100%" height="100%" fill={`url(#${id})`} />
    </svg>
  );
}
