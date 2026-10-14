"use client";

import { useRouter } from "next/navigation";
import { useWindowVirtualizer } from "@tanstack/react-virtual";
import { useCallback, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Correct } from "@/components/Correct";
import { Input } from "@/components/Input";
import { unlockAudio } from "@/lib/audio-client";
import { normalizeForCompare } from "@/lib/normalize";
import { SpeakButton } from "../learn/[themeId]/Persian";
import { AddWord } from "@/components/AddWord";

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
};

export type ReferencePattern = {
  id: string;
  title: string;
  summary: string;
  met: boolean;
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

/** Undefined while they are on their way; null when they could not be fetched. */
type Loaded = ReferenceExample[] | null | undefined;

function Examples({ examples, onChanged }: { examples: Loaded; onChanged: () => void }) {
  if (examples === undefined) return <p className="text-xs text-ink/50">Finding examples…</p>;
  if (examples === null) return <p className="text-xs text-crimson">Could not load the examples. Close and reopen to try again.</p>;
  if (examples.length === 0) return <p className="text-xs text-ink/50">No example sentences yet.</p>;
  return (
    <ul className="flex flex-col gap-1.5">
      {examples.map((example) => (
        <li key={example.id} className="flex flex-col gap-1">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p dir="rtl" lang="fa" className="text-lg leading-[1.9] text-ink">
                {example.voc}
              </p>
              <p className="text-xs text-ink/60">
                {example.translit} · <span className="text-ink/80">{example.english}</span>
                {example.generated && <span className="ml-2 text-ink/45">written by the app</span>}
              </p>
            </div>
            <SpeakButton small url={example.audioUrl} label="Hear the sentence" />
          </div>
          <Correct subject={{ kind: "sentence", id: example.id }} own={example.generated} onChanged={onChanged} />
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

const headingClass = "text-xs font-semibold uppercase tracking-widest text-ink/50";
const faInline = "text-base text-ink/80";

/** One dictionary line: tap it to open what is known about the entry underneath. */
function Entry({
  open,
  onToggle,
  met,
  summary,
  aside,
  children,
}: {
  open: boolean;
  onToggle: () => void;
  met: boolean;
  summary: ReactNode;
  /** Sits at the end of the line, outside the toggle. */
  aside?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className={`border-b border-ink/10 ${open ? "bg-sand/60" : ""}`}>
      <div className="flex min-h-11 items-center gap-2 px-1">
        <button
          type="button"
          aria-expanded={open}
          onClick={onToggle}
          className={`flex min-h-11 min-w-0 flex-1 items-center gap-2 rounded text-left outline-none focus-visible:outline-2 focus-visible:outline-turquoise-dark ${
            met ? "" : "opacity-55"
          }`}
        >
          <svg
            viewBox="0 0 12 12"
            aria-hidden="true"
            className={`h-3 w-3 shrink-0 text-ink/40 transition-transform ${open ? "rotate-90" : ""}`}
          >
            <path d="M4 2l4 4-4 4" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
          </svg>
          {summary}
          {!met && <span className="sr-only">(not learned yet)</span>}
        </button>
        {aside}
      </div>
      {open && <div className="flex flex-col gap-2 pb-3 pl-6 pr-1">{children}</div>}
    </div>
  );
}

type Row =
  | { kind: "heading"; key: string; label: string }
  | { kind: "empty"; key: string; label: string }
  | { kind: "word"; key: string; word: ReferenceWord }
  | { kind: "pattern"; key: string; pattern: ReferencePattern };

export function Reference({ words, patterns }: { words: ReferenceWord[]; patterns: ReferencePattern[] }) {
  const [query, setQuery] = useState("");
  const [onlyMet, setOnlyMet] = useState(false);
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set());
  const unlocked = useRef(false);
  const router = useRouter();

  // Examples are fetched the first time an entry is opened, and kept.
  const [examples, setExamples] = useState<ReadonlyMap<string, Loaded>>(new Map());
  const requested = useRef(new Set<string>());

  const load = (key: string) => {
    requested.current.add(key);
    const [kind, id] = [key.slice(0, key.indexOf(":")), key.slice(key.indexOf(":") + 1)];
    fetch(`/api/reference/examples?${new URLSearchParams({ kind, id })}`)
      .then((response) => (response.ok ? response.json() : Promise.reject(new Error(`examples ${response.status}`))))
      .then((data: { examples: ReferenceExample[] }) => data.examples)
      .catch(() => {
        requested.current.delete(key);
        return null;
      })
      .then((loaded) => setExamples((current) => new Map(current).set(key, loaded)));
  };

  const toggle = (key: string) => {
    setOpen((current) => {
      const next = new Set(current);
      if (!next.delete(key)) next.add(key);
      return next;
    });
    if (!requested.current.has(key)) load(key);
  };

  /** Something under this entry was fixed: show it as it now is. A word's fix reaches other entries' examples too. */
  const changed = (key: string) => {
    requested.current = new Set();
    for (const shown of new Set([...open, key])) load(shown);
    router.refresh();
  };

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

  // Words and grammar as one flat list, so a single virtualizer can window both.
  const rows = useMemo<Row[]>(() => {
    const needles = [foldLatin(query.trim()), normalizeForCompare(query.trim())].filter(Boolean);
    const matches = (text: string) => needles.length === 0 || needles.some((needle) => text.includes(needle));
    const shownWords = indexed.words.filter(({ word, text }) => matches(text) && (!onlyMet || word.met));
    const shownPatterns = indexed.patterns.filter(({ pattern, text }) => matches(text) && (!onlyMet || pattern.met));
    return [
      { kind: "heading", key: "heading:words", label: `Words (${shownWords.length})` },
      ...(shownWords.length === 0 ? [{ kind: "empty" as const, key: "empty:words", label: "No words match." }] : []),
      ...shownWords.map(({ word }) => ({ kind: "word" as const, key: `lexeme:${word.id}`, word })),
      { kind: "heading", key: "heading:patterns", label: `Grammar (${shownPatterns.length})` },
      ...(shownPatterns.length === 0
        ? [{ kind: "empty" as const, key: "empty:patterns", label: "No grammar notes match." }]
        : []),
      ...shownPatterns.map(({ pattern }) => ({ kind: "pattern" as const, key: `pattern:${pattern.id}`, pattern })),
    ];
  }, [indexed, query, onlyMet]);

  // The list scrolls with the page, so the virtualizer has to know how far down the page it starts;
  // that moves whenever the add-a-word form above it opens or closes.
  const rootRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const [scrollMargin, setScrollMargin] = useState(0);
  useLayoutEffect(() => {
    const root = rootRef.current;
    const list = listRef.current;
    if (!root || !list) return;
    const observer = new ResizeObserver(() => setScrollMargin(list.getBoundingClientRect().top + window.scrollY));
    observer.observe(root);
    return () => observer.disconnect();
  }, []);

  const virtualizer = useWindowVirtualizer({
    count: rows.length,
    estimateSize: () => 45,
    getItemKey: useCallback((index: number) => rows[index].key, [rows]),
    overscan: 8,
    scrollMargin,
    // Lets the server render the first screenful rather than an empty list.
    initialRect: { width: 0, height: 900 },
  });
  const items = virtualizer.getVirtualItems();

  const renderRow = (row: Row) => {
    if (row.kind === "heading") return <h2 className={`${headingClass} border-b border-ink/20 pb-2 pt-5`}>{row.label}</h2>;
    if (row.kind === "empty") return <p className="py-3 text-sm text-ink/60">{row.label}</p>;

    const isOpen = open.has(row.key);
    if (row.kind === "pattern") {
      const { pattern } = row;
      return (
        <Entry
          open={isOpen}
          onToggle={() => toggle(row.key)}
          met={pattern.met}
          summary={
            <span className={`min-w-0 flex-1 text-sm ${isOpen ? "py-2" : "truncate"}`}>
              <span className="font-semibold text-ink">{pattern.title}</span>
              {!isOpen && <span className="ml-2 text-xs text-ink/55">{pattern.summary}</span>}
            </span>
          }
        >
          {!pattern.met && (
            <div>
              <NotMet />
            </div>
          )}
          <p className="text-sm leading-relaxed text-ink/75">{pattern.summary}</p>
          <Examples examples={examples.get(row.key)} onChanged={() => changed(row.key)} />
        </Entry>
      );
    }

    const { word } = row;
    return (
      <Entry
        open={isOpen}
        onToggle={() => toggle(row.key)}
        met={word.met}
        summary={
          <>
            <span className={`min-w-0 flex-1 text-sm ${isOpen ? "py-2" : "truncate"}`}>
              <span className="font-semibold text-ink">{word.gloss}</span>
              <span className="ml-2 text-xs text-ink/60">{word.translit}</span>
            </span>
            <span
              dir="rtl"
              lang="fa"
              className={`text-xl leading-[2.75rem] text-ink ${isOpen ? "shrink-0" : "max-w-[55%] truncate"}`}
            >
              {word.voc}
            </span>
          </>
        }
        aside={<SpeakButton small url={word.audioUrl} label={`Hear ${word.translit}`} />}
      >
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-ink/60 empty:hidden">
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
              <span dir="rtl" lang="fa" className={faInline}>
                {word.fa}
              </span>
            </span>
          )}
          {word.literary && (
            <span>
              In books:{" "}
              <span dir="rtl" lang="fa" className={faInline}>
                {word.literary}
              </span>
            </span>
          )}
          {word.lemma && (
            <span>
              A form of{" "}
              <span dir="rtl" lang="fa" className={faInline}>
                {word.lemma}
              </span>
            </span>
          )}
        </div>
        {word.note && <p className="text-sm text-ink/70">{word.note}</p>}
        <Correct subject={{ kind: "lexeme", id: word.id }} own={word.addedBy !== null} onChanged={() => changed(row.key)} />
        <Examples examples={examples.get(row.key)} onChanged={() => changed(row.key)} />
      </Entry>
    );
  };

  return (
    <div
      ref={rootRef}
      className="flex flex-col gap-3"
      // Safari only lets audio play after a tap; one silent play here covers every clip.
      onPointerDownCapture={() => {
        if (unlocked.current) return;
        unlocked.current = true;
        unlockAudio();
      }}
    >
      <AddWord onAdded={() => router.refresh()} />
      <div className="sticky top-0 z-10 -mx-5 flex flex-col gap-2 border-b border-ink/10 bg-paper px-5 py-3">
        <Input
          type="search"
          label="Look up a word"
          placeholder="carrot, havij, هویج…"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        <label className="flex items-center gap-2 text-xs text-ink/70">
          <input type="checkbox" checked={onlyMet} onChange={(event) => setOnlyMet(event.target.checked)} />
          Only what I have learned so far
          <span className="ml-auto text-ink/45">Tap an entry for examples</span>
        </label>
      </div>

      <div ref={listRef} className="relative -mt-3" style={{ height: virtualizer.getTotalSize() }}>
        <div
          className="absolute inset-x-0 top-0"
          style={{ transform: `translateY(${(items[0]?.start ?? 0) - virtualizer.options.scrollMargin}px)` }}
        >
          {items.map((item) => (
            <div key={item.key} data-index={item.index} ref={virtualizer.measureElement}>
              {renderRow(rows[item.index])}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
