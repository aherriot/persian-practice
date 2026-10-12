import OpenAI from "openai";
import { reportError } from "@/lib/report-error";

/**
 * Shared OpenAI client for the app's route handlers.
 *
 * `maxRetries: 0` is deliberate. The SDK otherwise retries 429s internally,
 * sleeping inside the call while honouring Retry-After — which hides rate
 * limiting from the caller and, during Phase 0, presented as a silent hang with
 * no output for minutes. Failures should surface where they can be measured and
 * reported, not absorbed.
 */
export const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
  maxRetries: 0,
  timeout: 60_000,
});

/**
 * Conversation model. Overridable because M1 measures latency and the language
 * model is expected to be the largest single span — a smaller model is the first
 * lever to pull if the turn is too slow.
 */
export const CHAT_MODEL = process.env.OPENAI_CHAT_MODEL ?? "gpt-4o";

export function requireApiKey(): Response | null {
  if (process.env.OPENAI_API_KEY) return null;
  return Response.json(
    { error: "OPENAI_API_KEY is not set. Copy .env.example to .env.local." },
    { status: 500 },
  );
}

/** Turns a provider error into a JSON response without leaking the API key. */
export function errorResponse(scope: string, err: unknown): Response {
  const message = err instanceof Error ? err.message : String(err);
  const status = /\b429\b|rate limit/i.test(message)
    ? 429
    : /\b401\b|api key/i.test(message)
      ? 401
      : 502;
  reportError(scope, err, { status });
  return Response.json({ error: `${scope}: ${message}` }, { status });
}
