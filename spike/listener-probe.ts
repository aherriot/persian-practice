/**
 * Can a model listen to synthesised Persian and tell whether it was pronounced
 * as intended?
 *
 * Runs the app's listener (src/lib/audio-verify.ts) over recordings a human
 * has already rated — the 17 rated clips from the instruction probe (FINDINGS
 * §6) and any extra labelled clips in spike/recordings/listener/ — and reports
 * how often the two agree. A listener that passes wrong audio is worse than no
 * listener, so false passes are the number that matters.
 *
 * Usage: npm run spike:listener [model]   (default: the app's listener model)
 */
import "../scripts/load-env.ts";

import { existsSync, readFileSync } from "node:fs";
import { listen, LISTENER_MODEL } from "../src/lib/audio-verify.ts";
import { HOMOGRAPHS } from "./homographs.ts";

const RUNS = 2;
const MODEL = process.argv[2] ?? LISTENER_MODEL;

// Human ratings from FINDINGS §6. kerm/plain was left unrated.
const RATED: Record<string, Record<string, boolean>> = {
  "kerm-worm": { named: true, contrastive: true },
  "mord-died": { plain: true, named: true, contrastive: true },
  "noh-nine": { plain: true, named: true, contrastive: true },
  "gel-mud": { plain: false, named: true, contrastive: false },
  "geram-gram": { plain: true, named: true, contrastive: false },
  "shosh-lung": { plain: false, named: false, contrastive: false },
};

type Clip = { file: string; expected: string[]; good: boolean };

const clips: Clip[] = [];
for (const [id, ratings] of Object.entries(RATED)) {
  const reading = HOMOGRAPHS.flatMap((h) => h.readings).find((r) => r.id === id);
  if (!reading) throw new Error(`no homograph reading ${id}`);
  for (const [strategy, good] of Object.entries(ratings)) {
    clips.push({ file: `spike/out/instruct/${id}--${strategy}.mp3`, expected: reading.sentenceTranslit.split(/\s+/), good });
  }
}
const extra = "spike/recordings/listener/labels.json";
if (existsSync(extra)) {
  for (const clip of JSON.parse(readFileSync(extra, "utf8")) as Clip[]) {
    clips.push({ ...clip, file: `spike/recordings/listener/${clip.file}` });
  }
}

async function main() {
  let agree = 0;
  let falsePass = 0;
  let falseFail = 0;
  let total = 0;
  for (const clip of clips) {
    if (!existsSync(clip.file)) {
      console.log(`skip (missing) ${clip.file}`);
      continue;
    }
    const audio = readFileSync(clip.file);
    for (let run = 0; run < RUNS; run++) {
      const verdict = await listen(audio, clip.expected, MODEL);
      total++;
      if (verdict.pass === clip.good) agree++;
      else if (verdict.pass) falsePass++;
      else falseFail++;
      const mark = verdict.pass === clip.good ? "  " : verdict.pass ? "FALSE PASS" : "false fail";
      console.log(
        `${mark.padEnd(10)} human=${clip.good ? "good" : "bad "} listener=${verdict.pass ? "pass" : "fail"}${verdict.pause ? "(pause)" : ""}  ${clip.file.split("/").pop()}  heard: ${verdict.heard.join(" ")}  want: ${clip.expected.join(" ")}`,
      );
    }
  }
  console.log(`\n${MODEL}: ${agree}/${total} agree · ${falsePass} false passes · ${falseFail} false fails`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
