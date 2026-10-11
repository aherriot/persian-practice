/**
 * Per-turn latency instrumentation.
 *
 * The measured number is the deliverable of Phase 1, not the app itself, so the
 * breakdown has to be trustworthy and comparable between the non-streaming
 * baseline (M1) and the streamed version (M2).
 *
 * The headline figure is `end of speech -> first audio out`. Thresholds were
 * committed before measuring, so the result is falsifiable:
 *
 *   under 1.5s   feels conversational
 *   1.5 - 3s     usable, noticeably laggy
 *   over 3s      walkie-talkie; the premise is in trouble
 */

export const LATENCY_GOOD_MS = 1_500;
export const LATENCY_USABLE_MS = 3_000;

/** Ordered so a turn reads top to bottom in the UI. */
export const STAGES = [
  "speechEnd",
  "uploaded",
  "transcribed",
  "replied",
  "audioReady",
  "playbackStart",
] as const;

export type Stage = (typeof STAGES)[number];

export type Span = { from: Stage; to: Stage; label: string; ms: number };

export type TurnSummary = {
  /** end of speech -> first audio reaching the speakers. The headline number. */
  totalMs: number;
  verdict: "good" | "usable" | "poor";
  spans: Span[];
};

const SPAN_LABELS: { from: Stage; to: Stage; label: string }[] = [
  { from: "speechEnd", to: "uploaded", label: "upload" },
  { from: "uploaded", to: "transcribed", label: "speech-to-text" },
  { from: "transcribed", to: "replied", label: "language model" },
  { from: "replied", to: "audioReady", label: "text-to-speech" },
  { from: "audioReady", to: "playbackStart", label: "playback start" },
];

export function verdictFor(totalMs: number): TurnSummary["verdict"] {
  if (totalMs < LATENCY_GOOD_MS) return "good";
  if (totalMs <= LATENCY_USABLE_MS) return "usable";
  return "poor";
}

export type TurnTimer = {
  mark(stage: Stage): void;
  at(stage: Stage): number | undefined;
  summary(): TurnSummary | null;
};

/**
 * `now` is injectable so the summary maths can be tested without real time
 * passing. In the browser this is `performance.now`.
 */
export function createTurnTimer(now: () => number = () => performance.now()): TurnTimer {
  const marks = new Map<Stage, number>();

  return {
    mark(stage) {
      // First write wins: a stage that fires twice (a retry, a re-render)
      // must not silently shorten the measured span.
      if (!marks.has(stage)) marks.set(stage, now());
    },

    at(stage) {
      return marks.get(stage);
    },

    summary() {
      const start = marks.get("speechEnd");
      const end = marks.get("playbackStart");
      if (start === undefined || end === undefined) return null;

      const spans: Span[] = [];
      for (const { from, to, label } of SPAN_LABELS) {
        const a = marks.get(from);
        const b = marks.get(to);
        if (a !== undefined && b !== undefined) spans.push({ from, to, label, ms: b - a });
      }

      const totalMs = end - start;
      return { totalMs, verdict: verdictFor(totalMs), spans };
    },
  };
}

export function formatMs(ms: number): string {
  return ms < 1000 ? `${Math.round(ms)}ms` : `${(ms / 1000).toFixed(2)}s`;
}
