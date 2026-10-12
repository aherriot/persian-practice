import { del, get, list, put } from "@vercel/blob";
import { and, eq, isNull } from "drizzle-orm";
import { VOICE_INSTRUCTION, type ClipSpec } from "@/lib/audio-key";
import { listen, ListenerReplyError } from "@/lib/audio-verify";
import { db } from "@/lib/db";
import { audioClips, audioReviews } from "@/lib/db/schema";
import { openai } from "@/lib/openai";
import { OPENAI_TTS_MODEL, SELECTED_TTS } from "@/lib/tts-provider";

// The mp3s live in a private Vercel Blob store, one object per clip hash. The
// database records what each hash should say, so a missing object can be made
// on demand.
const PREFIX = "audio/";
const blobPath = (hash: string) => `${PREFIX}${hash}.mp3`;
// Rejected takes, one per review. Not under PREFIX, so never swept as orphans.
const REVIEWED_PREFIX = "reviewed/";

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

// Every attempt uses the voice instruction. An earlier fallback that named the
// failing word instead ("The word X must be pronounced Y") did get the word
// right, but it replaces the voice instruction and the accent went with it
// (FINDINGS §14). A retry costs less than a clip that teaches the wrong vowel.
const MAX_ATTEMPTS = 6;
/**
 * A candidate must pass this many separate listens. The listener never passed
 * a mispronounced clip twice in FINDINGS §13, but did reject good ones — the
 * cheap direction to be wrong in, since a rejection only costs another attempt.
 */
const LISTENS = 2;

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

async function judge(audio: Buffer, expected: string[]): Promise<{ heard: string; faults: number }> {
  let last = { heard: "", faults: 0 };
  for (let i = 0; i < LISTENS; i++) {
    // A listener that will not answer (it does this on very short clips) has
    // not passed the take; it must not abandon the remaining attempts either.
    const verdict = await listen(audio, expected).catch((err) => {
      if (err instanceof ListenerReplyError) return null;
      throw err;
    });
    if (!verdict) return { heard: "", faults: expected.length + 1 };
    last = {
      heard: verdict.heard.join(" "),
      faults: verdict.pass ? 0 : Math.max(1, verdict.wrong.length + (verdict.pause ? 1 : 0)),
    };
    if (!verdict.pass) break;
  }
  return last;
}

async function produce(clip: { text: string; expected: string }): Promise<Candidate> {
  const expected = clip.expected.split(/\s+/);
  let best: Candidate | null = null;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const audio = await synthesise(clip.text, VOICE_INSTRUCTION);
    const result = await judge(audio, expected);
    if (!best || result.faults < best.faults) {
      best = { audio, instructions: VOICE_INSTRUCTION, heard: result.heard, faults: result.faults, attempts: attempt };
    }
    best.attempts = attempt;
    if (result.faults === 0) break;
  }
  return best!;
}

// --- Words that cannot be said alone ---
//
// Some words only have their spoken form between other words: و is "o" after
// a noun and "va" on its own, and the speech model is right to say "va" for a
// bare و. No number of retries fixes that. Such a word is played inside a
// sentence that is already verified, using that sentence's stored audio.
// (Cutting the sentence down to the word and its neighbours does not work:
// «هویج و سیب» with no verb was read "va" six times out of six, FINDINGS §15.)

type Take = Candidate & { carrier: string | null };

/** The stored audio of a verified sentence that has the word: one a person approved if there is one, else the shortest. */
async function carrierFor(clip: { expected: string; carrier: string | null }): Promise<Take | null> {
  const sentences = await db
    .select()
    .from(audioClips)
    .where(and(eq(audioClips.status, "verified"), isNull(audioClips.carrier)));
  const length = (expected: string) => expected.split(/\s+/).length;
  const candidates = sentences
    .filter((sentence) => length(sentence.expected) > 1 && sentence.expected.split(/\s+/).includes(clip.expected))
    .sort(
      (a, b) =>
        // The sentence in use now goes last, so a rejected one is not simply handed back.
        Number(a.expected === clip.carrier) - Number(b.expected === clip.carrier) ||
        Number(!a.approvedAt) - Number(!b.approvedAt) ||
        length(a.expected) - length(b.expected),
    );
  for (const sentence of candidates) {
    const audio = await readStored(sentence.hash);
    if (audio) {
      return {
        audio,
        instructions: sentence.instructions ?? VOICE_INSTRUCTION,
        heard: sentence.heard ?? "",
        faults: 0,
        attempts: 0,
        carrier: sentence.expected,
      };
    }
  }
  return null;
}

/** The take to store: the clip's own words, or for a lone word that will not come out right, a sentence it is in. */
async function take(clip: { text: string; expected: string; carrier: string | null }): Promise<Take> {
  const lone = !/\s/.test(clip.expected);
  // Once a word is known not to work alone, it is not tried alone again.
  const alone = lone && clip.carrier ? null : await produce(clip);
  if (alone && (alone.faults === 0 || !lone)) return { ...alone, carrier: null };
  return (await carrierFor(clip)) ?? { ...(alone ?? (await produce(clip))), carrier: null };
}

/** Made with an instruction the pipeline no longer uses. */
export const isStale = (clip: { instructions: string | null }) =>
  clip.instructions !== null && clip.instructions !== VOICE_INSTRUCTION;

async function readStored(hash: string): Promise<Buffer | null> {
  const stored = await get(blobPath(hash), { access: "private" });
  return stored?.statusCode === 200 ? Buffer.from(await new Response(stored.stream).arrayBuffer()) : null;
}

// Two requests for the same clip (the player and the preloader, say) share one
// run instead of paying for it twice.
const inFlight = new Map<string, Promise<Buffer | null>>();

/**
 * Makes the clip's audio and stores it. Null if unregistered.
 *
 * Stored audio is never made worse by a remake:
 * - a clip a person approved is pinned, and is returned as it is;
 * - otherwise a new take replaces the stored one only if it passes the
 *   listener (the lone word و went from "o" to "va" by an unconditional
 *   overwrite, FINDINGS §14).
 * `replace` is for a take a person has just rejected: any new take is stored.
 */
export function makeClipAudio(hash: string, { replace = false } = {}): Promise<Buffer | null> {
  const key = `${hash}:${replace}`;
  let pending = inFlight.get(key);
  if (!pending) {
    pending = (async () => {
      const clip = await db.query.audioClips.findFirst({ where: eq(audioClips.hash, hash) });
      if (!clip) return null;
      if (clip.approvedAt) {
        const stored = await readStored(hash);
        if (stored) return stored;
      }
      const made = await take(clip);
      if (made.faults > 0 && clip.status !== null && !replace) {
        const stored = await readStored(hash);
        if (stored) return stored;
      }
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
          carrier: made.carrier,
          approvedAt: null,
        })
        .where(eq(audioClips.hash, hash));
      return made.audio;
    })().finally(() => inFlight.delete(key));
    inFlight.set(key, pending);
  }
  return pending;
}

// --- A person's verdict ---

export const REVIEW_REASONS = ["word", "accent", "pause", "other"] as const;
export type ReviewReason = (typeof REVIEW_REASONS)[number];

export type Review =
  | { verdict: "approved" }
  | { verdict: "rejected"; reason: ReviewReason; note: string | null };

/**
 * Records what a person thought of the stored take. Approving pins it.
 * Rejecting keeps the take as a labelled bad example, then makes a new one.
 * Null if the clip is unregistered or has no audio yet.
 */
export async function reviewClip(
  hash: string,
  userId: string,
  review: Review,
): Promise<{ status: "verified" | "flagged" | null; approved: boolean } | null> {
  const clip = await db.query.audioClips.findFirst({ where: eq(audioClips.hash, hash) });
  const audio = clip && (await readStored(hash));
  if (!clip || !audio) return null;

  const [{ id }] = await db
    .insert(audioReviews)
    .values({
      hash,
      userId,
      verdict: review.verdict,
      reason: review.verdict === "rejected" ? review.reason : null,
      note: review.verdict === "rejected" ? review.note : null,
      instructions: clip.instructions,
      heard: clip.heard,
      listenerStatus: clip.status,
    })
    .returning({ id: audioReviews.id });

  if (review.verdict === "approved") {
    await db.update(audioClips).set({ approvedAt: new Date() }).where(eq(audioClips.hash, hash));
    return { status: clip.status, approved: true };
  }

  await put(`${REVIEWED_PREFIX}${id}.mp3`, audio, { access: "private", contentType: "audio/mpeg" });
  await db.update(audioClips).set({ approvedAt: null }).where(eq(audioClips.hash, hash));
  await makeClipAudio(hash, { replace: true });
  const remade = await db.query.audioClips.findFirst({ where: eq(audioClips.hash, hash) });
  return { status: remade?.status ?? null, approved: false };
}

/** The clip's mp3, made and stored the first time it is asked for. Null if unregistered. */
export async function getClipAudio(hash: string): Promise<Buffer | null> {
  return (await readStored(hash)) ?? makeClipAudio(hash);
}

/** Registers a clip and makes its audio now. True if the listener accepted it. */
export async function makeVerifiedClip(spec: ClipSpec): Promise<boolean> {
  await registerClips([spec]);
  const existing = await db.query.audioClips.findFirst({ where: eq(audioClips.hash, spec.hash) });
  if (!existing?.status) await makeClipAudio(spec.hash);
  const clip = existing?.status ? existing : await db.query.audioClips.findFirst({ where: eq(audioClips.hash, spec.hash) });
  return clip?.status === "verified";
}
