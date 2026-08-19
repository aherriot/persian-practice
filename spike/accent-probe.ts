/**
 * Iranian (Tehrani) vs Afghan (Dari) accent discrimination.
 *
 * OpenAI's Persian TTS is reported by its own developer community to render with
 * an Afghan/Dari accent rather than standard Iranian Persian. That claim decides
 * the vendor question — FINDINGS.md §6 shows OpenAI is far better at homograph
 * pronunciation, so it is only ruled out if the accent is genuinely wrong — and
 * it cannot be judged by a non-native ear, since both varieties sound like
 * fluent Persian.
 *
 * "Does it sound natural?" will not answer this. The two varieties differ on
 * specific, nameable phonological features, so each sentence below forces one:
 *
 *   ق / غ    Iranian merges both to [ɣ~ɢ]. Dari keeps ق as a distinct uvular /q/.
 *   و        Iranian /v/. Dari /w/.
 *   majhul   Dari preserves classical ē and ō where Iranian has ī and ū.
 *   final ه  Iranian -e. Dari -a.
 *   ey / ay  Iranian "kheyli". Dari "khayli".
 *
 * A native speaker can answer each of those definitively even when an overall
 * impression is hard to articulate.
 *
 *   npm run spike:accent
 *
 * Azure fa-IR is included as a reference point, and the page is blind.
 */

import { mkdir, writeFile, access } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import dotenv from "dotenv";

import { synthesize, type TtsArm } from "../src/lib/tts-provider.ts";
import { createThrottle, isDailyQuota, isRateLimit, sleep } from "../src/lib/throttle.ts";

dotenv.config({ path: ".env.local", quiet: true });

const OUT_DIR = path.resolve("spike/out/accent");
const INTERVAL_MS = Number(process.env.OPENAI_TTS_INTERVAL_MS ?? 3_000);

type Option = { value: string; label: string };

type AccentProbe = {
  id: string;
  marker: string;
  sentence: string;
  translit: string;
  english: string;
  /** The specific thing to listen for, phrased as a question. */
  question: string;
  /**
   * Answers. Some markers are two-way (Iranian vs Dari), but register is a
   * separate axis from accent and must not be collapsed into it: خانه read as
   * "khâne" is not Afghan, it is *formally* Iranian, where a Tehrani speaker
   * says "khune". Offering only Iranian/Afghan would score a bookish voice as a
   * pass and hide the register problem entirely.
   */
  options: Option[];
};

const CANT_TELL: Option = { value: "unclear", label: "Can't tell" };

const PROBES: AccentProbe[] = [
  {
    id: "qaf-ghayn",
    marker: "ق vs غ — the strongest single discriminator",
    sentence: "توی باغ یک قاشق پیدا کردم",
    translit: "tu-ye bâgh yek qâshoq peydâ kardam",
    english: "I found a spoon in the garden",
    question: "Do the غ in باغ and the ق in قاشق sound like the SAME consonant, or two different ones?",
    options: [
      { value: "iranian", label: "Same sound — Iranian merged ق and غ" },
      { value: "dari", label: "Different — Dari keeps ق as a hard /q/" },
      CANT_TELL,
    ],
  },
  {
    id: "vav-initial",
    marker: "و at the start of a word — /v/ vs /w/",
    sentence: "وقت زیادی ندارم",
    translit: "vaght-e ziyâdi nadâram",
    english: "I don't have much time",
    question: "Does it begin with a /v/ sound (as in 'van') or a /w/ sound (as in 'wan')?",
    options: [
      { value: "iranian", label: "vaght — /v/, Iranian" },
      { value: "dari", label: "waqt — /w/, Dari" },
      CANT_TELL,
    ],
  },
  {
    id: "majhul-e",
    marker: "Classical majhul vowel ē",
    sentence: "شیر در جنگل زندگی می‌کند",
    translit: "shir dar jangal zendegi mi-konad",
    english: "The lion lives in the jungle",
    question: "Is the vowel in شیر a plain 'ee', or a longer 'ay/eh' sound?",
    options: [
      { value: "iranian", label: "shir — plain 'ee', Iranian" },
      { value: "dari", label: "shēr — preserved majhul vowel, Dari" },
      CANT_TELL,
    ],
  },
  {
    id: "majhul-o",
    marker: "Classical majhul vowel ō",
    sentence: "امروز روز خوبی است",
    translit: "emruz ruz-e khubi ast",
    english: "Today is a good day",
    question: "Is the vowel in روز 'oo' as in 'boot', or closer to 'oh'?",
    options: [
      { value: "iranian", label: "ruz — 'oo', Iranian" },
      { value: "dari", label: "rōz — 'oh', Dari" },
      CANT_TELL,
    ],
  },
  {
    id: "final-he",
    marker: "خانه — separates accent from register (three-way)",
    sentence: "خانه ما نزدیک مدرسه است",
    translit: "khune-ye mâ nazdik-e madrese-ast",
    english: "Our house is near the school",
    question:
      "How does it say خانه? All three are different things — 'khâne' is not Afghan, it is correct but bookish Iranian.",
    options: [
      { value: "tehrani", label: "khune — colloquial Tehrani (the target register)" },
      { value: "iranian-formal", label: "khâne — Iranian, but formal/bookish" },
      { value: "dari", label: "khâna — Afghan/Dari" },
      CANT_TELL,
    ],
  },
  {
    id: "ey-ay",
    marker: "ey vs ay diphthong",
    sentence: "خیلی خوشحالم که آمدی",
    translit: "kheyli khoshhâlam ke âmadi",
    english: "I'm very happy that you came",
    question: "Is it 'kheyli' or 'khayli'?",
    options: [
      { value: "iranian", label: "kheyli — Iranian" },
      { value: "dari", label: "khayli — Dari" },
      CANT_TELL,
    ],
  },
  {
    id: "vav-medial",
    marker: "و inside a word, plus majhul",
    sentence: "دیوار حیاط خیلی بلند است",
    translit: "divâr-e hayât kheyli boland ast",
    english: "The courtyard wall is very tall",
    question: "Is it 'divâr' or 'dēwâr'?",
    options: [
      { value: "iranian", label: "divâr — Iranian" },
      { value: "dari", label: "dēwâr — Dari" },
      CANT_TELL,
    ],
  },
  {
    id: "overall",
    marker: "نان — register marker, written formally",
    sentence: "سلام، حال شما چطور است؟ امروز به بازار رفتم و نان خریدم",
    translit: "salâm, hâl-e shomâ chetor-e? emruz raftam bâzâr-o nun kharidam",
    english: "Hello, how are you? Today I went to the market and bought bread",
    question:
      "How does it say نان? Note this one does not separate Iranian from Afghan — both say 'nân'. It only tells us whether the voice speaks colloquially.",
    options: [
      { value: "tehrani", label: "nun — colloquial Tehrani" },
      { value: "formal", label: "nân — formal Iranian OR Afghan (this marker can't distinguish)" },
      CANT_TELL,
    ],
  },
  {
    id: "colloquial-spelling",
    marker: "Colloquial spelling — can it read the register we actually want?",
    sentence: "می‌رم خونه نون بخرم، تو چیزی نمی‌خوای؟",
    translit: "mi-ram khune nun bekharam, to chizi nemi-khây?",
    english: "I'm going home to buy bread, do you want anything?",
    question:
      "This is written the way Iranians actually text and speak. Does it read خونه and نون naturally, or does it stumble on the colloquial spellings?",
    options: [
      { value: "natural", label: "Natural — sounds like a Tehrani speaking normally" },
      { value: "stiff", label: "Reads them correctly but sounds unnatural" },
      { value: "wrong", label: "Mispronounces the colloquial forms" },
      CANT_TELL,
    ],
  },
];

const ARMS: TtsArm[] = [
  { id: "openai-alloy", provider: "openai", voice: "alloy", label: "OpenAI gpt-4o-mini-tts — alloy" },
  { id: "openai-nova", provider: "openai", voice: "nova", label: "OpenAI gpt-4o-mini-tts — nova" },
  {
    id: "openai-alloy-steered",
    provider: "openai",
    voice: "alloy",
    label: "OpenAI gpt-4o-mini-tts — alloy, steered to Tehrani",
    instructions:
      "Speak as a native Iranian Persian speaker with a standard Tehrani accent. " +
      "Do not use an Afghan, Dari, or Tajik accent.",
  },
  {
    id: "azure-dilara",
    provider: "azure",
    voice: "fa-IR-DilaraNeural",
    label: "Azure fa-IR-DilaraNeural (reference)",
  },
];

function sampleId(probeId: string, armId: string): string {
  return createHash("sha1").update(`accent::${probeId}::${armId}`).digest("hex").slice(0, 10);
}

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

async function main() {
  if (!process.env.OPENAI_API_KEY) {
    console.error("Needs OPENAI_API_KEY in .env.local");
    process.exit(1);
  }

  await mkdir(OUT_DIR, { recursive: true });
  const throttle = createThrottle(INTERVAL_MS);
  const total = PROBES.length * ARMS.length;
  const openAiCount = PROBES.length * ARMS.filter((a) => a.provider === "openai").length;

  console.log(`${PROBES.length} sentences x ${ARMS.length} voices = ${total} clips`);
  console.log(`${openAiCount} OpenAI requests, paced 1 per ${INTERVAL_MS / 1000}s\n`);

  const failures = new Map<string, string>();
  let done = 0;

  outer: for (const probe of PROBES) {
    for (const arm of ARMS) {
      const id = sampleId(probe.id, arm.id);
      const file = path.join(OUT_DIR, `${id}.mp3`);
      if (await exists(file)) {
        done++;
        console.log(`  [${done}/${total}] ${probe.id} / ${arm.id} … cached`);
        continue;
      }

      for (let attempt = 1; ; attempt++) {
        // Azure is unmetered here; only pace the OpenAI lane.
        if (arm.provider === "openai") await throttle();
        try {
          const audio = await synthesize(arm, probe.sentence);
          await writeFile(file, audio);
          done++;
          console.log(`  [${done}/${total}] ${probe.id} / ${arm.id} … ok`);
          break;
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          if (isDailyQuota(err)) {
            failures.set(id, message);
            console.log(`\n  Daily quota exhausted — stopping. Re-run to resume.\n`);
            break outer;
          }
          if (isRateLimit(err) && attempt < 3) {
            const backoff = INTERVAL_MS * attempt * 3;
            console.log(`  ! rate limited, backing off ${backoff / 1000}s (attempt ${attempt}/3)`);
            await sleep(backoff);
            continue;
          }
          done++;
          failures.set(id, message);
          console.log(`  [${done}/${total}] ${probe.id} / ${arm.id} … FAILED: ${message}`);
          break;
        }
      }
    }
  }

  const sections = PROBES.map((probe, index) => {
    const shuffled = seededShuffle(ARMS, probe.id);
    const clips = shuffled
      .map((arm, i) => {
        const id = sampleId(probe.id, arm.id);
        const letter = String.fromCharCode(65 + i);
        const body = failures.has(id)
          ? `<p class="err">${escapeHtml(failures.get(id)!)}</p>`
          : `<audio controls preload="none" src="${id}.mp3"></audio>`;
        return `
      <div class="clip" data-clip="${id}" data-arm="${arm.id}">
        <div class="chead">
          <span class="letter">${letter}</span>
          <span class="reveal" hidden>${escapeHtml(arm.label)}</span>
        </div>
        ${body}
        <div class="q">
          ${probe.options
            .map(
              (option) =>
                `<label><input type="radio" name="f-${id}" value="${option.value}"> ${escapeHtml(option.label)}</label>`,
            )
            .join("")}
        </div>
        <div class="q overall">
          Overall this voice sounds:
          <label><input type="radio" name="a-${id}" value="iranian"> Iranian</label>
          <label><input type="radio" name="a-${id}" value="dari"> Afghan</label>
          <label><input type="radio" name="a-${id}" value="other"> Neither / odd</label>
        </div>
        <input class="notes" name="n-${id}" placeholder="Anything else that gives it away?">
      </div>`;
      })
      .join("");

    return `
  <section class="probe">
    <h2><span class="num">${index + 1}</span> ${escapeHtml(probe.marker)}</h2>
    <p class="fa" dir="rtl" lang="fa">${escapeHtml(probe.sentence)}</p>
    <p class="translit">${escapeHtml(probe.translit)}</p>
    <p class="en">“${escapeHtml(probe.english)}”</p>
    <p class="listen"><strong>${escapeHtml(probe.question)}</strong></p>
    <div class="clips">${clips}</div>
  </section>`;
  }).join("");

  await writeFile(
    path.join(OUT_DIR, "index.html"),
    `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Iranian vs Afghan accent — blind test</title>
<style>
  :root { color-scheme: light dark; --line: color-mix(in srgb, currentColor 15%, transparent); }
  body { font: 16px/1.55 system-ui, sans-serif; max-width: 60rem; margin: 0 auto; padding: 1.5rem 1.25rem 7rem; }
  h1 { font-size: 1.5rem; margin-bottom: .25rem; }
  h2 { font-size: 1.05rem; margin: 0 0 .3rem; }
  .num { opacity: .45; font-variant-numeric: tabular-nums; }
  .intro { opacity: .85; margin-top: 0; }
  .probe { border-top: 1px solid var(--line); padding-top: 1.5rem; margin-top: 2rem; }
  .fa { font-size: 1.9rem; line-height: 1.8; margin: .4rem 0 .1rem; }
  .translit { font-style: italic; opacity: .75; margin: 0; font-size: .9rem; }
  .en { opacity: .65; margin: .15rem 0 .5rem; font-size: .87rem; }
  .listen { background: color-mix(in srgb, #c9761a 12%, transparent); padding: .6rem .8rem;
            border-radius: .5rem; font-size: .92rem; }
  .clips { display: grid; gap: .75rem; grid-template-columns: repeat(auto-fit, minmax(19rem, 1fr)); }
  .clip { border: 1px solid var(--line); border-radius: .6rem; padding: .8rem .9rem; }
  .chead { display: flex; align-items: center; gap: .7rem; margin-bottom: .4rem; }
  .letter { font-weight: 700; font-size: 1.1rem; }
  .reveal { font-size: .8rem; opacity: .7; }
  audio { width: 100%; }
  .q { display: flex; gap: .6rem; flex-wrap: wrap; margin-top: .5rem; font-size: .82rem; }
  .q.overall { opacity: .85; border-top: 1px dashed var(--line); padding-top: .45rem; }
  .notes { width: 100%; margin-top: .45rem; padding: .3rem .5rem; border: 1px solid var(--line);
           border-radius: .35rem; background: transparent; color: inherit; font: inherit; font-size: .8rem; }
  .err { color: #c0392b; font-size: .85rem; }
  .bar { position: fixed; inset: auto 0 0 0; display: flex; gap: 1rem; align-items: center; justify-content: center;
         padding: .75rem; background: Canvas; border-top: 1px solid var(--line); flex-wrap: wrap; }
  button { font: inherit; padding: .5rem 1rem; border-radius: .4rem; border: 1px solid var(--line);
           background: transparent; color: inherit; cursor: pointer; }
  #score { font-variant-numeric: tabular-nums; font-size: .87rem; }
</style></head>
<body>
<h1>Iranian or Afghan? — blind accent test</h1>
<p class="intro">
  Each sentence is read by four voices, <strong>blind and shuffled</strong> — clip “A” is not the
  same voice twice. Every sentence targets one specific sound where Iranian Persian and Afghan Dari
  differ, so you can answer the highlighted question directly rather than judging an overall
  impression. Answer the sound question first, then the overall one. Progress saves automatically.
</p>
<p class="intro">
  <strong>Two separate things are being measured.</strong> <em>Accent</em> is Iranian vs Afghan.
  <em>Register</em> is colloquial vs bookish — “khâne” and “nân” are perfectly Iranian, just
  formal, where a Tehrani speaker says “khune” and “nun”. Sentences 5, 8 and 9 offer that as a
  third option rather than forcing it into the Iranian/Afghan choice, because the app is meant to
  teach the spoken register.
</p>

${sections}

<div class="bar">
  <span id="score"></span>
  <button id="export">Export results</button>
  <button id="revealBtn">Reveal which voice is which</button>
</div>

<script>
  const KEY = 'accent-results';
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
    // Arm identity is recorded here so the blind letters can be decoded later.
    const map = {};
    for (const c of document.querySelectorAll('.clip')) map[c.dataset.clip] = c.dataset.arm;
    return { verdicts: out, clipToArm: map };
  }

  function score() {
    const total = document.querySelectorAll('.clip').length;
    const done = new Set(
      [...document.querySelectorAll('input[name^=f-]:checked')].map(el => el.name.slice(2))
    ).size;
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
    a.download = 'accent-results.json';
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
  console.log(`Open it:  open ${OUT_DIR}/index.html`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
