/**
 * Does ق / غ come out as it does in Tehran, and what makes it do so?
 *
 * The project owner rejected the clip of غذا for its accent, and reported that
 * it sounds like Dari [ɣɪzɑː] — a gargled fricative and a short i — where
 * Tehran has [ɢæzɒː]: a stop at the back of the mouth, and the a of "cat".
 * FINDINGS §7 rated ق/غ Iranian, but on four sentences; §14 found the listener
 * deaf to accent when asked outright. This asks it something narrower — what
 * the first consonant and vowel were — of takes made several ways. It turned
 * out not to hear that either; the waveforms settled it (spike/gh-onset.py,
 * FINDINGS §16).
 *
 * Usage: npm run spike:gh [-- takes]     output in spike/out/gh
 */
import "../scripts/load-env.ts";

import { get } from "@vercel/blob";
import { eq } from "drizzle-orm";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { VOICE_INSTRUCTION } from "../src/lib/audio-key.ts";
import { LISTENER_MODEL } from "../src/lib/audio-verify.ts";
import { db } from "../src/lib/db/index.ts";
import { audioClips, audioReviews } from "../src/lib/db/schema.ts";
import { openai } from "../src/lib/openai.ts";
import { createThrottle, isRateLimit, sleep } from "../src/lib/throttle.ts";
import { synthesize } from "../src/lib/tts-provider.ts";

const OUT_DIR = path.resolve("spike/out/gh");
const TAKES = Number(process.argv[2] ?? 4);
const LISTENS = 3;

const GH =
  'The letters ق and غ are one sound in Tehran, a firm stop made at the very back of the mouth, like a hard "g" said far back: قند، غذا، قهوه.';

/** Each text, plain and with its vowels written, and the word the question is about. */
const TEXTS = [
  { expected: "ghazâ", fa: "غذا.", voc: "غَذا.", word: 1 },
  { expected: "ghahve", fa: "قهوه.", voc: "قَهوِه.", word: 1 },
  { expected: "gheymat", fa: "قیمت.", voc: "قِیمَت.", word: 1 },
  { expected: "ghazâ mikhâm", fa: "غذا می‌خوام.", voc: "غَذا می‌خوام.", word: 1 },
  { expected: "in ghazâ kheyli khoshmazast", fa: "این غذا خیلی خوشمزه‌ست.", voc: "این غَذا خیلی خوشمَزه‌ست.", word: 2 },
  // Controls: what the listener says of a plain stop and a plain fricative.
  { expected: "gedâ", fa: "گدا.", voc: "گِدا.", word: 1 },
  { expected: "khodâ", fa: "خدا.", voc: "خُدا.", word: 1 },
];

/** ق and غ are one sound in Tehran, so a word can be spelled with either for the speech model. */
const respell = (text: string) => text.replace(/(^|\s)غ/g, "$1ق");

const ARMS: { id: string; instructions: string; vowelled?: boolean; respelled?: boolean }[] = [
  { id: "voice", instructions: VOICE_INSTRUCTION },
  { id: "voice+gh", instructions: `${VOICE_INSTRUCTION} ${GH}` },
  { id: "vowelled", instructions: VOICE_INSTRUCTION, vowelled: true },
  { id: "respelled", instructions: VOICE_INSTRUCTION, respelled: true },
];

const question = (expected: string, word: number) => `This is a recording of Persian text-to-speech. It should say: ${expected}

Listen only to word ${word}, "${expected.split(" ")[word - 1]}", and describe how it was actually spoken, not how it should be.

1. Its first consonant. Either "stop": the airflow is fully blocked and released in a burst, like a hard g or k made at the very back of the mouth. Or "fricative": a continuous gargled or rasping sound with no blockage, like a French r or the Arabic غ.
2. Its first vowel: "a" as in cat, "e" as in bed, "i" as in bit or machine, or "o".

Reply with JSON only: {"heard":"the word as you heard it","consonant":"stop"|"fricative","vowel":"a"|"e"|"i"|"o"}`;

async function ask(audio: Buffer, expected: string, word: number): Promise<string> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const response = await openai.chat.completions.create({
      model: LISTENER_MODEL,
      modalities: ["text"],
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: question(expected, word) },
            { type: "input_audio", input_audio: { data: audio.toString("base64"), format: "mp3" } },
          ],
        },
      ],
    });
    const raw = response.choices[0]?.message.content ?? "";
    try {
      const reply = JSON.parse(raw.slice(raw.indexOf("{"), raw.lastIndexOf("}") + 1));
      return `${String(reply.consonant)[0]}${reply.vowel}`;
    } catch {
      // The listener sometimes answers as if there were no audio; ask again.
    }
  }
  return "??";
}

async function blob(pathname: string): Promise<Buffer | null> {
  const stored = await get(pathname, { access: "private" });
  return stored?.statusCode === 200 ? Buffer.from(await new Response(stored.stream).arrayBuffer()) : null;
}

async function main() {
  await mkdir(OUT_DIR, { recursive: true });
  const throttle = createThrottle(500);
  const samples: { text: string; arm: string; file: string; word: number }[] = [];

  for (const text of TEXTS) {
    const [row] = await db.select().from(audioClips).where(eq(audioClips.expected, text.expected));
    if (row) {
      const stored = await blob(`audio/${row.hash}.mp3`);
      const file = path.join(OUT_DIR, `${text.expected.replaceAll(" ", "_")}.stored.mp3`);
      if (stored) await writeFile(file, stored);
      if (stored) samples.push({ text: text.expected, arm: "stored", file, word: text.word });
      // Takes a person turned down for their accent are the only bad examples there are.
      const reviews = await db.select().from(audioReviews).where(eq(audioReviews.hash, row.hash));
      for (const review of reviews.filter((r) => r.verdict === "rejected")) {
        const rejected = await blob(`reviewed/${review.id}.mp3`);
        const kept = path.join(OUT_DIR, `${text.expected.replaceAll(" ", "_")}.rejected-${review.id}.mp3`);
        if (rejected) await writeFile(kept, rejected);
        if (rejected) samples.push({ text: text.expected, arm: `rejected (${review.reason})`, file: kept, word: text.word });
      }
    }
    for (const arm of ARMS) {
      if (arm.respelled && respell(text.fa) === text.fa) continue;
      for (let take = 1; take <= TAKES; take++) {
        const file = path.join(OUT_DIR, `${text.expected.replaceAll(" ", "_")}.${arm.id}.${take}.mp3`);
        samples.push({ text: text.expected, arm: arm.id, file, word: text.word });
        if (existsSync(file)) continue;
        for (let attempt = 1; ; attempt++) {
          await throttle();
          try {
            const tts = { id: arm.id, provider: "openai" as const, voice: "nova", label: arm.id, instructions: arm.instructions };
            await writeFile(file, await synthesize(tts, arm.vowelled ? text.voc : arm.respelled ? respell(text.fa) : text.fa));
            break;
          } catch (err) {
            if (!isRateLimit(err) || attempt >= 3) throw err;
            await sleep(3_000 * attempt);
          }
        }
      }
    }
  }

  const resultsFile = path.join(OUT_DIR, "results.json");
  const results: Record<string, string[]> = existsSync(resultsFile) ? JSON.parse(await readFile(resultsFile, "utf8")) : {};
  for (const sample of samples) {
    const key = path.basename(sample.file);
    results[key] ??= [];
    while (results[key].length < LISTENS) {
      await throttle();
      results[key].push(await ask(await readFile(sample.file), sample.text, sample.word));
    }
    await writeFile(resultsFile, JSON.stringify(results, null, 2));
  }

  // "sa" is the reading wanted: a stop, then the a of "cat".
  for (const text of TEXTS) {
    console.log(`\n${text.expected}`);
    for (const arm of [...new Set(samples.filter((s) => s.text === text.expected).map((s) => s.arm))]) {
      const mine = samples.filter((s) => s.text === text.expected && s.arm === arm);
      const listens = mine.flatMap((s) => results[path.basename(s.file)]);
      const stops = listens.filter((l) => l[0] === "s").length;
      console.log(`  ${arm.padEnd(20)} stop ${stops}/${listens.length}   ${mine.map((s) => results[path.basename(s.file)].join(",")).join("  ")}`);
    }
  }
}

main().then(() => process.exit(0), (err) => {
  console.error(err);
  process.exit(1);
});
