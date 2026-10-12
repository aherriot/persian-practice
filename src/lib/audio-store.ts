import { del, get, list, put } from "@vercel/blob";
import { eq } from "drizzle-orm";
import { VOICE_INSTRUCTION, type ClipSpec } from "@/lib/audio-key";
import { listen } from "@/lib/audio-verify";
import { db } from "@/lib/db";
import { audioClips } from "@/lib/db/schema";
import { openai } from "@/lib/openai";
import { OPENAI_TTS_MODEL, SELECTED_TTS } from "@/lib/tts-provider";

// The mp3s live in a private Vercel Blob store, one object per clip hash. The
// database records what each hash should say, so a missing object can be made
// on demand.
const PREFIX = "audio/";
const blobPath = (hash: string) => `${PREFIX}${hash}.mp3`;

/** Registers clips so their audio can be made later. No audio is generated here. */
export async function registerClips(specs: ClipSpec[]): Promise<void> {
  if (specs.length === 0) return;
  await db.insert(audioClips).values(specs).onConflictDoNothing();
}

/** Deletes stored audio that no registered clip refers to any more. Returns how many. */
export async function deleteOrphanedAudio(): Promise<number> {
  const registered = new Set((await db.select({ hash: audioClips.hash }).from(audioClips)).map((clip) => clip.hash));
  const orphans: string[] = [];
  let cursor: string | undefined;
  do {
    const page = await list({ prefix: PREFIX, cursor });
    for (const blob of page.blobs) {
      if (!registered.has(blob.pathname.slice(PREFIX.length, -".mp3".length))) orphans.push(blob.url);
    }
    cursor = page.hasMore ? page.cursor : undefined;
  } while (cursor);
  if (orphans.length > 0) await del(orphans);
  return orphans.length;
}

// --- Making a clip: synthesise, listen, retry ---
//
// The speech model chooses its own reading wherever the spelling leaves one
// open, and chooses differently from call to call: the same request produced
// both "havij va sib" and the correct "havij o sib". So no single prompt is
// trusted. Each candidate is checked against the expected transliteration by
// an automated listener, and only one that passes is kept.

const MAX_ATTEMPTS = 4;
/** Attempts made with the voice instruction alone before naming the words that keep coming out wrong. */
const PLAIN_ATTEMPTS = 2;
/**
 * A candidate must pass this many separate listens. The listener never passed
 * a mispronounced clip twice in FINDINGS §13, but did reject good ones — the
 * cheap direction to be wrong in, since a rejection only costs another attempt.
 */
const LISTENS = 2;

const stripPunctuation = (word: string) => word.replace(/[.،؟!]/g, "");

/**
 * The FINDINGS §6 "named" instruction: say how the word is pronounced and
 * nothing about how it is not. Sent without the voice instruction, the only
 * form that was measured to work.
 */
function namedInstruction(clip: { text: string; expected: string }, wrong: Set<number>): string | null {
  const words = clip.text.split(/\s+/).map(stripPunctuation);
  const expected = clip.expected.split(/\s+/);
  if (wrong.size === 0 || words.length !== expected.length) return null;
  const named = [...wrong].sort((a, b) => a - b).map((i) => `The word "${words[i]}" must be pronounced "${expected[i]}".`);
  return `This is Persian. ${named.join(" ")} Read the sentence naturally at a conversational pace.`;
}

async function synthesise(text: string, instructions: string): Promise<Buffer> {
  const speech = await openai.audio.speech.create({
    model: OPENAI_TTS_MODEL,
    voice: SELECTED_TTS.voice,
    input: text,
    response_format: "mp3",
    instructions,
  });
  return Buffer.from(await speech.arrayBuffer());
}

type Candidate = { audio: Buffer; instructions: string; heard: string; faults: number; attempts: number };

async function judge(audio: Buffer, expected: string[]): Promise<{ heard: string; wrong: number[]; faults: number }> {
  let last = { heard: "", wrong: [] as number[], faults: 0 };
  for (let i = 0; i < LISTENS; i++) {
    const verdict = await listen(audio, expected);
    last = {
      heard: verdict.heard.join(" "),
      wrong: verdict.wrong,
      faults: verdict.pass ? 0 : Math.max(1, verdict.wrong.length + (verdict.pause ? 1 : 0)),
    };
    if (!verdict.pass) break;
  }
  return last;
}

async function produce(clip: { text: string; expected: string }): Promise<Candidate> {
  const expected = clip.expected.split(/\s+/);
  const wrong = new Set<number>();
  let best: Candidate | null = null;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const instructions =
      (attempt > PLAIN_ATTEMPTS ? namedInstruction(clip, wrong) : null) ?? VOICE_INSTRUCTION;
    const audio = await synthesise(clip.text, instructions);
    const result = await judge(audio, expected);
    if (!best || result.faults < best.faults) {
      best = { audio, instructions, heard: result.heard, faults: result.faults, attempts: attempt };
    }
    best.attempts = attempt;
    if (result.faults === 0) break;
    for (const index of result.wrong) wrong.add(index);
  }
  return best!;
}

// Two requests for the same clip (the player and the preloader, say) share one
// run instead of paying for it twice.
const inFlight = new Map<string, Promise<Buffer | null>>();

/** Makes the clip's audio and stores it, replacing any that is already there. Null if unregistered. */
export function makeClipAudio(hash: string): Promise<Buffer | null> {
  let pending = inFlight.get(hash);
  if (!pending) {
    pending = (async () => {
      const clip = await db.query.audioClips.findFirst({ where: eq(audioClips.hash, hash) });
      if (!clip) return null;
      const made = await produce(clip);
      await put(blobPath(hash), made.audio, {
        access: "private",
        contentType: "audio/mpeg",
        allowOverwrite: true,
      });
      await db
        .update(audioClips)
        .set({
          status: made.faults === 0 ? "verified" : "flagged",
          heard: made.heard,
          instructions: made.instructions,
          attempts: made.attempts,
        })
        .where(eq(audioClips.hash, hash));
      return made.audio;
    })().finally(() => inFlight.delete(hash));
    inFlight.set(hash, pending);
  }
  return pending;
}

/** The clip's mp3, made and stored the first time it is asked for. Null if unregistered. */
export async function getClipAudio(hash: string): Promise<Buffer | null> {
  const stored = await get(blobPath(hash), { access: "private" });
  if (stored?.statusCode === 200) return Buffer.from(await new Response(stored.stream).arrayBuffer());
  return makeClipAudio(hash);
}
