import assert from "node:assert/strict";
import { test } from "node:test";
import { buildTheme, validateCourse, validateTheme } from "./build.ts";
import { P, W } from "./common.ts";
import { PATTERNS, THEMES } from "./index.ts";
import { introducedState } from "../lesson/grade.ts";
import { planSession } from "../lesson/plan.ts";
import { targetKey, type KnowledgeState } from "../lesson/types.ts";
import type { ThemeSeed } from "./types.ts";

for (const theme of THEMES) {
  test(`${theme.id}: ladder adds at most one new thing per sentence`, () => {
    assert.deepEqual(validateTheme(theme), []);
  });

  test(`${theme.id}: starts with a single word`, () => {
    assert.equal(buildTheme(theme).sentences[0].tokens.length, 1);
  });
}

test("the themes fit together as one course", () => {
  assert.deepEqual(validateCourse(THEMES), []);
});

test("themes are listed in the order they are taught", () => {
  const positions = THEMES.map((t) => t.position);
  assert.deepEqual(positions, [...positions].sort((a, b) => a - b));
});

test("shared words and patterns are filed under their own ids", () => {
  for (const [key, item] of [...Object.entries(W), ...Object.entries(P)]) assert.equal(item.id, key);
});

test("every shared word and pattern is used by a theme", () => {
  const used = new Set(THEMES.flatMap((t) => [...t.lexemes, ...t.patterns]).map((item) => item.id));
  assert.deepEqual([...Object.keys(W), ...Object.keys(P)].filter((id) => !used.has(id)), []);
});

test("PATTERNS lists each curated pattern once", () => {
  const ids = PATTERNS.map((p) => p.id);
  assert.equal(new Set(ids).size, ids.length);
  assert.deepEqual(new Set(ids), new Set(THEMES.flatMap((t) => t.patterns.map((p) => p.id))));
});

test("a learner taking the themes in order is taught every word and pattern exactly once", () => {
  const knowledge = new Map<string, KnowledgeState>();
  const introduced: string[] = [];
  const now = new Date("2026-01-01T09:00:00Z");
  for (const theme of THEMES) {
    const content = buildTheme(theme);
    for (let session = 0; ; session++) {
      assert.ok(session < 100, `${theme.id}: the ladder never ran out`);
      const plan = planSession(content, knowledge, { now, seed: session });
      for (const exercise of plan.exercises) {
        if (exercise.type === "intro-lexeme" || exercise.type === "intro-pattern") {
          introduced.push(targetKey(exercise.target));
          knowledge.set(targetKey(exercise.target), introducedState(now));
          continue;
        }
        // Every question has its answer among distinct options.
        if (exercise.type === "choice") {
          assert.ok(exercise.answer >= 0, `${theme.id} ${exercise.key}: no right answer offered`);
          assert.equal(new Set(exercise.options).size, exercise.options.length, `${theme.id} ${exercise.key}: repeated option`);
        }
      }
      if (plan.newCount === 0) break;
    }
  }
  const taught = new Set(THEMES.flatMap((t) => [...t.lexemes.map((l) => `lexeme:${l.id}`), ...t.patterns.map((p) => `pattern:${p.id}`)]));
  assert.equal(introduced.length, new Set(introduced).size, "something was introduced twice");
  assert.deepEqual(new Set(introduced), taught);
});

const base: ThemeSeed = {
  id: "t",
  title: "T",
  titleFa: "ت",
  description: "",
  position: 0,
  lexemes: [
    { id: "a", fa: "سیب", voc: "سیب", translit: "sib", gloss: "apple" },
    { id: "b", fa: "دارم", voc: "دارَم", translit: "dâram", gloss: "I have" },
  ],
  patterns: [],
  sentences: [{ english: "Apple.", tokens: ["a"] }, { english: "I have apples.", tokens: ["a", "b"] }],
};

test("validateTheme accepts a well-formed ladder", () => {
  assert.deepEqual(validateTheme(base), []);
});

test("validateTheme rejects a sentence that introduces two things", () => {
  const problems = validateTheme({ ...base, sentences: [base.sentences[1]] });
  assert.equal(problems.length, 1);
  assert.match(problems[0], /introduces 2 new things/);
});

test("validateTheme rejects a vowelled form that spells a different word", () => {
  const lexemes = [{ ...base.lexemes[0], voc: "سَبد" }, base.lexemes[1]];
  assert.match(validateTheme({ ...base, lexemes }).join("\n"), /does not reduce/);
});

test("validateTheme reports unknown and unused lexemes", () => {
  assert.match(validateTheme({ ...base, sentences: [{ english: "x", tokens: ["zzz"] }] }).join("\n"), /unknown lexeme "zzz"/);
  assert.match(validateTheme({ ...base, sentences: [base.sentences[0]] }).join("\n"), /"b" is never used/);
});

test("validateTheme rejects a transliteration the audio listener could not check", () => {
  const withTranslit = (translit: string) => validateTheme({ ...base, lexemes: [{ ...base.lexemes[0], translit }, base.lexemes[1]] });
  assert.match(withTranslit("Sib").join("\n"), /not in the course's alphabet/);
  assert.match(withTranslit("sīb").join("\n"), /not in the course's alphabet/);
  assert.match(withTranslit("si b").join("\n"), /not the same number of words/);
  assert.deepEqual(withTranslit("sib-e"), []);
});

const second: ThemeSeed = { ...base, id: "u", position: 1 };

test("validateCourse accepts themes that share a word", () => {
  const sentences = [{ english: "An apple!", tokens: ["a"], end: "!" as const }];
  assert.deepEqual(validateCourse([base, { ...second, sentences }]), []);
});

test("validateCourse rejects a sentence another theme already has", () => {
  assert.deepEqual(validateCourse([base, { ...second, sentences: [base.sentences[0]] }]), ["u-001 repeats t-001"]);
});

test("validateCourse rejects one id with two definitions", () => {
  const lexemes = [{ ...base.lexemes[0], gloss: "apples" }, base.lexemes[1]];
  const problems = validateCourse([base, { ...second, lexemes, sentences: [] }]);
  assert.match(problems.join("\n"), /lexeme "a" is defined differently in t and u/);
});

test("validateCourse rejects two words with one spelling", () => {
  const lexemes = [{ ...base.lexemes[0], id: "c", translit: "seyb", gloss: "slope" }];
  const problems = validateCourse([base, { ...second, lexemes, sentences: [] }]);
  assert.match(problems.join("\n"), /"a" and "c" are both spelled سیب/);
});

test("validateCourse rejects one English sentence for two Persian ones", () => {
  const sentences = [{ english: "I have apples.", tokens: ["b", "a"] }];
  assert.match(validateCourse([base, { ...second, sentences }]).join("\n"), /share the English "I have apples\." but not the Persian/);
});

test("validateCourse rejects two themes in one place", () => {
  assert.match(validateCourse([base, { ...second, position: 0, sentences: [] }]).join("\n"), /two themes at position 0/);
});
