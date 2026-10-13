import assert from "node:assert/strict";
import { test } from "node:test";
import { otherReadings, soundDistance } from "./sounds.ts";

test("other readings change the short vowels and nothing else", () => {
  assert.deepEqual(otherReadings("kerm").sort(), ["karm", "korm"]);
  const havij = otherReadings("havij");
  assert.deepEqual(havij.sort(), ["hevij", "hovij"]);
  for (const reading of otherReadings("dâram")) {
    assert.equal(reading.length, 5);
    assert.ok(reading.startsWith("dâr") && reading.endsWith("m"));
  }
});

test("a word with several short vowels has readings that change more than one", () => {
  const readings = otherReadings("shekar");
  assert.ok(readings.includes("shokr") === false);
  assert.ok(readings.includes("shakar"));
  assert.ok(readings.includes("shokor"));
  assert.ok(!readings.includes("shekar"));
  assert.equal(new Set(readings).size, readings.length);
});

test("a vowel that ends a word is written, so it is left alone while another is in doubt", () => {
  assert.ok(otherReadings("bache").every((reading) => reading.endsWith("e")));
  // Unless it is the only one.
  assert.deepEqual(otherReadings("che").sort(), ["cha", "cho"]);
});

test("a word whose vowels are all written has no other reading", () => {
  assert.deepEqual(otherReadings("sib"), []);
  assert.deepEqual(otherReadings("nun"), []);
  assert.deepEqual(otherReadings("mâ"), []);
});

test("sound distance counts the letters that differ", () => {
  assert.equal(soundDistance("sib", "sib"), 0);
  assert.equal(soundDistance("sib", "sir"), 1);
  assert.equal(soundDistance("nun", "khune"), 3);
  assert.ok(soundDistance("dâram", "dârim") < soundDistance("dâram", "havij"));
});
