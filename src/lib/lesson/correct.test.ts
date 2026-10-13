// Fixing a word or a sentence from inside the app, against a real Postgres
// (PGlite). The proposals are written by hand: no model is called, and no audio made.
import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";
import { eq } from "drizzle-orm";
import { wordClip } from "../audio-key.ts";
import { closeTestDb, createTestDb, emptyTestDb, type TestDb } from "../db/test-db.ts";
import { corrections, lexemes, sentences, users, type SentenceToken } from "../db/schema.ts";
import type { Proposal, Subject } from "./corrections.ts";
import { replay } from "./corrections.ts";
import { sentenceClip } from "./plan.ts";

let db: TestDb;
let correct: typeof import("./correct.ts");

before(async () => {
  db = await createTestDb();
  // Only now: correct.ts imports the database, which must already be the test one.
  correct = await import("./correct.ts");
});

const ME = "learner-me";
const OTHER = "learner-other";
const REVIEWER = { id: ME, shared: true };
const LEARNER = { id: ME, shared: false };

const CARROT = { id: "carrot", fa: "هویج", voc: "هُویج", translit: "hovij", gloss: "carrot" };
const HAVE = { id: "have", fa: "دارم", voc: "دارَم", translit: "dâram", gloss: "I have", verbPerson: "1sg" as const };
const I = { id: "i", fa: "من", voc: "مَن", translit: "man", gloss: "I", subjectPronoun: "1sg" as const };
const BREAD = { id: "bread", fa: "نون", voc: "نون", translit: "nun", gloss: "bread" };
const token = (word: { id: string; fa: string; voc: string; translit: string }): SentenceToken => ({ lexemeId: word.id, fa: word.fa, voc: word.voc, translit: word.translit });

const row = (id: string, english: string, tokens: SentenceToken[], extra: Partial<typeof sentences.$inferInsert> = {}) => ({
  id,
  themeId: null,
  position: 0,
  english,
  tokens,
  endPunct: ".",
  lexemeIds: [...new Set(tokens.map((t) => t.lexemeId))],
  ...extra,
});

beforeEach(async () => {
  await emptyTestDb(db);
  await db.insert(users).values([ME, OTHER].map((id) => ({ id, email: `${id}@example.com` })));
  await db.insert(lexemes).values([CARROT, HAVE, I, BREAD]);
  await db.insert(sentences).values([
    row("carrot-alone", "Carrot.", [token(CARROT)]),
    row("have-carrot", "I have carrots.", [token(CARROT), token(HAVE)]),
    // Written by the app, for two different learners.
    row("mine", "I have my carrot.", [{ lexemeId: "carrot", fa: "هویجم", voc: "هُویجَم", translit: "hovijam" }, token(HAVE)], { ownerId: ME, generated: true, ladder: false }),
    row("theirs", "I have carrots, I do.", [token(CARROT), token(HAVE), token(I)], { ownerId: OTHER, generated: true, ladder: false }),
    row("have-bread", "I have bread.", [token(BREAD), token(HAVE)]),
  ]);
});
after(() => closeTestDb(db));

const nothing: Proposal = { summary: "Fixed.", words: [], sentence: null, audio: null, retire: false };
const noWord = { fa: null, voc: null, translit: null, gloss: null, literary: null, note: null };
const HAVIJ: Proposal = { ...nothing, words: [{ ...noWord, id: "carrot", voc: "هَویج", translit: "havij" }] };

async function fix(editor: { id: string; shared: boolean }, subject: Subject, proposal: Proposal) {
  const loaded = await correct.loadSubject(editor.id, subject);
  assert.ok(loaded, "subject not found");
  const prepared = await correct.prepare(editor, loaded, proposal);
  if (!prepared.ok) return { problems: prepared.problems, clips: [], plan: null };
  const clips = await correct.commit(editor, loaded, "it is said havij", proposal.summary, prepared.plan);
  return { problems: [] as string[], clips, plan: prepared.plan };
}

const stored = async (id: string) => (await db.select().from(sentences).where(eq(sentences.id, id)))[0];
const translit = async (id: string) => (await stored(id)).tokens.map((t) => t.translit).join(" ");

test("a word's new pronunciation reaches every sentence it is in, whoever it was written for", async () => {
  const { problems, clips, plan } = await fix(REVIEWER, { kind: "lexeme", id: "carrot" }, HAVIJ);
  assert.deepEqual(problems, []);

  const [carrot] = await db.select().from(lexemes).where(eq(lexemes.id, "carrot"));
  assert.equal(carrot.translit, "havij");
  assert.equal(carrot.voc, "هَویج");
  assert.equal(await translit("carrot-alone"), "havij");
  assert.equal(await translit("have-carrot"), "havij dâram");
  // In the "my" form, which is made again from the new spelling.
  assert.equal(await translit("mine"), "havijam dâram");
  assert.equal(await translit("theirs"), "havij dâram man");
  assert.equal(await translit("have-bread"), "nun dâram");

  // Everything that now reads differently needs a new recording.
  // The word alone and the one-word sentence are one clip.
  assert.equal(clips.length, 4);
  assert.ok(clips.some((clip) => clip.hash === wordClip(carrot).hash));
  const mine = sentenceClip(await stored("mine")).hash;
  assert.ok(clips.some((clip) => clip.hash === mine));
  assert.ok(plan!.lines.some((line) => /4 sentences/.test(line.what)));
});

test("a fix is recorded, and seeding the old content again puts it back", async () => {
  await fix(REVIEWER, { kind: "sentence", id: "have-carrot" }, {
    ...HAVIJ,
    sentence: { english: "I have a carrot.", note: null, tokens: null },
  });
  const recorded = await db.select().from(corrections).orderBy(corrections.createdAt);
  assert.deepEqual(recorded.map((r) => [r.kind, r.refId, Object.keys(r.changes)]), [
    ["lexeme", "carrot", ["voc", "translit"]],
    ["sentence", "have-carrot", ["english"]],
  ]);
  assert.equal(recorded[0].request, "it is said havij");

  // The content as the code still has it.
  const code = {
    lexemes: new Map([{ ...CARROT, lemma: null, literary: null, note: null, subjectPronoun: null, verbPerson: null, ownerId: null, addedBy: null }].map((l) => [l.id, l])),
    sentences: [{ id: "have-carrot", english: "I have carrots.", note: null, tokens: [token(CARROT), token(HAVE)], lexemeIds: ["carrot", "have"] }],
  };
  const seeded = replay(code, recorded);
  const now = await stored("have-carrot");
  assert.equal(seeded.sentences[0].english, now.english);
  assert.deepEqual(seeded.sentences[0].tokens, now.tokens);
  assert.deepEqual(seeded.skipped, []);
});

test("a learner who is not a reviewer can fix what was written for them, and nothing shared", async () => {
  const mine = await fix(LEARNER, { kind: "sentence", id: "mine" }, { ...nothing, sentence: { english: "I have my own carrot.", note: null, tokens: null } });
  assert.deepEqual(mine.problems, []);
  assert.equal((await stored("mine")).english, "I have my own carrot.");

  // The word in it belongs to the course.
  const word = await fix(LEARNER, { kind: "sentence", id: "mine" }, HAVIJ);
  assert.match(word.problems[0], /only a reviewer/);
  const shared = await fix(LEARNER, { kind: "sentence", id: "have-carrot" }, { ...nothing, sentence: { english: "I've got carrots.", note: null, tokens: null } });
  assert.match(shared.problems[0], /only a reviewer/);
  assert.equal((await stored("have-carrot")).english, "I have carrots.");
  assert.equal(await translit("carrot-alone"), "hovij");

  // Another learner's sentence is not there to be fixed at all.
  assert.equal(await correct.loadSubject(ME, { kind: "sentence", id: "theirs" }), null);
});

test("a fix that would leave the course unsound is refused, and nothing changes", async () => {
  const refused = async (subject: Subject, proposal: Proposal, why: RegExp) => {
    const { problems } = await fix(REVIEWER, subject, proposal);
    assert.match(problems.join(" "), why);
  };
  // Two words spelled alike could not be told apart on a tile.
  await refused({ kind: "lexeme", id: "carrot" }, { ...nothing, words: [{ ...noWord, id: "carrot", fa: "نون", voc: "نون" }] }, /already the spelling/);
  // Not a word of this sentence.
  await refused({ kind: "sentence", id: "have-carrot" }, { ...nothing, words: [{ ...noWord, id: "bread", gloss: "loaf" }] }, /not a word that can be changed here/);
  // Same English as another sentence, different Persian: each would be marked right for the other.
  await refused({ kind: "sentence", id: "have-carrot" }, { ...nothing, sentence: { english: "I have bread.", note: null, tokens: null } }, /same English/);
  // Written by hand.
  await refused({ kind: "sentence", id: "have-carrot" }, { ...nothing, retire: true }, /written by hand/);

  assert.equal((await db.select().from(corrections)).length, 0);
  assert.equal((await stored("have-carrot")).english, "I have carrots.");
});

test("sentences that differ only by a pronoun the verb already implies may share their English", async () => {
  // OTHER's sentence adds "man" to "hovij dâram": giving it the English of that sentence is fine.
  const loaded = (await correct.loadSubject(OTHER, { kind: "sentence", id: "theirs" }))!;
  const prepared = await correct.prepare({ id: OTHER, shared: false }, loaded, { ...nothing, sentence: { english: "I have carrots.", note: null, tokens: null } });
  assert.equal(prepared.ok, true);
});

test("a sentence the app wrote can be taken out, and a recording asked for again", async () => {
  const retired = await fix(LEARNER, { kind: "sentence", id: "mine" }, { ...nothing, retire: true });
  assert.deepEqual(retired.problems, []);
  assert.equal((await stored("mine")).retired, true);

  // The recording asked for is of the text as the same fix leaves it.
  const loaded = (await correct.loadSubject(ME, { kind: "sentence", id: "have-carrot" }))!;
  const prepared = await correct.prepare(REVIEWER, loaded, { ...HAVIJ, audio: { clip: "sentence", wordId: null, reason: "word" } });
  assert.ok(prepared.ok);
  assert.equal(prepared.plan.audio!.clip.expected, "havij dâram");
  const word = await correct.prepare(REVIEWER, loaded, { ...nothing, audio: { clip: "word", wordId: "have", reason: "accent" } });
  assert.ok(word.ok);
  assert.equal(word.plan.audio!.clip.expected, "dâram");
  assert.equal(correct.isEmpty(word.plan), false);
  const none = await correct.prepare(REVIEWER, loaded, nothing);
  assert.ok(none.ok && correct.isEmpty(none.plan));
});

test("the author is told what the entry says and what the listener made of its recording", async () => {
  const loaded = (await correct.loadSubject(ME, { kind: "sentence", id: "have-carrot" }))!;
  const text = correct.describeSubject(loaded);
  assert.match(text, /english: I have carrots\./);
  assert.match(text, /1\. carrot \| هویج \| هُویج \| hovij \| false/);
  assert.match(text, /no recording yet/);
  const word = correct.describeSubject((await correct.loadSubject(ME, { kind: "lexeme", id: "carrot" }))!);
  assert.match(word, /gloss: carrot/);
  assert.match(word, /= I have carrots\./);
});
