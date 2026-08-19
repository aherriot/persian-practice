/**
 * Phase 0A follow-up — how often does the short-vowel problem actually bite?
 *
 * Renders both readings of 15 Persian homographs in disambiguating contexts and
 * produces a rating page. The output is a single number that decides an
 * architectural question: whether synthesized speech can carry vocabulary
 * teaching at all, or whether ambiguous words need recorded human audio.
 *
 *   npm run spike:homograph
 *
 * Unlike the bakeoff this is deliberately NOT blind — the rater must know the
 * intended reading to judge correctness. It is a correctness test, not a
 * preference test.
 */

import { mkdir, writeFile, access } from "node:fs/promises";
import path from "node:path";
import dotenv from "dotenv";

import { HOMOGRAPHS } from "./homographs.ts";
import { synthesize, SELECTED_TTS } from "../src/lib/tts-provider.ts";
import { createThrottle, isDailyQuota } from "../src/lib/throttle.ts";

dotenv.config({ path: ".env.local", quiet: true });

// Azure's results are already recorded in FINDINGS.md §5; this directory holds
// whichever voice is currently selected.
const OUT_DIR = path.resolve("spike/out/homographs");

const ARM = SELECTED_TTS;

async function exists(file: string): Promise<boolean> {
  try {
    await access(file);
    return true;
  } catch {
    return false;
  }
}

/**
 * Clip filenames are namespaced by voice. Without this the cache check would
 * silently reuse another voice's audio and the rating would be attributed to the
 * wrong engine.
 */
function clipName(readingId: string): string {
  return `${ARM.voice}--${readingId}.mp3`;
}

function escapeHtml(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

/** Marks the ambiguous word inside the sentence so the rater knows where to listen. */
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
  const needed =
    ARM.provider === "openai"
      ? ["OPENAI_API_KEY"]
      : ["AZURE_SPEECH_KEY", "AZURE_SPEECH_REGION"];
  const missing = needed.filter((name) => !process.env[name]);
  if (missing.length > 0) {
    console.error(`${ARM.label} needs ${missing.join(" and ")} in .env.local`);
    process.exit(1);
  }

  await mkdir(OUT_DIR, { recursive: true });
  // Azure is unmetered on F0; OpenAI needs pacing.
  const throttle = createThrottle(
    ARM.provider === "openai" ? Number(process.env.OPENAI_TTS_INTERVAL_MS ?? 3_000) : 0,
  );
  const total = HOMOGRAPHS.length * 2;
  console.log(`Voice: ${ARM.voice}\nRendering ${total} clips (${HOMOGRAPHS.length} pairs)…\n`);

  const failures = new Map<string, string>();
  outer: for (const homograph of HOMOGRAPHS) {
    for (const reading of homograph.readings) {
      const file = path.join(OUT_DIR, clipName(reading.id));
      if (await exists(file)) {
        console.log(`  ${reading.id} … cached`);
        continue;
      }
      await throttle();
      try {
        const audio = await synthesize(ARM, reading.sentence);
        await writeFile(file, audio);
        console.log(`  ${reading.id} … ok`);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        failures.set(reading.id, message);
        console.log(`  ${reading.id} … FAILED: ${message}`);
        if (isDailyQuota(err)) {
          console.log(`\n  Daily quota exhausted — stopping. Re-run to resume.\n`);
          break outer;
        }
      }
    }
  }

  const sections = HOMOGRAPHS.map((homograph) => {
    const clips = homograph.readings
      .map((reading) => {
        const body = failures.has(reading.id)
          ? `<p class="err">${escapeHtml(failures.get(reading.id)!)}</p>`
          : `<audio controls preload="none" src="${clipName(reading.id)}"></audio>`;
        return `
      <div class="reading" data-reading="${reading.id}" data-frequency="${reading.frequency}">
        <div class="rhead">
          <span class="want">${escapeHtml(reading.translit)}</span>
          <span class="gloss">= ${escapeHtml(reading.gloss)}</span>
          <span class="freq">${escapeHtml(reading.frequency)}</span>
        </div>
        <p class="fa" dir="rtl" lang="fa">${highlight(reading.sentence, homograph.word)}</p>
        <p class="translit">${escapeHtml(reading.sentenceTranslit)}</p>
        <p class="en">“${escapeHtml(reading.english)}”</p>
        ${body}
        <div class="verdict">
          <label><input type="radio" name="v-${reading.id}" value="correct"> Correct</label>
          <label><input type="radio" name="v-${reading.id}" value="wrong"> Wrong</label>
          <label><input type="radio" name="v-${reading.id}" value="unclear"> Unclear</label>
          <input class="notes" name="n-${reading.id}" placeholder="What did it say instead? Is the sentence natural?">
        </div>
      </div>`;
      })
      .join("");

    return `
  <section class="pair">
    <h2 dir="rtl" lang="fa">${escapeHtml(homograph.word)}</h2>
    <p class="note">${escapeHtml(homograph.note)}</p>
    <div class="readings">${clips}</div>
  </section>`;
  }).join("");

  await writeFile(
    path.join(OUT_DIR, "index.html"),
    `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Persian homograph battery — ${escapeHtml(ARM.voice)}</title>
<style>
  :root { color-scheme: light dark; --line: color-mix(in srgb, currentColor 15%, transparent); }
  body { font: 16px/1.55 system-ui, sans-serif; max-width: 56rem; margin: 0 auto; padding: 1.5rem 1.25rem 7rem; }
  h1 { font-size: 1.5rem; margin-bottom: .25rem; }
  h2 { font-size: 2rem; margin: 0 0 .1rem; }
  .intro { opacity: .85; margin-top: 0; }
  .pair { border-top: 1px solid var(--line); padding-top: 1.4rem; margin-top: 2rem; }
  .note { font-size: .85rem; opacity: .75; margin: 0 0 .8rem; }
  .readings { display: grid; gap: .8rem; grid-template-columns: repeat(auto-fit, minmax(20rem, 1fr)); }
  .reading { border: 1px solid var(--line); border-radius: .6rem; padding: .8rem .9rem; }
  .rhead { display: flex; align-items: baseline; gap: .5rem; flex-wrap: wrap; margin-bottom: .3rem; }
  .want { font-weight: 700; font-size: 1.05rem; font-style: italic; }
  .gloss { opacity: .75; font-size: .9rem; }
  .freq { margin-left: auto; font-size: .68rem; text-transform: uppercase; letter-spacing: .05em;
          border: 1px solid var(--line); border-radius: 1rem; padding: .1rem .5rem; opacity: .7; }
  .fa { font-size: 1.6rem; line-height: 1.8; margin: .3rem 0 .1rem; }
  mark { background: color-mix(in srgb, #c9761a 35%, transparent); color: inherit; border-radius: .2rem; padding: 0 .15rem; }
  .translit { font-style: italic; opacity: .75; margin: 0; font-size: .88rem; }
  .en { opacity: .65; margin: .15rem 0 .5rem; font-size: .85rem; }
  audio { width: 100%; }
  .verdict { display: flex; gap: .7rem; align-items: center; flex-wrap: wrap; margin-top: .5rem; font-size: .85rem; }
  .notes { flex: 1 1 100%; padding: .3rem .5rem; border: 1px solid var(--line); border-radius: .35rem;
           background: transparent; color: inherit; font: inherit; font-size: .82rem; }
  .err { color: #c0392b; font-size: .85rem; }
  .bar { position: fixed; inset: auto 0 0 0; display: flex; gap: .9rem; align-items: center; justify-content: center;
         padding: .75rem; background: Canvas; border-top: 1px solid var(--line); flex-wrap: wrap; }
  button { font: inherit; padding: .5rem 1rem; border-radius: .4rem; border: 1px solid var(--line);
           background: transparent; color: inherit; cursor: pointer; }
  #score { font-variant-numeric: tabular-nums; font-size: .9rem; }
  .big { font-weight: 700; }
</style></head>
<body>
<h1>Persian homograph battery — ${escapeHtml(ARM.label)}</h1>
<p class="intro">
  Each word below is spelled the same for two different pronunciations, because Persian omits
  short vowels. The sentence gives context that should force the right one. For each clip:
  <strong>did the highlighted word sound like the italic pronunciation shown?</strong>
  <br>
  The sentences were written by a non-native speaker — please flag any that sound unnatural.
</p>

${sections}

<div class="bar">
  <span id="score"></span>
  <button id="export">Export results</button>
</div>

<script>
  const KEY = 'homograph-results-${ARM.voice}';
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
    let correct = 0, wrong = 0, unclear = 0, rareWrong = 0, rareTotal = 0;
    for (const r of document.querySelectorAll('.reading')) {
      const picked = document.querySelector('input[name="v-' + r.dataset.reading + '"]:checked');
      const rare = r.dataset.frequency === 'less common';
      if (rare) rareTotal++;
      if (!picked) continue;
      if (picked.value === 'correct') correct++;
      else if (picked.value === 'wrong') { wrong++; if (rare) rareWrong++; }
      else unclear++;
    }
    const done = correct + wrong + unclear;
    const total = document.querySelectorAll('.reading').length;
    const pct = done ? Math.round((correct / done) * 100) : 0;
    document.getElementById('score').innerHTML =
      done + ' / ' + total + ' rated &nbsp;·&nbsp; <span class="big">' + pct + '% correct</span>' +
      ' &nbsp;·&nbsp; ' + wrong + ' wrong (' + rareWrong + ' of them the less-common reading, of ' + rareTotal + ')';
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
    a.download = 'homograph-results.json';
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
