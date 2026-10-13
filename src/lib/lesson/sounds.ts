/**
 * Wrong answers that are wrong in a telling way, made from a word's
 * transliteration: other ways its letters could be read, and other words that
 * sound like it.
 */

// The short vowels, which Persian does not write: the reader supplies them.
// â, i and u are written (ا, ی, و) and are not in doubt.
const SHORT = ["a", "e", "o"];

/**
 * Other readings the same letters would allow: the transliteration with its
 * short vowels changed. کرم is kerm, and could as well be karm or korm.
 *
 * A vowel at the end of a word is written (خونه, khune), so it is left alone
 * unless it is the only one there is to change. Returns nothing for a word
 * with no short vowel, whose reading is not in doubt.
 */
export function otherReadings(translit: string): string[] {
  const at = [...translit].flatMap((char, i) => (SHORT.includes(char) ? [i] : []));
  const inside = at.filter((i) => i < translit.length - 1);
  const places = inside.length > 0 ? inside : at;
  const readings = new Set<string>();
  const swap = (word: string, i: number, vowel: string) => word.slice(0, i) + vowel + word.slice(i + 1);
  for (const i of places) {
    for (const vowel of SHORT) {
      if (vowel === translit[i]) continue;
      readings.add(swap(translit, i, vowel));
      // Two vowels changed at once, for words with more than one.
      for (const j of places) {
        if (j <= i) continue;
        for (const second of SHORT) if (second !== translit[j]) readings.add(swap(swap(translit, i, vowel), j, second));
      }
    }
  }
  readings.delete(translit);
  return [...readings];
}

/** How many letters must change to turn one transliteration into another. */
export function soundDistance(a: string, b: string): number {
  let row = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const next = [i];
    for (let j = 1; j <= b.length; j++) {
      next[j] = Math.min(row[j] + 1, next[j - 1] + 1, row[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    row = next;
  }
  return row[b.length];
}
