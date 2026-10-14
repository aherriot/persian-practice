import assert from "node:assert/strict";
import { test } from "node:test";

import { clipSpec, isStale, spokenText, VOICE_INSTRUCTION, wordClip } from "./audio-key.ts";

test("the speech model is given ق wherever the text has غ", () => {
  assert.equal(spokenText("غذا می‌خوام."), "قذا می‌خوام.");
  assert.equal(spokenText("چایی داغه."), "چایی داقه.");
  assert.equal(spokenText("قهوه با شیر می‌خوام."), "قهوه با شیر می‌خوام.");
});

test("a clip is still known by the text that is shown", () => {
  assert.equal(wordClip({ fa: "غذا", translit: "ghazâ" }).text, "غذا.");
  assert.notEqual(clipSpec("غذا.", "ghazâ").hash, clipSpec("قذا.", "ghazâ").hash);
});

test("a clip is stale once the instruction or the spelling it was made with is no longer used", () => {
  const made = { text: "غذا.", instructions: VOICE_INSTRUCTION, spoken: "قذا." };
  assert.equal(isStale(made), false);
  assert.equal(isStale({ ...made, spoken: null }), true, "made from the spelling shown");
  assert.equal(isStale({ ...made, instructions: "Another voice." }), true);
  assert.equal(isStale({ text: "غذا.", instructions: null, spoken: null }), false, "not made yet");
  assert.equal(isStale({ text: "سیب.", instructions: VOICE_INSTRUCTION, spoken: null }), false);
});
