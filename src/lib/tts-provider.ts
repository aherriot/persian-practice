/**
 * TTS provider abstraction.
 *
 * This interface exists on day one rather than "eventually" because Persian
 * voice quality is precisely the axis on which we expect to switch vendors.
 * OpenAI's Persian output is reported by its own developer community to carry
 * an Afghan/Dari accent rather than standard Iranian Persian; Azure ships
 * purpose-built fa-IR voices. Phase 0A decides between them, and this module is
 * what makes that decision a one-line change instead of a refactor.
 */

export type TtsProviderName = "openai" | "azure";

export type TtsArm = {
  /** Stable id, used as the blind key in the bakeoff. */
  id: string;
  provider: TtsProviderName;
  voice: string;
  /** Human-readable label — revealed to the rater only after scoring. */
  label: string;
  /** Steering text. Only gpt-4o-mini-tts honours this; Azure ignores it. */
  instructions?: string;
};

/**
 * Steering prompt for the OpenAI arm. Included as its own arm so the bakeoff
 * answers a question worth knowing: can the reported accent problem simply be
 * prompted away, or is it baked into the model?
 */
const IRANIAN_ACCENT_INSTRUCTION = [
  "Speak as a native Iranian Persian speaker with a standard Tehrani accent.",
  "Use a natural, warm, patient conversational pace, as if speaking with someone learning the language.",
  "Do not use an Afghan, Dari, or Tajik accent.",
].join(" ");

export const TTS_ARMS: TtsArm[] = [
  {
    id: "openai-alloy",
    provider: "openai",
    voice: "alloy",
    label: "OpenAI gpt-4o-mini-tts — alloy (no steering)",
  },
  {
    id: "openai-nova",
    provider: "openai",
    voice: "nova",
    label: "OpenAI gpt-4o-mini-tts — nova (no steering)",
  },
  {
    id: "openai-alloy-steered",
    provider: "openai",
    voice: "alloy",
    label: "OpenAI gpt-4o-mini-tts — alloy (steered to Tehrani accent)",
    instructions: IRANIAN_ACCENT_INSTRUCTION,
  },
  {
    id: "azure-dilara",
    provider: "azure",
    voice: "fa-IR-DilaraNeural",
    label: "Azure Neural — fa-IR-DilaraNeural (female)",
  },
  {
    id: "azure-farid",
    provider: "azure",
    voice: "fa-IR-FaridNeural",
    label: "Azure Neural — fa-IR-FaridNeural (male)",
  },
];

export const OPENAI_TTS_MODEL = "gpt-4o-mini-tts";

/** Which arms can actually run, given the credentials present in the env. */
export function availableArms(env: NodeJS.ProcessEnv = process.env): TtsArm[] {
  const hasOpenAi = Boolean(env.OPENAI_API_KEY);
  const hasAzure = Boolean(env.AZURE_SPEECH_KEY && env.AZURE_SPEECH_REGION);
  return TTS_ARMS.filter((arm) =>
    arm.provider === "openai" ? hasOpenAi : hasAzure,
  );
}

function escapeXml(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

async function synthesizeOpenAi(arm: TtsArm, text: string): Promise<Uint8Array> {
  const { default: OpenAI } = await import("openai");
  const client = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
    // The SDK otherwise retries 429s internally, sleeping inside the call while
    // honouring Retry-After. That hides rate limiting from the caller's retry
    // loop and makes a throttled run look like a silent hang. Surface it here
    // so pacing and backoff stay visible and under our control.
    maxRetries: 0,
    timeout: 60_000,
  });
  const response = await client.audio.speech.create({
    model: OPENAI_TTS_MODEL,
    voice: arm.voice,
    input: text,
    response_format: "mp3",
    ...(arm.instructions ? { instructions: arm.instructions } : {}),
  });
  return new Uint8Array(await response.arrayBuffer());
}

/**
 * Synthesizes pre-marked-up SSML content, for cases where plain text is read
 * wrongly. Azure's text normalizer expands "ساعت ۸" as a time expression and
 * says the word ساعت twice; `<say-as>` is how that gets overridden.
 *
 * `inner` is inserted verbatim, so callers are responsible for escaping any
 * literal text they wrap.
 */
export async function synthesizeAzureSsml(voice: string, inner: string): Promise<Uint8Array> {
  const region = process.env.AZURE_SPEECH_REGION;
  const key = process.env.AZURE_SPEECH_KEY;
  if (!region || !key) {
    throw new Error("AZURE_SPEECH_KEY and AZURE_SPEECH_REGION must both be set");
  }

  // The REST endpoint avoids pulling in the (large) Speech SDK for what is a
  // single POST. lang and voice are both fa-IR here.
  const ssml =
    `<speak version="1.0" xml:lang="fa-IR">` +
    `<voice name="${voice}">${inner}</voice>` +
    `</speak>`;

  const response = await fetch(
    `https://${region}.tts.speech.microsoft.com/cognitiveservices/v1`,
    {
      method: "POST",
      headers: {
        "Ocp-Apim-Subscription-Key": key,
        "Content-Type": "application/ssml+xml",
        "X-Microsoft-OutputFormat": "audio-24khz-96kbitrate-mono-mp3",
        "User-Agent": "persian-practice-spike",
      },
      body: ssml,
      signal: AbortSignal.timeout(60_000),
    },
  );

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`Azure TTS ${response.status} ${response.statusText}: ${detail.slice(0, 300)}`);
  }
  return new Uint8Array(await response.arrayBuffer());
}

/** Persian, Arabic-Indic and ASCII digit runs. */
const NUMERAL_RUN = /[0-9٠-٩۰-۹]+/g;

/**
 * Escapes text for SSML and marks numerals as cardinals.
 *
 * Azure's Persian text normalizer matches "ساعت <number>" as a time expression
 * and re-expands the numeral with the word ساعت, so "ساعت ۸ صبح" is spoken as
 * "sâ'at-e sâ'at hasht-e sobh". Measured against fa-IR-DilaraNeural, wrapping
 * the numeral in say-as removes exactly one utterance of ساعت (3.72s → 3.23s).
 * Substituting an ASCII digit changes nothing — both digit forms hit the same
 * normalizer rule — so this markup is the only fix that keeps digits in the
 * source text.
 *
 * Known limitation: each digit run becomes its own cardinal, so a clock time
 * written ۸:۳۰ reads as "hasht si" rather than "hasht-o nim". Times should be
 * written as words until that is handled.
 */
export function toSsmlWithCardinals(text: string): string {
  return escapeXml(text).replace(
    NUMERAL_RUN,
    (digits) => `<say-as interpret-as="cardinal">${digits}</say-as>`,
  );
}

/** Synthesize `text` with `arm`, returning MP3 bytes. */
export async function synthesize(arm: TtsArm, text: string): Promise<Uint8Array> {
  return arm.provider === "openai"
    ? synthesizeOpenAi(arm, text)
    : synthesizeAzureSsml(arm.voice, toSsmlWithCardinals(text));
}

/**
 * Selected voice, after native-speaker blind rating (FINDINGS.md §7).
 *
 * Azure was the earlier pick, on the premise that OpenAI's Persian carries an
 * Afghan/Dari accent. A native speaker rated 9 sentences x 4 voices across six
 * phonological markers that separate Iranian Persian from Dari, and judged every
 * voice Iranian on every marker — the claim did not reproduce, so Azure's only
 * advantage was imaginary.
 *
 * On the axis that does differ, OpenAI scored 5/6 on Persian homographs against
 * Azure's 0/6 (§5, §6), because it reads for context where Azure applies a
 * frequency table.
 *
 * `nova` specifically: rated Iranian on all nine sentences and reads colloquial
 * spellings (خونه، نون) naturally with no steering — unlike bare `alloy`, which
 * mispronounces them.
 */
export const SELECTED_TTS: TtsArm = {
  id: "selected",
  provider: "openai",
  voice: "nova",
  label: "OpenAI gpt-4o-mini-tts — nova",
};
