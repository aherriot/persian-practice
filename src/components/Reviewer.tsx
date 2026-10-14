"use client";

import { createContext, useContext, type ReactNode } from "react";

/**
 * Whether the person here may change what every learner shares: the curated
 * words and sentences and their recordings. Turns on "Something wrong?" under
 * them (src/components/Correct.tsx). Set from `canReviewAudio`.
 */
const ReviewerContext = createContext(false);

export function ReviewerProvider({ enabled, children }: { enabled: boolean; children: ReactNode }) {
  return <ReviewerContext value={enabled}>{children}</ReviewerContext>;
}

export const useIsReviewer = () => useContext(ReviewerContext);
