import type { ClaimJourney, ClaimSummary } from "../types";

export function claimJourneyDestination(
  claim: Pick<ClaimSummary, "claimId" | "journey">
) {
  if (claim.journey.phase === "submitted") {
    return `/claims/${claim.claimId}/submitted`;
  }
  if (claim.journey.phase === "review") {
    return `/claims/${claim.claimId}/review`;
  }
  return `/claims/${claim.claimId}/documents`;
}

export function claimJourneyActionLabel(
  journey: ClaimJourney,
  isArabic: boolean
) {
  const labels: Record<ClaimJourney["phase"], [string, string]> = {
    empty: ["Upload documents", "رفع المستندات"],
    analysis_required: ["Analyze and continue", "تحليل ومتابعة"],
    validation_required: ["Revalidate claim", "إعادة فحص المطالبة"],
    review: ["Continue to review", "المتابعة إلى المراجعة"],
    submitted: ["View submitted claim", "عرض المطالبة المرسلة"]
  };
  const [english, arabic] = labels[journey.phase];
  return isArabic ? arabic : english;
}

export function reviewReentryDestination(
  claim: Pick<ClaimSummary, "claimId" | "journey">
) {
  if (claim.journey.phase === "submitted") {
    return `/claims/${claim.claimId}/submitted`;
  }
  return claim.journey.phase === "review"
    ? null
    : `/claims/${claim.claimId}/documents`;
}
