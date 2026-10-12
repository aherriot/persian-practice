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
        // A clip can be remade (a rejected take, a retired instruction), so it
        // is not cached for ever. The device that rejects one refetches it at once.
        "Cache-Control": "private, max-age=86400",
      },
    });
  } catch (err) {
    return errorResponse("audio", err);
  }
}
