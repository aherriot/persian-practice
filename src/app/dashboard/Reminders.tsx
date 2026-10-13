"use client";

import { useState, useTransition } from "react";
import { setRemindersAction } from "./actions";

/** The learner's switch for the daily reminder email. Off unless they turn it on. */
export function Reminders({ enabled, email }: { enabled: boolean; email: string }) {
  const [on, setOn] = useState(enabled);
  const [failed, setFailed] = useState(false);
  const [pending, startTransition] = useTransition();

  const change = (next: boolean) => {
    setOn(next);
    setFailed(false);
    startTransition(async () => {
      // The zone is the browser's: it decides what counts as "today" for this learner.
      const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone ?? null;
      const result = await setRemindersAction(next, timeZone).catch(() => ({ ok: false }));
      if (!result.ok) {
        setOn(!next);
        setFailed(true);
      }
    });
  };

  return (
    <div className="flex flex-col gap-1 border-t border-ink/10 pt-3">
      <label className="flex cursor-pointer items-start gap-3 text-sm text-ink">
        <input
          type="checkbox"
          checked={on}
          disabled={pending}
          onChange={(event) => change(event.target.checked)}
          className="mt-0.5 h-4 w-4 shrink-0 accent-cobalt"
        />
        <span>
          Email me a reminder on days I have not practised
          <span className="block text-xs text-ink/55">
            Sent to {email}, once a day at most, and only when something is due. Every email has a link to stop them.
          </span>
        </span>
      </label>
      {failed && (
        <p role="alert" className="text-xs text-crimson">
          That did not save. Try again.
        </p>
      )}
    </div>
  );
}
