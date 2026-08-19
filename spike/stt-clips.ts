/**
 * Phase 0B clip set — the STT error-preservation probe.
 *
 * Half these clips are correct Persian and measure baseline word error rate on
 * accented, non-native speech. The other half contain deliberate, known learner
 * mistakes, and measure something the original brief never asked about:
 * whether ASR *preserves* the mistake or silently repairs it.
 *
 * This matters more than raw accuracy. ASR models are trained to emit fluent,
 * grammatical text. If the transcript of a learner saying the wrong tense comes
 * back in the right tense, then every downstream correction, mistake record,
 * and grammar-mastery number is built on evidence that no longer exists.
 */

export type Clip = {
  id: string;
  kind: "correct" | "deliberate-error";
  /** Exactly what the speaker is asked to say — the ground truth for scoring. */
  saying: string;
  translit: string;
  english: string;
  /** For error clips: the grammatical form ASR might "helpfully" substitute. */
  repairedForm?: string;
  /** For error clips: what the planted mistake is. */
  errorType?: string;
  /**
   * True when the mistake is audible but leaves no trace in the written form,
   * so no transcript-based system can ever detect it. Not a flaw in the probe —
   * it bounds what the whole transcript-diffing architecture can do.
   */
  invisibleInText?: boolean;
};

export const CLIPS: Clip[] = [
  // ---- Baseline: correct Persian, measures WER on accented speech ----
  {
    id: "ok-greeting",
    kind: "correct",
    saying: "سلام، حال شما چطوره؟",
    translit: "salâm, hâl-e shomâ chetore?",
    english: "Hello, how are you?",
  },
  {
    id: "ok-children",
    kind: "correct",
    saying: "من دو تا بچه دارم",
    translit: "man do tâ bache dâram",
    english: "I have two children",
  },
  {
    id: "ok-market",
    kind: "correct",
    saying: "دیروز رفتم بازار و کلی خرید کردم",
    translit: "diruz raftam bâzâr va kolli kharid kardam",
    english: "Yesterday I went to the market and bought a lot",
  },
  {
    id: "ok-slower",
    kind: "correct",
    saying: "می‌شه لطفاً آروم‌تر صحبت کنید؟",
    translit: "mi-she lotfan ârumtar sohbat konid?",
    english: "Could you please speak more slowly?",
  },
  {
    id: "ok-food",
    kind: "correct",
    saying: "غذا خیلی خوشمزه بود",
    translit: "ghazâ kheyli khoshmaze bud",
    english: "The food was very tasty",
  },

  // ---- Planted learner errors: does the transcript keep them? ----
  {
    id: "err-tense",
    kind: "deliberate-error",
    saying: "من دیروز بازار می‌رم",
    translit: "man diruz bâzâr mi-ram",
    english: "(intended: I went to the market yesterday)",
    repairedForm: "من دیروز بازار رفتم",
    errorType: "Present tense used with a past-time adverb (دیروز)",
  },
  {
    id: "err-ra",
    kind: "deliberate-error",
    saying: "کتاب خوندم",
    translit: "ketâb khundam",
    english: "(intended: I read the book)",
    repairedForm: "کتاب را خوندم",
    errorType: "Definite object marker را omitted",
  },
  {
    id: "err-wordorder",
    kind: "deliberate-error",
    saying: "من رفتم به خونه دیروز",
    translit: "man raftam be khune diruz",
    english: "(intended: Yesterday I went home)",
    repairedForm: "من دیروز به خونه رفتم",
    errorType: "English-style word order; time adverb stranded at the end",
  },
  {
    id: "err-copula",
    kind: "deliberate-error",
    saying: "ماشین من قرمز",
    translit: "mâshin-e man qermez",
    english: "(intended: My car is red)",
    repairedForm: "ماشین من قرمزه",
    errorType: "Copula ـه dropped",
  },
  {
    id: "err-ezafe",
    kind: "deliberate-error",
    saying: "کتاب من روی میز هست",
    translit: "ketâb man ru-ye miz hast",
    english: "(intended: My book is on the table)",
    repairedForm: "کتاب من روی میز هست",
    errorType: "Ezafe missing on کتابِ من — audible as a dropped -e, invisible in script",
    invisibleInText: true,
  },
];

export const CORRECT_CLIPS = CLIPS.filter((c) => c.kind === "correct");
export const ERROR_CLIPS = CLIPS.filter((c) => c.kind === "deliberate-error");
