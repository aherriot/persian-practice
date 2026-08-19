"use client";

import { useId, type ReactNode } from "react";
import { Button as HeadlessButton, type ButtonProps as HeadlessButtonProps } from "@headlessui/react";
import { GeometricPattern } from "./GeometricPattern";

/**
 * The signature interactive element. Not a rounded rectangle: an arch-top
 * silhouette (rounded top corners, square base — an iwan/mihrab niche, not a
 * "pill"), a saturated tile-glaze fill with the girih pattern inlaid at low
 * opacity, and a double-line frame (gold inner border, ink outer ring with a
 * sand-colored gap — like a tile set into a wall, not drawn on top of it).
 *
 * Built on Headless UI's Button for interaction state (hover/focus-visible/
 * active/disabled all arrive as real data-* attributes, styled below) rather
 * than hand-rolling event handlers — see docs/design-system.md.
 */

const VARIANTS = {
  primary: {
    bg: "bg-cobalt",
    text: "text-sand",
    patternInner: "var(--color-turquoise)",
    patternOuter: "var(--color-sand)",
  },
  secondary: {
    bg: "bg-terracotta",
    text: "text-sand",
    patternInner: "var(--color-gold)",
    patternOuter: "var(--color-sand)",
  },
  ghost: {
    bg: "bg-paper",
    text: "text-ink",
    patternInner: "var(--color-cobalt)",
    patternOuter: "var(--color-turquoise)",
  },
} as const;

export type ButtonVariant = keyof typeof VARIANTS;

export type ButtonProps = Omit<HeadlessButtonProps, "children"> & {
  variant?: ButtonVariant;
  children: ReactNode;
};

export function Button({ variant = "primary", className = "", children, ...props }: ButtonProps) {
  const v = VARIANTS[variant];
  // useId(), not a module-level counter: the counter approach isn't SSR-safe
  // — the module persists across requests on the server, so its value at
  // render time doesn't necessarily match where the client starts fresh,
  // producing a hydration mismatch on the pattern's id/fill attributes.
  const patternId = `btn-pattern-${useId()}`;

  return (
    <HeadlessButton
      {...props}
      className={`
        group relative isolate inline-flex items-center justify-center overflow-hidden
        rounded-t-2xl rounded-b-md border-[1.5px] border-gold px-6 py-2.5
        text-sm font-medium tracking-wide
        shadow-[0_0_0_3px_var(--color-sand),0_0_0_4px_var(--color-ink)]
        transition-[transform,box-shadow] duration-150
        data-[hover]:-translate-y-0.5
        data-[active]:translate-y-0 data-[active]:scale-[0.98]
        data-[focus]:shadow-[0_0_0_3px_var(--color-sand),0_0_0_5px_var(--color-turquoise-dark)]
        data-[disabled]:cursor-not-allowed data-[disabled]:opacity-45 data-[disabled]:shadow-none
        ${v.bg} ${v.text} ${className}
      `}
    >
      <div className="pointer-events-none absolute inset-0 -z-10 opacity-25 transition-opacity duration-150 group-data-[hover]:opacity-45">
        <GeometricPattern
          id={patternId}
          size={70}
          opacity={1}
          outerStarColor={v.patternOuter}
          innerStarColor={v.patternInner}
          latticeColor={v.patternOuter}
          latticeAccentColor={v.patternInner}
          centerColor={v.patternOuter}
        />
      </div>
      <span style={{ fontFamily: "var(--font-display-latin)" }}>{children}</span>
    </HeadlessButton>
  );
}
