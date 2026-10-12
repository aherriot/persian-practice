import { auth } from "@/lib/auth";
import { getClipAudio } from "@/lib/audio-store";
import { errorResponse, requireApiKey } from "@/lib/openai";

export async function GET(_request: Request, { params }: { params: Promise<{ hash: string }> }): Promise<Response> {
  // Signed-in only: a cache miss spends money on speech synthesis.
  const session = await auth();
  if (!session?.user?.id) return Response.json({ error: "not signed in" }, { status: 401 });

  const { hash } = await params;
  if (!/^[0-9a-f]{32}$/.test(hash)) return Response.json({ error: "not found" }, { status: 404 });

  const missingKey = requireApiKey();
  if (missingKey) return missingKey;

  try {
    const audio = await getClipAudio(hash);
    if (!audio) return Response.json({ error: "not found" }, { status: 404 });
    return new Response(new Uint8Array(audio), {
      headers: {
        "Content-Type": "audio/mpeg",
        // The hash covers text, voice and instructions, so a clip never changes.
        "Cache-Control": "private, max-age=31536000, immutable",
      },
    });
  } catch (err) {
    return errorResponse("audio", err);
  }
}
