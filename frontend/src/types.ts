export type MemberIdentifierType =
  | "member_id"
  | "national_id"
  | "iqama_id";

export type MemberIdSource = "provided" | "synthetic";

export interface Member {
  memberId: string;
  memberIdSource: MemberIdSource;
  identifier: string;
  identifierType: MemberIdentifierType;
  createdAt: string;
}

export interface LoginResult {
  member: Member;
  created: boolean;
}

export type ClaimCategory =
  | "inpatient_surgery"
  | "dental"
  | "optical"
  | "other_outpatient";

export type OpticalItem = "frames" | "lenses" | "both";
export type OpticalComponent = Exclude<OpticalItem, "both">;

export type ClaimLocation = "local" | "international";

export type ClaimStatus =
  | "draft"
  | "processing"
  | "needs_review"
  | "ready"
  | "accepted_for_processing";

export type DocumentType =
  | "invoice"
  | "payment_receipt"
  | "medical_report"
  | "prescription"
  | "eye_test"
  | "discharge_summary"
  | "lab_result"
  | "imaging_result"
  | "dental_xray"
  | "other"
  | "unknown";

export type PaymentMethod =
  | "cash"
  | "card"
  | "bank_transfer"
  | "digital_wallet"
  | "cheque"
  | "other"
  | "unknown";

export type CardNetwork = "mada" | "visa" | "mastercard" | "amex" | "other";

export interface ExtractedServiceLine {
  description: string | null;
  serviceDate: string | null;
  quantity: number | null;
  unitPrice: number | null;
  billedAmount: number | null;
  currency: string | null;
  diagnosisText: string | null;
  diagnosisCode: string | null;
  procedureCode: string | null;
  sbsCode: string | null;
  sbsDescription: string | null;
  toothNumber: string | null;
}

export interface ExtractedDiagnosis {
  description: string | null;
  code: string | null;
  codingSystem: string | null;
}

export interface ExtractedProcedure {
  description: string | null;
  code: string | null;
  codingSystem: string | null;
}

export interface DocumentAnalysis {
  attachmentId: string;
  schemaVersion: number;
  extractionVersion: string;
  analysisStatus: "complete" | "needs_configuration" | "failed";
  provider: string;
  model: string | null;
  analysedAt: string;
  readability: "readable" | "unreadable" | "unclear";
  relevance: "relevant" | "irrelevant" | "unclear";
  documentType: DocumentType;
  detectedCategories: ClaimCategory[];
  detectedOpticalItems: OpticalComponent[];
  summary: string;
  extracted: {
    patientName: string | null;
    providerName: string | null;
    providerLocation: string | null;
    invoiceReference: string | null;
    invoiceDate: string | null;
    serviceDate: string | null;
    currency: string | null;
    subtotal: number | null;
    taxAmount: number | null;
    discountAmount: number | null;
    billedAmount: number | null;
    paymentStatus: "paid" | "unpaid" | "unclear";
    paymentMethod: PaymentMethod;
    cardNetwork: CardNetwork | null;
    admissionDate: string | null;
    dischargeDate: string | null;
    serviceLines: ExtractedServiceLine[];
    diagnoses: ExtractedDiagnosis[];
    procedures: ExtractedProcedure[];
    opticalFrameAmount: number | null;
    opticalLensAmount: number | null;
  };
  missingOrUnclear: string[];
  evidenceUnits?: DocumentEvidenceUnit[];
}

export interface DocumentEvidenceUnit {
  evidenceUnitId: string;
  attachmentId: string;
  pageStart: number | null;
  pageEnd: number | null;
  pageProvenance:
    | "provider_page_range"
    | "provider_attachment_level"
    | "legacy_attachment_level";
  documentType: DocumentType;
  readability: DocumentAnalysis["readability"];
  relevance: DocumentAnalysis["relevance"];
  detectedCategories: ClaimCategory[];
  detectedOpticalItems: OpticalComponent[];
  summary: string;
  extracted: DocumentAnalysis["extracted"];
  dateEvidence?: DateEvidence[];
  missingOrUnclear: string[];
}

export type DateField = "invoiceDate" | "serviceDate" | "admissionDate" | "dischargeDate";
export interface DateEvidence {
  field: DateField;
  serviceLineIndex?: number | null;
  rawText: string;
  day: number | null;
  month: number | null;
  year: number | null;
  precision: "complete" | "month_year" | "year" | "day_month" | "day_year" | "ambiguous" | "invalid";
  normalizedDate: string | null;
}

export interface ClaimSummary {
  claimId: string;
  memberId: string;
  category: ClaimCategory;
  opticalItem: OpticalItem | null;
  claimLocation: ClaimLocation;
  status: ClaimStatus;
  journey: ClaimJourney;
  createdAt: string;
  updatedAt: string;
}

export type ClaimJourneyPhase =
  | "empty"
  | "analysis_required"
  | "validation_required"
  | "review"
  | "submitted";

export interface ClaimJourney {
  phase: ClaimJourneyPhase;
  documentsPresent: boolean;
  analysisCurrent: boolean;
  validationCurrent: boolean;
  canReview: boolean;
  requiresProviderAnalysis: boolean;
}

export interface ClaimAttachment {
  attachmentId: string;
  originalFilename: string;
  mimeType: string;
  sizeBytes: number;
  documentType: string | null;
  createdAt: string;
  analysis: DocumentAnalysis | null;
}

export interface ClaimReview {
  primaryInvoiceAttachmentId?: string | null;
  primaryInvoiceEvidenceUnitId?: string | null;
  extracted: Omit<DocumentAnalysis["extracted"], "serviceLines" | "diagnoses" | "procedures"> & {
    serviceLines: Array<ExtractedServiceLine & {
      sourceAttachmentRefs: string[];
      sourceEvidenceUnitRefs: string[];
    }>;
    diagnoses: Array<ExtractedDiagnosis & {
      sourceAttachmentRefs: string[];
      sourceEvidenceUnitRefs: string[];
    }>;
    procedures: Array<ExtractedProcedure & {
      sourceAttachmentRefs: string[];
      sourceEvidenceUnitRefs: string[];
    }>;
    invoices: Array<{
      reference: string | null;
      invoiceDate: string | null;
      serviceDate: string | null;
      currency: string | null;
      subtotal: number | null;
      discountAmount: number | null;
      taxAmount: number | null;
      billedAmount: number | null;
      paymentStatus: "paid" | "unpaid" | "unclear";
      paymentMethod: PaymentMethod;
      cardNetwork: CardNetwork | null;
      sourceAttachmentRef: string;
      sourceEvidenceUnitRef: string;
      items: Array<ExtractedServiceLine & {
        sourceAttachmentRefs: string[];
        sourceEvidenceUnitRefs: string[];
      }>;
    }>;
    paymentEvidence: Array<{
      reference: string | null;
      date: string | null;
      providerName: string | null;
      currency: string | null;
      amount: number | null;
      paymentMethod: PaymentMethod;
      cardNetwork: CardNetwork | null;
      evidenceType: "paid_invoice" | "payment_receipt";
      sourceAttachmentRef: string;
      sourceEvidenceUnitRef: string;
    }>;
  };
  sources: Record<string, string[]>;
  evidenceSources: Record<string, ClaimEvidenceSource[]>;
  editedFields: MemberEditedField[];
  editedAt: string | null;
  provenance: ClaimFieldProvenance[];
  timing?: {
    profile: { profileId: string; version: string; displayName: string; source: "synthetic_demo" };
    configuredWindowDays: number | null;
    applicableDate: string | null;
    deadline: string | null;
    state: "available" | "unavailable";
    reason: "calculated" | "no_rule" | "date_unavailable";
  };
}

export type MemberEditedField =
  | "patientName"
  | "providerName"
  | "providerLocation"
  | "invoiceReference"
  | "invoiceDate"
  | "serviceDate"
  | "currency"
  | "subtotal"
  | "taxAmount"
  | "discountAmount"
  | "billedAmount"
  | "paymentStatus"
  | "paymentMethod"
  | "cardNetwork"
  | "admissionDate"
  | "dischargeDate"
  | "opticalFrameAmount"
  | "opticalLensAmount"
  | "serviceLines"
  | "diagnoses"
  | "procedures";

export interface ClaimFieldProvenance {
  field: MemberEditedField;
  sourceValue: unknown;
  memberValue: unknown | null;
  effectiveValue: unknown;
  editedByMember: boolean;
  sourceAttachmentRefs: string[];
  sourceEvidenceUnitRefs: string[];
  sourceDocumentTypes: string[];
  validationState: ValidationState;
  severity: "info" | "warning" | "blocking_error";
}

export type ValidationState =
  | "ready"
  | "needs_review"
  | "conflict"
  | "missing"
  | "invalid";

export interface ValidationIssue {
  code: string;
  state: Exclude<ValidationState, "ready">;
  field: string | null;
  attachmentId: string | null;
  evidenceUnitId?: string | null;
  pageStart?: number | null;
  pageEnd?: number | null;
  message: string;
  messageAr?: string;
  details?: string[];
  detailsAr?: string[];
  severity: "info" | "warning" | "blocking_error";
}

export interface ClaimEvidenceSource {
  attachmentId: string;
  evidenceUnitId: string;
  documentType: string;
  pageStart: number | null;
  pageEnd: number | null;
  dateEvidence?: DateEvidence[];
}

export interface ClaimValidation {
  claimId: string;
  state: ValidationState;
  readyToSubmit: boolean;
  blockingIssueCount: number;
  warningCount: number;
  infoCount: number;
  validatedAt: string;
  issues: ValidationIssue[];
}

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
  invoices: ClaimReview["extracted"]["invoices"];
  paymentEvidence: ClaimReview["extracted"]["paymentEvidence"];
  items: ClaimReview["extracted"]["serviceLines"];
  clinical: {
    admissionDate: string | null;
    dischargeDate: string | null;
    diagnoses: ClaimReview["extracted"]["diagnoses"];
    procedures: ClaimReview["extracted"]["procedures"];
  };
  attachments: Array<{
    referenceId: string;
    filename: string;
    documentType: string;
  }>;
  sources: Record<string, string[]>;
  provenance: ClaimFieldProvenance[];
  intake: {
    readyToSubmit: boolean;
    blockingIssueCount: number;
    warningCount: number;
    acceptedForProcessing: true;
  };
  validationSnapshot: ClaimValidation;
  unresolvedWarnings: ValidationIssue[];
  rawDocumentExtractions: Array<{
    attachmentReference: string;
    filename: string;
    analysis: DocumentAnalysis;
  }>;
  internalUncertainty: Array<{
    attachmentReference: string;
    level: "low" | "medium" | "high" | "unknown";
    reasons: string[];
  }>;
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

export interface ClaimDetail extends ClaimSummary {
  attachments: ClaimAttachment[];
  review: ClaimReview;
  submission: ClaimSubmission | null;
  validation: ClaimValidation | null;
}
