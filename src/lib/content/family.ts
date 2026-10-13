import { P, W } from "./common";
import type { ThemeSeed } from "./types";

// A noun with "my" and then "is" on it: مامانمه, "is my mom". Both endings are
// patterns the learner has met by the time one of these appears.
const myIs = (lex: string, fa: string, voc: string, translit: string) => ({ lex, fa: `${fa}مه`, voc: `${voc}َمِه`, translit: `${translit}ame` });
const my = (lex: string, fa: string, voc: string, translit: string) => ({ lex, fa: `${fa}م`, voc: `${voc}َم`, translit: `${translit}am` });

/**
 * Who is in the family, what they are called and where they are. The words
 * are the ones used at home (مامان، بابا، داداش) rather than the dictionary's
 * مادر، پدر، برادر. Numbers come with the counting word تا attached, as one
 * piece, because that is the only way this theme uses them.
 *
 * Not yet reviewed by a native speaker.
 */
export const FAMILY: ThemeSeed = {
  id: "family",
  title: "Family",
  titleFa: "خانواده",
  description: "Parents, brothers and sisters, children: saying who you have, who someone is, and what they are called.",
  position: 3,
  lexemes: [
    { id: "dadash", fa: "داداش", voc: "داداش", translit: "dâdâsh", gloss: "brother", literary: "برادر" },
    W.daram,
    W.ye,
    { id: "khahar", fa: "خواهر", voc: "خواهَر", translit: "khâhar", gloss: "sister" },
    W.o,
    W.man,
    W.dari,
    W.are,
    W.na,
    W.to,
    {
      id: "do-ta",
      fa: "دو تا",
      voc: "دُو تا",
      translit: "do tâ",
      gloss: "two (of something)",
      note: "When you count things, the number is followed by تا: دو تا داداش, two brothers. The noun stays singular.",
    },
    { id: "se-ta", fa: "سه تا", voc: "سِه تا", translit: "se tâ", gloss: "three (of something)" },
    { id: "chand-ta", fa: "چند تا", voc: "چَند تا", translit: "chand tâ", gloss: "how many" },
    { id: "maman", fa: "مامان", voc: "مامان", translit: "mâmân", gloss: "mom", literary: "مادر" },
    { id: "baba", fa: "بابا", voc: "بابا", translit: "bâbâ", gloss: "dad", literary: "پدر" },
    { id: "mehrabun", fa: "مهربون", voc: "مِهرَبون", translit: "mehrabun", gloss: "kind", literary: "مهربان" },
    W.kheyli,
    W.in,
    { id: "kiye", fa: "کیه", voc: "کیِه", translit: "kiye", gloss: "who is it?", literary: "کیست" },
    {
      id: "un",
      fa: "اون",
      voc: "اون",
      translit: "un",
      gloss: "that / he / she",
      literary: "آن / او",
      subjectPronoun: "3sg",
      note: "One word for \"that\", \"he\" and \"she\". Persian does not tell he from she.",
    },
    W.esm,
    W.maryam,
    W.amir,
    W.chiye,
    {
      id: "dare",
      fa: "داره",
      voc: "دارِه",
      translit: "dâre",
      gloss: "he has / she has",
      lemma: "داشتن",
      literary: "دارد",
      verbPerson: "3sg",
    },
    { id: "bache", fa: "بچه", voc: "بَچِه", translit: "bache", gloss: "child / kid" },
    { id: "dokhtar", fa: "دختر", voc: "دُختَر", translit: "dokhtar", gloss: "daughter / girl" },
    { id: "pesar", fa: "پسر", voc: "پِسَر", translit: "pesar", gloss: "son / boy" },
    W.darim,
    { id: "bozorg", fa: "بزرگ", voc: "بُزُرگ", translit: "bozorg", gloss: "big / grown-up" },
    { id: "kuchik", fa: "کوچیک", voc: "کوچیک", translit: "kuchik", gloss: "small / little", literary: "کوچک" },
    { id: "shohar", fa: "شوهر", voc: "شُوهَر", translit: "shohar", gloss: "husband" },
    { id: "zan", fa: "زن", voc: "زَن", translit: "zan", gloss: "wife / woman" },
    { id: "dust", fa: "دوست", voc: "دوست", translit: "dust", gloss: "friend" },
    { id: "madarbozorg", fa: "مادربزرگ", voc: "مادَربُزُرگ", translit: "mâdarbozorg", gloss: "grandmother" },
    { id: "pedarbozorg", fa: "پدربزرگ", voc: "پِدَربُزُرگ", translit: "pedarbozorg", gloss: "grandfather" },
    W.khune,
    W.koja,
    W.inja,
  ],
  patterns: [
    P.question,
    P.negation,
    P["possessive-my"],
    P.copula,
    P["possessive-your"],
    P.ezafe,
    P["possessive-his"],
    P["copula-vowel"],
  ],
  sentences: [
    { english: "Brother.", tokens: ["dadash"] },
    { english: "I have a brother.", tokens: ["dadash", "daram"], note: "The verb comes last." },
    { english: "I have one brother.", tokens: ["ye", "dadash", "daram"] },
    { english: "I have one sister.", tokens: ["ye", "khahar", "daram"] },
    { english: "I have one brother and one sister.", tokens: ["ye", "dadash", "o", "ye", "khahar", "daram"] },
    { english: "I have one sister.", tokens: ["man", "ye", "khahar", "daram"] },
    { english: "You have a sister.", tokens: ["khahar", "dari"] },
    { english: "Do you have a sister?", tokens: ["khahar", "dari"], end: "؟", patterns: ["question"] },
    { english: "Yeah, I have one sister.", tokens: [{ lex: "are", after: "،" }, "ye", "khahar", "daram"] },
    {
      english: "I don't have a brother.",
      tokens: ["dadash", { lex: "daram", fa: "ندارم", voc: "نَدارَم", translit: "nadâram" }],
      patterns: ["negation"],
    },
    {
      english: "No, I don't have a sister.",
      tokens: [{ lex: "na", after: "،" }, "khahar", { lex: "daram", fa: "ندارم", voc: "نَدارَم", translit: "nadâram" }],
      patterns: ["negation"],
    },
    { english: "Do you have a brother?", tokens: ["to", "dadash", "dari"], end: "؟", patterns: ["question"] },
    { english: "I have two brothers.", tokens: ["do-ta", "dadash", "daram"] },
    { english: "I have three sisters.", tokens: ["se-ta", "khahar", "daram"] },
    { english: "How many brothers do you have?", tokens: ["chand-ta", "dadash", "dari"], end: "؟" },
    { english: "My brother.", tokens: [my("dadash", "داداش", "داداش", "dâdâsh")], patterns: ["possessive-my"] },
    { english: "My mom.", tokens: [my("maman", "مامان", "مامان", "mâmân")], patterns: ["possessive-my"] },
    {
      english: "My dad.",
      tokens: [{ lex: "baba", fa: "بابام", voc: "بابام", translit: "bâbâm" }],
      patterns: ["possessive-my"],
      note: "After a vowel the ending is just -m.",
    },
    { english: "Kind.", tokens: ["mehrabun"] },
    {
      english: "My mom is kind.",
      tokens: [my("maman", "مامان", "مامان", "mâmân"), { lex: "mehrabun", fa: "مهربونه", voc: "مِهرَبونِه", translit: "mehrabune" }],
      patterns: ["possessive-my", "copula"],
    },
    {
      english: "My dad is very kind.",
      tokens: [
        { lex: "baba", fa: "بابام", voc: "بابام", translit: "bâbâm" },
        "kheyli",
        { lex: "mehrabun", fa: "مهربونه", voc: "مِهرَبونِه", translit: "mehrabune" },
      ],
      patterns: ["possessive-my", "copula"],
    },
    {
      english: "This is my brother.",
      tokens: ["in", myIs("dadash", "داداش", "داداش", "dâdâsh")],
      patterns: ["possessive-my", "copula"],
      note: "Two endings on one word: داداش + -am (my) + -e (is).",
    },
    { english: "Who is this?", tokens: ["in", "kiye"], end: "؟" },
    {
      english: "That's my sister.",
      tokens: ["un", myIs("khahar", "خواهر", "خواهَر", "khâhar")],
      patterns: ["possessive-my", "copula"],
    },
    { english: "Who is that?", tokens: ["un", "kiye"], end: "؟" },
    {
      english: "Is this your brother?",
      tokens: ["in", { lex: "dadash", fa: "داداشته", voc: "داداشِتِه", translit: "dâdâshete" }],
      end: "؟",
      patterns: ["possessive-your", "copula", "question"],
    },
    {
      english: "Your name.",
      tokens: [{ lex: "esm", fa: "اسمت", voc: "اِسمِت", translit: "esmet" }],
      patterns: ["possessive-your"],
    },
    {
      english: "Is your name Maryam?",
      tokens: [
        { lex: "esm", fa: "اسمت", voc: "اِسمِت", translit: "esmet" },
        { lex: "maryam", fa: "مریمه", voc: "مَریَمِه", translit: "maryame" },
      ],
      end: "؟",
      patterns: ["possessive-your", "copula", "question"],
    },
    {
      english: "My sister's name is Maryam.",
      tokens: [
        { lex: "esm", voc: "اِسمِ", translit: "esm-e" },
        my("khahar", "خواهر", "خواهَر", "khâhar"),
        { lex: "maryam", fa: "مریمه", voc: "مَریَمِه", translit: "maryame" },
      ],
      patterns: ["ezafe", "possessive-my", "copula"],
    },
    {
      english: "My brother's name is Amir.",
      tokens: [
        { lex: "esm", voc: "اِسمِ", translit: "esm-e" },
        my("dadash", "داداش", "داداش", "dâdâsh"),
        { lex: "amir", fa: "امیره", voc: "اَمیرِه", translit: "amire" },
      ],
      patterns: ["ezafe", "possessive-my", "copula"],
    },
    {
      english: "His name is Amir.",
      tokens: [
        { lex: "esm", fa: "اسمش", voc: "اِسمِش", translit: "esmesh" },
        { lex: "amir", fa: "امیره", voc: "اَمیرِه", translit: "amire" },
      ],
      patterns: ["possessive-his", "copula"],
    },
    {
      english: "What's her name?",
      tokens: [{ lex: "esm", fa: "اسمش", voc: "اِسمِش", translit: "esmesh" }, "chiye"],
      end: "؟",
      patterns: ["possessive-his"],
      note: "The same words ask \"what's his name?\".",
    },
    { english: "Maryam has one brother.", tokens: ["maryam", "ye", "dadash", "dare"] },
    { english: "Maryam has two kids.", tokens: ["maryam", "do-ta", "bache", "dare"] },
    { english: "I have one daughter.", tokens: ["ye", "dokhtar", "daram"] },
    { english: "I have one son.", tokens: ["ye", "pesar", "daram"] },
    { english: "We have one daughter and one son.", tokens: ["ye", "dokhtar", "o", "ye", "pesar", "darim"] },
    {
      english: "My son is grown up.",
      tokens: [my("pesar", "پسر", "پِسَر", "pesar"), { lex: "bozorg", fa: "بزرگه", voc: "بُزُرگِه", translit: "bozorge" }],
      patterns: ["possessive-my", "copula"],
    },
    {
      english: "My daughter is little.",
      tokens: [my("dokhtar", "دختر", "دُختَر", "dokhtar"), { lex: "kuchik", fa: "کوچیکه", voc: "کوچیکِه", translit: "kuchike" }],
      patterns: ["possessive-my", "copula"],
    },
    {
      english: "This is my husband.",
      tokens: ["in", myIs("shohar", "شوهر", "شُوهَر", "shohar")],
      patterns: ["possessive-my", "copula"],
    },
    {
      english: "My wife's name is Maryam.",
      tokens: [
        { lex: "esm", voc: "اِسمِ", translit: "esm-e" },
        my("zan", "زن", "زَن", "zan"),
        { lex: "maryam", fa: "مریمه", voc: "مَریَمِه", translit: "maryame" },
      ],
      patterns: ["ezafe", "possessive-my", "copula"],
    },
    {
      english: "Amir is my friend.",
      tokens: ["amir", myIs("dust", "دوست", "دوست", "dust")],
      patterns: ["possessive-my", "copula"],
    },
    {
      english: "My grandmother is very kind.",
      tokens: [
        my("madarbozorg", "مادربزرگ", "مادَربُزُرگ", "mâdarbozorg"),
        "kheyli",
        { lex: "mehrabun", fa: "مهربونه", voc: "مِهرَبونِه", translit: "mehrabune" },
      ],
      patterns: ["possessive-my", "copula"],
    },
    {
      english: "This is my grandfather.",
      tokens: ["in", myIs("pedarbozorg", "پدربزرگ", "پِدَربُزُرگ", "pedarbozorg")],
      patterns: ["possessive-my", "copula"],
    },
    { english: "Home.", tokens: ["khune"] },
    {
      english: "My dad is at home.",
      tokens: [
        { lex: "baba", fa: "بابام", voc: "بابام", translit: "bâbâm" },
        { lex: "khune", fa: "خونه‌ست", voc: "خونه‌ست", translit: "khunast" },
      ],
      patterns: ["possessive-my", "copula-vowel"],
      note: "No word for \"at\": \"is home\" is enough.",
    },
    {
      english: "Where is your mom?",
      tokens: [
        { lex: "maman", fa: "مامانت", voc: "مامانِت", translit: "mâmânet" },
        { lex: "koja", fa: "کجاست", voc: "کُجاست", translit: "kojâst" },
      ],
      end: "؟",
      patterns: ["possessive-your", "copula-vowel"],
    },
    {
      english: "My mom is here.",
      tokens: [my("maman", "مامان", "مامان", "mâmân"), { lex: "inja", fa: "اینجاست", voc: "اینجاست", translit: "injâst" }],
      patterns: ["possessive-my", "copula-vowel"],
    },
  ],
};
