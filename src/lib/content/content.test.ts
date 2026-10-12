import assert from "node:assert/strict";
import { test } from "node:test";
import { buildTheme, validateTheme } from "./build.ts";
import { THEMES } from "./shopping.ts";
import type { ThemeSeed } from "./types.ts";

for (const theme of THEMES) {
  test(`${theme.id}: ladder adds at most one new thing per sentence`, () => {
    assert.deepEqual(validateTheme(theme), []);
  });

  test(`${theme.id}: starts with a single word`, () => {
    assert.equal(buildTheme(theme).sentences[0].tokens.length, 1);
  });
}

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
