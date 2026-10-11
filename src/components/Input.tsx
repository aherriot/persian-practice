"use client";

import { memo, useId } from "react";
import {
  Field,
  Label,
  Input as HeadlessInput,
  Description,
  type InputProps as HeadlessInputProps,
} from "@headlessui/react";

/**
 * A recessed tile trough — the same "cut into the wall" language as Card's
 * taghche, applied to a functional field instead of a display niche: an
 * inset shadow reads as depth rather than a flat rectangle sitting on the
 * page. Focus uses the exact double-ring recipe from Button.tsx (sand gap +
 * accent ring) so every interactive element in the system focuses the same
 * way.
 *
 * The frame itself is weathered rather than machine-cut: AgedFrame (below)
 * overlays three static SVG filters — fine ink-toned grain and a couple of
 * coarse terracotta stains (both feTurbulence -> feColorMatrix, mix-blend-
 * multiply, same gamma-threshold trick at two different scales) standing in
 * for dust and water staining ground into old plaster, plus a displaced
 * border stroke (feTurbulence -> feDisplacementMap) so the edge wobbles like
 * a hand-carved niche instead of a CSS border-radius rectangle. No inlaid
 * pattern beyond that — a form field has to stay legible and typeable
 * first.
 *
 * Built on Headless UI's Field/Label/Input/Description trio (not a hand-
 * wired <label htmlFor>) so the id association, aria-describedby wiring for
 * the helper/error text, and data-hover/data-focus/data-disabled state all
 * come from real behavior instead of being reimplemented — same rationale
 * as Button.tsx.
 */

/**
 * SVG filters are rasterized once when the element paints, not per animation
 * frame — there's nothing here to re-rasterize on a timer. The two risks
 * that *would* make this expensive are (1) sitting on an element that
 * repaints on its own (the real <input> repaints on every keystroke/caret
 * blink) and (2) React re-creating this subtree on every parent re-render.
 * Both are avoided the same way: AgedFrame is a sibling overlay, not the
 * input itself, memoized on its only prop (`invalid`) so a keystroke in the
 * input next to it never touches this DOM at all, let alone forces the
 * browser to recompute the filter.
 */
/**
 * Deterministic per-instance seed (same input on server and client — see
 * the FloralRelief/OrsiWindow precedent for why this can't be Math.random)
 * so every field on a page doesn't wear the exact same stain in the exact
 * same spot. `salt` offsets the three filters from each other.
 */
function seedFrom(uid: string, salt: number): number {
  let h = salt;
  for (let i = 0; i < uid.length; i++) h = (h * 31 + uid.charCodeAt(i)) >>> 0;
  return (h % 89) + 1;
}

const AgedFrame = memo(function AgedFrame({ invalid }: { invalid: boolean }) {
  const uid = useId();
  const strokeColor = invalid ? "var(--color-crimson)" : "var(--color-ink)";

  return (
    <svg aria-hidden="true" className="pointer-events-none absolute inset-0 h-full w-full overflow-visible">
      <defs>
        {/* No margin on this region (unlike -edge below) — grain has no
            reason to paint past the field's own box, and with overflow-
            visible on the <svg> any margin here bleeds a hard-edged
            rectangle into the grid gap next to it. */}
        <filter id={`${uid}-grain`} x="0%" y="0%" width="100%" height="100%">
          <feTurbulence type="fractalNoise" baseFrequency="0.6" numOctaves={3} seed={seedFrom(uid, 7)} stitchTiles="stitch" />
          {/* Averaging the three channels then pushing through gamma keeps
              the grain as distinct specks rather than an even haze — a lower
              exponent than a first pass lets more of those specks clear the
              threshold, so the grit reads immediately instead of on close
              inspection. */}
          <feColorMatrix
            type="matrix"
            values="0 0 0 0 0.165  0 0 0 0 0.114  0 0 0 0 0.086  0.333 0.333 0.333 0 0"
          />
          <feComponentTransfer>
            <feFuncA type="gamma" amplitude={1.3} exponent={2.8} offset={0} />
          </feComponentTransfer>
        </filter>
        {/* Coarse, low-frequency counterpart to the grain filter — same
            gamma-threshold trick but at a much larger scale, so it produces
            a couple of soft blotches (water staining) instead of speckle. */}
        <filter id={`${uid}-stain`} x="0%" y="0%" width="100%" height="100%">
          <feTurbulence type="fractalNoise" baseFrequency="0.012 0.02" numOctaves={2} seed={seedFrom(uid, 21)} />
          <feColorMatrix
            type="matrix"
            values="0 0 0 0 0.51  0 0 0 0 0.24  0 0 0 0 0.13  0.6 0.6 0.6 0 -0.55"
          />
        </filter>
        {/* Region margin only needs to cover the actual displacement
            (scale/2 =~2.5px) plus stroke antialiasing — the first pass used
            a much larger margin "for safety" and it bled across the 20px
            grid gap into the next field. Keep it tight to the element's own
            box. */}
        <filter id={`${uid}-edge`} x="-8%" y="-18%" width="116%" height="136%">
          <feTurbulence type="fractalNoise" baseFrequency="0.02 0.05" numOctaves={2} seed={seedFrom(uid, 11)} result="wobble" />
          <feDisplacementMap
            in="SourceGraphic"
            in2="wobble"
            scale={5}
            xChannelSelector="R"
            yChannelSelector="G"
          />
        </filter>
      </defs>

      <rect width="100%" height="100%" rx={8} ry={8} fill="var(--color-terracotta)" opacity={0.15} style={{ mixBlendMode: "multiply" }} filter={`url(#${uid}-stain)`} />
      <rect
        width="100%"
        height="100%"
        rx={8}
        ry={8}
        fill="var(--color-ink)"
        opacity={0.28}
        style={{ mixBlendMode: "multiply" }}
        filter={`url(#${uid}-grain)`}
      />
      <rect
        x={0.75}
        y={0.75}
        width="calc(100% - 1.5px)"
        height="calc(100% - 1.5px)"
        rx={8}
        ry={8}
        fill="none"
        stroke={strokeColor}
        strokeOpacity={invalid ? 0.7 : 0.5}
        strokeWidth={1.75}
        filter={`url(#${uid}-edge)`}
      />
    </svg>
  );
});

export type InputProps = HeadlessInputProps & {
  label: string;
  description?: string;
  error?: string;
};

export function Input({ label, description, error, className = "", ...props }: InputProps) {
  const invalid = Boolean(error);

  return (
    <Field className="flex flex-col gap-1.5">
      <Label className="text-sm font-medium text-ink/80">{label}</Label>
      <div className="relative h-11 rounded-lg">
        <HeadlessInput
          {...props}
          aria-invalid={invalid || undefined}
          className={`
            relative z-0 h-11 w-full rounded-lg border-0 bg-sand px-3.5 text-sm text-ink outline-none
            shadow-[inset_0_4px_8px_-6px_rgba(42,29,22,0.35)]
            placeholder:text-ink/35
            transition-shadow duration-150
            data-[disabled]:cursor-not-allowed data-[disabled]:opacity-45 data-[disabled]:shadow-none
            ${
              invalid
                ? "data-[focus]:shadow-[inset_0_4px_8px_-6px_rgba(42,29,22,0.35),0_0_0_3px_var(--color-sand),0_0_0_4px_var(--color-crimson)]"
                : "data-[focus]:shadow-[inset_0_4px_8px_-6px_rgba(42,29,22,0.35),0_0_0_3px_var(--color-sand),0_0_0_4px_var(--color-turquoise-dark)]"
            }
            ${className}
          `}
        />
        <AgedFrame invalid={invalid} />
      </div>
      {error ? (
        <p className="text-xs text-crimson">{error}</p>
      ) : description ? (
        <Description className="text-xs text-ink/50">{description}</Description>
      ) : null}
    </Field>
  );
}
