import type {
  CardNetwork,
  ExtractedDiagnosis,
  ExtractedDocumentFields,
  ExtractedProcedure,
  ExtractedServiceLine,
  PaymentMethod
} from "../document-intelligence/document-analysis";
import type { DateEvidence } from "../document-intelligence/date-evidence";
import type { ValidationSeverity, ValidationState } from "../validation/validation";
import type { SubmissionTiming } from "./synthetic-demo-policy";

export interface SourceLinkedServiceLine extends ExtractedServiceLine {
  sourceAttachmentRefs: string[];
  sourceEvidenceUnitRefs: string[];
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
  severity: ValidationSeverity;
}

export interface SourceLinkedDiagnosis extends ExtractedDiagnosis {
  sourceAttachmentRefs: string[];
  sourceEvidenceUnitRefs: string[];
}

export interface SourceLinkedProcedure extends ExtractedProcedure {
  sourceAttachmentRefs: string[];
  sourceEvidenceUnitRefs: string[];
}

export interface ConsolidatedInvoice {
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
  items: SourceLinkedServiceLine[];
}

export interface ConsolidatedPaymentEvidence {
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
}

export interface ClaimEvidenceSource {
  attachmentId: string;
  evidenceUnitId: string;
  documentType: string;
  pageStart: number | null;
  pageEnd: number | null;
  dateEvidence?: DateEvidence[];
}

export interface ClaimReviewTiming extends SubmissionTiming {}

export interface ConsolidatedClaimFields extends Omit<
  ExtractedDocumentFields,
  "serviceLines" | "diagnoses" | "procedures"
> {
  serviceLines: SourceLinkedServiceLine[];
  diagnoses: SourceLinkedDiagnosis[];
  procedures: SourceLinkedProcedure[];
  invoices: ConsolidatedInvoice[];
  paymentEvidence: ConsolidatedPaymentEvidence[];
}
