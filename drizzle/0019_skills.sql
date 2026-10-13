-- Listening, reading and producing become separate schedules. What a learner
-- knew before was not recorded by skill, so each existing row becomes three
-- alike, one per skill: nothing is lost and nothing falls due that was not.
-- (Hand-edited: as generated, the new column had no value for existing rows.)
ALTER TABLE "Knowledge" DROP CONSTRAINT "Knowledge_userId_kind_refId_unique";--> statement-breakpoint
ALTER TABLE "Knowledge" ADD COLUMN "skill" text DEFAULT 'listening' NOT NULL;--> statement-breakpoint
ALTER TABLE "Knowledge" ALTER COLUMN "skill" DROP DEFAULT;--> statement-breakpoint
INSERT INTO "Knowledge" ("id", "userId", "kind", "refId", "skill", "stability", "difficulty", "intervalDays", "repetitions", "lapses", "dueAt", "lastReviewedAt", "introducedAt")
SELECT gen_random_uuid()::text, k."userId", k."kind", k."refId", s."skill", k."stability", k."difficulty", k."intervalDays", k."repetitions", k."lapses", k."dueAt", k."lastReviewedAt", k."introducedAt"
FROM "Knowledge" k CROSS JOIN (VALUES ('reading'), ('producing')) AS s("skill");--> statement-breakpoint
ALTER TABLE "Knowledge" ADD CONSTRAINT "Knowledge_userId_kind_refId_skill_unique" UNIQUE("userId","kind","refId","skill");
