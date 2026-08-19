CREATE TABLE "Account" (
	"userId" text NOT NULL,
	"type" text NOT NULL,
	"provider" text NOT NULL,
	"providerAccountId" text NOT NULL,
	"refresh_token" text,
	"access_token" text,
	"expires_at" integer,
	"token_type" text,
	"scope" text,
	"id_token" text,
	"session_state" text,
	CONSTRAINT "Account_provider_providerAccountId_pk" PRIMARY KEY("provider","providerAccountId")
);
--> statement-breakpoint
CREATE TABLE "Conversation" (
	"id" text PRIMARY KEY NOT NULL,
	"userId" text NOT NULL,
	"topicId" text,
	"mode" text NOT NULL,
	"startedAt" timestamp (3) DEFAULT now() NOT NULL,
	"endedAt" timestamp (3)
);
--> statement-breakpoint
CREATE TABLE "Correction" (
	"id" text PRIMARY KEY NOT NULL,
	"turnId" text NOT NULL,
	"itemId" text NOT NULL,
	"outcome" text NOT NULL,
	"note" text,
	"createdAt" timestamp (3) DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "Item" (
	"id" text PRIMARY KEY NOT NULL,
	"type" text NOT NULL,
	"persian" text NOT NULL,
	"literary" text,
	"gloss" text NOT NULL,
	"transliteration" text,
	"tier" integer NOT NULL,
	"tags" text[] DEFAULT '{}' NOT NULL,
	"createdAt" timestamp (3) DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "PlacementResponse" (
	"id" text PRIMARY KEY NOT NULL,
	"placementSessionId" text NOT NULL,
	"itemId" text,
	"tier" integer NOT NULL,
	"correct" boolean NOT NULL,
	"seq" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "PlacementSession" (
	"id" text PRIMARY KEY NOT NULL,
	"userId" text NOT NULL,
	"status" text NOT NULL,
	"currentTier" integer NOT NULL,
	"lowTier" integer NOT NULL,
	"highTier" integer NOT NULL,
	"exchangeCount" integer DEFAULT 0 NOT NULL,
	"resultLevel" text,
	"createdAt" timestamp (3) DEFAULT now() NOT NULL,
	"completedAt" timestamp (3)
);
--> statement-breakpoint
CREATE TABLE "Session" (
	"sessionToken" text PRIMARY KEY NOT NULL,
	"userId" text NOT NULL,
	"expires" timestamp (3) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "Topic" (
	"id" text PRIMARY KEY NOT NULL,
	"userId" text NOT NULL,
	"rawText" text NOT NULL,
	"summary" text,
	"tags" text[] DEFAULT '{}' NOT NULL,
	"createdAt" timestamp (3) DEFAULT now() NOT NULL,
	"lastUsedAt" timestamp (3) DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "Turn" (
	"id" text PRIMARY KEY NOT NULL,
	"conversationId" text NOT NULL,
	"role" text NOT NULL,
	"content" text NOT NULL,
	"seq" integer NOT NULL,
	"createdAt" timestamp (3) DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "UserItem" (
	"id" text PRIMARY KEY NOT NULL,
	"userId" text NOT NULL,
	"itemId" text NOT NULL,
	"intervalDays" real DEFAULT 0 NOT NULL,
	"easeFactor" real DEFAULT 2.5 NOT NULL,
	"repetitions" integer DEFAULT 0 NOT NULL,
	"dueAt" date NOT NULL,
	"lapses" integer DEFAULT 0 NOT NULL,
	"lastReviewedAt" timestamp (3),
	"introducedAt" timestamp (3) DEFAULT now() NOT NULL,
	"source" text NOT NULL,
	CONSTRAINT "UserItem_userId_itemId_unique" UNIQUE("userId","itemId")
);
--> statement-breakpoint
CREATE TABLE "User" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text,
	"email" text,
	"emailVerified" timestamp (3),
	"image" text,
	"level" text,
	"createdAt" timestamp (3) DEFAULT now() NOT NULL,
	CONSTRAINT "User_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "VerificationToken" (
	"identifier" text NOT NULL,
	"token" text NOT NULL,
	"expires" timestamp (3) NOT NULL,
	CONSTRAINT "VerificationToken_identifier_token_pk" PRIMARY KEY("identifier","token")
);
--> statement-breakpoint
ALTER TABLE "Account" ADD CONSTRAINT "Account_userId_User_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "Conversation" ADD CONSTRAINT "Conversation_userId_User_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "Conversation" ADD CONSTRAINT "Conversation_topicId_Topic_id_fk" FOREIGN KEY ("topicId") REFERENCES "public"."Topic"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "Correction" ADD CONSTRAINT "Correction_turnId_Turn_id_fk" FOREIGN KEY ("turnId") REFERENCES "public"."Turn"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "Correction" ADD CONSTRAINT "Correction_itemId_Item_id_fk" FOREIGN KEY ("itemId") REFERENCES "public"."Item"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "PlacementResponse" ADD CONSTRAINT "PlacementResponse_placementSessionId_PlacementSession_id_fk" FOREIGN KEY ("placementSessionId") REFERENCES "public"."PlacementSession"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "PlacementResponse" ADD CONSTRAINT "PlacementResponse_itemId_Item_id_fk" FOREIGN KEY ("itemId") REFERENCES "public"."Item"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "PlacementSession" ADD CONSTRAINT "PlacementSession_userId_User_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_User_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "Topic" ADD CONSTRAINT "Topic_userId_User_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "Turn" ADD CONSTRAINT "Turn_conversationId_Conversation_id_fk" FOREIGN KEY ("conversationId") REFERENCES "public"."Conversation"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "UserItem" ADD CONSTRAINT "UserItem_userId_User_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "UserItem" ADD CONSTRAINT "UserItem_itemId_Item_id_fk" FOREIGN KEY ("itemId") REFERENCES "public"."Item"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "Turn_conversationId_seq_index" ON "Turn" USING btree ("conversationId","seq");--> statement-breakpoint
CREATE INDEX "UserItem_userId_dueAt_index" ON "UserItem" USING btree ("userId","dueAt");