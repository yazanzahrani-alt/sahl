import type { ValidationIssue } from "../types";

export type ValidationIssueActionKind =
  | "none"
  | "edit_claim_information"
  | "edit_claim_details"
  | "change_claim_type"
  | "review_claim_type"
  | "replace_document"
  | "add_document"
  | "review_document"
  | "confirm_warning";

export interface InvoiceActionContext {
  primaryInvoiceAttachmentId: string | null;
  primaryInvoiceEvidenceUnitId: string | null;
  invoiceSourceAttachmentIds: string[];
  invoiceSourceEvidenceUnitIds: string[];
}

const DOCUMENT_ROOT_CODES = new Set([
  "document_unreadable",
  "document_unverifiable",
  "document_irrelevant"
]);

const DOCUMENT_REVIEW_CODES = new Set([
  "document_optional_unreadable"
]);

const MISSING_DOCUMENT_CODES = new Set([
  "invoice_missing",
  "payment_evidence_missing",
  "inpatient_document_missing",
  "dental_document_missing",
  "optical_document_missing",
  "other_outpatient_document_missing"
]);

export function resolveValidationIssueAction(
  issue: ValidationIssue,
  invoiceContext: InvoiceActionContext,
  confirmable: boolean
): ValidationIssueActionKind {
  if (issue.severity === "info") return "none";
  if (issue.code === "category_mismatch") return "change_claim_type";
  if (issue.code === "category_unclear") return "review_claim_type";
  if (issue.field === "opticalItem") return "edit_claim_details";

  if (DOCUMENT_ROOT_CODES.has(issue.code) || issue.code.endsWith("_insufficient")) {
    return "replace_document";
  }
  if (DOCUMENT_REVIEW_CODES.has(issue.code)) return "review_document";
  if (issue.code.endsWith("_uncertain") && issue.attachmentId) {
    return "review_document";
  }
  if (MISSING_DOCUMENT_CODES.has(issue.code)) return "add_document";
  if (issue.state === "needs_review" && confirmable) return "confirm_warning";

  const isSecondaryInvoiceUnitIssue = issue.evidenceUnitId !== null &&
    issue.evidenceUnitId !== undefined &&
    invoiceContext.invoiceSourceEvidenceUnitIds.length > 1 &&
    issue.evidenceUnitId !== invoiceContext.primaryInvoiceEvidenceUnitId &&
    invoiceContext.invoiceSourceEvidenceUnitIds.includes(issue.evidenceUnitId);
  if (isSecondaryInvoiceUnitIssue) return "replace_document";

  const isSecondaryInvoiceIssue = !issue.evidenceUnitId &&
    invoiceContext.invoiceSourceAttachmentIds.length > 1 &&
    issue.attachmentId !== null &&
    issue.attachmentId !== invoiceContext.primaryInvoiceAttachmentId &&
    invoiceContext.invoiceSourceAttachmentIds.includes(issue.attachmentId);
  if (isSecondaryInvoiceIssue) return "replace_document";

  return "edit_claim_information";
}

export function validationIssueActionLabel(
  kind: ValidationIssueActionKind,
  isArabic: boolean
) {
  const labels: Record<Exclude<ValidationIssueActionKind, "none" | "confirm_warning">, [string, string]> = {
    edit_claim_information: ["Check information", "تحقق من المعلومات"],
    edit_claim_details: ["Edit claim details", "تعديل تفاصيل المطالبة"],
    change_claim_type: ["Change claim type", "تغيير نوع المطالبة"],
    review_claim_type: ["Review claim type", "مراجعة نوع المطالبة"],
    replace_document: ["Replace document", "استبدال المستند"],
    add_document: ["Add document", "إضافة مستند"],
    review_document: ["Review document", "مراجعة المستند"]
  };
  if (kind === "none" || kind === "confirm_warning") return "";
  return labels[kind][isArabic ? 1 : 0];
}

export function documentCorrectionHref(claimId: string, attachmentId: string | null) {
  const base = `/claims/${claimId}/documents`;
  return attachmentId
    ? `${base}?attachment=${encodeURIComponent(attachmentId)}`
    : base;
}

export function validationIssueSourceFilename(
  issue: ValidationIssue,
  attachmentNames: Map<string, string>
) {
  return issue.attachmentId ? attachmentNames.get(issue.attachmentId) : undefined;
}
