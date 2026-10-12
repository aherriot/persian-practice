"use client";

import { Popover, PopoverButton, PopoverPanel } from "@headlessui/react";
import { createContext, useContext, useState, type ReactNode } from "react";
import { playAudio, refreshAudio } from "@/lib/audio-client";
import type { ReviewReason } from "@/lib/audio-store";

/**
 * A person's ear on lesson audio. The automated listener checks the words but
 * cannot hear accent (FINDINGS §14), so a reviewer can reject any clip where
 * they hear it; the take is kept as a labelled example and the clip is remade.
 */
const ReviewContext = createContext(false);

/** Turns on the "sounds off" control beside every audio button underneath it. */
export function AudioReviewProvider({ enabled, children }: { enabled: boolean; children: ReactNode }) {
  return <ReviewContext value={enabled}>{children}</ReviewContext>;
}

export type ReviewResult = {
  status: "verified" | "flagged" | null;
  approved: boolean;
};

const REASONS: [ReviewReason, string][] = [
  ["word", "Wrong word or vowel"],
  ["accent", "Accent sounds off"],
  ["pause", "Unnatural pause"],
  ["other", "Something else"],
];

export async function sendReview(
  url: string,
  review: { verdict: "approved" } | { verdict: "rejected"; reason: ReviewReason; note: string | null },
): Promise<ReviewResult> {
  const response = await fetch("/api/audio/review", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ hash: url.split("/").pop(), ...review }),
  });
  if (!response.ok) throw new Error(`review ${response.status}`);
  return response.json();
}

type State = "idle" | "working" | "done" | "failed";

/** Rejects the clip at `url` for a chosen reason, waits for the remake, and loads the new take. */
export function RejectAudio({
  url,
  autoplay = false,
  onRemade,
}: {
  url: string;
  /** Play the new take as soon as it is ready. */
  autoplay?: boolean;
  onRemade?: (result: ReviewResult) => void;
}) {
  const [state, setState] = useState<State>("idle");
  const [note, setNote] = useState("");

  async function reject(reason: ReviewReason) {
    setState("working");
    try {
      const result = await sendReview(url, {
        verdict: "rejected",
        reason,
        note: note.trim() || null,
      });
      await refreshAudio(url);
      setNote("");
      setState("done");
      onRemade?.(result);
      if (autoplay) void playAudio(url);
    } catch {
      setState("failed");
    }
  }

  const title = {
    idle: "This audio sounds off",
    working: "Making a new take…",
    done: "Remade — listen again",
    failed: "Could not remake it — try again",
  }[state];

  return (
    <Popover className="relative inline-flex">
      <PopoverButton
        disabled={state === "working"}
        aria-label={title}
        title={title}
        className={`inline-flex h-7 w-7 items-center justify-center rounded-full border text-xs outline-none transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-turquoise-dark ${
          state === "done"
            ? "border-turquoise-dark text-turquoise-dark"
            : state === "failed"
              ? "border-terracotta text-terracotta"
              : "border-ink/15 text-ink/40 hover:border-terracotta hover:text-terracotta"
        } ${state === "working" ? "animate-pulse" : ""}`}
      >
        {state === "done" ? (
          "✓"
        ) : (
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
            className="h-3.5 w-3.5"
          >
            <path d="M5 21V4M5 4h11l-2 4 2 4H5" />
          </svg>
        )}
      </PopoverButton>
      <PopoverPanel
        anchor={{ to: "bottom end", gap: 6 }}
        dir="ltr"
        className="z-30 flex w-56 flex-col gap-1 rounded-md border border-ink/20 bg-paper p-2 text-left shadow-lg"
      >
        {({ close }) => (
          <>
            <p className="px-2 pt-1 text-xs font-semibold uppercase tracking-widest text-ink/50">What sounds off?</p>
            {REASONS.map(([reason, label]) => (
              <button
                key={reason}
                type="button"
                onClick={() => {
                  close();
                  void reject(reason);
                }}
                className="rounded px-2 py-1.5 text-left text-sm text-ink hover:bg-sand"
              >
                {label}
              </button>
            ))}
            <input
              value={note}
              onChange={(event) => setNote(event.target.value)}
              maxLength={300}
              placeholder="Note first, if you like"
              className="mt-1 rounded border border-ink/15 bg-sand px-2 py-1 text-xs text-ink outline-none placeholder:text-ink/40 focus:border-cobalt"
            />
            <p className="px-2 pb-1 text-xs text-ink/50">The clip is made again; that takes a moment.</p>
          </>
        )}
      </PopoverPanel>
    </Popover>
  );
}

/** The reject control, shown only to reviewers (see AudioReviewProvider). */
export function FlagAudio({ url }: { url: string }) {
  return useContext(ReviewContext) ? <RejectAudio url={url} /> : null;
}
