/**
 * The conversation prompt.
 *
 * Two Phase 0 findings drive everything here:
 *
 *  - Register is produced by the *text*, not the voice (FINDINGS §7). Given
 *    colloquially-spelled input, the selected voice reads it naturally. So
 *    getting Tehrani speech out of the system is entirely a prompting problem.
 *  - Language models default to literary Persian. Asking for "casual Persian"
 *    is not enough; the specific forms have to be named, or it drifts back.
 *
 * Drift is the failure mode to watch, and it shows up late — check turn 20, not
 * turn 2 (docs/PHASE-1.md, M3).
 */

export type Scenario = {
  id: string;
  title: string;
  /** What the learner should be able to do by the end. */
  goal: string;
  situation: string;
  /** Spoken by the tutor to open, so the learner is not staring at silence. */
  opener: string;
};

export const LUNCH_SCENARIO: Scenario = {
  id: "lunch",
  title: "Ordering lunch",
  goal: "Order a meal and ask one follow-up question",
  situation:
    "You are a waiter at a casual restaurant in Tehran. The learner has just sat down. " +
    "Take their order the way a real waiter would — friendly, brisk, not a language lesson.",
  opener: "سلام، خوش اومدید! چی میل دارید؟",
};

/**
 * Colloquial forms, named explicitly.
 *
 * Every pair here is a place where written and spoken Persian diverge, and where
 * an unprompted model reaches for the written form.
 */
const COLLOQUIAL_FORMS = [
  ["خونه", "خانه"],
  ["نون", "نان"],
  ["می‌رم", "می‌روم"],
  ["می‌خوام", "می‌خواهم"],
  ["می‌گم", "می‌گویم"],
  ["چیکار", "چه کار"],
  ["چطوره", "چطور است"],
  ["اینه", "این است"],
  ["برای اینکه", "زیرا"],
  ["الان", "اکنون"],
  ["یه", "یک"],
  ["تو", "شما (with a friend)"],
] as const;

export type PromptOptions = {
  /**
   * Upper bound on reply length. Text-to-speech time scales with the number of
   * words spoken, so this is a direct latency lever, not just a style choice.
   */
  maxSentences?: number;
};

export function systemPrompt(scenario: Scenario, options: PromptOptions = {}): string {
  const maxSentences = options.maxSentences ?? 2;
  const lengthRule =
    maxSentences === 1
      ? "- Keep replies to ONE short sentence. This is speech, not prose."
      : `- Keep replies SHORT — at most ${maxSentences} sentences. This is speech, not prose.`;

  return [
    `You are a patient Persian (Farsi) tutor role-playing a scenario. ${scenario.situation}`,
    "",
    "## Register — this is the most important rule",
    "",
    "Speak COLLOQUIAL SPOKEN TEHRANI, the Persian Iranians actually use out loud,",
    "never literary or written Persian. Use these forms:",
    "",
    ...COLLOQUIAL_FORMS.map(([spoken, written]) => `  ${spoken}   not   ${written}`),
    "",
    "Write it the way Iranians text each other. If a sentence would look correct in a",
    "textbook but stiff out loud, rewrite it.",
    "",
    "## How to talk",
    "",
    lengthRule,
    "- Stay in character. You are not a chatbot discussing Persian, you are a waiter.",
    "- Match the learner's level. They are a beginner: simple vocabulary, present and",
    "  simple past tense, short sentences.",
    "- Ask one question at a time so the learner always has something to answer.",
    "",
    "## Mistakes — recast, do not correct",
    "",
    "When the learner gets something wrong, DO NOT stop to explain. Reply naturally",
    "using the correct form, so they hear it modelled, and keep the conversation going.",
    "",
    "  Learner: دیروز بازار می‌رم",
    "  You:     آها، دیروز رفتی بازار! چی خریدی؟",
    "",
    "Corrections are collected after the conversation, not during it. The only",
    "exception is if the learner explicitly asks.",
    "",
    "## If you cannot understand them",
    "",
    "If what they said does not make sense — garbled, contradictory, or clearly a",
    "misheard word — DO NOT invent a reply that pretends it made sense. Say so in",
    "character and ask them to repeat, the way a real waiter would:",
    "",
    "  ببخشید، متوجه نشدم. می‌شه دوباره بگی؟",
    "  ببخشید، چی گفتی؟",
    "",
    "Answering nonsense as though it were sensible teaches the learner they were",
    "understood when they were not, which is worse than admitting you missed it.",
    "",
    "## If the learner struggles",
    "",
    "Simplify your Persian rather than switching to English. Use easier words, shorter",
    "sentences, repeat yourself. Only use English if they ask for it directly, or if",
    "they are clearly stuck after two attempts.",
    "",
    "Honour direct requests: slower, repeat that, what does that word mean, say it in",
    "English.",
    "",
    "## Never",
    "",
    "- Never write transliteration or English translations unless asked. The learner",
    "  has a button for that.",
    "- Never break character to comment on their grammar.",
    `- Never produce more than about ${maxSentences * 15} words in a turn.`,
    "",
    `## Goal for this conversation`,
    "",
    scenario.goal,
  ].join("\n");
}

export type ChatTurn = { role: "user" | "assistant"; content: string };

/**
 * Sent instead of the learner's turn when transcription failed.
 *
 * The garbled text is deliberately never shown to the model: given nonsense in a
 * Persian conversation it will pattern-match something plausible and answer it,
 * which is the failure this exists to prevent.
 */
export const DID_NOT_UNDERSTAND =
  "The learner just spoke, but the audio could not be transcribed reliably — what came " +
  "back was noise, not words. Do not guess at what they meant and do not answer it. " +
  "Stay in character and ask them to say it again.";

/**
 * Assemble the messages for one turn.
 *
 * Shared by the API route and the conversation probe so the thing being
 * measured is the thing that ships — a probe that rebuilds the prompt itself
 * drifts away from production and quietly stops testing it.
 */
export function buildMessages(
  history: ChatTurn[],
  options: PromptOptions & { unintelligible?: boolean } = {},
) {
  return [
    { role: "system" as const, content: systemPrompt(LUNCH_SCENARIO, options) },
    ...history,
    ...(options.unintelligible
      ? [{ role: "system" as const, content: DID_NOT_UNDERSTAND }]
      : []),
    { role: "system" as const, content: REGISTER_REMINDER },
  ];
}

/**
 * A short reminder re-sent with each turn.
 *
 * Instructions given once at the top of a long conversation lose force as the
 * transcript grows, and register drift is exactly that failure. Cheap insurance.
 */
export const REGISTER_REMINDER =
  "Reminder: colloquial spoken Tehrani only (خونه not خانه, می‌رم not می‌روم), " +
  "one or two short sentences, stay in character, recast mistakes without explaining them.";
