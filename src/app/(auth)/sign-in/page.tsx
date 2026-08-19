import type { Metadata } from "next";
import { devAuthEnabled } from "@/lib/auth/dev-mode";
import { SignInForm } from "./SignInForm";

export const metadata: Metadata = {
  title: "Sign in — Persian Practice",
};

export default function SignInPage() {
  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <div className="w-full max-w-md rounded-lg border border-gray-200 p-8 shadow-sm">
        <div className="mb-6 flex flex-col gap-2 text-center">
          <h1 className="text-2xl font-semibold">Persian Practice</h1>
          <p className="text-sm text-gray-500">
            Sign in to start a conversation and track your progress.
          </p>
        </div>
        <SignInForm devEnabled={devAuthEnabled} />
      </div>
    </main>
  );
}
