import assert from "node:assert/strict";
import { test } from "node:test";
import type { Lexeme } from "./types.ts";
import { WORKING_VOCABULARY, workingVocabulary } from "./vocabulary.ts";

const word = (n: number): Lexeme => ({
  id: `w${n}`,
  fa: `ک${n}`,
  voc: `ک${n}`,
  translit: `k${n}`,
  gloss: `word ${n}`,
  lemma: null,
  literary: null,
  note: null,
  subjectPronoun: null,
  verbPerson: null,
  ownerId: null,
  addedBy: null,
});
const words = Array.from({ length: 3000 }, (_, n) => word(n));
// The higher the number, the more sentences use the word.
const uses = new Map(words.map((w, n) => [w.id, n]));

test("a small vocabulary is shown whole", () => {
  const few = words.slice(0, WORKING_VOCABULARY);
  assert.equal(workingVocabulary(few, { uses }), few);
});

test("a large vocabulary is cut to the limit, however large", () => {
  assert.equal(workingVocabulary(words, { uses }).length, WORKING_VOCABULARY);
  assert.equal(workingVocabulary(words, { uses, limit: 40 }).length, 40);
});

test("the words asked for and the most used words are always shown", () => {
  const shown = new Set(workingVocabulary(words, { uses, must: ["w3", "w17"] }).map((w) => w.id));
  assert.ok(shown.has("w3") && shown.has("w17"));
  for (const w of words.slice(-50)) assert.ok(shown.has(w.id), `${w.id} is among the most used`);
});

test("the rest is a different draw each time, so every word gets its turn", () => {
  const ids = (shown: Lexeme[]) => shown.map((w) => w.id).join();
  assert.notEqual(ids(workingVocabulary(words, { uses })), ids(workingVocabulary(words, { uses })));
  let seed = 1;
  const fixed = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const first = ids(workingVocabulary(words, { uses, random: fixed }));
  seed = 1;
  assert.equal(ids(workingVocabulary(words, { uses, random: fixed })), first);
});
