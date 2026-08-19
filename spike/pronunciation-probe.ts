/**
 * Diagnostic: how do we make Azure pronounce Persian correctly?
 *
 * Two failures surfaced during the Phase 0A listening pass, both of which would
 * teach a learner the wrong thing:
 *
 *  1. DIGITS — "ساعت ۸ صبح" is read "sâ'at-e sâ'at hasht-e sobh". Azure's text
 *     normalizer matches "ساعت <number>" as a time expression and re-expands the
 *     numeral with the word already present.
 *
 *  2. SHORT-VOWEL AMBIGUITY — کرم is read "kerem" (cream) even in "کرم توی باغ
 *     دیدم" (I saw a worm in the garden), where it is "kerm". Written Persian
 *     omits short vowels, so the engine must infer them from context, and every
 *     voice tested inferred wrong. This is not fixable by switching vendors; it
 *     is a property of the writing system.
 *
 * This script renders candidate fixes so each can be chosen by ear.
 *
 *   npm run spike:pron
 */

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import dotenv from "dotenv";

import { synthesizeAzureSsml } from "../src/lib/tts-provider.ts";

dotenv.config({ path: ".env.local", quiet: true });

const OUT_DIR = path.resolve("spike/out/pronunciation");

type Variant = {
  id: string;
  approach: string;
  /** SSML content, inserted verbatim into <voice>. */
  ssml: string;
  /** Source text before markup, for display. */
  source: string;
  note: string;
};

type Group = {
  id: string;
  title: string;
  problem: string;
  listenFor: string;
  variants: Variant[];
};

const GROUPS: Group[] = [
  {
    id: "digits",
    title: "Digits inside a time expression",
    problem:
      'Azure reads "ساعت ۸ صبح" as "sâ\'at-e sâ\'at hasht-e sobh" — the word ساعت twice.',
    listenFor: "Is ساعت (sâ'at) said once or twice? The number should be hasht.",
    variants: [
      {
        id: "digit-1-baseline",
        approach: "Baseline — Persian digit, no markup",
        source: "ساعت ۸ صبح می‌بینمت",
        ssml: "ساعت ۸ صبح می‌بینمت",
        note: "Known bad. Reproduces the doubled ساعت.",
      },
      {
        id: "digit-2-sayas",
        approach: "SSML say-as cardinal  ← shipped",
        source: "ساعت ۸ صبح می‌بینمت",
        ssml: 'ساعت <say-as interpret-as="cardinal">۸</say-as> صبح می‌بینمت',
        note: "Confirmed fix: 3.72s → 3.23s, exactly one ساعت removed. Now applied to all numerals automatically.",
      },
      {
        id: "digit-3-ascii",
        approach: "ASCII digit instead of Persian digit",
        source: "ساعت 8 صبح می‌بینمت",
        ssml: "ساعت 8 صبح می‌بینمت",
        note: "Does NOT work — measured identical to baseline. Both digit forms hit the same normalizer rule.",
      },
    ],
  },
  {
    id: "homograph",
    title: "Short-vowel ambiguity — کرم",
    problem:
      "کرم is kerm (worm), keram (generosity) or kerem (cream) with identical letters. " +
      "Every voice in the bakeoff — Azure and OpenAI alike — read the worm sentence as kerem. " +
      "This is a property of the writing system, not a vendor defect, so switching TTS provider " +
      "will not fix it.",
    listenFor:
      "Should be kerm — one syllable, no vowel between ر and م. Wrong is kerem, two syllables.",
    variants: [
      {
        id: "homo-1-baseline",
        approach: "Baseline — bare consonants",
        source: "کرم توی باغ دیدم",
        ssml: "کرم توی باغ دیدم",
        note: "Known bad. Reads kerem (cream) despite the garden context.",
      },
      {
        id: "homo-2-kasra",
        approach: "Harakat — kasra on ک",
        source: "کِرم توی باغ دیدم",
        ssml: "کِرم توی باغ دیدم",
        note:
          "Audio does change, so the diacritic is not ignored — but the clip got 86ms LONGER, " +
          "not shorter. Dropping a vowel should shorten it. Judge by ear whether this is kerm.",
      },
      {
        id: "homo-3-kasra-sukun",
        approach: "Harakat — kasra on ک plus sukun on ر",
        source: "کِرْم توی باغ دیدم",
        ssml: "کِرْم توی باغ دیدم",
        note:
          "Unambiguous in the writing system: sukun explicitly means no vowel follows ر. " +
          "Audio changes, but is 29ms longer than baseline rather than shorter.",
      },
      {
        id: "homo-4-phoneme-ipa",
        approach: "SSML phoneme, IPA  ← does not work",
        source: "کرم توی باغ دیدم",
        ssml: '<phoneme alphabet="ipa" ph="kerm">کرم</phoneme> توی باغ دیدم',
        note:
          "CONFIRMED IGNORED. Azure returns 200 and byte-identical audio to the baseline " +
          "(same SHA-256), so fa-IR does not support phoneme markup. Rules out per-word IPA " +
          "as a fix. The remaining untested option is a custom lexicon (PLS) via <lexicon uri>, " +
          "which needs a publicly hosted XML file.",
      },
      {
        id: "homo-5-contrast-cream",
        approach: "Contrast — the cream sentence, unmarked",
        source: "کرم صورت خریدم",
        ssml: "کرم صورت خریدم",
        note: "Reference for what kerem correctly sounds like. This one the engine gets right by luck.",
      },
    ],
  },
];

function escapeHtml(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

async function main() {
  if (!process.env.AZURE_SPEECH_KEY || !process.env.AZURE_SPEECH_REGION) {
    console.error("Needs AZURE_SPEECH_KEY and AZURE_SPEECH_REGION in .env.local");
    process.exit(1);
  }

  await mkdir(OUT_DIR, { recursive: true });
  // Pinned to Azure regardless of the selected voice: this script diagnoses
  // Azure's SSML behaviour specifically, so it must not follow SELECTED_TTS.
  const voice = "fa-IR-DilaraNeural";
  const total = GROUPS.reduce((n, g) => n + g.variants.length, 0);
  console.log(`Voice: ${voice}\nRendering ${total} variants…\n`);

  const failed = new Map<string, string>();
  for (const group of GROUPS) {
    for (const variant of group.variants) {
      process.stdout.write(`  ${variant.id} … `);
      try {
        const audio = await synthesizeAzureSsml(voice, variant.ssml);
        await writeFile(path.join(OUT_DIR, `${variant.id}.mp3`), audio);
        console.log(`ok (${(audio.byteLength / 1024).toFixed(0)} KB)`);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        failed.set(variant.id, message);
        console.log(`FAILED: ${message}`);
      }
    }
  }

  const body = GROUPS.map(
    (group) => `
  <section class="group">
    <h2>${escapeHtml(group.title)}</h2>
    <p class="problem">${escapeHtml(group.problem)}</p>
    <p class="listen"><strong>Listen for:</strong> ${escapeHtml(group.listenFor)}</p>
    ${group.variants
      .map(
        (v) => `
    <div class="variant">
      <h3>${escapeHtml(v.approach)}</h3>
      <p class="fa" dir="rtl" lang="fa">${escapeHtml(v.source)}</p>
      <pre>${escapeHtml(v.ssml)}</pre>
      <p class="note">${escapeHtml(v.note)}</p>
      ${
        failed.has(v.id)
          ? `<p class="err">${escapeHtml(failed.get(v.id)!)}</p>`
          : `<audio controls preload="metadata" src="${v.id}.mp3"></audio>`
      }
    </div>`,
      )
      .join("")}
  </section>`,
  ).join("");

  await writeFile(
    path.join(OUT_DIR, "index.html"),
    `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Persian pronunciation fixes — Azure TTS</title>
<style>
  :root { color-scheme: light dark; --line: color-mix(in srgb, currentColor 15%, transparent); }
  body { font: 16px/1.55 system-ui, sans-serif; max-width: 46rem; margin: 0 auto; padding: 1.5rem 1.25rem 4rem; }
  h1 { font-size: 1.4rem; } h2 { font-size: 1.15rem; margin-bottom: .2rem; }
  h3 { font-size: .95rem; margin-bottom: .2rem; }
  .group { border-top: 2px solid var(--line); padding-top: 1.4rem; margin-top: 2.4rem; }
  .variant { border-top: 1px solid var(--line); padding-top: 1rem; margin-top: 1.2rem; }
  .fa { font-size: 1.9rem; line-height: 1.8; margin: .3rem 0; }
  pre { background: color-mix(in srgb, currentColor 8%, transparent); padding: .5rem .7rem;
        border-radius: .4rem; font-size: .78rem; overflow-x: auto; direction: ltr; text-align: left; }
  .note { font-size: .85rem; opacity: .8; }
  .problem { opacity: .85; }
  .listen { background: color-mix(in srgb, currentColor 6%, transparent); padding: .55rem .8rem;
            border-radius: .5rem; font-size: .9rem; }
  .err { color: #c0392b; font-size: .85rem; }
  audio { width: 100%; max-width: 26rem; }
</style></head>
<body>
<h1>Persian pronunciation fixes — ${escapeHtml(voice)}</h1>
<p>Each group is one failure found while listening to the bakeoff, with candidate fixes.</p>
${body}
</body></html>`,
  );

  console.log(`\nWrote ${OUT_DIR}/index.html`);
  console.log(`Open it:  open ${OUT_DIR}/index.html`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
