"use client";

import { useActionState } from "react";
import { devSignInAction, sendMagicLinkAction, type SignInState } from "./actions";

function FormError({ message }: { message?: string }) {
  if (!message) return null;
  return <p className="text-sm text-red-600">{message}</p>;
}

export function SignInForm({ devEnabled }: { devEnabled: boolean }) {
  const [magicState, magicAction, magicPending] = useActionState<SignInState, FormData>(
    sendMagicLinkAction,
    null,
  );
  const [devState, devAction, devPending] = useActionState<SignInState, FormData>(
    devSignInAction,
    null,
  );

  const inputClass =
    "w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-black focus:outline-none";
  const labelClass = "text-sm font-medium text-gray-700";

  return (
    <div className="flex flex-col gap-6">
      <form action={magicAction} className="flex flex-col gap-3">
        <label className={labelClass} htmlFor="email">
          Email address
        </label>
        <input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          required
          placeholder="you@example.com"
          className={inputClass}
        />
        <p className="text-xs text-gray-500">
          We&apos;ll email you a link to sign in — no password needed.
        </p>
        <FormError message={magicState?.error} />
        <button
          type="submit"
          disabled={magicPending}
          className="w-full rounded-md bg-black py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          {magicPending ? "Sending…" : "Email me a sign-in link"}
        </button>
      </form>

      {devEnabled && (
        <div className="flex flex-col gap-3 border-t border-gray-200 pt-6">
          <p className="text-sm text-gray-500">
            Dev sign-in (non-production) — skip the email round-trip.
          </p>
          <form action={devAction} className="flex flex-col gap-3">
            <label className={labelClass} htmlFor="dev-email">
              Email
            </label>
            <input
              id="dev-email"
              name="email"
              type="email"
              autoComplete="email"
              required
              placeholder="you@example.com"
              className={inputClass}
            />
            <label className={labelClass} htmlFor="dev-name">
              Name (optional)
            </label>
            <input
              id="dev-name"
              name="name"
              type="text"
              autoComplete="name"
              placeholder="Alex"
              className={inputClass}
            />
            <FormError message={devState?.error} />
            <button
              type="submit"
              disabled={devPending}
              className="w-full rounded-md border border-black py-2 text-sm font-medium disabled:opacity-50"
            >
              {devPending ? "Signing in…" : "Dev sign-in"}
            </button>
          </form>
        </div>
      )}
    </div>
  );
}
