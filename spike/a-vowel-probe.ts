/**
 * Does the long vowel â come out Tehrani, and what makes it do so?
 *
 * The project owner reported that some "to have" sentences sound Afghan, and
 * that the giveaway is the â in دارم / داریم. The accent probe (FINDINGS §7)
 * never tested that vowel: its markers were ق/غ, و, the majhul vowels, ey/ay
 * and final ه. The automated listener cannot hear accent either — asked
 * outright it called 175 of 183 listens "Iranian" with no pattern.
 *
 * So this builds a blind page for a human ear. Each sentence is one the app
 * already plays, read once by every arm:
 *
 *   stored          the clip the app serves today
 *   voice           the voice instruction alone (what most clips are made with)
 *   named           the pipeline's fallback instruction, which names the word
 *                   and says nothing about accent — the suspect
 *   named-iranian   the fallback with the accent stated
 *   voice-vowel     the voice instruction plus a description of the vowel
 *   alloy, coral    other voices under the voice instruction
 *   azure-dilara    a purpose-built fa-IR voice, as a reference
 *
 * Usage: npm run spike:avowel      then open spike/out/a-vowel/index.html
 */
import "../scripts/load-env.ts";

import { get } from "@vercel/blob";
import { inArray } from "drizzle-orm";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { VOICE_INSTRUCTION } from "../src/lib/audio-key.ts";
import { db } from "../src/lib/db/index.ts";
import { audioClips } from "../src/lib/db/schema.ts";
import { createThrottle, isRateLimit, sleep } from "../src/lib/throttle.ts";
import { synthesize, type TtsArm } from "../src/lib/tts-provider.ts";

const OUT_DIR = path.resolve("spike/out/a-vowel");
const INTERVAL_MS = 1_000;

/** Clips the app already has, by the transliteration they are checked against. */
const SENTENCES: { expected: string; verb: number }[] = [
  { expected: "dâram", verb: 0 },
  { expected: "mâ sib dârim", verb: 2 },
  { expected: "âre havij dâram", verb: 2 },
  { expected: "salâm nun-e tâze dârin", verb: 3 },
];

const VOWEL =
  'The long vowel "â" (written ا or آ) is the Tehran vowel: back and rounded, close to the vowel in English "law". It is never the open "a" of "father".';

type Arm = { id: string; label: string; voice?: string; provider?: "azure"; instructions?: (word: string, translit: string) => string };

const ARMS: Arm[] = [
  { id: "stored", label: "What the app plays today" },
  { id: "voice", label: "nova — voice instruction", voice: "nova", instructions: () => VOICE_INSTRUCTION },
  {
    id: "named",
    label: "nova — fallback instruction (no accent stated)",
    voice: "nova",
    instructions: (word, translit) =>
      `This is Persian. The word "${word}" must be pronounced "${translit}". Read the sentence naturally at a conversational pace.`,
  },
  {
    id: "named-iranian",
    label: "nova — fallback instruction, accent stated",
    voice: "nova",
    instructions: (word, translit) =>
      `This is Iranian Persian, spoken with a Tehrani accent. The word "${word}" must be pronounced "${translit}". Read the sentence naturally at a conversational pace.`,
  },
  { id: "voice-vowel", label: "nova — voice instruction + vowel described", voice: "nova", instructions: () => `${VOICE_INSTRUCTION} ${VOWEL}` },
  { id: "alloy", label: "alloy — voice instruction", voice: "alloy", instructions: () => VOICE_INSTRUCTION },
  { id: "coral", label: "coral — voice instruction", voice: "coral", instructions: () => VOICE_INSTRUCTION },
  { id: "azure-dilara", label: "Azure fa-IR-DilaraNeural (reference)", voice: "fa-IR-DilaraNeural", provider: "azure" },
];

const sampleId = (expected: string, armId: string) =>
  createHash("sha1").update(`a-vowel::${expected}::${armId}`).digest("hex").slice(0, 10);

function seededShuffle<T>(items: T[], seed: string): T[] {
  let h = [...seed].reduce((acc, ch) => (acc * 31 + ch.charCodeAt(0)) >>> 0, 17);
  const rand = () => {
    h = (h * 1103515245 + 12345) >>> 0;
    return h / 0xffffffff;
  };
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

const escapeHtml = (text: string) =>
  text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");

async function main() {
  await mkdir(OUT_DIR, { recursive: true });
  const hasAzure = Boolean(process.env.AZURE_SPEECH_KEY && process.env.AZURE_SPEECH_REGION);
  const arms = ARMS.filter((arm) => arm.provider !== "azure" || hasAzure);

  const rows = await db
    .select()
    .from(audioClips)
    .where(inArray(audioClips.expected, SENTENCES.map((s) => s.expected)));
  const throttle = createThrottle(INTERVAL_MS);
  const missing = new Set<string>();
  const probes: { expected: string; text: string }[] = [];

  for (const sentence of SENTENCES) {
    const row = rows.find((r) => r.expected === sentence.expected);
    if (!row) {
      console.log(`  no registered clip says "${sentence.expected}" — skipped`);
      continue;
    }
    probes.push({ expected: sentence.expected, text: row.text });
    const word = row.text.split(/\s+/)[sentence.verb].replace(/[.،؟!]/g, "");
    const translit = sentence.expected.split(/\s+/)[sentence.verb];

    for (const arm of arms) {
      const id = sampleId(sentence.expected, arm.id);
      const file = path.join(OUT_DIR, `${id}.mp3`);
      if (existsSync(file)) continue;
      try {
        if (arm.id === "stored") {
          const stored = await get(`audio/${row.hash}.mp3`, { access: "private" });
          if (stored?.statusCode !== 200) throw new Error("no stored audio");
          await writeFile(file, Buffer.from(await new Response(stored.stream).arrayBuffer()));
        } else {
          const tts: TtsArm = {
            id: arm.id,
            provider: arm.provider ?? "openai",
            voice: arm.voice!,
            label: arm.label,
            instructions: arm.instructions?.(word, translit),
          };
          for (let attempt = 1; ; attempt++) {
            await throttle();
            try {
              await writeFile(file, await synthesize(tts, row.text));
              break;
            } catch (err) {
              if (!isRateLimit(err) || attempt >= 3) throw err;
              await sleep(3_000 * attempt);
            }
          }
        }
        console.log(`  ${sentence.expected} / ${arm.id} … ok`);
      } catch (err) {
        missing.add(id);
        console.log(`  ${sentence.expected} / ${arm.id} … FAILED: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }

  const sections = probes
    .map((probe, index) => {
      const clips = seededShuffle(arms, probe.expected)
        .filter((arm) => !missing.has(sampleId(probe.expected, arm.id)))
        .map((arm, i) => {
          const id = sampleId(probe.expected, arm.id);
          return `
      <div class="clip" data-clip="${id}" data-arm="${arm.id}" data-sentence="${escapeHtml(probe.expected)}">
        <div class="chead">
          <span class="letter">${String.fromCharCode(65 + i)}</span>
          <span class="reveal" hidden>${escapeHtml(arm.label)}</span>
        </div>
        <audio controls preload="none" src="${id}.mp3"></audio>
        <div class="q">
          <label><input type="radio" name="f-${id}" value="tehrani"> Tehrani</label>
          <label><input type="radio" name="f-${id}" value="afghan"> Afghan-like</label>
          <label><input type="radio" name="f-${id}" value="odd"> Off in another way</label>
          <label><input type="radio" name="f-${id}" value="unclear"> Can't tell</label>
        </div>
        <input class="notes" name="n-${id}" placeholder="Anything else wrong with this clip?">
      </div>`;
        })
        .join("");
      return `
  <section class="probe">
    <h2><span class="num">${index + 1}</span></h2>
    <p class="fa" dir="rtl" lang="fa">${escapeHtml(probe.text)}</p>
    <p class="translit">${escapeHtml(probe.expected)}</p>
    <div class="clips">${clips}</div>
  </section>`;
    })
    .join("");

  await writeFile(
    path.join(OUT_DIR, "index.html"),
    `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>The â vowel — blind test</title>
<style>
  :root { color-scheme: light dark; --line: color-mix(in srgb, currentColor 15%, transparent); }
  body { font: 16px/1.55 system-ui, sans-serif; max-width: 60rem; margin: 0 auto; padding: 1.5rem 1.25rem 7rem; }
  h1 { font-size: 1.5rem; margin-bottom: .25rem; }
  h2 { font-size: 1.05rem; margin: 0 0 .3rem; }
  .num { opacity: .45; font-variant-numeric: tabular-nums; }
  .intro { opacity: .85; margin-top: 0; }
  .probe { border-top: 1px solid var(--line); padding-top: 1.5rem; margin-top: 2rem; }
  .fa { font-size: 1.9rem; line-height: 1.8; margin: .4rem 0 .1rem; }
  .translit { font-style: italic; opacity: .75; margin: 0 0 .8rem; font-size: .9rem; }
  .clips { display: grid; gap: .75rem; grid-template-columns: repeat(auto-fit, minmax(19rem, 1fr)); }
  .clip { border: 1px solid var(--line); border-radius: .6rem; padding: .8rem .9rem; }
  .chead { display: flex; align-items: center; gap: .7rem; margin-bottom: .4rem; }
  .letter { font-weight: 700; font-size: 1.1rem; }
  .reveal { font-size: .8rem; opacity: .7; }
  audio { width: 100%; }
  .q { display: flex; gap: .6rem; flex-wrap: wrap; margin-top: .5rem; font-size: .82rem; }
  .notes { width: 100%; margin-top: .45rem; padding: .3rem .5rem; border: 1px solid var(--line);
           border-radius: .35rem; background: transparent; color: inherit; font: inherit; font-size: .8rem; }
  .bar { position: fixed; inset: auto 0 0 0; display: flex; gap: 1rem; align-items: center; justify-content: center;
         padding: .75rem; background: Canvas; border-top: 1px solid var(--line); flex-wrap: wrap; }
  button { font: inherit; padding: .5rem 1rem; border-radius: .4rem; border: 1px solid var(--line);
           background: transparent; color: inherit; cursor: pointer; }
  #score { font-variant-numeric: tabular-nums; font-size: .87rem; }
</style></head>
<body>
<h1>The â vowel — blind test</h1>
<p class="intro">
  Each sentence is read several ways, <strong>blind and shuffled</strong> — clip “A” is not the same
  voice twice. Listen to the <strong>â in the verb</strong> (dâram, dârim, dârin) and say whether it
  is the Tehran vowel or the Afghan-sounding one. Use the note for anything else that is wrong.
  Progress saves automatically; press Export when done.
</p>
${sections}

<div class="bar">
  <span id="score"></span>
  <button id="export">Export results</button>
  <button id="revealBtn">Reveal which voice is which</button>
</div>

<script>
  const KEY = 'a-vowel-results';
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
    const map = {};
    for (const c of document.querySelectorAll('.clip')) map[c.dataset.clip] = { arm: c.dataset.arm, sentence: c.dataset.sentence };
    return { verdicts: out, clips: map };
  }

  function score() {
    const total = document.querySelectorAll('.clip').length;
    const done = document.querySelectorAll('input[name^=f-]:checked').length;
    document.getElementById('score').textContent = done + ' / ' + total + ' clips answered';
  }

  document.addEventListener('input', () => {
    localStorage.setItem(KEY, JSON.stringify(collect().verdicts));
    score();
  });
  score();

  document.getElementById('export').addEventListener('click', () => {
    const blob = new Blob([JSON.stringify(collect(), null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'a-vowel-results.json';
    a.click();
  });

  document.getElementById('revealBtn').addEventListener('click', (e) => {
    const hidden = document.querySelector('.reveal').hidden;
    for (const el of document.querySelectorAll('.reveal')) el.hidden = !hidden;
    e.target.textContent = hidden ? 'Hide labels' : 'Reveal which voice is which';
  });
</script>
</body></html>`,
  );

  console.log(`\nWrote ${OUT_DIR}/index.html`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
