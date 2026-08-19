/**
 * Ordered playback of audio that arrives out of order.
 *
 * Streaming fires a text-to-speech request per clause as soon as that clause is
 * written, so several are in flight at once and they can finish in any order.
 * The learner must still hear them in sentence order, so each request is pushed
 * as a *promise* and played strictly by position.
 *
 * The queue also reports when the very first sound actually reaches the
 * speakers, which is the number M2 exists to move.
 */

export type PlayableQueue<T> = {
  /** Enqueue a clip. Position in the queue is playback order, not arrival order. */
  push(clip: Promise<T>): void;
  /** Resolves once every clip pushed so far has finished playing. */
  drain(): Promise<void>;
  stop(): void;
};

export type QueueOptions = {
  /** Fires once, when the first clip begins playing. */
  onFirstPlay?: () => void;
  onError?: (err: unknown) => void;
};

/**
 * `play` is injectable so ordering can be tested without real audio hardware.
 * The default plays through an HTMLAudioElement and resolves when it ends.
 */
export function createAudioQueue<T = Blob>(
  options: QueueOptions = {},
  play: (clip: T) => Promise<void> = playBlob as unknown as (clip: T) => Promise<void>,
): PlayableQueue<T> {
  const clips: Promise<T>[] = [];
  let next = 0;
  let running = false;
  let stopped = false;
  let announced = false;

  // Waiters are resolved when the pump goes idle. Deliberately not a single
  // reusable promise — that version deadlocked, because after stop() the queue
  // still had unplayed clips and drain() spun on an already-resolved promise.
  let waiters: (() => void)[] = [];
  function settle() {
    const pending = waiters;
    waiters = [];
    for (const resolve of pending) resolve();
  }

  async function pump() {
    if (running) return;
    running = true;

    while (next < clips.length && !stopped) {
      const clip = clips[next];
      next++;
      try {
        const blob = await clip;
        if (stopped) break;
        if (!announced) {
          announced = true;
          options.onFirstPlay?.();
        }
        await play(blob);
      } catch (err) {
        // One failed clause should not silence the rest of the sentence.
        options.onError?.(err);
      }
    }

    running = false;
    settle();
  }

  return {
    push(clip) {
      clips.push(clip);
      void pump();
    },
    drain() {
      if (stopped || (!running && next >= clips.length)) return Promise.resolve();
      return new Promise<void>((resolve) => waiters.push(resolve));
    },
    stop() {
      stopped = true;
      settle();
    },
  };
}

async function playBlob(blob: Blob): Promise<void> {
  const url = URL.createObjectURL(blob);
  const audio = new Audio(url);
  try {
    await audio.play();
    await new Promise<void>((resolve) => {
      audio.onended = () => resolve();
      audio.onerror = () => resolve();
    });
  } finally {
    URL.revokeObjectURL(url);
  }
}
