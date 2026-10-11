"use client";

import { useCallback, useRef, useState } from "react";

import { useRecorder } from "@/components/useRecorder";
import { createAudioQueue } from "@/lib/audio-queue";
import { extractChunks } from "@/lib/clauses";
import { createPcmPlayer } from "@/lib/pcm";
import { LUNCH_SCENARIO } from "@/lib/prompt";
import { TRANSCRIPT_MESSAGE } from "@/lib/transcript";
import { createTurnTimer, formatMs, type TurnSummary } from "@/lib/timings";

type Message = { role: "user" | "assistant"; content: string };
type Mode = "streaming" | "baseline";

const VERDICT_STYLE: Record<TurnSummary["verdict"], string> = {
  good: "text-emerald-600 dark:text-emerald-400",
  usable: "text-amber-600 dark:text-amber-400",
  poor: "text-red-600 dark:text-red-400",
};

const VERDICT_LABEL: Record<TurnSummary["verdict"], string> = {
  good: "feels conversational",
  usable: "usable, noticeably laggy",
  poor: "too slow — walkie-talkie",
};

/**
 * Safari refuses audio that was not started by a user gesture, and streamed
 * clips play well after the click that began the turn. Priming an
 * AudioContext inside the gesture keeps later playback allowed.
 */
let audioUnlocked = false;
function unlockAudio() {
  if (audioUnlocked) return;
  audioUnlocked = true;
  try {
    const context = new AudioContext();
    void context.resume().then(() => context.close());
  } catch {
    // Nothing to do — playback will still work everywhere except iOS Safari.
  }
}

async function requestSpeech(text: string, format: "mp3" | "pcm"): Promise<Response> {
  const response = await fetch("/api/tts", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text, format }),
  });
  if (!response.ok) {
    throw new Error(((await response.json()) as { error?: string }).error ?? "tts failed");
  }
  return response;
}

export default function Page() {
  const { status, level, error: micError, inputLabel, start, stop } = useRecorder();
  const [messages, setMessages] = useState<Message[]>([]);
  const [timings, setTimings] = useState<TurnSummary | null>(null);
  const [lastMode, setLastMode] = useState<Mode | null>(null);
  // Baseline by default. Streaming measured 1084ms faster to first audio, but a
  // learner testing it reported the clause-by-clause playback stuttered and
  // preferred waiting — and judged the baseline latency acceptable. A measured
  // win that degrades the experience is not a win. Kept behind the toggle
  // because it may matter again for longer replies.
  const [mode, setMode] = useState<Mode>("baseline");
  const [busy, setBusy] = useState(false);
  const [turnError, setTurnError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const historyRef = useRef<Message[]>([]);

  const runTurn = useCallback(async () => {
    const capture = await stop();
    if (!capture) return;

    setBusy(true);
    setTurnError(null);
    setNotice(
      capture.warning ??
        `input ${capture.inputDbfs.toFixed(0)} dBFS` +
          (capture.gainDb > 0.5 ? ` (boosted ${capture.gainDb.toFixed(0)} dB)` : ""),
    );

    const timer = createTurnTimer();
    timer.mark("speechEnd");

    try {
      const sttResponse = await fetch("/api/stt", {
        method: "POST",
        headers: { "Content-Type": "audio/wav" },
        body: capture.wav,
      });
      timer.mark("uploaded");
      if (!sttResponse.ok) {
        throw new Error(((await sttResponse.json()) as { error?: string }).error ?? "stt failed");
      }
      const { text, usable, verdict } = (await sttResponse.json()) as {
        text: string;
        usable: boolean;
        verdict: keyof typeof TRANSCRIPT_MESSAGE | "ok";
      };
      timer.mark("transcribed");

      // A transcript that failed is never added to the history and never shown
      // to the model. Given nonsense in a Persian conversation it will pattern
      // match something plausible and answer it, which teaches the learner they
      // were understood when they were not.
      const failed = !usable && verdict !== "ok";
      if (failed) {
        setNotice(
          `${TRANSCRIPT_MESSAGE[verdict]}${text.trim() ? ` (heard: “${text.trim()}”)` : ""}`,
        );
      }

      const withUser: Message[] = failed
        ? historyRef.current
        : [...historyRef.current, { role: "user", content: text }];
      if (!failed) {
        historyRef.current = withUser;
        setMessages(withUser);
      }

      const reply =
        mode === "streaming"
          ? await streamedTurn(withUser, timer, setMessages, failed)
          : await baselineTurn(withUser, timer, setMessages, failed);

      historyRef.current = [...withUser, { role: "assistant", content: reply }];
      setLastMode(mode);
      setTimings(timer.summary());
    } catch (err) {
      setTurnError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }, [mode, stop]);

  const recording = status === "recording";
  const disabled = busy || status === "starting" || status === "processing";

  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col gap-6 px-5 py-10">
      <header>
        <h1 className="text-2xl font-semibold">{LUNCH_SCENARIO.title}</h1>
        <p className="mt-1 text-sm opacity-70">{LUNCH_SCENARIO.goal}</p>
      </header>

      <section className="flex flex-col gap-3 rounded-xl border border-black/10 p-4 dark:border-white/15">
        <div className="flex flex-wrap items-center gap-3">
          <button
            onClick={() => {
              unlockAudio();
              return recording ? runTurn() : start();
            }}
            disabled={disabled}
            className={`rounded-lg px-5 py-2.5 font-medium transition disabled:opacity-40 ${
              recording ? "bg-red-600 text-white" : "border border-black/20 dark:border-white/25"
            }`}
          >
            {recording ? "Stop and send" : busy ? "Thinking…" : "Hold to talk"}
          </button>

          <div className="h-2 w-40 overflow-hidden rounded-full bg-black/10 dark:bg-white/15">
            <div
              className="h-full bg-emerald-500 transition-[width] duration-75"
              style={{ width: `${Math.round(level * 100)}%` }}
            />
          </div>

          <label className="ml-auto flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={mode === "streaming"}
              onChange={(e) => setMode(e.target.checked ? "streaming" : "baseline")}
              disabled={disabled}
            />
            streaming
          </label>
        </div>

        <p className="text-xs opacity-55">
          {inputLabel ?? "microphone not started"} ·{" "}
          {mode === "streaming"
            ? "speaks each clause as it is written — faster, but can stutter"
            : "waits for the whole reply — smoother"}
        </p>

        {notice && <p className="text-xs opacity-60">{notice}</p>}
        {micError && <p className="text-sm text-red-600 dark:text-red-400">{micError}</p>}
        {turnError && <p className="text-sm text-red-600 dark:text-red-400">{turnError}</p>}
      </section>

      <section className="flex flex-col gap-3">
        {messages.length === 0 && (
          <p className="rounded-xl border border-dashed border-black/15 p-6 text-center text-sm opacity-60 dark:border-white/20">
            Press record and order some lunch.
          </p>
        )}

        {messages.map((message, i) => (
          <article
            key={i}
            className={`max-w-[85%] rounded-xl px-4 py-3 ${
              message.role === "user"
                ? "self-end bg-black/[0.06] dark:bg-white/10"
                : "self-start border border-black/10 dark:border-white/15"
            }`}
          >
            <p className="mb-1 text-[0.65rem] uppercase tracking-wider opacity-50">
              {message.role === "user" ? "you" : "waiter"}
            </p>
            <p dir="rtl" lang="fa" className="text-xl leading-relaxed">
              {message.content}
            </p>
          </article>
        ))}
      </section>

      {timings && (
        <section className="rounded-xl border border-black/10 p-4 text-sm dark:border-white/15">
          <div className="flex items-baseline justify-between gap-3">
            <h2 className="font-medium">
              Last turn <span className="opacity-50">({lastMode})</span>
            </h2>
            <span className={`font-semibold tabular-nums ${VERDICT_STYLE[timings.verdict]}`}>
              {formatMs(timings.totalMs)} — {VERDICT_LABEL[timings.verdict]}
            </span>
          </div>
          <table className="mt-3 w-full">
            <tbody>
              {timings.spans.map((span) => (
                <tr key={span.label} className="border-t border-black/10 dark:border-white/10">
                  <td className="py-1.5 opacity-70">{span.label}</td>
                  <td className="py-1.5 text-right tabular-nums">{formatMs(span.ms)}</td>
                  <td className="w-1/2 py-1.5 pl-3">
                    <div className="h-1.5 rounded-full bg-black/10 dark:bg-white/15">
                      <div
                        className="h-full rounded-full bg-current opacity-50"
                        style={{ width: `${(span.ms / timings.totalMs) * 100}%` }}
                      />
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-3 text-xs opacity-55">
            End of speech to first audio. Under 1.5s feels conversational, 1.5–3s is usable,
            over 3s is a walkie-talkie. Toggle streaming off to compare against the M1 baseline.
          </p>
        </section>
      )}
    </main>
  );
}

/** M1 path: wait for the whole reply, then synthesise all of it. */
async function baselineTurn(
  history: Message[],
  timer: ReturnType<typeof createTurnTimer>,
  setMessages: (messages: Message[]) => void,
  unintelligible = false,
): Promise<string> {
  const response = await fetch("/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ history, unintelligible }),
  });
  if (!response.ok) throw new Error(((await response.json()) as { error?: string }).error ?? "chat failed");
  const { reply } = (await response.json()) as { reply: string };
  timer.mark("replied");
  setMessages([...history, { role: "assistant", content: reply }]);

  const blob = await (await requestSpeech(reply, "mp3")).blob();
  timer.mark("audioReady");

  const audio = new Audio(URL.createObjectURL(blob));
  await audio.play();
  timer.mark("playbackStart");
  await new Promise<void>((resolve) => {
    audio.onended = () => resolve();
    audio.onerror = () => resolve();
  });
  return reply;
}

/**
 * M2 path: synthesise each clause as soon as it is written.
 *
 * Requests overlap, so clips can finish out of order — the queue plays them by
 * position and reports when sound actually reaches the speakers.
 */
async function streamedTurn(
  history: Message[],
  timer: ReturnType<typeof createTurnTimer>,
  setMessages: (messages: Message[]) => void,
  unintelligible = false,
): Promise<string> {
  const response = await fetch("/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ history, stream: true, unintelligible }),
  });
  if (!response.ok || !response.body) throw new Error("chat stream failed");

  // Progressive playback: audio is scheduled as bytes arrive rather than after
  // a complete clip exists, which spike/tts-latency.ts measured as worth ~689ms
  // per clause. The queue keeps clauses in order even though their requests
  // overlap and can respond out of order.
  const player = createPcmPlayer({ onFirstSound: () => timer.mark("playbackStart") });
  const queue = createAudioQueue<Response>({}, (response) => player.play(response));
  let firstAudio = false;

  const speak = (text: string) => {
    queue.push(
      requestSpeech(text, "pcm").then((response) => {
        if (!firstAudio) {
          firstAudio = true;
          timer.mark("audioReady");
        }
        return response;
      }),
    );
  };

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let pending = "";
  let full = "";

  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    const text = decoder.decode(value, { stream: true });
    full += text;
    pending += text;
    setMessages([...history, { role: "assistant", content: full }]);

    const { chunks, rest } = extractChunks(pending);
    pending = rest;
    for (const chunk of chunks) {
      // "replied" marks the first speakable clause, not the whole reply — that
      // is precisely the wait streaming removes.
      timer.mark("replied");
      speak(chunk);
    }
  }

  for (const chunk of extractChunks(pending, { final: true }).chunks) {
    timer.mark("replied");
    speak(chunk);
  }

  await queue.drain();
  await player.finished();
  player.close();
  return full;
}
