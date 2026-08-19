"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import {
  QUIET_PEAK,
  SILENCE_PEAK,
  TARGET_RATE,
  dbfs,
  encodeWav,
  isLowQualityInput,
  linearResample,
  micConstraints,
  normalize,
  peakOf,
} from "@/lib/audio";

export type RecorderStatus = "idle" | "starting" | "recording" | "processing" | "error";

export type Capture = {
  wav: Blob;
  durationSec: number;
  /** Level before normalisation — what the microphone actually delivered. */
  inputDbfs: number;
  gainDb: number;
  warning?: string;
};

/**
 * Microphone capture.
 *
 * Ported from the Phase 0 recorder rather than rewritten. Three rules here are
 * load-bearing and none are obvious:
 *
 *  1. Never force the AudioContext sample rate. `new AudioContext({ sampleRate:
 *     16000 })` fed by a 48 kHz mic makes createMediaStreamSource emit pure
 *     silence on macOS Chrome, with correct buffer counts, so the output looks
 *     valid. Capture native, resample afterwards.
 *
 *  2. No MediaRecorder. In Firefox, handing a stream to MediaRecorder while the
 *     same stream feeds a MediaStreamAudioSourceNode yields a silent recording
 *     even though the audio graph works — a live level meter and empty files.
 *     Capturing from the graph makes the meter and the recording the same
 *     signal, so a moving bar proves samples are arriving.
 *
 *  3. One getUserMedia, shared. A second capture of an already-open input
 *     returns silence on macOS.
 */
export function useRecorder() {
  const [status, setStatus] = useState<RecorderStatus>("idle");
  const [level, setLevel] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [inputLabel, setInputLabel] = useState<string | null>(null);

  const streamRef = useRef<MediaStream | null>(null);
  const contextRef = useRef<AudioContext | null>(null);
  const chunksRef = useRef<Float32Array[] | null>(null);
  const captureRateRef = useRef(TARGET_RATE);
  const frameRef = useRef<number | null>(null);

  const teardown = useCallback(() => {
    if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
    frameRef.current = null;
    chunksRef.current = null;
    contextRef.current?.close().catch(() => {});
    contextRef.current = null;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setLevel(0);
  }, []);

  useEffect(() => teardown, [teardown]);

  const start = useCallback(async () => {
    setError(null);
    setStatus("starting");
    try {
      const stream = await navigator.mediaDevices.getUserMedia(micConstraints());
      streamRef.current = stream;

      const track = stream.getAudioTracks()[0];
      const settings = track.getSettings?.() ?? {};
      setInputLabel(track.label || "default input");
      if (isLowQualityInput(track.label ?? "", settings.sampleRate)) {
        setError(
          `${track.label} looks like a Bluetooth/HFP input — transcription accuracy will ` +
            `reflect the microphone rather than the recogniser. Switch to a built-in mic.`,
        );
      }

      const context = new AudioContext(); // native rate — never forced
      contextRef.current = context;
      await context.resume();
      captureRateRef.current = context.sampleRate;

      const source = context.createMediaStreamSource(stream);
      const analyser = context.createAnalyser();
      analyser.fftSize = 1024;
      source.connect(analyser);

      const processor = context.createScriptProcessor(4096, 1, 1);
      chunksRef.current = [];
      processor.onaudioprocess = (event) => {
        chunksRef.current?.push(new Float32Array(event.inputBuffer.getChannelData(0)));
      };
      source.connect(processor);

      // A ScriptProcessorNode only runs while connected to the destination, but
      // routing a microphone to the speakers would feed back — so it goes
      // through a silent gain node.
      const mute = context.createGain();
      mute.gain.value = 0;
      processor.connect(mute);
      mute.connect(context.destination);

      const data = new Uint8Array(analyser.fftSize);
      const tick = () => {
        analyser.getByteTimeDomainData(data);
        let peak = 0;
        for (const v of data) peak = Math.max(peak, Math.abs(v - 128));
        // dBFS, not linear: on a linear meter a -20 dBFS signal still paints a
        // healthy bar, which is how a 15-20 dB level problem stayed invisible.
        const amplitude = peak / 128;
        const db = amplitude > 0 ? 20 * Math.log10(amplitude) : -100;
        setLevel(Math.max(0, Math.min(1, (db + 50) / 50)));
        frameRef.current = requestAnimationFrame(tick);
      };
      frameRef.current = requestAnimationFrame(tick);

      setStatus("recording");
    } catch (err) {
      teardown();
      setStatus("error");
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [teardown]);

  const stop = useCallback(async (): Promise<Capture | null> => {
    if (status !== "recording") return null;
    setStatus("processing");

    const chunks = chunksRef.current ?? [];
    const captureRate = captureRateRef.current;
    const total = chunks.reduce((n, c) => n + c.length, 0);
    const raw = new Float32Array(total);
    let at = 0;
    for (const chunk of chunks) {
      raw.set(chunk, at);
      at += chunk.length;
    }
    teardown();

    if (total === 0) {
      setStatus("error");
      setError("no audio captured");
      return null;
    }

    const resampled = await resampleTo16k(raw, captureRate);
    const inputPeak = peakOf(resampled);
    if (inputPeak < SILENCE_PEAK) {
      setStatus("error");
      setError("silence — check the microphone input device");
      return null;
    }

    const { samples, gain } = normalize(resampled);
    setStatus("idle");
    return {
      wav: new Blob([encodeWav(samples, TARGET_RATE) as BlobPart], { type: "audio/wav" }),
      durationSec: samples.length / TARGET_RATE,
      inputDbfs: dbfs(inputPeak),
      gainDb: 20 * Math.log10(gain),
      warning:
        inputPeak < QUIET_PEAK ? "input was very quiet — move closer to the mic" : undefined,
    };
  }, [status, teardown]);

  return { status, level, error, inputLabel, start, stop };
}

/** OfflineAudioContext interpolates properly; the pure fallback does not. */
async function resampleTo16k(samples: Float32Array, fromRate: number): Promise<Float32Array> {
  if (fromRate === TARGET_RATE) return samples;
  const frames = Math.ceil((samples.length * TARGET_RATE) / fromRate);
  try {
    const offline = new OfflineAudioContext(1, frames, TARGET_RATE);
    const buffer = offline.createBuffer(1, samples.length, fromRate);
    // Copied into a fresh view: copyToChannel requires an ArrayBuffer-backed
    // Float32Array, and the concatenated capture buffer is typed as ArrayBufferLike.
    buffer.copyToChannel(new Float32Array(samples), 0);
    const source = offline.createBufferSource();
    source.buffer = buffer;
    source.connect(offline.destination);
    source.start();
    return (await offline.startRendering()).getChannelData(0);
  } catch {
    // Some browsers reject unusual OfflineAudioContext rates.
    return linearResample(samples, fromRate, TARGET_RATE);
  }
}
