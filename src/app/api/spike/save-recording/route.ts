import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { NextResponse } from "next/server";

import { CLIPS } from "../../../../../spike/stt-clips.ts";

export const runtime = "nodejs";

const RECORDINGS_DIR = path.resolve("spike/recordings");

/**
 * Saves a recorded WAV clip straight into spike/recordings/ so the probe script
 * can pick it up without the user hand-renaming ten downloads.
 *
 * Development-only. The id is checked against the known clip list rather than
 * used as a path directly — it lands on the filesystem, so it must not be able
 * to escape the recordings directory.
 */
export async function POST(request: Request) {
  if (process.env.NODE_ENV === "production") {
    return new NextResponse("Not found", { status: 404 });
  }

  const id = new URL(request.url).searchParams.get("id");
  if (!id || !CLIPS.some((clip) => clip.id === id)) {
    return new NextResponse(`Unknown clip id: ${id}`, { status: 400 });
  }

  const audio = Buffer.from(await request.arrayBuffer());
  if (audio.byteLength === 0) {
    return new NextResponse("Empty audio body", { status: 400 });
  }

  await mkdir(RECORDINGS_DIR, { recursive: true });
  await writeFile(path.join(RECORDINGS_DIR, `${id}.wav`), audio);

  return NextResponse.json({ id, bytes: audio.byteLength });
}
