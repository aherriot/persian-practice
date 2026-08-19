/**
 * Deciding whether a transcript is worth answering.
 *
 * Two failures showed up in real use:
 *
 *  - Speech sometimes comes back romanised — Latin letters instead of Persian
 *    script — even with `language: "fa"` set. FINDINGS §9 measured the extreme
 *    version of this ("michel dotrice war am theater bekannt" for
 *    می‌شه لطفاً آروم‌تر صحبت کنید؟). The verbatim prompt largely fixed it, but
 *    not completely.
 *  - Recognition sometimes returns plausible-looking nonsense, and the tutor
 *    answers it as though it made sense. That is worse than an error message: it
 *    teaches the learner that they were understood when they were not.
 *
 * A real waiter who mishears says so. That is the behaviour to aim for, so this
 * classifies the transcript and lets the tutor ask for a repeat in character
 * rather than silently inventing a reply.
 */

/** Persian/Arabic block, plus the zero-width non-joiner. */
const PERSIAN = /[؀-ۿ‌]/g;
const LATIN = /[A-Za-z]/g;

export type TranscriptVerdict = "ok" | "empty" | "romanised" | "too-short";

export type TranscriptCheck = {
  verdict: TranscriptVerdict;
  usable: boolean;
  persianChars: number;
  latinChars: number;
};

export function assessTranscript(text: string): TranscriptCheck {
  const trimmed = text.trim();
  const persianChars = (trimmed.match(PERSIAN) ?? []).length;
  const latinChars = (trimmed.match(LATIN) ?? []).length;

  const build = (verdict: TranscriptVerdict): TranscriptCheck => ({
    verdict,
    usable: verdict === "ok",
    persianChars,
    latinChars,
  });

  if (trimmed.length === 0) return build("empty");

  // No Persian at all, but Latin present. Since the recogniser is pinned to
  // Persian, this is romanisation or hallucination rather than a learner
  // genuinely speaking English — spoken English does not survive `language: fa`
  // as clean English text.
  if (persianChars === 0 && latinChars > 0) return build("romanised");

  // Guards against a stray click producing a one-character "word". Kept low so
  // real one-word answers — بله، نه، آره — still pass.
  if (persianChars < 2) return build("too-short");

  return build("ok");
}

/** Shown to the learner, in English, so a stuck beginner is not stuck twice. */
export const TRANSCRIPT_MESSAGE: Record<Exclude<TranscriptVerdict, "ok">, string> = {
  empty: "Didn't catch anything — try holding the button while you speak.",
  romanised: "That came back garbled rather than in Persian script. Try again.",
  "too-short": "That was too short to make out — try saying a little more.",
};
