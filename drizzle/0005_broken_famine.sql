-- Clip identity now includes the expected reading, so every hash changes.
-- Rows are derived from content and re-registered by `npm run db:seed`.
DELETE FROM "AudioClip";--> statement-breakpoint
ALTER TABLE "AudioClip" ALTER COLUMN "instructions" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "AudioClip" ADD COLUMN "expected" text NOT NULL;--> statement-breakpoint
ALTER TABLE "AudioClip" ADD COLUMN "status" text;--> statement-breakpoint
ALTER TABLE "AudioClip" ADD COLUMN "heard" text;--> statement-breakpoint
ALTER TABLE "AudioClip" ADD COLUMN "attempts" integer;