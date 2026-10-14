# Phase 0 findings

Running record of what the spike has established. Each entry is something that
changes a decision, with the evidence behind it.

---

## 1. ~~Voice selected: Azure `fa-IR-DilaraNeural`~~ — SUPERSEDED by §7

> This finding was overturned. It is kept because the reasoning that produced it
> was sound given what was known at the time, and because the way it failed is
> the most useful thing in this document: the decision rested on an unverified
> claim, and verifying the claim reversed it. See §7.

Chosen from a 5-arm blind comparison (OpenAI alloy/nova unsteered, OpenAI alloy
steered toward a Tehrani accent, Azure Dilara, Azure Farid).

Recorded in code as `SELECTED_TTS` in `src/lib/tts-provider.ts`.

**Caveat, unresolved:** the accent judgement has *not* yet been made by a native
speaker, and the specific reported OpenAI failure mode — an Afghan/Dari accent —
is exactly what a non-native ear cannot detect, since it sounds like fluent
Persian either way. 13 OpenAI samples remain unrendered. The choice should be
treated as provisional until the native-speaker session.

## 2. Speaking tempo differs sharply between vendors

Average clip length over the same 10 sentences:

| Voice | Avg | |
|---|---|---|
| azure-dilara | 3.10s | fastest |
| azure-farid | 3.18s | +3% |
| openai-alloy | 3.69s | +19% |
| openai-nova | 3.76s | +21% |
| openai-alloy-steered | 4.27s | +38% |

The steered arm being slowest is evidence the steering prompt is honoured — the
instruction asked for a "warm, patient pace, as if speaking with someone learning
the language". Relevant because pace is tunable on Azure too, via SSML
`<prosody rate>`, so a preference for OpenAI's pace is not a reason to pick
OpenAI.

## 3. Digits in time expressions were read twice — fixed

`ساعت ۸ صبح` was spoken as "sâ'at-e **sâ'at** hasht-e sobh". Azure's Persian text
normalizer matches `ساعت <number>` as a time expression and re-expands the
numeral with the word already present in the sentence.

| Approach | Duration | |
|---|---|---|
| Baseline | 3.72s | wrong |
| `<say-as interpret-as="cardinal">` | 3.23s | **fixed** (−0.49s ≈ one ساعت) |
| ASCII digit `8` instead of `۸` | 3.72s | no effect |
| Spelled out `هشت` | 3.37s | fixed |

**Shipped:** `toSsmlWithCardinals()` wraps every numeral run automatically.
Swapping digit forms is *not* a workaround — both forms hit the same rule.

Known limitation: each digit run becomes its own cardinal, so `۸:۳۰` reads
"hasht si" rather than "hasht-o nim". Clock times must be written as words.

## 4. Azure has no phoneme-level control for Persian

`<phoneme alphabet="ipa" ph="kerm">` returned HTTP 200 and **byte-identical
audio** to the unmarked baseline (same SHA-256). Azure's documented phonetic sets
cover en/fr/de/es-ES/ja-JP/zh variants; `fa-IR` is not among them.

Harakat (vowel marks) do change the audio but do not fix pronunciation — both
`کِرم` and `کِرْم` still produced *kerem*, and both were *longer* than baseline
rather than shorter.

This rules out per-word IPA as a pronunciation mechanism, and by extension makes
a custom lexicon (PLS) unlikely to help, since its `<phoneme>` entries run
through the same locale phone-set machinery. Untested: PLS `<alias>`, which is
plain text substitution — but that needs a Persian spelling that yields the right
sound, and harakat already demonstrated none exists for this class of word.

## 5. THE BIG ONE — TTS ignores context entirely for short-vowel ambiguity

Written Persian omits short vowels, so one consonant skeleton spells several
words. 15 homograph pairs were rendered in disambiguating contexts and rated by
the project owner.

| Reading | Result |
|---|---|
| **Common** (frequency-default) | **15 / 15 correct** |
| **Less common** (needs context) | **0 / 15 correct** — 13 wrong, 1 unclear, 1 mispronounced as a third word entirely |

Every failure:

`kerm` (worm) · `gel` (mud) · `shokr` (thanks) · `mohr` (seal) · `boronj` (brass)
· `dom` (tail) · `geram` (gram) · `noh` (nine) · `Kord` (a Kurd) · `kand` (dug) ·
`past` (low) · `shosh` (lung) · `ton` (tonne) · `mord` (died) · `kesht` (planting)

### What this means

**The engine does not use context. It always picks the globally most frequent
reading.** This is not a quality gap that a better vendor closes — it is the
absence of semantic disambiguation for Persian. `کند` was rendered as *konad*
("he does"), which was not even one of the two candidate readings — it is simply
the most frequent form of that skeleton anywhere.

**It is deterministic, which is the one piece of good news.** Failures are
predictable in advance rather than random: for any ambiguous word, if the
intended reading is not the frequency-default, TTS will be wrong. No runtime
detection is needed — an exception list can be computed ahead of time.

**The affected words are not exotic.** `نه` (nine), `گرم` (gram), `شش` (lung),
`گل` (mud) are beginner vocabulary. Most seriously, **`مرد` → *mord* (died) is
core past-tense grammar**, not vocabulary. A tutor teaching past tense will
mispronounce it every time.

**The battery is a worst case, not a sample.** These pairs were selected *for*
ambiguity. The unmeasured question is what fraction of realistic tutor output is
ambiguous-and-non-default. That number, not this one, determines severity.

### Options remaining

Recorded human audio for a bounded vocabulary set remains the reliable fallback,
but see finding 6 first — it changes the picture substantially.

---

## 6. OpenAI handles homographs far better than Azure, and instructions help

Same six words that Azure failed, through `gpt-4o-mini-tts` with three
instruction strategies.

| Word | Azure | OpenAI plain | OpenAI **named** | OpenAI contrastive |
|---|---|---|---|---|
| kerm (worm) | wrong | *unrated* | **correct** | correct |
| mord (died) | wrong | correct | **correct** | correct |
| noh (nine) | wrong | correct | **correct** | correct |
| gel (mud) | wrong | wrong | **correct** | wrong |
| geram (gram) | wrong | correct | **correct** | wrong |
| shosh (lung) | wrong | wrong | wrong | wrong |
| **score** | **0 / 6** | **3 / 5** | **5 / 6** | **3 / 6** |

Three separate results:

**(a) OpenAI uses context; Azure does not.** With *no instructions at all*,
OpenAI got 3 of 5 right where Azure got 0 of 6. This is not a small quality gap —
it is the difference between a model that reads for meaning and one that applies
a frequency table. It materially weakens the case for Azure, and it was not
visible in the accent-focused bakeoff.

**(b) Naming the intended reading works.** "This word means X and must be
pronounced Y" lifted 3/5 → 5/6, fixing `gel` and `kerm`. The annotation needed
per vocabulary entry is therefore small: a gloss and a transliteration, both of
which the data model wants anyway.

**(c) Contrastive instructions actively backfire.** Adding "do NOT pronounce it
Z" *dropped* the score to 3/6, breaking `gel` and `geram` — words that both the
plain and named arms got right. Naming the wrong reading appears to prime the
model toward it. **Do not mention the incorrect pronunciation.** This is worth
recording because the instinct to over-specify is natural and here it is
measurably harmful.

**Not everything is fixable.** `shosh` (lung) failed in all three arms. Some
words resist instruction, so an exception list is still needed — just a much
shorter one.

### What this does to the vendor choice

Finding 1 selected Azure Dilara on accent, but that judgement has still not been
made by a native speaker. There is now a real trade-off on two axes:

- **Accent** — Azure's dedicated fa-IR voice is the stronger prior, unvalidated.
- **Pronunciation correctness** — OpenAI is demonstrably far better, measured.

These cannot be traded off until the accent axis is measured. The native-speaker
session is now the gate on an architectural decision, not a preference.

---

## 7. The Afghan-accent claim does not reproduce — Azure's advantage was imaginary

Native-speaker blind rating, 9 sentences x 4 voices, each sentence targeting one
phonological feature where Iranian Persian and Dari provably diverge.

| Marker | alloy | nova | alloy-steered | Azure Dilara |
|---|---|---|---|---|
| ق / غ merger | Iranian | Iranian | Iranian | Iranian |
| و = /v/ vs /w/ | Iranian | Iranian | Iranian | Iranian |
| majhul ē | Iranian | Iranian | Iranian | Iranian |
| majhul ō | Iranian | Iranian | Iranian | Iranian |
| ey vs ay | Iranian | Iranian | Iranian | Iranian |
| و medial | Iranian | Iranian | Iranian | Iranian |
| **overall placement** | Iranian | Iranian | Iranian | Iranian |

**34 of 36 overall judgements were "Iranian"** (2 left unanswered). Not one
Afghan/Dari judgement on any voice, on any marker.

**The community report that OpenAI's Persian carries an Afghan accent did not
reproduce.** That report was the entire reason Azure was preferred in finding 1.
It should be treated as refuted for these voices.

### Register is a separate problem, and it is universal

| Marker | alloy | nova | alloy-steered | Azure Dilara |
|---|---|---|---|---|
| خانه | khâne (formal) | khâne | khâne | khâne |
| نان | nân (formal) | nân | nân | nân |
| **colloquial spelling** (خونه، نون) | **mispronounced** | natural | natural | natural |

Every voice reads formal Persian formally. No voice volunteers *khune* for
خانه — but that is the correct behaviour, because the input text said خانه.

**The decisive row is the last one.** Given text written the way Iranians
actually write — می‌رم خونه نون بخرم — three of four voices read it naturally.
So register is controlled at the *text generation* layer, not the TTS layer: if
the tutor writes colloquially, the voice speaks colloquially. This validates the
decision to prompt hard for colloquial Tehrani, and means register is not a
vendor differentiator.

Plain `alloy` is the exception — it mispronounces colloquial spellings.
Notably `alloy` **with the Tehrani steering instruction** does not, so the
instruction fixes register handling as well as accent framing.

### Vendor conclusion — SETTLED

Azure was selected on an accent advantage that does not exist. On the axis that
does differ — homograph pronunciation — OpenAI scores 5/6 against Azure's 0/6.

**Decision: OpenAI `gpt-4o-mini-tts`, voice `nova`.** Confirmed against the full
15-pair homograph battery and reviewed with a native speaker. Recorded as
`SELECTED_TTS` in `src/lib/tts-provider.ts`.

Not bare `alloy` — it mispronounces colloquial spellings, though `alloy` with the
Tehrani steering instruction does not.

Traded away in this choice, and worth revisiting only if they start to hurt:
Azure is 19–38% faster (closer to conversational pace) and cheaper per minute.

Untested combination: per-word pronunciation instructions (finding 6) layered on
top of a steering instruction. Both work individually; not yet used together.

---

## PHASE 0A: COMPLETE — PASSED

The gate was "is there a Persian voice good enough to teach pronunciation with?"
Yes, with two known limits: homographs need per-word instructions and a short
exception list (`shosh` resisted all strategies), and colloquial register must be
driven from the text-generation layer rather than expected from the voice.

Remaining gate: **Phase 0B**, whether transcripts preserve learner errors.

---

## 8. Still unsolved: free-form conversation

Instructions only help where the ambiguous word and its intended reading are
known *before* synthesis. That covers curated vocabulary and scripted lesson
content. It does not cover a tutor generating a sentence mid-conversation, where
nothing has told the TTS layer that `مرد` means "died" this time. Making that
work needs a disambiguation pass over generated text before synthesis — real
work, worth scoping only once the vendor is settled.

---

## 9. STT: the verbatim prompt is not optional — it changes everything

10 clips recorded on a MacBook built-in mic (48 kHz, normalized), 5 correct
Persian and 5 with planted learner errors.

| Arm | WER on correct speech | Errors preserved |
|---|---|---|
| gpt-4o-transcribe, no prompt | **44%** | 1/4 (25%) |
| **gpt-4o-transcribe, verbatim prompt** | **4%** | **3/4 (75%)** |
| Azure Speech fa-IR | 33% | 3/4 (75%) |

### The unprompted arm falls out of Persian entirely

Despite `language: "fa"` being set explicitly, the no-prompt arm returned
romanized and hallucinated Latin text:

| Asked | Heard (no prompt) |
|---|---|
| می‌شه لطفاً آروم‌تر صحبت کنید؟ | `michel dotrice war am theater bekannt` |
| من دیروز بازار می‌رم | `man tirūs bazar mea` |
| ماشین من قرمز | `mašine má kermes` |

The same audio with the verbatim prompt transcribes correctly in Persian script.
An 11x difference in WER from one prompt field. **Always send it.**

### The one "failure" is misclassified, and the reason matters

`err-tense` with the verbatim prompt scored `other`, but the transcript was
من دیروز بازار **میام** — it heard *miâm* (I come) for *miram* (I go). That is a
verb *recognition* error, yet the planted grammatical error survived intact:
present tense still sits next to دیروز. The pedagogically relevant signal was
preserved; the whole-string classifier in `judge()` simply cannot see that.

Real preservation for the verbatim arm is therefore closer to 4/4 than 3/4, and
the classifier is the thing that needs improving before this number is trusted
at scale — it should test whether the *grammatical feature* survived, not
whether the string matches.

### Azure exhibited the feared behaviour; OpenAI did not

On `err-copula` the learner said ماشین من قرمز, dropping the copula. Azure
returned ماشین ما قیم **است** — it *inserted* the copula the learner omitted.
That is silent repair: the exact failure mode that erases evidence before the
teaching layer sees it. The verbatim OpenAI arm returned ماشین ما قرمز, keeping
the omission.

### Decision

**`gpt-4o-transcribe` with the verbatim prompt.** Best WER by a factor of eight
against Azure, equal-or-better error preservation, and it did not fabricate a
correction. Already implemented as the `openai-transcribe-verbatim` arm in
`src/lib/stt-provider.ts`.

### Caveats

- Four judgeable error clips is a very small sample. 75% has wide error bars.
- `err-ezafe` is `undetectable` for every arm by design — a missing ezafe leaves
  no trace in written Persian, so no transcript-based system can catch it.
- Both surviving arms mangled individual words while keeping the grammar
  (نیوز for دیروز, ما for من). Word-level vocabulary tracking will be noisier
  than grammar-level error detection.

---

## PHASE 0B: COMPLETE — PASSED

Error preservation is 75% against a ~50% gate, and the one miss is a
classifier artefact rather than a repair. Transcript-diffing can be the basis of
the teaching engine.

Before building the learner model on it: widen the error battery beyond five
clips, and make `judge()` test grammatical features rather than whole strings.

---

## 10. M1 latency: reply length matters more than model choice

Server-side only — excludes microphone, upload, speech-to-text, and playback.
Chat and TTS measured together, because a smaller model that writes longer
replies can be slower overall.

| Arm | chat | tts | total | reply length |
|---|---|---|---|---|
| gpt-4o-mini, 1 sentence | 848ms | 1084ms | **1932ms** | 38 chars |
| **gpt-4o, 1 sentence** | 857ms | 1258ms | **2115ms** | 51 chars |
| gpt-4o-mini, 2 sentences | 896ms | 1361ms | 2257ms | 45 chars |
| gpt-4o, 2 sentences (was default) | 1245ms | 1234ms | 2479ms | 46 chars |

**Two thirds of the available saving came from reply length, not the model.**
Going from two sentences to one took 364ms off the turn at no quality cost —
shorter turns are better speech anyway.

### Register held everywhere; quality did not

All four arms scored zero literary-form hits, and all four correctly recast the
planted tense error (`دیروز اینجا می‌رم` → `دیروز اومدی اینجا`). The prompt is
robust across models.

But `gpt-4o-mini` was measurably worse as a *character*. It produced
"چایی خوبه!" where `gpt-4o` produced "باشه، یه چایی برات میارم", and in the
two-sentence arm it **switched from informal to formal address mid-conversation**
— `می‌خوای` early, `ندادید / می‌خواید / بدید` later. Mixing تو and شما with the
same customer is a genuine register error, and a keyword screen misses it because
those forms are colloquial-formal rather than literary.

**Decision: `gpt-4o`, one sentence.** Take the 364ms that is free; do not pay
persona quality for the remaining 183ms.

### Implication for M2

At 2115ms server-side the turn is still well past the 1.5s target, and streaming
remains the necessary lever. Projected: first-clause LLM (~0.5-0.7s) plus TTS for
that clause only (~0.5-0.7s).

---

## 11. M2 streaming: the win was audio, not text

| | median first audio |
|---|---|
| M1 baseline (wait for whole reply, whole clip) | 2329ms |
| **M2 streaming** | **1245ms** |
| saving | **1084ms** |

Server-side, excluding microphone, upload, speech-to-text and playback start.
1245ms is under the 1.5s "feels conversational" threshold committed in
docs/PHASE-1.md before measuring.

### The projection was right; the reasoning was wrong

M2 was planned on the assumption that TTS time scales with text length, so
synthesising one clause instead of a whole reply would roughly halve it. It does
not scale that way:

| text | TTS time |
|---|---|
| 26 chars | 1161ms |
| 46 chars | 1476ms |
| 72 chars | 1582ms |

Roughly a second of fixed cost, and only modest scaling with length. **Splitting
the text into clauses was worth about 300ms, not the ~1000ms projected.**

### The larger lever was elsewhere

The speech API returns its first audio bytes long before the clip is finished:

| format | first byte | complete | discarded by buffering |
|---|---|---|---|
| mp3 | 646ms | 1139ms | 493ms |
| **pcm** | **532ms** | 1221ms | **689ms** |
| opus | 586ms | 984ms | 398ms |

The route was calling `arrayBuffer()`, so every clause waited for a complete file
and threw that away. Piping the response through and scheduling samples as they
arrive was worth more than the entire text-chunking exercise.

PCM is used rather than mp3 or opus because raw samples need no container
parsing — any two bytes are already a sample, so audio can be scheduled the
instant it arrives. It costs bandwidth (233KB against 82KB) and buys latency.

**Both levers were needed. Only measuring where the time actually went revealed
the bigger one.**

### Caveats

- These numbers exclude speech-to-text entirely, which is a whole stage.
- Shortening replies to one sentence (§10) reduced the headroom streaming had to
  work with — the two optimisations partly overlap.
- Order is preserved by queueing clause *requests* and playing by position;
  requests overlap and can respond out of order.

### VERDICT: streaming is off by default — the measured win made it worse

Tried in the app by a learner: **the clause-by-clause playback stutters, and the
baseline latency was judged perfectly acceptable.** Streaming is now behind a
toggle, defaulting off.

Two things worth being explicit about, because they are the actual lesson:

**The threshold was invented, and it was wrong.** "Under 1.5s feels
conversational" was committed before measuring, which made the result
falsifiable — but it was a guess borrowed from turn-taking research on human
conversation, not from anyone using this app to learn Persian. The real user
found ~2.3s fine. Optimising against a made-up number produced a real 1084ms
improvement that nobody wanted.

**Smoothness was never measured.** Every number in this document is latency.
Nothing tracked whether the audio sounded continuous, so the regression could
only surface when a person listened. The stutter has a clear cause: each clause
is a separate synthesis call with its own prosody, and any clause whose audio is
not ready when the previous one ends leaves a gap.

### What would keep the win without the stutter

Progressive playback of a *single* synthesis call — no clause splitting. That
removes inter-clause gaps entirely while keeping the ~689ms saved by not
buffering the audio (which was the larger of the two levers anyway). Not built,
because the learner reports current latency is fine, and a smoother experience
at 2.3s beats a stuttering one at 1.2s.

---

## 12. M3: register does not drift, and recasting works

Twenty-turn scripted conversation against the real prompt, each reply fed back
in so drift compounds as it would in use (`spike/conversation-probe.ts`).

### Drift did not happen

| | first half | second half |
|---|---|---|
| literary forms per turn | 0.10 | **0.00** |
| colloquial forms per turn | 1.40 | 1.30 |
| reply length | 9.1 words | **7.0 words** |

The predicted failure — the prompt losing force as the transcript grows — did not
materialise. Replies got *shorter*, not longer, and the only two flagged turns
were turns 2 and 3, at the very start. Re-sending `REGISTER_REMINDER` on every
turn appears to be doing its job.

### Recasting works, and never turned into a grammar lesson

| turn | learner said | tutor replied | verdict |
|---|---|---|---|
| 6 | من دیروز اینجا می‌رم | آها، دیروز **اومدی** اینجا! | tense fixed |
| 14 | ماشین من قرمز | آها، **ماشینت قرمزه**! | copula supplied |
| 16 | من رفتم به خونه دیروز | آها، **دیروز رفتی خونه**! | word order fixed |
| 9 | کتاب خوندم | آها، کتاب **خوندی**! | را not restored, but conversation continued |

Three of four planted errors were recast correctly and naturally. **Not once did
it stop to explain a mistake** — the behaviour the brief cares most about.

Code-switching was handled as specified: an English question at turn 4 was
answered in simple Persian, and the meta-question at turn 13 ("how do you say
delicious?") was answered directly with می‌گیم خوشمزه.

### One real failure: explicit English requests are ignored

Turn 18, "Can you say that in English?", got `باقلوا داریم، می‌خوای امتحان کنی؟`
— it carried on in Persian and ignored the request entirely. The prompt says to
honour direct requests for English, and it does not. This matters: a learner who
is genuinely stuck has no escape hatch, which is precisely when they abandon an
app.

### The automated screen produced a false positive

`منو اینجاست` was flagged as literary because a bare `است` matched. The enclitic
contraction is ordinary spoken Persian — the *separated* form is the drift. Fixed
by matching a space-prefixed `" است"`, with a regression test.

Taken with §10, where the same screen missed a تو/شما switch entirely, the
position is now clear: **the keyword screen has both false positives and false
negatives, and can only ever nominate turns for human attention.** Every turn in
the report still carries rating controls for that reason.

### Still needs the native speaker

The automated pass says register held and recasts landed. It cannot judge whether
`بفرمایید بشینید ... دوست داری` (turn 2, formal formula beside informal address)
is natural for a waiter or jarring, and that class of question is the whole
reason the review page exists.

---

## Open questions

- Native-speaker accent rating — the gate for finding 1. Not yet done.
- 13 OpenAI TTS samples unrendered (quota).
- Phase 0B (STT error preservation) not yet run — needs OpenAI quota.
- What fraction of realistic tutor output hits finding 5.

---

## 13. An automated listener catches mispronounced TTS, so audio is generated, checked and retried

**The problem.** The lesson sentence «هویج و سیب داریم» was stored saying the
formal *va* where the spoken *o* is wanted. Regenerating the **identical
request** produced the correct *havij o sib dârim*. So OpenAI's speech model is
not deterministic the way §5 found Azure to be: for any spelling that leaves the
reading open it can come out right on one call and wrong on the next. No prompt
can be trusted on its own, and fixing sentences by hand does not scale.

**Changing the text or the instruction did not help.** Five variants of that
sentence, rated by the project owner:

| Variant | Verdict |
|---|---|
| Same text and voice instruction, regenerated | **best, natural** |
| و attached to the previous word (هویجو) | *havij* mispronounced, does not flow |
| و replaced by a zamme (هویجُ) | unnatural pause |
| Voice instruction plus a sentence naming the reading | said *vav* |
| Attached و plus the naming sentence | unnatural pause |

The fourth row is the "untested combination" from §7 — a pronunciation
instruction layered on the voice instruction — and it failed here, as it did on
the lone word هویج (*hovij*). Use one or the other, not both.

**The listener.** `gpt-audio-1.5` is given the audio and the expected
transliteration, word by word, and asked what it heard at each position and
whether it matches (`src/lib/audio-verify.ts`). Asked *blind* to transcribe
phonetically it was too noisy to use (*hâdi jo sib* for a clip rated correct).
Checking against an expected form is what works.

Measured on 23 human-rated clips — the 17 from §6 plus the six above — two
listens each (`npm run spike:listener`):

| | |
|---|---|
| Listens agreeing with the human | 38 / 46 |
| Bad clips passed | 1 / 24 listens — a pause-only defect, failed on its other listen |
| Good clips rejected | 7 / 22 listens |
| Mispronounced clips passed, on any listen | **0** |

The errors run in the cheap direction. Requiring **two passing listens** accepted
no bad clip in this set and rejected about 4 in 10 good ones, and a rejection
only costs another attempt.

**The pipeline** (`src/lib/audio-store.ts`; the "named" rung below was removed
in §14). Every clip carries the
transliteration it must match, which the content already has. Up to four
attempts: two with the voice instruction alone, then two with the §6 "named"
instruction — without the voice instruction — for the words that keep failing.
The first candidate to pass two listens is stored; if none does, the closest is
stored and the clip is marked `flagged` for a human.

First full run, Shopping theme, 62 clips:

| Accepted on | Clips |
|---|---|
| Attempt 1 (voice instruction) | 42 |
| Attempt 2 (voice instruction) | 8 |
| Attempts 3–4 (named instruction) | 9 |
| Flagged, then verified on a re-run | 1 |
| Listener gave no usable reply; verified on a re-run | 2 |

The named rung rescued nine clips, including the lone word و as *o*.

### Caveats

- The listener was validated on 23 clips. Zero false passes on that set is not
  zero in general — like the keyword screen in §12 it nominates, and a native
  speaker's ear is still the real test.
- It checks segments, not prosody. It caught one of three pause-only defects
  reliably; naturalness and accent are not what it measures.
- A clip can be `verified` and still wrong if the hand-written transliteration
  it is checked against is wrong.

---

## 14. The "named" fallback cost the accent — removed

**The problem.** The project owner reported that some "to have" sentences sound
Afghan, and that the giveaway is the long **â** in دارم / داریم. The text is
standard Tehrani, so the fault is in the audio. §7 never tested this vowel: its
markers were ق/غ, و, the majhul vowels, ey/ay and final ه.

**The listener cannot hear it.** Asked outright whether each stored "to have"
clip sounded Iranian or Dari, `gpt-audio-1.5` said "Iranian" on 175 of 183
listens, with no relation to how the clip was made. Accent needs a human ear.

**Blind rating** (`npm run spike:avowel`): four sentences, each read seven ways.
Only one sentence was rated — «سلام، نون تازه دارین؟» — so this is seven
ratings, not twenty-eight:

| Arm | â in the verb |
|---|---|
| nova, voice instruction | Tehrani |
| nova, voice instruction + the vowel described | Tehrani |
| coral, voice instruction | Tehrani |
| nova, "named" fallback (§13) | off |
| nova, "named" fallback with "Iranian Persian, Tehrani accent" added | off |
| alloy, voice instruction | off |
| the stored clip (made by the "named" fallback) | can't tell |

Every nova clip made with the voice instruction was rated Tehrani; both made
with the word-naming instruction were rated off, and stating the accent inside
that instruction did not rescue it. The off clips were marked "off in another
way", not "Afghan-like".

**Decision.** The named rung is gone. All attempts use the voice instruction,
and the ladder is six attempts instead of four. `npm run db:audio` now remakes
any clip whose stored instruction is not the current one.

Remaking the 17 named clips and retrying the flagged ones left 111 of 114
verified and 3 flagged — fewer than the 6 flagged before. So the named rung was
not needed to get the words right; more tries with the voice instruction do it.
The exception is the lone word و, which the named rung had read as *o* and
which is now flagged (heard *va*). That overwrite was itself a fault: a remake
now replaces stored audio only if it passes the listener (`makeClipAudio`).

### Caveats

- One sentence, one rater, one take per arm, and the speech model varies between
  takes. The direction matches the code-level suspicion, but it is thin.
- Nothing automated checks this vowel. A new clip is verified for its words only.
- Azure Dilara was meant as a native reference arm; the Azure key was rejected.

---

## 15. Stored audio can only get better; a person's verdict is part of the system

**The problem.** §14's remake overwrote the lone word و (*o*) with a take that
said *va*. Nothing stopped a worse clip replacing a better one, the only accent
judge — a person — had no way to tell the system anything, and a change to how
audio is made (§13's named rung) had shipped without anyone hearing its accent.

**Rules now in `src/lib/audio-store.ts`:**

- A remake replaces stored audio only if it passes the listener. Otherwise the
  old audio stays.
- A person can approve a clip, which pins it — no automated run replaces it —
  or reject it, which keeps the rejected take (`reviewed/<id>.mp3`, with the
  reason and what the listener had said) and makes a new one. Rows are in
  `AudioReview`. These are the only accent labels the project has.
- A listener that gives no reply fails that take instead of aborting the run.
  It did this three times running on the very short clip of و.
- `PIPELINE_VERSION` is frozen. A method change is detected from each clip's
  stored instruction, so approvals survive it.

Reviewing is in the app: a flag beside every audio button, and `/review`. It is
limited to `AUDIO_REVIEWER_EMAILS`.

**Words that cannot be said alone.** و is *va* in isolation and *o* only
between words, so the speech model is right to say *va* for «و.» and retries do
not help: six of six takes said *va*, twice over. Cutting a sentence down to the
word and its neighbours does not help either — «هویج و سیب», with and without a
full stop, was read *havij va sib* six times out of six, although the full
sentences with a verb come out *o*. So a lone word that fails its ladder is
played inside the shortest verified sentence that contains it (an approved one
first), using that sentence's stored audio; the clip records which in `carrier`.

After this, the Shopping theme stands at 114 of 114 verified, with و played
inside *havij o nun dârim*.

### Caveats

- The review flow was exercised through the store functions (approve pins,
  reject archives and remakes), not yet by a person in the browser.
- A word's carrier audio is a copy. Remaking the sentence does not update it.
- Not built yet: an audition step that makes any new instruction, voice or
  retry rung pass a blind human rating on a fixed set of trap clips before it
  is used. It needs approved clips to compare against, which do not exist yet.
- *Later:* the flag beside every audio button and the approve/reject page were
  folded into "Something wrong?", which takes any complaint, about a recording
  or the text, and can flag it for `/review` instead of fixing it at once. A
  recording marked fine there is approved and pinned as before, and a remake
  still keeps the rejected take.

---

## 16. غ came out as Dari says it; spelling it ق for the speech model fixes that

**The problem.** The project owner rejected the clip of غذا for its accent, and
reported that it sounded like Dari [ɣɪzɑː], where Tehran has [qæzɒː]. Tehran
has one sound for ق and غ; Dari keeps a stop for ق and a gargled fricative for
غ. §7 rated this marker Iranian on every voice, but on one sentence per voice.

**The speech model keeps the two letters apart.** Measured from the waveform
(`spike/gh-onset.py`): the time from the first sound to half the vowel's
loudness. A stop is a short burst and then the vowel; the fricative is a long,
quiet, voiced lead-in. Lone words, `nova`, four takes per arm
(`npm run spike:gh`):

| Text sent | Instruction | Rise, ms |
|---|---|---|
| غذا — the stored clip and the rejected one | voice | 135, 115 |
| غذا | voice | 95, 160, 80, 100 |
| غذا | voice + the sound described | 180, 130, 115, 25 |
| غَذا, vowels written | voice | 85, 130, and two that open on a long voiced hum |
| **قذا** | voice | **25, 30, 25, 30** |
| قیمت | voice | 25, 15, 10, 20 |
| قهوه | voice | 15, 10, 20, 30 |

So غ is the fricative on nearly every take, ق is a stop on every take, and a
word spelled with ق in place of غ is read with the stop. Describing the sound
in the instruction moved one take in four and broke two of four takes of قهوه
outright (the listener got no words from them); writing the vowels did nothing.
That is §13 again: the text decides, the instruction does not.

The vowel was never the fault. Every take of غذا, however made, had the *a*.

**The listener cannot hear this either.** Asked only whether the word opened
with a stop or a fricative, `gpt-audio-1.5` got the controls right — گدا "stop"
on 36 of 36 listens, خدا "fricative" on 34 of 36 — and then called ق and غ
"fricative" alike: قیمت on 37 of 39 listens, قذا on 12 of 12. It cannot be the
check for this, so nothing automated is.

**Decision.** `spokenText` (`src/lib/audio-key.ts`) gives the speech model ق
wherever the text has غ, for stored clips and for the tutor's live speech. What
is shown, and the hash a clip is known by, do not change, so approvals survive.
Each clip records the spelling its audio was made from (`AudioClip.spoken`), and
one made from another spelling is stale, exactly as one made with a retired
instruction is: `npm run db:audio` remakes it, and a remake still has to pass
the listener, which is what would catch a respelling read as another word
(مرغ becomes مرق, "broth", *maragh*).

All 11 clips with غ were remade and verified. The new clip of غذا rises in
10 ms, against 135 ms for the one it replaced.

### Caveats

- No person has heard the remade clips yet. The waveform says "stop"; only an
  ear says "Tehrani".
- The measure was taken on lone words that begin with the sound. Inside and at
  the end of a word (داغ، مرغ) the remade clips were not measured, and Tehran
  softens the sound between vowels where the respelling may not.
- The listener sometimes writes a final ق as *g* (*morg*, *dâge*) and fails the
  take, so these clips take more attempts. Two sentences needed three runs.
- The measure is not in the pipeline. A new clip is still verified for its
  words only.
