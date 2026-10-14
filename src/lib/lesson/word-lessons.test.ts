// Lessons for a word the learner added: checking the author's draft, and
// storing what survives, against a real Postgres (PGlite). No model is called.
import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";
import { eq } from "drizzle-orm";
import { closeTestDb, createTestDb, emptyTestDb, type TestDb } from "../db/test-db.ts";
import { lexemes, sentences, users } from "../db/schema.ts";
import type { WordLessons } from "./author.ts";
import type { Lexeme } from "./types.ts";

let db: TestDb;
let lessons: typeof import("./word-lessons.ts");
let words: typeof import("./words.ts");

before(async () => {
  // The modules build an OpenAI client on import; nothing here calls it.
  process.env.OPENAI_API_KEY ??= "not-used";
  db = await createTestDb();
  // Only now: these import the database, which must already be the test one.
  lessons = await import("./word-lessons.ts");
  words = await import("./words.ts");
});
after(() => closeTestDb(db));

const ME = "learner-me";
const lexeme = (id: string, fa: string, translit: string, gloss: string, extra: Partial<Lexeme> = {}): Lexeme => ({
  id, fa, voc: fa, translit, gloss, lemma: null, literary: null, note: null, subjectPronoun: null, verbPerson: null, ownerId: null, addedBy: null, ...extra,
});
const I = lexeme("man", "من", "man", "I", { subjectPronoun: "1sg" });
const LIKE = lexeme("dust-daram", "دوست دارم", "dust dâram", "I like", { verbPerson: "1sg" });
const YOU = lexeme("to", "تو", "to", "you", { subjectPronoun: "2sg" });
const FOOTBALL = lexeme("own-football", "فوتبال", "futbâl", "football", { ownerId: ME, addedBy: "learner" });

const entry = (fa: string, translit: string, gloss: string) => ({
  fa, voc: fa, translit, gloss, literary: null, lemma: null, verbPerson: "1sg" as const, subjectPronoun: null, note: null, why: "",
});
const PLAY = entry("بازی می‌کنم", "bâzi mikonam", "I play");
const WATCH = entry("نگاه می‌کنم", "negâh mikonam", "I watch");
const say = (english: string, ...ids: string[]) => ({
  english,
  kind: "statement" as const,
  tokens: ids.map((word) => ({ word, form: "base" as const, comma: false })),
});

const course = {
  lexemes: new Map([I, LIKE, YOU, FOOTBALL].map((l) => [l.id, l])),
  known: new Set([I.id, LIKE.id, YOU.id]),
  patterns: new Set<string>(),
};
const check = (drafted: WordLessons) => lessons.checkLessons(ME, FOOTBALL, drafted, course);

test("a word the learner's word needs is brought in by the sentence that first uses it, then practised", () => {
  const draft = check({
    companions: [PLAY],
    sentences: [say("I like football.", "own-football", "dust-daram"), say("I play football.", "man", "own-football", "NEW1"), say("Football, I play.", "own-football", "NEW1")],
  });
  assert.deepEqual(draft.rejected, []);
  assert.deepEqual(
    draft.candidates.map((c) => [c.sentence.english, c.word?.fa ?? null]),
    [["I like football.", null], ["I play football.", "بازی می‌کنم"], ["Football, I play.", null]],
  );
  assert.equal(draft.candidates[1].word!.ownerId, ME);
  assert.equal(draft.candidates[1].word!.addedBy, "app");
});

test("a sentence may not use a companion before the one that brings it in, nor bring in two", () => {
  const draft = check({
    companions: [PLAY, WATCH],
    sentences: [say("I play and watch football.", "own-football", "NEW1", "NEW2"), say("I watch football.", "own-football", "NEW2"), say("I play football.", "own-football", "NEW1")],
  });
  assert.deepEqual(draft.rejected.map((r) => r.reason), ["brings in more than one new word"]);
  assert.deepEqual(draft.candidates.map((c) => c.word?.translit), ["negâh mikonam", "bâzi mikonam"]);
});

test("sentences that leave out the word, or use words the learner cannot have, are dropped", () => {
  const draft = check({
    companions: [],
    sentences: [say("I like you.", "man", "dust-daram", "to"), say("I like football a lot.", "own-football", "dust-daram", "kheyli")],
  });
  assert.deepEqual(draft.rejected.map((r) => r.reason), ["does not use the word", 'unknown word "kheyli"']);
  assert.deepEqual(draft.candidates, []);
});

test("a companion already in the course is not added again, and sentences that need it go", () => {
  const draft = check({ companions: [entry("دوست دارم", "dust dâram", "I like")], sentences: [say("I like football.", "own-football", "NEW1")] });
  assert.deepEqual(draft.rejected.map((r) => r.reason), ["already in the course", 'unknown word "NEW1"']);
});

test("the level follows how much the learner has met and how well", () => {
  const progress = (known: number, mature: number) => ({ known, secure: known, mature, remaining: 0 });
  assert.equal(lessons.levelOf(progress(10, 10), []).stage, "beginner");
  assert.equal(lessons.levelOf(progress(80, 70), []).stage, "intermediate");
  assert.equal(lessons.levelOf(progress(200, 60), []).stage, "intermediate");
  assert.equal(lessons.levelOf(progress(200, 150), ["Questions"]).stage, "advanced");
});

beforeEach(async () => {
  await emptyTestDb(db);
  await db.insert(users).values({ id: ME, email: "me@example.com" });
  await db.insert(lexemes).values([I, LIKE, YOU]);
});

const passes = async () => true;

test("a lesson that brings in a word goes on the learner's ladder, after their word, with that word", async () => {
  const id = await words.addWord(ME, { fa: "فوتبال", voc: "فوتبال", translit: "futbâl", gloss: "football", literary: null, lemma: null, verbPerson: null, subjectPronoun: null, note: null });
  const [football] = await db.select().from(lexemes).where(eq(lexemes.id, id));
  const draft = lessons.checkLessons(ME, football as Lexeme, { companions: [PLAY], sentences: [say("I play football.", "man", id, "NEW1"), say("You play football?", "to", id, "NEW1")] }, {
    ...course,
    lexemes: new Map([...course.lexemes, [id, football as Lexeme]]),
  });
  // "You play" with "I play" is wrong Persian, but the checks here are mechanical: that is the reviewer's to catch.
  for (const candidate of draft.candidates) assert.ok("added" in (await lessons.storeLesson(ME, candidate, passes)));

  const theme = await db.select().from(sentences).where(eq(sentences.themeId, words.myWordsThemeId(ME)));
  const ladder = theme.filter((s) => s.ladder).sort((a, b) => a.position - b.position);
  assert.deepEqual(ladder.map((s) => s.english), ["Football.", "I play football."]);
  const play = await db.select().from(lexemes).where(eq(lexemes.fa, "بازی می‌کنم"));
  assert.equal(play.length, 1);
  const practice = await db.select().from(sentences).where(eq(sentences.ladder, false));
  assert.deepEqual(practice.map((s) => s.english), ["You play football?"]);
});

test("a practice lesson whose new word was not kept is dropped", async () => {
  const id = await words.addWord(ME, { fa: "فوتبال", voc: "فوتبال", translit: "futbâl", gloss: "football", literary: null, lemma: null, verbPerson: null, subjectPronoun: null, note: null });
  const [football] = await db.select().from(lexemes).where(eq(lexemes.id, id));
  const draft = lessons.checkLessons(ME, football as Lexeme, { companions: [PLAY], sentences: [say("I play football.", "man", id, "NEW1"), say("Football, I play.", id, "NEW1")] }, {
    ...course,
    lexemes: new Map([...course.lexemes, [id, football as Lexeme]]),
  });
  // The reviewer turned down the sentence that brought in "I play".
  const result = await lessons.storeLesson(ME, draft.candidates[1], passes);
  assert.deepEqual(result, { rejected: { text: "فوتبال بازی می‌کنم.", reason: "a word it needs was not kept" } });
});
