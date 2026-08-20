/**
 * The quiet counterpart to GeometricPattern: a fine, monochrome interlocking
 * star-and-lattice texture, modeled on the dense carved-stucco relief that
 * covers the wall surfaces of houses like the Tabātabāei House in Kashan —
 * see docs/design-system.md for reference photos. Same geometric family as
 * GeometricPattern (compound star + lozenge lattice) but tiny, single-color,
 * and low-opacity, so it reads as wall texture rather than a motif. Meant
 * for large surfaces (the page background) — use GeometricPattern for
 * accents/framing/interactive elements instead.
 *
 * IMPORTANT: never layer this under GeometricPattern — any surface using
 * GeometricPattern needs its own opaque background first, or the two
 * patterns will interleave in the gaps and read as noise. See
 * docs/design-system.md.
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

export type WallReliefPatternProps = {
  /** Must be unique per instance on the page — becomes the SVG <pattern> id. */
  id: string;
  size?: number;
  color?: string;
  opacity?: number;
  className?: string;
};

export function WallReliefPattern({
  id,
  size = 46,
  color = "var(--color-ink)",
  opacity = 0.09,
  className,
}: WallReliefPatternProps) {
  const half = size / 2;
  const star = starPoints(size * 0.3, size * 0.13, 8, -90);
  const lozenge = `${half},0 ${size},${half} ${half},${size} 0,${half}`;

  return (
    <svg aria-hidden="true" className={className} width="100%" height="100%" style={{ opacity }}>
      <defs>
        <pattern id={id} patternUnits="userSpaceOnUse" width={size} height={size}>
          <polygon points={lozenge} fill="none" stroke={color} strokeWidth={size * 0.015} />
          {[
            [0, 0],
            [size, 0],
            [0, size],
            [size, size],
          ].map(([cx, cy]) => (
            <polygon
              key={`${cx},${cy}`}
              points={star}
              fill="none"
              stroke={color}
              strokeWidth={size * 0.022}
              strokeLinejoin="round"
              transform={`translate(${cx} ${cy})`}
            />
          ))}
        </pattern>
      </defs>
      <rect width="100%" height="100%" fill={`url(#${id})`} />
    </svg>
  );
}
