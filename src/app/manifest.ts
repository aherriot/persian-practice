import type { MetadataRoute } from "next";

// Lets the app be added to a phone's home screen and opened without browser
// chrome. The colours are the sand and cobalt tokens from globals.css; the
// icon is the design system's compound star (src/app/icon.svg).
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Persian Practice",
    short_name: "Persian",
    description: "Short daily lessons in spoken Persian: one new word at a time, with spaced review.",
    start_url: "/dashboard",
    display: "standalone",
    background_color: "#ede3d2",
    theme_color: "#123e7a",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      // The star sits inside the safe zone, so the same image survives a mask.
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
