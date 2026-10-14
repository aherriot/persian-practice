"use client";

import { useState } from "react";
import { Button } from "@/components/Button";
import { Input } from "@/components/Input";
import type { WordDraft } from "@/lib/lesson/author";

type Entry = Omit<WordDraft, "understood">;
type Stage = { step: "closed" } | { step: "ask" } | { step: "confirm"; entry: Entry; existing: string | null } | { step: "saved"; entry: Entry };

async function post(body: unknown): Promise<{ ok: boolean; data: Record<string, unknown> }> {
  try {
    const response = await fetch("/api/words", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    return { ok: response.ok, data: await response.json().catch(() => ({})) };
  } catch {
    return { ok: false, data: { error: "Could not reach the server." } };
  }
}

/**
 * Add a word met outside the app: type it, check the drafted entry, save. It
 * then joins the learner's lessons, with sentences written at their level
 * (src/lib/lesson/word-lessons.ts).
 */
export function AddWord({ onAdded, open = false }: { onAdded?: () => void; open?: boolean }) {
  const [stage, setStage] = useState<Stage>({ step: open ? "ask" : "closed" });
  const [input, setInput] = useState("");
  const [hint, setHint] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const draft = async () => {
    setBusy(true);
    setError(null);
    const { ok, data } = await post({ action: "draft", input: input.trim(), hint: hint.trim() || null });
    setBusy(false);
    if (!ok) return setError(String(data.error ?? "Something went wrong."));
    const entry: Entry = data.draft as WordDraft;
    const existing = data.existing as { fa: string; gloss: string } | null;
    setStage({ step: "confirm", entry, existing: existing ? `${existing.fa} ("${existing.gloss}")` : null });
  };

  const save = async (entry: Entry) => {
    setBusy(true);
    setError(null);
    const { ok, data } = await post({ action: "save", entry });
    setBusy(false);
    if (!ok) return setError(String(data.error ?? "Something went wrong."));
    setStage({ step: "saved", entry });
    setInput("");
    setHint("");
    onAdded?.();
  };

  if (stage.step === "closed") {
    return (
      <button
        type="button"
        className="self-start text-sm font-medium text-cobalt underline"
        onClick={() => setStage({ step: "ask" })}
      >
        Add a word you learned elsewhere
      </button>
    );
  }

  const panel = "flex flex-col gap-4 rounded-lg border border-ink/15 bg-sand px-5 py-4";

  if (stage.step === "saved") {
    return (
      <div className={panel} role="status">
        <p className="text-sm text-ink">
          Added{" "}
          <span dir="rtl" lang="fa" className="text-lg">
            {stage.entry.voc}
          </span>{" "}
          ({stage.entry.translit}, &ldquo;{stage.entry.gloss}&rdquo;). It comes first in your next practice session.
          Sentences that use it are being written for your level, with any word it needs to be useful (such as the
          verb that goes with it), and join your lessons over the next few minutes.
        </p>
        <div className="flex gap-4 text-sm">
          <button type="button" className="font-medium text-cobalt underline" onClick={() => setStage({ step: "ask" })}>
            Add another
          </button>
          <button type="button" className="text-ink/60 underline" onClick={() => setStage({ step: "closed" })}>
            Done
          </button>
        </div>
      </div>
    );
  }

  if (stage.step === "ask") {
    return (
      <form
        className={panel}
        onSubmit={(event) => {
          event.preventDefault();
          if (input.trim() && !busy) void draft();
        }}
      >
        <Input
          label="The word or short phrase"
          description="In Persian, in English, or spelled the way you heard it."
          placeholder="گوجه, tomato, gojeh…"
          value={input}
          onChange={(event) => setInput(event.target.value)}
          autoFocus
          required
        />
        <Input
          label="What it means or where you heard it (optional)"
          placeholder="at the greengrocer's"
          value={hint}
          onChange={(event) => setHint(event.target.value)}
        />
        {error && <p className="text-sm text-crimson">{error}</p>}
        <div className="flex items-center gap-4">
          <Button type="submit" disabled={busy || !input.trim()}>
            {busy ? "Looking it up…" : "Look it up"}
          </Button>
          <button type="button" className="text-sm text-ink/60 underline" onClick={() => setStage({ step: "closed" })}>
            Cancel
          </button>
        </div>
      </form>
    );
  }

  const { entry, existing } = stage;
  const set = (patch: Partial<Entry>) => setStage({ step: "confirm", entry: { ...entry, ...patch }, existing });

  return (
    <form
      className={panel}
      onSubmit={(event) => {
        event.preventDefault();
        if (!busy) void save(entry);
      }}
    >
      <p className="text-sm text-ink/75">
        Check this before saving. It was drafted by the app, so correct anything a native speaker told you differently.
      </p>
      {existing && <p className="text-sm text-crimson">{existing} is already in your reference.</p>}
      <Input label="Persian, as spoken" dir="rtl" lang="fa" value={entry.fa} onChange={(e) => set({ fa: e.target.value })} required />
      <Input
        label="With vowel marks"
        description="The same letters, with the short vowels marked."
        dir="rtl"
        lang="fa"
        value={entry.voc}
        onChange={(e) => set({ voc: e.target.value })}
      />
      <Input label="Pronunciation" value={entry.translit} onChange={(e) => set({ translit: e.target.value })} required />
      <Input label="Meaning" value={entry.gloss} onChange={(e) => set({ gloss: e.target.value })} required />
      <Input
        label="Note (optional)"
        value={entry.note ?? ""}
        onChange={(e) => set({ note: e.target.value || null })}
      />
      {entry.literary && (
        <p className="text-xs text-ink/60">
          In books:{" "}
          <span dir="rtl" lang="fa" className="text-base text-ink/80">
            {entry.literary}
          </span>
        </p>
      )}
      {error && <p className="text-sm text-crimson">{error}</p>}
      <div className="flex items-center gap-4">
        <Button type="submit" disabled={busy || existing !== null}>
          {busy ? "Saving…" : "Save word"}
        </Button>
        <button type="button" className="text-sm text-ink/60 underline" onClick={() => setStage({ step: "ask" })}>
          Back
        </button>
      </div>
    </form>
  );
}
