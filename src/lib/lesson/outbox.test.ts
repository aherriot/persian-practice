import assert from "node:assert/strict";
import { test } from "node:test";
import { createOutbox, retryPause, type OutboxEntry, type OutboxOptions, type SendOutcome } from "./outbox.ts";

const tick = () => new Promise((resolve) => setImmediate(resolve));

function memoryStorage(initial?: string) {
  const data = new Map<string, string>(initial === undefined ? [] : [["box", initial]]);
  return {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => void data.set(key, value),
    stored: () => JSON.parse(data.get("box") ?? "[]") as OutboxEntry[],
  };
}

/** An outbox whose server and clock the test controls. Pauses between attempts end only when `hurry` is called. */
function harness(outcomes: (SendOutcome | Error)[], overrides: Partial<OutboxOptions> = {}) {
  const storage = memoryStorage();
  const sent: OutboxEntry[] = [];
  const pauses: number[] = [];
  let hurry = () => {};
  let n = 0;
  const outbox = createOutbox({
    storage,
    storageKey: "box",
    send: async (entry) => {
      sent.push(entry);
      const outcome = outcomes.shift() ?? "sent";
      if (outcome instanceof Error) throw outcome;
      return outcome;
    },
    wait: (ms, onHurry) =>
      new Promise((resolve) => {
        pauses.push(ms);
        hurry = resolve;
        onHurry(resolve);
      }),
    now: () => 1_000_000,
    newKey: () => `key-${++n}`,
    ...overrides,
  });
  return { outbox, storage, sent, pauses, hurry: () => hurry() };
}

test("entries are sent one at a time, in the order they were added", async () => {
  const { outbox, sent, storage } = harness([]);
  outbox.add({ introduce: "sib" });
  outbox.add({ answer: 1 });
  outbox.add({ answer: 2 });
  assert.equal(outbox.status().pending, 3);
  assert.equal(sent.length, 1, "the second waits for the first");
  await tick();
  assert.deepEqual(sent.map((e) => e.body), [{ introduce: "sib" }, { answer: 1 }, { answer: 2 }]);
  assert.deepEqual(sent.map((e) => e.key), ["key-1", "key-2", "key-3"]);
  assert.deepEqual(outbox.status(), { pending: 0, failing: false });
  assert.deepEqual(storage.stored(), []);
});

test("a failed entry is retried with the same key, and holds back everything behind it", async () => {
  const { outbox, sent, pauses, hurry, storage } = harness(["retry", new Error("offline"), "sent"]);
  outbox.add({ introduce: "sib" });
  outbox.add({ answer: 1 });
  await tick();
  assert.deepEqual(sent.map((e) => e.key), ["key-1"]);
  assert.deepEqual(outbox.status(), { pending: 2, failing: false }, "one failure is not announced");
  assert.equal(storage.stored().length, 2);

  hurry();
  await tick();
  assert.deepEqual(sent.map((e) => e.key), ["key-1", "key-1"]);
  assert.deepEqual(outbox.status(), { pending: 2, failing: true });

  hurry();
  await tick();
  assert.deepEqual(sent.map((e) => e.key), ["key-1", "key-1", "key-1", "key-2"]);
  assert.deepEqual(outbox.status(), { pending: 0, failing: false });
  assert.deepEqual(pauses, [1000, 2000]);
});

test("the pause between attempts doubles, up to half a minute", () => {
  assert.deepEqual([1, 2, 3, 4, 5, 6, 7].map(retryPause), [1000, 2000, 4000, 8000, 16000, 30000, 30000]);
});

test("an entry the server refuses is dropped, and the rest carry on", async () => {
  const { outbox, sent } = harness(["refused", "sent"]);
  outbox.add({ answer: "malformed" });
  outbox.add({ answer: 2 });
  await tick();
  assert.equal(sent.length, 2);
  assert.equal(outbox.status().pending, 0);
});

test("flush cuts a pause short", async () => {
  const { outbox, sent } = harness(["retry", "sent"]);
  outbox.add({ answer: 1 });
  await tick();
  assert.equal(sent.length, 1);
  outbox.flush();
  await tick();
  assert.equal(sent.length, 2);
  assert.equal(outbox.status().pending, 0);
});

test("entries left in storage by an earlier page are sent by the next one, unless they are stale", async () => {
  const day = 24 * 60 * 60 * 1000;
  const left = [
    { key: "old", at: 1_000_000 - 2 * day, body: { answer: 0 } },
    { key: "recent", at: 1_000_000 - 60_000, body: { answer: 1 } },
  ];
  const storage = memoryStorage(JSON.stringify(left));
  const { outbox, sent } = harness([], { storage });
  assert.equal(outbox.status().pending, 1);
  assert.equal(sent.length, 0, "nothing is sent until asked");
  outbox.flush();
  await tick();
  assert.deepEqual(sent.map((e) => e.key), ["recent"]);
  assert.deepEqual(storage.stored(), []);
});

test("unreadable or missing storage is treated as empty and does not stop the queue", async () => {
  const broken = harness([], { storage: memoryStorage("{not json") });
  assert.equal(broken.outbox.status().pending, 0);
  const none = harness([], { storage: null });
  none.outbox.add({ answer: 1 });
  await tick();
  assert.equal(none.sent.length, 1);
});

test("drained waits for the queue to empty, but not for ever", async () => {
  const empty = harness([]);
  assert.equal(await empty.outbox.drained(10), true);

  const quick = harness(["retry", "sent"]);
  quick.outbox.add({ answer: 1 });
  await tick();
  assert.equal(await quick.outbox.drained(1000), true, "and hurries the retry along");

  const stuck = harness(["retry", "retry", "retry"]);
  stuck.outbox.add({ answer: 1 });
  await tick();
  assert.equal(await stuck.outbox.drained(20), false);
});

test("subscribers hear about every change in what is pending or failing", async () => {
  const { outbox } = harness(["retry", "retry", "sent"]);
  const seen: string[] = [];
  const unsubscribe = outbox.subscribe(() => seen.push(JSON.stringify(outbox.status())));
  outbox.add({ answer: 1 });
  await tick();
  outbox.flush();
  await tick();
  outbox.flush();
  await tick();
  unsubscribe();
  assert.deepEqual(seen, ['{"pending":1,"failing":false}', '{"pending":1,"failing":true}', '{"pending":0,"failing":false}']);
});
