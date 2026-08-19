import assert from "node:assert/strict";
import { test } from "node:test";

import {
  ZWNJ,
  alignTokens,
  equalsPersian,
  normalizeForCompare,
  normalizePersian,
  tokenize,
  toCodepoints,
  wordErrorRate,
} from "./normalize.ts";

test("folds Arabic letter forms to their Persian equivalents", () => {
  // Arabic kaf U+0643 and yeh U+064A vs Persian keheh U+06A9 and farsi yeh U+06CC.
  assert.equal(normalizePersian("كتاب"), "کتاب");
  assert.equal(normalizePersian("مي‌روم"), "می" + ZWNJ + "روم");
  assert.equal(normalizePersian("علی"), "علی");
});

test("folds both Arabic-Indic and Persian digit forms to ASCII", () => {
  assert.equal(normalizePersian("۸"), "8");
  assert.equal(normalizePersian("٨"), "8");
  assert.equal(normalizePersian("۳۵ سالمه"), "35 سالمه");
});

test("strips harakat and tatweel", () => {
  // كِتاب with a kasra, plus a tatweel-stretched form.
  assert.equal(normalizePersian("كِتاب"), "کتاب");
  assert.equal(normalizePersian("کتـــاب"), "کتاب");
});

test("normalizePersian preserves ZWNJ; normalizeForCompare removes it", () => {
  const withZwnj = "می" + ZWNJ + "رم";
  assert.ok(normalizePersian(withZwnj).includes(ZWNJ));
  assert.equal(normalizeForCompare(withZwnj), "میرم");
});

test("equalsPersian treats spelling variants of the same word as equal", () => {
  assert.ok(equalsPersian("می" + ZWNJ + "رم", "میرم"));
  assert.ok(equalsPersian("كتاب را خواندم", "کتاب را خواندم"));
  assert.ok(equalsPersian("سلام، خوبی؟", "سلام خوبی"));
  assert.ok(!equalsPersian("رفتم", "می" + ZWNJ + "رم"));
});

test("tokenize drops punctuation and collapses whitespace", () => {
  assert.deepEqual(tokenize("سلام،   خوبی؟"), ["سلام", "خوبی"]);
    assert.deepEqual(tokenize("   "), []);
});

test("word error rate counts substitutions, deletions and insertions", () => {
  assert.equal(wordErrorRate("a b c", "a b c").wer, 0);

  const sub = wordErrorRate("a b c", "a x c");
  assert.equal(sub.substitutions, 1);
  assert.equal(sub.wer, 1 / 3);

  const del = wordErrorRate("a b c", "a c");
  assert.equal(del.deletions, 1);
  assert.equal(del.wer, 1 / 3);

  const ins = wordErrorRate("a b c", "a b x c");
  assert.equal(ins.insertions, 1);
  assert.equal(ins.wer, 1 / 3);
});

test("the planted past-tense error is measurably nearer to what was said", () => {
  // The judgement the whole Phase 0B probe rests on: a transcript that keeps the
  // learner's wrong tense must score closer to `said` than to the repaired form.
  const said = "من دیروز بازار می" + ZWNJ + "رم";
  const repaired = "من دیروز بازار رفتم";

  assert.ok(wordErrorRate(said, said).wer < wordErrorRate(repaired, said).wer);
  assert.ok(wordErrorRate(repaired, repaired).wer < wordErrorRate(said, repaired).wer);
});

test("alignTokens produces a renderable edit script", () => {
  const ops = alignTokens("a b c", "a x c");
  assert.deepEqual(
    ops.map((o) => o.op),
    ["eq", "sub", "eq"],
  );
});

test("toCodepoints shows logical order for terminals lacking bidi", () => {
  // Guards against the failure that made this helper necessary: Persian looking
  // reversed in the terminal and being misread as corrupted data.
  assert.equal(toCodepoints("سلام").split(" ")[0], "س(U+0633)");
  assert.ok(toCodepoints("می" + ZWNJ + "رم").includes("‹ZWNJ›"));
});
