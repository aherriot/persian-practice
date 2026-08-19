/**
 * Speech-to-text provider abstraction.
 *
 * The arms here are chosen to answer one question the product depends on: does
 * the transcript preserve a learner's grammatical mistakes, or does the model
 * quietly repair them on the way out? ASR is trained to produce fluent text,
 * which is the opposite of what a tutoring app needs.
 */

export type SttProviderName = "openai" | "azure";

export type SttArm = {
  id: string;
  provider: SttProviderName;
  label: string;
  model?: string;
  /** Biasing prompt. OpenAI only; Azure's REST endpoint has no equivalent. */
  prompt?: string;
};

/**
 * If error-repair turns out to be promptable-away, this is the fix — so it gets
 * its own arm rather than being assumed either way.
 */
const VERBATIM_PROMPT = [
  "Transcribe exactly what the speaker says, word for word.",
  "The speaker is learning Persian and will make grammatical mistakes.",
  "Preserve their mistakes verbatim. Do not correct grammar, tense, or word order.",
].join(" ");

export const STT_ARMS: SttArm[] = [
  {
    id: "openai-transcribe",
    provider: "openai",
    model: "gpt-4o-transcribe",
    label: "OpenAI gpt-4o-transcribe (no prompt)",
  },
  {
    id: "openai-transcribe-verbatim",
    provider: "openai",
    model: "gpt-4o-transcribe",
    label: "OpenAI gpt-4o-transcribe (verbatim prompt)",
    prompt: VERBATIM_PROMPT,
  },
  {
    id: "azure-fa",
    provider: "azure",
    label: "Azure Speech fa-IR",
  },
];

export function availableSttArms(env: NodeJS.ProcessEnv = process.env): SttArm[] {
  const hasOpenAi = Boolean(env.OPENAI_API_KEY);
  const hasAzure = Boolean(env.AZURE_SPEECH_KEY && env.AZURE_SPEECH_REGION);
  return STT_ARMS.filter((arm) =>
    arm.provider === "openai" ? hasOpenAi : hasAzure,
  );
}

async function transcribeOpenAi(arm: SttArm, wav: Uint8Array): Promise<string> {
  const { default: OpenAI, toFile } = await import("openai");
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const file = await toFile(Buffer.from(wav), "clip.wav", { type: "audio/wav" });

  const result = await client.audio.transcriptions.create({
    file,
    model: arm.model ?? "gpt-4o-transcribe",
    // Forcing the language avoids the model guessing Arabic or Urdu from short,
    // heavily accented clips.
    language: "fa",
    ...(arm.prompt ? { prompt: arm.prompt } : {}),
  });
  return result.text;
}

async function transcribeAzure(_arm: SttArm, wav: Uint8Array): Promise<string> {
  const region = process.env.AZURE_SPEECH_REGION;
  const key = process.env.AZURE_SPEECH_KEY;
  if (!region || !key) {
    throw new Error("AZURE_SPEECH_KEY and AZURE_SPEECH_REGION must both be set");
  }

  const url =
    `https://${region}.stt.speech.microsoft.com` +
    `/speech/recognition/conversation/cognitiveservices/v1?language=fa-IR&format=detailed`;

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Ocp-Apim-Subscription-Key": key,
      // The recorder writes 16 kHz mono PCM specifically so this header is true.
      "Content-Type": "audio/wav; codecs=audio/pcm; samplerate=16000",
      Accept: "application/json",
    },
    body: Buffer.from(wav),
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`Azure STT ${response.status} ${response.statusText}: ${detail.slice(0, 300)}`);
  }

  const body = (await response.json()) as {
    RecognitionStatus?: string;
    DisplayText?: string;
    NBest?: Array<{ Display?: string; Lexical?: string }>;
  };

  if (body.RecognitionStatus && body.RecognitionStatus !== "Success") {
    throw new Error(`Azure recognition status: ${body.RecognitionStatus}`);
  }
  return body.DisplayText ?? body.NBest?.[0]?.Display ?? "";
}

export async function transcribe(arm: SttArm, wav: Uint8Array): Promise<string> {
  return arm.provider === "openai"
    ? transcribeOpenAi(arm, wav)
    : transcribeAzure(arm, wav);
}
