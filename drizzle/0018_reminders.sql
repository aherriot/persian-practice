ALTER TABLE "User" ADD COLUMN "reminders" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "User" ADD COLUMN "timeZone" text;--> statement-breakpoint
ALTER TABLE "User" ADD COLUMN "lastRemindedAt" timestamp (3);