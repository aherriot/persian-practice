/**
 * Probe sentences for the Phase 0A TTS bakeoff.
 *
 * These are not a random sample of Persian. Each one targets a specific way
 * Persian TTS is known to fail, so a listener can tell *why* a voice is bad
 * rather than only that it is. Register throughout is colloquial spoken
 * Tehrani — the variety the tutor will actually speak — not literary Persian.
 */

export type Probe = {
  id: string;
  /** What this sentence is testing, shown to the rater. */
  probe: string;
  persian: string;
  translit: string;
  english: string;
  /** What a failure sounds like, to prime the rater on what to listen for. */
  listenFor: string;
};

export const PROBES: Probe[] = [
  {
    id: "colloq-contraction",
    probe: "Colloquial contraction",
    persian: "می‌رم خونه، تو چیکار می‌کنی؟",
    translit: "mi-ram khune, to chikâr mi-koni?",
    english: "I'm going home, what are you doing?",
    listenFor:
      "Should say khune, not khâne. A voice that reads the literary form is reading a spelling that isn't there.",
  },
  {
    id: "colloq-ye",
    probe: "Colloquial یه + politeness",
    persian: "یه چایی می‌خوام لطفاً",
    translit: "ye chây-i mi-khâm lotfan",
    english: "I'd like a tea please",
    listenFor: "یه should be ye, not yek. mi-khâm, not mi-khâham.",
  },
  {
    id: "phoneme-qaf",
    probe: "ق phoneme + enclitic چنده",
    persian: "قیمتش چنده؟",
    translit: "qeymatesh chande?",
    english: "How much does it cost?",
    listenFor:
      "ق is the classic non-native failure. Should be a uvular /ɣ~q/, not an English hard k or g.",
  },
  {
    id: "past-tense",
    probe: "Past tense, natural flow",
    persian: "دیروز رفتم بازار و کلی خرید کردم",
    translit: "diruz raftam bâzâr va kolli kharid kardam",
    english: "Yesterday I went to the market and bought a lot",
    listenFor: "Sentence-level prosody and whether it runs the clauses together naturally.",
  },
  {
    id: "phoneme-ghayn-khe",
    probe: "غ / خ phonemes",
    persian: "غذا خیلی خوشمزه بود، مرسی",
    translit: "ghazâ kheyli khoshmaze bud, mersi",
    english: "The food was very tasty, thanks",
    listenFor: "غ and خ are distinct and both unlike anything in English. Listen for both.",
  },
  {
    id: "shortvowel-cream",
    probe: "Short-vowel ambiguity (1 of 2)",
    persian: "کرم صورت خریدم",
    translit: "kerem-e surat kharidam",
    english: "I bought face cream",
    listenFor:
      "کرم here is kerem (cream). Compare directly against the next sample — identical letters.",
  },
  {
    id: "shortvowel-worm",
    probe: "Short-vowel ambiguity (2 of 2)",
    persian: "کرم توی باغ دیدم",
    translit: "kerm tu-ye bâgh didam",
    english: "I saw a worm in the garden",
    listenFor:
      "کرم here is kerm (worm). If both samples sound the same, the engine is not disambiguating from context — the single sharpest quality signal available.",
  },
  {
    id: "digits-rtl",
    probe: "Digits inside RTL text",
    persian: "ساعت ۸ صبح می‌بینمت",
    translit: "sâ'at-e hasht-e sobh mi-binamet",
    english: "I'll see you at 8 in the morning",
    listenFor: "Should read hasht. Some engines skip or mispronounce Persian-form digits.",
  },
  {
    id: "enclitic-ast",
    probe: "است → ـه enclitic",
    persian: "اسم من علیه و ۳۵ سالمه",
    translit: "esm-e man Ali-ye va si-o-panj sâlame",
    english: "My name is Ali and I'm 35",
    listenFor: "علیه must be Ali-ye (name + copula), NOT the Arabic word alayh.",
  },
  {
    id: "clarification",
    probe: "Clarification request",
    persian: "ببخشید، می‌شه یه بار دیگه بگید؟",
    translit: "bebakhshid, mi-she ye bâr-e dige begid?",
    english: "Sorry, could you say that once more?",
    listenFor:
      "The learner will hear this constantly, so it has to sound patient rather than clipped. Check question intonation.",
  },
];
