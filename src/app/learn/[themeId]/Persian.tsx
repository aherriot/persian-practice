"use client";

import { Popover, PopoverButton, PopoverPanel } from "@headlessui/react";
import { playAudio } from "@/lib/audio-client";
import type { DisplaySentence, DisplayToken } from "@/lib/lesson/types";

export const shown = (word: { fa: string; voc: string; showVowels: boolean }) => (word.showVowels ? word.voc : word.fa);

export function SpeakButton({
  url,
  label = "Play audio",
  large = false,
  small = false,
}: {
  url: string;
  label?: string;
  large?: boolean;
  /** For dense lists, where the button sits on a single line of text. */
  small?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={() => void playAudio(url)}
      aria-label={label}
      className={`inline-flex shrink-0 items-center justify-center rounded-full border border-ink/25 bg-sand text-cobalt transition hover:border-cobalt hover:bg-paper focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-turquoise-dark ${
        large ? "h-20 w-20" : small ? "h-8 w-8" : "h-10 w-10"
      }`}
    >
      <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" className={large ? "h-9 w-9" : small ? "h-4 w-4" : "h-5 w-5"}>
        <path d="M4 9v6h4l5 4V5L8 9H4z" />
        <path
          d="M16 8.5a4.5 4.5 0 0 1 0 7M18.5 6a8 8 0 0 1 0 12"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
        />
      </svg>
    </button>
  );
}

/** One word: hover for the pronunciation, tap for a card with it (and the meaning, once revealed). */
function Word({ token, revealMeaning }: { token: DisplayToken; revealMeaning: boolean }) {
  return (
    <Popover as="span" className="relative inline-block">
      <PopoverButton
        title={token.translit}
        className="rounded decoration-ink/25 decoration-dotted underline-offset-[0.45em] outline-none hover:underline data-[focus]:underline data-[open]:bg-gold/25"
      >
        {shown(token)}
      </PopoverButton>
      <PopoverPanel
        anchor={{ to: "bottom", gap: 6 }}
        dir="ltr"
        className="z-20 rounded-md border border-ink/20 bg-paper px-3 py-2 text-center shadow-lg"
      >
        <p className="text-sm font-medium text-ink">{token.translit}</p>
        {revealMeaning && <p className="text-xs text-ink/60">{token.gloss}</p>}
      </PopoverPanel>
    </Popover>
  );
}

export function SentenceView({
  sentence,
  revealMeaning,
  blankIndex,
  hints = true,
  className = "text-3xl",
}: {
  sentence: DisplaySentence;
  /** Whether tapping a word also shows what it means — off while the meaning is the question. */
  revealMeaning: boolean;
  blankIndex?: number;
  /** Whether a word gives up its pronunciation when tapped — off while reading it unaided is the question. */
  hints?: boolean;
  className?: string;
}) {
  return (
    <p dir="rtl" lang="fa" className={`leading-[2.2] text-ink ${className}`}>
      {sentence.tokens.map((token, i) => (
        <span key={i}>
          {i === blankIndex ? (
            <span className="mx-1 inline-block w-20 border-b-2 border-ink/50 align-baseline" aria-label="blank">
              &nbsp;
            </span>
          ) : hints ? (
            <Word token={token} revealMeaning={revealMeaning} />
          ) : (
            shown(token)
          )}
          {token.after}
          {i < sentence.tokens.length - 1 ? " " : sentence.endPunct}
        </span>
      ))}
    </p>
  );
}
