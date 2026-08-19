/**
 * Persian homograph battery — sizing the short-vowel problem.
 *
 * Written Persian omits short vowels, so one consonant skeleton can spell
 * several different words. TTS has to infer the vowels from context. We know it
 * gets کرم wrong; what we do not know is how often this happens overall, and
 * that number decides the architecture:
 *
 *   - a handful wrong  → an exception list of recorded words is trivial
 *   - most wrong       → synthesized speech cannot carry vocabulary teaching,
 *                        and the product needs recorded audio for anything the
 *                        learner is meant to acquire precisely
 *
 * Each pair gives the engine a disambiguating context for both readings. The
 * `common` reading is what an engine would guess with no context; the
 * `less common` one is where context actually has to do work.
 *
 * NOTE FOR THE RATER: these sentences were written by a non-native speaker.
 * Flag any that are unnatural — that is useful output too, not a distraction.
 */

export type Reading = {
  id: string;
  /** How the target word should sound in this sentence. */
  translit: string;
  gloss: string;
  sentence: string;
  sentenceTranslit: string;
  english: string;
  frequency: "common" | "less common";
};

export type Homograph = {
  word: string;
  /** What makes the pair ambiguous, for the rater's context. */
  note: string;
  readings: [Reading, Reading];
};

export const HOMOGRAPHS: Homograph[] = [
  {
    word: "کرم",
    note: "The known failure — read as kerem in both contexts during the bakeoff.",
    readings: [
      {
        id: "kerem-cream",
        translit: "kerem",
        gloss: "cream",
        sentence: "کرم صورت خریدم",
        sentenceTranslit: "kerem-e surat kharidam",
        english: "I bought face cream",
        frequency: "common",
      },
      {
        id: "kerm-worm",
        translit: "kerm",
        gloss: "worm",
        sentence: "کرم توی باغ دیدم",
        sentenceTranslit: "kerm tu-ye bâgh didam",
        english: "I saw a worm in the garden",
        frequency: "less common",
      },
    ],
  },
  {
    word: "گل",
    note: "gol (flower) vs gel (mud) — both extremely common everyday words.",
    readings: [
      {
        id: "gol-flower",
        translit: "gol",
        gloss: "flower",
        sentence: "یه گل قرمز خریدم",
        sentenceTranslit: "ye gol-e qermez kharidam",
        english: "I bought a red flower",
        frequency: "common",
      },
      {
        id: "gel-mud",
        translit: "gel",
        gloss: "mud",
        sentence: "کفشام پر از گل شد",
        sentenceTranslit: "kafshâm por az gel shod",
        english: "My shoes got covered in mud",
        frequency: "less common",
      },
    ],
  },
  {
    word: "شکر",
    note: "shekar (sugar) vs shokr (gratitude).",
    readings: [
      {
        id: "shekar-sugar",
        translit: "shekar",
        gloss: "sugar",
        sentence: "تو چایی‌ت شکر می‌ریزی؟",
        sentenceTranslit: "tu chây-it shekar mi-rizi?",
        english: "Do you put sugar in your tea?",
        frequency: "common",
      },
      {
        id: "shokr-thanks",
        translit: "shokr",
        gloss: "thanks / gratitude",
        sentence: "خدا رو شکر، حالش بهتره",
        sentenceTranslit: "khodâ ro shokr, hâlesh behtare",
        english: "Thank God, he's feeling better",
        frequency: "less common",
      },
    ],
  },
  {
    word: "مهر",
    note: "mehr (affection, and the month) vs mohr (a stamp or seal).",
    readings: [
      {
        id: "mehr-month",
        translit: "mehr",
        gloss: "Mehr (month) / affection",
        sentence: "مهر ماه مدرسه شروع می‌شه",
        sentenceTranslit: "mehr mâh madrese shuru mi-she",
        english: "School starts in the month of Mehr",
        frequency: "common",
      },
      {
        id: "mohr-seal",
        translit: "mohr",
        gloss: "seal / stamp",
        sentence: "روی نامه مهر زدن",
        sentenceTranslit: "ru-ye nâme mohr zadan",
        english: "They stamped the letter",
        frequency: "less common",
      },
    ],
  },
  {
    word: "برنج",
    note: "berenj (rice) vs boronj (brass).",
    readings: [
      {
        id: "berenj-rice",
        translit: "berenj",
        gloss: "rice",
        sentence: "برای شام برنج پختم",
        sentenceTranslit: "barâye shâm berenj pokhtam",
        english: "I cooked rice for dinner",
        frequency: "common",
      },
      {
        id: "boronj-brass",
        translit: "boronj",
        gloss: "brass",
        sentence: "این مجسمه از برنج ساخته شده",
        sentenceTranslit: "in mojassame az boronj sâkhte shode",
        english: "This statue is made of brass",
        frequency: "less common",
      },
    ],
  },
  {
    word: "دم",
    note: "dam (moment, breath) vs dom (tail).",
    readings: [
      {
        id: "dam-moment",
        translit: "dam",
        gloss: "moment / breath",
        sentence: "یه دم صبر کن",
        sentenceTranslit: "ye dam sabr kon",
        english: "Wait a moment",
        frequency: "common",
      },
      {
        id: "dom-tail",
        translit: "dom",
        gloss: "tail",
        sentence: "دم گربه خیلی بلنده",
        sentenceTranslit: "dom-e gorbe kheyli bolande",
        english: "The cat's tail is very long",
        frequency: "less common",
      },
    ],
  },
  {
    word: "گرم",
    note: "garm (warm) vs geram (gram) — a unit that appears constantly in shopping talk.",
    readings: [
      {
        id: "garm-warm",
        translit: "garm",
        gloss: "warm",
        sentence: "امروز هوا خیلی گرمه",
        sentenceTranslit: "emruz havâ kheyli garme",
        english: "The weather is very warm today",
        frequency: "common",
      },
      {
        id: "geram-gram",
        translit: "geram",
        gloss: "gram",
        sentence: "صد گرم پنیر خریدم",
        sentenceTranslit: "sad geram panir kharidam",
        english: "I bought 100 grams of cheese",
        frequency: "less common",
      },
    ],
  },
  {
    word: "نه",
    note: "na (no) vs noh (nine) — both are beginner vocabulary.",
    readings: [
      {
        id: "na-no",
        translit: "na",
        gloss: "no",
        sentence: "نه، من نمی‌خوام",
        sentenceTranslit: "na, man nemi-khâm",
        english: "No, I don't want to",
        frequency: "common",
      },
      {
        id: "noh-nine",
        translit: "noh",
        gloss: "nine",
        sentence: "ساعت نه صبح میام",
        sentenceTranslit: "sâ'at-e noh-e sobh miâm",
        english: "I'll come at nine in the morning",
        frequency: "less common",
      },
    ],
  },
  {
    word: "کرد",
    note: "kard (did) vs Kord (a Kurd).",
    readings: [
      {
        id: "kard-did",
        translit: "kard",
        gloss: "did / made",
        sentence: "کارش رو تموم کرد",
        sentenceTranslit: "kâresh ro tamum kard",
        english: "He finished his work",
        frequency: "common",
      },
      {
        id: "kord-kurd",
        translit: "Kord",
        gloss: "a Kurd",
        sentence: "اون یه کرد اهل سنندجه",
        sentenceTranslit: "un ye Kord ahl-e Sanandaje",
        english: "He's a Kurd from Sanandaj",
        frequency: "less common",
      },
    ],
  },
  {
    word: "کند",
    note: "kond (blunt, slow) vs kand (dug).",
    readings: [
      {
        id: "kond-blunt",
        translit: "kond",
        gloss: "blunt / slow",
        sentence: "این چاقو خیلی کنده",
        sentenceTranslit: "in châqu kheyli konde",
        english: "This knife is very blunt",
        frequency: "common",
      },
      {
        id: "kand-dug",
        translit: "kand",
        gloss: "dug",
        sentence: "یه چاله توی باغ کند",
        sentenceTranslit: "ye châle tu-ye bâgh kand",
        english: "He dug a hole in the garden",
        frequency: "less common",
      },
    ],
  },
  {
    word: "پست",
    note: "post (mail) vs past (low, base).",
    readings: [
      {
        id: "post-mail",
        translit: "post",
        gloss: "mail / post",
        sentence: "نامه رو پست کردم",
        sentenceTranslit: "nâme ro post kardam",
        english: "I mailed the letter",
        frequency: "common",
      },
      {
        id: "past-low",
        translit: "past",
        gloss: "low / base",
        sentence: "این کار خیلی پسته",
        sentenceTranslit: "in kâr kheyli paste",
        english: "This behaviour is very base",
        frequency: "less common",
      },
    ],
  },
  {
    word: "شش",
    note: "shesh (six) vs shosh (lung).",
    readings: [
      {
        id: "shesh-six",
        translit: "shesh",
        gloss: "six",
        sentence: "شش تا سیب خریدم",
        sentenceTranslit: "shesh tâ sib kharidam",
        english: "I bought six apples",
        frequency: "common",
      },
      {
        id: "shosh-lung",
        translit: "shosh",
        gloss: "lung",
        sentence: "دکتر شش‌هام رو معاینه کرد",
        sentenceTranslit: "doktor shosh-hâm ro mo'âyene kard",
        english: "The doctor examined my lungs",
        frequency: "less common",
      },
    ],
  },
  {
    word: "تن",
    note: "tan (body) vs ton (metric tonne).",
    readings: [
      {
        id: "tan-body",
        translit: "tan",
        gloss: "body",
        sentence: "تنم درد می‌کنه",
        sentenceTranslit: "tanam dard mi-kone",
        english: "My body aches",
        frequency: "common",
      },
      {
        id: "ton-tonne",
        translit: "ton",
        gloss: "tonne",
        sentence: "این کامیون ده تن بار داره",
        sentenceTranslit: "in kâmyun dah ton bâr dâre",
        english: "This truck is carrying ten tonnes",
        frequency: "less common",
      },
    ],
  },
  {
    word: "مرد",
    note: "mard (man) vs mord (died) — a tense/meaning confusion a learner would notice.",
    readings: [
      {
        id: "mard-man",
        translit: "mard",
        gloss: "man",
        sentence: "اون مرد خیلی بلند قده",
        sentenceTranslit: "un mard kheyli boland-qadde",
        english: "That man is very tall",
        frequency: "common",
      },
      {
        id: "mord-died",
        translit: "mord",
        gloss: "died",
        sentence: "پدربزرگم پارسال مرد",
        sentenceTranslit: "pedarbozorgam pârsâl mord",
        english: "My grandfather died last year",
        frequency: "less common",
      },
    ],
  },
  {
    word: "کشت",
    note: "kosht (killed) vs kesht (cultivation).",
    readings: [
      {
        id: "kosht-killed",
        translit: "kosht",
        gloss: "killed",
        sentence: "گربه موش رو کشت",
        sentenceTranslit: "gorbe mush ro kosht",
        english: "The cat killed the mouse",
        frequency: "common",
      },
      {
        id: "kesht-planting",
        translit: "kesht",
        gloss: "cultivation / planting",
        sentence: "کشت گندم امسال زود شروع شد",
        sentenceTranslit: "kesht-e gandom emsâl zud shuru shod",
        english: "The wheat planting started early this year",
        frequency: "less common",
      },
    ],
  },
];

export const ALL_READINGS = HOMOGRAPHS.flatMap((h) =>
  h.readings.map((r) => ({ ...r, word: h.word })),
);
