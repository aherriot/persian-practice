CREATE TABLE "Correction" (
	"id" text PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"refId" text NOT NULL,
	"request" text NOT NULL,
	"summary" text NOT NULL,
	"changes" jsonb NOT NULL,
	"userId" text,
	"createdAt" timestamp (3) DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "Correction" ADD CONSTRAINT "Correction_userId_User_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "Correction_kind_refId_index" ON "Correction" USING btree ("kind","refId");