import type { CompletionUsage } from "openai/resources/completions";

/**
 * What one model call spent, as a single line of JSON beside the error
 * reports. OpenAI's usage export only says which model was used, not which
 * call: this is what tells the sentence author from the reviewer, and hidden
 * reasoning from the answer.
 */
export type UsageReport = {
  level: "usage";
  /** Which call: "author:sentences", "author:review", "listener"… */
  scope: string;
  model: string;
  input: number;
  output: number;
  /** The part of output spent thinking, which is billed but never seen. */
  reasoning?: number;
  inputAudio?: number;
  time: string;
};

export function describeUsage(scope: string, model: string, usage: CompletionUsage, now = new Date()): UsageReport {
  return {
    level: "usage",
    scope,
    model,
    input: usage.prompt_tokens,
    output: usage.completion_tokens,
    reasoning: usage.completion_tokens_details?.reasoning_tokens || undefined,
    inputAudio: usage.prompt_tokens_details?.audio_tokens || undefined,
    time: now.toISOString(),
  };
}

export function reportUsage(scope: string, model: string, usage: CompletionUsage | undefined): void {
  if (usage) console.info(JSON.stringify(describeUsage(scope, model, usage)));
}
