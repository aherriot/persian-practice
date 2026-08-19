/**
 * Starter item bank. Curated by hand — this is the one place hand-curated
 * content is worth it up front, since the placement test's convergence
 * quality depends directly on having enough items per tier (see
 * docs/PHASE-2.md, M1/M2).
 *
 * Tiers loosely track: 1-2 absolute beginner, 3-4 elementary, 5-6
 * intermediate, 7-8 upper-intermediate/complex constructions. Colloquial
 * forms follow the same spoken-Tehrani register as `COLLOQUIAL_FORMS` in
 * `src/lib/prompt.ts` — written/literary counterparts are included where the
 * divergence matters for the tutor to recognize and gloss correctly.
 */

export type SeedItem = {
  type: "vocab" | "grammar" | "phrase";
  persian: string;
  literary?: string;
  gloss: string;
  transliteration: string;
  tier: number;
  tags: string[];
};

export const SEED_ITEMS: SeedItem[] = [
  // --- Tier 1: greetings, basics, pronouns ---
  { type: "phrase", persian: "سلام", gloss: "hello", transliteration: "salâm", tier: 1, tags: ["greetings"] },
  { type: "phrase", persian: "خداحافظ", gloss: "goodbye", transliteration: "khodâhâfez", tier: 1, tags: ["greetings"] },
  { type: "phrase", persian: "ممنون", gloss: "thanks", transliteration: "mamnun", tier: 1, tags: ["greetings", "politeness"] },
  { type: "phrase", persian: "خواهش می‌کنم", gloss: "you're welcome / please", transliteration: "khâhesh mikonam", tier: 1, tags: ["politeness"] },
  { type: "phrase", persian: "بله", gloss: "yes", transliteration: "bale", tier: 1, tags: ["basics"] },
  { type: "phrase", persian: "نه", gloss: "no", transliteration: "na", tier: 1, tags: ["basics"] },
  { type: "vocab", persian: "من", gloss: "I / me", transliteration: "man", tier: 1, tags: ["pronouns"] },
  { type: "vocab", persian: "تو", literary: "شما (with a friend)", gloss: "you (informal)", transliteration: "to", tier: 1, tags: ["pronouns"] },
  { type: "vocab", persian: "شما", gloss: "you (formal/plural)", transliteration: "shomâ", tier: 1, tags: ["pronouns"] },
  { type: "vocab", persian: "اسم", gloss: "name", transliteration: "esm", tier: 1, tags: ["basics"] },
  { type: "phrase", persian: "اسمت چیه؟", gloss: "what's your name?", transliteration: "esmet chiye?", tier: 1, tags: ["greetings", "questions"] },
  { type: "phrase", persian: "چطوری؟", literary: "چطور هستی؟", gloss: "how are you?", transliteration: "chetori?", tier: 1, tags: ["greetings", "questions"] },
  { type: "phrase", persian: "خوبم", gloss: "I'm good", transliteration: "khubam", tier: 1, tags: ["greetings"] },
  { type: "vocab", persian: "یک", literary: "یک", gloss: "one", transliteration: "yek", tier: 1, tags: ["numbers"] },
  { type: "vocab", persian: "دو", gloss: "two", transliteration: "do", tier: 1, tags: ["numbers"] },
  { type: "vocab", persian: "سه", gloss: "three", transliteration: "se", tier: 1, tags: ["numbers"] },
  { type: "vocab", persian: "خونه", literary: "خانه", gloss: "home / house", transliteration: "khune", tier: 1, tags: ["home", "family"] },
  { type: "vocab", persian: "آب", gloss: "water", transliteration: "âb", tier: 1, tags: ["food"] },
  { type: "vocab", persian: "نون", literary: "نان", gloss: "bread", transliteration: "nun", tier: 1, tags: ["food"] },
  { type: "vocab", persian: "یه", literary: "یک", gloss: "a / one (colloquial article)", transliteration: "ye", tier: 1, tags: ["grammar-word"] },

  // --- Tier 2: present tense, family, everyday objects ---
  { type: "grammar", persian: "می‌رم", literary: "می‌روم", gloss: "I go / I'm going", transliteration: "miram", tier: 2, tags: ["present-tense", "verbs"] },
  { type: "grammar", persian: "می‌خوام", literary: "می‌خواهم", gloss: "I want", transliteration: "mikhâm", tier: 2, tags: ["present-tense", "verbs"] },
  { type: "grammar", persian: "می‌گم", literary: "می‌گویم", gloss: "I say", transliteration: "migam", tier: 2, tags: ["present-tense", "verbs"] },
  { type: "grammar", persian: "می‌خورم", gloss: "I eat", transliteration: "mikhoram", tier: 2, tags: ["present-tense", "verbs", "food"] },
  { type: "grammar", persian: "می‌بینم", gloss: "I see", transliteration: "mibinam", tier: 2, tags: ["present-tense", "verbs"] },
  { type: "vocab", persian: "مادر", gloss: "mother", transliteration: "mâdar", tier: 2, tags: ["family"] },
  { type: "vocab", persian: "پدر", gloss: "father", transliteration: "pedar", tier: 2, tags: ["family"] },
  { type: "vocab", persian: "خواهر", gloss: "sister", transliteration: "khâhar", tier: 2, tags: ["family"] },
  { type: "vocab", persian: "برادر", gloss: "brother", transliteration: "barâdar", tier: 2, tags: ["family"] },
  { type: "vocab", persian: "دوست", gloss: "friend", transliteration: "dust", tier: 2, tags: ["family", "social"] },
  { type: "vocab", persian: "امروز", gloss: "today", transliteration: "emruz", tier: 2, tags: ["time"] },
  { type: "vocab", persian: "فردا", gloss: "tomorrow", transliteration: "fardâ", tier: 2, tags: ["time"] },
  { type: "vocab", persian: "دیروز", gloss: "yesterday", transliteration: "diruz", tier: 2, tags: ["time"] },
  { type: "vocab", persian: "الان", literary: "اکنون", gloss: "now", transliteration: "alân", tier: 2, tags: ["time"] },
  { type: "phrase", persian: "چیکار می‌کنی؟", literary: "چه کار می‌کنی؟", gloss: "what are you doing?", transliteration: "chikâr mikoni?", tier: 2, tags: ["questions"] },
  { type: "phrase", persian: "چند سالته؟", gloss: "how old are you?", transliteration: "chand sâlete?", tier: 2, tags: ["questions"] },
  { type: "vocab", persian: "غذا", gloss: "food", transliteration: "ghazâ", tier: 2, tags: ["food"] },
  { type: "vocab", persian: "چایی", gloss: "tea", transliteration: "chây", tier: 2, tags: ["food"] },
  { type: "vocab", persian: "کتاب", gloss: "book", transliteration: "ketâb", tier: 2, tags: ["objects"] },
  { type: "vocab", persian: "ماشین", gloss: "car", transliteration: "mâshin", tier: 2, tags: ["objects", "travel"] },

  // --- Tier 3: past tense, weather, shopping ---
  { type: "grammar", persian: "رفتم", gloss: "I went", transliteration: "raftam", tier: 3, tags: ["past-tense", "verbs"] },
  { type: "grammar", persian: "خوردم", gloss: "I ate", transliteration: "khordam", tier: 3, tags: ["past-tense", "verbs", "food"] },
  { type: "grammar", persian: "دیدم", gloss: "I saw", transliteration: "didam", tier: 3, tags: ["past-tense", "verbs"] },
  { type: "grammar", persian: "گفتم", gloss: "I said", transliteration: "goftam", tier: 3, tags: ["past-tense", "verbs"] },
  { type: "grammar", persian: "بودم", gloss: "I was", transliteration: "budam", tier: 3, tags: ["past-tense", "verbs"] },
  { type: "vocab", persian: "هوا", gloss: "weather / air", transliteration: "havâ", tier: 3, tags: ["weather"] },
  { type: "vocab", persian: "بارون", literary: "باران", gloss: "rain", transliteration: "bârun", tier: 3, tags: ["weather"] },
  { type: "vocab", persian: "آفتابی", gloss: "sunny", transliteration: "âftâbi", tier: 3, tags: ["weather"] },
  { type: "vocab", persian: "سرد", gloss: "cold", transliteration: "sard", tier: 3, tags: ["weather"] },
  { type: "vocab", persian: "گرم", gloss: "hot / warm", transliteration: "garm", tier: 3, tags: ["weather"] },
  { type: "phrase", persian: "هوا چطوره؟", literary: "هوا چطور است؟", gloss: "how's the weather?", transliteration: "havâ chetore?", tier: 3, tags: ["weather", "questions"] },
  { type: "vocab", persian: "قیمت", gloss: "price", transliteration: "gheymat", tier: 3, tags: ["shopping"] },
  { type: "phrase", persian: "چنده؟", literary: "چند است؟", gloss: "how much is it?", transliteration: "chande?", tier: 3, tags: ["shopping", "questions"] },
  { type: "vocab", persian: "ارزون", literary: "ارزان", gloss: "cheap", transliteration: "arzun", tier: 3, tags: ["shopping"] },
  { type: "vocab", persian: "گرون", literary: "گران", gloss: "expensive", transliteration: "gerun", tier: 3, tags: ["shopping"] },
  { type: "vocab", persian: "بازار", gloss: "market/bazaar", transliteration: "bâzâr", tier: 3, tags: ["shopping"] },
  { type: "vocab", persian: "مغازه", gloss: "shop", transliteration: "maghâze", tier: 3, tags: ["shopping"] },
  { type: "grammar", persian: "برای اینکه", literary: "زیرا", gloss: "because", transliteration: "barâye inke", tier: 3, tags: ["connectors"] },
  { type: "vocab", persian: "چمدون", literary: "چمدان", gloss: "suitcase", transliteration: "chamedun", tier: 3, tags: ["travel"] },
  { type: "phrase", persian: "دارم چمدون می‌بندم", gloss: "I'm packing a suitcase", transliteration: "dâram chamedun mibandam", tier: 3, tags: ["travel"] },

  // --- Tier 4: future/modal, travel, plans ---
  { type: "grammar", persian: "می‌خوام برم", gloss: "I want to go", transliteration: "mikhâm beram", tier: 4, tags: ["future", "verbs", "travel"] },
  { type: "grammar", persian: "باید برم", gloss: "I have to go", transliteration: "bâyad beram", tier: 4, tags: ["modal", "verbs"] },
  { type: "grammar", persian: "می‌تونم", literary: "می‌توانم", gloss: "I can", transliteration: "mitunam", tier: 4, tags: ["modal", "verbs"] },
  { type: "vocab", persian: "سفر", gloss: "trip / travel", transliteration: "safar", tier: 4, tags: ["travel"] },
  { type: "vocab", persian: "بلیط", gloss: "ticket", transliteration: "belit", tier: 4, tags: ["travel"] },
  { type: "vocab", persian: "فرودگاه", gloss: "airport", transliteration: "forudgâh", tier: 4, tags: ["travel"] },
  { type: "vocab", persian: "هتل", gloss: "hotel", transliteration: "hotel", tier: 4, tags: ["travel"] },
  { type: "phrase", persian: "کجا می‌ری؟", gloss: "where are you going?", transliteration: "kojâ miri?", tier: 4, tags: ["travel", "questions"] },
  { type: "vocab", persian: "شمال", gloss: "north", transliteration: "shomâl", tier: 4, tags: ["travel", "geography"] },
  { type: "vocab", persian: "جنوب", gloss: "south", transliteration: "jonub", tier: 4, tags: ["travel", "geography"] },
  { type: "phrase", persian: "اینه", literary: "این است", gloss: "this is (it)", transliteration: "ine", tier: 4, tags: ["grammar-word"] },
  { type: "phrase", persian: "چطوره", literary: "چطور است", gloss: "how is / how about", transliteration: "chetore", tier: 4, tags: ["grammar-word", "questions"] },
  { type: "vocab", persian: "لباس", gloss: "clothes", transliteration: "lebâs", tier: 4, tags: ["packing"] },
  { type: "vocab", persian: "کفش", gloss: "shoes", transliteration: "kafsh", tier: 4, tags: ["packing"] },
  { type: "phrase", persian: "چی باید ببرم؟", gloss: "what should I bring?", transliteration: "chi bâyad bebaram?", tier: 4, tags: ["packing", "questions"] },

  // --- Tier 5: complex sentences, subjunctive, opinions ---
  { type: "grammar", persian: "فکر می‌کنم", gloss: "I think", transliteration: "fekr mikonam", tier: 5, tags: ["opinions"] },
  { type: "grammar", persian: "به نظرم", gloss: "in my opinion", transliteration: "be nazaram", tier: 5, tags: ["opinions"] },
  { type: "grammar", persian: "اگه", literary: "اگر", gloss: "if", transliteration: "age", tier: 5, tags: ["connectors"] },
  { type: "grammar", persian: "شاید", gloss: "maybe", transliteration: "shâyad", tier: 5, tags: ["modal"] },
  { type: "grammar", persian: "بهتره", literary: "بهتر است", gloss: "it's better (to)", transliteration: "behtare", tier: 5, tags: ["opinions", "grammar-word"] },
  { type: "vocab", persian: "احساس", gloss: "feeling", transliteration: "ehsâs", tier: 5, tags: ["emotions"] },
  { type: "vocab", persian: "خسته", gloss: "tired", transliteration: "khaste", tier: 5, tags: ["emotions"] },
  { type: "vocab", persian: "نگران", gloss: "worried", transliteration: "negarân", tier: 5, tags: ["emotions"] },
  { type: "vocab", persian: "خوشحال", gloss: "happy", transliteration: "khoshhâl", tier: 5, tags: ["emotions"] },
  { type: "phrase", persian: "چه خبر؟", gloss: "what's new?", transliteration: "che khabar?", tier: 5, tags: ["greetings", "questions"] },
  { type: "grammar", persian: "با اینکه", gloss: "even though", transliteration: "bâ inke", tier: 5, tags: ["connectors"] },
  { type: "grammar", persian: "تا", gloss: "until / so that", transliteration: "tâ", tier: 5, tags: ["connectors"] },

  // --- Tier 6: idiomatic register, subordinate clauses ---
  { type: "phrase", persian: "راستش رو بخوای", gloss: "to tell you the truth", transliteration: "râstesh ro bekhây", tier: 6, tags: ["idiomatic"] },
  { type: "phrase", persian: "چیز خاصی نیست", gloss: "it's nothing special", transliteration: "chize khâssi nist", tier: 6, tags: ["idiomatic"] },
  { type: "grammar", persian: "درحالی که", gloss: "while / whereas", transliteration: "dar hâli ke", tier: 6, tags: ["connectors"] },
  { type: "grammar", persian: "به جای اینکه", gloss: "instead of", transliteration: "be jâye inke", tier: 6, tags: ["connectors"] },
  { type: "phrase", persian: "هرچی باشه", gloss: "whatever it may be / anyway", transliteration: "harchi bâshe", tier: 6, tags: ["idiomatic"] },
  { type: "grammar", persian: "انگار", gloss: "it seems / as if", transliteration: "engâr", tier: 6, tags: ["opinions"] },
];
