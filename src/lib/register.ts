/**
 * Automated register screening.
 *
 * A keyword screen can *confirm* a failure but cannot *certify* a pass. Phase 0
 * proved this the hard way: gpt-4o-mini scored clean on literary forms while
 * switching from تو to شما mid-conversation, which no keyword list caught
 * (FINDINGS §10). So this is a first pass that flags turns worth a human's
 * attention, never a verdict.
 */

/** Spoken Tehrani forms. Presence is good. */
const COLLOQUIAL = [
  "اومد", "می‌خوای", "می‌خوام", "میارم", "میاری", "بیارم", "چیکار", "چطوره",
  "دیگه", "خوبه", "الان", "یه ", "برات", "براتون", "می‌گم", "می‌ره", "می‌رم",
  "خونه", "نون", "چی ", "آره", "بذار", "بخوای", "نمی‌", "میشه", "می‌شه",
];

/** Literary forms. Presence is drift. */
const LITERARY = [
  "می‌خواهید", "می‌خواهم", "می‌باشد", "آمدید", "چه کار", "می‌روم", "می‌آورم",
  "نمایید", "هستید", "خانه", "نان", "بسیار", "لیکن", "بنابراین",
  "می‌توانید", "می‌کنید که",
  // Space-prefixed on purpose. Standalone است is literary, but the enclitic
  // contraction is not: اینجاست and کجاست are ordinary spoken Persian, and
  // matching a bare "است" flagged them as drift when they are the opposite.
  " است",
];

/** Second person plural/formal. Mixing with informal is the subtle failure. */
const FORMAL_ADDRESS = ["می‌خواین", "می‌خواید", "دارید", "بدید", "کنید", "بفرمایید", "شما"];
const INFORMAL_ADDRESS = ["می‌خوای", "داری", "بدی", "کنی", "بیا", "تو "];

/** Meta-language about grammar — the tutor breaking character to teach. */
const CORRECTION_TALK = [
  "اشتباه", "درستش", "باید بگی", "باید بگید", "grammar", "correct", "mistake",
  "should say", "past tense", "زمان گذشته", "صحیح",
];

const LATIN = /[A-Za-z]{3,}/;

export type RegisterScan = {
  colloquial: number;
  literary: number;
  formalAddress: number;
  informalAddress: number;
  /** Both address registers in one reply — inconsistent politeness. */
  mixedAddress: boolean;
  /** Reads like a grammar explanation rather than a waiter talking. */
  correctionTalk: boolean;
  /** Contains a run of Latin letters, i.e. English. */
  english: boolean;
  words: number;
};

const countHits = (text: string, markers: string[]) =>
  markers.reduce((n, marker) => (text.includes(marker) ? n + 1 : n), 0);

export function scanRegister(reply: string): RegisterScan {
  const formalAddress = countHits(reply, FORMAL_ADDRESS);
  const informalAddress = countHits(reply, INFORMAL_ADDRESS);

  return {
    colloquial: countHits(reply, COLLOQUIAL),
    literary: countHits(reply, LITERARY),
    formalAddress,
    informalAddress,
    mixedAddress: formalAddress > 0 && informalAddress > 0,
    correctionTalk: countHits(reply, CORRECTION_TALK) > 0,
    english: LATIN.test(reply),
    words: reply.trim().split(/\s+/).filter(Boolean).length,
  };
}

/** Turns worth a human looking at, and why. */
export function flagsFor(scan: RegisterScan): string[] {
  const flags: string[] = [];
  if (scan.literary > 0) flags.push("literary form");
  if (scan.mixedAddress) flags.push("mixed تو/شما");
  if (scan.correctionTalk) flags.push("explains grammar");
  if (scan.english) flags.push("English");
  if (scan.words > 25) flags.push("long reply");
  return flags;
}
