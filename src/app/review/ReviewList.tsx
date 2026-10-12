"use client";

import { useState } from "react";
import { RejectAudio, sendReview } from "@/components/AudioReview";
import { playAudio, unlockAudio } from "@/lib/audio-client";

export type ReviewClip = {
  hash: string;
  text: string;
  expected: string;
  /** What the automated listener heard in the stored take. */
  heard: string | null;
  /** The sentence the audio says, when the word could not be said alone. */
  carrier: string | null;
  /** No take passed the automated word check. */
  flagged: boolean;
  /** Made with an instruction the pipeline no longer uses. */
  stale: boolean;
  approved: boolean;
  rejections: number;
};

const TABS = [
  ["listen", "Needs a listen"],
  ["unreviewed", "Not reviewed"],
  ["approved", "Approved"],
] as const;
type Tab = (typeof TABS)[number][0];

const tabOf = (clip: ReviewClip): Tab =>
  clip.approved ? "approved" : clip.flagged || clip.stale || clip.rejections > 0 ? "listen" : "unreviewed";

const url = (clip: ReviewClip) => `/api/audio/${clip.hash}`;

export function ReviewList({ clips: initial }: { clips: ReviewClip[] }) {
  const [clips, setClips] = useState(initial);
  const [tab, setTab] = useState<Tab>(() =>
    initial.some((clip) => tabOf(clip) === "listen") ? "listen" : "unreviewed",
  );
  const [failed, setFailed] = useState<string | null>(null);

  const patch = (hash: string, change: Partial<ReviewClip>) =>
    setClips((all) => all.map((clip) => (clip.hash === hash ? { ...clip, ...change } : clip)));

  async function approve(clip: ReviewClip) {
    setFailed(null);
    try {
      await sendReview(url(clip), { verdict: "approved" });
      patch(clip.hash, { approved: true });
    } catch {
      setFailed(clip.hash);
    }
  }

  const visible = clips.filter((clip) => tabOf(clip) === tab);

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-ink/65">
        Approving a clip pins it: nothing automated will replace it. Marking one as off keeps that take as a bad example
        and makes a new one, which then plays.
      </p>
      <div className="flex gap-2">
        {TABS.map(([id, label]) => (
          <button
            key={id}
            type="button"
            onClick={() => setTab(id)}
            className={`rounded-full border px-3 py-1 text-sm transition ${
              tab === id ? "border-cobalt bg-cobalt text-sand" : "border-ink/20 text-ink/70 hover:border-cobalt"
            }`}
          >
            {label} · {clips.filter((clip) => tabOf(clip) === id).length}
          </button>
        ))}
      </div>
      {visible.length === 0 && <p className="text-sm text-ink/55">Nothing here.</p>}
      <ul className="flex flex-col gap-3">
        {visible.map((clip) => (
          <li key={clip.hash} className="flex flex-col gap-2 rounded-lg border border-ink/15 bg-sand px-4 py-3">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p dir="rtl" lang="fa" className="text-2xl leading-[2] text-ink">
                  {clip.text}
                </p>
                <p className="text-sm text-ink/70">{clip.expected}</p>
              </div>
              <button
                type="button"
                onClick={() => {
                  unlockAudio();
                  void playAudio(url(clip));
                }}
                className="shrink-0 rounded-full border border-ink/25 bg-paper px-4 py-2 text-sm font-medium text-cobalt transition hover:border-cobalt"
              >
                Play
              </button>
            </div>
            <p className="flex flex-wrap gap-x-3 text-xs text-ink/55">
              {clip.flagged && (
                <span className="text-terracotta">Word check heard: {clip.heard || "nothing usable"}</span>
              )}
              {clip.carrier && <span>Played inside: {clip.carrier}</span>}
              {clip.stale && <span>Made with a retired instruction</span>}
              {clip.rejections > 0 && (
                <span>
                  Rejected {clip.rejections} time{clip.rejections === 1 ? "" : "s"}
                </span>
              )}
              {failed === clip.hash && <span className="text-terracotta">Could not save — try again</span>}
            </p>
            <div className="flex items-center justify-end gap-3">
              <RejectAudio
                url={url(clip)}
                autoplay
                onRemade={(result) =>
                  patch(clip.hash, {
                    approved: false,
                    stale: false,
                    flagged: result.status === "flagged",
                    heard: null,
                    rejections: clip.rejections + 1,
                  })
                }
              />
              {!clip.approved && (
                <button
                  type="button"
                  onClick={() => void approve(clip)}
                  className="rounded-full border border-turquoise-dark px-4 py-1.5 text-sm font-medium text-turquoise-dark transition hover:bg-turquoise-dark hover:text-sand"
                >
                  Sounds right
                </button>
              )}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
