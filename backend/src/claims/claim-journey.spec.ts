import type { AttachmentRecord } from "./attachment";
import type { ClaimRecord } from "./claim";
import { deriveClaimJourney } from "./claim-journey";
import type { ClaimValidationResult } from "../validation/validation";

const claim: ClaimRecord = {
  claimId: "CLM-RESUME",
  memberId: "00123456",
  category: "inpatient_surgery",
  opticalItem: null,
  claimLocation: "local",
  status: "ready",
  createdAt: new Date("2026-08-01T00:00:00.000Z"),
  updatedAt: new Date("2026-08-01T00:00:00.000Z")
};

const attachment = {
  attachmentId: "ATT-MIXED",
  originalFilename: "mixed.pdf",
  mimeType: "application/pdf",
  sizeBytes: 100,
  documentType: "invoice",
  createdAt: new Date("2026-08-01T00:00:00.000Z"),
  analysis: { analysisStatus: "complete" }
} as AttachmentRecord;

const validation: ClaimValidationResult = {
  claimId: claim.claimId,
  state: "ready",
  readyToSubmit: true,
  blockingIssueCount: 0,
  warningCount: 0,
  infoCount: 0,
  validatedAt: "2026-08-01T00:00:00.000Z",
  issues: []
};

describe("resumable claim journey", () => {
  const current = () => true;

  it("reconstructs an analyzed and validated claim after repeated reloads", () => {
    const first = deriveClaimJourney(claim, [attachment], validation, current);
    const reloaded = deriveClaimJourney({ ...claim }, [{ ...attachment }], { ...validation }, current);

    expect(first).toEqual(reloaded);
    expect(reloaded).toMatchObject({
      phase: "review",
      analysisCurrent: true,
      validationCurrent: true,
      canReview: true,
      requiresProviderAnalysis: false
    });
  });

  it("distinguishes extraction retry from deterministic revalidation", () => {
    expect(deriveClaimJourney(
      { ...claim, status: "draft" },
      [{ ...attachment, analysis: null }],
      null,
      () => false
    )).toMatchObject({ phase: "analysis_required", requiresProviderAnalysis: true });

    expect(deriveClaimJourney(
      { ...claim, status: "draft" },
      [attachment],
      null,
      current
    )).toMatchObject({
      phase: "validation_required",
      analysisCurrent: true,
      requiresProviderAnalysis: false
    });
  });

  it("keeps successful analysis with blockers resumable", () => {
    const blocked = {
      ...validation,
      state: "conflict" as const,
      readyToSubmit: false,
      blockingIssueCount: 1
    };
    expect(deriveClaimJourney(
      { ...claim, status: "needs_review" },
      [attachment],
      blocked,
      current
    )).toMatchObject({ phase: "review", canReview: true });
  });

  it("keeps submitted claims terminal regardless of later extraction configuration", () => {
    expect(deriveClaimJourney(
      { ...claim, status: "accepted_for_processing" },
      [attachment],
      validation,
      () => false
    )).toMatchObject({
      phase: "submitted",
      canReview: false,
      requiresProviderAnalysis: false
    });
  });
});
