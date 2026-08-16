import type { AttachmentRecord } from "./attachment";
import type { ClaimJourney, ClaimRecord } from "./claim";
import type { ClaimValidationResult } from "../validation/validation";

/**
 * Derives resumable journey state entirely from persisted claim, attachment,
 * extraction, and validation state. Reading or navigating never changes it.
 */
export function deriveClaimJourney(
  claim: ClaimRecord,
  attachments: readonly AttachmentRecord[],
  validation: ClaimValidationResult | null,
  isAnalysisCurrent: (attachment: AttachmentRecord) => boolean
): ClaimJourney {
  if (claim.status === "accepted_for_processing") {
    const documentsPresent = attachments.length > 0;
    return {
      phase: "submitted",
      documentsPresent,
      analysisCurrent: documentsPresent && attachments.every(isAnalysisCurrent),
      validationCurrent: true,
      canReview: false,
      requiresProviderAnalysis: false
    };
  }

  if (attachments.length === 0) {
    return {
      phase: "empty",
      documentsPresent: false,
      analysisCurrent: false,
      validationCurrent: false,
      canReview: false,
      requiresProviderAnalysis: false
    };
  }

  const analysisCurrent = attachments.every(isAnalysisCurrent);
  if (!analysisCurrent) {
    return {
      phase: "analysis_required",
      documentsPresent: true,
      analysisCurrent: false,
      validationCurrent: false,
      canReview: false,
      requiresProviderAnalysis: true
    };
  }

  const validationCurrent =
    (claim.status === "ready" || claim.status === "needs_review") &&
    validation !== null;
  if (!validationCurrent) {
    return {
      phase: "validation_required",
      documentsPresent: true,
      analysisCurrent: true,
      validationCurrent: false,
      canReview: false,
      requiresProviderAnalysis: false
    };
  }

  return {
    phase: "review",
    documentsPresent: true,
    analysisCurrent: true,
    validationCurrent: true,
    canReview: true,
    requiresProviderAnalysis: false
  };
}
