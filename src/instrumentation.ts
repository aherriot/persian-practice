import type { Instrumentation } from "next";
import { reportError } from "@/lib/report-error";

/**
 * Every error the server did not handle — in a page render, a route handler,
 * a server action or the proxy — is reported here. The browser is shown only
 * a digest, which this line carries too, so the two can be matched up.
 */
export const onRequestError: Instrumentation.onRequestError = (err, request, context) => {
  reportError(context.routeType, err, {
    method: request.method,
    path: request.path,
    route: context.routePath,
  });
};
