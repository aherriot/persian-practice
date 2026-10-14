import type { ReactNode } from "react";
import { EXERCISE_SKILL, exerciseName, type ChoiceExercise, type Exercise, type ExerciseName, type Skill, type TilesExercise } from "@/lib/lesson/types";

/**
 * What an exercise asks for, said three ways at the top of it: a badge, a
 * title, and what the learner is given and what they answer with. The two
 * that are easiest to mix up, "what does this mean?" and "what would you say
 * back?", look nothing alike.
 *
 * The badge is a khatam, the eight-pointed star of girih tilework, in the
 * colour of the skill the exercise tests: turquoise for listening, cobalt for
 * reading, terracotta for coming up with the Persian. The glyph inside reads
 * left to right as what is given and what is answered: sound bars, the letter
 * ب for written Persian, A for English.
 */

type Glyph = "sound-english" | "persian-english" | "sound-persian" | "persian-sound" | "english-persian" | "reply" | "gap" | "change" | "build" | "new";

type Given = "sound" | "persian" | "english";

type Task = {
  title: string;
  glyph: Glyph;
  given: Given;
  answer: string;
  hint?: string;
};

const GIVEN: Record<Given, string> = {
  sound: "You hear Persian",
  persian: "You read Persian",
  english: "You see English",
};

const REPLY_HINT = "This is not a translation. Choose what you would say back.";

const TASKS: Record<ExerciseName, Task> = {
  listen: {
    title: "What does it mean?",
    glyph: "sound-english",
    given: "sound",
    answer: "Pick the English",
  },
  "hear-word": {
    title: "What does this word mean?",
    glyph: "sound-english",
    given: "sound",
    answer: "Pick the English",
  },
  "hear-pick": {
    title: "Which word did you hear?",
    glyph: "sound-persian",
    given: "sound",
    answer: "Pick the word",
  },
  dictation: {
    title: "Build what you hear",
    glyph: "build",
    given: "sound",
    answer: "Build it in Persian",
  },
  "reply-heard": {
    title: "Reply to them",
    glyph: "reply",
    given: "sound",
    answer: "Answer in Persian",
    hint: REPLY_HINT,
  },
  read: {
    title: "What does it mean?",
    glyph: "persian-english",
    given: "persian",
    answer: "Pick the English",
  },
  "read-word": {
    title: "What does this word mean?",
    glyph: "persian-english",
    given: "persian",
    answer: "Pick the English",
  },
  pronounce: {
    title: "How is this word said?",
    glyph: "persian-sound",
    given: "persian",
    answer: "Pick how it sounds",
    hint: "It is written without vowel marks, the way Persian is usually printed.",
  },
  "reply-read": {
    title: "Reply to them",
    glyph: "reply",
    given: "persian",
    answer: "Answer in Persian",
    hint: REPLY_HINT,
  },
  "pick-word": {
    title: "Which word means this?",
    glyph: "english-persian",
    given: "english",
    answer: "Pick the Persian",
  },
  cloze: {
    title: "Which word is missing?",
    glyph: "gap",
    given: "english",
    answer: "Fill the gap in Persian",
  },
  transform: {
    title: "Change the word to fit",
    glyph: "change",
    given: "english",
    answer: "Pick the changed word",
    hint: "The sentence should mean the English above it.",
  },
  tiles: {
    title: "Say this in Persian",
    glyph: "build",
    given: "english",
    answer: "Build it in Persian",
  },
};

const SKILL_FILL: Record<Skill, string> = {
  listening: "var(--color-turquoise-dark)",
  reading: "var(--color-cobalt)",
  producing: "var(--color-terracotta)",
};

/** Points of an eight-pointed star of two overlapping squares, centred in a 48-unit box. */
function khatam(outer: number): string {
  const inner = (outer * Math.SQRT1_2) / Math.cos(Math.PI / 8);
  return Array.from({ length: 16 }, (_, i) => {
    const r = i % 2 === 0 ? outer : inner;
    const a = (i * Math.PI) / 8 - Math.PI / 2 + Math.PI / 8;
    return `${(24 + r * Math.cos(a)).toFixed(2)},${(24 + r * Math.sin(a)).toFixed(2)}`;
  }).join(" ");
}
const OUTER = khatam(23);
const INLAY = khatam(20);

// The pieces glyphs are made of, on a 24-unit grid. `x` is the left edge.
const Be = ({ x, w = 10 }: { x: number; w?: number }) => (
  <>
    <path d={`M${x} 9.5c0 3.2 ${w * 0.22} 4.6 ${w / 2} 4.6s${w / 2}-1.4 ${w / 2}-4.6`} />
    <circle cx={x + w / 2} cy={18.2} r={1.3} fill="currentColor" stroke="none" />
  </>
);
const Latin = ({ x }: { x: number }) => <path d={`M${x} 18l3.5-11 3.5 11M${x + 1.3} 14.2h4.4`} />;
const Bars = ({ x }: { x: number }) => <path d={`M${x} 10v4M${x + 3} 7v10M${x + 6} 9.5v5`} />;

const GLYPHS: Record<Glyph, ReactNode> = {
  "sound-english": (
    <>
      <Bars x={3} />
      <Latin x={14} />
    </>
  ),
  "persian-english": (
    <>
      <Be x={2} />
      <Latin x={15} />
    </>
  ),
  "sound-persian": (
    <>
      <Bars x={2.5} />
      <Be x={11.5} />
    </>
  ),
  "persian-sound": (
    <>
      <Be x={2} />
      <Bars x={15.5} />
    </>
  ),
  "english-persian": (
    <>
      <Latin x={2} />
      <Be x={12} />
    </>
  ),
  // Their words, then yours.
  reply: (
    <>
      <path d="M3.5 3.5h10a1.5 1.5 0 0 1 1.5 1.5v5a1.5 1.5 0 0 1-1.5 1.5H8l-3 2.5v-2.5H3.5A1.5 1.5 0 0 1 2 10V5a1.5 1.5 0 0 1 1.5-1.5z" />
      <path
        d="M10.5 12.5h10A1.5 1.5 0 0 1 22 14v4.5a1.5 1.5 0 0 1-1.5 1.5H19v2.5L16 20h-5.5A1.5 1.5 0 0 1 9 18.5V14a1.5 1.5 0 0 1 1.5-1.5z"
        fill="currentColor"
        fillOpacity={0.35}
      />
    </>
  ),
  gap: (
    <>
      <rect x={1.5} y={11} width={6} height={5.5} rx={1} />
      <path d="M9.8 16.5h4.4" />
      <rect x={16.5} y={11} width={6} height={5.5} rx={1} />
      <path d="M10.5 5.3a1.6 1.6 0 1 1 2.3 1.5c-.5.2-.8.6-.8 1.1" />
      <circle cx={12} cy={11} r={0.9} fill="currentColor" stroke="none" />
    </>
  ),
  change: (
    <>
      <path d="M5 11.5c0 4 3 5.6 7 5.6s7-1.6 7-5.6" />
      <circle cx={12} cy={21} r={1.3} fill="currentColor" stroke="none" />
      <path d="M7 6.5a6.5 6.5 0 0 1 10 0M17.6 3.4l-.4 3.4-3.3-.6" />
    </>
  ),
  // Bricks, laid one course at a time.
  build: (
    <>
      <rect x={2} y={5} width={9} height={5.5} rx={0.8} />
      <rect x={13} y={5} width={9} height={5.5} rx={0.8} />
      <rect x={7} y={13.5} width={10} height={5.5} rx={0.8} fill="currentColor" fillOpacity={0.35} />
    </>
  ),
  new: (
    <>
      <path d="M12 2.5l2.6 3.4 4.1-.6-.6 4.1 3.4 2.6-3.4 2.6.6 4.1-4.1-.6L12 21.5l-2.6-3.4-4.1.6.6-4.1L2.5 12l3.4-2.6-.6-4.1 4.1.6z" />
      <circle cx={12} cy={12} r={2.2} fill="currentColor" stroke="none" />
    </>
  ),
};

function Badge({ glyph, fill, ink }: { glyph: Glyph; fill: string; ink: string }) {
  return (
    <svg viewBox="0 0 48 48" aria-hidden="true" className="h-12 w-12 shrink-0">
      <polygon points={OUTER} fill={fill} />
      <polygon points={INLAY} fill="none" stroke="var(--color-gold)" strokeOpacity={0.85} strokeWidth={1} />
      <g transform="translate(12 12)" fill="none" stroke={ink} color={ink} strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round">
        {GLYPHS[glyph]}
      </g>
    </svg>
  );
}

function Header({ badge, title, children }: { badge: ReactNode; title: string; children?: ReactNode }) {
  return (
    <div className="flex items-start gap-3">
      {badge}
      <div className="flex min-w-0 flex-col gap-1">
        <h2 className="font-[family-name:var(--font-display-latin)] text-lg font-bold leading-tight text-ink">{title}</h2>
        {children}
      </div>
    </div>
  );
}

const Arrow = () => (
  <svg viewBox="0 0 16 10" aria-hidden="true" className="h-2.5 w-4 shrink-0 text-ink/40">
    <path d="M1 5h13M10 1l4 4-4 4" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

const chip = "whitespace-nowrap rounded-full border border-ink/15 bg-sand px-2.5 py-0.5 text-xs text-ink/75";

/** The heading of a graded exercise: what it is, and what goes in and comes out. */
export function TaskHeader({ exercise }: { exercise: ChoiceExercise | TilesExercise }) {
  const name = exerciseName(exercise);
  const task = TASKS[name];
  return (
    <Header
      badge={<Badge glyph={task.glyph} fill={SKILL_FILL[EXERCISE_SKILL[name]]} ink="var(--color-paper)" />}
      title={exercise.type === "choice" && exercise.instruction ? exercise.instruction : task.title}
    >
      <p className="flex flex-wrap items-center gap-1.5" aria-label={`${GIVEN[task.given]}. ${task.answer}.`}>
        <span className={chip}>{GIVEN[task.given]}</span>
        <span className="flex items-center gap-1.5">
          <Arrow />
          <span className={chip}>{task.answer}</span>
        </span>
      </p>
      {task.hint && <p className="text-xs leading-relaxed text-ink/60">{task.hint}</p>}
    </Header>
  );
}

/** The heading of something new to look at, which asks for no answer. */
export function NewHeader({ exercise }: { exercise: Extract<Exercise, { type: "intro-lexeme" | "intro-pattern" }> }) {
  return (
    <Header badge={<Badge glyph="new" fill="var(--color-gold)" ink="var(--color-ink)" />} title={exercise.type === "intro-lexeme" ? "New word" : "New grammar"}>
      <p className="text-xs text-ink/60">Nothing to answer. Look, listen, then carry on.</p>
    </Header>
  );
}
