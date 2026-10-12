/**
 * Browser-side audio for lessons. Clips are fetched once into memory as blob
 * URLs, so upcoming exercises can be preloaded and then play with no delay,
 * and one shared element is reused so Safari's play-after-gesture rule is
 * satisfied by a single unlock at the start of the session.
 */
const blobs = new Map<string, Promise<string>>();
let element: HTMLAudioElement | null = null;

const SILENCE = "data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAIA+AAACABAAZGF0YQAAAAA=";

export function preloadAudio(url: string): Promise<string> {
  let pending = blobs.get(url);
  if (!pending) {
    pending = fetch(url)
      .then((response) => {
        if (!response.ok) throw new Error(`audio ${response.status}`);
        return response.blob();
      })
      .then((blob) => URL.createObjectURL(blob));
    pending.catch(() => blobs.delete(url));
    blobs.set(url, pending);
  }
  return pending;
}

/** Call from a click handler before the first clip. */
export function unlockAudio(): void {
  element ??= new Audio();
  element.src = SILENCE;
  void element.play().catch(() => {});
}

let latest = 0;

export async function playAudio(url: string): Promise<void> {
  const request = ++latest;
  try {
    const src = await preloadAudio(url);
    if (request !== latest) return; // a newer clip was asked for while this one loaded
    element ??= new Audio();
    element.src = src;
    await element.play();
  } catch {
    // Missing audio must never block the lesson; the replay button stays available.
  }
}
