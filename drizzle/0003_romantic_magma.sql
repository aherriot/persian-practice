CREATE TABLE "AudioClip" (
	"hash" text PRIMARY KEY NOT NULL,
	"text" text NOT NULL,
	"instructions" text NOT NULL,
	"data" text,
	"createdAt" timestamp (3) DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "Knowledge" (
	"id" text PRIMARY KEY NOT NULL,
	"userId" text NOT NULL,
	"kind" text NOT NULL,
	"refId" text NOT NULL,
	"intervalDays" real DEFAULT 0 NOT NULL,
	"easeFactor" real DEFAULT 2.5 NOT NULL,
	"repetitions" integer DEFAULT 0 NOT NULL,
	"lapses" integer DEFAULT 0 NOT NULL,
	"dueAt" timestamp (3) NOT NULL,
	"lastReviewedAt" timestamp (3),
	"introducedAt" timestamp (3) DEFAULT now() NOT NULL,
	CONSTRAINT "Knowledge_userId_kind_refId_unique" UNIQUE("userId","kind","refId")
);
--> statement-breakpoint
CREATE TABLE "Lexeme" (
	"id" text PRIMARY KEY NOT NULL,
	"fa" text NOT NULL,
	"voc" text NOT NULL,
	"translit" text NOT NULL,
	"gloss" text NOT NULL,
	"lemma" text,
	"literary" text,
	"note" text,
	"ownerId" text,
	"createdAt" timestamp (3) DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "Pattern" (
	"id" text PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"summary" text NOT NULL,
	"position" integer NOT NULL,
	"createdAt" timestamp (3) DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ReviewLog" (
	"id" text PRIMARY KEY NOT NULL,
	"userId" text NOT NULL,
	"sentenceId" text,
	"exercise" text NOT NULL,
	"correct" boolean NOT NULL,
	"createdAt" timestamp (3) DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "Sentence" (
	"id" text PRIMARY KEY NOT NULL,
	"themeId" text NOT NULL,
	"position" integer NOT NULL,
	"english" text NOT NULL,
	"note" text,
	"tokens" jsonb NOT NULL,
	"endPunct" text NOT NULL,
	"lexemeIds" text[] NOT NULL,
	"patternIds" text[] DEFAULT '{}' NOT NULL,
	"createdAt" timestamp (3) DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "Theme" (
	"id" text PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"titleFa" text NOT NULL,
	"description" text NOT NULL,
	"position" integer NOT NULL,
	"createdAt" timestamp (3) DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "Knowledge" ADD CONSTRAINT "Knowledge_userId_User_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "Lexeme" ADD CONSTRAINT "Lexeme_ownerId_User_id_fk" FOREIGN KEY ("ownerId") REFERENCES "public"."User"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ReviewLog" ADD CONSTRAINT "ReviewLog_userId_User_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "Sentence" ADD CONSTRAINT "Sentence_themeId_Theme_id_fk" FOREIGN KEY ("themeId") REFERENCES "public"."Theme"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "Knowledge_userId_dueAt_index" ON "Knowledge" USING btree ("userId","dueAt");--> statement-breakpoint
CREATE INDEX "ReviewLog_userId_createdAt_index" ON "ReviewLog" USING btree ("userId","createdAt");--> statement-breakpoint
CREATE INDEX "Sentence_themeId_position_index" ON "Sentence" USING btree ("themeId","position");