"use client";

import { useState } from "react";
import { Correct } from "@/components/Correct";
import { playAudio, unlockAudio } from "@/lib/audio-client";
import type { ReviewItem } from "@/lib/lesson/flags";

type Done = "fixed" | "fine";

const TABS = [
  ["flagged", "Flagged"],
  ["audio", "Recordings to check"],
] as const;
type Tab = (typeof TABS)[number][0];

const tabOf = (item: ReviewItem): Tab => (item.flags.length > 0 ? "flagged" : "audio");
const keyOf = (item: ReviewItem) => `${item.subject.kind}:${item.subject.id}`;

async function looksRight(item: ReviewItem) {
  const response = await fetch("/api/corrections", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "looks-right", subject: item.subject }),
  });
  if (!response.ok) throw new Error(`looks-right ${response.status}`);
}

export function ReviewList({ items, reviewer }: { items: ReviewItem[]; reviewer: boolean }) {
  const [done, setDone] = useState<Record<string, Done>>({});
  const [failed, setFailed] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>(() => (items.some((item) => tabOf(item) === "flagged") || !reviewer ? "flagged" : "audio"));

  const settle = (item: ReviewItem, how: Done) => setDone((all) => ({ ...all, [keyOf(item)]: how }));
  const waiting = (id: Tab) => items.filter((item) => tabOf(item) === id && !done[keyOf(item)]).length;
  const visible = items.filter((item) => tabOf(item) === tab);

  async function fine(item: ReviewItem) {
    setFailed(null);
    try {
      await looksRight(item);
      settle(item, "fine");
    } catch {
      setFailed(keyOf(item));
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-ink/65">
        What you have flagged with “Something wrong?”{reviewer && ", and the recordings the automated listener is unsure of"}.
        Fix each one here, or mark it as fine.{reviewer && " A recording marked as fine is pinned: nothing automated will replace it."}
      </p>
      {reviewer && (
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
              {label} · {waiting(id)}
            </button>
          ))}
        </div>
      )}
      {visible.length === 0 && (
        <p className="text-sm text-ink/55">
          {tab === "flagged" ? "Nothing flagged. Use “Something wrong?” under a word or sentence to flag one." : "Nothing here."}
        </p>
      )}
      <ul className="flex flex-col gap-3">
        {visible.map((item) => {
          const key = keyOf(item);
          const settled = done[key];
          const note = item.flags.map((flag) => flag.note).join("\n");
          return (
            <li key={key} className={`flex flex-col gap-2 rounded-lg border border-ink/15 bg-sand px-4 py-3 ${settled ? "opacity-60" : ""}`}>
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p dir="rtl" lang="fa" className="text-2xl leading-[2] text-ink">
                    {item.fa}
                  </p>
                  <p className="text-sm text-ink/70">{item.translit}</p>
                  <p className="text-sm text-ink/55">{item.english}</p>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    unlockAudio();
                    void playAudio(item.audioUrl);
                  }}
                  className="shrink-0 rounded-full border border-ink/25 bg-paper px-4 py-2 text-sm font-medium text-cobalt transition hover:border-cobalt"
                >
                  Play
                </button>
              </div>
              {item.flags.length > 0 && (
                <ul className="flex flex-col gap-1 text-sm text-ink/80">
                  {item.flags.map((flag) => (
                    <li key={flag.id} className="border-l-2 border-terracotta pl-2">
                      {flag.note}
                      <span className="ml-2 text-xs text-ink/45">
                        {flag.mine ? "you" : "another learner"}, {new Date(flag.createdAt).toLocaleDateString()}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
              {item.audio && (
                <p className="flex flex-wrap gap-x-3 text-xs text-ink/55">
                  {item.audio.flagged && <span className="text-terracotta">Word check heard: {item.audio.heard || "nothing usable"}</span>}
                  {item.audio.stale && <span>Made a way no longer used; no remake has passed yet</span>}
                  {item.audio.carrier && <span>Played inside: {item.audio.carrier}</span>}
                </p>
              )}
              {failed === key && <p className="text-xs text-terracotta">Could not save. Try again.</p>}
              {settled === "fine" ? (
                <p role="status" className="text-xs text-ink/70">
                  Marked as fine.
                </p>
              ) : (
                <div className="flex flex-col gap-2">
                  {/* Stays after a fix: it says what was changed, and plays the new recording. */}
                  <Correct
                    subject={item.subject}
                    own={item.own}
                    note={note}
                    label="Fix it"
                    flaggable={false}
                    onChanged={() => settle(item, "fixed")}
                  />
                  {!settled && (
                    <button type="button" onClick={() => void fine(item)} className="self-start text-xs text-ink/50 underline hover:text-ink">
                      {item.flags.length > 0 ? "Nothing wrong after all" : "Sounds right"}
                    </button>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
