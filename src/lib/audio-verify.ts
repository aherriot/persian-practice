import { openai } from "@/lib/openai";

/**
 * An automated ear for synthesised speech. The speech model picks its own
 * vowels for anything the spelling leaves open, and picks differently from one
 * call to the next, so every clip is checked against the transliteration the
 * content already carries before a learner hears it.
 *
 * Measured in spike/FINDINGS.md §13. Like every automated screen in this
 * project it nominates clips for a human; it does not replace one.
 */
export const LISTENER_MODEL = "gpt-audio-1.5";

export type Verdict = {
  /** Every expected word was heard as written, with no unnatural pause. */
  pass: boolean;
  /** What the listener heard at each expected word's position. */
  heard: string[];
  /** Indexes into the expected words that did not match. */
  wrong: number[];
  pause: boolean;
};

const prompt = (expected: string[]) => `You are checking the pronunciation of a Persian text-to-speech recording for a language-learning app. Learners will copy exactly what they hear, so a wrong vowel matters.

The recording should say these words, in this order, pronounced as transliterated (â = long a as in "father", a = short a as in "cat", kh, gh, sh, ch, zh as usual; a hyphen joins a suffix or linking vowel to its word):
${expected.map((word, i) => `${i + 1}. ${word}`).join("\n")}

Listen carefully. For each expected word, write what was actually spoken at that position in the same transliteration, then whether it matches. Be strict: a different vowel, an extra or missing consonant or syllable, or a different word is NOT a match. Recordings are frequently wrong; do not assume this one is right.

Also say whether there is an unnatural pause or break between words that a native speaker would run together.

Reply with JSON only: {"words":[{"expected":"...","heard":"...","match":true}],"pause":false}`;

/** The listener occasionally answers as if no audio were attached; ask again rather than fail the clip. */
const LISTEN_TRIES = 3;

export async function listen(audio: Buffer, expected: string[]): Promise<Verdict> {
  let failure: unknown;
  for (let attempt = 0; attempt < LISTEN_TRIES; attempt++) {
    try {
      return await listenOnce(audio, expected);
    } catch (err) {
      if (!(err instanceof ListenerReplyError)) throw err;
      failure = err;
    }
  }
  throw failure;
}

class ListenerReplyError extends Error {}

async function listenOnce(audio: Buffer, expected: string[]): Promise<Verdict> {
  const response = await openai.chat.completions.create({
    model: LISTENER_MODEL,
    modalities: ["text"],
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: prompt(expected) },
          { type: "input_audio", input_audio: { data: audio.toString("base64"), format: "mp3" } },
        ],
      },
    ],
  });
  const raw = response.choices[0]?.message.content ?? "";
  const json = raw.slice(raw.indexOf("{"), raw.lastIndexOf("}") + 1);
  let parsed: { words?: { heard?: unknown; match?: unknown }[]; pause?: unknown };
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new ListenerReplyError(`listener returned no JSON: ${raw.slice(0, 120)}`);
  }
  const words = parsed.words ?? [];
  const wrong = expected.flatMap((_, i) => (words[i]?.match === true ? [] : [i]));
  const pause = parsed.pause === true;
  return {
    pass: wrong.length === 0 && words.length === expected.length && !pause,
    heard: words.map((word) => String(word.heard ?? "")),
    wrong,
    pause,
  };
}
