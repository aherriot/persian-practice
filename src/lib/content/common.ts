import { GRAMMAR_SPINE } from "@/lib/lesson/forms";
import type { LexemeSeed, PatternSeed } from "./types";

/**
 * Words and grammar that more than one theme teaches, written once.
 *
 * Every theme is a ladder of its own: it lists what it uses and introduces
 * each item itself, so a learner can start with any of them. A word has one id
 * wherever it appears, so one already met in another theme is not taught
 * again; the lesson planner passes over a ladder sentence with nothing new in it.
 *
 * Everything is spoken Tehrani; `literary` records the book form where the two
 * differ. Not yet reviewed by a native speaker.
 */
export const W = {
  // --- People ---
  man: { id: "man", fa: "من", voc: "مَن", translit: "man", gloss: "I", subjectPronoun: "1sg" },
  to: { id: "to", fa: "تو", voc: "تُو", translit: "to", gloss: "you (informal)", subjectPronoun: "2sg" },
  ma: { id: "ma", fa: "ما", voc: "ما", translit: "mâ", gloss: "we", subjectPronoun: "1pl" },

  // --- Small words ---
  o: {
    id: "o",
    fa: "و",
    voc: "و",
    translit: "o",
    gloss: "and",
    note: "Written و and read \"va\" in formal Persian; in speech it is a quick \"o\" attached to the word before it.",
  },
  are: { id: "are", fa: "آره", voc: "آرِه", translit: "âre", gloss: "yeah", literary: "بله" },
  na: { id: "na", fa: "نه", voc: "نَه", translit: "na", gloss: "no" },
  ham: { id: "ham", fa: "هم", voc: "هَم", translit: "ham", gloss: "also / too" },
  in: { id: "in", fa: "این", voc: "این", translit: "in", gloss: "this" },
  kheyli: { id: "kheyli", fa: "خیلی", voc: "خِیلی", translit: "kheyli", gloss: "very" },
  ye: { id: "ye", fa: "یه", voc: "یِه", translit: "ye", gloss: "a / one", literary: "یک" },

  // --- Courtesies ---
  salam: { id: "salam", fa: "سلام", voc: "سَلام", translit: "salâm", gloss: "hello" },
  mamnun: { id: "mamnun", fa: "ممنون", voc: "مَمنون", translit: "mamnun", gloss: "thanks" },
  bebakhshid: { id: "bebakhshid", fa: "ببخشید", voc: "بِبَخشید", translit: "bebakhshid", gloss: "excuse me / sorry" },
  agha: {
    id: "agha",
    fa: "آقا",
    voc: "آقا",
    translit: "âghâ",
    gloss: "sir",
    note: "How you address a man you do not know: a shopkeeper, a driver, a stranger in the street.",
  },

  // --- Names ---
  // Both end in a consonant, so every ending in the course attaches to them the regular way.
  esm: { id: "esm", fa: "اسم", voc: "اِسم", translit: "esm", gloss: "name" },
  maryam: { id: "maryam", fa: "مریم", voc: "مَریَم", translit: "maryam", gloss: "Maryam (a woman's name)" },
  amir: { id: "amir", fa: "امیر", voc: "اَمیر", translit: "amir", gloss: "Amir (a man's name)" },
  chiye: { id: "chiye", fa: "چیه", voc: "چیِه", translit: "chiye", gloss: "what is it?", literary: "چیست" },

  // --- Verbs ---
  daram: { id: "daram", fa: "دارم", voc: "دارَم", translit: "dâram", gloss: "I have", lemma: "داشتن", verbPerson: "1sg" },
  dari: { id: "dari", fa: "داری", voc: "داری", translit: "dâri", gloss: "you have", lemma: "داشتن", verbPerson: "2sg" },
  darim: { id: "darim", fa: "داریم", voc: "داریم", translit: "dârim", gloss: "we have", lemma: "داشتن", verbPerson: "1pl" },
  mikham: {
    id: "mikham",
    fa: "می‌خوام",
    voc: "می‌خوام",
    translit: "mikhâm",
    gloss: "I want",
    lemma: "خواستن",
    literary: "می‌خواهم",
    verbPerson: "1sg",
  },
  chande: { id: "chande", fa: "چنده", voc: "چَندِه", translit: "chande", gloss: "how much is it?", literary: "چند است" },

  // --- Things ---
  nun: { id: "nun", fa: "نون", voc: "نون", translit: "nun", gloss: "bread", literary: "نان" },
} satisfies Record<string, LexemeSeed>;

export const P = {
  question: {
    id: "question",
    title: "Yes/no questions",
    summary:
      "A statement becomes a yes/no question just by raising your voice at the end. The words and their order do not change: هویج داری (you have carrots) → هویج داری؟ (do you have carrots?).",
  },
  negation: {
    id: "negation",
    title: "Saying \"not\"",
    summary:
      "Put نَـ (na-) on the front of the verb: دارم (I have) → ندارم (I don't have), داریم → نداریم.",
  },
  copula: {
    id: "copula",
    title: "\"Is\" as an ending",
    summary:
      "Spoken Persian says \"is\" with a short ـه (-e) on the end of the last word: سیب (apple) → این سیبه (this is an apple). Book Persian writes است instead.",
  },
  ezafe: {
    id: "ezafe",
    title: "Linking words (ezâfe)",
    summary:
      "To attach a describing word or an owner to a noun, add a short -e sound to the noun: سیبِ من (sib-e man, my apple), نونِ تازه (nun-e tâze, fresh bread). It is spoken but almost never written.",
  },
  // The possessive endings are the grammar spine's own patterns (forms.ts),
  // taught here by hand because names and family cannot do without them. Once
  // a learner has met them on a curated ladder the expansion author uses them
  // rather than teaching them again.
  "possessive-my": spine("possessive-my"),
  "possessive-your": spine("possessive-your"),
} satisfies Record<string, PatternSeed>;

function spine(id: string): PatternSeed {
  const entry = GRAMMAR_SPINE.find((p) => p.id === id);
  if (!entry) throw new Error(`grammar spine has no pattern "${id}"`);
  return { id: entry.id, title: entry.title, summary: entry.summary };
}
