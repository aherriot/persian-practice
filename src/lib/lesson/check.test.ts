import assert from "node:assert/strict";
import { test } from "node:test";
import { buildTheme } from "../content/build.ts";
import { SHOPPING } from "../content/shopping.ts";
import { checkAnswer, type Submission } from "./check.ts";
import { componentsOf, planSession } from "./plan.ts";
import { targetKey, type ChoiceExercise, type KnowledgeState, type TilesExercise } from "./types.ts";

const content = buildTheme(SHOPPING);
const NOW = new Date("2026-10-11T12:00:00Z");
const DAY = 24 * 60 * 60 * 1000;

function knowing(n: number, repetitions: number): Map<string, KnowledgeState> {
  const state: KnowledgeState = {
    stability: 1,
    difficulty: 5,
    intervalDays: 1,
    repetitions,
    lapses: 0,
    dueAt: new Date(NOW.getTime() - DAY),
    lastReviewedAt: null,
  };
  const map = new Map<string, KnowledgeState>();
  for (const s of content.sentences.slice(0, n)) for (const c of componentsOf(s)) map.set(targetKey(c), state);
  return map;
}

const sentence = (id: string) => content.sentences.find((s) => s.id === id)!;
const submit = (exercise: ChoiceExercise | TilesExercise, answer: string | string[]): Submission => ({
  sentenceId: exercise.sentence.id,
  exercise: exercise.type === "tiles" ? "tiles" : exercise.variant,
  primary: exercise.primary,
  answer,
});

/** Every graded exercise the planner makes for learners at different points, at each stage of knowing. */
function* planned(): Generator<ChoiceExercise | TilesExercise> {
  for (const known of [0, 4, 9, 15, 25, content.sentences.length]) {
    for (const repetitions of [0, 1, 2, 3, 5]) {
      const plan = planSession(content, knowing(known, repetitions), { now: NOW, seed: known * 10 + repetitions, maxReview: 30 });
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
        const verdict = checkAnswer(s, content, submit(exercise, option));
        assert.ok(verdict.ok);
        assert.equal(verdict.correct, i === exercise.answer, `${exercise.variant} "${option}" for ${s.id}`);
        assert.equal(verdict.picked, i === exercise.answer ? null : option);
      });
    } else {
      seen.add("tiles");
      const model = s.tokens.map((t) => t.fa);
      const right = checkAnswer(s, content, submit(exercise, model));
      assert.ok(right.ok && right.correct, `model answer for ${s.id}`);
      const wrong = checkAnswer(s, content, submit(exercise, [...model, model[0]]));
      assert.ok(wrong.ok && !wrong.correct);
      assert.equal(wrong.picked, [...model, model[0]].join(" "));
    }
  }
  assert.deepEqual([...seen].sort(), ["cloze", "listen", "read", "tiles", "word"]);
});

test("the server works out for itself what else a sentence exercises", () => {
  for (const exercise of planned()) {
    const answer = exercise.type === "tiles" ? [] : "";
    const verdict = checkAnswer(sentence(exercise.sentence.id), content, submit(exercise, answer));
    assert.ok(verdict.ok);
    assert.deepEqual(verdict.others, exercise.others);
    assert.deepEqual(verdict.primary, exercise.primary);
  }
});

test("sentence-building accepts every order the browser was told is right", () => {
  for (const exercise of planned()) {
    if (exercise.type !== "tiles") continue;
    for (const accepted of exercise.accepted) {
      const verdict = checkAnswer(sentence(exercise.sentence.id), content, submit(exercise, accepted.text.split(" ")));
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
  assert.equal(checkAnswer(s, content, { sentenceId: s.id, exercise: "word", primary: null, answer: "carrot" }).ok, false);
  assert.equal(checkAnswer(s, content, { sentenceId: s.id, exercise: "cloze", primary: null, answer: "x" }).ok, false);
});

test("ungraded practice is still marked, with every part of the sentence as an other", () => {
  const s = content.sentences[0];
  const verdict = checkAnswer(s, content, { sentenceId: s.id, exercise: "listen", primary: null, answer: s.english });
  assert.ok(verdict.ok && verdict.correct);
  assert.deepEqual(verdict.others, componentsOf(s));
});
