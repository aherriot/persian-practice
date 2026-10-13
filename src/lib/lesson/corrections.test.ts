import assert from "node:assert/strict";
import { test } from "node:test";
import type { SentenceToken } from "../db/schema.ts";
import { editSentence, editWord, replay, respell, sentenceProblems, wordProblems, type Recorded, type WordEdit } from "./corrections.ts";
import { applyForm } from "./forms.ts";
import type { Lexeme, Sentence } from "./types.ts";

const word = (id: string, fa: string, voc: string, translit: string, extra: Partial<Lexeme> = {}): Lexeme => ({
  id,
  fa,
  voc,
  translit,
  gloss: id,
  lemma: null,
  literary: null,
  note: null,
  subjectPronoun: null,
  verbPerson: null,
  ownerId: null,
  addedBy: null,
  ...extra,
});

const CARROT = word("carrot", "هویج", "هُویج", "hovij");
const HAVE = word("have", "دارم", "دارَم", "dâram", { verbPerson: "1sg" });
const base = (lexeme: Lexeme): SentenceToken => ({ lexemeId: lexeme.id, fa: lexeme.fa, voc: lexeme.voc, translit: lexeme.translit });

const sentence = (id: string, tokens: SentenceToken[], extra: Partial<Sentence> = {}): Sentence => ({
  id,
  position: 0,
  english: `english ${id}`,
  note: null,
  tokens,
  endPunct: ".",
  lexemeIds: [...new Set(tokens.map((t) => t.lexemeId))],
  patternIds: [],
  generated: false,
  ladder: true,
  ...extra,
});

const unchanged: WordEdit = { id: "carrot", fa: null, voc: null, translit: null, gloss: null, literary: null, note: null };

test("an edit changes only the fields it gives, and says what they were", () => {
  const { lexeme, changes } = editWord(CARROT, { ...unchanged, voc: "هَویج", translit: " Havij " });
  assert.equal(lexeme.voc, "هَویج");
  assert.equal(lexeme.translit, "havij");
  assert.equal(lexeme.fa, CARROT.fa);
  assert.deepEqual(changes, { voc: { from: "هُویج", to: "هَویج" }, translit: { from: "hovij", to: "havij" } });
});

test("an edit that says what is already there changes nothing", () => {
  assert.deepEqual(editWord(CARROT, { ...unchanged, translit: "hovij", gloss: "" }).changes, {});
});

test("an empty note removes it; a null one leaves it", () => {
  const noted = { ...CARROT, note: "a root vegetable" };
  assert.equal(editWord(noted, { ...unchanged, note: null }).lexeme.note, "a root vegetable");
  assert.deepEqual(editWord(noted, { ...unchanged, note: " " }).changes, { note: { from: "a root vegetable", to: null } });
});

test("a respelled word is respelled in each form it appears in", () => {
  const fixed = { ...CARROT, voc: "هَویج", translit: "havij" };
  const tokens = [applyForm(CARROT, "my")!, { ...applyForm(CARROT, "linked")!, after: "،" }, base(HAVE)];
  assert.deepEqual(respell(tokens, CARROT, fixed), [applyForm(fixed, "my")!, { ...applyForm(fixed, "linked")!, after: "،" }, base(HAVE)]);
});

test("a word written its own way in a sentence keeps what was its own", () => {
  // Hand-written: said differently here, spelled as in the dictionary.
  const odd: SentenceToken = { lexemeId: "carrot", fa: "هویج", voc: "هُویج", translit: "hovij-o" };
  const fixed = { ...CARROT, fa: "هويج" };
  assert.deepEqual(respell([odd], CARROT, fixed), [{ ...odd, fa: "هويج" }]);
});

test("a sentence edit rebuilds its words and which words it uses", () => {
  const was = sentence("s", [base(CARROT), base(HAVE)]);
  const { sentence: now, changes } = editSentence(was, {
    english: "I have it.",
    note: null,
    tokens: [{ word: "have", fa: "دارم", voc: "دارَم", translit: "dâram", comma: true }],
  });
  assert.equal(now.english, "I have it.");
  // No comma after the last word.
  assert.deepEqual(now.tokens, [base(HAVE)]);
  assert.deepEqual(now.lexemeIds, ["have"]);
  assert.deepEqual(Object.keys(changes), ["english", "tokens"]);
});

test("giving a sentence its own words back is no change", () => {
  const was = sentence("s", [{ ...base(CARROT), after: "،" }, base(HAVE)]);
  const tokens = was.tokens.map((t) => ({ word: t.lexemeId, fa: t.fa, voc: t.voc, translit: t.translit, comma: Boolean(t.after) }));
  assert.deepEqual(editSentence(was, { english: null, note: null, tokens }).changes, {});
});

test("a word's new spelling has to be Persian, with vowel marks that add no letters and a pronunciation of as many words", () => {
  const check = (edit: Partial<WordEdit>) => {
    const { lexeme, changes } = editWord(CARROT, { ...unchanged, ...edit });
    return wordProblems(lexeme, changes).length;
  };
  assert.equal(check({ voc: "هَویج", translit: "havij" }), 0);
  assert.equal(check({ fa: "havij" }), 2); // not Persian, and the vowelled form no longer matches
  assert.equal(check({ voc: "هَویچ" }), 1);
  assert.equal(check({ translit: "Havij!" }), 1);
  assert.equal(check({ translit: "ha vij" }), 1);
  // A change of meaning alone is not held to the spelling rules.
  assert.equal(wordProblems({ ...CARROT, translit: "HOVIJ", gloss: "a carrot" }, { gloss: { from: "carrot", to: "a carrot" } }).length, 0);
});

test("a sentence cannot gain a word, and one that teaches its words cannot lose one", () => {
  const was = sentence("s", [base(CARROT), base(HAVE)]);
  const tokens = { from: [], to: [] };
  const only = sentence("s", [base(HAVE)]);
  assert.equal(sentenceProblems(only, was, { tokens }).length, 1);
  assert.equal(sentenceProblems(only, { ...was, ladder: false }, { tokens }).length, 0);
  const more = sentence("s", [base(CARROT), base(HAVE), base(word("bread", "نون", "نون", "nun"))]);
  assert.match(sentenceProblems(more, was, { tokens })[0], /bread/);
  // Reordered is fine.
  assert.deepEqual(sentenceProblems(sentence("s", [base(HAVE), base(CARROT)]), was, { tokens }), []);
});

// --- Seeding again ---

const content = () => ({
  lexemes: new Map([CARROT, HAVE].map((l) => [l.id, l])),
  sentences: [sentence("s1", [base(CARROT)]), sentence("s2", [base(CARROT), base(HAVE)])],
});
const respelling: Recorded = { kind: "lexeme", refId: "carrot", changes: { voc: { from: "هُویج", to: "هَویج" }, translit: { from: "hovij", to: "havij" } } };

test("a fix to a word is put back on the word and on every sentence it is in", () => {
  const fixed = replay(content(), [respelling]);
  assert.equal(fixed.lexemes.get("carrot")!.translit, "havij");
  assert.deepEqual(fixed.sentences.map((s) => s.tokens[0].translit), ["havij", "havij"]);
  assert.equal(fixed.applied, 1);
  assert.deepEqual(fixed.skipped, []);
});

test("fixes are put back in the order they were made, each on top of the last", () => {
  const was = replay(content(), [respelling]).sentences[1].tokens;
  const reordered: Recorded = { kind: "sentence", refId: "s2", changes: { tokens: { from: was, to: [was[1], was[0]] }, english: { from: "english s2", to: "Carrots, I have." } } };
  const fixed = replay(content(), [respelling, reordered]);
  assert.deepEqual(fixed.sentences[1].tokens.map((t) => t.translit), ["dâram", "havij"]);
  assert.equal(fixed.sentences[1].english, "Carrots, I have.");
  assert.equal(fixed.applied, 2);
});

test("where the code has changed since, the code wins and the fix is reported", () => {
  const edited = content();
  edited.lexemes.set("carrot", { ...CARROT, translit: "havidj" });
  const fixed = replay(edited, [respelling]);
  assert.equal(fixed.lexemes.get("carrot")!.translit, "havidj");
  assert.deepEqual(fixed.skipped, [respelling]);
});

test("a fix the code has since caught up with is not a clash, and one for something else is ignored", () => {
  const caught = content();
  caught.lexemes.set("carrot", { ...CARROT, voc: "هَویج", translit: "havij" });
  const elsewhere: Recorded = { kind: "sentence", refId: "another-theme-001", changes: { english: { from: "a", to: "b" } } };
  const fixed = replay(caught, [respelling, elsewhere]);
  assert.deepEqual(fixed.skipped, []);
  assert.equal(fixed.applied, 1);
});

test("tokens read back from the database with their keys in another order still match", () => {
  const stored = [{ translit: "hovij", voc: "هُویج", fa: "هویج", lexemeId: "carrot" }];
  const fix: Recorded = { kind: "sentence", refId: "s1", changes: { tokens: { from: stored, to: [base(HAVE)] } } };
  const fixed = replay(content(), [fix]);
  assert.deepEqual(fixed.sentences[0].lexemeIds, ["have"]);
});
