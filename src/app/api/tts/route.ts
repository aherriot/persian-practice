import { errorResponse, openai, requireApiKey } from "@/lib/openai";
import { SELECTED_TTS } from "@/lib/tts-provider";

export const runtime = "nodejs";

/**
 * Steering instruction for the voice.
 *
 * Phase 0 found register is carried by the text rather than the voice
 * (FINDINGS §7), so this is mostly belt-and-braces — but the steered arm did
 * measurably handle colloquial spellings better than the unsteered one, and it
 * costs nothing.
 *
 * Deliberately NOT contrastive. FINDINGS §6 measured "do NOT pronounce it X" as
 * *worse* than naming the right form — 3/6 against 5/6 — apparently because
 * naming the wrong reading primes the model toward it.
 */
const VOICE_INSTRUCTION = [
  "Speak as a native Iranian Persian speaker with a standard Tehrani accent.",
  "Natural, warm, conversational pace — you are talking with someone learning the language.",
].join(" ");

export async function POST(request: Request): Promise<Response> {
  const missingKey = requireApiKey();
  if (missingKey) return missingKey;

  try {
    const { text, format = "mp3" } = (await request.json()) as {
      text?: string;
      format?: "mp3" | "pcm";
    };
    if (!text?.trim()) {
      return Response.json({ error: "no text to speak" }, { status: 400 });
    }

    const speech = await openai.audio.speech.create({
      model: "gpt-4o-mini-tts",
      voice: SELECTED_TTS.voice,
      input: text,
      response_format: format,
      instructions: VOICE_INSTRUCTION,
    });

    // Piped, not buffered. Measured in spike/tts-latency.ts: the first audio
    // bytes arrive at ~532ms but the clip is not complete until ~1221ms, so
    // awaiting arrayBuffer() here would throw away ~689ms per clause — a bigger
    // loss than the saving from splitting the text into clauses at all.
    if (!speech.body) throw new Error("speech response had no body");

    return new Response(speech.body, {
      headers: {
        "Content-Type": format === "pcm" ? "audio/L16; rate=24000" : "audio/mpeg",
        "Cache-Control": "no-store",
        "X-Accel-Buffering": "no",
      },
    });
  } catch (err) {
    return errorResponse("tts", err);
  }
}
