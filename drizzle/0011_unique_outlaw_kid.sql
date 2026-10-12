CREATE INDEX "Sentence_lexemeIds_index" ON "Sentence" USING gin ("lexemeIds");--> statement-breakpoint
CREATE INDEX "Sentence_patternIds_index" ON "Sentence" USING gin ("patternIds");