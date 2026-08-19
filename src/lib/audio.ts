/**
 * Audio primitives for microphone capture.
 *
 * Pure functions only — no DOM, no Web Audio — so the parts that are easy to get
 * subtly wrong (WAV headers, gain, resampling) can be tested in Node. The
 * browser-only graph lives in `components/useRecorder.ts`.
 *
 * See docs/PHASE-1.md "Browser audio" for why each rule here exists; every one
 * of them cost a debugging cycle during Phase 0.
 */

/** Both OpenAI and Azure accept 16 kHz mono PCM WAV unconditionally. */
export const TARGET_RATE = 16_000;

/** Below this peak a clip is certainly silence, not quiet speech. */
export const SILENCE_PEAK = 0.005;

/** Below this peak the input is real but too quiet to be worth transcribing well. */
export const QUIET_PEAK = 0.05;

export function peakOf(samples: Float32Array): number {
  let peak = 0;
  for (const s of samples) {
    const a = Math.abs(s);
    if (a > peak) peak = a;
  }
  return peak;
}

export function dbfs(amplitude: number): number {
  return amplitude > 0 ? 20 * Math.log10(amplitude) : -100;
}

/**
 * Scale so the loudest point sits near full scale.
 *
 * A laptop mic at conversational distance lands around -20 dBFS, which sounds
 * like silence on playback and gives the recogniser less to work with. Only ever
 * amplifies — a clip that is already loud is returned untouched.
 */
export function normalize(
  samples: Float32Array,
  targetPeak = 0.7,
): { samples: Float32Array; gain: number; peak: number } {
  const peak = peakOf(samples);
  if (peak <= 0) return { samples, gain: 1, peak };
  const gain = targetPeak / peak;
  if (gain <= 1) return { samples, gain: 1, peak };
  const out = new Float32Array(samples.length);
  for (let i = 0; i < samples.length; i++) out[i] = samples[i] * gain;
  return { samples: out, gain, peak };
}

/**
 * Nearest-neighbour resample. Used only as a fallback — the browser path uses
 * OfflineAudioContext, which interpolates properly. Kept here because it is pure
 * and because some browsers reject unusual OfflineAudioContext rates.
 */
export function linearResample(
  samples: Float32Array,
  fromRate: number,
  toRate: number,
): Float32Array {
  if (fromRate === toRate) return samples;
  const frames = Math.ceil((samples.length * toRate) / fromRate);
  const ratio = fromRate / toRate;
  const out = new Float32Array(frames);
  for (let i = 0; i < frames; i++) out[i] = samples[Math.floor(i * ratio)] ?? 0;
  return out;
}

function writeAscii(view: DataView, offset: number, text: string): void {
  for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i));
}

/** 16-bit mono PCM WAV bytes. */
export function encodeWav(samples: Float32Array, sampleRate: number): Uint8Array {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);

  writeAscii(view, 0, "RIFF");
  view.setUint32(4, 36 + samples.length * 2, true);
  writeAscii(view, 8, "WAVE");
  writeAscii(view, 12, "fmt ");
  view.setUint32(16, 16, true); // PCM chunk size
  view.setUint16(20, 1, true); // format: PCM
  view.setUint16(22, 1, true); // channels: mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true); // byte rate
  view.setUint16(32, 2, true); // block align
  view.setUint16(34, 16, true); // bits per sample
  writeAscii(view, 36, "data");
  view.setUint32(40, samples.length * 2, true);

  let offset = 44;
  for (const sample of samples) {
    const clamped = Math.max(-1, Math.min(1, sample));
    view.setInt16(offset, clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff, true);
    offset += 2;
  }
  return new Uint8Array(buffer);
}

/**
 * Constraints for `getUserMedia`.
 *
 * Echo cancellation and noise suppression are tuned for telephony: they gate
 * quiet speech and measured ~15-20 dB of attenuation, which would be scored as
 * recogniser error rather than microphone error. AGC stays on to compensate for
 * distance from a laptop mic.
 */
export function micConstraints(deviceId?: string): MediaStreamConstraints {
  return {
    audio: {
      ...(deviceId ? { deviceId: { exact: deviceId } } : {}),
      channelCount: 1,
      echoCancellation: false,
      noiseSuppression: false,
      autoGainControl: true,
    },
  };
}

/**
 * Bluetooth microphones run over HFP at 8-16 kHz, which inflates word error rate
 * and invites blaming the recogniser for the headset.
 */
export function isLowQualityInput(label: string, sampleRate?: number): boolean {
  return (
    /airpod|bluetooth|headset|hands-?free|\bbt\b/i.test(label) ||
    (sampleRate !== undefined && sampleRate > 0 && sampleRate < 24_000)
  );
}
