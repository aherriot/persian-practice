import { VOWEL_FADE_REPS } from "./plan";
import { SKILLS, type KnowledgeState, type Skill, type SkillState, type ThemeContent } from "./types";
import { byWeakness, overallWeakness, type Weakness } from "./weak";

/**
 * Where one skill of a word or grammar point stands for a learner.
 *   new          met, but not answered right yet
 *   shaky        answered wrong the last time it came up
 *   learning     answered right once or twice running
 *   established  right three times running — the point where its vowel marks fade
 */
export type Stage = "new" | "shaky" | "learning" | "established";

export function stageOf(state: Pick<SkillState, "repetitions" | "lapses">): Stage {
  if (state.repetitions >= VOWEL_FADE_REPS) return "established";
  if (state.repetitions >= 1) return "learning";
  return state.lapses > 0 ? "shaky" : "new";
}

const LEAST_ADVANCED: Stage[] = ["shaky", "new", "learning", "established"];

/** Where the thing as a whole stands: no further on than the skill that is furthest behind. */
export function overallStage(state: KnowledgeState): Stage {
  const stages = SKILLS.map((skill) => stageOf(state.skills[skill]));
  return LEAST_ADVANCED.find((stage) => stages.includes(stage))!;
}

export type JourneyItem = {
  key: string;
  kind: "lexeme" | "pattern";
  /** The word in Persian, or null for a grammar point. */
  fa: string | null;
  /** Transliteration for a word; the title for a grammar point. */
  label: string;
  /** What a word means; null for a grammar point. */
  gloss: string | null;
  stage: Stage;
  /** The same for each skill on its own. */
  skills: Record<Skill, Stage>;
  /** Why it counts as weak, if it does (see weak.ts). */
  weakness: Weakness | null;
  /** How many times it has been answered wrong. */
  lapses: number;
  difficulty: number;
  intervalDays: number;
  dueAt: Date;
};

export type Journey = {
  items: JourneyItem[];
  words: number;
  patterns: number;
  stages: Record<Stage, number>;
  /** The same count for each skill on its own. */
  skillStages: Record<Skill, Record<Stage, number>>;
  /** Everything weak (see weak.ts), the weakest first. */
  struggling: (JourneyItem & { weakness: Weakness })[];
  /** Established, longest gap between reviews first. */
  strongest: JourneyItem[];
  /** Reviews falling due: already, within a day, and within a week (each includes the one before). */
  due: { now: number; day: number; week: number };
};

const DAY_MS = 24 * 60 * 60 * 1000;

/** Everything the learner has met, summarised. Knowledge of things no longer in the course is ignored. */
export function summariseJourney(content: Pick<ThemeContent, "lexemes" | "patterns">, knowledge: Map<string, KnowledgeState>, now: Date): Journey {
  const items: JourneyItem[] = [];
  for (const [key, state] of knowledge) {
    const kind = key.startsWith("lexeme:") ? "lexeme" : "pattern";
    const id = key.slice(key.indexOf(":") + 1);
    const lexeme = kind === "lexeme" ? content.lexemes.get(id) : undefined;
    const pattern = kind === "pattern" ? content.patterns.get(id) : undefined;
    if (!lexeme && !pattern) continue;
    items.push({
      key,
      kind,
      fa: lexeme?.voc ?? null,
      label: lexeme?.translit ?? pattern!.title,
      gloss: lexeme?.gloss ?? null,
      stage: overallStage(state),
      skills: Object.fromEntries(SKILLS.map((skill) => [skill, stageOf(state.skills[skill])])) as Record<Skill, Stage>,
      weakness: overallWeakness(state),
      lapses: state.lapses,
      difficulty: state.difficulty,
      intervalDays: state.intervalDays,
      dueAt: state.dueAt,
    });
  }

  const stages: Record<Stage, number> = { new: 0, shaky: 0, learning: 0, established: 0 };
  const skillStages = Object.fromEntries(SKILLS.map((skill) => [skill, { new: 0, shaky: 0, learning: 0, established: 0 }])) as Record<
    Skill,
    Record<Stage, number>
  >;
  for (const item of items) {
    stages[item.stage]++;
    for (const skill of SKILLS) skillStages[skill][item.skills[skill]]++;
  }
  const dueWithin = (ms: number) => items.filter((item) => item.dueAt.getTime() <= now.getTime() + ms).length;

  return {
    items,
    words: items.filter((item) => item.kind === "lexeme").length,
    patterns: items.filter((item) => item.kind === "pattern").length,
    stages,
    skillStages,
    struggling: items.filter((item): item is JourneyItem & { weakness: Weakness } => item.weakness !== null).sort(byWeakness),
    strongest: items
      .filter((item) => item.stage === "established")
      .sort((a, b) => b.intervalDays - a.intervalDays || a.lapses - b.lapses),
    due: { now: dueWithin(0), day: dueWithin(DAY_MS), week: dueWithin(7 * DAY_MS) },
  };
}
