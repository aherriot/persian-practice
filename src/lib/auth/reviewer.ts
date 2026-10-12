import { devAuthEnabled } from "./dev-mode";

/**
 * Who may judge lesson audio. Clips are shared by every learner and a
 * rejection spends money on a remake, so this is not open to all accounts:
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
