import NextAuth from "next-auth";
import { authConfig } from "@/lib/auth/config";

// Uses the adapter-free, provider-free base config so the proxy authorizes
// from the JWT cookie without a DB round-trip. Route protection lives in the
// `authorized` callback there.
// A default export, because Next.js checks for the proxy function statically
// and does not recognise a destructured `export const { auth: proxy }`.
const { auth } = NextAuth(authConfig);
export default auth;

export const config = {
  matcher: ["/dashboard/:path*", "/learn/:path*", "/practice/:path*", "/reference/:path*"],
};
