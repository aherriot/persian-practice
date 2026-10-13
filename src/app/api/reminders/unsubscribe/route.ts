import { unsubscribe } from "@/lib/reminders";

/**
 * One-click unsubscribe (RFC 8058): what a mail client's own "unsubscribe"
 * button posts to, with no session. The signed token in the address is the
 * proof. A person following the link in the email lands on /unsubscribe instead.
 */
export async function POST(request: Request): Promise<Response> {
  const { searchParams } = new URL(request.url);
  const userId = searchParams.get("u");
  const token = searchParams.get("t");
  const secret = process.env.AUTH_SECRET;
  if (!userId || !token || !secret || !(await unsubscribe(userId, token, secret))) {
    return Response.json({ error: "invalid link" }, { status: 400 });
  }
  return Response.json({ ok: true });
}
