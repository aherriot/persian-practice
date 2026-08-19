import assert from "node:assert/strict";
import { test } from "node:test";

import { toSsmlWithCardinals } from "./tts-provider.ts";

test("marks Persian-form digits as cardinals", () => {
  // The regression that motivated this: Azure reads "ساعت ۸ صبح" as
  // "sâ'at-e sâ'at hasht-e sobh", saying ساعت twice.
  const out = toSsmlWithCardinals("ساعت ۸ صبح می‌بینمت");
  assert.ok(out.includes('<say-as interpret-as="cardinal">۸</say-as>'));
  assert.ok(out.startsWith("ساعت "));
});

test("marks ASCII and Arabic-Indic digits too", () => {
  // Swapping digit forms does not dodge the normalizer, so all forms need it.
  assert.ok(toSsmlWithCardinals("ساعت 8").includes('cardinal">8</say-as>'));
  assert.ok(toSsmlWithCardinals("ساعت ٨").includes('cardinal">٨</say-as>'));
});

test("keeps multi-digit numbers as a single cardinal", () => {
  const out = toSsmlWithCardinals("۳۵ سالمه");
  assert.ok(out.includes('<say-as interpret-as="cardinal">۳۵</say-as>'));
  // Not one say-as per digit, which would read "three five".
  assert.equal(out.match(/say-as/g)?.length, 2);
});

test("leaves digit-free text untouched apart from escaping", () => {
  assert.equal(toSsmlWithCardinals("سلام، خوبی؟"), "سلام، خوبی؟");
  assert.ok(!toSsmlWithCardinals("سلام").includes("say-as"));
});

test("escapes XML before inserting markup", () => {
  // Text reaches SSML as a document body; unescaped angle brackets or ampersands
  // would produce malformed XML and a 400 from Azure.
  const out = toSsmlWithCardinals('a & b <c> "d"');
  assert.ok(out.includes("&amp;"));
  assert.ok(out.includes("&lt;c&gt;"));
  assert.ok(!out.includes("<c>"));
});

test("escaping cannot be smuggled past via injected markup", () => {
  const out = toSsmlWithCardinals('</voice><voice name="x">hijacked');
  assert.ok(!out.includes("</voice>"));
  assert.ok(out.includes("&lt;/voice&gt;"));
});
