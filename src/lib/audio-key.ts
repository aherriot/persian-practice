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

/**
 * The text sent to the speech model, which is not always the text shown.
 *
 * ق and غ are one sound in Tehran, but the speech model keeps them apart as
 * Dari does: ق a stop at the back of the mouth, غ a gargled fricative, so غذا
 * came out nearer Dari "ghizâ" than Tehrani "ghazâ". Describing the sound in
 * the instruction or writing the vowels changed nothing; spelling the word
 * with ق did, on every take (FINDINGS §16). The listener still checks the
 * result against the transliteration, which catches a respelling that reads
 * as another word.
 */
export const spokenText = (text: string) => text.replaceAll("غ", "ق");

/** Made in a way the pipeline no longer uses: another instruction, or another spelling for the speech model. */
export const isStale = (clip: { text: string; instructions: string | null; spoken: string | null }) =>
  clip.instructions !== null &&
  (clip.instructions !== VOICE_INSTRUCTION || (clip.spoken ?? clip.text) !== spokenText(clip.text));

/**
 * Frozen. Bumping it would re-register every clip under a new hash and orphan
 * the approvals people have given. A change to how audio is made is picked up
 * instead by comparing each clip's stored instruction and spelling with the current ones
 * (`isStale`), which leaves approved clips alone.
 */
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
