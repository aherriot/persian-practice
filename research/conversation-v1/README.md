# conversation-v1 (parked)

The first teaching approach: a free, topic-driven spoken conversation with an
LLM tutor, with vocabulary woven in opportunistically, plus an adaptive
placement test and a flashcard review screen. Parked on 2026-10-11 when the app
was redesigned around a deterministic lesson engine (one new word at a time,
exercises, spaced repetition).

Kept for reference, not deleted, because parts of it will be useful again —
most likely when free conversation returns as a capstone mode.

**This code is frozen and not compiled.** It is excluded from `tsconfig.json`
and ESLint, its tests are not run by `npm test`, and its `@/…` imports point at
modules that have since moved or will change. The last commit where it ran in
place is `bebf2ec`; check that out to see it working.

## What is here

Paths mirror where each file lived under the repo root.

| Path | What it was |
| --- | --- |
| `src/app/page.tsx` | Phase 1 prototype: hold-to-talk lunch-order roleplay with per-turn latency timings |
| `src/app/conversation/` | Conversation screen: tap-to-define, repeat audio, bidi input |
| `src/app/placement/`, `src/lib/placement.ts` | Adaptive binary-search placement test |
| `src/app/review/` | SM-2 flashcard review screen |
| `src/app/dashboard/` | Old dashboard, topic picker, past-conversations list |
| `src/app/api/` | Routes for chat, conversations/turns, define, placement, review, topics, vocab flag |
| `src/lib/conversation.ts` | Scenario generation and per-turn item selection (due vs new) |
| `src/lib/prompt.ts` | Tutor system prompt, colloquial-register rules, structured output shape |
| `src/lib/clauses.ts`, `audio-queue.ts`, `pcm.ts` | Clause-by-clause streaming TTS playback |
| `src/lib/timings.ts` | Turn latency measurement and verdicts |
| `src/lib/seed-data.ts`, `seed-items.ts` | The tiered starter item bank and its seed script (was `src/lib/db/` and `scripts/`) |

## Still live elsewhere

- `src/lib/prompt.ts` here is still imported by `spike/chat-bench.ts` and
  `spike/conversation-probe.ts`, so those experiments stay runnable. It has no
  imports of its own.
- `src/lib/srs.ts`, `register.ts`, `transcript.ts`, the TTS/STT providers and
  routes, auth, and the design system stayed in `src/`.
- The database tables this code used (`Conversation`, `Turn`, `Correction`,
  `Topic`, `PlacementSession`, `PlacementResponse`) are still in
  `src/lib/db/schema.ts` until the new schema replaces them.

## Worth remembering

- Streaming playback was ~1s faster to first audio, but clause-by-clause speech
  stuttered and the learner preferred waiting for the whole reply.
- A failed transcript must never reach the model: it will answer nonsense
  plausibly and teach the learner they were understood.
- New vocabulary needed a numeric edge over due reviews in the prompt or the
  model never introduced it.
- The plan this implemented is `docs/PHASE-1.md`.
