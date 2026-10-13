# Persian Practice

A tutor for spoken Persian — the colloquial Tehrani people actually say, not the
literary form they write. Short lessons introduce one word or piece of grammar at
a time, inside sentences made only of what you already know, and bring each one
back on a spaced schedule. Every sentence is spoken aloud.

The interesting part is not the app. It is that spoken Persian breaks most of the
assumptions a voice pipeline is built on, and almost none of those breakages are
visible until you measure them. This repository is the record of that
measurement, and the app built on what it found.

---

## Why Persian is hard for a voice pipeline

**The writing system omits short vowels.** `کرم` is _kerm_ (worm), _kerem_
(cream), or _karam_ (generosity) — identical letters, and the reader is expected
to infer the vowels from context. Text-to-speech has to make the same inference,
and one engine tested here never did: given fifteen ambiguous words in
disambiguating sentences, it read the frequency-default **every single time**,
including reading `مرد` as _mard_ (man) in a sentence that plainly meant _mord_
(died). Past-tense verbs are core beginner grammar, not an edge case.

**Speech recognition is trained to be helpful, which is the opposite of what a
tutor needs.** A learner saying `من دیروز بازار می‌رم` — present tense where past
is required — is producing exactly the signal the teaching engine exists to
detect. A recogniser that quietly returns the grammatical form has erased the
evidence before any teaching logic sees it. One provider tested here _inserted_ a
copula the speaker had deliberately omitted.

**The written language and the spoken language differ.** Iranians write `خانه`
and say _khune_; write `نان` and say _nun_. A tutor that speaks correct literary
Persian teaches something nobody says out loud.

**Two varieties, one script.** Iranian Persian merged the consonants `ق` and `غ`;
Afghan Dari keeps them apart. Iranian has _v_ where Dari has _w_, and lost the
classical `ē`/`ō` vowels Dari preserves. A non-native ear cannot tell them apart —
both sound like fluent Persian — so "does this voice sound right?" is not a
question the person building the app can answer.

---

## How decisions get made here

Every technical choice in this repository is attached to a measurement, and the
negative results are written down as carefully as the positive ones. The pattern
is consistent: state the question, design something that can answer it, run it,
and let the result overturn the plan when it wants to.

That has already happened twice.

**A claim was refuted.** OpenAI's Persian voices are widely reported to carry an
Afghan accent, and the initial vendor choice was made on that basis. A blind
test — nine sentences, each targeting one phonological feature that separates
Iranian from Dari, four voices, shuffled per sentence, rated by a native
speaker — returned **Iranian on every marker for every voice**. The claim did not
reproduce, the advantage was imaginary, and the vendor decision reversed.

**An instinct was measured and found harmful.** Telling the speech model "this
word means _worm_, pronounce it _kerm_" fixed 5 of 6 homographs. Adding the
seemingly-stronger "…and do NOT pronounce it _kerem_" dropped it to 3 of 6,
breaking two words the simpler instruction got right. Naming the wrong form
appears to prime the model toward it.

Findings live in [`spike/FINDINGS.md`](spike/FINDINGS.md), with the experiments
that produced them in [`spike/`](spike/).

---

## What has been established

|                    |                                                                        |
| ------------------ | ---------------------------------------------------------------------- |
| **Text-to-speech** | `gpt-4o-mini-tts`, voice `nova`                                        |
| **Speech-to-text** | `gpt-4o-transcribe`, verbatim prompt mandatory                         |
| **Register**       | Colloquial Tehrani, driven by the generated text rather than the voice |
| **Lesson audio**   | Made ahead of time, checked by an automated listener, open to review   |

Three results worth stating on their own:

**One prompt field is worth an 11× accuracy difference.** Unprompted,
`gpt-4o-transcribe` falls out of Persian entirely and returns romanised or
hallucinated Latin text — `michel dotrice war am theater bekannt` for
`می‌شه لطفاً آروم‌تر صحبت کنید؟` — _despite_ `language: "fa"` being set
explicitly. With a verbatim-transcription prompt, the same audio returns correct
Persian: **44% word error rate → 4%**.

**Context-blindness is a property of the engine, not the vendor.** On the
homograph battery one engine scored 0/15 on the readings that require context,
and 15/15 on the frequency-defaults — a perfectly clean split. The other reads
for meaning and scored 5/6 on the same problem. That gap decided the stack.

**Some things cannot be fixed at any accuracy.** A missing _ezafe_ is audible but
leaves no trace in written Persian, so no transcript-based system can ever detect
it. That bounds what the teaching engine can claim, and it is recorded as a
ceiling rather than a bug.

---

## Architecture

Next.js (App Router) and TypeScript, one process. Route handlers keep API keys
server-side; there is no separate backend. Postgres (Neon) through Drizzle,
Auth.js magic-link sign-in, and a private Vercel Blob store for audio.

```
src/app/
  dashboard/  learn/[themeId]/  practice/    themes, a themed session, practise everything
  progress/   reference/        review/      where you stand, the dictionary, audio review
  api/                                       answers, audio, own words, speech
src/lib/
  content/           the hand-written themes, validated before they are seeded
  lesson/            the lesson engine
    plan.ts            plans a whole session up front — pure, seeded, no I/O
    session.ts         the queries that fetch only what a plan could use
    grade.ts           what one answer does to the schedule
    variants.ts        the other word orders that are also correct
    author.ts          the LLM as content author, ahead of time only
    assemble.ts        builds a sentence from the author's draft, or rejects it
    generate.ts        more practice sentences from words already known
    expand.ts          new words and grammar once the curated course runs out
    prepare.ts         that writing as a job, one resumable step at a time
  jobs/queue.ts      the job queue: leases, retries, a worker that can be cut off
  audio-store.ts     synthesise, listen, retry; human approvals pin a clip
  audio-verify.ts    the automated listener
  tts-provider.ts    provider interface + OpenAI and Azure implementations
  stt-provider.ts    transcription arms, including the verbatim prompt
  normalize.ts       Persian Unicode folding, tokenisation, word error rate
  report-error.ts    the one place unexpected errors are reported from
spike/               the experiments, kept runnable
research/            the parked conversation tutor
docs/PHASE-1.md      the build plan for that tutor
```

**Lessons are deterministic.** A session is planned in full when the page is
requested, so nothing is generated and no model is called while a learner is
answering. New material comes off a ladder in order; a review is always set in a
sentence made entirely of words the learner has met; short-vowel marks fade from
a word once it has survived a few reviews.

**The language model writes content, never judges an answer.** When a learner
runs low on sentences or on new material, it drafts more — as word ids and form
names, never spellings. Each draft is assembled mechanically, checked by a second
call, given verified audio, and dropped if it fails any step. A learner can still
remove a generated sentence that sounds wrong.

**Writing content is a queued job, not part of a request.** Loading a session
queues the work and nudges a worker route with its own time limit. The job saves
after every step — the draft, the review, then each sentence's audio — so a worker
that is cut off loses one step and the next one carries on from there.

**No clip is trusted because a prompt asked nicely.** The speech model chooses
its own reading wherever the spelling leaves one open, and chooses differently
from call to call. Every clip is checked against the transliteration the content
already carries, retried until it passes, and can be approved or rejected by a
person, whose verdict nothing automated overrides
([`FINDINGS`](spike/FINDINGS.md) §13–15).

The provider abstraction exists from the first commit rather than "eventually,"
because voice quality was the axis most likely to force a vendor switch — and it
did. Swapping engines was a one-line change.

`normalize.ts` handles the things that silently corrupt Persian string
comparison: ZWNJ (`نیم‌فاصله`), the Arabic-versus-Persian `ی`/`ي` and `ک`/`ك`
code points, and four competing digit systems. Without it, strings a reader would
call identical compare as different.

---

## Running it

```bash
cp .env.example .env.local     # what each variable is for is explained there
npm install
npm run spike:check            # verifies credentials, diagnoses failures
npm run db:migrate             # create the tables
npm run db:seed                # load the hand-written themes
npm run db:audio               # synthesise and verify their audio
npm run dev
```

Locally no email is needed to sign in: the link is printed to the server console,
and a dev sign-in form is shown. Audio that `db:audio` has not made yet is made
on first play.

```bash
npm run db:sentences -- you@example.com     # run the sentence author once and see what it kept
npm run db:expand -- you@example.com        # dry run of what would be taught next
```

The experiments are kept runnable rather than deleted, so they can be re-run when
a model changes:

```bash
npm run spike:tts          # blind voice comparison → spike/out/compare.html
npm run spike:homograph    # short-vowel ambiguity battery
npm run spike:accent       # Iranian vs Dari discrimination test
npm run spike:instruct     # can instructions fix pronunciation?
npm run spike:stt          # transcription accuracy + error preservation
```

Each writes a self-contained HTML page with audio and a rating interface, because
the results need a native speaker and terminals cannot render Persian anyway —
most have no bidirectional text support, so right-to-left text appears reversed.

```bash
npm run typecheck && npm test && npm run lint
```

The tests need no database or API key. The ones for the session queries run
against PGlite, a Postgres in the test process, with the real migrations applied.
In a fresh checkout run `npx next typegen` first; the typecheck needs the route
types it writes. CI runs all of this, and a build, on every push.

`npm run build` migrates the database before building. That is what a deploy
wants and not what a local check wants: use `npx next build` for that.

---

## Status

Phase 0 — feasibility — is complete and passed on both gates: a voice good enough
to teach pronunciation with, and transcripts that preserve learner errors well
enough to teach from.

Phase 1 built the conversation loop and measured whether it felt like a
conversation: a free, topic-driven conversation with an LLM tutor, plus a
placement test and flashcard review. The plan is in
[`docs/PHASE-1.md`](docs/PHASE-1.md), including the browser-audio findings,
prompts, and the known ceilings. That teaching approach has been parked in
[`research/conversation-v1/`](research/conversation-v1/README.md) — frozen, not
compiled, kept for reference.

The app is now a deterministic lesson engine: themed lessons, one new word at a
time, exercises on words, sentences and grammar, spaced repetition, a progress
page, and a built-in reference a learner can add their own words to. When the
hand-written course runs out, the app writes more.

Speaking is the gap. The recorder and the transcription route from Phase 1 are
still here and measured, but no lesson exercise uses them yet: lessons are
listening, reading and building sentences from tiles.
