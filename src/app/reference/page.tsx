import Link from "next/link";
import { ReviewerProvider } from "@/components/Reviewer";
import { canReviewAudio } from "@/lib/auth/reviewer";
import { requireUser } from "@/lib/auth/session";
import { audioUrl, wordClip } from "@/lib/audio-key";
import { loadKnowledge, loadVocabulary } from "@/lib/lesson/store";
import { Reference, type ReferencePattern, type ReferenceWord } from "./Reference";

export default async function ReferencePage() {
  const user = await requireUser();
  const [vocabulary, knowledge] = await Promise.all([loadVocabulary(user.id), loadKnowledge(user.id)]);

  // Example sentences are fetched when an entry is opened (/api/reference/examples).
  const words: ReferenceWord[] = vocabulary.lexemes.map((lexeme) => ({
    id: lexeme.id,
    fa: lexeme.fa,
    voc: lexeme.voc,
    translit: lexeme.translit,
    gloss: lexeme.gloss,
    lemma: lexeme.lemma,
    literary: lexeme.literary,
    note: lexeme.note,
    met: knowledge.has(`lexeme:${lexeme.id}`),
    addedBy: lexeme.addedBy,
    audioUrl: audioUrl(wordClip(lexeme)),
  }));

  const patterns: ReferencePattern[] = vocabulary.patterns.map((pattern) => ({
    id: pattern.id,
    title: pattern.title,
    summary: pattern.summary,
    met: knowledge.has(`pattern:${pattern.id}`),
  }));

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-xl flex-col gap-6 bg-paper px-5 py-8">
      <header className="flex items-baseline justify-between gap-4">
        <h1 className="font-[family-name:var(--font-display-latin)] text-2xl font-bold text-ink">Reference</h1>
        <Link href="/dashboard" className="text-sm text-ink/50 underline">
          Back
        </Link>
      </header>
      <ReviewerProvider enabled={canReviewAudio(user.email)}>
        <Reference words={words} patterns={patterns} />
      </ReviewerProvider>
    </main>
  );
}
