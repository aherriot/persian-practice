import assert from "node:assert/strict";
import { test } from "node:test";

import { describeUsage } from "./usage.ts";

const NOW = new Date("2026-01-02T03:04:05.000Z");

test("separates hidden reasoning from the rest of the output", () => {
  const report = describeUsage(
    "author:sentences",
    "gpt-5.5-2026-04-23",
    {
      prompt_tokens: 1400,
      completion_tokens: 1700,
      total_tokens: 3100,
      completion_tokens_details: { reasoning_tokens: 1300 },
    },
    NOW,
  );
  assert.deepEqual(report, {
    level: "usage",
    scope: "author:sentences",
    model: "gpt-5.5-2026-04-23",
    input: 1400,
    output: 1700,
    reasoning: 1300,
    inputAudio: undefined,
    time: NOW.toISOString(),
  });
});

test("counts the audio a listener was sent", () => {
  const report = describeUsage(
    "listener",
    "gpt-audio-1.5",
    { prompt_tokens: 235, completion_tokens: 40, total_tokens: 275, prompt_tokens_details: { audio_tokens: 20 } },
    NOW,
  );
  assert.equal(report.inputAudio, 20);
  assert.equal(report.reasoning, undefined);
});
