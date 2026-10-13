import assert from "node:assert/strict";
import { test } from "node:test";
import { buildTheme } from "../content/build.ts";
import { SHOPPING } from "../content/shopping.ts";
import { normalizeForCompare } from "../normalize.ts";
import { applyAnswer, introducedState } from "./grade.ts";
import { componentsOf, planSession, sentenceText } from "./plan.ts";
import { acceptedAnswers } from "./variants.ts";
import { targetKey, type Exercise, type KnowledgeState } from "./types.ts";

const content = buildTheme(SHOPPING);
const NOW = new Date("2026-10-11T12:00:00Z");
const DAY = 24 * 60 * 60 * 1000;

const state = (repetitions: number, dueInDays: number): KnowledgeState => ({
  intervalDays: 1,
  stability: 1,
  difficulty: 5,
  repetitions,
  lapses: 0,
  dueAt: new Date(NOW.getTime() + dueInDays * DAY),
  lastReviewedAt: null,
});

/** Knowledge of everything the first `n` ladder sentences use. */
function knowing(n: number, repetitions: number, dueInDays: number) {
  const map = new Map<string, KnowledgeState>();
  for (const s of content.sentences.slice(0, n)) {
    for (const c of componentsOf(s)) map.set(targetKey(c), state(repetitions, dueInDays));
  }
  return map;
}

const types = (exercises: Exercise[]) => exercises.map((e) => (e.type === "choice" ? e.variant : e.type));

test("sentenceText joins words and punctuation", () => {
  assert.equal(sentenceText(content.sentences[10]), "آره، هویج دارم.");
});

test("first session introduces three things, one at a time, in ladder order", () => {
  const plan = planSession(content, new Map(), { now: NOW, seed: 1 });
  assert.equal(plan.newCount, 3);
  assert.equal(plan.reviewCount, 0);
  const intros = plan.exercises.filter((e) => e.type === "intro-lexeme").map((e) => e.target.id);
  assert.deepEqual(intros, ["havij", "darim", "ma"]);
  assert.deepEqual(types(plan.exercises), [
    "intro-lexeme", "word", "listen",
    "intro-lexeme", "word", "listen",
    "intro-lexeme", "word", "listen",
    "tiles", "tiles",
  ]);
});

test("no exercise uses a word before it has been introduced", () => {
  for (const known of [0, 3, 9, 20]) {
    const knowledge = knowing(known, 1, 5);
    const plan = planSession(content, knowledge, { now: NOW, seed: known + 7 });
    const met = new Set(knowledge.keys());
    for (const e of plan.exercises) {
      if (e.type === "intro-lexeme" || e.type === "intro-pattern") met.add(targetKey(e.target));
      for (const t of e.sentence.tokens) {
        assert.ok(met.has(`lexeme:${t.lexemeId}`), `${e.key} uses ${t.lexemeId} too early`);
      }
    }
  }
});

test("choice exercises have four distinct options with the right answer among them", () => {
  const plan = planSession(content, knowing(12, 1, -1), { now: NOW, seed: 3 });
  const choices = plan.exercises.filter((e) => e.type === "choice");
  assert.ok(choices.length > 0);
  for (const e of choices) {
    assert.equal(e.options.length, 4);
    assert.equal(new Set(e.options).size, 4);
    const expected =
      e.variant === "word"
        ? e.sentence.tokens[e.tokenIndex!].gloss
        : e.variant === "cloze"
          ? e.sentence.tokens[e.tokenIndex!].fa
          : e.sentence.english;
    assert.equal(e.options[e.answer], expected);
  }
});

test("due items are reviewed, capped, and only inside fully known sentences", () => {
  const knowledge = knowing(12, 1, -1);
  const plan = planSession(content, knowledge, { now: NOW, seed: 5, maxReview: 4, maxNew: 0 });
  assert.equal(plan.reviewCount, 4);
  assert.equal(plan.newCount, 0);
  for (const e of plan.exercises) {
    assert.ok(e.type !== "intro-lexeme" && e.type !== "intro-pattern");
    for (const c of [...(e.primary ? [e.primary] : []), ...e.others]) assert.ok(knowledge.has(targetKey(c)));
  }
});

test("mature items are practised by building the sentence", () => {
  const plan = planSession(content, knowing(12, 4, -1), { now: NOW, seed: 9, maxNew: 0 });
  assert.ok(plan.exercises.filter((e) => e.type === "tiles").length >= plan.reviewCount - 1);
});

test("tiles accept the target sentence and same-meaning alternatives", () => {
  const plan = planSession(content, new Map(), { now: NOW, seed: 1 });
  const tiles = plan.exercises.filter((e) => e.type === "tiles");
  for (const e of tiles) {
    const own = normalizeForCompare(e.sentence.tokens.map((t) => t.fa).join(" "));
    assert.equal(e.accepted[0].text, own);
    assert.equal(e.accepted[0].remark, undefined);
    for (const t of e.sentence.tokens) assert.ok(e.tiles.some((tile) => tile.fa === t.fa));
  }
  // "هویج داریم" and "ما هویج داریم" both mean "We have carrots."
  assert.deepEqual(
    tiles[0].accepted.map((a) => a.text),
    ["هویج داریم", "ما هویج داریم"].map(normalizeForCompare),
  );
  assert.ok(tiles[0].accepted.every((a) => a.remark === undefined));
});

test("a subject pronoun that agrees with the verb is optional in either direction", () => {
  const find = (english: string, words: number) =>
    content.sentences.find((s) => s.english === english && s.tokens.length === words)!;
  const answers = (english: string, words: number) =>
    new Map(acceptedAnswers(find(english, words), content).map((a) => [a.text, a.remark]));

  // Adding ما to a sentence written without it.
  const added = answers("We have carrots and apples.", 4);
  assert.match(added.get(normalizeForCompare("ما هویج و سیب داریم")) ?? "", /optional/);
  // The wrong person's pronoun is still wrong.
  assert.ok(!added.has(normalizeForCompare("من هویج و سیب داریم")));

  // Leaving من out of a sentence written with it; the other content sentence makes it exact.
  const dropped = answers("I have apples.", 3);
  assert.ok(dropped.has(normalizeForCompare("سیب دارم")));

  // After an interjection, and with a negated verb.
  assert.ok(answers("Yeah, I have carrots.", 3).has(normalizeForCompare("آره من هویج دارم")));
  assert.ok(answers("No, we don't have bread.", 3).has(normalizeForCompare("نه ما نون نداریم")));

  // No verb, no optional pronoun: "my apple" needs its من.
  assert.equal(answers("My apple.", 2).size, 1);
});

test("vowel marks fade once a word is well known", () => {
  const fresh = planSession(content, knowing(3, 1, -1), { now: NOW, seed: 2, maxNew: 0 });
  const mature = planSession(content, knowing(3, 3, -1), { now: NOW, seed: 2, maxNew: 0 });
  assert.ok(fresh.exercises.every((e) => e.sentence.tokens.every((t) => t.showVowels)));
  assert.ok(mature.exercises.every((e) => e.sentence.tokens.every((t) => !t.showVowels)));
});

test("with nothing due and nothing new, the session is ungraded practice", () => {
  const all = knowing(content.sentences.length, 2, 10);
  const plan = planSession(content, all, { now: NOW, seed: 4 });
  assert.equal(plan.newCount + plan.reviewCount, 0);
  assert.equal(plan.exercises.length, 6);
  assert.ok(plan.exercises.every((e) => e.type !== "intro-lexeme" && e.type !== "intro-pattern" && e.primary === null));
});

test("a session planned from a slice of the course matches one planned from all of it", () => {
  const knowledge = knowing(4, 1, 5);
  const known = new Set(knowledge.keys());
  // What the session loader fetches: the next ladder sentences that teach something, and a sample of meanings.
  const ahead = content.sentences.filter((s) => componentsOf(s).some((c) => !known.has(targetKey(c)))).slice(0, 12);
  const distractors = content.sentences.map((s) => ({ english: s.english, length: s.tokens.length }));
  const whole = planSession(content, knowledge, { now: NOW, seed: 5 });
  const sliced = planSession({ ...content, sentences: ahead }, knowledge, { now: NOW, seed: 5, distractors });

  const intros = (plan: typeof whole) => plan.exercises.flatMap((e) => (e.type.startsWith("intro") ? [e.sentence.id] : []));
  assert.equal(sliced.newCount, 3);
  assert.deepEqual(intros(sliced), intros(whole));
  for (const e of sliced.exercises) {
    if (e.type === "choice" && e.variant === "listen") assert.equal(new Set(e.options).size, 4);
  }
});

test("the same seed gives the same plan", () => {
  const a = planSession(content, knowing(9, 1, -1), { now: NOW, seed: 42 });
  const b = planSession(content, knowing(9, 1, -1), { now: NOW, seed: 42 });
  assert.deepEqual(a, b);
});

// --- grading ---

const havij = { kind: "lexeme", id: "havij" } as const;
const darim = { kind: "lexeme", id: "darim" } as const;

test("a new word answered right is due the next sitting, and not advanced twice", () => {
  const states = new Map([[targetKey(havij), introducedState(NOW)]]);
  const first = applyAnswer(states, havij, [], true, NOW);
  const next = first.get(targetKey(havij))!;
  assert.equal(next.repetitions, 1);
  assert.equal(next.dueAt.getTime(), NOW.getTime() + DAY - 8 * 60 * 60 * 1000);
  assert.equal(applyAnswer(first, havij, [], true, NOW).size, 0);
});

test("a right answer advances other words only if they were due", () => {
  const states = new Map([
    [targetKey(havij), state(2, -1)],
    [targetKey(darim), state(2, 3)],
  ]);
  const updates = applyAnswer(states, havij, [darim], true, NOW);
  assert.deepEqual([...updates.keys()], [targetKey(havij)]);
  assert.equal(updates.get(targetKey(havij))!.repetitions, 3);
});

test("a wrong answer lapses only the primary target, once", () => {
  const states = new Map([
    [targetKey(havij), state(4, 3)],
    [targetKey(darim), state(4, -1)],
  ]);
  const updates = applyAnswer(states, havij, [darim], false, NOW);
  assert.deepEqual([...updates.keys()], [targetKey(havij)]);
  const lapsed = updates.get(targetKey(havij))!;
  assert.equal(lapsed.repetitions, 0);
  assert.equal(lapsed.lapses, 1);
  assert.equal(applyAnswer(updates, havij, [], false, NOW).size, 0);
});

test("ungraded practice and unknown targets change nothing", () => {
  assert.equal(applyAnswer(new Map(), null, [havij], false, NOW).size, 0);
  assert.equal(applyAnswer(new Map(), havij, [], true, NOW).size, 0);
});
