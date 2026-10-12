ALTER TABLE "Sentence" ADD COLUMN "ownerId" text;--> statement-breakpoint
ALTER TABLE "Sentence" ADD CONSTRAINT "Sentence_ownerId_User_id_fk" FOREIGN KEY ("ownerId") REFERENCES "public"."User"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ReviewLog_userId_sentenceId_index" ON "ReviewLog" USING btree ("userId","sentenceId");--> statement-breakpoint
CREATE INDEX "Sentence_ownerId_index" ON "Sentence" USING btree ("ownerId");--> statement-breakpoint
-- Sentences in a learner's own theme belong to that learner.
UPDATE "Sentence" s SET "ownerId" = t."ownerId" FROM "Theme" t WHERE s."themeId" = t."id" AND t."ownerId" IS NOT NULL;--> statement-breakpoint
-- So do sentences built around a word only that learner has.
UPDATE "Sentence" s SET "ownerId" = l."ownerId" FROM "Lexeme" l WHERE s."ownerId" IS NULL AND l."ownerId" IS NOT NULL AND l."id" = ANY(s."lexemeIds");--> statement-breakpoint
-- With a single learner, every other generated sentence was written for them. With more, who it
-- was written for is not recorded, so those stay shared.
UPDATE "Sentence" SET "ownerId" = (SELECT "id" FROM "User" LIMIT 1) WHERE "ownerId" IS NULL AND "generated" AND "themeId" IS NULL AND (SELECT count(*) FROM "User") = 1;
