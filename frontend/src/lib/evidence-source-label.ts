import type {
  ClaimAttachment,
  ClaimEvidenceSource,
  ValidationIssue
} from "../types";
import { documentRoleLabel } from "./document-role-label";

type EvidenceSourceDescriptor = Pick<
  ClaimEvidenceSource,
  "documentType" | "pageStart" | "pageEnd"
>;

export function evidenceSourceLabel(
  source: EvidenceSourceDescriptor,
  isArabic: boolean
) {
  return `${documentRoleLabel(source.documentType, isArabic)} · ${pageRangeLabel(
    source.pageStart,
    source.pageEnd,
    isArabic
  )}`;
}

export function evidenceSourceLabels(
  sources: readonly ClaimEvidenceSource[] | undefined,
  isArabic: boolean
) {
  return [...new Set((sources ?? []).map((source) =>
    evidenceSourceLabel(source, isArabic)
  ))];
}

export function validationIssueEvidenceSourceLabel(
  issue: ValidationIssue,
  attachments: readonly ClaimAttachment[],
  isArabic: boolean
) {
  const attachment = issue.attachmentId
    ? attachments.find((item) => item.attachmentId === issue.attachmentId)
    : null;
  if (!attachment?.analysis) return null;

  const unit = issue.evidenceUnitId
    ? attachment.analysis.evidenceUnits?.find((item) =>
        item.evidenceUnitId === issue.evidenceUnitId
      )
    : null;
  return evidenceSourceLabel({
    documentType: unit?.documentType ?? attachment.analysis.documentType,
    pageStart: unit?.pageStart ?? issue.pageStart ?? null,
    pageEnd: unit?.pageEnd ?? issue.pageEnd ?? null
  }, isArabic);
}

export function pageRangeLabel(
  pageStart: number | null | undefined,
  pageEnd: number | null | undefined,
  isArabic: boolean
) {
  if (pageStart === null || pageStart === undefined) {
    return isArabic ? "المستند المرفوع" : "Uploaded document";
  }
  if (pageEnd && pageEnd !== pageStart) {
    return isArabic
      ? `الصفحات ${pageStart}–${pageEnd}`
      : `pages ${pageStart}–${pageEnd}`;
  }
  return isArabic ? `الصفحة ${pageStart}` : `page ${pageStart}`;
}
