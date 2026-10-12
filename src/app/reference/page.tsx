import Link from "next/link";
import { AudioReviewProvider } from "@/components/AudioReview";
import { canReviewAudio } from "@/lib/auth/reviewer";
import { requireUser } from "@/lib/auth/session";
import { audioUrl, wordClip } from "@/lib/audio-key";
import { sentenceClip } from "@/lib/lesson/plan";
import { loadAllContent, loadKnowledge } from "@/lib/lesson/store";
import type { Sentence } from "@/lib/lesson/types";
import { Reference, type ReferenceExample, type ReferencePattern, type ReferenceWord } from "./Reference";

const MAX_EXAMPLES = 3;

export default async function ReferencePage() {
  const user = await requireUser();
  const [content, knowledge] = await Promise.all([loadAllContent(user.id), loadKnowledge(user.id)]);

  const example = (s: Sentence): ReferenceExample => ({
    id: s.id,
    voc: s.tokens.map((t) => t.voc + (t.after ?? "")).join(" ") + s.endPunct,
    translit: s.tokens.map((t) => t.translit + (t.after ? "," : "")).join(" "),
    english: s.english,
    audioUrl: audioUrl(sentenceClip(s)),
    generated: s.generated,
  });
  // Shortest sentences first: the clearest illustration of a word is the one with least else in it.
  const examplesOf = (uses: (s: Sentence) => boolean) =>
    content.sentences
      .filter(uses)
      .sort((a, b) => a.tokens.length - b.tokens.length)
      .slice(0, MAX_EXAMPLES)
      .map(example);

  // In the order they are taught.
  const order = [...new Set(content.sentences.flatMap((s) => s.lexemeIds))];
  const words: ReferenceWord[] = order.flatMap((id) => {
    const lexeme = content.lexemes.get(id);
    if (!lexeme) return [];
    return [
      {
        id,
        fa: lexeme.fa,
        voc: lexeme.voc,
        translit: lexeme.translit,
        gloss: lexeme.gloss,
        lemma: lexeme.lemma,
        literary: lexeme.literary,
        note: lexeme.note,
        met: knowledge.has(`lexeme:${id}`),
        addedBy: lexeme.addedBy,
        audioUrl: audioUrl(wordClip(lexeme)),
        examples: examplesOf((s) => s.lexemeIds.includes(id) && s.tokens.length > 1),
      },
    ];
  });

  const patterns: ReferencePattern[] = [...content.patterns.values()].map((pattern) => ({
    ...pattern,
    met: knowledge.has(`pattern:${pattern.id}`),
    examples: examplesOf((s) => s.patternIds.includes(pattern.id)),
  }));

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-xl flex-col gap-6 bg-paper px-5 py-8">
      <header className="flex items-baseline justify-between gap-4">
        <h1 className="font-[family-name:var(--font-display-latin)] text-2xl font-bold text-ink">Reference</h1>
        <Link href="/dashboard" className="text-sm text-ink/50 underline">
          Back
        </Link>
      </header>
      <AudioReviewProvider enabled={canReviewAudio(user.email)}>
        <Reference words={words} patterns={patterns} />
      </AudioReviewProvider>
    </main>
  );
}
