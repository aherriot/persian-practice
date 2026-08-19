/**
 * Phase 0A — Persian TTS bakeoff.
 *
 * Renders every probe sentence through every available voice and emits a
 * blind-labeled rating page at spike/out/compare.html.
 *
 * The blinding matters. The whole point is a native speaker's honest judgement
 * of accent, and knowing which sample is "the expensive one" or "the one the
 * developer likes" contaminates that. Sample files are named by opaque hash,
 * ordering is shuffled per sentence, and the arm→label mapping lives in
 * key.json, which the page does not load.
 *
 *   npx tsx spike/tts-bakeoff.ts
 *
 * Re-running skips samples that already exist, so a partial run is resumable.
 */

import { createHash } from "node:crypto";
import { mkdir, writeFile, access } from "node:fs/promises";
import path from "node:path";
import dotenv from "dotenv";

import { PROBES, type Probe } from "./sentences.ts";
import {
  availableArms,
  synthesize,
  TTS_ARMS,
  type TtsArm,
  type TtsProviderName,
} from "../src/lib/tts-provider.ts";
import { createThrottle, isDailyQuota, isRateLimit, sleep } from "../src/lib/throttle.ts";

dotenv.config({ path: ".env.local", quiet: true });

const OUT_DIR = path.resolve("spike/out");
const AUDIO_DIR = path.join(OUT_DIR, "audio");

/**
 * Per-provider pacing. Providers run in independent lanes, so throttling OpenAI
 * does not also slow Azure down.
 *
 * OpenAI is serialized at one request per 10s because its TTS endpoint rate
 * limits well below what parallel requests ask for. Override without editing
 * code via OPENAI_TTS_INTERVAL_MS.
 */
const PROVIDER_LIMITS: Record<
  TtsProviderName,
  { concurrency: number; minIntervalMs: number }
> = {
  openai: {
    concurrency: 1,
    minIntervalMs: Number(process.env.OPENAI_TTS_INTERVAL_MS ?? 10_000),
  },
  azure: { concurrency: 4, minIntervalMs: 0 },
};

const RETRY_ATTEMPTS = 3;

/** Opaque, deterministic filename so the rater cannot infer the provider. */
function sampleId(probeId: string, armId: string): string {
  return createHash("sha1").update(`${probeId}::${armId}`).digest("hex").slice(0, 10);
}

/** Deterministic per-probe shuffle: stable across reruns, different per probe. */
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

type Sample = {
  sampleId: string;
  probeId: string;
  arm: TtsArm;
  file: string;
  error?: string;
};

async function renderAll(probes: Probe[], arms: TtsArm[]): Promise<Sample[]> {
  const jobs: Sample[] = probes.flatMap((probe) =>
    arms.map((arm) => {
      const id = sampleId(probe.id, arm.id);
      return { sampleId: id, probeId: probe.id, arm, file: path.join(AUDIO_DIR, `${id}.mp3`) };
    }),
  );

  // Skipping happens before anything is queued, so a resumable rerun costs no
  // throttle time for samples that already exist on disk.
  const pending: Sample[] = [];
  let skipped = 0;
  for (const job of jobs) {
    if (await exists(job.file)) skipped++;
    else pending.push(job);
  }

  if (skipped > 0) {
    console.log(`  ${skipped} sample(s) already rendered — skipping`);
  }
  if (pending.length === 0) return jobs;

  reportPlan(pending);

  let done = 0;
  const total = pending.length;
  const runStarted = Date.now();

  // One lane per provider, each with its own concurrency and pacing.
  const lanes = (Object.keys(PROVIDER_LIMITS) as TtsProviderName[]).map(async (provider) => {
    const limits = PROVIDER_LIMITS[provider];
    const queue = pending.filter((job) => job.arm.provider === provider);
    if (queue.length === 0) return;

    const throttle = createThrottle(limits.minIntervalMs);
    // Scoped per lane: one provider's exhausted daily quota must not cancel
    // another provider's remaining work.
    let laneAborted = false;

    const workers = Array.from({ length: limits.concurrency }, async () => {
      for (;;) {
        if (laneAborted) return;
        const job = queue.shift();
        if (!job) return;
        const probe = probes.find((p) => p.id === job.probeId)!;

        const where = `${job.arm.id} / ${probe.id}`;

        for (let attempt = 1; ; attempt++) {
          const waitedFrom = Date.now();
          await throttle();
          const waited = Date.now() - waitedFrom;

          const requestedAt = Date.now();
          try {
            const audio = await synthesize(job.arm, probe.persian);
            await writeFile(job.file, audio);
            done++;
            // Reporting the pacing wait separately from the request time is what
            // keeps a deliberately slow run from looking like a hang.
            const pacing = waited > 500 ? `, after ${(waited / 1000).toFixed(0)}s pacing` : "";
            console.log(
              `  [${done}/${total}] ${where} — ok in ${((Date.now() - requestedAt) / 1000).toFixed(1)}s${pacing}`,
            );
            break;
          } catch (err) {
            if (isDailyQuota(err)) {
              // A per-day cap cannot be waited out within a run. Abandon this
              // provider's remaining work rather than spending the next N
              // samples re-confirming an exhausted quota.
              done++;
              job.error = err instanceof Error ? err.message : String(err);
              laneAborted = true;
              queue.length = 0;
              console.log(`  [${done}/${total}] ${where} — DAILY QUOTA EXHAUSTED`);
              console.log(`\n  ${provider}: daily request quota is spent. Retrying will not help —`);
              console.log(`  this is a per-day cap, not a per-minute burst limit.`);
              if (provider === "openai") {
                console.log(`  Unpaid accounts are capped at 50 requests/day. Add a payment method:`);
                console.log(`    https://platform.openai.com/account/billing`);
              }
              console.log(`  Rendered samples are kept — re-run to resume where this stopped.\n`);
              break;
            }
            if (isRateLimit(err) && attempt < RETRY_ATTEMPTS) {
              const backoff = limits.minIntervalMs * attempt * 2 || 15_000 * attempt;
              console.log(
                `  ! ${where} — rate limited, backing off ${(backoff / 1000).toFixed(0)}s (attempt ${attempt}/${RETRY_ATTEMPTS})`,
              );
              await sleep(backoff);
              continue;
            }
            done++;
            job.error = err instanceof Error ? err.message : String(err);
            console.log(`  [${done}/${total}] ${where} — FAILED: ${job.error}`);
            break;
          }
        }
      }
    });

    await Promise.all(workers);
  });

  await Promise.all(lanes);
  console.log(`\n  finished ${total} sample(s) in ${((Date.now() - runStarted) / 1000).toFixed(0)}s`);
  return jobs;
}

/** Warns up front when throttling makes the run take minutes rather than seconds. */
function reportPlan(pending: Sample[]): void {
  for (const provider of Object.keys(PROVIDER_LIMITS) as TtsProviderName[]) {
    const count = pending.filter((job) => job.arm.provider === provider).length;
    if (count === 0) continue;
    const { concurrency, minIntervalMs } = PROVIDER_LIMITS[provider];
    if (minIntervalMs > 0) {
      const seconds = Math.ceil((count * minIntervalMs) / 1000 / concurrency);
      console.log(
        `  ${provider}: ${count} sample(s), 1 per ${minIntervalMs / 1000}s → ~${Math.ceil(seconds / 60)} min` +
          ` (expect ${minIntervalMs / 1000}s gaps between lines — that is the pacing, not a hang)`,
      );
    } else {
      console.log(`  ${provider}: ${count} sample(s), up to ${concurrency} in parallel`);
    }
  }
  console.log("");
}

function escapeHtml(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function buildHtml(probes: Probe[], samples: Sample[]): string {
  const blocks = probes
    .map((probe, probeIndex) => {
      const forProbe = seededShuffle(
        samples.filter((s) => s.probeId === probe.id),
        probe.id,
      );

      const players = forProbe
        .map((sample, i) => {
          const letter = String.fromCharCode(65 + i);
          const body = sample.error
            ? `<p class="err">Failed to render: ${escapeHtml(sample.error)}</p>`
            : // preload="metadata" (not "none") so durations are measurable up
              // front, which is what tempo matching needs.
              `<audio controls preload="metadata" src="audio/${sample.sampleId}.mp3"></audio>`;
          return `
        <div class="sample" data-sample="${sample.sampleId}">
          <div class="sample-head">
            <span class="letter">${letter}</span>
            <span class="dur"></span>
            <span class="reveal" hidden>${escapeHtml(sample.arm.label)}</span>
          </div>
          ${body}
          <div class="scores">
            <label>Accent (1 = not Iranian, 5 = natively Iranian)
              ${[1, 2, 3, 4, 5]
                .map(
                  (n) =>
                    `<label class="r"><input type="radio" name="acc-${sample.sampleId}" value="${n}">${n}</label>`,
                )
                .join("")}
            </label>
            <label>Naturalness (1 = robotic, 5 = human)
              ${[1, 2, 3, 4, 5]
                .map(
                  (n) =>
                    `<label class="r"><input type="radio" name="nat-${sample.sampleId}" value="${n}">${n}</label>`,
                )
                .join("")}
            </label>
            <label class="chk"><input type="checkbox" name="col-${sample.sampleId}"> Sounds colloquial, not bookish</label>
            <input class="notes" name="note-${sample.sampleId}" placeholder="Mispronounced words, or anything odd">
          </div>
        </div>`;
        })
        .join("");

      return `
    <section class="probe">
      <h2><span class="num">${probeIndex + 1}</span> ${escapeHtml(probe.probe)}</h2>
      <p class="fa" dir="rtl" lang="fa">${escapeHtml(probe.persian)}</p>
      <p class="translit">${escapeHtml(probe.translit)}</p>
      <p class="en">“${escapeHtml(probe.english)}”</p>
      <p class="listen"><strong>Listen for:</strong> ${escapeHtml(probe.listenFor)}</p>
      <div class="samples">${players}</div>
    </section>`;
    })
    .join("");

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Persian TTS bakeoff — blind rating</title>
<style>
  :root { color-scheme: light dark; --line: color-mix(in srgb, currentColor 15%, transparent); }
  body { font: 16px/1.55 system-ui, sans-serif; max-width: 60rem; margin: 0 auto; padding: 1.5rem 1.25rem 6rem; }
  h1 { font-size: 1.5rem; margin-bottom: .25rem; }
  .intro { opacity: .8; margin-top: 0; }
  .probe { border-top: 1px solid var(--line); padding-top: 1.5rem; margin-top: 2rem; }
  .num { opacity: .45; font-variant-numeric: tabular-nums; }
  .fa { font-size: 2rem; line-height: 1.7; margin: .5rem 0 .25rem; }
  .translit { font-style: italic; opacity: .75; margin: 0; }
  .en { opacity: .7; margin: .25rem 0; }
  .listen { background: color-mix(in srgb, currentColor 6%, transparent); padding: .6rem .8rem; border-radius: .5rem; font-size: .9rem; }
  .samples { display: grid; gap: .75rem; }
  .sample { border: 1px solid var(--line); border-radius: .6rem; padding: .75rem .9rem; }
  .sample-head { display: flex; align-items: center; gap: .75rem; margin-bottom: .4rem; }
  .letter { font-weight: 700; font-size: 1.1rem; }
  .reveal { font-size: .85rem; opacity: .7; }
  audio { width: 100%; max-width: 30rem; }
  .scores { display: grid; gap: .4rem; margin-top: .6rem; font-size: .85rem; }
  .scores > label { display: flex; align-items: center; gap: .4rem; flex-wrap: wrap; }
  .r { display: inline-flex; align-items: center; gap: .15rem; opacity: .9; }
  .chk { opacity: .9; }
  .notes { flex: 1; min-width: 14rem; padding: .3rem .5rem; border: 1px solid var(--line); border-radius: .35rem; background: transparent; color: inherit; font: inherit; font-size: .85rem; }
  .err { color: #c0392b; font-size: .9rem; }
  .bar { position: fixed; inset: auto 0 0 0; display: flex; flex-direction: column; gap: .4rem; align-items: center;
         padding: .75rem; background: Canvas; border-top: 1px solid var(--line); }
  .bar-row { display: flex; gap: .75rem; align-items: center; justify-content: center; flex-wrap: wrap; }
  button { font: inherit; padding: .5rem 1rem; border-radius: .4rem; border: 1px solid var(--line); background: transparent; color: inherit; cursor: pointer; }
  button.primary { background: currentColor; }
  button.primary span { filter: invert(1); }
  .count { font-variant-numeric: tabular-nums; opacity: .7; font-size: .9rem; }
  .speed { display: inline-flex; gap: .25rem; align-items: center; font-size: .85rem; opacity: .9; }
  .speed button { padding: .28rem .55rem; font-size: .8rem; opacity: .55; }
  .speed button.on { opacity: 1; font-weight: 700; border-color: currentColor; }
  .speedwarn { font-size: .78rem; color: #c9761a; text-align: center; max-width: 44rem; }
  .dur { font-size: .75rem; opacity: .55; font-variant-numeric: tabular-nums; }
  #tempoBtn.on { opacity: 1; font-weight: 700; border-color: currentColor; }
  .legend { font-size: .82rem; opacity: .8; max-width: 44rem; }
  #tempoSummary { margin-top: 2rem; font-size: .85rem; }
  #tempoSummary table { border-collapse: collapse; }
  #tempoSummary td { border-top: 1px solid var(--line); padding: .3rem .8rem .3rem 0; }
  #tempoSummary td:last-child { font-variant-numeric: tabular-nums; }
</style>
</head>
<body>
<h1>Persian TTS bakeoff</h1>
<p class="intro">
  Samples are <strong>blind</strong> and shuffled differently for each sentence — sample “A” is not
  the same voice twice. Rate what you hear, then use <em>Export ratings</em> at the bottom.
  Progress saves automatically in this browser.
</p>

${blocks}

<div class="bar">
  <div class="bar-row">
    <span class="count" id="count"></span>
    <span class="speed">
      Speed
      <button data-rate="0.5">0.5&times;</button>
      <button data-rate="0.75">0.75&times;</button>
      <button data-rate="1">1&times;</button>
      <button data-rate="1.25">1.25&times;</button>
    </span>
    <button id="tempoBtn">Match tempo</button>
    <button id="export" class="primary"><span>Export ratings</span></button>
    <button id="revealBtn">Reveal which voice is which</button>
  </div>
  <div class="speedwarn" id="speedWarn" hidden></div>
</div>

<div id="tempoSummary" hidden>
  <h2>Measured speaking tempo</h2>
  <p class="legend">
    Average clip length per voice across all sentences &mdash; every voice reads the same text,
    so this is a direct measure of speaking rate. Kept as data because pace is itself a quality
    signal: a voice that rushes is worse for a learner regardless of how good its accent is.
  </p>
  <table id="tempoTable"></table>
</div>

<script>
  const KEY = 'tts-bakeoff-ratings';
  const saved = JSON.parse(localStorage.getItem(KEY) || '{}');

  for (const el of document.querySelectorAll('input')) {
    const v = saved[el.name];
    if (v === undefined) continue;
    if (el.type === 'radio') el.checked = (el.value === v);
    else if (el.type === 'checkbox') el.checked = v;
    else el.value = v;
  }

  function collect() {
    const out = {};
    for (const el of document.querySelectorAll('input')) {
      if (el.type === 'radio') { if (el.checked) out[el.name] = el.value; }
      else if (el.type === 'checkbox') { out[el.name] = el.checked; }
      else if (el.value) { out[el.name] = el.value; }
    }
    return out;
  }

  function updateCount() {
    const total = document.querySelectorAll('.sample').length;
    const rated = new Set(
      [...document.querySelectorAll('input[type=radio]:checked')]
        .map(el => el.name.split('-').slice(1).join('-'))
    ).size;
    document.getElementById('count').textContent = rated + ' / ' + total + ' samples rated';
  }

  document.addEventListener('input', () => {
    localStorage.setItem(KEY, JSON.stringify(collect()));
    updateCount();
  });
  updateCount();

  const SPEED_KEY = 'tts-bakeoff-speed';
  const TEMPO_KEY = 'tts-bakeoff-tempo';
  // Bound on time-stretching, since heavy stretching degrades the audio being
  // judged. Measured against the current samples the largest correction needed
  // is 1.69x, so this is set just above that: outliers match fully, and the
  // clamp only catches something pathological.
  const MAX_STRETCH = 1.7;

  let rate = Number(localStorage.getItem(SPEED_KEY)) || 1;
  let matchTempo = localStorage.getItem(TEMPO_KEY) === '1';
  const durations = new Map();

  function applyRate(el) {
    const sample = el.closest('.sample');
    const factor = matchTempo ? Number(sample?.dataset.factor || 1) : 1;
    el.playbackRate = rate * factor;
    // Time-stretch instead of pitch-shifting: a slowed voice must keep its
    // formants or it stops being a useful pronunciation model.
    el.preservesPitch = true;
    el.webkitPreservesPitch = true;
  }

  /** Per sentence, target the median duration so no single outlier sets the pace. */
  function computeFactors() {
    for (const section of document.querySelectorAll('.probe')) {
      const samples = [...section.querySelectorAll('.sample')];
      const lengths = samples
        .map((s) => durations.get(s.dataset.sample))
        .filter((d) => d > 0)
        .sort((a, b) => a - b);
      if (lengths.length === 0) continue;

      const median = lengths[Math.floor(lengths.length / 2)];
      for (const s of samples) {
        const d = durations.get(s.dataset.sample);
        const raw = d > 0 ? d / median : 1;
        s.dataset.factor = Math.min(MAX_STRETCH, Math.max(1 / MAX_STRETCH, raw));
      }
    }
  }

  function refreshLabels() {
    for (const s of document.querySelectorAll('.sample')) {
      const d = durations.get(s.dataset.sample);
      const el = s.querySelector('.dur');
      if (!el) continue;
      if (!(d > 0)) { el.textContent = ''; continue; }
      const factor = Number(s.dataset.factor || 1);
      // Plain concatenation, not template literals: this script is embedded in a
      // template literal, so a nested \${} would interpolate at build time.
      el.textContent = matchTempo && Math.abs(factor - 1) > 0.02
        ? d.toFixed(1) + 's → ' + (d / factor).toFixed(1) + 's'
        : d.toFixed(1) + 's';
    }
  }

  function refreshSpeed() {
    for (const el of document.querySelectorAll('audio')) applyRate(el);
    for (const b of document.querySelectorAll('.speed button')) {
      b.classList.toggle('on', Number(b.dataset.rate) === rate);
    }
    document.getElementById('tempoBtn').classList.toggle('on', matchTempo);

    const warn = document.getElementById('speedWarn');
    const messages = [];
    if (rate !== 1) {
      messages.push('Playing off normal speed — useful for hearing individual sounds, but it stretches prosody.');
    }
    if (matchTempo) {
      messages.push('Tempo matching is on, so pace is no longer what each voice actually produced.');
    }
    if (messages.length) {
      warn.innerHTML = messages.join(' ') +
        ' Score <strong>accent</strong> and <strong>naturalness</strong> at 1&times; with tempo matching off.';
    }
    warn.hidden = messages.length === 0;

    refreshLabels();
  }

  document.addEventListener('loadedmetadata', (e) => {
    if (e.target.tagName !== 'AUDIO') return;
    const sample = e.target.closest('.sample');
    if (!sample || !isFinite(e.target.duration)) return;
    durations.set(sample.dataset.sample, e.target.duration);
    computeFactors();
    refreshSpeed();
  }, true);

  for (const b of document.querySelectorAll('.speed button')) {
    b.addEventListener('click', () => {
      rate = Number(b.dataset.rate);
      localStorage.setItem(SPEED_KEY, String(rate));
      refreshSpeed();
    });
  }

  document.getElementById('tempoBtn').addEventListener('click', () => {
    matchTempo = !matchTempo;
    localStorage.setItem(TEMPO_KEY, matchTempo ? '1' : '0');
    refreshSpeed();
  });

  // Loading a source resets playbackRate. Capture phase because 'play' does not bubble.
  document.addEventListener('play', (e) => {
    if (e.target.tagName === 'AUDIO') applyRate(e.target);
  }, true);

  /** Average clip length per voice — revealed with the labels to keep the rating blind. */
  function buildTempoSummary() {
    const byLabel = new Map();
    for (const s of document.querySelectorAll('.sample')) {
      const d = durations.get(s.dataset.sample);
      const label = s.querySelector('.reveal')?.textContent;
      if (!(d > 0) || !label) continue;
      if (!byLabel.has(label)) byLabel.set(label, []);
      byLabel.get(label).push(d);
    }
    if (byLabel.size === 0) return;

    const rows = [...byLabel.entries()]
      .map(([label, ds]) => [label, ds.reduce((a, b) => a + b, 0) / ds.length])
      .sort((a, b) => a[1] - b[1]);
    const fastest = rows[0][1];

    document.getElementById('tempoTable').innerHTML = rows
      .map(([label, avg]) =>
        '<tr><td>' + label + '</td><td>' + avg.toFixed(2) + 's avg</td><td>' +
        (avg === fastest ? 'fastest' : '+' + (((avg / fastest) - 1) * 100).toFixed(0) + '% slower') +
        '</td></tr>')
      .join('');
    document.getElementById('tempoSummary').hidden = false;
  }

  refreshSpeed();

  document.getElementById('export').addEventListener('click', () => {
    const blob = new Blob([JSON.stringify(collect(), null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'tts-ratings.json';
    a.click();
  });

  document.getElementById('revealBtn').addEventListener('click', (e) => {
    const hidden = document.querySelector('.reveal').hidden;
    for (const el of document.querySelectorAll('.reveal')) el.hidden = !hidden;
    e.target.textContent = hidden ? 'Hide labels' : 'Reveal which voice is which';
    if (hidden) buildTempoSummary();
    else document.getElementById('tempoSummary').hidden = true;
  });
</script>
</body>
</html>`;
}

/**
 * Rebuilds the sample list purely from what is on disk, making no API calls.
 * Lets the page be regenerated — after a template change, say — without
 * spending rate-limit budget or overwriting good samples with failure text.
 */
async function collectExisting(): Promise<Sample[]> {
  const samples: Sample[] = [];
  for (const probe of PROBES) {
    for (const arm of TTS_ARMS) {
      const id = sampleId(probe.id, arm.id);
      const file = path.join(AUDIO_DIR, `${id}.mp3`);
      samples.push({
        sampleId: id,
        probeId: probe.id,
        arm,
        file,
        ...((await exists(file))
          ? {}
          : { error: "Not rendered yet — run npm run spike:tts" }),
      });
    }
  }
  return samples;
}

async function main() {
  const reportOnly = process.argv.includes("--report-only");
  let samples: Sample[];

  if (reportOnly) {
    await mkdir(AUDIO_DIR, { recursive: true });
    samples = await collectExisting();
    const have = samples.filter((s) => !s.error).length;
    console.log(`Report-only: rebuilding page from disk, no API calls.`);
    console.log(`${have}/${samples.length} samples present\n`);
  } else {
    // --provider=azure re-renders one vendor's samples without spending another's
    // quota, which matters when one provider's daily cap is already exhausted.
    const only = process.argv.find((a) => a.startsWith("--provider="))?.split("=")[1];
    const arms = availableArms().filter((a) => !only || a.provider === only);
    if (only) console.log(`Filtered to provider: ${only}`);
    if (arms.length === 0) {
      console.error(
        "No providers configured. Set OPENAI_API_KEY and/or AZURE_SPEECH_KEY + AZURE_SPEECH_REGION in .env.local\n" +
          "To rebuild the page from already-rendered audio, run: npm run spike:report",
      );
      process.exit(1);
    }

    console.log(`Arms: ${arms.map((a) => a.id).join(", ")}`);
    if (arms.length < TTS_ARMS.length) {
      const missing = TTS_ARMS.filter((a) => !arms.includes(a)).map((a) => a.id);
      console.log(`Skipped (no credentials): ${missing.join(", ")}`);
    }
    console.log(`Probes: ${PROBES.length} → ${PROBES.length * arms.length} samples\n`);

    await mkdir(AUDIO_DIR, { recursive: true });
    const rendered = await renderAll(PROBES, arms);

    // The page always reports every arm from disk state, never just the arms
    // this run touched — otherwise --provider=azure would silently drop the
    // OpenAI samples from the comparison. Real failure text is carried over so
    // the report says *why* something is missing.
    const failures = new Map(
      rendered.filter((s) => s.error).map((s) => [s.sampleId, s.error!]),
    );
    samples = (await collectExisting()).map((s) =>
      failures.has(s.sampleId) ? { ...s, error: failures.get(s.sampleId) } : s,
    );
  }

  await writeFile(path.join(OUT_DIR, "compare.html"), buildHtml(PROBES, samples));
  await writeFile(
    path.join(OUT_DIR, "key.json"),
    JSON.stringify(
      samples.map((s) => ({
        sampleId: s.sampleId,
        probeId: s.probeId,
        armId: s.arm.id,
        label: s.arm.label,
        error: s.error ?? null,
      })),
      null,
      2,
    ),
  );

  const failed = samples.filter((s) => s.error).length;
  console.log(`\nWrote ${OUT_DIR}/compare.html  (${samples.length - failed} playable, ${failed} failed)`);
  console.log(`Wrote ${OUT_DIR}/key.json       — do not show this to the rater`);
  console.log(`\nOpen it:  open ${OUT_DIR}/compare.html`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
