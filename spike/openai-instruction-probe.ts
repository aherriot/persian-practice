/**
 * Can OpenAI's instruction-following TTS fix Persian homographs?
 *
 * Azure ignores context entirely for short-vowel ambiguity: 15/15 common
 * readings correct, 0/15 less-common readings correct (see FINDINGS.md §5). It
 * offers no phoneme control for fa-IR, so there is no SSML lever left.
 *
 * gpt-4o-mini-tts is different in kind — it takes free-text `instructions`, so
 * "this word means worm, pronounce it kerm" is expressible in a way no classical
 * engine allows. If that works it is the only known mechanism for correct
 * Persian homograph pronunciation, and it reopens the vendor choice.
 *
 * Three arms per word:
 *   A  no instructions                  — control, expected to fail like Azure
 *   B  instruction stating the reading  — does naming it help?
 *   C  B plus an explicit negative      — does contrast help more?
 *
 *   npm run spike:instruct
 *
 * Paced at one request per 3s (OPENAI_TTS_INTERVAL_MS to override).
 */

import { mkdir, writeFile, access } from "node:fs/promises";
import path from "node:path";
import dotenv from "dotenv";

import { HOMOGRAPHS, type Homograph, type Reading } from "./homographs.ts";
import { synthesize, type TtsArm } from "../src/lib/tts-provider.ts";
import { createThrottle, isDailyQuota, isRateLimit, sleep } from "../src/lib/throttle.ts";

dotenv.config({ path: ".env.local", quiet: true });

const OUT_DIR = path.resolve("spike/out/instruct");
const VOICE = "alloy";
const INTERVAL_MS = Number(process.env.OPENAI_TTS_INTERVAL_MS ?? 3_000);

/**
 * The less-common readings Azure got wrong, chosen for breadth: the original
 * failure, core grammar, beginner numerals, everyday nouns, and a unit of
 * measure. Deliberately a subset — this is a yes/no question about whether the
 * mechanism works at all, and 18 requests answers it.
 */
const TARGET_WORDS = ["کرم", "مرد", "نه", "گل", "گرم", "شش"];

type Case = {
  homograph: Homograph;
  /** The reading we want, which Azure could not produce. */
  want: Reading;
  /** The frequency-default the engine will otherwise fall back to. */
  fallback: Reading;
};

const CASES: Case[] = TARGET_WORDS.map((word) => {
  const homograph = HOMOGRAPHS.find((h) => h.word === word);
  if (!homograph) throw new Error(`No homograph entry for ${word}`);
  const want = homograph.readings.find((r) => r.frequency === "less common")!;
  const fallback = homograph.readings.find((r) => r.frequency === "common")!;
  return { homograph, want, fallback };
});

type Strategy = {
  id: "plain" | "named" | "contrastive";
  label: string;
  build: (c: Case) => string | undefined;
};

const STRATEGIES: Strategy[] = [
  {
    id: "plain",
    label: "A — no instructions (control)",
    build: () => undefined,
  },
  {
    id: "named",
    label: "B — instruction names the reading",
    build: (c) =>
      `This is Persian. The word "${c.homograph.word}" in this sentence means "${c.want.gloss}" ` +
      `and must be pronounced "${c.want.translit}". Read the sentence naturally at a conversational pace.`,
  },
  {
    id: "contrastive",
    label: "C — instruction names it and rules out the default",
    build: (c) =>
      `This is Persian. The word "${c.homograph.word}" is ambiguous in writing because Persian omits ` +
      `short vowels. Here it means "${c.want.gloss}" and must be pronounced "${c.want.translit}". ` +
      `Do NOT pronounce it "${c.fallback.translit}", which would mean "${c.fallback.gloss}". ` +
      `Read the sentence naturally at a conversational pace.`,
  },
];

async function exists(file: string): Promise<boolean> {
  try {
    await access(file);
    return true;
  } catch {
    return false;
  }
}

function escapeHtml(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function highlight(sentence: string, word: string): string {
  const at = sentence.indexOf(word);
  if (at === -1) return escapeHtml(sentence);
  return (
    escapeHtml(sentence.slice(0, at)) +
    `<mark>${escapeHtml(sentence.slice(at, at + word.length))}</mark>` +
    escapeHtml(sentence.slice(at + word.length))
  );
}

async function main() {
  if (!process.env.OPENAI_API_KEY) {
    console.error("Needs OPENAI_API_KEY in .env.local");
    process.exit(1);
  }

  await mkdir(OUT_DIR, { recursive: true });
  const throttle = createThrottle(INTERVAL_MS);
  const total = CASES.length * STRATEGIES.length;

  console.log(`Voice: ${VOICE} (gpt-4o-mini-tts)`);
  console.log(`${CASES.length} words x ${STRATEGIES.length} strategies = ${total} requests`);
  console.log(`Paced at 1 per ${INTERVAL_MS / 1000}s → ~${Math.ceil((total * INTERVAL_MS) / 1000)}s\n`);

  const failures = new Map<string, string>();
  let done = 0;

  outer: for (const testCase of CASES) {
    for (const strategy of STRATEGIES) {
      const id = `${testCase.want.id}--${strategy.id}`;
      const file = path.join(OUT_DIR, `${id}.mp3`);
      if (await exists(file)) {
        done++;
        console.log(`  [${done}/${total}] ${id} … cached`);
        continue;
      }

      const arm: TtsArm = {
        id,
        provider: "openai",
        voice: VOICE,
        label: strategy.label,
        ...(strategy.build(testCase) ? { instructions: strategy.build(testCase) } : {}),
      };

      for (let attempt = 1; ; attempt++) {
        await throttle();
        try {
          const audio = await synthesize(arm, testCase.want.sentence);
          await writeFile(file, audio);
          done++;
          console.log(`  [${done}/${total}] ${id} … ok`);
          break;
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          if (isDailyQuota(err)) {
            failures.set(id, message);
            console.log(`\n  Daily quota exhausted — stopping. Rendered clips are kept; re-run to resume.\n`);
            break outer;
          }
          if (isRateLimit(err) && attempt < 3) {
            const backoff = INTERVAL_MS * attempt * 3;
            console.log(`  ! ${id} — rate limited, backing off ${backoff / 1000}s (attempt ${attempt}/3)`);
            await sleep(backoff);
            continue;
          }
          done++;
          failures.set(id, message);
          console.log(`  [${done}/${total}] ${id} … FAILED: ${message}`);
          break;
        }
      }
    }
  }

  const sections = CASES.map((testCase) => {
    const clips = STRATEGIES.map((strategy) => {
      const id = `${testCase.want.id}--${strategy.id}`;
      const instructions = strategy.build(testCase);
      const body = failures.has(id)
        ? `<p class="err">${escapeHtml(failures.get(id)!)}</p>`
        : `<audio controls preload="none" src="${id}.mp3"></audio>`;
      return `
      <div class="arm" data-arm="${strategy.id}" data-clip="${id}">
        <h4>${escapeHtml(strategy.label)}</h4>
        ${
          instructions
            ? `<pre>${escapeHtml(instructions)}</pre>`
            : `<pre class="none">(no instructions field sent)</pre>`
        }
        ${body}
        <div class="verdict">
          <label><input type="radio" name="v-${id}" value="correct"> Correct</label>
          <label><input type="radio" name="v-${id}" value="wrong"> Wrong</label>
          <label><input type="radio" name="v-${id}" value="unclear"> Unclear</label>
        </div>
      </div>`;
    }).join("");

    return `
  <section class="case">
    <h2 dir="rtl" lang="fa">${escapeHtml(testCase.homograph.word)}</h2>
    <p class="want">
      want <strong>${escapeHtml(testCase.want.translit)}</strong> (${escapeHtml(testCase.want.gloss)})
      &nbsp;·&nbsp; Azure produced <em>${escapeHtml(testCase.fallback.translit)}</em>
      (${escapeHtml(testCase.fallback.gloss)})
    </p>
    <p class="fa" dir="rtl" lang="fa">${highlight(testCase.want.sentence, testCase.homograph.word)}</p>
    <p class="translit">${escapeHtml(testCase.want.sentenceTranslit)}</p>
    <p class="en">“${escapeHtml(testCase.want.english)}”</p>
    <div class="arms">${clips}</div>
  </section>`;
  }).join("");

  await writeFile(
    path.join(OUT_DIR, "index.html"),
    `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>OpenAI instruction-following TTS — Persian homographs</title>
<style>
  :root { color-scheme: light dark; --line: color-mix(in srgb, currentColor 15%, transparent); }
  body { font: 16px/1.55 system-ui, sans-serif; max-width: 60rem; margin: 0 auto; padding: 1.5rem 1.25rem 7rem; }
  h1 { font-size: 1.5rem; margin-bottom: .25rem; }
  h2 { font-size: 2rem; margin: 0 0 .1rem; }
  h4 { font-size: .85rem; margin: 0 0 .35rem; opacity: .85; }
  .intro { opacity: .85; margin-top: 0; }
  .case { border-top: 1px solid var(--line); padding-top: 1.4rem; margin-top: 2rem; }
  .want { font-size: .9rem; opacity: .8; margin: .1rem 0 .4rem; }
  .fa { font-size: 1.7rem; line-height: 1.8; margin: .3rem 0 .1rem; }
  mark { background: color-mix(in srgb, #c9761a 35%, transparent); color: inherit; border-radius: .2rem; padding: 0 .15rem; }
  .translit { font-style: italic; opacity: .75; margin: 0; font-size: .88rem; }
  .en { opacity: .65; margin: .15rem 0 .7rem; font-size: .85rem; }
  .arms { display: grid; gap: .8rem; grid-template-columns: repeat(auto-fit, minmax(17rem, 1fr)); }
  .arm { border: 1px solid var(--line); border-radius: .6rem; padding: .8rem .9rem; }
  pre { background: color-mix(in srgb, currentColor 8%, transparent); padding: .5rem .6rem; border-radius: .4rem;
        font-size: .72rem; white-space: pre-wrap; margin: 0 0 .5rem; max-height: 8rem; overflow-y: auto; }
  pre.none { opacity: .5; font-style: italic; }
  audio { width: 100%; }
  .verdict { display: flex; gap: .6rem; flex-wrap: wrap; margin-top: .5rem; font-size: .82rem; }
  .err { color: #c0392b; font-size: .85rem; }
  .bar { position: fixed; inset: auto 0 0 0; display: flex; gap: 1rem; align-items: center; justify-content: center;
         padding: .75rem; background: Canvas; border-top: 1px solid var(--line); flex-wrap: wrap; }
  button { font: inherit; padding: .5rem 1rem; border-radius: .4rem; border: 1px solid var(--line);
           background: transparent; color: inherit; cursor: pointer; }
  #score { font-variant-numeric: tabular-nums; font-size: .88rem; }
  #score b { font-size: 1rem; }
</style></head>
<body>
<h1>Can instructions fix Persian homographs?</h1>
<p class="intro">
  Azure got <strong>0 of 15</strong> less-common readings right and offers no phoneme control for
  Persian. OpenAI's TTS accepts free-text instructions, so this asks whether simply telling it the
  intended pronunciation works. For each clip: <strong>did the highlighted word sound like the
  wanted pronunciation?</strong> Arm A is the control and is expected to fail.
</p>

${sections}

<div class="bar">
  <span id="score"></span>
  <button id="export">Export results</button>
</div>

<script>
  const KEY = 'instruct-results';
  const saved = JSON.parse(localStorage.getItem(KEY) || '{}');
  for (const el of document.querySelectorAll('input')) {
    const v = saved[el.name];
    if (v !== undefined && el.type === 'radio') el.checked = (el.value === v);
  }

  function collect() {
    const out = {};
    for (const el of document.querySelectorAll('input[type=radio]')) if (el.checked) out[el.name] = el.value;
    return out;
  }

  function score() {
    const per = {};
    for (const arm of document.querySelectorAll('.arm')) {
      const k = arm.dataset.arm;
      per[k] = per[k] || { correct: 0, total: 0 };
      per[k].total++;
      const picked = document.querySelector('input[name="v-' + arm.dataset.clip + '"]:checked');
      if (picked && picked.value === 'correct') per[k].correct++;
    }
    document.getElementById('score').innerHTML = Object.entries(per)
      .map(([k, v]) => k + ': <b>' + v.correct + '/' + v.total + '</b>')
      .join(' &nbsp;·&nbsp; ');
  }

  document.addEventListener('input', () => {
    localStorage.setItem(KEY, JSON.stringify(collect()));
    score();
  });
  score();

  document.getElementById('export').addEventListener('click', () => {
    const blob = new Blob([JSON.stringify(collect(), null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'instruct-results.json';
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
