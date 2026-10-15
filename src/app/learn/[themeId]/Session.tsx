"use client";

import Link from "next/link";
import { useCallback, useEffect, useState, useSyncExternalStore, type ReactNode } from "react";
import { Button } from "@/components/Button";
import { Correct } from "@/components/Correct";
import { OrsiWindow } from "@/components/OrsiWindow";
import { playAudio, preloadAudio, unlockAudio } from "@/lib/audio-client";
import { lessonOutbox, type OutboxStatus } from "@/lib/lesson/outbox";
import { changeFrom, describeChange, type Change } from "@/lib/lesson/mastery";
import {
  EXERCISE_SKILL,
  exerciseName,
  targetKey,
  type ChoiceExercise,
  type Exercise,
  type ExerciseSubject,
  type SessionPlan,
  type Skill,
  type SkillState,
  type TilesExercise,
} from "@/lib/lesson/types";
import { normalizeForCompare } from "@/lib/normalize";
import { SentenceView, SpeakButton, shown } from "./Persian";
import { MasteryLine, Meters } from "./Mastery";
import { NewHeader, TaskHeader } from "./Task";

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
  if (exercise.variant === "listen" || exercise.variant === "reply-heard") return exercise.sentence.audioUrl;
  if (exercise.variant === "hear-word" || exercise.variant === "hear-pick") return exercise.wordAudioUrl ?? null;
  return null;
}

/** This session's answers so far to the skills of one thing, by `${targetKey}|${skill}`. */
function currentSkills(states: Map<string, SkillState>, key: string): Partial<Record<Skill, SkillState>> {
  return Object.fromEntries([...states].filter(([k]) => k.startsWith(`${key}|`)).map(([k, state]) => [k.slice(key.length + 1), state]));
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
  if (plan.reviewCount > 0) return `You will ${review}.${plan.newHeldBack ? " New words wait until you have caught up." : ""}`;
  return "Nothing is due for review, so this is a short practice round with sentences you already know.";
}

/** A session is planned whole before it starts, so a fix made part-way does not show in it. */
const FIXED_LATER = "You will see it from your next session.";

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
  // Each answer's effect on the skill it tested, worked out here as the server
  // will, so it shows at once and later exercises start from it.
  const [skillStates, setSkillStates] = useState<Map<string, SkillState>>(new Map());
  const [change, setChange] = useState<{ skill: Skill; change: Change; summary: string } | null>(null);
  // What got better this session, for the end.
  const [improved, setImproved] = useState<Map<string, ExerciseSubject>>(new Map());
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
      setChange(null);
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
      if (!isRetry && exercise.primary && exercise.subject) {
        const skill = EXERCISE_SKILL[exerciseName(exercise)];
        const key = targetKey(exercise.primary);
        const skills = { ...exercise.subject.skills, ...currentSkills(skillStates, key) };
        const now = new Date();
        const result = changeFrom(skills[skill], exercise.primary, correct, now);
        const after = { ...skills, [skill]: result.after };
        setSkillStates((states) => new Map(states).set(`${key}|${skill}`, result.after));
        setChange({ skill, change: result, summary: describeChange(skill, result, now) });
        // Kept up to date once it has gone up, so the end shows where it finished.
        if (result.to > result.from || improved.has(key)) setImproved((words) => new Map(words).set(key, { ...exercise.subject!, skills: after }));
      }
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
      if (!(correct && (exercise.variant === "listen" || exercise.variant === "dictation" || exercise.variant === "reply-heard"))) {
        void playAudio(exercise.sentence.audioUrl);
      }
    },
    [exercise, save, skillStates, improved],
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
          {improved.size > 0 && (
            <div className="flex w-full max-w-xs flex-col gap-2 text-left">
              <p className="text-xs font-semibold uppercase tracking-widest text-ink/50">Getting stronger</p>
              {[...improved.values()].slice(0, 8).map((subject) => (
                <div key={`${subject.fa}${subject.label}`} className="flex items-center justify-between gap-3 border-b border-ink/10 pb-1.5">
                  <p className="min-w-0 truncate text-sm text-ink">
                    {subject.fa && (
                      <span dir="rtl" lang="fa" className="mr-2 text-base">
                        {subject.fa}
                      </span>
                    )}
                    {subject.label}
                  </p>
                  <Meters skills={subject.skills} />
                </div>
              ))}
            </div>
          )}
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
      <div key={exercise.key} className="flex flex-1 flex-col gap-4 sm:gap-6">
        {exercise.type === "intro-lexeme" && (
          <>
            <NewHeader exercise={exercise} />
            <div className="flex flex-col items-center gap-2 rounded-lg border border-ink/15 bg-sand px-5 py-5 text-center sm:gap-3 sm:px-6 sm:py-8 shadow-[inset_0_4px_8px_-6px_rgba(42,29,22,0.35)]">
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
              <Correct subject={{ kind: "lexeme", id: exercise.lexeme.id }} own={exercise.lexeme.ownerId !== null} after={FIXED_LATER} />
            </div>
            <Example exercise={exercise} />
          </>
        )}

        {exercise.type === "intro-pattern" && (
          <>
            <NewHeader exercise={exercise} />
            <div className="rounded-lg border border-ink/15 bg-sand px-6 py-6 shadow-[inset_0_4px_8px_-6px_rgba(42,29,22,0.35)]">
              <h2 className="text-xl font-semibold text-ink">{exercise.pattern.title}</h2>
              <p className="mt-2 text-sm leading-relaxed text-ink/75">{exercise.pattern.summary}</p>
            </div>
            <Example exercise={exercise} />
          </>
        )}

        {exercise.type === "choice" && <Choice exercise={exercise} answered={answered} onAnswer={grade} />}
        {exercise.type === "tiles" && <Tiles exercise={exercise} answered={answered} onAnswer={grade} />}

        <div className="mt-auto flex flex-col gap-3">
          {answered !== null && (exercise.type === "choice" || exercise.type === "tiles") && (
            <div
              role="status"
              className={`rounded-lg border px-3 py-2.5 sm:px-4 sm:py-3 ${
                answered ? "border-turquoise-dark/40 bg-turquoise/10" : "border-crimson/40 bg-crimson/10"
              }`}
            >
              <p className={`text-sm font-semibold ${answered ? "text-turquoise-dark" : "text-crimson"}`}>
                {answered ? "Correct" : "Not quite"}
              </p>
              {remark && <p className="mt-1 text-sm text-ink/75">{remark}</p>}
              {change && exercise.subject && (
                <div className="mt-1.5">
                  <MasteryLine
                    subject={exercise.subject}
                    skills={{ ...exercise.subject.skills, ...currentSkills(skillStates, targetKey(exercise.primary!)) }}
                    tested={change.skill}
                    was={change.change.from}
                    summary={change.summary}
                  />
                </div>
              )}
              <div className="mt-1 flex items-start justify-between gap-3">
                <div>
                  <SentenceView sentence={exercise.sentence} revealMeaning className="text-2xl" />
                  <p className="text-sm text-ink/70">{exercise.sentence.translit}</p>
                  <p className="text-sm font-medium text-ink">{exercise.sentence.english}</p>
                  {exercise.sentence.note && <p className="mt-1 text-xs text-ink/60">{exercise.sentence.note}</p>}
                </div>
                <SpeakButton url={exercise.sentence.audioUrl} label="Hear the sentence" />
              </div>
              {exercise.type === "choice" && exercise.reply && (
                <div className="mt-3 flex items-start justify-between gap-3 border-t border-ink/10 pt-3">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-widest text-ink/50">A natural reply</p>
                    <SentenceView sentence={exercise.reply} revealMeaning className="text-2xl" />
                    <p className="text-sm text-ink/70">{exercise.reply.translit}</p>
                    <p className="text-sm font-medium text-ink">{exercise.reply.english}</p>
                  </div>
                  <SpeakButton url={exercise.reply.audioUrl} label="Hear the reply" />
                </div>
              )}
              <div className="mt-2 flex flex-wrap items-start gap-x-4 gap-y-1">
                <Correct subject={{ kind: "sentence", id: exercise.sentence.id }} own={exercise.sentence.generated} after={FIXED_LATER} />
                {exercise.sentence.generated && <ReportSentence key={exercise.key} sentenceId={exercise.sentence.id} />}
              </div>
            </div>
          )}
          {canContinue && (
            // Pinned to the bottom of the screen, so a long answer never pushes it out of reach.
            <Button autoFocus className="sticky bottom-3 self-end shadow-md" onClick={answered !== null ? advance : acknowledge}>
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
  if (reported) return <p className="text-xs text-ink/60">Thanks. That sentence will not be shown again.</p>;
  return (
    <button
      type="button"
      className="text-xs text-ink/50 underline hover:text-ink"
      onClick={() => {
        setReported(true);
        void fetch("/api/lesson/report", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sentenceId }),
        }).catch(() => {});
      }}
    >
      Written by the app: remove it
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
    <main className="mx-auto flex min-h-dvh w-full max-w-xl flex-col gap-4 bg-paper px-4 py-4 sm:gap-6 sm:px-5 sm:py-6">
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
    <div className="flex flex-col gap-2">
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
      <Correct subject={{ kind: "sentence", id: exercise.sentence.id }} own={exercise.sentence.generated} after={FIXED_LATER} />
    </div>
  );
}

/** Options up to this many characters are laid out two to a row. */
const SHORT_OPTION = 14;

/** Exercises answered by picking Persian rather than English. */
const PERSIAN_OPTIONS: ReadonlySet<ChoiceExercise["variant"]> = new Set(["hear-pick", "pick-word", "cloze", "transform", "reply-heard", "reply-read"]);

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
  const isReply = exercise.variant === "reply-heard" || exercise.variant === "reply-read";
  // Single words and short phrases fit two to a row, even on a phone.
  const short = exercise.options.every((option) => option.length <= SHORT_OPTION);

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
      <TaskHeader exercise={exercise} />

      {isReply ? (
        <TheySay>
          {exercise.variant === "reply-heard" ? (
            <SpeakButton url={exercise.sentence.audioUrl} label="Hear it again" />
          ) : (
            <SentenceView sentence={exercise.sentence} revealMeaning={false} hints={false} className="text-2xl" />
          )}
        </TheySay>
      ) : (
        <div className="flex min-h-20 flex-col items-center justify-center gap-2 text-center sm:min-h-28 sm:gap-3">
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
          {exercise.variant === "transform" && exercise.base && (
            <>
              <p className="text-base font-medium text-ink">{exercise.sentence.english}</p>
              <p dir="rtl" lang="fa" className="rounded-md border border-ink/20 bg-sand px-3 py-1 text-2xl leading-[1.8] text-ink">
                {shown(exercise.base)}
              </p>
              <SentenceView sentence={exercise.sentence} revealMeaning={false} blankIndex={exercise.tokenIndex} />
            </>
          )}
          {exercise.variant === "cloze" && (
            <>
              <p className="text-base font-medium text-ink">{exercise.sentence.english}</p>
              <SentenceView sentence={exercise.sentence} revealMeaning={false} blankIndex={exercise.tokenIndex} />
            </>
          )}
        </div>
      )}

      {isReply && <p className="-mb-2 text-right text-xs font-semibold uppercase tracking-widest text-ink/50">You say</p>}
      {/* Replies are whole sentences: one to a line, like the next turn in a conversation. */}
      <div className={`grid gap-2 sm:gap-3 ${isReply ? "justify-items-end" : short ? "grid-cols-2" : "sm:grid-cols-2"}`}>
        {exercise.options.map((option, i) => {
          const isAnswer = i === exercise.answer;
          const state = !done ? "idle" : isAnswer ? "right" : i === picked ? "wrong" : "muted";
          // Once answered, only what was picked and what was right stay, to leave room for the answer.
          if (state === "muted") return null;
          return (
            <button
              key={i}
              type="button"
              disabled={done}
              onClick={() => pick(i)}
              className={`flex items-center gap-3 border px-3 py-2 sm:px-4 sm:py-3 ${isReply ? "w-full max-w-[85%] rounded-2xl rounded-br-sm" : "rounded-lg"} text-left transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-turquoise-dark ${
                state === "idle"
                  ? "border-ink/20 bg-sand hover:border-cobalt hover:bg-paper"
                  : state === "right"
                    ? "border-turquoise-dark bg-turquoise/15"
                    : "border-crimson bg-crimson/10"
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
      <TaskHeader exercise={exercise} />
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
        className="flex min-h-16 flex-wrap items-center gap-2 rounded-lg border border-ink/15 bg-sand px-3 py-3 shadow-[inset_0_4px_8px_-6px_rgba(42,29,22,0.35)]"
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

/** What was said to the learner, in a speech bubble, so it does not look like something to translate. */
function TheySay({ children }: { children: ReactNode }) {
  return (
    <div className="flex flex-col items-start gap-1">
      <p className="text-xs font-semibold uppercase tracking-widest text-ink/50">They say</p>
      <div className="flex min-h-16 max-w-[85%] items-center rounded-2xl rounded-bl-sm border border-cobalt/30 bg-cobalt/5 px-4 py-2">{children}</div>
    </div>
  );
}
