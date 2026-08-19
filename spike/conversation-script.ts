/**
 * A scripted learner, for measuring whether the tutor actually teaches.
 *
 * Register drift is a late failure — the prompt holds for a few turns and slides
 * back toward literary Persian as the transcript grows. Testing that by speaking
 * twenty turns into a microphone is slow and unrepeatable, so the learner side
 * is scripted. Text only: this measures the conversation, not the audio.
 *
 * Turns are ordered to build a plausible restaurant conversation while planting
 * each thing worth testing at a known position, so a failure can be traced to
 * both a behaviour and a point in the conversation.
 */

export type Probe =
  /** Ordinary conversation — the baseline the others are compared against. */
  | "normal"
  /** Contains a grammar mistake. The tutor should recast, never explain. */
  | "planted-error"
  /** Learner drops into English. Should be handled without abandoning Persian. */
  | "code-switch"
  /** Explicit request the brief promises to honour. */
  | "request";

export type ScriptedTurn = {
  index: number;
  probe: Probe;
  says: string;
  translit: string;
  english: string;
  /** What a correct reply does. Shown to the rater; not sent to the model. */
  expect: string;
};

export const SCRIPT: ScriptedTurn[] = [
  {
    index: 1,
    probe: "normal",
    says: "سلام",
    translit: "salâm",
    english: "Hello",
    expect: "Greets back in colloquial Persian and asks what they want.",
  },
  {
    index: 2,
    probe: "normal",
    says: "خوبم ممنون، یه میز برای یه نفر می‌خوام",
    translit: "khubam mamnun, ye miz barâye ye nafar mi-khâm",
    english: "I'm well thanks, I'd like a table for one",
    expect: "Seats them, stays brief.",
  },
  {
    index: 3,
    probe: "normal",
    says: "منو دارید؟",
    translit: "menu dârid?",
    english: "Do you have a menu?",
    expect: "Offers the menu or names a dish or two.",
  },
  {
    index: 4,
    probe: "code-switch",
    says: "What do you recommend?",
    translit: "(English)",
    english: "What do you recommend?",
    expect:
      "Understands, but answers in simple Persian rather than switching to English. Should not scold.",
  },
  {
    index: 5,
    probe: "normal",
    says: "آها باشه، کباب می‌خوام",
    translit: "âhâ bâshe, kabâb mi-khâm",
    english: "Ah okay, I'll have kebab",
    expect: "Takes the order.",
  },
  {
    index: 6,
    probe: "planted-error",
    says: "من دیروز اینجا می‌رم",
    translit: "man diruz injâ mi-ram",
    english: "(intended: I came here yesterday) — present tense with a past adverb",
    expect:
      "Recasts to past tense naturally (دیروز اومدی اینجا) and keeps going. Must NOT explain the mistake.",
  },
  {
    index: 7,
    probe: "request",
    says: "می‌شه آروم‌تر صحبت کنید؟",
    translit: "mi-she ârumtar sohbat konid?",
    english: "Could you speak more slowly?",
    expect: "Acknowledges and simplifies, still in Persian.",
  },
  {
    index: 8,
    probe: "normal",
    says: "یه نوشیدنی هم می‌خوام",
    translit: "ye nushidani ham mi-khâm",
    english: "I'd also like a drink",
    expect: "Offers options.",
  },
  {
    index: 9,
    probe: "planted-error",
    says: "کتاب خوندم",
    translit: "ketâb khundam",
    english: "(intended: I read the book) — object marker را omitted",
    expect: "Recasts with را, or moves on. No grammar lecture.",
  },
  {
    index: 10,
    probe: "request",
    says: "ببخشید، یعنی چی؟",
    translit: "bebakhshid, ya'ni chi?",
    english: "Sorry, what does that mean?",
    expect: "Explains in simpler Persian first, not immediately in English.",
  },
  {
    index: 11,
    probe: "normal",
    says: "غذا خیلی خوشمزه بود",
    translit: "ghazâ kheyli khoshmaze bud",
    english: "The food was very tasty",
    expect: "Responds warmly, stays in character.",
  },
  {
    index: 12,
    probe: "normal",
    says: "من دو تا بچه دارم",
    translit: "man do tâ bache dâram",
    english: "I have two children",
    expect: "Engages with the personal detail — this is the memory hook the brief cares about.",
  },
  {
    index: 13,
    probe: "code-switch",
    says: "How do you say delicious in Farsi?",
    translit: "(English)",
    english: "How do you say delicious in Farsi?",
    expect: "A direct meta-question — English is reasonable here, but should be brief.",
  },
  {
    index: 14,
    probe: "planted-error",
    says: "ماشین من قرمز",
    translit: "mâshin-e man qermez",
    english: "(intended: My car is red) — copula dropped",
    expect: "Recasts with the copula (قرمزه). No correction talk.",
  },
  {
    index: 15,
    probe: "normal",
    says: "چقدر می‌شه؟",
    translit: "cheqadr mi-she?",
    english: "How much is it?",
    expect: "Gives a price. Watch how numerals are written.",
  },
  {
    index: 16,
    probe: "planted-error",
    says: "من رفتم به خونه دیروز",
    translit: "man raftam be khune diruz",
    english: "(intended: Yesterday I went home) — English-style word order",
    expect: "Recasts with natural Persian order.",
  },
  {
    index: 17,
    probe: "normal",
    says: "یه چیز شیرین دارید؟",
    translit: "ye chiz-e shirin dârid?",
    english: "Do you have something sweet?",
    expect: "Offers dessert.",
  },
  {
    index: 18,
    probe: "request",
    says: "Can you say that in English?",
    translit: "(English)",
    english: "Can you say that in English?",
    expect: "An explicit English request — the brief says honour it. Should comply, briefly.",
  },
  {
    index: 19,
    probe: "normal",
    says: "ممنون، خیلی خوب بود",
    translit: "mamnun, kheyli khub bud",
    english: "Thanks, it was very good",
    expect: "Warm close, still colloquial. This is turn 19 — drift shows here.",
  },
  {
    index: 20,
    probe: "normal",
    says: "خداحافظ",
    translit: "khodâhâfez",
    english: "Goodbye",
    expect: "Says goodbye colloquially (خداحافظ / فعلاً), still in character.",
  },
];
