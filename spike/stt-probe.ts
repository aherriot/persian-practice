/**
 * Phase 0B — STT accuracy and error-preservation probe.
 *
 * Reads the clips recorded via /record.html, transcribes each through every
 * available STT arm, and reports two numbers:
 *
 *   1. Word error rate on the correct clips — baseline accuracy on accented,
 *      non-native speech.
 *   2. Error-preservation rate on the deliberately-wrong clips — the number the
 *      product actually depends on. Every mistake record, correction, and
 *      grammar-mastery score sits downstream of the transcript. If ASR repairs
 *      learner errors on the way out, that evidence is gone before any teaching
 *      logic sees it.
 *
 *   npx tsx spike/stt-probe.ts
 *
 * Output goes to spike/out/stt-report.html rather than the terminal, because
 * terminals without Unicode bidi support render Persian diffs unreadably.
 */

import { readFile, writeFile, mkdir, access } from "node:fs/promises";
import path from "node:path";
import dotenv from "dotenv";

import { CLIPS, type Clip } from "./stt-clips.ts";
import { availableSttArms, transcribe, type SttArm } from "../src/lib/stt-provider.ts";
import { wordErrorRate, equalsPersian, alignTokens, type AlignOp } from "../src/lib/normalize.ts";

dotenv.config({ path: ".env.local", quiet: true });

const RECORDINGS_DIR = path.resolve("spike/recordings");
const OUT_DIR = path.resolve("spike/out");

type Verdict = "preserved" | "repaired" | "other" | "undetectable";

type Result = {
  clip: Clip;
  arm: SttArm;
  hypothesis?: string;
  error?: string;
  wer?: number;
  verdict?: Verdict;
};

async function exists(file: string): Promise<boolean> {
  try {
    await access(file);
    return true;
  } catch {
    return false;
  }
}

/**
 * Decide whether a transcript kept the planted mistake. Exact equality is too
 * brittle — ASR will differ in spelling and punctuation regardless — so this
 * compares edit distance to what was actually said against edit distance to the
 * grammatical form, and takes the nearer one.
 */
function judge(clip: Clip, hypothesis: string): Verdict {
  if (clip.invisibleInText) return "undetectable";
  if (!clip.repairedForm) return "other";

  if (equalsPersian(hypothesis, clip.saying)) return "preserved";
  if (equalsPersian(hypothesis, clip.repairedForm)) return "repaired";

  const toSaid = wordErrorRate(clip.saying, hypothesis).wer;
  const toFixed = wordErrorRate(clip.repairedForm, hypothesis).wer;

  // A transcript far from both is a recognition failure, not evidence either way.
  if (Math.min(toSaid, toFixed) > 0.5) return "other";
  if (toSaid < toFixed) return "preserved";
  if (toFixed < toSaid) return "repaired";
  return "other";
}

function escapeHtml(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function renderDiff(ops: AlignOp[]): string {
  return ops
    .map((op) => {
      switch (op.op) {
        case "eq":
          return `<span class="eq">${escapeHtml(op.ref)}</span>`;
        case "sub":
          return `<span class="sub" title="expected ${escapeHtml(op.ref)}">${escapeHtml(op.hyp)}</span>`;
        case "del":
          return `<span class="del" title="dropped">${escapeHtml(op.ref)}</span>`;
        case "ins":
          return `<span class="ins" title="added">${escapeHtml(op.hyp)}</span>`;
      }
    })
    .join(" ");
}

function buildReport(results: Result[], arms: SttArm[], missing: Clip[]): string {
  const summaryRows = arms
    .map((arm) => {
      const mine = results.filter((r) => r.arm.id === arm.id && !r.error);
      const correct = mine.filter((r) => r.clip.kind === "correct");
      const errors = mine.filter(
        (r) => r.clip.kind === "deliberate-error" && r.verdict !== "undetectable",
      );
      const avgWer =
        correct.length === 0
          ? null
          : correct.reduce((sum, r) => sum + (r.wer ?? 0), 0) / correct.length;
      const preserved = errors.filter((r) => r.verdict === "preserved").length;
      const rate = errors.length === 0 ? null : preserved / errors.length;

      const verdictClass = rate === null ? "" : rate >= 0.7 ? "good" : rate >= 0.4 ? "warn" : "bad";
      return `<tr>
        <td>${escapeHtml(arm.label)}</td>
        <td class="num">${avgWer === null ? "—" : (avgWer * 100).toFixed(0) + "%"}</td>
        <td class="num ${verdictClass}">${rate === null ? "—" : `${preserved}/${errors.length} (${(rate * 100).toFixed(0)}%)`}</td>
      </tr>`;
    })
    .join("");

  const clipBlocks = CLIPS.map((clip) => {
    const mine = results.filter((r) => r.clip.id === clip.id);
    if (mine.length === 0) return "";

    const rows = mine
      .map((r) => {
        if (r.error) {
          return `<tr><td>${escapeHtml(r.arm.label)}</td><td colspan="2" class="err">${escapeHtml(r.error)}</td></tr>`;
        }
        const ops = alignTokens(clip.saying, r.hypothesis ?? "");
        const badge =
          clip.kind === "deliberate-error"
            ? `<span class="badge ${r.verdict}">${r.verdict}</span>`
            : `<span class="num">WER ${((r.wer ?? 0) * 100).toFixed(0)}%</span>`;
        return `<tr>
          <td>${escapeHtml(r.arm.label)}</td>
          <td class="fa" dir="rtl" lang="fa">${renderDiff(ops)}</td>
          <td>${badge}</td>
        </tr>`;
      })
      .join("");

    return `<section class="clip">
      <h3>${escapeHtml(clip.id)} <span class="tag ${clip.kind}">${clip.kind === "correct" ? "correct persian" : "planted error"}</span></h3>
      ${clip.errorType ? `<p class="note">Planted: ${escapeHtml(clip.errorType)}</p>` : ""}
      ${clip.invisibleInText ? `<p class="note bad">This error leaves no trace in written Persian. No transcript-based system can detect it — it bounds the architecture, not the vendor.</p>` : ""}
      <p class="said">Asked to say: <span class="fa" dir="rtl" lang="fa">${escapeHtml(clip.saying)}</span> <em>${escapeHtml(clip.translit)}</em></p>
      <table><tbody>${rows}</tbody></table>
    </section>`;
  }).join("");

  const missingNote =
    missing.length === 0
      ? ""
      : `<p class="warnbox">Not yet recorded (${missing.length}): ${missing.map((c) => escapeHtml(c.id)).join(", ")}.
         Run <code>npm run dev</code> and open <code>/record.html</code>.</p>`;

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Phase 0B — STT probe results</title>
<style>
  :root { color-scheme: light dark; --line: color-mix(in srgb, currentColor 15%, transparent); }
  body { font: 16px/1.55 system-ui, sans-serif; max-width: 62rem; margin: 0 auto; padding: 1.5rem 1.25rem 4rem; }
  h1 { font-size: 1.5rem; } h2 { font-size: 1.1rem; margin-top: 2.5rem; }
  h3 { font-size: .95rem; font-family: ui-monospace, monospace; margin-bottom: .3rem; }
  table { border-collapse: collapse; width: 100%; margin: .5rem 0; }
  td, th { border-top: 1px solid var(--line); padding: .5rem .6rem; text-align: left; vertical-align: top; }
  th { font-size: .8rem; text-transform: uppercase; letter-spacing: .05em; opacity: .7; }
  .num { font-variant-numeric: tabular-nums; white-space: nowrap; }
  .good { color: #2e9b57; } .warn { color: #c9761a; } .bad { color: #c0392b; }
  .fa { font-size: 1.35rem; line-height: 1.8; }
  .eq { opacity: .85; }
  .sub { background: color-mix(in srgb, #c9761a 30%, transparent); border-radius: .2rem; padding: 0 .15rem; }
  .del { background: color-mix(in srgb, #c0392b 28%, transparent); text-decoration: line-through; border-radius: .2rem; padding: 0 .15rem; }
  .ins { background: color-mix(in srgb, #2e9b57 28%, transparent); border-radius: .2rem; padding: 0 .15rem; }
  .clip { border-top: 1px solid var(--line); padding-top: 1.2rem; margin-top: 1.6rem; }
  .tag { font-size: .68rem; text-transform: uppercase; letter-spacing: .06em; padding: .12rem .5rem;
         border: 1px solid var(--line); border-radius: 1rem; opacity: .75; font-family: system-ui; }
  .tag.deliberate-error { color: #c9761a; border-color: #c9761a; opacity: 1; }
  .badge { font-size: .75rem; text-transform: uppercase; letter-spacing: .05em; padding: .15rem .5rem; border-radius: .3rem; }
  .badge.preserved { background: color-mix(in srgb, #2e9b57 25%, transparent); }
  .badge.repaired { background: color-mix(in srgb, #c0392b 25%, transparent); }
  .badge.other, .badge.undetectable { background: color-mix(in srgb, currentColor 12%, transparent); }
  .note { font-size: .85rem; opacity: .8; margin: .2rem 0; }
  .said { font-size: .9rem; opacity: .85; }
  .err { color: #c0392b; font-size: .85rem; }
  .warnbox { background: color-mix(in srgb, #c9761a 12%, transparent); padding: .7rem .9rem; border-radius: .5rem; font-size: .9rem; }
  .legend { font-size: .82rem; opacity: .8; }
  code { background: color-mix(in srgb, currentColor 10%, transparent); padding: .1rem .3rem; border-radius: .25rem; }
</style>
</head>
<body>
<h1>STT probe results</h1>
${missingNote}

<h2>Summary</h2>
<table>
  <thead><tr>
    <th>Arm</th>
    <th>WER on correct speech</th>
    <th>Errors preserved</th>
  </tr></thead>
  <tbody>${summaryRows}</tbody>
</table>
<p class="legend">
  <strong>WER</strong> — lower is better; this is baseline accuracy on your accented speech.<br>
  <strong>Errors preserved</strong> — higher is better. This is the number that decides the architecture.
  Below roughly 50%, transcript-diffing cannot be the basis of the teaching engine and the learner
  model needs rethinking (audio-native analysis, or narrowing to error classes that survive).
</p>

<h2>Clip by clip</h2>
<p class="legend">
  Diffs are against what you were asked to say:
  <span class="sub">substituted</span>,
  <span class="del">dropped</span>,
  <span class="ins">added</span>.
</p>
${clipBlocks}
</body>
</html>`;
}

async function main() {
  const arms = availableSttArms();
  if (arms.length === 0) {
    console.error(
      "No providers configured. Set OPENAI_API_KEY and/or AZURE_SPEECH_KEY + AZURE_SPEECH_REGION in .env.local",
    );
    process.exit(1);
  }

  const present: Clip[] = [];
  const missing: Clip[] = [];
  for (const clip of CLIPS) {
    (await exists(path.join(RECORDINGS_DIR, `${clip.id}.wav`)) ? present : missing).push(clip);
  }

  if (present.length === 0) {
    console.error(
      `No recordings in ${RECORDINGS_DIR}.\n` +
        `Run "npm run dev", open http://localhost:3000/record.html, and record the clip set.`,
    );
    process.exit(1);
  }

  console.log(`Arms: ${arms.map((a) => a.id).join(", ")}`);
  console.log(`Clips: ${present.length} recorded, ${missing.length} missing\n`);

  const results: Result[] = [];
  for (const clip of present) {
    const wav = new Uint8Array(await readFile(path.join(RECORDINGS_DIR, `${clip.id}.wav`)));
    for (const arm of arms) {
      // Terminal output stays ASCII: Ghostty and most terminals lack Unicode
      // bidi, so raw Persian here would render reversed and unreadable.
      process.stdout.write(`  ${clip.id} / ${arm.id} … `);
      try {
        const hypothesis = await transcribe(arm, wav);
        const result: Result = { clip, arm, hypothesis };
        if (clip.kind === "correct") {
          result.wer = wordErrorRate(clip.saying, hypothesis).wer;
          console.log(`WER ${((result.wer ?? 0) * 100).toFixed(0)}%`);
        } else {
          result.verdict = judge(clip, hypothesis);
          console.log(result.verdict);
        }
        results.push(result);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        results.push({ clip, arm, error: message });
        console.log(`failed — ${message}`);
      }
    }
  }

  await mkdir(OUT_DIR, { recursive: true });
  const reportPath = path.join(OUT_DIR, "stt-report.html");
  await writeFile(reportPath, buildReport(results, arms, missing));

  console.log(`\nWrote ${reportPath}`);
  console.log(`Open it:  open ${reportPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
