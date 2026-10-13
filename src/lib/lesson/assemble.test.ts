import assert from "node:assert/strict";
import { test } from "node:test";
import { buildTheme } from "../content/build.ts";
import { SHOPPING } from "../content/shopping.ts";
import { assembleSentence, type SentenceDraft } from "./assemble.ts";
import { applyForm, formsFor } from "./forms.ts";
import { planSession } from "./plan.ts";
import type { KnowledgeState } from "./types.ts";

const content = buildTheme(SHOPPING);
const lex = (id: string) => content.lexemes.get(id)!;
const everything = { lexemes: new Set(content.lexemes.keys()), patterns: new Set(content.patterns.keys()) };
const word = (id: string, form: SentenceDraft["tokens"][number]["form"] = "base", comma = false) => ({ word: id, form, comma });

test("derived forms match the hand-written ones in the curated content", () => {
  // Every curated token that differs from its lexeme should be reproducible by a form rule.
  for (const s of content.sentences) {
    for (const token of s.tokens) {
      const lexeme = lex(token.lexemeId);
      const shape = { lexemeId: token.lexemeId, fa: token.fa, voc: token.voc, translit: token.translit };
      const match = formsFor(lexeme).some((form) => JSON.stringify(applyForm(lexeme, form)) === JSON.stringify(shape));
      assert.ok(match, `${token.voc} (${token.translit}) is not a known form of ${lexeme.id}`);
    }
  }
});

test("negation is na- on a bare verb and ne- before mi-", () => {
  assert.equal(applyForm(lex("daram"), "negated")!.translit, "nadâram");
  assert.deepEqual(applyForm(lex("mikham"), "negated"), {
    lexemeId: "mikham",
    fa: "نمی‌خوام",
    voc: "نِمی‌خوام",
    translit: "nemikhâm",
  });
});

test("possessive endings attach to a noun", () => {
  assert.deepEqual(
    (["my", "your", "his"] as const).map((form) => {
      const token = applyForm(lex("sib"), form)!;
      return `${token.fa} ${token.voc} ${token.translit}`;
    }),
    ["سیبم سیبَم sibam", "سیبت سیبِت sibet", "سیبش سیبِش sibesh"],
  );
});

test("forms that the rules cannot spell are refused", () => {
  assert.equal(applyForm(lex("havij"), "negated"), null); // not a verb
  assert.equal(applyForm(lex("taze"), "is"), null); // ends in a vowel: تازه‌ست, not تازهه
  assert.equal(applyForm(lex("ma"), "linked"), null); // a pronoun
});

test("a draft becomes a sentence with its patterns and punctuation", () => {
  const result = assembleSentence(
    { english: "No, I don't have fresh bread.", kind: "statement", tokens: [word("na", "base", true), word("nun", "linked"), word("taze"), word("daram", "negated")] },
    content.lexemes,
    everything,
  );
  assert.ok(result.ok);
  assert.equal(result.sentence.tokens.map((t) => t.voc + (t.after ?? "")).join(" "), "نَه، نونِ تازِه نَدارَم");
  assert.deepEqual(result.sentence.patternIds.sort(), ["ezafe", "negation"]);
  assert.equal(result.sentence.endPunct, ".");
});

test("a draft using anything the learner has not met is rejected", () => {
  const known = { lexemes: new Set(["havij", "darim", "sib"]), patterns: new Set<string>() };
  const draft = (tokens: SentenceDraft["tokens"], kind: SentenceDraft["kind"] = "statement") =>
    assembleSentence({ english: "x", kind, tokens }, content.lexemes, known);

  assert.ok(draft([word("havij"), word("darim")]).ok);
  assert.deepEqual(draft([word("nun"), word("darim")]), { ok: false, reason: 'unknown word "nun"' });
  assert.deepEqual(draft([word("gojeh"), word("darim")]), { ok: false, reason: 'unknown word "gojeh"' });
  assert.deepEqual(draft([word("havij"), word("darim", "negated")]), { ok: false, reason: "grammar not learned: negation" });
  assert.deepEqual(draft([word("havij"), word("darim")], "yes-no-question"), { ok: false, reason: "grammar not learned: question" });
  assert.deepEqual(draft([word("havij")]), { ok: false, reason: "wrong length" });
});

test("generated sentences are practised but never used to introduce something new", () => {
  const generated = {
    ...content.sentences[1],
    id: "gen-test",
    english: "We have bread and celery.",
    lexemeIds: ["nun", "karafs", "darim"],
    generated: true,
    ladder: false,
  };
  const mixed = { ...content, sentences: [generated, ...content.sentences] };
  const fresh = planSession(mixed, new Map(), { now: new Date("2026-01-01"), seed: 3 });
  const intro = fresh.exercises.find((e) => e.type === "intro-lexeme");
  assert.equal(intro?.type === "intro-lexeme" && intro.lexeme.id, "havij");
  assert.ok(!fresh.exercises.some((e) => "sentence" in e && e.sentence.id === "gen-test"));

  // Once its words are known and due, the least-seen sentence is preferred for review.
  const state: KnowledgeState = { stability: 1, difficulty: 5, intervalDays: 1, repetitions: 1, lapses: 0, dueAt: new Date("2025-12-31"), lastReviewedAt: null };
  const knowledge = new Map(["lexeme:nun", "lexeme:karafs", "lexeme:darim"].map((key) => [key, state]));
  const seen = new Map(content.sentences.map((s) => [s.id, 5]));
  const review = planSession(mixed, knowledge, { now: new Date("2026-01-01"), seed: 3, maxNew: 0, seen });
  assert.ok(review.exercises.some((e) => "sentence" in e && e.sentence.id === "gen-test"));
});
