import assert from "node:assert/strict";
import { test } from "node:test";

import { extractChunks } from "./clauses.ts";

/** Feeds text through in small deltas, the way a token stream arrives. */
function streamThrough(text: string, deltaSize = 5): string[] {
  const emitted: string[] = [];
  let buffer = "";
  for (let i = 0; i < text.length; i += deltaSize) {
    buffer += text.slice(i, i + deltaSize);
    const { chunks, rest } = extractChunks(buffer);
    emitted.push(...chunks);
    buffer = rest;
  }
  emitted.push(...extractChunks(buffer, { final: true }).chunks);
  return emitted;
}

test("emits a chunk once a sentence completes", () => {
  const { chunks, rest } = extractChunks("چشم، یه چایی میارم. غذا هم می‌خوری؟");
  assert.deepEqual(chunks, ["چشم، یه چایی میارم.", "غذا هم می‌خوری؟"]);
  assert.equal(rest, "");
});

test("holds back an incomplete sentence for the next delta", () => {
  const { chunks, rest } = extractChunks("چشم، یه چایی میارم. غذا هم");
  assert.deepEqual(chunks, ["چشم، یه چایی میارم."]);
  assert.equal(rest, " غذا هم");
});

test("merges a too-short opener rather than speaking it alone", () => {
  // "چشم." on its own gets its own intonation contour and sounds clipped.
  const { chunks } = extractChunks("چشم. یه چایی برات میارم الان.", { minChars: 12 });
  assert.equal(chunks.length, 1);
  assert.ok(chunks[0].startsWith("چشم."));
});

test("reassembles exactly, whatever the delta boundaries", () => {
  const reply = "حتما، یه چایی برات میارم. چیز دیگه‌ای می‌خوای؟";
  for (const size of [1, 3, 7, 50]) {
    const joined = streamThrough(reply, size).join(" ").replace(/\s+/g, " ").trim();
    assert.equal(
      joined,
      reply.replace(/\s+/g, " ").trim(),
      `delta size ${size} must not lose or duplicate text`,
    );
  }
});

test("breaks a long unpunctuated run instead of stalling audio", () => {
  const runOn = "یه چایی میارم و بعدش غذا هم میارم و بعدش صورتحساب رو هم میارم برات";
  const { chunks, rest } = extractChunks(runOn, { maxChars: 30 });
  assert.ok(chunks.length > 0, "should not wait forever for punctuation");
  assert.ok(!chunks[0].endsWith(" "), "should be trimmed");
  // Nothing is lost by the early break.
  assert.equal([...chunks, rest].join(" ").replace(/\s+/g, " ").trim(), runOn);
});

test("final flush emits the tail", () => {
  const { chunks, rest } = extractChunks("غذا هم می‌خوری", { final: true });
  assert.deepEqual(chunks, ["غذا هم می‌خوری"]);
  assert.equal(rest, "");
});

test("final flush attaches a stray fragment to the previous chunk", () => {
  const { chunks } = extractChunks("یه چایی برات میارم الان. باشه", { final: true });
  assert.equal(chunks.length, 1, "a two-word tail should not be spoken on its own");
  assert.ok(chunks[0].endsWith("باشه"));
});

test("produces nothing from empty or whitespace input", () => {
  assert.deepEqual(extractChunks("").chunks, []);
  assert.deepEqual(extractChunks("   ", { final: true }).chunks, []);
});

test("handles both Persian and Latin sentence punctuation", () => {
  const { chunks } = extractChunks("سلام خوش اومدی! چی میل داری؟ بگو.", { minChars: 4 });
  assert.deepEqual(chunks, ["سلام خوش اومدی!", "چی میل داری؟", "بگو."]);
});
