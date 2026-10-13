import { SHOPPING } from "./shopping";
import type { PatternSeed, ThemeSeed } from "./types";

/** Every hand-curated theme, in the order the course teaches them. */
export const THEMES: ThemeSeed[] = [SHOPPING].sort((a, b) => a.position - b.position);

/**
 * The curated grammar, each pattern once, in the order the course first
 * teaches it. A pattern shared by several themes has one place in the
 * reference, whichever theme it is seeded from.
 */
export const PATTERNS: PatternSeed[] = [...new Map(THEMES.flatMap((t) => t.patterns).map((p) => [p.id, p])).values()];
