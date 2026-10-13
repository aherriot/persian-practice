ALTER TABLE "Knowledge" ADD COLUMN "stability" real DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "Knowledge" ADD COLUMN "difficulty" real DEFAULT 0 NOT NULL;--> statement-breakpoint
-- SM-2 to FSRS (src/lib/srs.ts). Only what has been answered at least once has a memory state;
-- the rest stays at zero and takes FSRS's starting values at its first answer.
-- Stability is the number of days for recall to fall to 90%, which is what the SM-2 interval was
-- aiming at, so the interval carries over as it stands (never below a first wrong answer's 0.4).
-- Difficulty is what FSRS would have reached for a word first answered right (5.28) and then
-- missed "lapses" times, each miss closing 32.5% of the remaining distance to the ceiling of 10.
-- The ease factor is not carried over: it could only ever fall, which is the fault being fixed.
UPDATE "Knowledge" SET
  "stability" = GREATEST("intervalDays", 0.4),
  "difficulty" = 10 - 4.7176 * power(0.67547, "lapses")
WHERE "lastReviewedAt" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "Knowledge" DROP COLUMN "easeFactor";