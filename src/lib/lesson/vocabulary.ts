import type { Lexeme } from "./types";

/** The most words an author is shown in full, however many the learner knows. */
export const WORKING_VOCABULARY = 150;
/** How many of those are the learner's most used words. */
const CORE = 60;

/**
 * The words an author gets to write with. A learner who knows thousands of
 * words cannot have them all listed in every prompt, and a sentence only needs
 * a few, so beyond WORKING_VOCABULARY the list is:
 *   - the words asked for (`must`), whatever else happens;
 *   - the words used in most sentences, which are the ones that hold a sentence
 *     together: verbs, pronouns, question words, connectors;
 *   - a random draw from the rest, different each time, so that over many
 *     batches every word gets written about.
 * At or under the limit every word is kept.
 */
export function workingVocabulary(
  words: Lexeme[],
  opts: {
    /** Ids that must be included. */
    must?: string[];
    /** How many sentences use each word. */
    uses: Map<string, number>;
    limit?: number;
    random?: () => number;
  },
): Lexeme[] {
  const { must = [], uses, limit = WORKING_VOCABULARY, random = Math.random } = opts;
  if (words.length <= limit) return words;

  const chosen = new Set(must);
  const byUse = [...words].sort((a, b) => (uses.get(b.id) ?? 0) - (uses.get(a.id) ?? 0));
  const core = Math.round((limit * CORE) / WORKING_VOCABULARY);
  for (const word of byUse.slice(0, core)) chosen.add(word.id);

  const rest = words.filter((word) => !chosen.has(word.id));
  for (let i = rest.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [rest[i], rest[j]] = [rest[j], rest[i]];
  }
  for (const word of rest) {
    if (chosen.size >= limit) break;
    chosen.add(word.id);
  }
  // In the order given, so the list reads the same way whichever words are in it.
  return words.filter((word) => chosen.has(word.id));
}
