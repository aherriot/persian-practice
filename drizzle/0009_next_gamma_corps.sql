CREATE TABLE "AudioReview" (
	"id" text PRIMARY KEY NOT NULL,
	"hash" text NOT NULL,
	"verdict" text NOT NULL,
	"reason" text,
	"note" text,
	"instructions" text,
	"heard" text,
	"listenerStatus" text,
	"userId" text,
	"createdAt" timestamp (3) DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "AudioClip" ADD COLUMN "approvedAt" timestamp (3);--> statement-breakpoint
ALTER TABLE "AudioReview" ADD CONSTRAINT "AudioReview_hash_AudioClip_hash_fk" FOREIGN KEY ("hash") REFERENCES "public"."AudioClip"("hash") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "AudioReview" ADD CONSTRAINT "AudioReview_userId_User_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "AudioReview_hash_index" ON "AudioReview" USING btree ("hash");