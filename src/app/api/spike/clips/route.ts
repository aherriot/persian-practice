import { NextResponse } from "next/server";

import { CLIPS } from "../../../../../spike/stt-clips.ts";

export const runtime = "nodejs";

/** Feeds the clip list to public/record.html. Development-only spike tooling. */
export async function GET() {
  if (process.env.NODE_ENV === "production") {
    return new NextResponse("Not found", { status: 404 });
  }
  return NextResponse.json(CLIPS);
}
