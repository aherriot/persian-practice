import NextAuth from "next-auth";
import { authConfig } from "@/lib/auth/config";

// Middleware runs on the Edge runtime, so it uses the adapter-free,
// provider-free base config. Route protection lives in the `authorized`
// callback there.
export const { auth: middleware } = NextAuth(authConfig);

export const config = {
  matcher: [
    "/dashboard/:path*",
    "/conversation/:path*",
    "/placement/:path*",
    "/review/:path*",
    "/topics/:path*",
  ],
};
