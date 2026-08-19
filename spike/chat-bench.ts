/**
 * M1 follow-up — which model and reply length give the best turn latency?
 *
 * Measured server-side in M1: chat ~1.0s, TTS ~1.38s, so ~2.4s before speech
 * recognition, network or playback are counted. That already blows the 1.5s
 * "feels conversational" budget, and M2 (streaming) is the big lever — but two
 * cheaper levers are worth measuring first, because they change how much work
 * streaming still has to do.
 *
 * Chat and TTS are measured *together* on purpose. A smaller model that produces
 * longer replies can be slower overall, since text-to-speech time scales with
 * the number of words spoken. Only the sum is decision-relevant.
 *
 *   npm run spike:chatbench
 */

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import dotenv from "dotenv";

import { LUNCH_SCENARIO, REGISTER_REMINDER, systemPrompt } from "../src/lib/prompt.ts";
import { SELECTED_TTS } from "../src/lib/tts-provider.ts";
import { createThrottle, isDailyQuota, isRateLimit, sleep } from "../src/lib/throttle.ts";

dotenv.config({ path: ".env.local", quiet: true });

const OUT_DIR = path.resolve("spike/out/chatbench");
const INTERVAL_MS = Number(process.env.OPENAI_TTS_INTERVAL_MS ?? 1_500);

/** Realistic beginner turns, including one with a planted grammar mistake. */
const UTTERANCES = [
  "سلام",
  "یه چایی می‌خوام",
  "غذای گیاهی دارید؟",
  "من دیروز اینجا می‌رم", // wrong tense — should be recast, not corrected
  "صورتحساب لطفاً",
];

type Arm = {
  id: string;
  model: string;
  maxSentences: number;
  label: string;
};

const ARMS: Arm[] = [
  { id: "4o-2s", model: "gpt-4o", maxSentences: 2, label: "gpt-4o, up to 2 sentences (current)" },
  { id: "4o-1s", model: "gpt-4o", maxSentences: 1, label: "gpt-4o, one sentence" },
  { id: "mini-2s", model: "gpt-4o-mini", maxSentences: 2, label: "gpt-4o-mini, up to 2 sentences" },
  { id: "mini-1s", model: "gpt-4o-mini", maxSentences: 1, label: "gpt-4o-mini, one sentence" },
];

type Sample = {
  arm: Arm;
  utterance: string;
  reply: string;
  chatMs: number;
  ttsMs: number;
  audioBytes: number;
  error?: string;
};

const median = (values: number[]) => {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
};

function escapeHtml(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

async function main() {
  if (!process.env.OPENAI_API_KEY) {
    console.error("Needs OPENAI_API_KEY in .env.local");
    process.exit(1);
  }
  const { default: OpenAI } = await import("openai");
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY, maxRetries: 0, timeout: 60_000 });

  await mkdir(OUT_DIR, { recursive: true });
  const throttle = createThrottle(INTERVAL_MS);
  const total = ARMS.length * UTTERANCES.length;
  console.log(`${ARMS.length} arms x ${UTTERANCES.length} utterances = ${total} turns`);
  console.log(`each turn is one chat call plus one TTS call\n`);

  const samples: Sample[] = [];
  let done = 0;

  outer: for (const arm of ARMS) {
    for (const utterance of UTTERANCES) {
      done++;
      // Terminal output stays ASCII — most terminals have no bidi support and
      // render Persian reversed. The Persian lives in the HTML report.
      process.stdout.write(`  [${done}/${total}] ${arm.id} ... `);

      try {
        await throttle();
        const chatStart = Date.now();
        const completion = await client.chat.completions.create({
          model: arm.model,
          messages: [
            { role: "system", content: systemPrompt(LUNCH_SCENARIO, { maxSentences: arm.maxSentences }) },
            { role: "user", content: utterance },
            { role: "system", content: REGISTER_REMINDER },
          ],
          max_tokens: 120,
          temperature: 0.8,
        });
        const chatMs = Date.now() - chatStart;
        const reply = completion.choices[0]?.message?.content?.trim() ?? "";

        await throttle();
        const ttsStart = Date.now();
        const speech = await client.audio.speech.create({
          model: "gpt-4o-mini-tts",
          voice: SELECTED_TTS.voice,
          input: reply,
          response_format: "mp3",
        });
        const audio = new Uint8Array(await speech.arrayBuffer());
        const ttsMs = Date.now() - ttsStart;

        samples.push({ arm, utterance, reply, chatMs, ttsMs, audioBytes: audio.byteLength });
        console.log(`chat ${chatMs}ms + tts ${ttsMs}ms = ${chatMs + ttsMs}ms`);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        samples.push({ arm, utterance, reply: "", chatMs: 0, ttsMs: 0, audioBytes: 0, error: message });
        console.log(`FAILED: ${message}`);
        if (isDailyQuota(err)) {
          console.log("\n  Daily quota exhausted — stopping.\n");
          break outer;
        }
        if (isRateLimit(err)) await sleep(INTERVAL_MS * 4);
      }
    }
  }

  console.log("\n=== median latency by arm ===");
  const rows = ARMS.map((arm) => {
    const mine = samples.filter((s) => s.arm.id === arm.id && !s.error);
    const chat = median(mine.map((s) => s.chatMs));
    const tts = median(mine.map((s) => s.ttsMs));
    const chars = median(mine.map((s) => s.reply.length));
    return { arm, chat, tts, total: chat + tts, chars, n: mine.length };
  }).sort((a, b) => a.total - b.total);

  for (const row of rows) {
    console.log(
      `  ${row.arm.id.padEnd(9)} chat ${String(row.chat).padStart(5)}ms  ` +
        `tts ${String(row.tts).padStart(5)}ms  total ${String(row.total).padStart(5)}ms  ` +
        `(${row.chars} chars, n=${row.n})`,
    );
  }
  const best = rows[0];
  const current = rows.find((r) => r.arm.id === "4o-2s");
  if (best && current && best.arm.id !== current.arm.id) {
    console.log(
      `\n  fastest is ${best.arm.id}, saving ${current.total - best.total}ms vs current ` +
        `(${current.total}ms -> ${best.total}ms)`,
    );
  }
  console.log("\n  Latency is only half the question — read the replies in the HTML report");
  console.log("  and check the register held before switching model.");

  const summaryRows = rows
    .map(
      (row) => `<tr>
      <td>${escapeHtml(row.arm.label)}</td>
      <td class="num">${row.chat}ms</td>
      <td class="num">${row.tts}ms</td>
      <td class="num strong">${row.total}ms</td>
      <td class="num">${row.chars}</td>
    </tr>`,
    )
    .join("");

  const blocks = UTTERANCES.map((utterance) => {
    const cells = ARMS.map((arm) => {
      const sample = samples.find((s) => s.arm.id === arm.id && s.utterance === utterance);
      return `<div class="arm">
        <h4>${escapeHtml(arm.label)}</h4>
        ${
          !sample || sample.error
            ? `<p class="err">${escapeHtml(sample?.error ?? "not run")}</p>`
            : `<p class="fa" dir="rtl" lang="fa">${escapeHtml(sample.reply)}</p>
               <p class="num">chat ${sample.chatMs}ms + tts ${sample.ttsMs}ms = <strong>${sample.chatMs + sample.ttsMs}ms</strong></p>`
        }
      </div>`;
    }).join("");

    return `<section>
      <h2 dir="rtl" lang="fa">${escapeHtml(utterance)}</h2>
      <div class="arms">${cells}</div>
    </section>`;
  }).join("");

  await writeFile(
    path.join(OUT_DIR, "index.html"),
    `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Chat model latency and register</title>
<style>
  :root { color-scheme: light dark; --line: color-mix(in srgb, currentColor 15%, transparent); }
  body { font: 16px/1.55 system-ui, sans-serif; max-width: 64rem; margin: 0 auto; padding: 1.5rem 1.25rem 4rem; }
  h1 { font-size: 1.5rem; } h2 { font-size: 1.6rem; margin: 0 0 .6rem; }
  h4 { font-size: .8rem; margin: 0 0 .3rem; opacity: .7; font-weight: 600; }
  table { border-collapse: collapse; width: 100%; margin: 1rem 0 2rem; }
  td, th { border-top: 1px solid var(--line); padding: .5rem .6rem; text-align: left; }
  th { font-size: .75rem; text-transform: uppercase; letter-spacing: .05em; opacity: .7; }
  .num { font-variant-numeric: tabular-nums; text-align: right; white-space: nowrap; }
  .strong { font-weight: 700; }
  section { border-top: 1px solid var(--line); padding-top: 1.2rem; margin-top: 1.6rem; }
  .arms { display: grid; gap: .75rem; grid-template-columns: repeat(auto-fit, minmax(16rem, 1fr)); }
  .arm { border: 1px solid var(--line); border-radius: .6rem; padding: .7rem .85rem; }
  .fa { font-size: 1.25rem; line-height: 1.8; margin: .2rem 0 .4rem; }
  .arm .num { text-align: left; font-size: .78rem; opacity: .7; }
  .err { color: #c0392b; font-size: .8rem; }
  .legend { font-size: .87rem; opacity: .8; }
</style></head>
<body>
<h1>Chat model latency and register</h1>
<p class="legend">
  Chat and text-to-speech measured together, because a smaller model that writes longer replies
  can be slower overall — TTS time scales with words spoken. Latency alone should not decide this:
  check that the Persian stayed colloquial (خوش اومدی, می‌خوای, یه) and did not drift literary
  (خوش آمدید, می‌خواهید, یک).
</p>
<table>
  <thead><tr><th>Arm</th><th class="num">chat</th><th class="num">tts</th><th class="num">total</th><th class="num">chars</th></tr></thead>
  <tbody>${summaryRows}</tbody>
</table>
${blocks}
</body></html>`,
  );

  console.log(`\nWrote ${OUT_DIR}/index.html`);
  console.log(`Open it:  open ${OUT_DIR}/index.html`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
