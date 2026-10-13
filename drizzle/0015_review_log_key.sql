ALTER TABLE "ReviewLog" ADD COLUMN "key" text;--> statement-breakpoint
ALTER TABLE "ReviewLog" ADD CONSTRAINT "ReviewLog_key_unique" UNIQUE("key");