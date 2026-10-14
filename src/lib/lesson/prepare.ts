import type { Job } from "@/lib/jobs/queue";
import type { Candidate, Draft } from "./drafts";
import type { TopUpOptions } from "./generate";

/**
 * Getting content ready for a learner, as a job done one small step at a time
 * (src/lib/jobs/queue.ts). Two kinds of job:
 *
 * - "session", queued when a session page loads: new words and grammar if the
 *   learner is running out ("expand"), then fresh sentences to practise what
 *   they know ("sentences").
 * - "word", queued when a learner adds a word of their own: its audio
 *   ("clip"), then lessons that use it at the learner's level, with any word
 *   it needs brought in on the ladder ("sentences"; word-lessons.ts).
 *
 * Writing sentences is the same three moves in every phase: the author drafts
 * a batch, a reviewer thins it, and then each survivor is given audio and
 * stored, one per step. The batch waits in the job's state in between, so a
 * worker cut off while making one sentence's audio loses that attempt and
 * nothing else — the drafted and reviewed sentences are still there.
 */

type Phase = "clip" | "expand" | "sentences";

/** A batch on its way through: drafted, then reviewed, then stored one at a time. */
type Batch = { candidates: Candidate[]; reviewed: boolean };

export type PrepareState = { phase: Phase; batch: Batch | null };

/** The slow work itself. The real ones are in background.ts; tests supply their own. */
export type Stages = {
  draftFrontier(userId: string): Promise<Draft>;
  storeFrontier(userId: string, candidate: Candidate): Promise<unknown>;
  draftPractice(userId: string, opts: TopUpOptions): Promise<Draft>;
  storePractice(userId: string, candidate: Candidate): Promise<unknown>;
  review(candidates: Candidate[]): Promise<{ kept: Candidate[] }>;
  makeWordClip(userId: string, lexemeId: string): Promise<unknown>;
  draftLessons(userId: string, lexemeId: string): Promise<Draft>;
  storeLesson(userId: string, candidate: Candidate): Promise<unknown>;
};

type Progress = Pick<Job, "kind" | "state">;

const stateOf = (job: Progress): PrepareState =>
  (job.state as PrepareState | null) ?? { phase: job.kind === "word" ? "clip" : "expand", batch: null };
/** The state that starts the phase after this one, or null after the last. */
const after = (phase: Phase): PrepareState | null => (phase === "sentences" ? null : { phase: "sentences", batch: null });

/** A model writes or reviews a whole batch in the job's next step, which can take minutes. */
export function isSlow(job: Progress): boolean {
  const { phase, batch } = stateOf(job);
  return phase !== "clip" && !batch?.reviewed;
}

/** Does the job's next step and returns the state to save, or null when there is nothing left to do. */
export async function prepareStep(job: Job, stages: Stages): Promise<PrepareState | null> {
  const { phase, batch } = stateOf(job);
  const lexemeId = typeof job.payload.lexemeId === "string" ? job.payload.lexemeId : null;

  if (phase === "clip") {
    if (lexemeId) await stages.makeWordClip(job.userId, lexemeId);
    return after(phase);
  }

  if (!batch) {
    const draft =
      phase === "expand"
        ? await stages.draftFrontier(job.userId)
        : lexemeId
          ? await stages.draftLessons(job.userId, lexemeId)
          : await stages.draftPractice(job.userId, {});
    return draft.candidates.length > 0 ? { phase, batch: { candidates: draft.candidates, reviewed: false } } : after(phase);
  }

  if (!batch.reviewed) {
    const { kept } = await stages.review(batch.candidates);
    return kept.length > 0 ? { phase, batch: { candidates: kept, reviewed: true } } : after(phase);
  }

  // A sentence whose audio does not pass is dropped, like any other rejection:
  // only an error (the speech service being down, say) leaves it to be tried again.
  const [candidate, ...rest] = batch.candidates;
  const store = phase === "expand" ? stages.storeFrontier : lexemeId ? stages.storeLesson : stages.storePractice;
  await store(job.userId, candidate);
  return rest.length > 0 ? { phase, batch: { candidates: rest, reviewed: true } } : after(phase);
}
