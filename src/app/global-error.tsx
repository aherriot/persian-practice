"use client"; // Error boundaries must be Client Components

import { useEffect } from "react";
import { reportError } from "@/lib/report-error";

// Shown when the root layout itself fails, so it replaces that layout: no
// stylesheet, fonts or design-system components can be counted on here. The
// colours are the sand, paper, ink, gold and cobalt tokens from globals.css, inline.
export default function GlobalError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  useEffect(() => {
    reportError("layout", error);
  }, [error]);

  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: "1.5rem",
          padding: "2rem 1.25rem",
          background: "#f7f2e9",
          color: "#2a1d16",
          fontFamily: "system-ui, sans-serif",
          textAlign: "center",
        }}
      >
        <title>Something went wrong · Persian Practice</title>
        <h1 style={{ margin: 0, fontSize: "1.5rem" }}>Something went wrong</h1>
        <p style={{ margin: 0, maxWidth: "20rem", fontSize: "0.875rem", lineHeight: 1.6, opacity: 0.7 }}>
          Persian Practice could not load. Answers you have already given are saved.
        </p>
        <button
          type="button"
          onClick={() => retry()}
          style={{
            padding: "0.625rem 1.5rem",
            border: "1.5px solid #d9a61e",
            borderRadius: "1rem 1rem 0.375rem 0.375rem",
            background: "#123e7a",
            color: "#ede3d2",
            fontSize: "0.875rem",
            fontWeight: 500,
            letterSpacing: "0.025em",
            boxShadow: "0 0 0 3px #ede3d2, 0 0 0 4px #2a1d16",
            cursor: "pointer",
          }}
        >
          Try again
        </button>
        {error.digest && (
          <p style={{ margin: 0, fontFamily: "monospace", fontSize: "0.75rem", opacity: 0.35 }}>Reference {error.digest}</p>
        )}
      </body>
    </html>
  );
}
