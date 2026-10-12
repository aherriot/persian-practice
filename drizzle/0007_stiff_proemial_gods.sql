ALTER TABLE "Sentence" ALTER COLUMN "themeId" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "Sentence" ADD COLUMN "generated" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "Sentence" ADD COLUMN "ladder" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "Sentence" ADD COLUMN "retired" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "Theme" ADD COLUMN "ownerId" text;--> statement-breakpoint
ALTER TABLE "Theme" ADD CONSTRAINT "Theme_ownerId_User_id_fk" FOREIGN KEY ("ownerId") REFERENCES "public"."User"("id") ON DELETE cascade ON UPDATE no action;