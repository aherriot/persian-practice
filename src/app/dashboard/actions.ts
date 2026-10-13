"use server";

import { auth } from "@/lib/auth";
import { setReminders } from "@/lib/reminders";

/** Turns the signed-in learner's daily reminder on or off, noting the time zone their browser is in. */
export async function setRemindersAction(enabled: boolean, timeZone: string | null): Promise<{ ok: boolean }> {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId || typeof enabled !== "boolean") return { ok: false };
  await setReminders(userId, enabled, typeof timeZone === "string" ? timeZone.slice(0, 64) : null);
  return { ok: true };
}
