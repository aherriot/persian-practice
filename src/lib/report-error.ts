/**
 * The one place an unexpected error is reported from, on the server and in
 * the browser. It writes a single line of JSON, which is what a log drain can
 * search; to send errors to a service as well, do it here.
 */

export type ErrorContext = Record<string, string | number | boolean | null | undefined>;

export type ErrorReport = {
  level: "error";
  /** Where it happened: "tts", "render", "prepareWord"… */
  scope: string;
  message: string;
  name?: string;
  /** Next's hash of a server error, which is all the browser is told about it. */
  digest?: string;
  stack?: string;
  time: string;
} & ErrorContext;

export function describeError(scope: string, err: unknown, context: ErrorContext = {}, now = new Date()): ErrorReport {
  const error = err instanceof Error ? err : null;
  const digest = typeof err === "object" && err !== null && "digest" in err ? String(err.digest) : undefined;
  return {
    ...context,
    level: "error",
    scope,
    message: error ? error.message : String(err),
    name: error?.name,
    digest,
    stack: error?.stack,
    time: now.toISOString(),
  };
}

export function reportError(scope: string, err: unknown, context?: ErrorContext): void {
  console.error(JSON.stringify(describeError(scope, err, context)));
}
