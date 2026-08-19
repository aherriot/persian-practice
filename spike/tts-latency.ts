/**
 * Where does text-to-speech latency actually come from?
 *
 * M2 assumed TTS time scales with text length, so splitting a reply into clauses
 * and synthesising the first one would roughly halve the wait. Measurement says
 * otherwise: 26 chars took 1161ms and 46 chars took 1476ms, so there is roughly
 * a second of fixed cost and only modest scaling with length.
 *
 * If that fixed second is generation time, chunking is the only lever. If the
 * API starts returning audio bytes before the clip is finished, then streaming
 * the *audio* — not just the text — is a far bigger win, and the client should
 * play progressively rather than waiting for a complete file.
 *
 *   npx tsx spike/tts-latency.ts
 */

import dotenv from "dotenv";

import { SELECTED_TTS } from "../src/lib/tts-provider.ts";

dotenv.config({ path: ".env.local", quiet: true });

const SAMPLE = "چشم، یه چایی میارم براتون. غذای خاصی می‌خواین؟";
const RUNS = 3;

type Result = { format: string; firstByteMs: number; completeMs: number; bytes: number };

async function measure(format: string): Promise<Result> {
  const started = Date.now();
  const response = await fetch("https://api.openai.com/v1/audio/speech", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "gpt-4o-mini-tts",
      voice: SELECTED_TTS.voice,
      input: SAMPLE,
      response_format: format,
    }),
  });

  if (!response.ok || !response.body) {
    throw new Error(`HTTP ${response.status}: ${(await response.text()).slice(0, 200)}`);
  }

  const reader = response.body.getReader();
  let firstByteMs = 0;
  let bytes = 0;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    if (!firstByteMs) firstByteMs = Date.now() - started;
    bytes += value.length;
  }

  return { format, firstByteMs, completeMs: Date.now() - started, bytes };
}

const median = (values: number[]) =>
  [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];

async function main() {
  if (!process.env.OPENAI_API_KEY) {
    console.error("Needs OPENAI_API_KEY in .env.local");
    process.exit(1);
  }

  console.log(`voice: ${SELECTED_TTS.voice}, ${SAMPLE.length} chars, ${RUNS} runs per format\n`);

  for (const format of ["mp3", "pcm", "opus"]) {
    const results: Result[] = [];
    for (let i = 0; i < RUNS; i++) {
      try {
        results.push(await measure(format));
      } catch (err) {
        console.log(`  ${format}: ${err instanceof Error ? err.message : String(err)}`);
        break;
      }
    }
    if (results.length === 0) continue;

    const first = median(results.map((r) => r.firstByteMs));
    const complete = median(results.map((r) => r.completeMs));
    console.log(
      `  ${format.padEnd(5)} first byte ${String(first).padStart(5)}ms  ` +
        `complete ${String(complete).padStart(5)}ms  ` +
        `streamable saving ${String(complete - first).padStart(5)}ms  ` +
        `(${results[0].bytes} bytes)`,
    );
  }

  console.log(
    "\n  A large gap between first byte and complete means the API streams audio as it\n" +
      "  generates, and the client should play progressively instead of waiting for a\n" +
      "  finished file. A small gap means the clip is generated up front and chunking\n" +
      "  the text is the only lever available.",
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
