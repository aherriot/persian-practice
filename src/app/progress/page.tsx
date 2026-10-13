import { eq, sql } from "drizzle-orm";
import Link from "next/link";
import type { ReactNode } from "react";
import { requireUser } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { reviewLog } from "@/lib/db/schema";
import { FRONTIER, MAX_SHAKY } from "@/lib/lesson/expand";
import { summariseConfusions } from "@/lib/lesson/confusions";
import { CONFUSION_DAYS, loadActivityHours, loadConfusions } from "@/lib/lesson/history";
import { summariseJourney, type JourneyItem, type Stage } from "@/lib/lesson/journey";
import { isReadyForMore, measureProgress } from "@/lib/lesson/progress";
import { loadCourse, loadKnowledge } from "@/lib/lesson/store";
import { SKILLS, type Lexeme, type Skill } from "@/lib/lesson/types";
import type { Weakness } from "@/lib/lesson/weak";
import { Activity } from "./Activity";

const LIST = 8;
const MIXED_UP = 6;

const STAGES: { stage: Stage; label: string; colour: string; meaning: string }[] = [
  { stage: "shaky", label: "Needs work", colour: "bg-terracotta", meaning: "wrong the last time it came up" },
  { stage: "new", label: "Just met", colour: "bg-gold", meaning: "shown to you, not yet answered right" },
  { stage: "learning", label: "Learning", colour: "bg-turquoise", meaning: "right once or twice running" },
  { stage: "established", label: "Established", colour: "bg-cobalt", meaning: "right three times running" },
];

const EXERCISES: Record<string, string> = {
  listen: "Hearing a sentence",
  "hear-word": "Hearing one word",
  read: "Reading a sentence",
  "read-word": "Reading one word",
  "pick-word": "Finding the word for a meaning",
  cloze: "Filling in the missing word",
  tiles: "Building the sentence",
  // From before reading and listening were told apart: the word was shown and spoken.
  word: "Meaning of one word",
};

const SKILL_LABELS: Record<Skill, { label: string; meaning: string }> = {
  listening: { label: "Listening", meaning: "understood from sound alone" },
  reading: { label: "Reading", meaning: "understood from the page alone" },
  producing: { label: "Producing", meaning: "found or built from a meaning" },
};

const WEAKNESS: Record<Weakness, ReactNode> = {
  missed: <span className="text-terracotta">wrong the last time</span>,
  recovering: "right since, not yet three times running",
  hard: "established again, but still a hard one",
};

const cardClass = "rounded-lg border border-ink/15 bg-sand px-5 py-4 shadow-[inset_0_4px_8px_-6px_rgba(42,29,22,0.35)]";
const headingClass = "text-xs font-semibold uppercase tracking-widest text-ink/50";
const times = (n: number) => (n === 1 ? "once" : n === 2 ? "twice" : `${n} times`);
const things = (n: number) => `${n} thing${n === 1 ? "" : "s"}`;

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-3">
      <h2 className={headingClass}>{title}</h2>
      <div className={cardClass}>{children}</div>
    </section>
  );
}

function Stat({ value, label }: { value: ReactNode; label: string }) {
  return (
    <div className={cardClass}>
      <p className="text-3xl font-bold text-ink">{value}</p>
      <p className="text-xs text-ink/60">{label}</p>
    </div>
  );
}

function Word({ lexeme }: { lexeme: Lexeme }) {
  return (
    <div className="flex flex-col">
      <span dir="rtl" lang="fa" className="self-start text-2xl leading-[1.8] text-ink">
        {lexeme.voc}
      </span>
      <span className="text-sm text-ink">
        <span className="font-semibold">{lexeme.translit}</span>
        <span className="text-ink/65"> — {lexeme.gloss}</span>
      </span>
    </div>
  );
}

function Item({ item, children }: { item: JourneyItem; children: ReactNode }) {
  return (
    <li className="flex items-center justify-between gap-3 border-t border-ink/10 py-2 first:border-t-0 first:pt-0 last:pb-0">
      <div>
        <p className="text-sm font-semibold text-ink">
          {item.label}
          {item.gloss && <span className="font-normal text-ink/65"> — {item.gloss}</span>}
        </p>
        <p className="text-xs text-ink/55">{children}</p>
      </div>
      {item.fa ? (
        <span dir="rtl" lang="fa" className="shrink-0 text-2xl leading-[1.8] text-ink">
          {item.fa}
        </span>
      ) : (
        <span className="shrink-0 rounded-full border border-ink/20 px-2 py-0.5 text-[0.65rem] uppercase tracking-wider text-ink/50">
          Grammar
        </span>
      )}
    </li>
  );
}

export default async function ProgressPage() {
  const user = await requireUser();
  const now = new Date();
  const [content, knowledge, hours, confusionRows, exerciseRows] = await Promise.all([
    loadCourse(user.id),
    loadKnowledge(user.id),
    loadActivityHours(user.id, now),
    loadConfusions(user.id, now),
    db
      .select({ exercise: reviewLog.exercise, total: sql<number>`count(*)::int`, correct: sql<number>`count(*) filter (where ${reviewLog.correct})::int` })
      .from(reviewLog)
      .where(eq(reviewLog.userId, user.id))
      .groupBy(reviewLog.exercise),
  ]);

  const journey = summariseJourney(content, knowledge, now);
  const progress = measureProgress(content.onLadder, knowledge);
  // Once could be a slip of the finger; twice is a mix-up.
  const confusions = summariseConfusions(confusionRows, content.lexemes, knowledge).filter((c) => c.times >= 2);
  const exercises = exerciseRows.filter((row) => row.total > 0).sort((a, b) => a.correct / a.total - b.correct / b.total);
  const answered = exercises.reduce((sum, row) => sum + row.total, 0);
  const met = journey.items.length;
  const shaky = progress.known - progress.secure;

  if (met === 0) {
    return (
      <Frame>
        <p className="text-sm text-ink/70">
          Nothing to show yet. Start a theme from the dashboard, and what you learn will be tracked here.
        </p>
      </Frame>
    );
  }

  return (
    <Frame>
      <div className="grid grid-cols-2 gap-3">
        <Stat value={journey.words} label={`word${journey.words === 1 ? "" : "s"} met`} />
        <Stat value={journey.patterns} label={`grammar point${journey.patterns === 1 ? "" : "s"} met`} />
        <Stat value={journey.stages.established} label={`established, of ${met}`} />
        <Stat value={journey.due.now} label="due for review now" />
      </div>

      <Section title="Where everything stands">
        <div className="flex h-3 overflow-hidden rounded-full bg-ink/10" aria-hidden="true">
          {STAGES.map(({ stage, colour }) => (
            <div key={stage} className={colour} style={{ flexGrow: journey.stages[stage] }} />
          ))}
        </div>
        <ul className="mt-3 flex flex-col gap-1.5">
          {STAGES.map(({ stage, label, colour, meaning }) => (
            <li key={stage} className="flex items-baseline gap-2 text-sm">
              <span className={`inline-block h-2.5 w-2.5 shrink-0 rounded-sm ${colour}`} />
              <span className="w-8 text-right font-semibold text-ink">{journey.stages[stage]}</span>
              <span className="text-ink">{label}</span>
              <span className="text-xs text-ink/55">{meaning}</span>
            </li>
          ))}
        </ul>
        <p className="mt-3 text-xs text-ink/55">
          A word stands where its weakest skill does. Spaced reviews put the third correct answer about a week after
          the first, so “established” grows slowly on purpose.
        </p>
      </Section>

      <Section title="By skill">
        <ul className="flex flex-col gap-3">
          {SKILLS.map((skill) => (
            <li key={skill}>
              <div className="flex items-baseline justify-between gap-3 text-sm">
                <span>
                  <span className="font-semibold text-ink">{SKILL_LABELS[skill].label}</span>{" "}
                  <span className="text-xs text-ink/55">{SKILL_LABELS[skill].meaning}</span>
                </span>
                <span className="shrink-0 text-xs text-ink/60">
                  {journey.skillStages[skill].established} of {met} established
                </span>
              </div>
              <div
                className="mt-1 flex h-2 overflow-hidden rounded-full bg-ink/10"
                role="img"
                aria-label={STAGES.map(({ stage, label }) => `${label}: ${journey.skillStages[skill][stage]}`).join(", ")}
              >
                {STAGES.map(({ stage, colour }) => (
                  <div key={stage} className={colour} style={{ flexGrow: journey.skillStages[skill][stage] }} />
                ))}
              </div>
            </li>
          ))}
        </ul>
        <p className="mt-3 text-xs text-ink/55">
          Hearing a word, reading it and coming up with it are practised and scheduled apart, since being good at one
          says little about the others. A word loses its vowel marks once you have read it right three times running.
        </p>
      </Section>

      <Section title="What you are struggling with">
        {journey.struggling.length === 0 ? (
          <p className="text-sm text-ink/70">
            Nothing at the moment: everything you have got wrong, you have since got right three times running.
          </p>
        ) : (
          <>
            <ul>
              {journey.struggling.slice(0, LIST).map((item) => (
                <Item key={item.key} item={item}>
                  Missed {times(item.lapses)} · {WEAKNESS[item.weakness]}
                </Item>
              ))}
            </ul>
            {journey.struggling.length > LIST && (
              <p className="mt-2 text-xs text-ink/55">And {journey.struggling.length - LIST} more.</p>
            )}
            <div className="mt-3 flex items-center justify-between gap-3">
              <p className="text-xs text-ink/55">A wrong answer counts against the word that exercise was testing.</p>
              <Link href="/practice/weak" className="shrink-0 text-sm font-medium text-cobalt underline">
                Practise these
              </Link>
            </div>
          </>
        )}
      </Section>

      <Section title="What you mix up">
        {confusions.length === 0 ? (
          <p className="text-sm text-ink/70">
            No pattern yet. When you pick the same wrong answer for a word more than once, the pair is shown here.
          </p>
        ) : (
          <>
            <ul>
              {confusions.slice(0, MIXED_UP).map(({ target, picked, times: n }) => (
                <li key={`${target.id} ${picked.id}`} className="flex flex-col gap-1.5 border-t border-ink/10 py-3 first:border-t-0 first:pt-0 last:pb-0">
                  <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-3">
                    <Word lexeme={target} />
                    <span className="text-xs text-ink/45">not</span>
                    <Word lexeme={picked} />
                  </div>
                  <p className="text-xs text-ink/55">
                    Asked about <span className="font-medium text-ink/80">{target.translit}</span>, you chose{" "}
                    <span className="font-medium text-ink/80">{picked.translit}</span> {times(n)}.
                  </p>
                </li>
              ))}
            </ul>
            <p className="mt-3 text-xs text-ink/55">
              From the last {CONFUSION_DAYS} days. Each pair is offered against the other in practice, so you get to
              tell them apart.
            </p>
          </>
        )}
      </Section>

      <Section title="Practice">
        <Activity hours={hours} />
      </Section>

      {exercises.length > 0 && (
        <Section title="By kind of exercise">
          <ul className="flex flex-col gap-2.5">
            {exercises.map((row) => {
              const share = Math.round((row.correct / row.total) * 100);
              return (
                <li key={row.exercise} className="flex flex-col gap-1">
                  <div className="flex items-baseline justify-between gap-3 text-sm">
                    <span className="text-ink">{EXERCISES[row.exercise] ?? row.exercise}</span>
                    <span className="text-xs text-ink/60">
                      {share}% of {row.total}
                    </span>
                  </div>
                  <div className="h-1.5 overflow-hidden rounded-full bg-ink/10" aria-hidden="true">
                    <div className="h-full rounded-full bg-turquoise-dark" style={{ width: `${share}%` }} />
                  </div>
                </li>
              );
            })}
          </ul>
          <p className="mt-3 text-xs text-ink/55">{answered} answers in all, weakest kind first.</p>
        </Section>
      )}

      <Section title="What comes next">
        <ul className="flex flex-col gap-1.5 text-sm text-ink/80">
          <li>
            <span className="font-semibold text-ink">{journey.due.now}</span> due for review now,{" "}
            <span className="font-semibold text-ink">{journey.due.day}</span> by this time tomorrow,{" "}
            <span className="font-semibold text-ink">{journey.due.week}</span> within a week.
          </li>
          <li>
            {progress.remaining >= FRONTIER ? (
              <>
                <span className="font-semibold text-ink">{progress.remaining}</span> new words and grammar points are
                written and waiting in your lessons.
              </>
            ) : isReadyForMore(progress, MAX_SHAKY) ? (
              <>
                {progress.remaining === 0 ? "You have met everything written so far" : `Only ${things(progress.remaining)} left to meet`}
                . More is being written for you as you practise.
              </>
            ) : (
              <>
                New material is on hold: {things(shaky)} you have met {shaky === 1 ? "is" : "are"} not answered right
                yet. It resumes when that is down to {MAX_SHAKY}.
              </>
            )}
          </li>
        </ul>
      </Section>

      {journey.strongest.length > 0 && (
        <Section title="What you know best">
          <ul>
            {journey.strongest.slice(0, 5).map((item) => (
              <Item key={item.key} item={item}>
                Reviewed every {Math.round(item.intervalDays)} days now
              </Item>
            ))}
          </ul>
        </Section>
      )}
    </Frame>
  );
}

function Frame({ children }: { children: ReactNode }) {
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-xl flex-col gap-6 bg-paper px-5 py-8">
      <header className="flex items-baseline justify-between gap-4">
        <h1 className="font-[family-name:var(--font-display-latin)] text-2xl font-bold text-ink">Your progress</h1>
        <Link href="/dashboard" className="text-sm text-ink/50 underline">
          Back
        </Link>
      </header>
      {children}
    </main>
  );
}
