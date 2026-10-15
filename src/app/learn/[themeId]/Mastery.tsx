import { LEVELS, masteryOf, overallMastery, SKILL_NAME, type Level } from "@/lib/lesson/mastery";
import { SKILLS, type ExerciseSubject, type Skill, type SkillState } from "@/lib/lesson/types";

/**
 * How well the learner knows the word or grammar point an exercise was about,
 * shown with the answer: a meter for each skill, four steps to mastered
 * (src/lib/lesson/mastery.ts), with the step the answer gained or lost marked.
 * The colours and the sound bars and ب are the ones on the exercise badges
 * (Task.tsx); recalling, coming up with the Persian, is a reed pen.
 */

const COLOUR: Record<Skill, string> = {
  listening: "bg-turquoise-dark",
  reading: "bg-cobalt",
  producing: "bg-terracotta",
};

function SkillIcon({ skill }: { skill: Skill }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="h-3 w-3 shrink-0 text-ink/55" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round">
      {skill === "listening" && <path d="M6 10v4M12 5v14M18 8.5v7" />}
      {skill === "reading" && (
        <>
          <path d="M3 8c0 4.5 3.5 6.5 9 6.5S21 12.5 21 8" />
          <circle cx={12} cy={20} r={1.8} fill="currentColor" stroke="none" />
        </>
      )}
      {skill === "producing" && <path d="M4 20l2-5L16.5 4.5l3 3L9 18zM14 7l3 3" />}
    </svg>
  );
}

/** One skill: four steps, filled to its level. The step this answer changed is ringed in gold, or shown emptied in crimson. */
function Meter({ skill, level, was }: { skill: Skill; level: Level; was?: Level }) {
  return (
    <div className="flex items-center gap-1" title={`${SKILL_NAME[skill]}: ${LEVELS[level]}`}>
      <SkillIcon skill={skill} />
      {[1, 2, 3, 4].map((step) => {
        const filled = step <= level;
        const gained = was !== undefined && filled && step > was;
        const lost = was !== undefined && !filled && step <= was;
        return (
          <span
            key={step}
            className={`h-1.5 w-2.5 rounded-full ${filled ? COLOUR[skill] : lost ? "bg-crimson/45" : "bg-ink/15"} ${gained ? "ring-2 ring-gold ring-offset-1 ring-offset-paper" : ""}`}
          />
        );
      })}
    </div>
  );
}

export function Meters({ skills, tested, was }: { skills: Record<Skill, SkillState>; tested?: Skill; was?: Level }) {
  return (
    <div className="flex shrink-0 flex-col gap-1" aria-hidden="true">
      {SKILLS.map((skill) => (
        <Meter key={skill} skill={skill} level={masteryOf(skills[skill])} was={skill === tested ? was : undefined} />
      ))}
    </div>
  );
}

/** The word or grammar point, how well it is known overall, and what this answer did. */
export function MasteryLine({
  subject,
  skills,
  tested,
  was,
  summary,
}: {
  subject: ExerciseSubject;
  skills: Record<Skill, SkillState>;
  tested: Skill;
  was: Level;
  summary: string;
}) {
  const overall = overallMastery(skills);
  return (
    <div className="flex items-center gap-3 rounded-md bg-paper/70 px-2.5 py-1.5">
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm text-ink">
          {subject.fa && (
            <span dir="rtl" lang="fa" className="mr-2 text-base">
              {subject.fa}
            </span>
          )}
          <span className="font-medium">{subject.label}</span>
          <span className="text-ink/55"> · {LEVELS[overall]}</span>
        </p>
        <p className="text-xs leading-snug text-ink/65">{summary}</p>
      </div>
      <Meters skills={skills} tested={tested} was={was} />
    </div>
  );
}
