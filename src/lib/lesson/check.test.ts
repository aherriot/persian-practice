import assert from "node:assert/strict";
import { test } from "node:test";
import { buildTheme } from "../content/build.ts";
import { THEMES } from "../content/index.ts";
import { SHOPPING } from "../content/shopping.ts";
import { normalizeForCompare } from "../normalize.ts";
import { checkAnswer, EXERCISES, type Submission } from "./check.ts";
import { componentsOf, planSession } from "./plan.ts";
import { evenly, exerciseName, targetKey, type ChoiceExercise, type KnowledgeState, type ThemeContent, type TilesExercise } from "./types.ts";

const content = buildTheme(SHOPPING);
// Every theme as one course: some ways of asking need more than one theme has (replies to tell apart, verbs in several persons).
const themes = THEMES.map(buildTheme);
const course: ThemeContent = {
  sentences: themes.flatMap((t) => t.sentences),
  lexemes: new Map(themes.flatMap((t) => [...t.lexemes])),
  patterns: new Map(themes.flatMap((t) => [...t.patterns])),
};
const NOW = new Date("2026-10-11T12:00:00Z");
const DAY = 24 * 60 * 60 * 1000;

function knowing(n: number, repetitions: number, from: ThemeContent = content): Map<string, KnowledgeState> {
  const state: KnowledgeState = evenly({
    stability: 1,
    difficulty: 5,
    intervalDays: 1,
    repetitions,
    lapses: 0,
    dueAt: new Date(NOW.getTime() - DAY),
    lastReviewedAt: null,
  });
  const map = new Map<string, KnowledgeState>();
  for (const s of from.sentences.slice(0, n)) for (const c of componentsOf(s)) map.set(targetKey(c), state);
  return map;
}

const sentence = (id: string) => course.sentences.find((s) => s.id === id)!;
const submit = (exercise: ChoiceExercise | TilesExercise, answer: string | string[]): Submission => ({
  sentenceId: exercise.sentence.id,
  exercise: exerciseName(exercise),
  primary: exercise.primary,
  answer,
});

/** Every graded exercise the planner makes for learners at different points, at each stage of knowing. */
function* planned(): Generator<ChoiceExercise | TilesExercise> {
  for (const known of [0, 4, 9, 15, 25, 40, 80, 150, course.sentences.length]) {
    for (const repetitions of [0, 1, 2, 3, 5]) {
      const plan = planSession(course, knowing(known, repetitions, course), { now: NOW, seed: known * 10 + repetitions, maxReview: 40 });
      for (const exercise of plan.exercises) if (exercise.type === "choice" || exercise.type === "tiles") yield exercise;
    }
  }
}

test("the server marks every planned exercise the way the browser does", () => {
  const seen = new Set<string>();
  for (const exercise of planned()) {
    const s = sentence(exercise.sentence.id);
    if (exercise.type === "choice") {
      seen.add(exercise.variant);
      exercise.options.forEach((option, i) => {
        const verdict = checkAnswer(s, course, submit(exercise, option));
        assert.ok(verdict.ok);
        assert.equal(verdict.correct, i === exercise.answer, `${exercise.variant} "${option}" for ${s.id}`);
        assert.equal(verdict.picked, i === exercise.answer ? null : option);
      });
    } else {
      seen.add(exercise.variant);
      const model = s.tokens.map((t) => t.fa);
      if (exercise.variant === "dictation") assert.deepEqual(exercise.accepted.map((a) => a.text), [normalizeForCompare(model.join(" "))]);
      const right = checkAnswer(s, course, submit(exercise, model));
      assert.ok(right.ok && right.correct, `model answer for ${s.id}`);
      const wrong = checkAnswer(s, course, submit(exercise, [...model, model[0]]));
      assert.ok(wrong.ok && !wrong.correct);
      assert.equal(wrong.picked, [...model, model[0]].join(" "));
    }
  }
  assert.deepEqual([...seen].sort(), [...EXERCISES].sort());
});

test("the server works out for itself what else a sentence exercises", () => {
  for (const exercise of planned()) {
    const answer = exercise.type === "tiles" ? [] : "";
    const verdict = checkAnswer(sentence(exercise.sentence.id), course, submit(exercise, answer));
    assert.ok(verdict.ok);
    assert.deepEqual(verdict.others, exercise.others);
    assert.deepEqual(verdict.primary, exercise.primary);
  }
});

test("sentence-building accepts every order the browser was told is right", () => {
  for (const exercise of planned()) {
    if (exercise.type !== "tiles") continue;
    for (const accepted of exercise.accepted) {
      const verdict = checkAnswer(sentence(exercise.sentence.id), course, submit(exercise, accepted.text.split(" ")));
      assert.ok(verdict.ok && verdict.correct, accepted.text);
    }
  }
});

test("a claimed target the sentence does not use is refused", () => {
  const s = content.sentences[0];
  const elsewhere = [...content.lexemes.keys()].find((id) => !s.lexemeIds.includes(id))!;
  const verdict = checkAnswer(s, content, { sentenceId: s.id, exercise: "listen", primary: { kind: "lexeme", id: elsewhere }, answer: s.english });
  assert.deepEqual(verdict, { ok: false, reason: "the sentence does not use that word or grammar point" });
});

test("an answer of the wrong shape, or a word exercise about no word, is refused", () => {
  const s = content.sentences[0];
  const primary = { kind: "lexeme", id: s.lexemeIds[0] } as const;
  assert.equal(checkAnswer(s, content, { sentenceId: s.id, exercise: "tiles", primary, answer: s.english }).ok, false);
  assert.equal(checkAnswer(s, content, { sentenceId: s.id, exercise: "read", primary, answer: [s.english] }).ok, false);
  assert.equal(checkAnswer(s, content, { sentenceId: s.id, exercise: "read-word", primary: null, answer: "carrot" }).ok, false);
  assert.equal(checkAnswer(s, content, { sentenceId: s.id, exercise: "cloze", primary: null, answer: "x" }).ok, false);
});

test("ungraded practice is still marked, with every part of the sentence as an other", () => {
  const s = content.sentences[0];
  const verdict = checkAnswer(s, content, { sentenceId: s.id, exercise: "listen", primary: null, answer: s.english });
  assert.ok(verdict.ok && verdict.correct);
  assert.deepEqual(verdict.others, componentsOf(s));
});

test("a sentence built from hearing it is marked against what was said, not another way of saying it", () => {
  // "هویج داریم" and "ما هویج داریم" both mean "We have carrots."
  const short = content.sentences.find((s) => s.english === "We have carrots." && s.tokens.length === 2)!;
  const withPronoun = content.sentences.find((s) => s.english === short.english && s.tokens.length === 3)!;
  const longer = withPronoun.tokens.map((t) => t.fa);
  const from = (exercise: "tiles" | "dictation") => checkAnswer(short, content, { sentenceId: short.id, exercise, primary: null, answer: longer });
  const meaning = from("tiles");
  const heard = from("dictation");
  assert.ok(meaning.ok && meaning.correct);
  assert.ok(heard.ok && !heard.correct);
});

test("a reply is right if it is any of the sentences that answer what was said", () => {
  const prompt = course.sentences.find((s) => s.english === "How are you?")!;
  const replies = course.sentences.filter((s) => s.replyTo?.includes(prompt.id));
  assert.ok(replies.length >= 2);
  const say = (answer: string) =>
    checkAnswer(prompt, course, { sentenceId: prompt.id, exercise: "reply-heard", primary: { kind: "lexeme", id: prompt.lexemeIds[0] }, answer });
  for (const reply of replies) {
    const verdict = say(reply.tokens.map((t) => t.fa + (t.after ?? "")).join(" ") + reply.endPunct);
    assert.ok(verdict.ok && verdict.correct, reply.english);
  }
  const name = course.sentences.find((s) => s.english === "My name is Amir.")!;
  const wrong = say(name.tokens.map((t) => t.fa).join(" ") + name.endPunct);
  assert.ok(wrong.ok && !wrong.correct);
});

test("a form exercise is marked against the word the sentence really has, and refused where it shows no such form", () => {
  const negative = content.sentences.find((s) => s.patternIds.includes("negation"))!;
  const primary = { kind: "pattern", id: "negation" } as const;
  const token = negative.tokens.find((t) => t.fa !== content.lexemes.get(t.lexemeId)!.fa)!;
  const right = checkAnswer(negative, content, { sentenceId: negative.id, exercise: "transform", primary, answer: token.fa });
  assert.ok(right.ok && right.correct);
  const plain = checkAnswer(negative, content, { sentenceId: negative.id, exercise: "transform", primary, answer: content.lexemes.get(token.lexemeId)!.fa });
  assert.ok(plain.ok && !plain.correct);

  // A question shows its grammar in the voice, not in any word.
  const question = content.sentences.find((s) => s.patternIds.includes("question") && !s.patternIds.includes("negation"))!;
  const asked = { kind: "pattern", id: "question" } as const;
  assert.equal(checkAnswer(question, content, { sentenceId: question.id, exercise: "transform", primary: asked, answer: "x" }).ok, false);
  assert.equal(checkAnswer(negative, content, { sentenceId: negative.id, exercise: "transform", primary: null, answer: token.fa }).ok, false);
});
