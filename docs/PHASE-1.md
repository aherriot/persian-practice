# Phase 1 — the conversation loop

Build the smallest thing that can hold a spoken Persian conversation, instrument
it, and find out whether it is worth building the rest around.

Phase 0 answered *can the machine speak and hear Persian well enough*. Phase 1
asks *does talking to it feel like a conversation, and does it teach*. Every
decision below that could have been a guess is instead settled by a Phase 0
measurement — those are cited inline as §n, referring to
[`spike/FINDINGS.md`](../spike/FINDINGS.md).

---

## What Phase 1 is not

No database. No accounts. No learner model, curriculum, spaced repetition,
progress tracking, or gamification. One hard-coded scenario. No pronunciation
scoring — §4 established there is no phoneme-level access for Persian, and a
transcript cannot reveal which phoneme was wrong.

The temptation will be to start on the schema from the original brief. Resist it
until M5, because §9 already changed what the `mistakes` table can contain and
M3–M4 will change more.

---

## Settled inputs — do not re-litigate these

| Decision | Choice | Evidence |
|---|---|---|
| TTS | `gpt-4o-mini-tts`, voice **`nova`** | §7 — native speaker rated all voices Iranian; the Afghan-accent report did not reproduce. `nova` reads colloquial spellings naturally; bare `alloy` does not. |
| STT | `gpt-4o-transcribe` **with the verbatim prompt** | §9 — 4% WER vs 44% unprompted, 33% Azure. |
| Provider | OpenAI throughout | Azure lost on every axis that differed. |
| Register | Colloquial spoken Tehrani | User decision, validated by §7 — register is driven by the *text*, not the voice. |
| Numerals (Azure) | `<say-as interpret-as="cardinal">` | §3. Retained in `tts-provider.ts` for the Azure path only. |

Azure code paths stay in the repo. They cost nothing, they are what made the
comparison cheap, and they are the fallback if OpenAI's Persian regresses.

---

## Milestones

### M0 — The control experiment (no code)

Spend 20 minutes speaking Persian to ChatGPT's voice mode.

This is free, needs no keys, and is the only remaining experiment that can still
invalidate the plan. If it already feels good, the differentiator is not the
conversation loop — it is the persistent learner model and post-conversation
analysis, and M1–M4 should be reordered behind Phase 2.

**Exit:** a written answer to "what does my app do that this does not?"

---

### M1 — Skeleton loop, non-streaming

One turn, end to end: hold to talk → transcript → Persian reply → audio.

**Build**

- `components/useRecorder.ts` — ported from `public/record.html`, not rewritten.
  See *Browser audio* below; that file is the output of three separate bugs and
  the fixes are non-obvious.
- `app/api/stt/route.ts` — audio → transcript. `runtime = "nodejs"`.
- `app/api/chat/route.ts` — transcript → Persian reply.
- `app/api/tts/route.ts` — text → audio, `nova`.
- `lib/prompt.ts` — see *Prompts* below.
- `lib/timings.ts` — per-stage stopwatch.
- `app/page.tsx` — `'use client'`, hold-to-talk, RTL transcript, live timings.

**Measure** — end-of-speech → first audio out, broken down by stage. Commit to
the thresholds before running it, so the result is falsifiable:

| | |
|---|---|
| under 1.5s | feels conversational |
| 1.5 – 3s | usable, noticeably laggy |
| over 3s | walkie-talkie; the premise is in trouble |

**Exit:** five spoken turns completed, with a logged latency breakdown.

---

### M2 — Streaming

Fire TTS on the first complete clause of the LLM stream rather than waiting for
the whole reply. Stream audio to the client as it renders.

Build the naive version in M1 first on purpose: the size of this win is worth
knowing, and it tells you whether further latency work has any headroom.

**Exit:** the same latency table as M1, with the delta.

---

### M3 — Does it actually teach?

The pedagogical behaviours from the brief, tested against a real conversation
rather than assumed.

- **Register drift.** Does the tutor still say خونه on turn 20, or has it slid
  back to خانه? LLMs default to literary Persian; §7 showed register comes from
  the generated text, so this is entirely a prompting problem and entirely
  measurable.
- **Recast, don't correct.** Learner says `دیروز بازار می‌رم`; tutor should reply
  `آها، دیروز رفتی بازار! چی خریدی؟` and keep going, not stop to teach.
- **Code-switching.** What happens when the learner drops into English
  mid-sentence? `language: "fa"` is forced on the STT call — decide the behaviour
  deliberately rather than discovering it.
- **Difficulty.** Does asking "slower please" / "what does that mean?" work?

**Exit:** a 20-turn transcript reviewed with the native speaker, with drift and
recast behaviour marked.

---

### M4 — Pronunciation correctness in generated speech

§8 is the one Phase 0 problem left open. Per-word instructions fix homographs
(§6, 5/6) but only when the ambiguous word and intended reading are known
*before* synthesis. In free conversation nothing tells the TTS layer that `مرد`
means "died" this time.

**The chat model is the only component that knows what it meant.** So have it
say so, in the same response:

```jsonc
{
  "text": "پدربزرگم پارسال مرد",
  "pronunciation": [
    { "word": "مرد", "say": "mord", "means": "died" }
  ]
}
```

`/api/tts` composes those into the `instructions` field. One extra field, no
separate disambiguation pass.

**Two things to verify here**

- Does the LLM reliably notice its own ambiguous words? This is the risk — it may
  over-flag, under-flag, or flag wrongly.
- **Does OpenAI have the digit-doubling bug?** Untested. §3 was Azure-specific
  and `toSsmlWithCardinals` does not apply to OpenAI. Run `ساعت ۸ صبح` through
  `nova` before assuming it is fine.

**Do not use contrastive instructions.** §6 measured "do NOT pronounce it Z" as
*worse* than simply naming the right reading — 3/6 against 5/6. Naming the wrong
form appears to prime the model toward it.

**Exit:** the homograph battery re-run through the generated-instruction path,
scored against §6's 5/6 baseline.

---

### M5 — Decision

Answer, with evidence rather than impressions:

1. Is the latency tolerable?
2. Does STT understand your accented Persian in the wild? (§9 says 4% WER on
   read sentences; spontaneous speech will be worse.)
3. Did the tutor stay colloquial?
4. Did recast-don't-correct hold?
5. Is this better than M0?

If yes: Phase 2 is the learner model and post-conversation analysis, and the
schema from the original brief gets designed *then*, informed by what M3 and M4
showed about which errors are actually detectable.

---

## Browser audio — the expensive lessons

`public/record.html` works. Port it; do not reimplement it. Every rule below cost
a debugging cycle.

**Never force the AudioContext sample rate.** `new AudioContext({ sampleRate:
16000 })` fed by a 48 kHz microphone makes `createMediaStreamSource` emit *pure
silence* on macOS Chrome — with correct buffer counts, so the files look valid.
Capture at the device's native rate; resample afterwards with
`OfflineAudioContext`.

**Do not use `MediaRecorder` alongside a `MediaStreamAudioSourceNode` on the same
stream.** In Firefox the recorder gets silence while the Web Audio graph works,
which presents as a live level meter and empty files. Capture from the audio
graph itself, so the meter and the recording are provably the same signal.

**One `getUserMedia`, shared.** A second capture of an already-open input returns
a silent stream on macOS. Mic test and recording share one stream and one meter.

**Turn off the call DSP.** `echoCancellation` and `noiseSuppression` are tuned
for telephony: they gate quiet speech and cost ~15–20 dB, which would be scored
as recogniser error. Keep `autoGainControl` on.

```ts
audio: {
  channelCount: 1,
  echoCancellation: false,
  noiseSuppression: false,
  autoGainControl: true,
}
```

**Normalize before sending.** A laptop mic at conversational distance lands near
−20 dBFS. Scale peak to ~0.7.

**Reject silence rather than sending it.** Peak below ~0.005 means something is
wrong; fail loudly instead of billing an API call to transcribe nothing.

**Meter in dBFS, not linear.** On a linear meter a −20 dBFS signal still paints a
healthy bar, which is exactly how a 15–20 dB level problem stayed invisible.

**Offer a device picker, and flag Bluetooth.** An active Bluetooth mic switches
the device to HFP — 8–16 kHz mono — which inflates WER and makes you blame the
recogniser for the headset. Detect by label or by `sampleRate < 24000`.

**iOS Safari:** unlock an `AudioContext` on the first user gesture or TTS will
silently never play.

---

## Prompts

### System prompt — colloquial register

LLMs write literary Persian unprompted, and nobody speaks that way. Name the
forms explicitly rather than asking for "casual Persian":

| use | not |
|---|---|
| خونه | خانه |
| می‌رم | می‌روم |
| نون | نان |
| چیکار | چه کار |
| ـه (enclitic) | است |
| می‌خوام | می‌خواهم |

Include worked examples in the prompt. Re-check at turn 20, not turn 2 — drift is
the failure mode.

### System prompt — pedagogy

Model the correct form by recasting, and keep the conversation moving. Do not
stop to explain unless asked. Corrections belong to post-conversation analysis
(Phase 2), not the conversation itself.

### STT prompt — mandatory

```
Transcribe exactly what the speaker says, word for word.
The speaker is learning Persian and will make grammatical mistakes.
Preserve their mistakes verbatim. Do not correct grammar, tense, or word order.
```

Without this, `gpt-4o-transcribe` falls out of Persian entirely and returns
romanized or hallucinated Latin text *despite* `language: "fa"` being set — §9
measured `michel dotrice war am theater bekannt` for
`می‌شه لطفاً آروم‌تر صحبت کنید؟`. It is an 11× WER difference from one field.

### TTS instructions — per word, never contrastive

```
The word "مرد" here means "died" and must be pronounced "mord".
```

Not `Do NOT pronounce it "mard"` — §6 measured that as actively worse.

---

## Known ceilings

Things Phase 1 cannot fix, worth stating so nobody spends a week on them.

- **Ezafe errors are invisible in text** (§9). A missing ezafe is audible but
  leaves no written trace, so no transcript-based system can detect it, at any
  accuracy.
- **Some homographs resist instruction.** `shosh` (lung) failed every strategy in
  §6. A short exception list of recorded audio is the only fix.
- **Word-level tracking is noisier than grammar-level.** Both surviving STT arms
  mangled individual words while keeping grammar intact — نیوز for دیروز, ما for
  من. This is directly relevant to the `user_vocabulary` mastery table in the
  original brief.
- **Small samples.** §6 rests on 6 words, §9 on 4 judgeable clips. Both should be
  widened before the learner model is built on them.

---

## Verification

```bash
npm run typecheck && npm test && npm run lint
npm run dev          # then hold to talk
```

Phase 1 is done when M5's five questions have logged answers rather than
impressions, and `spike/FINDINGS.md` has a Phase 1 section written the same way.
