"use client";

import Link from "next/link";
import { useCallback, useEffect, useState, useSyncExternalStore, type ReactNode } from "react";
import { Button } from "@/components/Button";
import { OrsiWindow } from "@/components/OrsiWindow";
import { playAudio, preloadAudio, unlockAudio } from "@/lib/audio-client";
import { lessonOutbox, type OutboxStatus } from "@/lib/lesson/outbox";
import { exerciseName, type ChoiceExercise, type Exercise, type SessionPlan, type TilesExercise } from "@/lib/lesson/types";
import { normalizeForCompare } from "@/lib/normalize";
import { SentenceView, SpeakButton, shown } from "./Persian";

const PRELOAD_AHEAD = 3;

function audioFor(exercise: Exercise): string[] {
  const urls = [exercise.sentence.audioUrl];
  if (exercise.type === "intro-lexeme") urls.push(exercise.lexeme.audioUrl);
  if (exercise.type === "choice" && exercise.wordAudioUrl) urls.push(exercise.wordAudioUrl);
  return urls;
}

/** What should be heard the moment an exercise appears, if anything. */
function openingAudio(exercise: Exercise): string | null {
  if (exercise.type === "intro-lexeme") return exercise.lexeme.audioUrl;
  if (exercise.type === "intro-pattern") return exercise.sentence.audioUrl;
  if (exercise.type === "tiles") return exercise.variant === "dictation" ? exercise.sentence.audioUrl : null;
  if (exercise.type !== "choice") return null;
  if (exercise.variant === "listen") return exercise.sentence.audioUrl;
  if (exercise.variant === "hear-word" || exercise.variant === "hear-pick") return exercise.wordAudioUrl ?? null;
  return null;
}

const count = (n: number, noun: string) => `${n} ${noun}${n === 1 ? "" : "s"}`;

function newThings(plan: SessionPlan): string {
  const words = plan.exercises.filter((e) => e.type === "intro-lexeme").length;
  const grammar = plan.exercises.filter((e) => e.type === "intro-pattern").length;
  return [words > 0 && count(words, "new word"), grammar > 0 && count(grammar, "new grammar point")]
    .filter(Boolean)
    .join(" and ");
}

function describePlan(plan: SessionPlan): string {
  const review = `practise ${count(plan.reviewCount, "thing")} you have met before`;
  if (plan.newCount > 0 && plan.reviewCount > 0) return `You will learn ${newThings(plan)} and ${review}.`;
  if (plan.newCount > 0) return `You will learn ${newThings(plan)}, one at a time, then practise using them.`;
  if (plan.reviewCount > 0) return `You will ${review}.`;
  return "Nothing is due for review, so this is a short practice round with sentences you already know.";
}

const NOTHING_UNSENT: OutboxStatus = { pending: 0, failing: false };
/** How long "Another session" waits for the last answers to be saved before planning from what there is. */
const SAVE_WAIT_MS = 4000;

/** `href` is this session's own address, for starting another one. */
export function Session({ plan, href, userId }: { plan: SessionPlan; href: string; userId: string }) {
  const [queue, setQueue] = useState<Exercise[]>(plan.exercises);
  const [index, setIndex] = useState(-1); // -1 = start screen
  const [answered, setAnswered] = useState<boolean | null>(null);
  // Said alongside "Correct" when the answer was right but not the model answer.
  const [remark, setRemark] = useState<string | null>(null);
  const [score, setScore] = useState({ right: 0, total: 0 });
  const [leaving, setLeaving] = useState(false);

  // Answers are saved in the background, in order, and kept on this device
  // until the server has them (src/lib/lesson/outbox.ts).
  const save = useCallback((body: unknown) => lessonOutbox(userId).add(body), [userId]);
  const unsent = useSyncExternalStore(
    useCallback((listener: () => void) => lessonOutbox(userId).subscribe(listener), [userId]),
    () => lessonOutbox(userId).status(),
    () => NOTHING_UNSENT,
  );

  useEffect(() => {
    // Anything an earlier page did not manage to send goes now, and again whenever the connection returns.
    const flush = () => lessonOutbox(userId).flush();
    flush();
    window.addEventListener("online", flush);
    return () => window.removeEventListener("online", flush);
  }, [userId]);

  const notice = unsent.failing ? <Unsaved count={unsent.pending} /> : null;

  const exercise = index >= 0 && index < queue.length ? queue[index] : null;

  useEffect(() => {
    for (const upcoming of queue.slice(Math.max(index, 0), Math.max(index, 0) + PRELOAD_AHEAD)) {
      for (const url of audioFor(upcoming)) void preloadAudio(url).catch(() => {});
    }
  }, [queue, index]);

  const goTo = useCallback(
    (next: number) => {
      setAnswered(null);
      setRemark(null);
      setIndex(next);
      const opening = next < queue.length ? openingAudio(queue[next]) : null;
      if (opening) void playAudio(opening);
    },
    [queue],
  );

  const advance = useCallback(() => goTo(index + 1), [goTo, index]);

  const grade = useCallback(
    (correct: boolean, answer: string | string[], note?: string) => {
      if (!exercise || exercise.type === "intro-lexeme" || exercise.type === "intro-pattern") return;
      setAnswered(correct);
      setRemark(note ?? null);
      const isRetry = exercise.key.endsWith("-retry");
      if (!isRetry) {
        setScore((s) => ({ right: s.right + (correct ? 1 : 0), total: s.total + 1 }));
        // `correct` is this page's own marking, for showing at once. The server marks the answer again and stores that.
        save({
          sentenceId: exercise.sentence.id,
          exercise: exerciseName(exercise),
          primary: exercise.primary,
          answer,
        });
        // A miss comes back once at the end, ungraded, so the session ends on a success.
        if (!correct) {
          setQueue((q) => [...q, { ...exercise, key: `${exercise.key}-retry`, primary: null, others: [] }]);
        }
      }
      // Having just heard the sentence and got it right, there is no call to hear it again.
      if (!(correct && (exercise.variant === "listen" || exercise.variant === "dictation"))) {
        void playAudio(exercise.sentence.audioUrl);
      }
    },
    [exercise, save],
  );

  const acknowledge = useCallback(() => {
    if (exercise?.type === "intro-lexeme" || exercise?.type === "intro-pattern") save({ introduce: exercise.target });
    advance();
  }, [exercise, advance, save]);

  const canContinue = exercise !== null && (exercise.type.startsWith("intro") || answered !== null);

  if (index === -1) {
    return (
      <Shell>
        <div className="flex flex-1 flex-col items-center justify-center gap-6 text-center">
          <h1 className="font-[family-name:var(--font-display-latin)] text-2xl font-bold text-ink">Ready?</h1>
          {plan.exercises.length === 0 ? (
            <p className="text-sm text-ink/60">There is nothing to practise here yet.</p>
          ) : (
            <p className="max-w-xs text-sm leading-relaxed text-ink/70">
              {describePlan(plan)} It takes {plan.exercises.length} short exercises.
            </p>
          )}
          {plan.exercises.length > 0 && (
            <Button
              autoFocus
              onClick={() => {
                unlockAudio();
                goTo(0);
              }}
            >
              Begin
            </Button>
          )}
          <Link href="/dashboard" className="text-sm text-ink/50 underline">
            Back
          </Link>
        </div>
      </Shell>
    );
  }

  if (!exercise) {
    return (
      <Shell notice={notice}>
        <div className="flex flex-1 flex-col items-center justify-center gap-6 text-center">
          <div className="w-56">
            <OrsiWindow id="session-complete" />
          </div>
          <h1 className="font-[family-name:var(--font-display-latin)] text-2xl font-bold text-ink">Session complete</h1>
          <p className="text-sm text-ink/60">
            {score.total > 0 && `${score.right} of ${score.total} right first time`}
            {score.total > 0 && plan.newCount > 0 && " · "}
            {plan.newCount > 0 && `you met ${newThings(plan)}`}
          </p>
          <div className="flex items-center gap-6">
            {/* A full page load, so the server plans the next session from the saved answers: wait for the last of them. */}
            <a
              href={href}
              aria-disabled={leaving}
              className="text-sm font-medium text-cobalt underline aria-disabled:opacity-60"
              onClick={(event) => {
                event.preventDefault();
                if (leaving) return;
                setLeaving(true);
                void lessonOutbox(userId)
                  .drained(SAVE_WAIT_MS)
                  .then(() => window.location.assign(href));
              }}
            >
              {leaving ? "Saving…" : "Another session"}
            </a>
            <Link href="/dashboard" className="text-sm text-ink/60 underline">
              Done for now
            </Link>
          </div>
        </div>
      </Shell>
    );
  }

  return (
    <Shell progress={index / queue.length} notice={notice}>
      <div key={exercise.key} className="flex flex-1 flex-col gap-6">
        {exercise.type === "intro-lexeme" && (
          <>
            <Eyebrow>New word</Eyebrow>
            <div className="flex flex-col items-center gap-3 rounded-lg border border-ink/15 bg-sand px-6 py-8 text-center shadow-[inset_0_4px_8px_-6px_rgba(42,29,22,0.35)]">
              <p dir="rtl" lang="fa" className="text-5xl leading-[1.9] text-ink">
                {exercise.lexeme.voc}
              </p>
              <p className="text-lg text-ink/70">{exercise.lexeme.translit}</p>
              <p className="text-xl font-semibold text-ink">{exercise.lexeme.gloss}</p>
              <SpeakButton url={exercise.lexeme.audioUrl} label="Hear the word" />
              {exercise.lexeme.literary && (
                <p className="text-xs text-ink/55">
                  In books and formal writing:{" "}
                  <span dir="rtl" lang="fa" className="text-sm">
                    {exercise.lexeme.literary}
                  </span>
                </p>
              )}
              {exercise.lexeme.note && <p className="max-w-sm text-sm text-ink/65">{exercise.lexeme.note}</p>}
            </div>
            <Example exercise={exercise} />
          </>
        )}

        {exercise.type === "intro-pattern" && (
          <>
            <Eyebrow>New grammar</Eyebrow>
            <div className="rounded-lg border border-ink/15 bg-sand px-6 py-6 shadow-[inset_0_4px_8px_-6px_rgba(42,29,22,0.35)]">
              <h2 className="text-xl font-semibold text-ink">{exercise.pattern.title}</h2>
              <p className="mt-2 text-sm leading-relaxed text-ink/75">{exercise.pattern.summary}</p>
            </div>
            <Example exercise={exercise} />
          </>
        )}

        {exercise.type === "choice" && <Choice exercise={exercise} answered={answered} onAnswer={grade} />}
        {exercise.type === "tiles" && <Tiles exercise={exercise} answered={answered} onAnswer={grade} />}

        <div className="mt-auto flex flex-col gap-4">
          {answered !== null && (exercise.type === "choice" || exercise.type === "tiles") && (
            <div
              role="status"
              className={`rounded-lg border px-4 py-3 ${
                answered ? "border-turquoise-dark/40 bg-turquoise/10" : "border-crimson/40 bg-crimson/10"
              }`}
            >
              <p className={`text-sm font-semibold ${answered ? "text-turquoise-dark" : "text-crimson"}`}>
                {answered ? "Correct" : "Not quite"}
              </p>
              {remark && <p className="mt-1 text-sm text-ink/75">{remark}</p>}
              <div className="mt-1 flex items-start justify-between gap-3">
                <div>
                  <SentenceView sentence={exercise.sentence} revealMeaning className="text-2xl" />
                  <p className="text-sm text-ink/70">{exercise.sentence.translit}</p>
                  <p className="text-sm font-medium text-ink">{exercise.sentence.english}</p>
                  {exercise.sentence.note && <p className="mt-1 text-xs text-ink/60">{exercise.sentence.note}</p>}
                </div>
                <SpeakButton url={exercise.sentence.audioUrl} label="Hear the sentence" />
              </div>
              {exercise.sentence.generated && <ReportSentence key={exercise.key} sentenceId={exercise.sentence.id} />}
            </div>
          )}
          {canContinue && (
            <Button autoFocus className="self-end" onClick={answered !== null ? advance : acknowledge}>
              {answered !== null ? "Continue" : "Got it"}
            </Button>
          )}
        </div>
      </div>
    </Shell>
  );
}

/** Generated sentences are checked by machine, not by a person, so the learner gets the last word. */
function ReportSentence({ sentenceId }: { sentenceId: string }) {
  const [reported, setReported] = useState(false);
  if (reported) return <p className="mt-2 text-xs text-ink/60">Thanks. That sentence will not be shown again.</p>;
  return (
    <button
      type="button"
      className="mt-2 text-xs text-ink/50 underline hover:text-ink"
      onClick={() => {
        setReported(true);
        void fetch("/api/lesson/report", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sentenceId }),
        }).catch(() => {});
      }}
    >
      This sentence was written by the app. Does it sound wrong? Remove it
    </button>
  );
}

/** Shown only once saving has failed more than once; a single dropped request sorts itself out unseen. */
function Unsaved({ count }: { count: number }) {
  return (
    <p role="status" className="rounded-md border border-gold/50 bg-gold/10 px-3 py-2 text-xs text-ink/70">
      {count === 1 ? "Your last answer has" : `Your last ${count} answers have`} not been saved yet. Carry on: they are
      kept on this device and will be sent when the connection is back.
    </p>
  );
}

function Shell({ progress, notice, children }: { progress?: number; notice?: ReactNode; children: ReactNode }) {
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-xl flex-col gap-6 bg-paper px-5 py-6">
      {progress !== undefined && (
        <div className="flex items-center gap-3">
          <Link href="/dashboard" aria-label="Leave session" className="text-lg leading-none text-ink/40 hover:text-ink">
            ×
          </Link>
          <div
            role="progressbar"
            aria-valuenow={Math.round(progress * 100)}
            aria-valuemin={0}
            aria-valuemax={100}
            className="h-2 flex-1 overflow-hidden rounded-full bg-ink/10"
          >
            <div className="h-full rounded-full bg-turquoise-dark transition-[width] duration-300" style={{ width: `${progress * 100}%` }} />
          </div>
        </div>
      )}
      {notice}
      {children}
    </main>
  );
}

function Eyebrow({ children }: { children: ReactNode }) {
  return <p className="text-xs font-semibold uppercase tracking-widest text-ink/50">{children}</p>;
}

function Example({ exercise }: { exercise: Exercise }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <div>
        <Eyebrow>In a sentence</Eyebrow>
        <SentenceView sentence={exercise.sentence} revealMeaning className="text-2xl" />
        <p className="text-sm text-ink/70">{exercise.sentence.translit}</p>
        <p className="text-sm font-medium text-ink">{exercise.sentence.english}</p>
        {exercise.sentence.note && <p className="mt-1 text-xs text-ink/60">{exercise.sentence.note}</p>}
      </div>
      <SpeakButton url={exercise.sentence.audioUrl} label="Hear the sentence" />
    </div>
  );
}

const CHOICE_PROMPT: Record<ChoiceExercise["variant"], string> = {
  listen: "What did you hear?",
  "hear-word": "What does the word you hear mean?",
  "hear-pick": "Which word did you hear?",
  read: "What does this mean?",
  "read-word": "What does this word mean?",
  pronounce: "How is this word said?",
  "pick-word": "Which word means this?",
  cloze: "Which word is missing?",
};

/** Exercises answered by picking Persian rather than English. */
const PERSIAN_OPTIONS: ReadonlySet<ChoiceExercise["variant"]> = new Set(["hear-pick", "pick-word", "cloze"]);

function Choice({
  exercise,
  answered,
  onAnswer,
}: {
  exercise: ChoiceExercise;
  answered: boolean | null;
  onAnswer: (correct: boolean, picked: string) => void;
}) {
  const [picked, setPicked] = useState<number | null>(null);
  const done = answered !== null;
  const persianOptions = PERSIAN_OPTIONS.has(exercise.variant);

  const pick = useCallback(
    (i: number) => {
      if (done || i >= exercise.options.length) return;
      setPicked(i);
      onAnswer(i === exercise.answer, exercise.options[i]);
    },
    [done, exercise, onAnswer],
  );

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const n = Number(event.key);
      if (n >= 1 && n <= 4) pick(n - 1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [pick]);

  const token = exercise.tokenIndex !== undefined ? exercise.sentence.tokens[exercise.tokenIndex] : null;

  return (
    <>
      <Eyebrow>{CHOICE_PROMPT[exercise.variant]}</Eyebrow>

      <div className="flex min-h-28 flex-col items-center justify-center gap-3 text-center">
        {exercise.variant === "listen" && <SpeakButton url={exercise.sentence.audioUrl} label="Hear it again" large />}
        {(exercise.variant === "hear-word" || exercise.variant === "hear-pick") && exercise.wordAudioUrl && (
          <SpeakButton url={exercise.wordAudioUrl} label="Hear it again" large />
        )}
        {/* Reading is tested with nothing to lean on: no sound, and no pronunciation behind a tap. */}
        {exercise.variant === "read" && <SentenceView sentence={exercise.sentence} revealMeaning={false} hints={false} />}
        {exercise.variant === "read-word" && token && (
          <p dir="rtl" lang="fa" className="text-5xl leading-[1.9] text-ink">
            {shown(token)}
          </p>
        )}
        {/* As a native reader meets it: no vowel marks, whatever the learner is usually shown. */}
        {exercise.variant === "pronounce" && token && (
          <p dir="rtl" lang="fa" className="text-5xl leading-[1.9] text-ink">
            {token.fa}
          </p>
        )}
        {exercise.variant === "pick-word" && token && <p className="text-2xl font-semibold text-ink">{token.gloss}</p>}
        {exercise.variant === "cloze" && (
          <>
            <p className="text-base font-medium text-ink">{exercise.sentence.english}</p>
            <SentenceView sentence={exercise.sentence} revealMeaning={false} blankIndex={exercise.tokenIndex} />
          </>
        )}
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        {exercise.options.map((option, i) => {
          const isAnswer = i === exercise.answer;
          const state = !done ? "idle" : isAnswer ? "right" : i === picked ? "wrong" : "muted";
          return (
            <button
              key={i}
              type="button"
              disabled={done}
              onClick={() => pick(i)}
              className={`flex items-center gap-3 rounded-lg border px-4 py-3 text-left transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-turquoise-dark ${
                state === "idle"
                  ? "border-ink/20 bg-sand hover:border-cobalt hover:bg-paper"
                  : state === "right"
                    ? "border-turquoise-dark bg-turquoise/15"
                    : state === "wrong"
                      ? "border-crimson bg-crimson/10"
                      : "border-ink/10 bg-sand opacity-50"
              }`}
            >
              <span className="font-mono text-xs text-ink/35">{i + 1}</span>
              {persianOptions ? (
                <span dir="rtl" lang="fa" className="flex-1 text-2xl leading-[1.8] text-ink">
                  {option}
                </span>
              ) : (
                <span className={`flex-1 text-ink ${exercise.variant === "pronounce" ? "text-lg" : "text-sm"}`}>{option}</span>
              )}
            </button>
          );
        })}
      </div>
    </>
  );
}

function Tiles({
  exercise,
  answered,
  onAnswer,
}: {
  exercise: TilesExercise;
  answered: boolean | null;
  onAnswer: (correct: boolean, built: string[], remark?: string) => void;
}) {
  const [chosen, setChosen] = useState<number[]>([]);
  const done = answered !== null;

  const check = () => {
    const words = chosen.map((i) => exercise.tiles[i].fa);
    const built = normalizeForCompare(words.join(" "));
    const match = exercise.accepted.find((answer) => answer.text === built);
    onAnswer(match !== undefined, words, match?.remark);
  };

  const tileClass =
    "rounded-md border border-ink/30 bg-paper px-3 py-1 text-2xl leading-[1.8] text-ink shadow-[0_2px_0_rgba(42,29,22,0.18)] transition enabled:hover:border-cobalt disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-turquoise-dark";

  return (
    <>
      <Eyebrow>{exercise.variant === "dictation" ? "Build what you hear" : "Build this sentence"}</Eyebrow>
      {exercise.variant === "dictation" ? (
        <div className="flex justify-center">
          <SpeakButton url={exercise.sentence.audioUrl} label="Hear it again" large />
        </div>
      ) : (
        <p className="text-center text-lg font-medium text-ink">{exercise.sentence.english}</p>
      )}

      <div
        dir="rtl"
        lang="fa"
        aria-label="Your sentence"
        className="flex min-h-20 flex-wrap items-center gap-2 rounded-lg border border-ink/15 bg-sand px-3 py-3 shadow-[inset_0_4px_8px_-6px_rgba(42,29,22,0.35)]"
      >
        {chosen.map((tileIndex, position) => (
          <button
            key={tileIndex}
            type="button"
            disabled={done}
            onClick={() => setChosen((c) => c.filter((_, p) => p !== position))}
            className={tileClass}
          >
            {shown(exercise.tiles[tileIndex])}
          </button>
        ))}
      </div>

      <div dir="rtl" lang="fa" className="flex flex-wrap justify-center gap-2">
        {exercise.tiles.map((tile, i) => {
          const used = chosen.includes(i);
          return (
            <button
              key={i}
              type="button"
              disabled={done || used}
              aria-hidden={used}
              onClick={() => setChosen((c) => [...c, i])}
              className={`${tileClass} ${used ? "invisible" : ""}`}
            >
              {shown(tile)}
            </button>
          );
        })}
      </div>

      {!done && (
        <Button variant="secondary" className="self-end" disabled={chosen.length === 0} onClick={check}>
          Check
        </Button>
      )}
    </>
  );
}
