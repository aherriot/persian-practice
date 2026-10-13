"use client";

import { useState } from "react";
import type { ApplyResponse, ProposeResponse } from "@/app/api/corrections/route";
import { useIsReviewer } from "@/components/AudioReview";
import { playAudio, refreshAudio } from "@/lib/audio-client";
import type { Subject } from "@/lib/lesson/corrections";

/**
 * "Something wrong?" under a word or a sentence. The person says what is wrong
 * in their own words; the app answers with what it would change; they agree,
 * and it is changed (src/lib/lesson/correct.ts).
 */

type Step =
  | { at: "closed" }
  | { at: "writing"; error?: string }
  | { at: "asking" }
  | { at: "proposed"; proposal: ProposeResponse }
  | { at: "applying"; proposal: ProposeResponse }
  | { at: "done"; audioUrl: string | null; audioVerified: boolean };

async function post<T>(body: unknown): Promise<T> {
  const response = await fetch("/api/corrections", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(
      response.status === 422 && data?.error
        ? data.error
        : response.status === 429
          ? "The model that works out fixes is not answering: too many requests, or the account is out of credit."
          : "Something went wrong. Try again.",
    );
  }
  return data;
}

const linkClass = "text-xs text-ink/50 underline hover:text-ink";
const buttonClass =
  "rounded-full border px-3 py-1 text-xs font-medium transition disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-turquoise-dark";

export function Correct({
  subject,
  own = false,
  after,
  onChanged,
}: {
  subject: Subject;
  /** Written for this learner alone, so theirs to change whether or not they are a reviewer. */
  own?: boolean;
  /** Said once the change is made, when the page will not show it by itself. */
  after?: string;
  onChanged?: () => void;
}) {
  const reviewer = useIsReviewer();
  const [step, setStep] = useState<Step>({ at: "closed" });
  const [note, setNote] = useState("");

  if (!reviewer && !own) return null;

  if (step.at === "closed") {
    return (
      <button type="button" className={`${linkClass} self-start`} onClick={() => setStep({ at: "writing" })}>
        Something wrong?
      </button>
    );
  }

  const propose = async () => {
    setStep({ at: "asking" });
    try {
      setStep({ at: "proposed", proposal: await post<ProposeResponse>({ action: "propose", subject, note }) });
    } catch (err) {
      setStep({ at: "writing", error: (err as Error).message });
    }
  };

  const apply = async (proposal: ProposeResponse) => {
    setStep({ at: "applying", proposal });
    try {
      const result = await post<ApplyResponse>({ action: "apply", subject, note, proposal: proposal.proposal });
      if (result.audioUrl) {
        await refreshAudio(result.audioUrl).catch(() => {});
        void playAudio(result.audioUrl);
      }
      setNote("");
      setStep({ at: "done", ...result });
      onChanged?.();
    } catch (err) {
      setStep({ at: "writing", error: (err as Error).message });
    }
  };

  return (
    <div dir="ltr" className="flex w-full flex-col gap-2 rounded-md border border-ink/15 bg-paper px-3 py-2 text-left">
      {(step.at === "writing" || step.at === "asking") && (
        <>
          <label className="flex flex-col gap-1 text-xs text-ink/60">
            What is wrong? Say it however you like.
            <textarea
              autoFocus
              rows={2}
              maxLength={1000}
              value={note}
              disabled={step.at === "asking"}
              onChange={(event) => setNote(event.target.value)}
              placeholder="It says “va” but should be “o” · It means “we have”, not “I have” · Nobody says it this way"
              className="rounded border border-ink/20 bg-sand px-2 py-1.5 text-sm text-ink outline-none placeholder:text-ink/35 focus:border-cobalt"
            />
          </label>
          {step.at === "writing" && step.error && <p className="text-xs text-crimson">{step.error}</p>}
          <div className="flex items-center gap-3">
            <button
              type="button"
              disabled={step.at === "asking" || note.trim().length === 0}
              onClick={() => void propose()}
              className={`${buttonClass} border-cobalt text-cobalt enabled:hover:bg-cobalt enabled:hover:text-sand ${step.at === "asking" ? "animate-pulse" : ""}`}
            >
              {step.at === "asking" ? "Working out a fix…" : "Suggest a fix"}
            </button>
            {step.at === "writing" && (
              <button type="button" className={linkClass} onClick={() => setStep({ at: "closed" })}>
                Cancel
              </button>
            )}
          </div>
        </>
      )}

      {(step.at === "proposed" || step.at === "applying") && (
        <>
          <p className="text-sm text-ink/80">{step.proposal.summary}</p>
          {step.proposal.lines.length > 0 && (
            <ul className="flex flex-col gap-1 text-xs text-ink/70">
              {step.proposal.lines.map((line, i) => (
                <li key={i}>
                  <span className="font-semibold text-ink/60">{line.what}</span>
                  {line.to !== undefined && (
                    <>
                      {": "}
                      <span dir="auto" className="text-ink/50 line-through">
                        {line.from}
                      </span>
                      {" → "}
                      <span dir="auto" className="text-sm text-ink">
                        {line.to}
                      </span>
                    </>
                  )}
                </li>
              ))}
            </ul>
          )}
          <div className="flex items-center gap-3">
            {step.proposal.proposal && (
              <button
                type="button"
                disabled={step.at === "applying"}
                onClick={() => void apply(step.proposal)}
                className={`${buttonClass} border-turquoise-dark text-turquoise-dark enabled:hover:bg-turquoise-dark enabled:hover:text-sand ${step.at === "applying" ? "animate-pulse" : ""}`}
              >
                {step.at === "applying" ? "Changing it… this can take a minute" : "Make this change"}
              </button>
            )}
            {step.at === "proposed" && (
              <>
                <button type="button" className={linkClass} onClick={() => setStep({ at: "writing" })}>
                  Say it differently
                </button>
                <button type="button" className={linkClass} onClick={() => setStep({ at: "closed" })}>
                  Cancel
                </button>
              </>
            )}
          </div>
        </>
      )}

      {step.at === "done" && (
        <p role="status" className="text-xs text-ink/70">
          Changed. {after}{" "}
          {step.audioUrl && (
            <>
              {step.audioVerified ? "The new recording is playing." : "A new recording was made, but it may still be off."}{" "}
              <button type="button" className="underline hover:text-ink" onClick={() => void playAudio(step.audioUrl!)}>
                Hear it again
              </button>{" "}
            </>
          )}
          <button type="button" className="underline hover:text-ink" onClick={() => setStep({ at: "writing" })}>
            Something else
          </button>
        </p>
      )}
    </div>
  );
}
