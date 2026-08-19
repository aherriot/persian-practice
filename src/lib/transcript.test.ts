import assert from "node:assert/strict";
import { test } from "node:test";

import { assessTranscript } from "./transcript.ts";

test("accepts ordinary Persian", () => {
  const check = assessTranscript("یه چایی می‌خوام");
  assert.equal(check.verdict, "ok");
  assert.ok(check.usable);
  assert.ok(check.persianChars > 5);
});

test("accepts short one-word answers", () => {
  // These must survive: a beginner answering بله or نه is the common case, and
  // rejecting them would make the app feel broken exactly when it is working.
  for (const word of ["بله", "نه", "آره", "چایی"]) {
    assert.equal(assessTranscript(word).verdict, "ok", `${word} should be accepted`);
  }
});

test("rejects romanised output, which is what recognition failure looks like", () => {
  // Verbatim from FINDINGS §9 — the recogniser dropping out of Persian entirely
  // despite language: "fa" being set.
  const check = assessTranscript("michel dotrice war am theater bekannt");
  assert.equal(check.verdict, "romanised");
  assert.ok(!check.usable);

  assert.equal(assessTranscript("man tirus bazar mea").verdict, "romanised");
  assert.equal(assessTranscript("mashine ma kermes").verdict, "romanised");
});

test("keeps Persian containing incidental Latin", () => {
  // Brand names and loanwords are normal; only a total absence of Persian is
  // evidence of failure.
  assert.equal(assessTranscript("یه Coca Cola می‌خوام").verdict, "ok");
  assert.equal(assessTranscript("ساعت ۸ صبح").verdict, "ok");
});

test("rejects empty and whitespace", () => {
  assert.equal(assessTranscript("").verdict, "empty");
  assert.equal(assessTranscript("   ").verdict, "empty");
  assert.equal(assessTranscript("\n\t").verdict, "empty");
});

test("rejects a single stray character", () => {
  assert.equal(assessTranscript("ا").verdict, "too-short");
  assert.equal(assessTranscript("؟").verdict, "too-short", "punctuation alone is not speech");
});

test("counts ZWNJ as Persian rather than as noise", () => {
  const check = assessTranscript("می‌رم");
  assert.equal(check.verdict, "ok");
  assert.ok(check.persianChars >= 5);
});
