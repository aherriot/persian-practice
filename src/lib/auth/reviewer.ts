import { devAuthEnabled } from "./dev-mode";

/**
 * Who may change what every learner shares: the curated words and sentences,
 * and their recordings. A fix spends money on the language model and on
 * remade audio, so this is not open to all accounts:
 * only the emails in `AUDIO_REVIEWER_EMAILS` (comma-separated). With none set,
 * anyone signed in may review outside production, and nobody in production.
 */
export function canReviewAudio(email: string | null): boolean {
  const allowed = (process.env.AUDIO_REVIEWER_EMAILS ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  if (allowed.length === 0) return devAuthEnabled;
  return email !== null && allowed.includes(email.trim().toLowerCase());
}
