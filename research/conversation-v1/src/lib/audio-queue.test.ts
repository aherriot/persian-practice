import assert from "node:assert/strict";
import { test } from "node:test";

import { createAudioQueue } from "./audio-queue.ts";

const later = <T,>(value: T, ms: number) =>
  new Promise<T>((resolve) => setTimeout(() => resolve(value), ms));

/** Records what was played, in the order it was played. */
function recorder() {
  const played: string[] = [];
  return {
    played,
    play: async (blob: Blob) => {
      played.push(await blob.text());
    },
  };
}

const clip = (text: string) => new Blob([text]);

test("plays in queue order even when clips resolve out of order", async () => {
  // The realistic case: clause 2's synthesis finishes before clause 1's.
  const { played, play } = recorder();
  const queue = createAudioQueue({}, play);

  queue.push(later(clip("first"), 40));
  queue.push(later(clip("second"), 5));
  queue.push(later(clip("third"), 1));
  await queue.drain();

  assert.deepEqual(played, ["first", "second", "third"]);
});

test("announces first playback once, when sound actually starts", async () => {
  const events: string[] = [];
  const queue = createAudioQueue(
    { onFirstPlay: () => events.push("first-play") },
    async (blob) => {
      events.push(`play:${await blob.text()}`);
    },
  );

  queue.push(later(clip("a"), 10));
  queue.push(Promise.resolve(clip("b")));
  await queue.drain();

  // Must fire immediately before the first clip plays, not on push — the whole
  // point is measuring when audio reaches the speakers.
  assert.deepEqual(events, ["first-play", "play:a", "play:b"]);
});

test("accepts clips pushed after playback has already started", async () => {
  const { played, play } = recorder();
  const queue = createAudioQueue({}, play);

  queue.push(later(clip("one"), 20));
  setTimeout(() => queue.push(Promise.resolve(clip("two"))), 5);
  setTimeout(() => queue.push(Promise.resolve(clip("three"))), 30);

  await later(null, 60);
  await queue.drain();

  assert.deepEqual(played, ["one", "two", "three"]);
});

test("a failed clause does not silence the rest of the sentence", async () => {
  const { played, play } = recorder();
  const errors: unknown[] = [];
  const queue = createAudioQueue({ onError: (e) => errors.push(e) }, play);

  queue.push(Promise.resolve(clip("before")));
  queue.push(Promise.reject(new Error("tts failed")));
  queue.push(Promise.resolve(clip("after")));
  await queue.drain();

  assert.deepEqual(played, ["before", "after"]);
  assert.equal(errors.length, 1);
});

test("stop halts playback of clips not yet started", async () => {
  const { played, play } = recorder();
  const queue = createAudioQueue({}, play);

  queue.push(Promise.resolve(clip("one")));
  queue.push(later(clip("two"), 30));
  queue.stop();
  await queue.drain();

  assert.ok(!played.includes("two"), "queued-but-unstarted clips must not play");
});

test("drain resolves immediately on an empty queue", async () => {
  const queue = createAudioQueue({}, async () => {});
  await queue.drain();
});
