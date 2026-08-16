import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { AuthProvider } from "../src/auth/auth-context";
import { LanguageProvider } from "../src/i18n/language-context";
import { ThemeProvider } from "../src/theme/theme-context";
import { ClaimsPage } from "../src/pages/claims-page";
import { ClaimDocumentsPage } from "../src/pages/claim-documents-page";
import { ClaimReviewPage } from "../src/pages/claim-review-page";
import { LoginPage } from "../src/pages/login-page";
import {
  DemoUploadNotice,
  DocumentValidationIssue,
  ReviewSubmissionAction,
  ReviewSummaryValue,
  ValidationIssueDetails
} from "../src/components/claim-validation-presentation";
import { OpsEvidenceUnitPipeline } from "../src/components/ops-evidence-unit-pipeline";
import { BupaMark } from "../src/components/brand-mark";
import { DelayedPageState } from "../src/components/ui";
import { documentRoleLabel } from "../src/lib/document-role-label";
import {
  claimJourneyActionLabel,
  claimJourneyDestination,
  reviewReentryDestination
} from "../src/lib/claim-journey";
import {
  evidenceSourceLabel,
  validationIssueEvidenceSourceLabel
} from "../src/lib/evidence-source-label";
import {
  documentCorrectionHref,
  resolveValidationIssueAction,
  validationIssueActionLabel,
  validationIssueSourceFilename
} from "../src/lib/validation-action";
import { validationIssueMessage } from "../src/lib/validation-copy";
import type {
  ClaimAttachment,
  ClaimDetail,
  ClaimJourney,
  ClaimSummary,
  SubmissionPayload,
  ValidationIssue
} from "../src/types";

function issue(severity: ValidationIssue["severity"]): ValidationIssue {
  return {
    code: `test_${severity}`,
    state: severity === "warning" ? "conflict" : "missing",
    field: null,
    attachmentId: null,
    message: "Test issue",
    severity
  };
}

function submitMarkup({
  ready,
  blockingCount,
  warningCount = 0
}: {
  ready: boolean;
  blockingCount: number;
  warningCount?: number;
}) {
  return renderToStaticMarkup(
    <ReviewSubmissionAction
      submitting={false}
      ready={ready}
      blockingCount={blockingCount}
      warningCount={warningCount}
      isArabic={false}
      onSubmit={() => undefined}
    />
  );
}

describe("Change Set 1 presentation semantics", () => {
  it("renders an optional missing value with a neutral, non-warning tone", () => {
    const html = renderToStaticMarkup(
      <ReviewSummaryValue label="VAT / tax" value="Not found" isArabic={false} />
    );

    assert.match(html, /data-semantic-tone="neutral"/);
    assert.match(html, /text-\[#687a96\]/);
    assert.doesNotMatch(html, /Required action|>Warning<|bg-\[#fffaf2\]|bg-\[#fff7f5\]/);
  });

  it("renders warning semantics while leaving submit enabled without blockers", () => {
    const warningHtml = renderToStaticMarkup(
      <DocumentValidationIssue
        issue={issue("warning")}
        message="Review the printed amount."
        isArabic={false}
      />
    );
    const submitHtml = submitMarkup({ ready: true, blockingCount: 0, warningCount: 1 });

    assert.match(warningHtml, /data-severity="warning"/);
    assert.match(warningHtml, />Warning</);
    assert.match(warningHtml, /bg-\[#fffaf2\]/);
    assert.match(submitHtml, /Warnings do not block submission\./);
    assert.doesNotMatch(submitHtml, /<button[^>]*\sdisabled=""/);
  });

  it("keeps a blocker-visible submit action genuinely disabled", () => {
    const blockerHtml = renderToStaticMarkup(
      <DocumentValidationIssue
        issue={issue("blocking_error")}
        message="Upload the required invoice."
        isArabic={false}
      />
    );
    const submitHtml = submitMarkup({ ready: false, blockingCount: 1 });

    assert.match(blockerHtml, /data-severity="blocking_error"/);
    assert.match(blockerHtml, /Required action/);
    assert.match(submitHtml, /Submit for processing/);
    assert.match(submitHtml, /<button[^>]*\sdisabled=""/);
    assert.match(submitHtml, /aria-describedby="claim-submit-readiness"/);
    assert.match(submitHtml, /aria-live="polite"/);
  });

  it("uses correct singular and plural blocker explanations", () => {
    assert.match(
      submitMarkup({ ready: false, blockingCount: 1 }),
      /Fix 1 required issue before submitting\./
    );
    assert.match(
      submitMarkup({ ready: false, blockingCount: 3 }),
      /Fix 3 required issues before submitting\./
    );
  });

  it("enables submit when blocking issues reach zero", () => {
    const html = submitMarkup({ ready: true, blockingCount: 0 });

    assert.match(html, /data-readiness="ready"/);
    assert.match(html, /Submission checks are complete\./);
    assert.doesNotMatch(html, /<button[^>]*\sdisabled=""/);
  });

  it("renders document blockers distinctly from warnings without relying on color alone", () => {
    const blockerHtml = renderToStaticMarkup(
      <DocumentValidationIssue issue={issue("blocking_error")} message="Missing invoice" isArabic={false} />
    );
    const warningHtml = renderToStaticMarkup(
      <DocumentValidationIssue issue={issue("warning")} message="Review amount" isArabic={false} />
    );

    assert.match(blockerHtml, /Required action/);
    assert.match(blockerHtml, /bg-\[#fff7f5\]/);
    assert.match(warningHtml, />Warning</);
    assert.match(warningHtml, /bg-\[#fffaf2\]/);
  });

  it("renders the synthetic/test-document demo notice", () => {
    const html = renderToStaticMarkup(<DemoUploadNotice isArabic={false} />);

    assert.match(html, /role="note"/);
    assert.match(html, /Demo environment — use synthetic or test documents only\./);
  });

  const arabicRoles = [
    ["invoice", "فاتورة"],
    ["payment_receipt", "إيصال دفع"],
    ["medical_report", "تقرير طبي"],
    ["discharge_summary", "ملخص خروج"],
    ["eye_test", "فحص نظر"],
    ["prescription", "وصفة طبية"],
    ["dental_xray", "أشعة أسنان"],
    ["lab_result", "نتيجة مختبر"],
    ["imaging_result", "نتيجة أشعة"],
    ["other", "مستند آخر"],
    ["unknown", "غير معروف"]
  ] as const;

  for (const [role, expected] of arabicRoles) {
    it(`renders the Arabic ${role} document-role label`, () => {
      assert.equal(documentRoleLabel(role, true), expected);
    });
  }
});

describe("Change Set 2 correction targeting", () => {
  const invoiceContext = {
    primaryInvoiceAttachmentId: "ATT-INVOICE-A",
    primaryInvoiceEvidenceUnitId: "UNIT-INVOICE-A",
    invoiceSourceAttachmentIds: ["ATT-INVOICE-A", "ATT-INVOICE-B"],
    invoiceSourceEvidenceUnitIds: ["UNIT-INVOICE-A", "UNIT-INVOICE-B"]
  };

  it("keeps a primary invoice issue in the member information editor", () => {
    const primary = validationIssue({
      code: "invoice_billedAmount_missing",
      field: "billedAmount",
      attachmentId: "ATT-INVOICE-A"
    });

    assert.equal(resolveValidationIssueAction(primary, invoiceContext, false), "edit_claim_information");
  });

  it("targets a secondary invoice blocker for source-document replacement", () => {
    const secondary = validationIssue({
      code: "invoice_billedAmount_missing",
      field: "billedAmount",
      attachmentId: "ATT-INVOICE-B"
    });

    assert.equal(resolveValidationIssueAction(secondary, invoiceContext, false), "replace_document");
    assert.equal(
      documentCorrectionHref("CLM-1", secondary.attachmentId),
      "/claims/CLM-1/documents?attachment=ATT-INVOICE-B"
    );
    assert.notEqual(
      documentCorrectionHref("CLM-1", secondary.attachmentId),
      "/claims/CLM-1/documents?attachment=ATT-INVOICE-A"
    );
  });

  it("uses authoritative attachment identity when an itemized receipt precedes the primary invoice", () => {
    const receiptFirstContext = {
      primaryInvoiceAttachmentId: "ATT-INVOICE-A",
      primaryInvoiceEvidenceUnitId: "UNIT-INVOICE-A",
      invoiceSourceAttachmentIds: ["ATT-RECEIPT", "ATT-INVOICE-A", "ATT-INVOICE-B"],
      invoiceSourceEvidenceUnitIds: ["UNIT-RECEIPT", "UNIT-INVOICE-A", "UNIT-INVOICE-B"]
    };
    const primary = validationIssue({ attachmentId: "ATT-INVOICE-A" });
    const secondary = validationIssue({ attachmentId: "ATT-INVOICE-B" });

    assert.equal(
      resolveValidationIssueAction(primary, receiptFirstContext, false),
      "edit_claim_information"
    );
    assert.equal(
      resolveValidationIssueAction(secondary, receiptFirstContext, false),
      "replace_document"
    );
  });

  it("routes two invoice units in one attachment by authoritative unit identity", () => {
    const sameAttachmentContext = {
      primaryInvoiceAttachmentId: "ATT-MIXED",
      primaryInvoiceEvidenceUnitId: "UNIT-INVOICE-1",
      invoiceSourceAttachmentIds: ["ATT-MIXED", "ATT-MIXED"],
      invoiceSourceEvidenceUnitIds: ["UNIT-INVOICE-1", "UNIT-INVOICE-2"]
    };
    const primary = validationIssue({
      attachmentId: "ATT-MIXED",
      evidenceUnitId: "UNIT-INVOICE-1"
    });
    const secondary = validationIssue({
      attachmentId: "ATT-MIXED",
      evidenceUnitId: "UNIT-INVOICE-2"
    });

    assert.equal(
      resolveValidationIssueAction(primary, sameAttachmentContext, false),
      "edit_claim_information"
    );
    assert.equal(
      resolveValidationIssueAction(secondary, sameAttachmentContext, false),
      "replace_document"
    );
  });

  it("keeps attachment targeting deterministic when source filenames are duplicated", () => {
    const secondary = validationIssue({ attachmentId: "ATT-INVOICE-B" });
    const names = new Map([
      ["ATT-INVOICE-A", "invoice.pdf"],
      ["ATT-INVOICE-B", "invoice.pdf"]
    ]);

    assert.equal(validationIssueSourceFilename(secondary, names), "invoice.pdf");
    assert.equal(
      documentCorrectionHref("CLM-1", secondary.attachmentId),
      "/claims/CLM-1/documents?attachment=ATT-INVOICE-B"
    );
  });

  it("keeps a confirmable secondary warning as review and confirmation", () => {
    const warning = validationIssue({
      code: "invoice_reference_unclear",
      state: "needs_review",
      severity: "warning",
      attachmentId: "ATT-INVOICE-B"
    });

    assert.equal(resolveValidationIssueAction(warning, invoiceContext, true), "confirm_warning");
  });

  it("shows the filename belonging to the issue source", () => {
    const secondary = validationIssue({ attachmentId: "ATT-INVOICE-B" });
    const names = new Map([
      ["ATT-INVOICE-A", "primary-invoice.pdf"],
      ["ATT-INVOICE-B", "secondary-invoice.pdf"]
    ]);

    assert.equal(validationIssueSourceFilename(secondary, names), "secondary-invoice.pdf");
  });

  it("routes insufficient and uncertain support evidence to its attachment", () => {
    const absent = validationIssue({
      code: "inpatient_document_missing",
      field: "supportingDocument",
      attachmentId: null
    });
    const insufficient = validationIssue({
      code: "medical_report_insufficient",
      attachmentId: "ATT-REPORT"
    });
    const uncertain = validationIssue({
      code: "eye_test_uncertain",
      state: "needs_review",
      severity: "warning",
      attachmentId: "ATT-EYE"
    });

    assert.equal(resolveValidationIssueAction(absent, invoiceContext, false), "add_document");
    assert.equal(resolveValidationIssueAction(insufficient, invoiceContext, false), "replace_document");
    assert.equal(resolveValidationIssueAction(uncertain, invoiceContext, false), "review_document");
    assert.equal(validationIssueActionLabel("add_document", false), "Add document");
    assert.equal(validationIssueActionLabel("replace_document", false), "Replace document");
    assert.equal(validationIssueActionLabel("review_document", true), "مراجعة المستند");
  });

  it("routes an unreadable optional document to review without turning its warning into replacement", () => {
    const warning = validationIssue({
      code: "document_optional_unreadable",
      state: "needs_review",
      field: "attachment",
      attachmentId: "ATT-OPTIONAL",
      evidenceUnitId: "UNIT-OPTIONAL",
      severity: "warning"
    });

    assert.equal(resolveValidationIssueAction(warning, invoiceContext, false), "review_document");
  });

  it("gives mismatch and uncertainty explicit claim-type recovery actions", () => {
    const mismatch = validationIssue({ code: "category_mismatch", field: "category" });
    const unclear = validationIssue({
      code: "category_unclear",
      field: "category",
      state: "needs_review",
      severity: "warning"
    });

    assert.equal(resolveValidationIssueAction(mismatch, invoiceContext, false), "change_claim_type");
    assert.equal(resolveValidationIssueAction(unclear, invoiceContext, true), "review_claim_type");
    assert.equal(validationIssueActionLabel("change_claim_type", false), "Change claim type");
    assert.equal(validationIssueActionLabel("review_claim_type", true), "مراجعة نوع المطالبة");
  });

  it("localizes every new evidence-completeness issue", () => {
    for (const code of [
      "medical_report_insufficient",
      "discharge_summary_insufficient",
      "eye_test_insufficient",
      "prescription_insufficient",
      "eye_test_uncertain",
      "prescription_uncertain"
    ]) {
      const item = validationIssue({ code, message: `English ${code}` });
      assert.equal(validationIssueMessage(item, false), `English ${code}`);
      assert.notEqual(
        validationIssueMessage(item, true),
        "راجع هذه المعلومة قبل إرسال المطالبة."
      );
    }
  });

  it("prefers backend-provided Arabic root-cause copy", () => {
    const item = validationIssue({
      code: "category_mismatch",
      message: "English root cause",
      messageAr: "سبب جذري عربي"
    });
    assert.equal(validationIssueMessage(item, true), "سبب جذري عربي");
  });

  it("discloses unit page provenance and grouped root-cause details", () => {
    const html = renderToStaticMarkup(<ValidationIssueDetails
      issue={validationIssue({
        pageStart: 2,
        pageEnd: 4,
        details: ["Dental evidence was detected."]
      })}
      isArabic={false}
    />);

    assert.match(html, /Page 2–4/);
    assert.match(html, /View details/);
    assert.match(html, /Dental evidence was detected./);
  });
});

describe("Change Set 3C resumable journey and evidence-unit presentation", () => {
  const journey = (phase: ClaimJourney["phase"]): ClaimJourney => ({
    phase,
    documentsPresent: phase !== "empty",
    analysisCurrent: ["validation_required", "review", "submitted"].includes(phase),
    validationCurrent: ["review", "submitted"].includes(phase),
    canReview: phase === "review",
    requiresProviderAnalysis: phase === "analysis_required"
  });

  it("gives analyzed claims an authoritative Continue to review action", () => {
    const claim = { claimId: "CLM-1", journey: journey("review") };
    assert.equal(claimJourneyActionLabel(claim.journey, false), "Continue to review");
    assert.equal(claimJourneyDestination(claim), "/claims/CLM-1/review");
    assert.equal(reviewReentryDestination(claim), null);
  });

  it("distinguishes document analysis, deterministic revalidation, and submission", () => {
    assert.equal(claimJourneyActionLabel(journey("analysis_required"), false), "Analyze and continue");
    assert.equal(claimJourneyActionLabel(journey("validation_required"), false), "Revalidate claim");
    assert.equal(
      reviewReentryDestination({ claimId: "CLM-STALE", journey: journey("validation_required") }),
      "/claims/CLM-STALE/documents"
    );
    assert.equal(
      claimJourneyDestination({ claimId: "CLM-SUBMITTED", journey: journey("submitted") }),
      "/claims/CLM-SUBMITTED/submitted"
    );
  });

  it("keeps a grouped Keep-Type blocker reviewable after navigation", () => {
    const mismatch = validationIssue({
      code: "category_mismatch",
      field: "category",
      evidenceUnitId: "ATT-DENTAL:evidence:unit:private",
      pageStart: 1,
      details: ["Dental evidence was detected."]
    });
    const claim = { claimId: "CLM-KEEP-TYPE", journey: journey("review") };

    assert.equal(reviewReentryDestination(claim), null);
    assert.equal(resolveValidationIssueAction(mismatch, {
      primaryInvoiceAttachmentId: null,
      primaryInvoiceEvidenceUnitId: null,
      invoiceSourceAttachmentIds: [],
      invoiceSourceEvidenceUnitIds: []
    }, false), "change_claim_type");
    assert.match(renderToStaticMarkup(
      <ValidationIssueDetails issue={mismatch} isArabic={false} />
    ), /Dental evidence was detected/);
  });

  it("renders human-readable member sources without technical evidence-unit IDs", () => {
    const source = {
      attachmentId: "ATT-MIXED",
      evidenceUnitId: "ATT-MIXED:evidence:unit:secret-hash",
      documentType: "medical_report",
      pageStart: 2,
      pageEnd: 3
    };
    const html = renderToStaticMarkup(
      <ReviewSummaryValue
        label="Diagnosis"
        value="Printed diagnosis"
        sourceNames={[evidenceSourceLabel(source, false)]}
        isArabic={false}
      />
    );

    assert.match(html, /Medical Report · pages 2–3/);
    assert.doesNotMatch(html, /secret-hash|evidence:unit/);
  });

  it("shows a unit-aware issue source while replacement still targets its attachment", () => {
    const attachment = mixedAttachment();
    attachment.analysis!.evidenceUnits = attachment.analysis!.evidenceUnits!.map((unit) =>
      unit.evidenceUnitId === "UNIT-REPORT" ? { ...unit, pageEnd: 3 } : unit
    );
    const attachments = [attachment];
    const item = validationIssue({
      attachmentId: "ATT-MIXED",
      evidenceUnitId: "UNIT-REPORT",
      pageStart: 2,
      pageEnd: 3
    });
    assert.equal(
      validationIssueEvidenceSourceLabel(item, attachments, false),
      "Medical Report · pages 2–3"
    );
    assert.equal(
      documentCorrectionHref("CLM-1", item.attachmentId),
      "/claims/CLM-1/documents?attachment=ATT-MIXED"
    );
  });

  it("renders three evidence roles inside one Ops attachment", () => {
    const html = renderToStaticMarkup(
      <OpsEvidenceUnitPipeline payload={opsPayload(false)} isArabic={false} />
    );

    assert.match(html, /3 evidence units in one attachment/);
    assert.match(html, /Invoice · page 1/);
    assert.match(html, /Medical Report · page 2/);
    assert.match(html, /Payment Receipt · page 3/);
    assert.match(html, /Invoice summary/);
    assert.match(html, /Clinical summary/);
    assert.match(html, /Payment summary/);
    assert.equal((html.match(/data-attachment-reference="ATT-MIXED"/g) ?? []).length, 1);
  });

  it("renders a legacy attachment as one safe attachment-level Ops unit", () => {
    const html = renderToStaticMarkup(
      <OpsEvidenceUnitPipeline payload={opsPayload(true)} isArabic={false} />
    );

    assert.match(html, /1 evidence unit in one attachment/);
    assert.match(html, /Invoice · Uploaded document/);
    assert.doesNotMatch(html, /legacy-display/);
  });
});

describe("Change Set 3C direct page regressions", () => {
  it("renders authoritative actions in the actual Claims page", () => {
    const html = renderPage(
      <ClaimsPage initialClaims={[
        claimSummary("CLM-REVIEW", "review", "ready"),
        claimSummary("CLM-ANALYZE", "analysis_required", "draft"),
        claimSummary("CLM-REVALIDATE", "validation_required", "draft"),
        claimSummary("CLM-SUBMITTED", "submitted", "accepted_for_processing")
      ]} />,
      "/claims"
    );

    assert.match(html, /Continue to review/);
    assert.match(html, /Analyze and continue/);
    assert.match(html, /Revalidate claim/);
    assert.match(html, /View submitted claim/);

    const staleOnly = renderPage(
      <ClaimsPage initialClaims={[
        claimSummary("CLM-ANALYZE", "analysis_required", "ready")
      ]} />,
      "/claims"
    );
    assert.match(staleOnly, /Needs analysis/);
    assert.doesNotMatch(staleOnly, />Ready</);
  });

  it("keeps the prepared validation presentation and forward CTA together on Documents", () => {
    const html = renderClaimDocuments(claimDetail("review"));

    assert.match(html, /Submission checks complete/);
    assert.match(html, /No issues were found\. Your claim is ready for final review\./);
    assert.match(html, /Continue to review/);
  });

  it("renders revalidation, analysis retry, and submitted Documents states directly", () => {
    assert.match(
      renderClaimDocuments(claimDetail("validation_required")),
      /Revalidate claim/
    );
    assert.match(
      renderClaimDocuments(claimDetail("analysis_required")),
      /Analyze and continue/
    );
    assert.match(
      renderClaimDocuments(claimDetail("analysis_required", "failed")),
      /Try again/
    );

    const submitted = renderClaimDocuments(claimDetail("submitted"));
    assert.doesNotMatch(submitted, /Analyze and continue|Revalidate claim|Try again/);
  });

  it("renders current Review after fresh state reconstruction and rejects stale or submitted reentry", () => {
    const first = renderClaimReview(claimDetail("review"));
    const recreated = renderClaimReview(claimDetail("review"));

    assert.match(first, /Review your claim/);
    assert.match(first, /Submit for processing/);
    assert.match(recreated, /Review your claim/);
    assert.match(recreated, /Submit for processing/);

    for (const phase of ["validation_required", "analysis_required", "submitted"] as const) {
      const html = renderClaimReview(claimDetail(phase));
      assert.doesNotMatch(html, /Review your claim|Ready to submit|Submit for processing|Edit information/);
    }
  });
});

describe("Change Set 4 field integrity presentation", () => {
  it("shows synthetic timing honestly and marks corrected clinical information", () => {
    const claim = claimDetail("review");
    claim.review.extracted.diagnoses = [{
      description: "Corrected diagnosis",
      code: "K02.9",
      codingSystem: "ICD-10",
      sourceAttachmentRefs: ["ATT-1"],
      sourceEvidenceUnitRefs: ["UNIT-INVOICE"]
    }];
    claim.review.editedFields = ["diagnoses"];
    claim.review.timing = {
      profile: {
        profileId: "synthetic-test",
        version: "1",
        displayName: "Synthetic test timing",
        source: "synthetic_demo"
      },
      configuredWindowDays: 30,
      applicableDate: "2026-08-01",
      deadline: "2026-08-31",
      state: "available",
      reason: "calculated"
    };

    const html = renderClaimReview(claim);
    assert.match(html, /Demo submission timing/);
    assert.match(html, /synthetic demo setting/);
    assert.match(html, /2026-08-31/);
    assert.match(html, /This is not a coverage decision/);
    assert.match(html, /Edited by you/);
  });

  it("does not fabricate a deadline when timing is unavailable", () => {
    const claim = claimDetail("review");
    claim.review.timing = {
      profile: {
        profileId: "synthetic-test",
        version: "1",
        displayName: "Synthetic test timing",
        source: "synthetic_demo"
      },
      configuredWindowDays: 30,
      applicableDate: null,
      deadline: null,
      state: "unavailable",
      reason: "date_unavailable"
    };
    const html = renderClaimReview(claim);
    assert.match(html, /cannot be calculated safely/);
    assert.doesNotMatch(html, /calculated deadline is/);
  });
});

describe("Change Set 6 presentation polish", () => {
  it("uses the supplied Bupa mark with a decorative internal heartbeat overlay", () => {
    const html = renderToStaticMarkup(<BupaMark />);

    assert.match(html, /bupa-arabia-icon-[A-Za-z0-9_-]+\.png/);
    assert.match(html, /alt="Bupa Arabia"/);
    assert.match(html, /bupa-mark__pulse-path/);
    assert.match(html, /aria-hidden="true"/);
  });

  it("keeps key review data visible while grouping secondary details and page-aware sources", () => {
    const html = renderClaimReview(claimDetail("review"));

    assert.match(html, /At a glance/);
    assert.match(html, /Treatment details/);
    assert.match(html, /Financial details/);
    assert.match(html, /All services/);
    assert.match(html, /Source documents/);
    assert.match(html, /Invoice/);
    assert.match(html, /Medical report/i);
    assert.match(html, /Payment receipt/i);
    assert.match(html, /page 1/);
    assert.match(html, /page 2/);
    assert.match(html, /page 3/);
  });

  it("does not render a full loading card before the delayed threshold", () => {
    const html = renderToStaticMarkup(<DelayedPageState title="Loading" />);

    assert.match(html, /aria-busy="true"/);
    assert.doesNotMatch(html, />Loading</);
  });
});

function validationIssue(overrides: Partial<ValidationIssue> = {}): ValidationIssue {
  return {
    code: "invoice_patientName_missing",
    state: "missing",
    field: "patientName",
    attachmentId: "ATT-INVOICE-A",
    message: "Test issue",
    severity: "blocking_error",
    ...overrides
  };
}

function extracted() {
  return {
    patientName: "Synthetic Member",
    providerName: "Synthetic Clinic",
    providerLocation: "Riyadh",
    invoiceReference: "INV-1",
    invoiceDate: "2026-08-01",
    serviceDate: "2026-08-01",
    currency: "SAR",
    subtotal: 100,
    taxAmount: 0,
    discountAmount: 0,
    billedAmount: 100,
    paymentStatus: "paid",
    paymentMethod: "card",
    cardNetwork: "mada",
    serviceLines: [],
    diagnoses: [],
    procedures: [],
    admissionDate: null,
    dischargeDate: null,
    opticalFrameAmount: null,
    opticalLensAmount: null
  };
}

function evidenceUnit(
  evidenceUnitId: string,
  documentType: "invoice" | "medical_report" | "payment_receipt",
  page: number,
  summary: string
) {
  return {
    evidenceUnitId,
    attachmentId: "ATT-MIXED",
    pageStart: page,
    pageEnd: page,
    pageProvenance: "provider_page_range",
    documentType,
    readability: "readable",
    relevance: "relevant",
    detectedCategories: ["inpatient_surgery"],
    detectedOpticalItems: [],
    summary,
    extracted: extracted(),
    missingOrUnclear: []
  };
}

function mixedAttachment(): ClaimAttachment {
  return {
    attachmentId: "ATT-MIXED",
    originalFilename: "mixed.pdf",
    mimeType: "application/pdf",
    sizeBytes: 100,
    documentType: "invoice",
    createdAt: "2026-08-01T00:00:00.000Z",
    analysis: {
      attachmentId: "ATT-MIXED",
      schemaVersion: 3,
      extractionVersion: "independent-document-v3-evidence-units",
      analysisStatus: "complete",
      provider: "openai",
      model: "gpt-test",
      analysedAt: "2026-08-01T00:00:00.000Z",
      readability: "readable",
      relevance: "relevant",
      documentType: "invoice",
      detectedCategories: ["inpatient_surgery"],
      detectedOpticalItems: [],
      summary: "Mixed document",
      extracted: extracted(),
      missingOrUnclear: [],
      evidenceUnits: [
        evidenceUnit("UNIT-INVOICE", "invoice", 1, "Invoice summary"),
        evidenceUnit("UNIT-REPORT", "medical_report", 2, "Clinical summary"),
        evidenceUnit("UNIT-RECEIPT", "payment_receipt", 3, "Payment summary")
      ]
    }
  } as unknown as ClaimAttachment;
}

function opsPayload(legacy: boolean): SubmissionPayload {
  const attachment = mixedAttachment();
  const analysis = {
    ...attachment.analysis!,
    ...(legacy ? { evidenceUnits: undefined, summary: "Legacy invoice" } : {})
  };
  return {
    provenance: [{ field: "billedAmount", sourceAttachmentRefs: ["ATT-MIXED"] }],
    rawDocumentExtractions: [{
      attachmentReference: "ATT-MIXED",
      filename: "mixed.pdf",
      analysis
    }]
  } as unknown as SubmissionPayload;
}

function claimJourney(phase: ClaimJourney["phase"]): ClaimJourney {
  return {
    phase,
    documentsPresent: phase !== "empty",
    analysisCurrent: ["validation_required", "review", "submitted"].includes(phase),
    validationCurrent: ["review", "submitted"].includes(phase),
    canReview: phase === "review",
    requiresProviderAnalysis: phase === "analysis_required"
  };
}

function claimSummary(
  claimId: string,
  phase: ClaimJourney["phase"],
  status: ClaimSummary["status"]
): ClaimSummary {
  return {
    claimId,
    memberId: "00123456",
    category: "dental",
    opticalItem: null,
    claimLocation: "local",
    status,
    journey: claimJourney(phase),
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z"
  };
}

function claimDetail(
  phase: ClaimJourney["phase"],
  analysisStatus: "complete" | "failed" = "complete"
): ClaimDetail {
  const attachment = mixedAttachment();
  attachment.analysis = attachment.analysis
    ? { ...attachment.analysis, analysisStatus }
    : null;
  const summary = claimSummary(
    "CLM-PAGE",
    phase,
    phase === "submitted"
      ? "accepted_for_processing"
      : phase === "review"
        ? "ready"
        : "draft"
  );
  const base = extracted();
  return {
    ...summary,
    attachments: [attachment],
    validation: phase === "review" ? {
      claimId: summary.claimId,
      state: "ready",
      readyToSubmit: true,
      blockingIssueCount: 0,
      warningCount: 0,
      infoCount: 0,
      validatedAt: "2026-08-01T00:00:00.000Z",
      issues: []
    } : null,
    review: {
      primaryInvoiceAttachmentId: attachment.attachmentId,
      primaryInvoiceEvidenceUnitId: "UNIT-INVOICE",
      extracted: {
        ...base,
        serviceLines: [],
        diagnoses: [],
        procedures: [],
        invoices: [{
          reference: base.invoiceReference,
          invoiceDate: base.invoiceDate,
          serviceDate: base.serviceDate,
          currency: base.currency,
          subtotal: base.subtotal,
          discountAmount: base.discountAmount,
          taxAmount: base.taxAmount,
          billedAmount: base.billedAmount,
          paymentStatus: base.paymentStatus,
          paymentMethod: base.paymentMethod,
          cardNetwork: base.cardNetwork,
          sourceAttachmentRef: attachment.attachmentId,
          sourceEvidenceUnitRef: "UNIT-INVOICE",
          items: []
        }],
        paymentEvidence: []
      },
      sources: {},
      evidenceSources: {},
      editedFields: [],
      editedAt: null,
      provenance: []
    },
    submission: null
  } as ClaimDetail;
}

function renderClaimDocuments(claim: ClaimDetail) {
  return renderPage(
    <Routes>
      <Route path="/claims/:claimId/documents" element={
        <ClaimDocumentsPage initialClaim={claim} />
      } />
    </Routes>,
    `/claims/${claim.claimId}/documents`
  );
}

function renderClaimReview(claim: ClaimDetail) {
  return renderPage(
    <Routes>
      <Route path="/claims/:claimId/review" element={
        <ClaimReviewPage initialClaim={claim} />
      } />
    </Routes>,
    `/claims/${claim.claimId}/review`
  );
}

function renderPage(element: React.ReactNode, route: string) {
  const storage = new Map<string, string>();
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      localStorage: {
        getItem: (key: string) => storage.get(key) ?? null,
        setItem: (key: string, value: string) => storage.set(key, value),
        removeItem: (key: string) => storage.delete(key)
      }
    }
  });
  Object.defineProperty(globalThis, "document", {
    configurable: true,
    value: {
      documentElement: { dataset: {}, style: {} }
    }
  });

  return renderToStaticMarkup(
    <MemoryRouter initialEntries={[route]}>
      <ThemeProvider>
        <LanguageProvider>
          <AuthProvider>{element}</AuthProvider>
        </LanguageProvider>
      </ThemeProvider>
    </MemoryRouter>
  );
}
