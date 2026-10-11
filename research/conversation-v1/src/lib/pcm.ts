/**
 * Progressive PCM playback.
 *
 * Measured (spike/tts-latency.ts): the speech API returns its first audio bytes
 * at ~532ms but does not finish the clip until ~1221ms. Waiting for a complete
 * file throws away ~689ms per clause, which is larger than the saving from
 * splitting the text into clauses at all.
 *
 * PCM is chosen over mp3/opus because raw samples need no container parsing —
 * bytes can be turned into an AudioBuffer and scheduled the moment they arrive.
 */

/** OpenAI returns 24 kHz, 16-bit signed little-endian, mono. */
export const PCM_SAMPLE_RATE = 24_000;

/**
 * Convert a PCM byte run to float samples.
 *
 * A 16-bit sample can straddle a network chunk boundary, so any trailing odd
 * byte is returned as `carry` and must be prepended to the next call. Dropping
 * it instead shifts every subsequent sample by one byte and turns the rest of
 * the stream into noise.
 */
export function pcmToFloat32(
  bytes: Uint8Array,
  carry?: Uint8Array,
): { samples: Float32Array<ArrayBuffer>; carry: Uint8Array } {
  // The ArrayBuffer-backed return type is load-bearing: copyToChannel rejects a
  // Float32Array<ArrayBufferLike>, and widening it here would force a defensive
  // copy of every audio chunk in the playback hot path.
  const input =
    carry && carry.length > 0
      ? (() => {
          const joined = new Uint8Array(carry.length + bytes.length);
          joined.set(carry, 0);
          joined.set(bytes, carry.length);
          return joined;
        })()
      : bytes;

  const usable = input.length - (input.length % 2);
  const samples = new Float32Array(usable / 2);
  const view = new DataView(input.buffer, input.byteOffset, input.byteLength);
  for (let i = 0; i < samples.length; i++) {
    samples[i] = view.getInt16(i * 2, true) / 0x8000;
  }

  return { samples, carry: input.slice(usable) };
}

export type PcmPlayer = {
  /** Reads a PCM response to completion, scheduling audio as it arrives. */
  play(response: Response): Promise<void>;
  /** Resolves when everything scheduled has finished sounding. */
  finished(): Promise<void>;
  close(): void;
};

export type PcmPlayerOptions = {
  /** Fires once, the moment the first audio is actually scheduled to sound. */
  onFirstSound?: () => void;
};

/**
 * Schedules successive buffers against a running playhead so clauses join
 * seamlessly instead of being separate `Audio` elements with gaps between them.
 */
export function createPcmPlayer(options: PcmPlayerOptions = {}): PcmPlayer {
  const context = new AudioContext();
  let playhead = 0;
  let announced = false;
  let closed = false;

  return {
    async play(response) {
      if (!response.body) throw new Error("tts response had no body");
      const reader = response.body.getReader();
      let carry: Uint8Array | undefined;

      for (;;) {
        const { value, done } = await reader.read();
        if (done || closed) break;

        const { samples, carry: rest } = pcmToFloat32(value, carry);
        carry = rest;
        if (samples.length === 0) continue;

        const buffer = context.createBuffer(1, samples.length, PCM_SAMPLE_RATE);
        buffer.copyToChannel(samples, 0);
        const source = context.createBufferSource();
        source.buffer = buffer;
        source.connect(context.destination);

        // Never schedule in the past, or the buffer is dropped and the clause
        // develops a hole.
        const startAt = Math.max(context.currentTime, playhead);
        source.start(startAt);
        playhead = startAt + buffer.duration;

        if (!announced) {
          announced = true;
          options.onFirstSound?.();
        }
      }
    },

    async finished() {
      const remaining = playhead - context.currentTime;
      if (remaining > 0) await new Promise((r) => setTimeout(r, remaining * 1000));
    },

    close() {
      closed = true;
      context.close().catch(() => {});
    },
  };
}
