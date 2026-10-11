/**
 * M3 — does it actually teach?
 *
 * Runs the scripted learner through a full twenty-turn conversation against the
 * real prompt, then reports every reply with an automated screen and a rating
 * form for a native speaker.
 *
 * Register drift is a late failure: the prompt holds for a few turns and slides
 * back toward literary Persian as the transcript grows. Twenty spoken turns is
 * slow and unrepeatable, so the learner side is scripted — this measures the
 * conversation, not the audio.
 *
 *   npm run spike:conversation
 *
 * The automated screen only flags turns worth a human's attention. It cannot
 * certify a pass: a keyword list already missed a تو/شما switch once
 * (FINDINGS §10), which is why every turn still gets rating controls.
 */

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import dotenv from "dotenv";

import { SCRIPT, type ScriptedTurn } from "./conversation-script.ts";
import { buildMessages, type ChatTurn } from "../research/conversation-v1/src/lib/prompt.ts";
import { flagsFor, scanRegister, type RegisterScan } from "../src/lib/register.ts";
import { createThrottle, isDailyQuota, isRateLimit, sleep } from "../src/lib/throttle.ts";

dotenv.config({ path: ".env.local", quiet: true });

const OUT_DIR = path.resolve("spike/out/conversation");
const MODEL = process.env.OPENAI_CHAT_MODEL ?? "gpt-4o";
const INTERVAL_MS = Number(process.env.OPENAI_TTS_INTERVAL_MS ?? 1_000);

type Exchange = {
  turn: ScriptedTurn;
  reply: string;
  scan: RegisterScan;
  flags: string[];
  ms: number;
  error?: string;
};

function escapeHtml(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

const PROBE_COLOUR: Record<string, string> = {
  normal: "",
  "planted-error": "err",
  "code-switch": "sw",
  request: "req",
};

async function main() {
  if (!process.env.OPENAI_API_KEY) {
    console.error("Needs OPENAI_API_KEY in .env.local");
    process.exit(1);
  }
  const { default: OpenAI } = await import("openai");
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY, maxRetries: 0, timeout: 60_000 });

  await mkdir(OUT_DIR, { recursive: true });
  const throttle = createThrottle(INTERVAL_MS);

  console.log(`model: ${MODEL}\n${SCRIPT.length} turns, one continuous conversation\n`);

  const history: ChatTurn[] = [];
  const exchanges: Exchange[] = [];

  for (const turn of SCRIPT) {
    history.push({ role: "user", content: turn.says });
    // Terminal output stays ASCII — Persian renders reversed in most terminals.
    process.stdout.write(`  turn ${String(turn.index).padStart(2)} (${turn.probe}) ... `);

    let reply = "";
    let ms = 0;
    let error: string | undefined;

    for (let attempt = 1; ; attempt++) {
      await throttle();
      try {
        const started = Date.now();
        const completion = await client.chat.completions.create({
          model: MODEL,
          messages: buildMessages(history, { maxSentences: 1 }),
          max_tokens: 120,
          temperature: 0.8,
        });
        ms = Date.now() - started;
        reply = completion.choices[0]?.message?.content?.trim() ?? "";
        break;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        if (isRateLimit(err) && !isDailyQuota(err) && attempt < 3) {
          console.log(`rate limited, retrying`);
          await sleep(INTERVAL_MS * attempt * 4);
          continue;
        }
        error = message;
        break;
      }
    }

    if (error) {
      console.log(`FAILED: ${error}`);
      exchanges.push({
        turn,
        reply: "",
        scan: scanRegister(""),
        flags: [],
        ms: 0,
        error,
      });
      break;
    }

    // The assistant's reply goes back into history, so drift compounds exactly
    // as it would in a real conversation.
    history.push({ role: "assistant", content: reply });

    const scan = scanRegister(reply);
    const flags = flagsFor(scan);
    exchanges.push({ turn, reply, scan, flags, ms });
    console.log(`${ms}ms  ${scan.words}w  ${flags.length ? "FLAGS: " + flags.join(", ") : "clean"}`);
  }

  // ---- summary -----------------------------------------------------------
  const done = exchanges.filter((e) => !e.error);
  const firstHalf = done.slice(0, Math.floor(done.length / 2));
  const secondHalf = done.slice(Math.floor(done.length / 2));
  const avg = (list: Exchange[], pick: (e: Exchange) => number) =>
    list.length === 0 ? 0 : list.reduce((n, e) => n + pick(e), 0) / list.length;

  console.log("\n=== drift check: first half vs second half ===");
  console.log(
    `  literary forms   ${avg(firstHalf, (e) => e.scan.literary).toFixed(2)}  ->  ` +
      `${avg(secondHalf, (e) => e.scan.literary).toFixed(2)}`,
  );
  console.log(
    `  colloquial forms ${avg(firstHalf, (e) => e.scan.colloquial).toFixed(2)}  ->  ` +
      `${avg(secondHalf, (e) => e.scan.colloquial).toFixed(2)}`,
  );
  console.log(
    `  reply length     ${avg(firstHalf, (e) => e.scan.words).toFixed(1)}w  ->  ` +
      `${avg(secondHalf, (e) => e.scan.words).toFixed(1)}w`,
  );
  const flagged = done.filter((e) => e.flags.length > 0);
  console.log(`\n  ${flagged.length}/${done.length} turns flagged for review`);
  for (const e of flagged) console.log(`    turn ${e.turn.index}: ${e.flags.join(", ")}`);

  // ---- report ------------------------------------------------------------
  const maxWords = Math.max(1, ...done.map((e) => e.scan.words));
  const driftBars = done
    .map(
      (e) => `<div class="bar" title="turn ${e.turn.index}">
        <i style="height:${(e.scan.words / maxWords) * 100}%" class="${e.scan.literary > 0 ? "lit" : ""}"></i>
        <span>${e.turn.index}</span>
      </div>`,
    )
    .join("");

  const rows = exchanges
    .map((e) => {
      const flagHtml = e.flags.map((f) => `<span class="flag">${escapeHtml(f)}</span>`).join("");
      return `<section class="turn ${PROBE_COLOUR[e.turn.probe] ?? ""}" id="t${e.turn.index}">
      <header>
        <span class="n">${e.turn.index}</span>
        <span class="probe">${escapeHtml(e.turn.probe)}</span>
        <span class="meta">${e.scan.words} words · ${e.ms}ms</span>
        ${flagHtml}
      </header>
      <p class="learner" dir="rtl" lang="fa">${escapeHtml(e.turn.says)}</p>
      <p class="translit">${escapeHtml(e.turn.translit)} — ${escapeHtml(e.turn.english)}</p>
      <p class="expect"><strong>Should:</strong> ${escapeHtml(e.turn.expect)}</p>
      ${
        e.error
          ? `<p class="err">${escapeHtml(e.error)}</p>`
          : `<p class="reply" dir="rtl" lang="fa">${escapeHtml(e.reply)}</p>`
      }
      <div class="rate">
        <span>Register colloquial?</span>
        <label><input type="radio" name="reg-${e.turn.index}" value="yes"> yes</label>
        <label><input type="radio" name="reg-${e.turn.index}" value="no"> no</label>
        <span class="sep">·</span>
        <span>Natural for a waiter?</span>
        <label><input type="radio" name="char-${e.turn.index}" value="yes"> yes</label>
        <label><input type="radio" name="char-${e.turn.index}" value="no"> no</label>
        ${
          e.turn.probe === "planted-error"
            ? `<span class="sep">·</span><span>Recast the mistake?</span>
               <label><input type="radio" name="recast-${e.turn.index}" value="yes"> yes</label>
               <label><input type="radio" name="recast-${e.turn.index}" value="explained"> explained it</label>
               <label><input type="radio" name="recast-${e.turn.index}" value="ignored"> ignored it</label>`
            : ""
        }
        <input class="note" name="note-${e.turn.index}" placeholder="What was wrong?">
      </div>
    </section>`;
    })
    .join("");

  await writeFile(
    path.join(OUT_DIR, "index.html"),
    `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>M3 — twenty-turn conversation review</title>
<style>
  :root { color-scheme: light dark; --line: color-mix(in srgb, currentColor 15%, transparent); }
  body { font: 16px/1.55 system-ui, sans-serif; max-width: 54rem; margin: 0 auto; padding: 1.5rem 1.25rem 6rem; }
  h1 { font-size: 1.5rem; margin-bottom: .2rem; }
  .intro { opacity: .85; margin-top: 0; }
  .chart { display: flex; gap: 3px; align-items: flex-end; height: 5rem; margin: 1.5rem 0 .3rem;
           border-bottom: 1px solid var(--line); }
  .bar { flex: 1; display: flex; flex-direction: column; justify-content: flex-end; align-items: center; height: 100%; }
  .bar i { display: block; width: 100%; background: color-mix(in srgb, currentColor 35%, transparent); border-radius: 2px 2px 0 0; }
  .bar i.lit { background: #c0392b; }
  .bar span { font-size: .6rem; opacity: .5; }
  .chartnote { font-size: .78rem; opacity: .7; margin: 0 0 2rem; }
  .turn { border-top: 1px solid var(--line); padding-top: 1rem; margin-top: 1.4rem; }
  .turn.err { border-left: 3px solid #c9761a; padding-left: .8rem; }
  .turn.sw { border-left: 3px solid #6b8fc9; padding-left: .8rem; }
  .turn.req { border-left: 3px solid #7fb069; padding-left: .8rem; }
  header { display: flex; align-items: center; gap: .5rem; flex-wrap: wrap; font-size: .75rem; }
  .n { font-weight: 700; font-size: 1rem; opacity: .5; }
  .probe { text-transform: uppercase; letter-spacing: .05em; opacity: .6; }
  .meta { opacity: .5; font-variant-numeric: tabular-nums; }
  .flag { background: #c0392b; color: white; padding: .1rem .45rem; border-radius: 1rem; font-size: .68rem; }
  .learner { font-size: 1.35rem; margin: .5rem 0 .1rem; opacity: .75; }
  .translit { font-size: .82rem; font-style: italic; opacity: .6; margin: 0 0 .4rem; }
  .expect { font-size: .8rem; opacity: .7; background: color-mix(in srgb, currentColor 5%, transparent);
            padding: .4rem .6rem; border-radius: .4rem; margin: .3rem 0; }
  .reply { font-size: 1.7rem; line-height: 1.7; margin: .5rem 0; }
  .err { color: #c0392b; font-size: .85rem; }
  .rate { display: flex; gap: .45rem; align-items: center; flex-wrap: wrap; font-size: .8rem;
          margin-top: .6rem; opacity: .9; }
  .sep { opacity: .3; }
  .note { flex: 1 1 100%; margin-top: .3rem; padding: .3rem .5rem; border: 1px solid var(--line);
          border-radius: .35rem; background: transparent; color: inherit; font: inherit; font-size: .8rem; }
  .bar-fixed { position: fixed; inset: auto 0 0 0; display: flex; gap: 1rem; justify-content: center;
               padding: .75rem; background: Canvas; border-top: 1px solid var(--line); }
  button { font: inherit; padding: .5rem 1rem; border-radius: .4rem; border: 1px solid var(--line);
           background: transparent; color: inherit; cursor: pointer; }
  #score { font-size: .85rem; font-variant-numeric: tabular-nums; align-self: center; }
</style></head>
<body>
<h1>Twenty-turn conversation review</h1>
<p class="intro">
  One continuous conversation with the real prompt — each reply was fed back in, so drift
  compounds as it would in use. <strong>Register drift is a late failure</strong>, so pay most
  attention to the last third. Coloured left edges mark planted mistakes (orange), English from
  the learner (blue), and explicit requests (green).
</p>

<div class="chart">${driftBars}</div>
<p class="chartnote">Reply length by turn. Red bars contain a literary form — growth or reddening toward the right is drift.</p>

${rows}

<div class="bar-fixed">
  <span id="score"></span>
  <button id="export">Export review</button>
</div>

<script>
  const KEY = 'm3-review';
  const saved = JSON.parse(localStorage.getItem(KEY) || '{}');
  for (const el of document.querySelectorAll('input')) {
    const v = saved[el.name];
    if (v === undefined) continue;
    if (el.type === 'radio') el.checked = (el.value === v); else el.value = v;
  }
  function collect() {
    const out = {};
    for (const el of document.querySelectorAll('input')) {
      if (el.type === 'radio') { if (el.checked) out[el.name] = el.value; }
      else if (el.value) { out[el.name] = el.value; }
    }
    return out;
  }
  function score() {
    const total = document.querySelectorAll('.turn').length;
    const rated = new Set(
      [...document.querySelectorAll('input[name^=reg-]:checked')].map(e => e.name)
    ).size;
    const bad = [...document.querySelectorAll('input[name^=reg-]:checked')].filter(e => e.value === 'no').length;
    document.getElementById('score').textContent = rated + ' / ' + total + ' rated · ' + bad + ' register failures';
  }
  document.addEventListener('input', () => { localStorage.setItem(KEY, JSON.stringify(collect())); score(); });
  score();
  document.getElementById('export').addEventListener('click', () => {
    const blob = new Blob([JSON.stringify(collect(), null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'm3-review.json';
    a.click();
  });
</script>
</body></html>`,
  );

  console.log(`\nWrote ${OUT_DIR}/index.html`);
  console.log(`Open it:  open ${OUT_DIR}/index.html`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
