export const CLAIM_CATEGORIES = [
  "inpatient_surgery",
  "dental",
  "optical",
  "other_outpatient"
] as const;

export type ClaimCategory = (typeof CLAIM_CATEGORIES)[number];

export const OPTICAL_ITEMS = ["frames", "lenses", "both"] as const;

export type OpticalItem = (typeof OPTICAL_ITEMS)[number];
export type OpticalComponent = Exclude<OpticalItem, "both">;

export const CLAIM_LOCATIONS = ["local", "international"] as const;

export type ClaimLocation = (typeof CLAIM_LOCATIONS)[number];

export const CLAIM_STATUSES = [
  "draft",
  "processing",
  "needs_review",
  "ready",
  "accepted_for_processing"
] as const;

export type ClaimStatus = (typeof CLAIM_STATUSES)[number];

export const CLAIM_JOURNEY_PHASES = [
  "empty",
  "analysis_required",
  "validation_required",
  "review",
  "submitted"
] as const;

export type ClaimJourneyPhase = (typeof CLAIM_JOURNEY_PHASES)[number];

export interface ClaimJourney {
  phase: ClaimJourneyPhase;
  documentsPresent: boolean;
  analysisCurrent: boolean;
  validationCurrent: boolean;
  canReview: boolean;
  requiresProviderAnalysis: boolean;
}

export interface ClaimRecord {
  claimId: string;
  memberId: string;
  category: ClaimCategory;
  opticalItem: OpticalItem | null;
  claimLocation: ClaimLocation;
  status: ClaimStatus;
  createdAt: Date;
  updatedAt: Date;
}
