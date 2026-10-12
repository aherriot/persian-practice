import assert from "node:assert/strict";
import { test } from "node:test";

import { describeError } from "./report-error.ts";

const NOW = new Date("2026-01-02T03:04:05.000Z");

test("describes an Error with its scope, message, stack and context", () => {
  const report = describeError("tts", new TypeError("boom"), { path: "/api/tts" }, NOW);
  assert.equal(report.scope, "tts");
  assert.equal(report.message, "boom");
  assert.equal(report.name, "TypeError");
  assert.equal(report.path, "/api/tts");
  assert.equal(report.time, "2026-01-02T03:04:05.000Z");
  assert.match(report.stack ?? "", /boom/);
});

test("keeps the digest Next puts on a server error", () => {
  const err = Object.assign(new Error("hidden"), { digest: "abc123" });
  assert.equal(describeError("render", err, {}, NOW).digest, "abc123");
});

test("describes a thrown value that is not an Error", () => {
  const report = describeError("words", "just a string", {}, NOW);
  assert.equal(report.message, "just a string");
  assert.equal(report.stack, undefined);
});

test("context cannot overwrite what the report says happened", () => {
  const report = describeError("tts", new Error("real"), { message: "fake", scope: "fake" }, NOW);
  assert.equal(report.message, "real");
  assert.equal(report.scope, "tts");
});

test("is one line of JSON", () => {
  const line = JSON.stringify(describeError("tts", new Error("a\nb"), {}, NOW));
  assert.equal(line.includes("\n"), false);
});
