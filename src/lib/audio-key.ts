import { createHash } from "node:crypto";
import { OPENAI_TTS_MODEL, SELECTED_TTS } from "@/lib/tts-provider";

/**
 * Deliberately not contrastive — FINDINGS §6 measured "do NOT pronounce it X"
 * as worse than simply naming the right form.
 */
export const VOICE_INSTRUCTION = [
  "Speak as a native Iranian Persian speaker with a standard Tehrani accent.",
  "Natural, warm, conversational pace — you are talking with someone learning the language.",
].join(" ");

/** Bump to re-make every clip after a change to how audio is produced or checked. */
const PIPELINE_VERSION = "2";

/**
 * What a clip should say: the Persian text sent to the speech model, and the
 * transliteration it must come out as. The second is what lets the result be
 * checked (src/lib/audio-verify.ts), and is part of the identity because one
 * spelling can have two readings.
 */
export type ClipSpec = { hash: string; text: string; expected: string };

export function clipSpec(text: string, expected: string): ClipSpec {
  const hash = createHash("sha256")
    .update([PIPELINE_VERSION, OPENAI_TTS_MODEL, SELECTED_TTS.voice, text, expected].join("\n"))
    .digest("hex")
    .slice(0, 32);
  return { hash, text, expected };
}

/** A word on its own is spoken exactly like a one-word sentence. */
export function wordClip(word: { fa: string; translit: string }): ClipSpec {
  return clipSpec(`${word.fa}.`, word.translit);
}

export const audioUrl = (spec: ClipSpec) => `/api/audio/${spec.hash}`;
