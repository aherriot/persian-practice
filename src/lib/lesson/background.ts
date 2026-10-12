import { expandFrontier } from "./expand";
import { topUpSentences } from "./generate";

/**
 * Everything that gets content ready for a learner's next session, run after a
 * page has been sent: new words and grammar if they are running out, then
 * fresh sentences to practise what they know.
 */
export async function prepareNextSession(userId: string): Promise<void> {
  try {
    await expandFrontier(userId);
    await topUpSentences(userId);
  } catch (err) {
    console.error("prepareNextSession", err);
  }
}
