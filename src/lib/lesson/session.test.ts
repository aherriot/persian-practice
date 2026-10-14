// loadSession's SQL, run against a real Postgres (PGlite) with the project's
// migrations applied. The planner it feeds is tested on its own in plan.test.ts;
// these tests are about which sentences and words the queries hand it.
import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";
import { closeTestDb, createTestDb, emptyTestDb, type TestDb } from "../db/test-db.ts";
import { wordClip } from "../audio-key.ts";
import { audioClips, knowledge, lexemes, reviewLog, sentences, themes, users } from "../db/schema.ts";
import type { SessionPlan } from "./types.ts";
import { SKILLS } from "./types.ts";

let db: TestDb;
let loadSession: typeof import("./session.ts").loadSession;

before(async () => {
  db = await createTestDb();
  // Only now: session.ts imports the database, which must already be the test one.
  ({ loadSession } = await import("./session.ts"));
});

beforeEach(() => emptyTestDb(db));
after(() => closeTestDb(db));

// --- Fixtures. Every insert names only the columns the test cares about, so a
// column added with a default needs no change here. ---

const NOW = new Date("2026-10-11T12:00:00Z");
const DAY = 24 * 60 * 60 * 1000;
const ME = "learner-me";
const OTHER = "learner-other";

async function addUsers(...ids: string[]) {
  await db.insert(users).values(ids.map((id) => ({ id, email: `${id}@example.com` })));
}

async function addTheme(id: string, position: number, ownerId: string | null = null) {
  await db.insert(themes).values({ id, title: id, titleFa: id, description: id, position, ownerId });
}

/** Words named by their id: "apple" is spelled fa-apple and means "gloss apple". */
async function addWords(ids: string[], ownerId: string | null = null) {
  await db
    .insert(lexemes)
    .values(ids.map((id) => ({ id, fa: `fa-${id}`, voc: `voc-${id}`, translit: id, gloss: `gloss ${id}`, ownerId })));
}

type SentenceOptions = {
  themeId?: string | null;
  position?: number;
  ladder?: boolean;
  generated?: boolean;
  retired?: boolean;
  ownerId?: string | null;
  replyTo?: string[];
};

async function addSentence(id: string, lexemeIds: string[], options: SentenceOptions = {}) {
  await db.insert(sentences).values({
    id,
    themeId: null,
    position: 0,
    english: `english ${id}`,
    tokens: lexemeIds.map((lexemeId) => ({ lexemeId, fa: `fa-${lexemeId}`, voc: `voc-${lexemeId}`, translit: lexemeId })),
    endPunct: ".",
    lexemeIds,
    ...options,
  });
}

/**
 * Marks words as met: due yesterday unless `dueInDays` says otherwise. Due
 * means due by ear; reading and producing are a month off, so each word comes
 * up for review once.
 */
async function know(userId: string, lexemeIds: string[], { dueInDays = -1, repetitions = 1, lapses = 0 } = {}) {
  await db.insert(knowledge).values(
    lexemeIds.flatMap((refId) =>
      SKILLS.map((skill) => ({
        userId,
        kind: "lexeme" as const,
        refId,
        skill,
        repetitions,
        lapses,
        dueAt: new Date(NOW.getTime() + (skill === "listening" ? dueInDays : 30) * DAY),
      })),
    ),
  );
}

async function answered(userId: string, sentenceId: string, times: number) {
  await db
    .insert(reviewLog)
    .values(Array.from({ length: times }, () => ({ userId, sentenceId, exercise: "listen", correct: true })));
}

/**
 * Two curated themes. "fruit" teaches apple, pear, plum, fig in that order;
 * "drinks", after it, teaches tea then milk.
 */
async function addCourse() {
  await addUsers(ME, OTHER);
  await addTheme("fruit", 1);
  await addTheme("drinks", 2);
  await addWords(["apple", "pear", "plum", "fig", "tea", "milk"]);
  await addSentence("fruit-1", ["apple"], { themeId: "fruit", position: 1 });
  await addSentence("fruit-2", ["apple", "pear"], { themeId: "fruit", position: 2 });
  await addSentence("fruit-3", ["apple", "pear", "plum"], { themeId: "fruit", position: 3 });
  await addSentence("fruit-4", ["fig", "apple"], { themeId: "fruit", position: 4 });
  await addSentence("drinks-1", ["tea"], { themeId: "drinks", position: 1 });
  await addSentence("drinks-2", ["tea", "milk"], { themeId: "drinks", position: 2 });
}

// --- What a plan contains. ---

const sentenceIds = (plan: SessionPlan) => [...new Set(plan.exercises.map((e) => e.sentence.id))].sort();

const introduced = (plan: SessionPlan) =>
  plan.exercises.flatMap((e) => (e.type === "intro-lexeme" || e.type === "intro-pattern" ? [e.target.id] : []));

const reviewed = (plan: SessionPlan) =>
  plan.exercises.flatMap((e) => ((e.type === "choice" || e.type === "tiles") && e.primary ? [e.primary.id] : [])).sort();

/** Every piece of text a learner could be shown: sentences, words, tiles and answer options. */
function shownText(plan: SessionPlan): string {
  return JSON.stringify(plan.exercises);
}

const SEEDS = [1, 2, 3, 4, 5];

// --- New material ---

test("a new learner is introduced to the first words on the ladder, in order", async () => {
  await addCourse();
  const plan = await loadSession(ME, { now: NOW, seed: 1 });
  assert.deepEqual(introduced(plan), ["apple", "pear", "plum"]);
  assert.equal(plan.newCount, 3);
  assert.equal(plan.reviewCount, 0);
  // Each word arrives in the sentence that teaches it.
  assert.deepEqual(sentenceIds(plan), ["fruit-1", "fruit-2", "fruit-3"]);
});

test("ladder order follows sentence position, not the order rows were stored in", async () => {
  await addUsers(ME);
  await addTheme("fruit", 1);
  await addWords(["apple", "pear", "plum"]);
  await addSentence("z-first", ["plum"], { themeId: "fruit", position: 1 });
  await addSentence("a-last", ["plum", "apple"], { themeId: "fruit", position: 3 });
  await addSentence("m-middle", ["plum", "pear"], { themeId: "fruit", position: 2 });
  const plan = await loadSession(ME, { now: NOW, seed: 1 });
  assert.deepEqual(introduced(plan), ["plum", "pear", "apple"]);
});

test("new material carries on into the next theme once a theme is finished", async () => {
  await addCourse();
  await know(ME, ["apple", "pear", "plum", "fig"], { dueInDays: 5 });
  const plan = await loadSession(ME, { now: NOW, seed: 1 });
  assert.deepEqual(introduced(plan), ["tea", "milk"]);
});

test("a learner's own theme comes before the curated ones when it is placed first", async () => {
  await addCourse();
  await addTheme("my-words", 0, ME);
  await addWords(["kiwi"], ME);
  await addSentence("mine-1", ["kiwi"], { themeId: "my-words", position: 1, ownerId: ME });
  const plan = await loadSession(ME, { now: NOW, seed: 1 });
  assert.deepEqual(introduced(plan), ["kiwi", "apple", "pear"]);
});

test("no more than maxNew things are introduced", async () => {
  await addCourse();
  const plan = await loadSession(ME, { now: NOW, seed: 1, maxNew: 1 });
  assert.deepEqual(introduced(plan), ["apple"]);
});

// --- Reviews ---

test("what is due is reviewed only in sentences made entirely of known words", async () => {
  await addCourse();
  await know(ME, ["apple", "pear"]);
  for (const seed of SEEDS) {
    const plan = await loadSession(ME, { now: NOW, seed, maxNew: 0 });
    assert.equal(plan.reviewCount, 2);
    assert.deepEqual(reviewed(plan), ["apple", "pear"]);
    // fruit-3 and fruit-4 use apple too, but with words not met yet.
    assert.deepEqual(sentenceIds(plan), ["fruit-1", "fruit-2"]);
  }
});

test("a session that also introduces something still reviews only in known sentences", async () => {
  await addCourse();
  await know(ME, ["apple", "pear"]);
  const plan = await loadSession(ME, { now: NOW, seed: 1 });
  assert.deepEqual(introduced(plan), ["plum", "fig", "tea"]);
  for (const exercise of plan.exercises) {
    if (exercise.type !== "choice" && exercise.type !== "tiles") continue;
    const isReview = exercise.primary !== null && !introduced(plan).includes(exercise.primary.id);
    if (isReview) assert.ok(["fruit-1", "fruit-2"].includes(exercise.sentence.id), exercise.sentence.id);
  }
});

test("nothing is reviewed before it is due", async () => {
  await addCourse();
  await know(ME, ["apple", "pear"], { dueInDays: 3 });
  const plan = await loadSession(ME, { now: NOW, seed: 1, maxNew: 0 });
  assert.equal(plan.reviewCount, 0);
  assert.deepEqual(reviewed(plan), []);
  // The session is not empty: ungraded practice, still from known sentences only.
  assert.deepEqual(sentenceIds(plan), ["fruit-1", "fruit-2"]);
});

test("the most overdue things are reviewed when more is due than a session holds", async () => {
  await addCourse();
  await know(ME, ["apple"], { dueInDays: -1 });
  await know(ME, ["pear"], { dueInDays: -9 });
  const plan = await loadSession(ME, { now: NOW, seed: 1, maxNew: 0, maxReview: 1 });
  assert.equal(plan.reviewCount, 1);
  assert.deepEqual(reviewed(plan), ["pear"]);
});

test("another learner's knowledge and answers do not count as this learner's", async () => {
  await addCourse();
  await know(OTHER, ["apple", "pear", "plum", "fig"]);
  await answered(OTHER, "fruit-1", 5);
  const plan = await loadSession(ME, { now: NOW, seed: 1 });
  assert.equal(plan.reviewCount, 0);
  assert.deepEqual(introduced(plan), ["apple", "pear", "plum"]);
});

// --- Theme scope ---

test("a themed session reviews and teaches only that theme", async () => {
  await addCourse();
  await know(ME, ["apple", "pear", "tea"]);
  for (const seed of SEEDS) {
    const plan = await loadSession(ME, { themeId: "drinks", now: NOW, seed });
    assert.deepEqual(reviewed(plan).filter((id) => id !== "milk"), ["tea"]);
    assert.deepEqual(introduced(plan), ["milk"]);
    assert.deepEqual(sentenceIds(plan), ["drinks-1", "drinks-2"]);
    // Wrong answers come from the theme too.
    assert.doesNotMatch(shownText(plan), /english fruit/);
  }
});

test("a themed session includes practice sentences built only from that theme's words", async () => {
  await addCourse();
  await know(ME, ["apple", "tea"]);
  // Generated practice belongs to no theme; it joins one by the words it uses.
  await addSentence("gen-tea", ["tea"], { ladder: false, generated: true, ownerId: ME });
  await addSentence("gen-mixed", ["tea", "apple"], { ladder: false, generated: true, ownerId: ME });
  // The theme's own sentence has been answered often, so the fresh one is preferred.
  await answered(ME, "drinks-1", 4);
  for (const seed of SEEDS) {
    const plan = await loadSession(ME, { themeId: "drinks", now: NOW, seed, maxNew: 0 });
    assert.equal(plan.exercises[0].sentence.id, "gen-tea");
    assert.ok(!sentenceIds(plan).includes("gen-mixed"), "a sentence using another theme's word is not this theme's");
  }
});

test("practising everything draws on every theme", async () => {
  await addCourse();
  await know(ME, ["apple", "pear", "tea"]);
  const plan = await loadSession(ME, { now: NOW, seed: 1, maxNew: 0 });
  assert.deepEqual(reviewed(plan), ["apple", "pear", "tea"]);
  assert.deepEqual(sentenceIds(plan), ["drinks-1", "fruit-1", "fruit-2"]);
});

// --- Ownership ---

test("another learner's sentences and words never appear", async () => {
  await addCourse();
  await addTheme("theirs", 0, OTHER);
  await addWords(["secret"], OTHER);
  await addSentence("theirs-1", ["secret"], { themeId: "theirs", position: 1, ownerId: OTHER });
  // Made only of words this learner knows, but written for someone else.
  await addSentence("theirs-gen", ["apple"], { ladder: false, generated: true, ownerId: OTHER });
  await addSentence("theirs-gen-2", ["apple", "pear"], { ladder: false, generated: true, ownerId: OTHER });
  await know(ME, ["apple", "pear"]);
  await know(OTHER, ["apple", "pear", "secret"]);

  for (const seed of SEEDS) {
    for (const themeId of [undefined, "fruit"]) {
      const plan = await loadSession(ME, { themeId, now: NOW, seed });
      assert.ok(plan.exercises.length > 0);
      assert.doesNotMatch(shownText(plan), /theirs|secret/);
    }
  }
});

test("another learner's theme has nothing in it for this learner", async () => {
  await addCourse();
  await addTheme("theirs", 0, OTHER);
  await addWords(["secret"], OTHER);
  await addSentence("theirs-1", ["secret"], { themeId: "theirs", position: 1, ownerId: OTHER });
  await know(ME, ["apple", "pear"]);
  const plan = await loadSession(ME, { themeId: "theirs", now: NOW, seed: 1 });
  assert.deepEqual(plan.exercises, []);
});

test("a learner's own sentences and words do appear, for them", async () => {
  await addCourse();
  await addWords(["kiwi"], ME);
  await addSentence("mine-gen", ["apple", "kiwi"], { ladder: false, generated: true, ownerId: ME });
  await know(ME, ["apple", "kiwi"]);
  const plan = await loadSession(ME, { now: NOW, seed: 1, maxNew: 0 });
  assert.ok(sentenceIds(plan).includes("mine-gen"));
  assert.deepEqual(reviewed(plan), ["apple", "kiwi"]);
});

// --- Retired sentences ---

test("a retired sentence is never practised", async () => {
  await addCourse();
  await know(ME, ["apple", "pear"]);
  await addSentence("gen-bad", ["apple"], { ladder: false, generated: true, ownerId: ME, retired: true });
  await addSentence("gen-bad-2", ["pear", "apple"], { ladder: false, generated: true, ownerId: ME, retired: true });
  for (const seed of SEEDS) {
    for (const themeId of [undefined, "fruit"]) {
      const plan = await loadSession(ME, { themeId, now: NOW, seed, maxNew: 0 });
      assert.deepEqual(sentenceIds(plan), ["fruit-1", "fruit-2"]);
      assert.doesNotMatch(shownText(plan), /gen-bad/);
    }
  }
});

test("a retired sentence teaches nothing, and its words do not count as its theme's", async () => {
  await addCourse();
  await addWords(["quince"]);
  await addSentence("fruit-0", ["quince"], { themeId: "fruit", position: 0, retired: true });
  const plan = await loadSession(ME, { themeId: "fruit", now: NOW, seed: 1 });
  assert.deepEqual(introduced(plan), ["apple", "pear", "plum"]);
  assert.doesNotMatch(shownText(plan), /fruit-0/);
});

// --- Least seen ---

test("a review uses a sentence the learner has answered least", async () => {
  await addCourse();
  await know(ME, ["apple"]);
  // Ten more sentences for the one word: more than are fetched for a review.
  const extra = Array.from({ length: 10 }, (_, i) => `apple-${i}`);
  for (const id of extra) await addSentence(id, ["apple"], { ladder: false, generated: true, ownerId: ME });
  const fresh = ["apple-3", "apple-7"];
  for (const id of ["fruit-1", ...extra]) if (!fresh.includes(id)) await answered(ME, id, 2);

  for (const seed of SEEDS) {
    const plan = await loadSession(ME, { now: NOW, seed, maxNew: 0 });
    assert.equal(plan.reviewCount, 1);
    assert.ok(fresh.includes(plan.exercises[0].sentence.id), `reviewed in ${plan.exercises[0].sentence.id}`);
    // The unanswered sentences are used before any answered one comes round again.
    assert.deepEqual(sentenceIds(plan).filter((id) => fresh.includes(id)), fresh);
  }
});

test("how often a sentence was answered is counted for this learner only", async () => {
  await addCourse();
  await know(ME, ["apple"]);
  await addSentence("gen-apple", ["apple"], { ladder: false, generated: true });
  // Someone else has worn out gen-apple; this learner has worn out fruit-1.
  await answered(OTHER, "gen-apple", 9);
  await answered(ME, "fruit-1", 2);
  for (const seed of SEEDS) {
    const plan = await loadSession(ME, { now: NOW, seed, maxNew: 0 });
    assert.equal(plan.exercises[0].sentence.id, "gen-apple");
  }
});

// --- Sessions about chosen things ---

test("practice brings up what the learner keeps getting wrong, due or not", async () => {
  await addCourse();
  // Nothing is due for a week, and plum has been missed.
  await know(ME, ["apple", "pear"], { dueInDays: 7 });
  await know(ME, ["plum"], { dueInDays: 7, lapses: 1 });
  for (const seed of SEEDS) {
    // Not in a theme's session: the weak thing may belong to another theme.
    assert.equal((await loadSession(ME, { now: NOW, seed, maxNew: 0, themeId: "fruit" })).reviewCount, 0);
    const plan = await loadSession(ME, { now: NOW, seed, maxNew: 0 });
    assert.deepEqual(reviewed(plan), ["plum"]);
    assert.deepEqual(introduced(plan), []);
    // Plum only appears with apple and pear, which are known: that is the sentence used.
    assert.equal(plan.exercises[0].sentence.id, "fruit-3");
  }
});

test("a word the learner picked wrongly before is offered again as a wrong answer", async () => {
  await addCourse();
  await know(ME, ["apple", "pear", "plum", "fig"], { repetitions: 0 });
  // Asked what apple means, this learner chose tea's meaning.
  await db.insert(reviewLog).values({ userId: ME, exercise: "word", correct: false, target: "lexeme:apple", picked: "gloss tea" });
  let asked = 0;
  for (let seed = 1; seed <= 30; seed++) {
    const plan = await loadSession(ME, { now: NOW, seed, maxNew: 0, themeId: "fruit" });
    for (const e of plan.exercises) {
      if (e.type !== "choice" || e.variant !== "hear-word" || e.primary?.id !== "apple") continue;
      assert.ok(e.options.includes("gloss tea"), `seed ${seed}: ${e.options.join(", ")}`);
      asked++;
    }
  }
  assert.ok(asked > 3, `apple's meaning was asked ${asked} times`);
});

test("a word whose clip is a whole sentence is not asked about by the sound of it alone", async () => {
  await addCourse();
  await know(ME, ["apple", "pear"], { repetitions: 1 });
  const heardAlone = async () => {
    const words = new Set<string>();
    for (let seed = 1; seed <= 30; seed++) {
      const plan = await loadSession(ME, { now: NOW, seed, maxNew: 0 });
      for (const e of plan.exercises) if (e.type === "choice" && e.variant === "hear-word" && e.primary) words.add(e.primary.id);
    }
    return [...words].sort();
  };
  assert.deepEqual(await heardAlone(), ["apple", "pear"]);

  // Apple could not be said alone: its clip is the sentence it is in.
  await db.insert(audioClips).values({ ...wordClip({ fa: "fa-apple", translit: "apple" }), status: "verified", carrier: "apple pear" });
  assert.deepEqual(await heardAlone(), ["pear"]);
});

test("replies to what is being reviewed are brought in, but only ones the learner can read", async () => {
  await addCourse();
  await know(ME, ["apple", "pear"], { repetitions: 2 });
  await know(ME, ["tea", "plum"], { dueInDays: 5, repetitions: 2 });
  // fruit-1 can be answered three ways; one uses a word not met yet. drinks-1 has replies of its own.
  await addSentence("reply-a", ["pear"], { themeId: "fruit", position: 10, replyTo: ["fruit-1"] });
  await addSentence("reply-b", ["plum", "pear"], { themeId: "fruit", position: 11, replyTo: ["fruit-1"] });
  await addSentence("reply-c", ["fig"], { themeId: "fruit", position: 12, replyTo: ["fruit-1"] });
  await addSentence("reply-d", ["tea"], { themeId: "drinks", position: 10, replyTo: ["drinks-1"] });
  await addSentence("reply-e", ["tea", "tea"], { themeId: "drinks", position: 11, replyTo: ["drinks-1"] });

  let asked = 0;
  for (let seed = 1; seed <= 40; seed++) {
    const plan = await loadSession(ME, { now: NOW, seed, maxNew: 0 });
    for (const e of plan.exercises) {
      if (e.type !== "choice" || e.variant !== "reply-heard") continue;
      asked++;
      assert.equal(e.sentence.id, "fruit-1");
      assert.ok(["reply-a", "reply-b"].includes(e.reply!.id));
      assert.ok(!shownText(plan).includes("fa-fig"));
      // The wrong answers are what one says back to something else.
      const wrong = e.options.filter((_, i) => i !== e.answer).sort();
      assert.deepEqual(wrong, ["fa-tea fa-tea.", "fa-tea."]);
    }
  }
  assert.ok(asked > 0);
});
