import assert from "node:assert/strict";
import { test } from "node:test";

import { flagsFor, scanRegister } from "./register.ts";

test("recognises colloquial Tehrani as clean", () => {
  // A real reply from the running app.
  const scan = scanRegister("چشم، یه چایی میارم. غذا هم می‌خوری؟");
  assert.ok(scan.colloquial > 0);
  assert.equal(scan.literary, 0);
  assert.deepEqual(flagsFor(scan), []);
});

test("flags literary drift", () => {
  const scan = scanRegister("بله، چه کار می‌کنید؟ خانه شما کجاست؟");
  assert.ok(scan.literary > 0);
  assert.ok(flagsFor(scan).includes("literary form"));
});

test("catches mixed تو/شما address, which keyword screens missed before", () => {
  // The gpt-4o-mini failure from FINDINGS §10: informal early, formal later.
  const scan = scanRegister("چی می‌خوای؟ بفرمایید سفارش بدید.");
  assert.ok(scan.formalAddress > 0);
  assert.ok(scan.informalAddress > 0);
  assert.ok(scan.mixedAddress);
  assert.ok(flagsFor(scan).includes("mixed تو/شما"));
});

test("flags the tutor breaking character to explain grammar", () => {
  // The brief is explicit that corrections belong after the conversation.
  const scan = scanRegister("این اشتباه است، باید بگی رفتم.");
  assert.ok(scan.correctionTalk);
  assert.ok(flagsFor(scan).includes("explains grammar"));

  const english = scanRegister("That's the past tense, you should say raftam.");
  assert.ok(english.correctionTalk);
});

test("does not mistake the enclitic contraction for literary است", () => {
  // Regression: "منو اینجاست" was flagged as drift during the M3 run, but the
  // enclitic form is ordinary spoken Persian — the literary version is the one
  // that writes است as a separate word.
  const colloquial = scanRegister("بله، منو اینجاست. غذا چی دوست داری؟");
  assert.equal(colloquial.literary, 0);
  assert.ok(!flagsFor(colloquial).includes("literary form"));

  assert.ok(scanRegister("منو اینجا است.").literary > 0, "the separated form is drift");
});

test("detects English without tripping on Persian punctuation", () => {
  assert.ok(scanRegister("Sure, I can help with that").english);
  assert.ok(!scanRegister("سلام، خوش اومدی!").english);
  assert.ok(!scanRegister("ساعت ۸ صبح").english);
});

test("flags replies that have grown long", () => {
  const short = scanRegister("چشم، الان میارم.");
  assert.ok(!flagsFor(short).includes("long reply"));

  const long = scanRegister(Array.from({ length: 30 }, (_, i) => `کلمه${i}`).join(" "));
  assert.equal(long.words, 30);
  assert.ok(flagsFor(long).includes("long reply"));
});

test("counts words without being fooled by extra whitespace", () => {
  assert.equal(scanRegister("  یه   چایی   ").words, 2);
  assert.equal(scanRegister("").words, 0);
});
