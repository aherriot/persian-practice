/**
 * Sends a learner's answers to the server without ever making the lesson wait,
 * and without losing one to a dropped connection or a closed tab.
 *
 * Everything goes through one queue, in order, so the introduction of a word
 * always lands before the first answer about it. Each entry carries a key the
 * server stores with the answer, so sending one twice (after a timeout, or
 * from two tabs) counts once. The queue is kept in localStorage until the
 * server has taken each entry, and is picked up again on the next page load.
 */

export type OutboxEntry = { key: string; at: number; body: unknown };
export type OutboxStatus = { pending: number; failing: boolean };

/** "sent": the server has it. "refused": the server will never take it. "retry": try again later. */
export type SendOutcome = "sent" | "refused" | "retry";

export type OutboxOptions = {
  storage: Pick<Storage, "getItem" | "setItem"> | null;
  storageKey: string;
  send: (entry: OutboxEntry) => Promise<SendOutcome>;
  /** Resolves after `ms`, or sooner if `hurry` is called. */
  wait?: (ms: number, onHurry: (hurry: () => void) => void) => Promise<void>;
  now?: () => number;
  newKey?: () => string;
};

export type Outbox = {
  add(body: unknown): void;
  /** Sends what is waiting now, cutting short any pause between attempts. */
  flush(): void;
  /** Resolves true once nothing is waiting, or false if that takes longer than `timeoutMs`. */
  drained(timeoutMs: number): Promise<boolean>;
  status(): OutboxStatus;
  subscribe(listener: () => void): () => void;
};

/** Failed attempts in a row before the learner is told. One blip is not worth mentioning. */
const FAILING_AFTER = 2;
const MAX_PAUSE_MS = 30_000;
/**
 * An answer is scheduled from when the server receives it, so one found in
 * storage long afterwards would be recorded as if just given. Those are let go.
 */
const MAX_AGE_MS = 24 * 60 * 60 * 1000;

export const retryPause = (failures: number) => Math.min(MAX_PAUSE_MS, 1000 * 2 ** (failures - 1));

const defaultWait: NonNullable<OutboxOptions["wait"]> = (ms, onHurry) =>
  new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    onHurry(() => {
      clearTimeout(timer);
      resolve();
    });
  });

export function createOutbox(options: OutboxOptions): Outbox {
  const { storage, storageKey, send, wait = defaultWait, now = Date.now, newKey = () => crypto.randomUUID() } = options;
  const listeners = new Set<() => void>();
  let entries = restore();
  let failures = 0;
  let sending = false;
  let hurry: (() => void) | null = null;
  let snapshot: OutboxStatus = { pending: entries.length, failing: false };

  function restore(): OutboxEntry[] {
    try {
      const stored: unknown = JSON.parse(storage?.getItem(storageKey) ?? "[]");
      if (!Array.isArray(stored)) return [];
      return stored.filter(
        (e): e is OutboxEntry => typeof e?.key === "string" && typeof e?.at === "number" && now() - e.at < MAX_AGE_MS,
      );
    } catch {
      return [];
    }
  }

  function changed(): void {
    try {
      storage?.setItem(storageKey, JSON.stringify(entries));
    } catch {
      // Storage full or forbidden: the queue still works for as long as the page is open.
    }
    const failing = failures >= FAILING_AFTER;
    if (snapshot.pending !== entries.length || snapshot.failing !== failing) {
      snapshot = { pending: entries.length, failing };
      for (const listener of listeners) listener();
    }
  }

  async function run(): Promise<void> {
    if (sending) return;
    sending = true;
    try {
      while (entries.length > 0) {
        const entry = entries[0];
        const outcome = await send(entry).catch((): SendOutcome => "retry");
        if (outcome === "retry") {
          failures++;
          changed();
          await wait(retryPause(failures), (cut) => (hurry = cut));
          hurry = null;
          continue;
        }
        failures = 0;
        entries = entries.filter((e) => e !== entry);
        changed();
      }
    } finally {
      sending = false;
    }
  }

  const subscribe: Outbox["subscribe"] = (listener) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  };
  const flush = () => {
    hurry?.();
    void run();
  };

  return {
    add(body) {
      entries = [...entries, { key: newKey(), at: now(), body }];
      changed();
      void run();
    },
    flush,
    drained(timeoutMs) {
      if (entries.length === 0) return Promise.resolve(true);
      flush();
      return new Promise((resolve) => {
        const finish = (result: boolean) => {
          clearTimeout(timer);
          unsubscribe();
          resolve(result);
        };
        const timer = setTimeout(() => finish(false), timeoutMs);
        const unsubscribe = subscribe(() => {
          if (entries.length === 0) finish(true);
        });
      });
    },
    status: () => snapshot,
    subscribe,
  };
}

/** Sends one entry to the lesson API. */
export async function postAnswer(entry: OutboxEntry): Promise<SendOutcome> {
  const response = await fetch("/api/lesson/answer", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...(entry.body as object), key: entry.key }),
    // Lets the request finish if the tab is closed straight after the last answer.
    keepalive: true,
  });
  if (response.ok) return "sent";
  // Signed out, timed out or throttled: worth trying again. Any other 4xx will be refused every time.
  if ([401, 408, 429].includes(response.status) || response.status >= 500) return "retry";
  return "refused";
}

const outboxes = new Map<string, Outbox>();

/** The signed-in learner's outbox in this browser. Kept apart per learner, so one's unsent answers are never sent as another's. */
export function lessonOutbox(userId: string): Outbox {
  let outbox = outboxes.get(userId);
  if (!outbox) {
    let storage: Storage | null = null;
    try {
      storage = window.localStorage;
    } catch {
      // Blocked in this browser; unsent answers will not outlive the page.
    }
    outbox = createOutbox({ storage, storageKey: `lesson-outbox:${userId}`, send: postAnswer });
    outboxes.set(userId, outbox);
  }
  return outbox;
}
