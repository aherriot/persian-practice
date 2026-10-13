CREATE TABLE "Job" (
	"id" text PRIMARY KEY NOT NULL,
	"userId" text NOT NULL,
	"kind" text NOT NULL,
	"key" text NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"state" jsonb,
	"status" text DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"runAfter" timestamp (3) DEFAULT now() NOT NULL,
	"leaseId" text,
	"leaseUntil" timestamp (3),
	"lastError" text,
	"createdAt" timestamp (3) DEFAULT now() NOT NULL,
	"finishedAt" timestamp (3)
);
--> statement-breakpoint
ALTER TABLE "Job" ADD CONSTRAINT "Job_userId_User_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "Job_key_index" ON "Job" USING btree ("key") WHERE "status" = 'pending';--> statement-breakpoint
CREATE INDEX "Job_status_runAfter_index" ON "Job" USING btree ("status","runAfter");