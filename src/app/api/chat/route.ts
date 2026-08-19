import { CHAT_MODEL, errorResponse, openai, requireApiKey } from "@/lib/openai";
import { buildMessages, type ChatTurn } from "@/lib/prompt";

export const runtime = "nodejs";

export type { ChatTurn };

/**
 * One sentence, measured: text-to-speech time scales with words spoken, and this
 * took the server-side turn from 2479ms to 2115ms with no loss of register or
 * persona (FINDINGS §10). Most of the available saving was reply length, not
 * model choice — gpt-4o-mini was 183ms faster still but lost the waiter persona
 * and mixed تو/شما address forms mid-conversation.
 */
const messagesFor = (turns: ChatTurn[], unintelligible = false) =>
  buildMessages(turns, { maxSentences: 1, unintelligible });

/**
 * Both modes are kept so the M1 baseline and the M2 streamed path can be
 * compared live rather than from memory. `stream: true` returns plain text
 * deltas; the client splits them into speakable chunks and starts synthesising
 * before the reply is finished.
 */
export async function POST(request: Request): Promise<Response> {
  const missingKey = requireApiKey();
  if (missingKey) return missingKey;

  try {
    const { history, stream, unintelligible } = (await request.json()) as {
      history?: ChatTurn[];
      stream?: boolean;
      unintelligible?: boolean;
    };
    const turns = history ?? [];

    if (stream) return streamReply(turns, unintelligible);

    const started = Date.now();
    const completion = await openai.chat.completions.create({
      model: CHAT_MODEL,
      messages: messagesFor(turns, unintelligible),
      // Short spoken turns. The prompt asks for one sentence; this stops a
      // runaway paragraph costing seconds of TTS.
      max_tokens: 120,
      temperature: 0.8,
    });

    const reply = completion.choices[0]?.message?.content?.trim() ?? "";
    if (!reply) {
      return Response.json({ error: "model returned an empty reply" }, { status: 502 });
    }

    return Response.json({ reply, ms: Date.now() - started, model: CHAT_MODEL });
  } catch (err) {
    return errorResponse("chat", err);
  }
}

/**
 * Plain text deltas rather than SSE — there is no metadata to carry, and the
 * client only needs the characters as they arrive.
 */
function streamReply(turns: ChatTurn[], unintelligible = false): Response {
  const encoder = new TextEncoder();

  const body = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        const completion = await openai.chat.completions.create({
          model: CHAT_MODEL,
          messages: messagesFor(turns, unintelligible),
          max_tokens: 120,
          temperature: 0.8,
          stream: true,
        });

        for await (const part of completion) {
          const delta = part.choices[0]?.delta?.content;
          if (delta) controller.enqueue(encoder.encode(delta));
        }
        controller.close();
      } catch (err) {
        // The response has already started, so the status code is committed and
        // the error can only be surfaced in-band.
        const message = err instanceof Error ? err.message : String(err);
        console.error("[chat:stream]", message);
        controller.enqueue(encoder.encode(`\n[error] ${message}`));
        controller.close();
      }
    },
  });

  return new Response(body, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-store",
      // Stops proxies buffering the stream and erasing the latency win.
      "X-Accel-Buffering": "no",
    },
  });
}
