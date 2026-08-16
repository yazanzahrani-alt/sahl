import type { ClaimCategory, ClaimLocation, OpticalItem } from "./claim";
import type {
  ClaimFieldProvenance,
  ConsolidatedInvoice,
  ConsolidatedPaymentEvidence,
  MemberEditedField,
  SourceLinkedDiagnosis,
  SourceLinkedProcedure,
  SourceLinkedServiceLine
} from "./claim-review";
import type { DocumentAnalysisResult } from "../document-intelligence/document-analysis";
import type { ClaimValidationResult, ValidationIssue } from "../validation/validation";

export interface InternalExtractionUncertainty {
  attachmentReference: string;
  level: "low" | "medium" | "high" | "unknown";
  reasons: string[];
}

type SubmissionServiceLine = Omit<SourceLinkedServiceLine, "sourceEvidenceUnitRefs">;
type SubmissionDiagnosis = Omit<SourceLinkedDiagnosis, "sourceEvidenceUnitRefs">;
type SubmissionProcedure = Omit<SourceLinkedProcedure, "sourceEvidenceUnitRefs">;
type SubmissionInvoice = Omit<ConsolidatedInvoice, "sourceEvidenceUnitRef" | "items"> & {
  items: SubmissionServiceLine[];
};
type SubmissionPaymentEvidence = Omit<ConsolidatedPaymentEvidence, "sourceEvidenceUnitRef">;
type SubmissionProvenance = Omit<ClaimFieldProvenance, "sourceEvidenceUnitRefs">;
export type SubmissionValidationIssueV12 = Pick<
  ValidationIssue,
  "code" | "state" | "field" | "attachmentId" | "message" | "severity"
>;
export type SubmissionValidationSnapshotV12 = Omit<ClaimValidationResult, "issues"> & {
  issues: SubmissionValidationIssueV12[];
};

export interface SubmissionPayload {
  schemaVersion: "1.2";
  claim: {
    referenceId: string;
    member: { referenceId: string };
    category: ClaimCategory;
    opticalItem: OpticalItem | null;
    location: ClaimLocation;
    submittedAt: string;
    status: "accepted_for_processing";
  };
  patient: { name: string | null };
  provider: { name: string | null; location: string | null };
  invoices: SubmissionInvoice[];
  paymentEvidence: SubmissionPaymentEvidence[];
  items: SubmissionServiceLine[];
  clinical: {
    admissionDate: string | null;
    dischargeDate: string | null;
    diagnoses: SubmissionDiagnosis[];
    procedures: SubmissionProcedure[];
  };
  attachments: Array<{
    referenceId: string;
    filename: string;
    documentType: string;
  }>;
  sources: Record<string, string[]>;
  provenance: SubmissionProvenance[];
  intake: {
    readyToSubmit: boolean;
    blockingIssueCount: number;
    warningCount: number;
    acceptedForProcessing: true;
  };
  validationSnapshot: SubmissionValidationSnapshotV12;
  unresolvedWarnings: SubmissionValidationIssueV12[];
  rawDocumentExtractions: Array<{
    attachmentReference: string;
    filename: string;
    analysis: DocumentAnalysisResult;
  }>;
  internalUncertainty: InternalExtractionUncertainty[];
  memberEdits?: {
    fields: MemberEditedField[];
    updatedAt: string;
  };
}

export interface ClaimSubmission {
  claimId: string;
  acceptanceReference: string;
  submittedAt: string;
  payload: SubmissionPayload;
}
