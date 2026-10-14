CREATE TABLE "Flag" (
	"id" text PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"refId" text NOT NULL,
	"note" text NOT NULL,
	"userId" text NOT NULL,
	"createdAt" timestamp (3) DEFAULT now() NOT NULL,
	"resolvedAt" timestamp (3),
	"outcome" text
);
--> statement-breakpoint
ALTER TABLE "Flag" ADD CONSTRAINT "Flag_userId_User_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "Flag_kind_refId_index" ON "Flag" USING btree ("kind","refId");