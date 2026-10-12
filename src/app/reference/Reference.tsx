"use client";

import { useRouter } from "next/navigation";
import { useMemo, useRef, useState } from "react";
import { Input } from "@/components/Input";
import { unlockAudio } from "@/lib/audio-client";
import { normalizeForCompare } from "@/lib/normalize";
import { SpeakButton } from "../learn/[themeId]/Persian";
import { AddWord } from "./AddWord";

export type ReferenceExample = {
  id: string;
  voc: string;
  translit: string;
  english: string;
  audioUrl: string;
  /** Written by the app rather than by hand. */
  generated: boolean;
};

export type ReferenceWord = {
  id: string;
  fa: string;
  voc: string;
  translit: string;
  gloss: string;
  lemma: string | null;
  literary: string | null;
  note: string | null;
  met: boolean;
  /** Null for curated words. */
  addedBy: "learner" | "app" | null;
  audioUrl: string;
  examples: ReferenceExample[];
};

export type ReferencePattern = {
  id: string;
  title: string;
  summary: string;
  met: boolean;
  examples: ReferenceExample[];
};

/** Lowercase, and without the marks on â so that typing "darim" finds dârim. */
const foldLatin = (text: string) =>
  text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");

const haystack = (parts: (string | null)[]) => {
  const text = parts.filter(Boolean).join(" ");
  return `${foldLatin(text)} ${normalizeForCompare(text)}`;
};

function Examples({ examples }: { examples: ReferenceExample[] }) {
  if (examples.length === 0) return null;
  return (
    <ul className="mt-3 flex flex-col gap-2 border-t border-ink/10 pt-3">
      {examples.map((example) => (
        <li key={example.id} className="flex items-start justify-between gap-3">
          <div>
            <p dir="rtl" lang="fa" className="text-xl leading-[2] text-ink">
              {example.voc}
            </p>
            <p className="text-xs text-ink/60">{example.translit}</p>
            <p className="text-sm text-ink/80">
              {example.english}
              {example.generated && <span className="ml-2 text-xs text-ink/45">written by the app</span>}
            </p>
          </div>
          <SpeakButton url={example.audioUrl} label="Hear the sentence" />
        </li>
      ))}
    </ul>
  );
}

const NotMet = () => (
  <span className="rounded-full border border-ink/20 px-2 py-0.5 text-[0.65rem] uppercase tracking-wider text-ink/50">
    Not learned yet
  </span>
);

const cardClass =
  "rounded-lg border border-ink/15 bg-sand px-5 py-4 shadow-[inset_0_4px_8px_-6px_rgba(42,29,22,0.35)]";
const headingClass = "text-xs font-semibold uppercase tracking-widest text-ink/50";

export function Reference({ words, patterns }: { words: ReferenceWord[]; patterns: ReferencePattern[] }) {
  const [query, setQuery] = useState("");
  const [onlyMet, setOnlyMet] = useState(false);
  const unlocked = useRef(false);
  const router = useRouter();

  const remove = async (word: ReferenceWord) => {
    if (!window.confirm(`Remove ${word.translit} ("${word.gloss}") and your progress on it?`)) return;
    await fetch("/api/words", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "remove", id: word.id }),
    }).catch(() => {});
    router.refresh();
  };

  const indexed = useMemo(
    () => ({
      words: words.map((word) => ({
        word,
        text: haystack([word.fa, word.translit, word.gloss, word.lemma, word.literary]),
      })),
      patterns: patterns.map((pattern) => ({ pattern, text: haystack([pattern.title, pattern.summary]) })),
    }),
    [words, patterns],
  );

  const needles = [foldLatin(query.trim()), normalizeForCompare(query.trim())].filter(Boolean);
  const matches = (text: string) => needles.length === 0 || needles.some((needle) => text.includes(needle));
  const shownWords = indexed.words.filter(({ word, text }) => matches(text) && (!onlyMet || word.met)).map((x) => x.word);
  const shownPatterns = indexed.patterns
    .filter(({ pattern, text }) => matches(text) && (!onlyMet || pattern.met))
    .map((x) => x.pattern);

  return (
    <div
      className="flex flex-col gap-6"
      // Safari only lets audio play after a tap; one silent play here covers every clip.
      onPointerDownCapture={() => {
        if (unlocked.current) return;
        unlocked.current = true;
        unlockAudio();
      }}
    >
      <AddWord onAdded={() => router.refresh()} />
      <Input
        type="search"
        label="Look up a word"
        placeholder="carrot, havij, هویج…"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
      />
      <label className="flex items-center gap-2 text-sm text-ink/70">
        <input type="checkbox" checked={onlyMet} onChange={(event) => setOnlyMet(event.target.checked)} />
        Only what I have learned so far
      </label>

      <section className="flex flex-col gap-3">
        <h2 className={headingClass}>Words ({shownWords.length})</h2>
        {shownWords.length === 0 && <p className="text-sm text-ink/60">No words match.</p>}
        {shownWords.map((word) => (
          <article key={word.id} className={cardClass}>
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-base font-semibold text-ink">{word.gloss}</p>
                <p className="text-sm text-ink/65">{word.translit}</p>
              </div>
              <div className="flex items-center gap-3">
                <span dir="rtl" lang="fa" className="text-3xl leading-[1.8] text-ink">
                  {word.voc}
                </span>
                <SpeakButton url={word.audioUrl} label={`Hear ${word.translit}`} />
              </div>
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-ink/60">
              {!word.met && <NotMet />}
              {word.addedBy && (
                <span>
                  {word.addedBy === "learner" ? "Added by you" : "Added by the app"} ·{" "}
                  <button type="button" className="underline hover:text-ink" onClick={() => void remove(word)}>
                    Remove
                  </button>
                </span>
              )}
              {word.voc !== word.fa && (
                <span>
                  Usually written{" "}
                  <span dir="rtl" lang="fa" className="text-base text-ink/80">
                    {word.fa}
                  </span>
                </span>
              )}
              {word.literary && (
                <span>
                  In books:{" "}
                  <span dir="rtl" lang="fa" className="text-base text-ink/80">
                    {word.literary}
                  </span>
                </span>
              )}
              {word.lemma && (
                <span>
                  A form of{" "}
                  <span dir="rtl" lang="fa" className="text-base text-ink/80">
                    {word.lemma}
                  </span>
                </span>
              )}
            </div>
            {word.note && <p className="mt-2 text-sm text-ink/70">{word.note}</p>}
            <Examples examples={word.examples} />
          </article>
        ))}
      </section>

      <section className="flex flex-col gap-3">
        <h2 className={headingClass}>Grammar ({shownPatterns.length})</h2>
        {shownPatterns.length === 0 && <p className="text-sm text-ink/60">No grammar notes match.</p>}
        {shownPatterns.map((pattern) => (
          <article key={pattern.id} className={cardClass}>
            <div className="flex items-start justify-between gap-3">
              <h3 className="text-base font-semibold text-ink">{pattern.title}</h3>
              {!pattern.met && <NotMet />}
            </div>
            <p className="mt-1 text-sm leading-relaxed text-ink/75">{pattern.summary}</p>
            <Examples examples={pattern.examples} />
          </article>
        ))}
      </section>
    </div>
  );
}
