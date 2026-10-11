import NextAuth from "next-auth";
import { authConfig } from "@/lib/auth/config";

// Uses the adapter-free, provider-free base config so the proxy authorizes
// from the JWT cookie without a DB round-trip. Route protection lives in the
// `authorized` callback there.
export const { auth: proxy } = NextAuth(authConfig);

export const config = {
  matcher: ["/dashboard/:path*"],
};
