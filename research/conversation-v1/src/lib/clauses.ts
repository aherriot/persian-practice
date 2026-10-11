/**
 * Splitting a streaming reply into speakable chunks.
 *
 * The whole point of M2 is not waiting for the full reply before any audio
 * exists. Text-to-speech is fired on each complete clause as it arrives, so the
 * learner hears the first words while the rest is still being written and
 * synthesised.
 *
 * The tension is prosody. Chunks that are too small sound clipped and robotic,
 * because each synthesis call gets its own intonation contour — a two-word
 * fragment spoken in isolation does not sound like part of a sentence. So a
 * chunk is only emitted at a sentence boundary *and* once it is long enough to
 * carry its own contour.
 */

/** Sentence-final punctuation, Persian and Latin. */
const TERMINATOR = /[.!?؟؛…\n]/;

export type ChunkOptions = {
  /**
   * Below this, a completed sentence is held back and merged with the next one.
   * "چشم." alone sounds clipped; "چشم، یه چایی میارم." does not.
   */
  minChars?: number;
  /**
   * Emit anyway once a run has no punctuation for this long, so a model that
   * forgets to punctuate cannot stall audio until the very end.
   */
  maxChars?: number;
  /** Stream has ended — flush whatever is left regardless of length. */
  final?: boolean;
};

export type ChunkResult = {
  /** Complete chunks, ready to synthesise, in order. */
  chunks: string[];
  /** Text held back for the next call. */
  rest: string;
};

/**
 * Pull whatever complete chunks exist out of an accumulating buffer.
 *
 * Call repeatedly as stream deltas arrive, passing back the previous `rest`
 * concatenated with the new text, then once more with `final: true`.
 */
export function extractChunks(buffer: string, options: ChunkOptions = {}): ChunkResult {
  const { minChars = 12, maxChars = 140, final = false } = options;

  // Cut at every sentence terminator. Whatever follows the last one is still
  // being written.
  const sentences: string[] = [];
  let start = 0;
  for (let i = 0; i < buffer.length; i++) {
    if (TERMINATOR.test(buffer[i])) {
      sentences.push(buffer.slice(start, i + 1));
      start = i + 1;
    }
  }
  const incomplete = buffer.slice(start);

  // Merge forward until a run is long enough to carry its own intonation. This
  // is what stops "چشم." being synthesised alone and sounding clipped.
  const chunks: string[] = [];
  let pending = "";
  for (const sentence of sentences) {
    pending += sentence;
    if (pending.trim().length >= minChars) {
      chunks.push(pending.trim());
      pending = "";
    }
  }

  let rest = pending + incomplete;

  if (final) {
    const tail = rest.trim();
    if (tail.length > 0) {
      // A short trailing fragment belongs to the sentence before it.
      if (tail.length < minChars && chunks.length > 0) {
        chunks[chunks.length - 1] = `${chunks[chunks.length - 1]} ${tail}`;
      } else {
        chunks.push(tail);
      }
    }
    rest = "";
  } else if (rest.length > maxChars) {
    // A model that forgets to punctuate must not stall audio to the very end.
    const cut = softBreak(rest, maxChars);
    if (cut > 0) {
      chunks.push(rest.slice(0, cut).trim());
      rest = rest.slice(cut);
    }
  }

  return { chunks: chunks.filter((chunk) => chunk.length > 0), rest };
}

/** Prefer breaking at a comma or space near the limit rather than mid-word. */
function softBreak(text: string, limit: number): number {
  const window = text.slice(0, limit);
  for (const mark of ["،", ",", " "]) {
    const at = window.lastIndexOf(mark);
    if (at > limit / 2) return at + 1;
  }
  return 0;
}
