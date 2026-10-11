"use client";

import { useActionState } from "react";
import { devSignInAction, sendMagicLinkAction, type SignInState } from "./actions";
import { Input } from "@/components/Input";
import { Button } from "@/components/Button";

export function SignInForm({ devEnabled }: { devEnabled: boolean }) {
  const [magicState, magicAction, magicPending] = useActionState<SignInState, FormData>(
    sendMagicLinkAction,
    null,
  );
  const [devState, devAction, devPending] = useActionState<SignInState, FormData>(
    devSignInAction,
    null,
  );

  return (
    <div className="flex flex-col gap-6">
      <form action={magicAction} className="flex flex-col gap-3">
        <Input
          name="email"
          type="email"
          autoComplete="email"
          required
          placeholder="you@example.com"
          label="Email address"
          description="We'll email you a link to sign in — no password needed."
          error={magicState?.error}
        />
        <Button type="submit" variant="primary" disabled={magicPending}>
          {magicPending ? "Sending…" : "Email me a sign-in link"}
        </Button>
      </form>

      {devEnabled && (
        <div className="flex flex-col gap-3 border-t border-ink/10 pt-6">
          <p className="text-sm text-ink/50">
            Dev sign-in (non-production) — skip the email round-trip.
          </p>
          <form action={devAction} className="flex flex-col gap-3">
            <Input
              name="email"
              type="email"
              autoComplete="email"
              required
              placeholder="you@example.com"
              label="Email"
            />
            <Input name="name" type="text" autoComplete="name" placeholder="Alex" label="Name (optional)" />
            {devState?.error && <p className="text-xs text-crimson">{devState.error}</p>}
            <Button type="submit" variant="secondary" disabled={devPending}>
              {devPending ? "Signing in…" : "Dev sign-in"}
            </Button>
          </form>
        </div>
      )}
    </div>
  );
}
