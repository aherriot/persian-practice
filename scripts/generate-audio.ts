/**
 * Makes audio for every registered clip that has none, so nothing is
 * synthesised mid-lesson. Each clip is checked by the automated listener and
 * retried until it passes; the ones that never pass are stored anyway and
 * listed at the end as flagged, for a human to listen to.
 *
 * Usage: npm run db:audio              make what is missing
 *        npm run db:audio -- --retry   also try the flagged clips again
 * (after npm run db:seed; needs BLOB_READ_WRITE_TOKEN)
 */
import "./load-env.ts";

import { isStale } from "../src/lib/audio-key.ts";
import { deleteOrphanedAudio, makeClipAudio } from "../src/lib/audio-store.ts";
import { db } from "../src/lib/db/index.ts";
import { audioClips } from "../src/lib/db/schema.ts";
import { createThrottle, isDailyQuota, isRateLimit, sleep } from "../src/lib/throttle.ts";

const WORKERS = 3;
const MIN_INTERVAL_MS = 400;
const MAX_TRIES = 4;

async function main() {
  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    console.error("BLOB_READ_WRITE_TOKEN is not set. Add it to .env.local (see .env.example).");
    process.exitCode = 1;
    return;
  }
  const retryFlagged = process.argv.includes("--retry");

  const registered = await db.select().from(audioClips);
  // A clip made with an instruction or spelling the pipeline no longer uses is made again.
  // One a person has approved is left alone whatever else is true of it.
  const todo = registered.filter(
    (clip) =>
      clip.status === null || (!clip.approvedAt && (isStale(clip) || (retryFlagged && clip.status === "flagged"))),
  );
  console.log(`Making audio for ${todo.length} of ${registered.length} clips…`);

  const gate = createThrottle(MIN_INTERVAL_MS);
  // Sentences first: a word that cannot be said alone borrows the audio of one made the current way.
  const words = (clip: { expected: string }) => clip.expected.split(/\s+/).length;
  const queue = [...todo].sort((a, b) => Number(words(a) === 1) - Number(words(b) === 1));
  const failed: string[] = [];
  let done = 0;
  let aborted = false;

  async function worker() {
    for (let clip = queue.shift(); clip && !aborted; clip = queue.shift()) {
      for (let attempt = 1; ; attempt++) {
        try {
          await gate();
          await makeClipAudio(clip.hash);
          done++;
          break;
        } catch (err) {
          if (isDailyQuota(err)) {
            aborted = true;
            console.error("Daily quota reached — stopping. Re-run later to finish.");
            break;
          }
          if (isRateLimit(err) && attempt < MAX_TRIES) {
            await sleep(2000 * attempt);
            continue;
          }
          failed.push(`${clip.text}: ${err instanceof Error ? err.message : String(err)}`);
          break;
        }
      }
    }
  }

  await Promise.all(Array.from({ length: WORKERS }, worker));
  if (todo.length > 0) console.log(`${done} of ${todo.length} clips made.`);

  const after = await db.select().from(audioClips);
  const verified = after.filter((clip) => clip.status === "verified");
  const flagged = after.filter((clip) => clip.status === "flagged" && !clip.approvedAt);
  const approved = after.filter((clip) => clip.approvedAt).length;
  const firstTry = verified.filter((clip) => clip.attempts === 1).length;
  console.log(`\n${verified.length} verified (${firstTry} on the first attempt), ${flagged.length} flagged, ${approved} approved by ear.`);
  for (const clip of after.filter((clip) => clip.carrier)) {
    console.log(`  in use   ${clip.expected}  — played inside "${clip.carrier}", not alone  (${clip.text})`);
  }
  for (const clip of flagged) {
    console.log(`  flagged  ${clip.expected}  — heard: ${clip.heard}  (${clip.text})`);
  }

  // A remake that failed the listener leaves the old audio in place; say so.
  for (const clip of after.filter((clip) => isStale(clip) && !clip.approvedAt)) {
    console.log(`  kept     ${clip.expected}  — old audio, made a way no longer used; no remake passed  (${clip.text})`);
  }

  const orphans = await deleteOrphanedAudio();
  if (orphans > 0) console.log(`Deleted ${orphans} stored clips that are no longer registered.`);

  if (failed.length > 0) console.error(`Failed:\n  ${failed.join("\n  ")}`);
  if (failed.length > 0 || aborted) process.exitCode = 1;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
