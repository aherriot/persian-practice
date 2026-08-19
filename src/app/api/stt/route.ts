import { toFile } from "openai";

import { CHAT_MODEL, errorResponse, openai, requireApiKey } from "@/lib/openai";
import { assessTranscript } from "@/lib/transcript";

export const runtime = "nodejs";

/**
 * The verbatim prompt is mandatory, not an option.
 *
 * Without it, gpt-4o-transcribe falls out of Persian entirely and returns
 * romanised or hallucinated Latin text — "michel dotrice war am theater
 * bekannt" for می‌شه لطفاً آروم‌تر صحبت کنید؟ — *despite* language: "fa" being
 * set. Phase 0 measured 44% word error rate without it against 4% with it, and
 * error preservation rising from 25% to 75% (FINDINGS §9).
 *
 * Preserving mistakes is the point: a learner's wrong tense is the signal the
 * teaching engine exists to detect, so a recogniser that helpfully repairs it
 * destroys the evidence before anything downstream sees it.
 */
const VERBATIM_PROMPT = [
  "Transcribe exactly what the speaker says, word for word.",
  "The speaker is learning Persian and will make grammatical mistakes.",
  "Preserve their mistakes verbatim. Do not correct grammar, tense, or word order.",
  // Added after transcripts came back in Latin letters during real use. The
  // prompt itself is English, which appears to bias the output script, so the
  // required script is now stated explicitly.
  "Always write the transcript in Persian script (the Arabic alphabet).",
  "Never romanise, transliterate, or use Latin letters.",
].join(" ");

export const STT_MODEL = process.env.OPENAI_STT_MODEL ?? "gpt-4o-transcribe";

export async function POST(request: Request): Promise<Response> {
  const missingKey = requireApiKey();
  if (missingKey) return missingKey;

  try {
    const audio = Buffer.from(await request.arrayBuffer());
    if (audio.byteLength === 0) {
      return Response.json({ error: "empty audio body" }, { status: 400 });
    }

    const started = Date.now();
    const result = await openai.audio.transcriptions.create({
      file: await toFile(audio, "turn.wav", { type: "audio/wav" }),
      model: STT_MODEL,
      // Forcing the language stops the model guessing Arabic or Urdu from short,
      // heavily accented clips. Necessary but not sufficient — see the prompt.
      language: "fa",
      prompt: VERBATIM_PROMPT,
    });

    const check = assessTranscript(result.text);
    return Response.json({
      text: result.text,
      // The client needs to know the transcript was unusable so the tutor can
      // ask for a repeat, rather than answering nonsense as though it made
      // sense — which teaches the learner they were understood when they were
      // not.
      verdict: check.verdict,
      usable: check.usable,
      ms: Date.now() - started,
      model: STT_MODEL,
      chatModel: CHAT_MODEL,
    });
  } catch (err) {
    return errorResponse("stt", err);
  }
}
