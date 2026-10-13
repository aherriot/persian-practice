import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Button } from "@/components/Button";
import { unsubscribe, verifyUnsubscribeToken } from "@/lib/reminders";

export const metadata: Metadata = { title: "Stop reminders · Persian Practice", robots: { index: false } };

/** Deliberately a button, not the page load: mail scanners follow links, and must not unsubscribe anyone by doing so. */
async function stop(formData: FormData) {
  "use server";
  const userId = String(formData.get("u") ?? "");
  const token = String(formData.get("t") ?? "");
  const secret = process.env.AUTH_SECRET;
  const ok = Boolean(secret) && (await unsubscribe(userId, token, secret!));
  redirect(ok ? "/unsubscribe?done=1" : "/unsubscribe");
}

/**
 * Where the "stop these emails" link in a reminder leads. Works without
 * signing in: the link carries a token signed for that learner.
 */
export default async function UnsubscribePage({ searchParams }: PageProps<"/unsubscribe">) {
  const params = await searchParams;
  const one = (value: string | string[] | undefined) => (typeof value === "string" ? value : "");
  const userId = one(params.u);
  const token = one(params.t);
  const secret = process.env.AUTH_SECRET;
  const done = one(params.done) === "1";
  const valid = Boolean(secret && userId && token) && verifyUnsubscribeToken(userId, token, secret!);

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-xl flex-col items-center justify-center gap-6 bg-paper px-5 py-8 text-center">
      <h1 className="font-[family-name:var(--font-display-latin)] text-2xl font-bold text-ink">
        {done ? "Reminders stopped" : valid ? "Stop the reminders?" : "This link has not worked"}
      </h1>
      {done ? (
        <p className="max-w-xs text-sm leading-relaxed text-ink/70">
          You will not be sent another. You can turn them back on from the dashboard whenever you like.
        </p>
      ) : valid ? (
        <>
          <p className="max-w-xs text-sm leading-relaxed text-ink/70">
            You will no longer be emailed on days you have not practised. Nothing else about your account changes.
          </p>
          <form action={stop}>
            <input type="hidden" name="u" value={userId} />
            <input type="hidden" name="t" value={token} />
            <Button type="submit">Stop the emails</Button>
          </form>
        </>
      ) : (
        <p className="max-w-xs text-sm leading-relaxed text-ink/70">
          This link is not valid. Sign in and turn reminders off from the dashboard instead.
        </p>
      )}
      <Link href="/dashboard" className="text-sm text-ink/60 underline">
        Go to Persian Practice
      </Link>
    </main>
  );
}
