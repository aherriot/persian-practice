/**
 * Persian/Farsi text normalization and comparison.
 *
 * Persian text reaches us from ASR, LLMs, and dictionaries with inconsistent
 * code points for characters that read identically: Arabic vs Persian letter
 * forms, four competing digit systems, optional diacritics, and ZWNJ appearing
 * where a plain space or nothing else might. Without normalization, strings a
 * reader would call the same compare as different, which silently corrupts any
 * vocabulary matching or transcription scoring built on top.
 */

/** Zero-width non-joiner (نیم‌فاصله) — a real part of Persian orthography. */
export const ZWNJ = "‌";

/** Arabic code points that have a distinct Persian preferred form. */
const LETTER_FOLD: Record<string, string> = {
  "ي": "ی", // ARABIC YEH        ي -> FARSI YEH      ی
  "ى": "ی", // ALEF MAKSURA      ى -> FARSI YEH      ی
  "ك": "ک", // ARABIC KAF        ك -> KEHEH          ک
  "ة": "ه", // TEH MARBUTA       ة -> HEH            ه
};

/** Harakat (short-vowel marks), sukun, shadda, superscript alef, tatweel. */
const DIACRITICS = /[ً-ْٰـ]/g;

/** Arabic-Indic (٠-٩) and Extended/Persian (۰-۹) digits. */
const ARABIC_INDIC_ZERO = 0x0660;
const PERSIAN_ZERO = 0x06f0;

const PUNCTUATION = /[،؛؟«»٫٬.,!?;:()"'“”…\-–—]/g;

function foldDigits(ch: string): string {
  const cp = ch.codePointAt(0)!;
  if (cp >= ARABIC_INDIC_ZERO && cp <= ARABIC_INDIC_ZERO + 9) {
    return String(cp - ARABIC_INDIC_ZERO);
  }
  if (cp >= PERSIAN_ZERO && cp <= PERSIAN_ZERO + 9) {
    return String(cp - PERSIAN_ZERO);
  }
  return ch;
}

/**
 * Canonical form. Safe for storage and display: unifies letter and digit
 * variants, strips diacritics, collapses whitespace. Deliberately preserves
 * ZWNJ, which carries real orthographic meaning (می‌رم is correctly spelled
 * with one; میرم is a casual spelling of the same word).
 */
export function normalizePersian(input: string): string {
  return input
    .normalize("NFC")
    .replace(DIACRITICS, "")
    .replace(/./gu, (ch) => LETTER_FOLD[ch] ?? foldDigits(ch))
    .replace(/[ \t]+/g, " ")
    .trim();
}

/**
 * Aggressive form, for equality checks and transcription scoring only — never
 * for display or for sending to TTS. Additionally removes ZWNJ and punctuation
 * so that ASR output and hand-written ground truth agree on spelling.
 *
 * Known limitation: this joins می‌رم -> میرم but cannot join "می رم" (written
 * with a real space), which stays two tokens. That variant is rarer in practice
 * and conflating it would break tokenization for word-error-rate scoring.
 */
export function normalizeForCompare(input: string): string {
  return normalizePersian(input)
    .replaceAll(ZWNJ, "")
    .replace(PUNCTUATION, " ")
    .replace(/\s+/g, " ")
    .toLowerCase()
    .trim();
}

export function tokenize(input: string): string[] {
  const cleaned = normalizeForCompare(input);
  return cleaned.length === 0 ? [] : cleaned.split(" ");
}

export type AlignOp =
  | { op: "eq"; ref: string; hyp: string }
  | { op: "sub"; ref: string; hyp: string }
  | { op: "del"; ref: string }
  | { op: "ins"; hyp: string };

/**
 * Token-level Levenshtein alignment. Returns the edit script rather than just a
 * distance so callers can render a word-by-word diff.
 */
export function alignTokens(refText: string, hypText: string): AlignOp[] {
  const ref = tokenize(refText);
  const hyp = tokenize(hypText);
  const n = ref.length;
  const m = hyp.length;

  const cost: number[][] = Array.from({ length: n + 1 }, () =>
    new Array<number>(m + 1).fill(0),
  );
  for (let i = 0; i <= n; i++) cost[i][0] = i;
  for (let j = 0; j <= m; j++) cost[0][j] = j;

  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      const sub = cost[i - 1][j - 1] + (ref[i - 1] === hyp[j - 1] ? 0 : 1);
      cost[i][j] = Math.min(sub, cost[i - 1][j] + 1, cost[i][j - 1] + 1);
    }
  }

  const ops: AlignOp[] = [];
  let i = n;
  let j = m;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && cost[i][j] === cost[i - 1][j - 1] + (ref[i - 1] === hyp[j - 1] ? 0 : 1)) {
      ops.push(
        ref[i - 1] === hyp[j - 1]
          ? { op: "eq", ref: ref[i - 1], hyp: hyp[j - 1] }
          : { op: "sub", ref: ref[i - 1], hyp: hyp[j - 1] },
      );
      i--;
      j--;
    } else if (i > 0 && cost[i][j] === cost[i - 1][j] + 1) {
      ops.push({ op: "del", ref: ref[i - 1] });
      i--;
    } else {
      ops.push({ op: "ins", hyp: hyp[j - 1] });
      j--;
    }
  }
  return ops.reverse();
}

export type WerResult = {
  wer: number;
  substitutions: number;
  deletions: number;
  insertions: number;
  refLength: number;
  ops: AlignOp[];
};

export function wordErrorRate(reference: string, hypothesis: string): WerResult {
  const ops = alignTokens(reference, hypothesis);
  const substitutions = ops.filter((o) => o.op === "sub").length;
  const deletions = ops.filter((o) => o.op === "del").length;
  const insertions = ops.filter((o) => o.op === "ins").length;
  const refLength = tokenize(reference).length;
  return {
    wer: refLength === 0 ? 0 : (substitutions + deletions + insertions) / refLength,
    substitutions,
    deletions,
    insertions,
    refLength,
    ops,
  };
}

/** True when two Persian strings are the same word-for-word after folding. */
export function equalsPersian(a: string, b: string): boolean {
  return normalizeForCompare(a) === normalizeForCompare(b);
}

/**
 * Renders Persian as left-to-right code point names for terminal debugging.
 * Terminals without Unicode bidi support (Ghostty as of 1.3.x, Kitty, most
 * xterm.js embeds) draw RTL text in visual reverse, which makes console output
 * unreadable and easy to misdiagnose as corrupted data. This shows the true
 * logical order regardless of the renderer.
 */
export function toCodepoints(input: string): string {
  return [...input]
    .map((ch) => {
      if (ch === ZWNJ) return "‹ZWNJ›";
      if (ch === " ") return "␣";
      return `${ch}(U+${ch.codePointAt(0)!.toString(16).toUpperCase().padStart(4, "0")})`;
    })
    .join(" ");
}
