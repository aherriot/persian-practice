// Flagging and the review list, against a real Postgres (PGlite).
import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";
import { eq } from "drizzle-orm";
import { VOICE_INSTRUCTION, wordClip } from "../audio-key.ts";
import { closeTestDb, createTestDb, emptyTestDb, type TestDb } from "../db/test-db.ts";
import { audioClips, flags as flagTable, lexemes, sentences, users, type SentenceToken } from "../db/schema.ts";
import { sentenceClip } from "./plan.ts";

let db: TestDb;
let flags: typeof import("./flags.ts");
let correct: typeof import("./correct.ts");

before(async () => {
  db = await createTestDb();
  // Only now: these import the database, which must already be the test one.
  flags = await import("./flags.ts");
  correct = await import("./correct.ts");
});

const ME = "learner-me";
const OTHER = "learner-other";
const REVIEWER = { id: ME, shared: true };
const LEARNER = { id: ME, shared: false };
const THEM = { id: OTHER, shared: false };

const CARROT = { id: "carrot", fa: "هویج", voc: "هُویج", translit: "hovij", gloss: "carrot" };
const HAVE = { id: "have", fa: "دارم", voc: "دارَم", translit: "dâram", gloss: "I have" };
const token = (word: { id: string; fa: string; voc: string; translit: string }): SentenceToken => ({ lexemeId: word.id, fa: word.fa, voc: word.voc, translit: word.translit });
const sentence = (id: string, extra: Partial<typeof sentences.$inferInsert> = {}) => ({
  id,
  themeId: null,
  position: 0,
  english: "I have carrots.",
  tokens: [token(CARROT), token(HAVE)],
  endPunct: ".",
  lexemeIds: ["carrot", "have"],
  ...extra,
});

beforeEach(async () => {
  await emptyTestDb(db);
  await db.insert(users).values([ME, OTHER].map((id) => ({ id, email: `${id}@example.com` })));
  await db.insert(lexemes).values([CARROT, HAVE]);
  await db.insert(sentences).values([
    sentence("shared"),
    sentence("mine", { ownerId: ME, generated: true, ladder: false, english: "I do have carrots.", tokens: [token(HAVE), token(CARROT)] }),
    sentence("theirs", { ownerId: OTHER, generated: true, ladder: false, english: "Carrots, I have." }),
  ]);
});
after(() => closeTestDb(db));

const load = async (userId: string, kind: "lexeme" | "sentence", id: string) => (await correct.loadSubject(userId, { kind, id }))!;
const listed = async (editor: { id: string; shared: boolean }) =>
  (await flags.reviewList(editor)).map((item) => `${item.subject.id}: ${item.flags.map((f) => f.note).join(", ")}${item.audio ? " [audio]" : ""}`);

test("a learner may flag what is theirs; a reviewer may flag anything", async () => {
  assert.equal(flags.mayChange(LEARNER, await load(ME, "sentence", "mine")), true);
  assert.equal(flags.mayChange(LEARNER, await load(ME, "sentence", "shared")), false);
  assert.equal(flags.mayChange(LEARNER, await load(ME, "lexeme", "carrot")), false);
  assert.equal(flags.mayChange(REVIEWER, await load(ME, "lexeme", "carrot")), true);
});

test("a learner sees their own flags; a reviewer sees everyone's", async () => {
  await flags.raiseFlag(LEARNER, { kind: "sentence", id: "mine" }, "Sounds odd");
  await flags.raiseFlag(THEM, { kind: "sentence", id: "theirs" }, "Wrong word");
  await flags.raiseFlag(REVIEWER, { kind: "lexeme", id: "carrot" }, "It is havij");
  assert.deepEqual(await listed(LEARNER), ["carrot: It is havij", "mine: Sounds odd"]);
  assert.deepEqual(await listed(THEM), ["theirs: Wrong word"]);
  // A reviewer cannot load another learner's sentence, so it is not theirs to review.
  assert.deepEqual(await listed(REVIEWER), ["carrot: It is havij", "mine: Sounds odd"]);
  assert.equal(await flags.openFlagCount(REVIEWER), 3);
});

test("two flags on one thing make one item", async () => {
  await flags.raiseFlag(LEARNER, { kind: "sentence", id: "mine" }, "Sounds odd");
  await flags.raiseFlag(LEARNER, { kind: "sentence", id: "mine" }, "Too slow");
  assert.deepEqual(await listed(LEARNER), ["mine: Too slow, Sounds odd"]);
});

test("a fix closes every flag on the thing; dismissing closes only one's own unless a reviewer", async () => {
  const shared = { kind: "lexeme" as const, id: "carrot" };
  await flags.raiseFlag(LEARNER, shared, "One");
  await flags.raiseFlag(THEM, shared, "Two");
  await flags.resolveFlags(THEM, shared, "dismissed");
  assert.deepEqual(await listed(REVIEWER), ["carrot: One"]);

  await flags.raiseFlag(THEM, shared, "Three");
  await flags.resolveFlags(REVIEWER, shared, "fixed");
  assert.deepEqual(await listed(REVIEWER), []);
  const rows = await db.select().from(flagTable);
  assert.deepEqual(rows.map((r) => r.outcome).sort(), ["dismissed", "fixed", "fixed"]);
});

test("a flag on a retired sentence is not listed", async () => {
  await flags.raiseFlag(LEARNER, { kind: "sentence", id: "mine" }, "Nonsense");
  await db.update(sentences).set({ retired: true }).where(eq(sentences.id, "mine"));
  assert.deepEqual(await listed(LEARNER), []);
});

test("a reviewer also sees the recordings the listener was unsure of, unless a person approved them", async () => {
  const [shared] = await db.select().from(sentences).where(eq(sentences.id, "shared"));
  const [mine] = await db.select().from(sentences).where(eq(sentences.id, "mine"));
  const made = { instructions: VOICE_INSTRUCTION, attempts: 6 };
  await db.insert(audioClips).values([
    { ...sentenceClip(shared), ...made, status: "flagged", heard: "havij dâram" },
    { ...sentenceClip(mine), ...made, status: "flagged", heard: "havij" },
    { ...wordClip(CARROT), ...made, status: "verified", heard: "hovij", instructions: "An old instruction." },
    { ...wordClip(HAVE), ...made, status: "flagged", heard: "dâre", approvedAt: new Date() },
  ]);
  assert.deepEqual((await listed(REVIEWER)).sort(), ["carrot:  [audio]", "mine:  [audio]", "shared:  [audio]"]);
  assert.deepEqual(await listed(LEARNER), []);

  const item = (await flags.reviewList(REVIEWER)).find((i) => i.subject.id === "shared")!;
  assert.deepEqual(item.audio, { heard: "havij dâram", flagged: true, stale: false, carrier: null });
  assert.equal(await flags.doubtedClip(await load(ME, "sentence", "shared")), sentenceClip(shared).hash);
  assert.equal(await flags.doubtedClip(await load(ME, "lexeme", "have")), null);
});
