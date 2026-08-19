import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Check your email — Persian Practice",
};

export default function CheckEmailPage() {
  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <div className="w-full max-w-md rounded-lg border border-gray-200 p-8 text-center shadow-sm">
        <h1 className="mb-2 text-2xl font-semibold">Check your email</h1>
        <p className="mb-6 text-sm text-gray-500">
          We sent you a sign-in link. Open it on this device to continue.
        </p>
        <Link
          href="/sign-in"
          className="block w-full rounded-md border border-gray-300 py-2 text-sm font-medium"
        >
          Back to sign in
        </Link>
      </div>
    </main>
  );
}
