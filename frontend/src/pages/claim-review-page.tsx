import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Navigate, useNavigate, useParams } from "react-router-dom";
import { ApiError, apiUrl, claimsApi, localizedApiError } from "../lib/api";
import { formatCategory } from "../lib/claim-content";
import type {
  ClaimDetail,
  ClaimReview,
  ClaimSubmission,
  ExtractedServiceLine,
  MemberEditedField,
  ValidationIssue
} from "../types";
import { DiscardDraftButton } from "../components/discard-draft-button";
import { HeaderUtilities } from "../components/demo-ops-launcher";
import { useLanguage } from "../i18n/language-context";
import { validationIssueMessage } from "../lib/validation-copy";
import {
  documentCorrectionHref,
  resolveValidationIssueAction,
  type InvoiceActionContext,
  validationIssueActionLabel,
  validationIssueSourceFilename
} from "../lib/validation-action";
import { SahlBrand } from "../components/brand-mark";
import { DelayedPageState, PageState as SharedPageState } from "../components/ui";
import {
  ReviewSubmissionAction,
  ReviewSummaryValue,
  ValidationIssueDetails
} from "../components/claim-validation-presentation";
import { documentRoleLabel } from "../lib/document-role-label";
import { reviewReentryDestination } from "../lib/claim-journey";
import {
  evidenceSourceLabels,
  pageRangeLabel,
  validationIssueEvidenceSourceLabel
} from "../lib/evidence-source-label";

type ExtractedFields = ClaimReview["extracted"];
type TextField = Exclude<{
  [K in keyof ExtractedFields]: ExtractedFields[K] extends string | null ? K : never
}[keyof ExtractedFields], undefined>;
type NumberField = Exclude<{
  [K in keyof ExtractedFields]: ExtractedFields[K] extends number | null ? K : never
}[keyof ExtractedFields], undefined>;

function identityFields(
  isArabic: boolean,
  options: { includeServiceDate: boolean; multipleInvoices: boolean }
): Array<{ key: TextField; label: string; type?: "date" }> {
  const fields: Array<{ key: TextField; label: string; type?: "date" }> = [
    { key: "patientName", label: isArabic ? "اسم المريض" : "Patient name" },
    { key: "providerName", label: isArabic ? "اسم مقدم الخدمة" : "Provider name" },
    { key: "providerLocation", label: isArabic ? "موقع مقدم الخدمة" : "Provider location" },
    { key: "invoiceReference", label: options.multipleInvoices ? (isArabic ? "رقم الفاتورة الرئيسية" : "Primary invoice reference") : (isArabic ? "رقم الفاتورة" : "Invoice reference") },
    { key: "invoiceDate", label: options.multipleInvoices ? (isArabic ? "تاريخ الفاتورة الرئيسية" : "Primary invoice date") : (isArabic ? "تاريخ الفاتورة" : "Invoice date"), type: "date" },
    { key: "currency", label: isArabic ? "العملة" : "Currency" }
  ];
  if (options.includeServiceDate) {
    fields.splice(fields.length - 1, 0, { key: "serviceDate", label: isArabic ? "تاريخ الخدمة" : "Service date", type: "date" });
  }
  return fields;
}

function amountFields(isArabic: boolean, multipleInvoices = false): Array<{ key: NumberField; label: string }> {
  return [
    { key: "subtotal", label: isArabic ? "المجموع قبل الخصم والضريبة" : "Subtotal" },
    { key: "discountAmount", label: isArabic ? "الخصم" : "Discount" },
    { key: "taxAmount", label: isArabic ? "ضريبة القيمة المضافة / الضريبة" : "VAT / tax" },
    { key: "billedAmount", label: multipleInvoices ? (isArabic ? "إجمالي الفاتورة الرئيسية" : "Primary invoice total") : (isArabic ? "الإجمالي النهائي" : "Final total") }
  ];
}

export function ClaimReviewPage({
  initialClaim
}: {
  initialClaim?: ClaimDetail;
} = {}) {
  const { claimId } = useParams();
  const navigate = useNavigate();
  const { language, isArabic } = useLanguage();
  const [claim, setClaim] = useState<ClaimDetail | null>(initialClaim ?? null);
  const [fields, setFields] = useState<ExtractedFields | null>(() =>
    initialClaim ? cloneFields(initialClaim.review.extracted) : null
  );
  const [editing, setEditing] = useState(false);
  const [loading, setLoading] = useState(initialClaim === undefined);
  const [saving, setSaving] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [showSubmitConfirmation, setShowSubmitConfirmation] = useState(false);
  const [recentSubmission, setRecentSubmission] = useState<ClaimSubmission | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [openAttachmentId, setOpenAttachmentId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [duplicateClaimId, setDuplicateClaimId] = useState<string | null>(null);
  const errorRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!error) return;
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    errorRef.current?.scrollIntoView({
      behavior: reduceMotion ? "auto" : "smooth",
      block: "center"
    });
  }, [error]);

  useEffect(() => {
    if (initialClaim !== undefined) return;
    if (!claimId) return;
    setLoading(true);
    void claimsApi.get(claimId)
      .then((result) => {
        setClaim(result);
        setFields(cloneFields(result.review.extracted));
      })
      .catch((requestError) => setError(localizedApiError(requestError, isArabic, "تعذر فتح مراجعة المطالبة. حاول مرة أخرى.", "We could not open this claim review. Please try again.")))
      .finally(() => setLoading(false));
  }, [claimId, isArabic, initialClaim]);

  const hasUnsavedChanges = Boolean(
    editing && claim && fields &&
    JSON.stringify(fields) !== JSON.stringify(claim.review.extracted)
  );

  useEffect(() => {
    if (!hasUnsavedChanges) return;
    const warnBeforeUnload = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", warnBeforeUnload);
    return () => window.removeEventListener("beforeunload", warnBeforeUnload);
  }, [hasUnsavedChanges]);

  useEffect(() => {
    if (!showSubmitConfirmation) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setShowSubmitConfirmation(false);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [showSubmitConfirmation]);

  const attachmentNames = useMemo(() => new Map(
    claim?.attachments.map((attachment) => [
      attachment.attachmentId,
      attachment.originalFilename
    ]) ?? []
  ), [claim]);

  async function saveReview() {
    if (!claimId || !fields) return;
    setSaving(true);
    setError(null);
    try {
      const updated = await claimsApi.saveClaimReview(claimId, fields);
      setClaim(updated);
      setFields(cloneFields(updated.review.extracted));
      setEditing(false);
    } catch (requestError) {
      setError(localizedApiError(requestError, isArabic, "تعذر حفظ التغييرات والتحقق منها.", "We could not save and check those changes."));
    } finally {
      setSaving(false);
    }
  }

  async function confirmIssue(issue: ValidationIssue) {
    if (!claimId) return;
    const key = issueKey(issue);
    setConfirming(key);
    setError(null);
    try {
      const updated = await claimsApi.confirmValidationIssue(claimId, issue);
      setClaim(updated);
      setFields(cloneFields(updated.review.extracted));
    } catch (requestError) {
      setError(localizedApiError(requestError, isArabic, "تعذر حفظ هذا التأكيد.", "We could not save that confirmation."));
    } finally {
      setConfirming(null);
    }
  }

  async function submitClaim() {
    if (!claimId) return;
    setSubmitting(true);
    setError(null);
    setDuplicateClaimId(null);
    try {
      const submission = await claimsApi.submit(claimId);
      setRecentSubmission(submission);
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (requestError) {
      if (requestError instanceof ApiError && requestError.code === "DOCUMENT_ANALYSIS_STALE") {
        setError(isArabic
          ? "تحتاج مستنداتك إلى التحليل مرة أخرى قبل إرسال المطالبة."
          : "Your documents need to be analyzed again before submission.");
      } else if (
        requestError instanceof ApiError &&
        requestError.code === "DUPLICATE_CLAIM" &&
        requestError.claimId
      ) {
        setDuplicateClaimId(requestError.claimId);
        setError(isArabic
          ? `تتطابق هذه المطالبة مع المطالبة المقدمة ${requestError.claimId}.`
          : `This claim matches submitted claim ${requestError.claimId}.`);
      } else {
        setError(localizedApiError(requestError, isArabic, "تعذر إرسال المطالبة للمعالجة.", "We could not submit this claim for processing."));
      }
    } finally {
      setSubmitting(false);
    }
  }

  function navigateWithUnsavedCheck(destination: string) {
    if (hasUnsavedChanges && !window.confirm(isArabic
      ? "لديك تعديلات لم تُحفظ. هل تريد المغادرة دون حفظها؟"
      : "You have unsaved changes. Leave without saving them?")) return;
    navigate(destination);
  }

  function editReviewField(field?: string) {
    setEditing(true);
    window.setTimeout(() => {
      const fieldWrapper = Array.from(document.querySelectorAll<HTMLElement>("[data-review-field]"))
        .find((element) => element.dataset.reviewField === field);
      const target = fieldWrapper ?? document.getElementById("claim-information");
      target?.scrollIntoView({ behavior: "smooth", block: "center" });
      fieldWrapper?.querySelector<HTMLElement>("input, select, textarea")?.focus({ preventScroll: true });
    }, 0);
  }

  if (loading) return <DelayedPageState title={isArabic ? "جارٍ إعداد مراجعة مطالبتك…" : "Preparing your claim review…"} />;
  if (!claim || !claimId || !fields) {
    return <SharedPageState tone="error" title={error ?? (isArabic ? "تعذر فتح هذه المطالبة." : "This claim could not be opened.")} />;
  }

  const issues = claim.validation?.issues ?? [];
  const ready = claim.validation?.readyToSubmit ?? false;
  const reentryDestination = reviewReentryDestination(claim);
  const blockedByUnusableUploads = claim.attachments.length > 0 && claim.attachments.every((attachment) => {
    const analysis = attachment.analysis;
    return Boolean(analysis && (analysis.readability === "unreadable" || analysis.relevance === "irrelevant"));
  });
  if (reentryDestination && !recentSubmission) {
    return <Navigate to={reentryDestination} replace />;
  }

  return (
    <main className="sahl-app prototype-claim-page min-h-screen bg-[#f4f7fb] text-[#0b1e3d]">
      <header className="sahl-topbar border-b border-[#dce6f0] bg-white/95 backdrop-blur">
        <div className="relative mx-auto flex min-h-14 max-w-2xl items-center justify-between gap-2 px-3 py-2 sm:gap-4 sm:px-6">
          <button type="button" onClick={() => navigateWithUnsavedCheck("/claims")} className="group flex items-center gap-2 rounded-xl px-2 py-2 text-sm font-medium text-[#425979] transition hover:bg-[#f7fafd]">
            <BackIcon /> {isArabic ? "حفظ والعودة" : "Save and return"}
          </button>
          <div className="absolute start-1/2 hidden -translate-x-1/2 md:block rtl:translate-x-1/2"><SahlBrand compact /></div>
          <div className="flex items-center justify-end gap-2">
            <HeaderUtilities />
            {!recentSubmission && (
              <DiscardDraftButton
                claimId={claimId}
                compact
                onDiscarded={() => navigate("/claims", { replace: true })}
              />
            )}
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-2xl px-4 py-8 sm:px-6">
        <ReviewProgress
          onDetails={() => navigateWithUnsavedCheck(`/claims/${claimId}/details`)}
          onDocuments={() => navigateWithUnsavedCheck(`/claims/${claimId}/documents`)}
          isArabic={isArabic}
        />

        <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[#0072ce]">{isArabic ? "المطالبة" : "Claim"} {claim.claimId}</p>
            <h1 className="mt-2 text-2xl font-semibold tracking-[-0.02em] text-[#0b1e3d] sm:text-3xl">{isArabic ? "راجع مطالبتك" : "Review your claim"}</h1>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-[#687a96]">
              {isArabic ? "تحقق من معلومات المطالبة المُعدة. عدّل فقط ما لا يطابق مستنداتك." : "Check the prepared claim information. You only need to edit something when it does not match your documents."}
            </p>
          </div>
          <span className="w-fit rounded-full bg-[#eef6fd] px-2.5 py-1 text-[11px] font-semibold text-[#005eb8]">
            {formatCategory(claim.category, claim.opticalItem, language)}
          </span>
        </div>

        {error && <div ref={errorRef} role="alert" className="mt-6 flex flex-col items-start gap-3 rounded-xl border border-[#f1c7bd] bg-[#fff4f1] px-4 py-3.5 text-sm font-medium text-[#a04432] sm:flex-row sm:items-center sm:justify-between"><span className="min-w-0 break-words">{error}</span>{duplicateClaimId && <button type="button" onClick={() => navigate(`/claims/${duplicateClaimId}/submitted`)} className="w-full shrink-0 rounded-lg border border-[#d79b8e] bg-white px-4 py-2.5 text-xs font-bold text-[#9a3e2e] transition hover:bg-[#fff9f7] sm:w-auto">{isArabic ? "فتح المطالبة" : "Open existing claim"}</button>}</div>}

        {recentSubmission ? (
          <AcceptedConfirmation
            submission={recentSubmission}
            onBack={() => navigate("/claims")}
          />
        ) : (
          <IssueSummary
            issues={issues}
            ready={ready}
            confirming={confirming}
            attachmentNames={attachmentNames}
            attachments={claim.attachments}
            invoiceContext={{
              primaryInvoiceAttachmentId: claim.review.primaryInvoiceAttachmentId ??
                claim.review.extracted.invoices[0]?.sourceAttachmentRef ?? null,
              primaryInvoiceEvidenceUnitId: claim.review.primaryInvoiceEvidenceUnitId ??
                claim.review.extracted.invoices[0]?.sourceEvidenceUnitRef ?? null,
              invoiceSourceAttachmentIds: claim.review.extracted.invoices.map(
                (invoice) => invoice.sourceAttachmentRef
              ),
              invoiceSourceEvidenceUnitIds: claim.review.extracted.invoices.map(
                (invoice) => invoice.sourceEvidenceUnitRef
              )
            }}
            onConfirm={confirmIssue}
            onEditDetails={() => navigate(`/claims/${claimId}/details`)}
            onManageDocuments={(attachmentId) => navigate(
              documentCorrectionHref(claimId, attachmentId)
            )}
            onEditInformation={editReviewField}
          />
        )}

        {!blockedByUnusableUploads && <section id="claim-information" className="mt-8 overflow-hidden rounded-[26px] border border-[#dce6f0] bg-white shadow-[0_14px_40px_rgba(38,79,89,0.06)]">
          <div className="flex flex-col gap-4 border-b border-[#e8edf5] bg-[#f7fafd] p-5 sm:flex-row sm:items-center sm:justify-between sm:p-6">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.1em] text-[#0072ce]">{isArabic ? "معلومات المطالبة المُعدة" : "Prepared claim information"}</p>
              <h2 className="mt-2 text-lg font-semibold tracking-[-0.015em] text-[#0b1e3d]">{isArabic ? "ملخص واضح واحد" : "One clear summary"}</h2>
              <p className="mt-1 text-sm leading-5 text-[#687a96]">{isArabic ? "جُمعت من مستنداتك المرفوعة مع الاحتفاظ بالمصادر الأصلية بجانبها." : "Combined from your uploaded documents with the original sources kept alongside it."}</p>
            </div>
            {!editing && !recentSubmission && (
              <button type="button" onClick={() => setEditing(true)} className="w-fit rounded-xl border border-[#b9d6d9] bg-white px-4 py-2.5 text-xs font-extrabold text-[#236873] transition hover:bg-[#eef6fd]">
                {isArabic ? "تعديل المعلومات" : "Edit information"}
              </button>
            )}
          </div>

          <div className="p-5 sm:p-6">
            {editing && !recentSubmission ? (
              <ClaimEditor
                fields={fields}
                setFields={setFields}
                category={claim.category}
                opticalItem={claim.opticalItem}
                issues={issues}
                saving={saving}
                onCancel={() => {
                  setFields(cloneFields(claim.review.extracted));
                  setEditing(false);
                }}
                onSave={() => void saveReview()}
              />
            ) : (
              <ClaimSummary
                claim={claim}
                fields={fields}
                attachmentNames={attachmentNames}
                issues={issues}
              />
            )}
          </div>
        </section>}

        {!recentSubmission && (
          <ReviewSubmissionAction
            submitting={submitting}
            ready={ready}
            blockingCount={claim.validation?.blockingIssueCount ?? groupReviewIssues(issues).filter((g) => g.primary.severity === "blocking_error").length}
            warningCount={claim.validation?.warningCount ?? groupReviewIssues(issues).filter((g) => g.primary.severity === "warning").length}
            isArabic={isArabic}
            onSubmit={() => setShowSubmitConfirmation(true)}
          />
        )}

        {showSubmitConfirmation && (
          <div className="fixed inset-0 z-50 grid place-items-center bg-[#071a2f]/55 p-4 backdrop-blur-sm" role="presentation" onMouseDown={() => setShowSubmitConfirmation(false)}>
            <section role="dialog" aria-modal="true" aria-labelledby="submit-confirmation-title" className="w-full max-w-md rounded-[26px] border border-white/60 bg-white p-6 shadow-[0_28px_80px_rgba(0,32,66,0.28)]" onMouseDown={(event) => event.stopPropagation()}>
              <div className="grid h-11 w-11 place-items-center rounded-2xl bg-[#e9f6f1] text-[#28745f]" aria-hidden="true">✓</div>
              <h2 id="submit-confirmation-title" className="mt-5 text-xl font-semibold tracking-[-0.02em] text-[#0b1e3d]">{isArabic ? "هل أنت مستعد لإرسال المطالبة؟" : "Ready to submit your claim?"}</h2>
              <p className="mt-2 text-sm leading-6 text-[#687a96]">{isArabic ? "راجع معلوماتك للمرة الأخيرة. بعد الإرسال ستنتقل المطالبة إلى المعالجة ولن تتمكن من تعديلها هنا." : "Take one final look at your information. After submission, this claim moves to processing and can no longer be edited here."}</p>
              <div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
                <button type="button" autoFocus onClick={() => setShowSubmitConfirmation(false)} disabled={submitting} className="rounded-xl border border-[#c9dcec] px-5 py-3 text-sm font-extrabold text-[#58767c] transition hover:bg-[#f5f9f9] disabled:opacity-60">{isArabic ? "العودة للمراجعة" : "Back to review"}</button>
                <button type="button" onClick={() => { setShowSubmitConfirmation(false); void submitClaim(); }} disabled={submitting} className="rounded-xl bg-[#005eb8] px-5 py-3 text-sm font-extrabold text-white transition hover:bg-[#004f9f] disabled:opacity-60">{isArabic ? "إرسال المطالبة" : "Submit claim"}</button>
              </div>
            </section>
          </div>
        )}

        <details className="review-disclosure mt-8 rounded-[24px] border border-[#dce6f0] bg-white" open={blockedByUnusableUploads || undefined}>
          <summary className="flex cursor-pointer list-none items-center justify-between gap-4 p-5 focus:outline-none focus-visible:ring-4 focus-visible:ring-inset focus-visible:ring-[#0072ce]/20 sm:p-6">
            <span>
              <span className="block text-base font-semibold text-[#0b1e3d]">{isArabic ? "المستندات المصدرية" : "Source documents"}</span>
              <span className="mt-1 block text-sm font-normal leading-6 text-[#687a96]">{blockedByUnusableUploads
                ? (isArabic ? "راجع الملفات المرفوعة أدناه، ثم استبدل المستندات غير الصالحة." : "Review the uploaded files below, then replace the invalid documents.")
                : (isArabic ? "اعرض الملفات وأنواع الأدلة والصفحات التي استُخرجت منها." : "View files, evidence roles, and the pages they came from.")}</span>
            </span>
            <ChevronIcon open={false} />
          </summary>
          <div className="border-t border-[#e8edf5] p-5 sm:p-6">
            {!recentSubmission && <div className="mb-4 flex justify-end"><button type="button" onClick={() => navigate(`/claims/${claimId}/documents`)} className="w-fit rounded-xl border border-[#c9dcec] px-4 py-2.5 text-xs font-extrabold text-[#316a73] hover:bg-[#eef6fd]">{isArabic ? "تغيير المستندات" : "Change documents"}</button></div>}
            <ul className="space-y-3">
            {claim.attachments.map((attachment) => (
              <SourceDocument
                key={attachment.attachmentId}
                claimId={claimId}
                attachment={attachment}
                open={openAttachmentId === attachment.attachmentId}
                onToggle={() => setOpenAttachmentId((current) =>
                  current === attachment.attachmentId
                    ? null
                    : attachment.attachmentId
                )}
              />
            ))}
            </ul>
          </div>
        </details>
      </div>
    </main>
  );
}

function SourceDocument({ claimId, attachment, open, onToggle }: {
  claimId: string;
  attachment: ClaimDetail["attachments"][number];
  open: boolean;
  onToggle: () => void;
}) {
  const { isArabic } = useLanguage();
  const previewId = `source-preview-${attachment.attachmentId}`;
  const url = apiUrl(`/claims/${claimId}/attachments/${attachment.attachmentId}/download`);
  const isImage = attachment.mimeType.startsWith("image/");
  const isPdf = attachment.mimeType === "application/pdf";
  const evidenceUnits = attachment.analysis?.evidenceUnits?.length
    ? attachment.analysis.evidenceUnits
    : attachment.analysis
      ? [{
          evidenceUnitId: `legacy-${attachment.attachmentId}`,
          documentType: attachment.analysis.documentType,
          pageStart: null,
          pageEnd: null
        }]
      : [];

  return (
    <li className={`overflow-hidden rounded-2xl border bg-[#f7fafd] transition ${open ? "border-[#c9dcec] shadow-[0_10px_28px_rgba(38,79,89,0.08)]" : "border-[#dce6f0] hover:border-[#c9dcec]"}`}>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        aria-controls={previewId}
        className="flex w-full items-center justify-between gap-4 p-4 text-start transition hover:bg-[#f7fafd] focus:outline-none focus:ring-4 focus:ring-inset focus:ring-[#0072ce]/20"
      >
        <span className="flex min-w-0 items-center gap-3">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-[#eef6fd] text-[11px] font-black uppercase text-[#005eb8]">
            {isPdf ? "PDF" : isImage ? (isArabic ? "صورة" : "IMG") : (isArabic ? "ملف" : "FILE")}
          </span>
          <span className="min-w-0">
            <span className="block truncate text-sm font-extrabold text-[#425979]">{attachment.originalFilename}</span>
            <span className="mt-1 block text-xs text-[#8a9bbb]">{formatFileSize(attachment.sizeBytes)} · {evidenceUnits.length} {isArabic ? (evidenceUnits.length === 1 ? "نوع دليل" : "أنواع أدلة") : evidenceUnits.length === 1 ? "evidence role" : "evidence roles"}</span>
            {evidenceUnits.length > 0 && <span className="mt-2 flex flex-wrap gap-1.5">{evidenceUnits.map((unit) => <span key={unit.evidenceUnitId} className="rounded-full bg-white px-2 py-1 text-[10px] font-bold text-[#55758a] ring-1 ring-[#dce6f0]">{documentRoleLabel(unit.documentType, isArabic)}{unit.pageStart !== null ? ` · ${pageRangeLabel(unit.pageStart, unit.pageEnd, isArabic)}` : ""}</span>)}</span>}
          </span>
        </span>
        <span className="flex shrink-0 items-center gap-2 text-xs font-extrabold text-[#005eb8]">
          {open ? (isArabic ? "إخفاء" : "Hide") : (isArabic ? "معاينة" : "Preview")}
          <ChevronIcon open={open} />
        </span>
      </button>

      {open && (
        <div id={previewId} className="border-t border-[#dce6f0] bg-[#f0f4fa] p-3 sm:p-4">
          <div className="mb-3 flex justify-end">
            <a href={url} target="_blank" rel="noreferrer" className="rounded-xl border border-[#c9dcec] bg-white px-3.5 py-2 text-xs font-extrabold text-[#005eb8] transition hover:bg-[#f7fafd]">
              {isArabic ? "فتح بالحجم الكامل" : "Open full size"}
            </a>
          </div>
          {isImage ? (
            <div className="grid max-h-[70vh] min-h-64 place-items-center overflow-auto rounded-xl border border-[#dce6f0] bg-white p-2">
              <img src={url} alt={`${isArabic ? "المستند المرفوع" : "Uploaded document"}: ${attachment.originalFilename}`} className="max-h-[68vh] max-w-full object-contain" />
            </div>
          ) : isPdf ? (
            <iframe src={url} title={`${isArabic ? "المستند المرفوع" : "Uploaded document"}: ${attachment.originalFilename}`} className="h-[55dvh] min-h-[300px] w-full rounded-xl border border-[#dce6f0] bg-white sm:h-[65vh] sm:min-h-[420px]" />
          ) : (
            <div className="rounded-xl border border-[#dce6f0] bg-white px-5 py-10 text-center text-sm text-[#687a96]">
              {isArabic ? "لا يمكن معاينة هذا الملف هنا. افتحه في علامة تبويب جديدة." : "This file cannot be previewed here. Open it in a new tab instead."}
            </div>
          )}
        </div>
      )}
    </li>
  );
}

function AcceptedConfirmation({ submission, onBack }: {
  submission: ClaimSubmission;
  onBack: () => void;
}) {
  const { language, isArabic } = useLanguage();
  return (
    <section className="mt-7 overflow-hidden rounded-[26px] border border-[#b9dfd4] bg-white shadow-[0_16px_45px_rgba(31,116,93,0.10)]">
      <div className="bg-[radial-gradient(circle_at_88%_15%,rgba(47,154,127,0.12),transparent_14rem),linear-gradient(135deg,#effaf6,#f8fcfa_58%,#edf9f5)] p-6 sm:p-8">
        <div className="flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex gap-4">
            <span className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-[linear-gradient(145deg,#28745f,#3d9a7f)] text-xl font-black text-white shadow-[0_10px_24px_rgba(40,116,95,0.22)]">✓</span>
            <div>
              <p className="text-xs font-extrabold uppercase tracking-[0.14em] text-[#26806a]">{isArabic ? "تم استلام الإرسال" : "Submission received"}</p>
              <h2 className="mt-2 text-2xl font-bold tracking-[-0.03em] text-[#205448]">{isArabic ? "مقبولة للمعالجة" : "Accepted for processing"}</h2>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-[#557a72]">
                {isArabic ? "تم استلام مطالبتك وإرسالها للمعالجة. هذا لا يعني أنه تمت الموافقة عليها أو دفعها." : "Your claim has been received and sent for processing. This does not mean it has been approved or paid."}
              </p>
            </div>
          </div>
          <button type="button" onClick={onBack} className="w-fit shrink-0 rounded-xl border border-[#afd4ca] bg-white px-4 py-2.5 text-xs font-extrabold text-[#286d5d] transition hover:bg-[#f8fdfb]">{isArabic ? "العودة إلى المطالبات" : "Back to claims"}</button>
        </div>
      </div>
      <dl className="grid gap-px bg-[#dcebe7] sm:grid-cols-2">
        <div className="bg-white px-6 py-4 sm:px-8"><dt className="text-xs font-extrabold text-[#78928c]">{isArabic ? "مرجع الاستلام" : "Acceptance reference"}</dt><dd className="mt-1 font-mono text-sm font-bold tracking-wide text-[#285b50]">{submission.acceptanceReference}</dd></div>
        <div className="bg-white px-6 py-4 sm:px-8"><dt className="text-xs font-extrabold text-[#78928c]">{isArabic ? "تاريخ الإرسال" : "Submitted"}</dt><dd className="mt-1 text-sm font-bold text-[#285b50]">{formatSubmittedDate(submission.submittedAt, language)}</dd></div>
      </dl>
    </section>
  );
}

interface ReviewIssueGroup {
  key: string;
  primary: ValidationIssue;
  issues: ValidationIssue[];
}

const GROUPABLE_UPLOAD_ISSUES = new Set(["document_irrelevant", "document_unreadable", "document_unverifiable"]);

function groupReviewIssues(issues: ValidationIssue[]): ReviewIssueGroup[] {
  const groups: ReviewIssueGroup[] = [];
  const groupByCode = new Map<string, ReviewIssueGroup>();

  for (const issue of issues) {
    const existing = groupByCode.get(issue.code);
    if (existing) {
      existing.issues.push(issue);
      continue;
    }

    const group: ReviewIssueGroup = { key: GROUPABLE_UPLOAD_ISSUES.has(issue.code) ? "unusable-uploads" : issueKey(issue), primary: issue, issues: [issue] };
    groupByCode.set(issue.code, group);
    groups.push(group);
  }

  return groups;
}

function issueCountLabel(count: number, isArabic: boolean) {
  if (!isArabic) return `${count} ${count === 1 ? "problem" : "problems"} to fix`;
  if (count === 1) return "مشكلة واحدة تحتاج إلى حل";
  if (count === 2) return "مشكلتان تحتاجان إلى حل";
  return `${count} مشكلات تحتاج إلى حل`;
}

function groupedIssueMessage(group: ReviewIssueGroup, isArabic: boolean) {
  const count = group.issues.length;
  if (GROUPABLE_UPLOAD_ISSUES.has(group.primary.code)) {
    if (isArabic) {
      if (count === 1) return "لا يمكن استخدام هذا الملف لهذه المطالبة.";
      if (count === 2) return "لا يمكن استخدام هذين الملفين لهذه المطالبة.";
      return `لا يمكن استخدام هذه الملفات البالغ عددها ${count} لهذه المطالبة.`;
    }
    return count === 1 ? "This file can’t be used for this claim." : `These ${count} files can’t be used for this claim.`;
  }

  return validationIssueMessage(group.primary, isArabic);
}

function unusableUploadReason(code: string, isArabic: boolean) {
  if (code === "document_irrelevant") return isArabic ? "غير مرتبط بهذه المطالبة" : "Not related to this claim";
  if (code === "document_unverifiable") return isArabic ? "تعذر التحقق من محتوى هذا الملف" : "Could not verify what this file contains";
  return isArabic ? "تعذرت قراءته بوضوح" : "Could not be read clearly";
}

function IssueSummary({ issues, ready, confirming, attachmentNames, attachments, invoiceContext, onConfirm, onEditDetails, onManageDocuments, onEditInformation }: {
  issues: ValidationIssue[];
  ready: boolean;
  confirming: string | null;
  attachmentNames: Map<string, string>;
  attachments: ClaimDetail["attachments"];
  invoiceContext: InvoiceActionContext;
  onConfirm: (issue: ValidationIssue) => Promise<void>;
  onEditDetails: () => void;
  onManageDocuments: (attachmentId: string | null) => void;
  onEditInformation: (field?: string) => void;
}) {
  const { isArabic } = useLanguage();
  const issueGroups = groupReviewIssues(issues);
  const blockingCount = issueGroups.filter((group) => group.primary.severity === "blocking_error").length;
  const warningCount = issueGroups.filter((group) => group.primary.severity === "warning").length;
  const infoCount = issueGroups.filter((group) => group.primary.severity === "info").length;
  return (
    <section className={`review-issue-summary mt-7 overflow-hidden rounded-[24px] border bg-white shadow-[0_12px_35px_rgba(38,79,89,0.06)] ${blockingCount > 0 ? "border-[#efc0b7]" : warningCount > 0 ? "border-[#ead9bd]" : "border-[#bfd8ee]"}`}>
      <div className={`flex gap-3 p-5 sm:p-6 ${blockingCount > 0 ? "bg-[#fff9f7]" : warningCount > 0 ? "bg-[#fffaf2]" : "bg-[#f3f8fd]"}`}>
        <span className={`grid h-10 w-10 shrink-0 place-items-center rounded-xl text-sm font-black ${blockingCount > 0 ? "bg-[#fff0ed] text-[#a04c39]" : warningCount > 0 ? "bg-[#fff0dc] text-[#9a641d]" : "bg-[#eaf3fb] text-[#005eb8]"}`}>{ready ? "✓" : "!"}</span>
        <div className="min-w-0 flex-1">
          <h2 className="font-extrabold text-[#0b1e3d]">{ready ? (warningCount > 0 ? (isArabic ? "جاهزة للإرسال مع تنبيهات" : "Ready to submit with warnings") : (isArabic ? "اكتملت فحوصات الإرسال" : "Submission checks complete")) : issueCountLabel(blockingCount, isArabic)}</h2>
          <p className="mt-1 text-sm leading-5 text-[#58767c]">{ready ? (warningCount > 0 ? (isArabic ? "راجع التنبيهات أدناه. لا تمنع الإرسال وستبقى مرتبطة بالمطالبة." : "Review the warnings below. They do not block submission and remain attached to the claim.") : infoCount > 0 ? (isArabic ? "راجع المعلومات أدناه. لا تتطلب إجراءً ولا تمنع الإرسال." : "Review the information below. It requires no action and does not block submission.") : (isArabic ? "لم يتم العثور على استثناءات. راجع الملخص المُعد قبل الإرسال." : "No exceptions were found. Review the prepared summary before submission.")) : (isArabic ? "اتبع الإجراء الموضح لكل عنصر. تُفحص المطالبة تلقائياً بعد أي تغيير." : "Follow the action shown for each item. The claim is checked again automatically after a change.")}</p>
          {issueGroups.length > 0 && <p className="mt-2 text-xs font-bold text-[#687a96]">{[
            blockingCount > 0 ? `${blockingCount} ${isArabic ? "إجراء مطلوب" : blockingCount === 1 ? "required action" : "required actions"}` : null,
            warningCount > 0 ? `${warningCount} ${isArabic ? "تنبيه" : warningCount === 1 ? "warning" : "warnings"}` : null,
            infoCount > 0 ? `${infoCount} ${isArabic ? "معلومة" : infoCount === 1 ? "information item" : "information items"}` : null
          ].filter(Boolean).join(" · ")}</p>}
        </div>
      </div>
      {issueGroups.length > 0 && (
            <ul className="divide-y divide-[#f0d9d3] border-t border-[#f0d9d3]">
              {issueGroups.map((group) => {
                const issue = group.primary;
                const isUnusableUploadGroup = GROUPABLE_UPLOAD_ISSUES.has(issue.code);
                const evidenceSource = validationIssueEvidenceSourceLabel(
                  issue,
                  attachments,
                  isArabic
                );
                const affectedFiles = group.issues.map((item) => ({
                  issue: item,
                  filename: validationIssueSourceFilename(item, attachmentNames)
                }));
                return <li key={group.key} data-severity={issue.severity} className="bg-white px-5 py-4 sm:px-6">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0">
                      <span className={`inline-flex rounded-full px-2.5 py-1 text-[11px] font-extrabold uppercase tracking-wide ${issue.severity === "blocking_error" ? "bg-[#fff0ed] text-[#a04c39]" : issue.severity === "warning" ? "bg-[#fff4df] text-[#8a6118]" : "bg-[#eaf3fb] text-[#005eb8]"}`}>{issue.severity === "blocking_error" ? (isArabic ? "إجراء مطلوب" : "Required action") : issue.severity === "warning" ? (isArabic ? "تنبيه" : "Warning") : (isArabic ? "معلومة" : "Information")}</span>
                      <p className={`mt-2 text-sm font-semibold leading-5 ${issue.severity === "blocking_error" ? "text-[#a04c39]" : issue.severity === "warning" ? "text-[#665539]" : "text-[#425979]"}`}>{groupedIssueMessage(group, isArabic)}</p>
                      {isUnusableUploadGroup && <ul className="mt-3 space-y-2">{affectedFiles.map(({ issue: affectedIssue, filename }, index) => <li key={affectedIssue.attachmentId ?? `${affectedIssue.code}-${index}`} className="flex min-w-0 flex-col gap-0.5 text-xs sm:flex-row sm:items-baseline sm:gap-2"><span className="truncate font-bold text-[#5f6f7d]">{filename ?? (isArabic ? "الملف المرفوع" : "Uploaded file")}</span><span className="text-[#82999e]">{unusableUploadReason(affectedIssue.code, isArabic)}</span></li>)}</ul>}
                      {!isUnusableUploadGroup && (() => { const allSources = [...new Set(affectedFiles.map(({ issue: i, filename: f }) => [validationIssueEvidenceSourceLabel(i, attachments, isArabic), f].filter(Boolean).join(" · ")).filter(Boolean))]; return allSources.length > 0 ? <p className="mt-1 text-xs text-[#82999e]">{isArabic ? "المصدر" : "Source"}: {allSources.join(", ")}</p> : null; })()}
                      {!isUnusableUploadGroup && <ValidationIssueDetails issue={issue} isArabic={isArabic} />}
                    </div>
                    <IssueAction issue={issue} invoiceContext={invoiceContext} confirming={confirming} onConfirm={onConfirm} onEditDetails={onEditDetails} onManageDocuments={onManageDocuments} onEditInformation={onEditInformation} />
                  </div>
                </li>;
              })}
            </ul>
          )}
    </section>
  );
}

function IssueAction({ issue, invoiceContext, confirming, onConfirm, onEditDetails, onManageDocuments, onEditInformation }: {
  issue: ValidationIssue;
  invoiceContext: InvoiceActionContext;
  confirming: string | null;
  onConfirm: (issue: ValidationIssue) => Promise<void>;
  onEditDetails: () => void;
  onManageDocuments: (attachmentId: string | null) => void;
  onEditInformation: (field?: string) => void;
}) {
  const { isArabic } = useLanguage();
  const className = issue.severity === "blocking_error"
    ? "shrink-0 rounded-xl border border-[#005eb8] bg-[#005eb8] px-4 py-2.5 text-xs font-extrabold text-white shadow-sm transition hover:bg-[#004f9f] disabled:opacity-60"
    : "shrink-0 rounded-xl border border-[#b9d6d9] bg-[#f7fbfb] px-3.5 py-2 text-xs font-extrabold text-[#236873] transition hover:bg-[#eaf7f7] disabled:opacity-60";
  const action = resolveValidationIssueAction(
    issue,
    invoiceContext,
    canConfirm(issue.code)
  );
  if (action === "none") return null;
  if (action === "change_claim_type" || action === "review_claim_type" || action === "edit_claim_details") {
    return <button type="button" data-action-kind={action} onClick={onEditDetails} className={className}>{validationIssueActionLabel(action, isArabic)}</button>;
  }
  if (action === "replace_document" || action === "add_document" || action === "review_document") {
    return <button type="button" data-action-kind={action} onClick={() => onManageDocuments(issue.attachmentId)} className={className}>{validationIssueActionLabel(action, isArabic)}</button>;
  }
  if (action === "confirm_warning") {
    return <button type="button" onClick={() => void onConfirm(issue)} disabled={confirming === issueKey(issue)} className={className}>{confirming === issueKey(issue) ? (isArabic ? "جارٍ الحفظ..." : "Saving...") : confirmationLabel(issue.code, isArabic)}</button>;
  }
  return <button type="button" data-action-kind={action} onClick={() => onEditInformation(issue.field ?? undefined)} className={className}>{validationIssueActionLabel(action, isArabic)}</button>;
}

function ClaimSummary({ claim, fields, attachmentNames, issues }: { claim: ClaimDetail; fields: ExtractedFields; attachmentNames: Map<string, string>; issues: ValidationIssue[] }) {
  const { language, isArabic } = useLanguage();
  const edited = new Set<MemberEditedField>(claim.review.editedFields);
  const fieldSeverity = (field: string) => issues.find((issue) => issue.field === field)?.severity;
  const multipleInvoices = fields.invoices.length > 1;
  const includeServiceDate = Boolean(fields.serviceDate) && (
    claim.category !== "inpatient_surgery" || (!fields.admissionDate && !fields.dischargeDate)
  );
  const mainService = fields.serviceLines[0]?.description
    ?? fields.procedures[0]?.description
    ?? fields.diagnoses[0]?.description;
  const mainServiceEdited = edited.has("serviceLines") || edited.has("procedures") || edited.has("diagnoses");
  return (
    <div className="space-y-4">
      <SummarySection title={isArabic ? "نظرة سريعة" : "At a glance"}>
        <div className="review-at-a-glance grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <ReviewSummaryValue label={isArabic ? "نوع المطالبة" : "Claim type"} value={formatCategory(claim.category, claim.opticalItem, language)} sourceNames={[]} edited={false} isArabic={isArabic} />
          <SummaryValue label={isArabic ? "مقدم الخدمة" : "Provider"} value={display(fields.providerName, isArabic)} sources={claim.review.sources.providerName} evidenceSources={claim.review.evidenceSources.providerName} attachmentNames={attachmentNames} edited={edited.has("providerName")} severity={fieldSeverity("providerName")} isArabic={isArabic} />
          {includeServiceDate ? <SummaryValue label={isArabic ? "تاريخ الخدمة" : "Service date"} value={display(fields.serviceDate, isArabic)} sources={claim.review.sources.serviceDate} evidenceSources={claim.review.evidenceSources.serviceDate} attachmentNames={attachmentNames} edited={edited.has("serviceDate")} severity={fieldSeverity("serviceDate")} isArabic={isArabic} /> : fields.admissionDate ? <SummaryValue label={isArabic ? "تاريخ الدخول" : "Admission date"} value={fields.admissionDate} sources={claim.review.sources.admissionDate} evidenceSources={claim.review.evidenceSources.admissionDate} attachmentNames={attachmentNames} edited={edited.has("admissionDate")} severity={fieldSeverity("admissionDate")} isArabic={isArabic} /> : null}
          <SummaryValue label={isArabic ? "الإجمالي" : "Total"} value={money(fields.billedAmount, fields.currency, language)} sources={claim.review.sources.billedAmount} evidenceSources={claim.review.evidenceSources.billedAmount} attachmentNames={attachmentNames} edited={edited.has("billedAmount")} severity={fieldSeverity("billedAmount")} isArabic={isArabic} />
          <ReviewSummaryValue label={isArabic ? "الخدمة الرئيسية" : "Main service"} value={display(mainService, isArabic)} sourceNames={[]} edited={mainServiceEdited} isArabic={isArabic} />
        </div>
      </SummarySection>

      <ReviewDisclosure title={isArabic ? "تفاصيل العلاج" : "Treatment details"} description={isArabic ? "بيانات المريض والمعلومات السريرية المطبوعة في المستندات." : "Patient and clinical information printed in your documents."}>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <SummaryValue label={isArabic ? "اسم المريض" : "Patient name"} value={display(fields.patientName, isArabic)} sources={claim.review.sources.patientName} evidenceSources={claim.review.evidenceSources.patientName} attachmentNames={attachmentNames} edited={edited.has("patientName")} severity={fieldSeverity("patientName")} isArabic={isArabic} />
          <SummaryValue label={isArabic ? "موقع مقدم الخدمة" : "Provider location"} value={display(fields.providerLocation, isArabic)} sources={claim.review.sources.providerLocation} evidenceSources={claim.review.evidenceSources.providerLocation} attachmentNames={attachmentNames} edited={edited.has("providerLocation")} severity={fieldSeverity("providerLocation")} isArabic={isArabic} />
          {fields.dischargeDate && <SummaryValue label={isArabic ? "تاريخ الخروج" : "Discharge date"} value={fields.dischargeDate} sources={claim.review.sources.dischargeDate} evidenceSources={claim.review.evidenceSources.dischargeDate} attachmentNames={attachmentNames} edited={edited.has("dischargeDate")} severity={fieldSeverity("dischargeDate")} isArabic={isArabic} />}
        </div>
        {(fields.diagnoses.length > 0 || fields.procedures.length > 0) && <ClinicalDetails fields={fields} attachmentNames={attachmentNames} editedDiagnoses={edited.has("diagnoses")} editedProcedures={edited.has("procedures")} />}
      </ReviewDisclosure>

      <ReviewDisclosure title={isArabic ? "التفاصيل المالية" : "Financial details"} description={isArabic ? "تفاصيل الفاتورة والدفع مع إبقاء الإجمالي ظاهراً أعلاه." : "Invoice and payment details; the total remains visible above."}>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {identityFields(isArabic, { includeServiceDate, multipleInvoices }).filter(({ key }) => ["invoiceReference", "invoiceDate", "currency"].includes(key)).map(({ key, label }) => <SummaryValue key={key} label={label} value={display(fields[key], isArabic)} sources={claim.review.sources[key]} evidenceSources={claim.review.evidenceSources[key]} attachmentNames={attachmentNames} edited={edited.has(key as MemberEditedField)} severity={fieldSeverity(key)} isArabic={isArabic} />)}
          {amountFields(isArabic, multipleInvoices).filter(({ key }) => key !== "billedAmount").map(({ key, label }) => <SummaryValue key={key} label={label} value={money(fields[key], fields.currency, language)} sources={claim.review.sources[key]} evidenceSources={claim.review.evidenceSources[key]} attachmentNames={attachmentNames} edited={edited.has(key as MemberEditedField)} severity={fieldSeverity(key)} isArabic={isArabic} />)}
          <SummaryValue label={isArabic ? "حالة الدفع" : "Payment status"} value={formatDocumentType(fields.paymentStatus, language)} sources={claim.review.sources.paymentStatus} evidenceSources={claim.review.evidenceSources.paymentStatus} attachmentNames={attachmentNames} edited={edited.has("paymentStatus")} isArabic={isArabic} />
          {fields.paymentMethod !== "unknown" && <SummaryValue label={isArabic ? "طريقة الدفع" : "Payment method"} value={paymentMethodLabel(fields.paymentMethod, isArabic)} sources={claim.review.sources.paymentMethod} evidenceSources={claim.review.evidenceSources.paymentMethod} attachmentNames={attachmentNames} edited={edited.has("paymentMethod")} isArabic={isArabic} />}
          {fields.cardNetwork && <SummaryValue label={isArabic ? "شبكة البطاقة" : "Card network"} value={cardNetworkLabel(fields.cardNetwork, isArabic)} sources={claim.review.sources.cardNetwork} evidenceSources={claim.review.evidenceSources.cardNetwork} attachmentNames={attachmentNames} edited={edited.has("cardNetwork")} isArabic={isArabic} />}
          {claim.category === "optical" && (claim.opticalItem === "frames" || claim.opticalItem === "both") && <SummaryValue label={isArabic ? "مبلغ الإطار" : "Frame amount"} value={money(fields.opticalFrameAmount, fields.currency, language)} sources={claim.review.sources.opticalFrameAmount} evidenceSources={claim.review.evidenceSources.opticalFrameAmount} attachmentNames={attachmentNames} edited={edited.has("opticalFrameAmount")} isArabic={isArabic} />}
          {claim.category === "optical" && (claim.opticalItem === "lenses" || claim.opticalItem === "both") && <SummaryValue label={isArabic ? "مبلغ العدسات" : "Lens amount"} value={money(fields.opticalLensAmount, fields.currency, language)} sources={claim.review.sources.opticalLensAmount} evidenceSources={claim.review.evidenceSources.opticalLensAmount} attachmentNames={attachmentNames} edited={edited.has("opticalLensAmount")} isArabic={isArabic} />}
        </div>
        {(fields.invoices.length > 1 || fields.paymentEvidence.some((item) => item.evidenceType === "payment_receipt")) && <FinancialEvidenceDetails fields={fields} attachmentNames={attachmentNames} />}
      </ReviewDisclosure>

      <ReviewDisclosure title={isArabic ? "جميع الخدمات" : "All services"} description={isArabic ? `${fields.serviceLines.length} ${fields.serviceLines.length === 1 ? "خدمة مستخرجة" : "خدمات مستخرجة"}` : `${fields.serviceLines.length} extracted ${fields.serviceLines.length === 1 ? "service" : "services"}`} edited={edited.has("serviceLines")}>
        {fields.serviceLines.length === 0 ? <EmptyValue text={isArabic ? "لم يتم استخراج بنود من الفاتورة." : "No invoice items were extracted."} /> : <div className="space-y-3">{fields.serviceLines.map((line, index) => <ServiceLineSummary key={index} line={line} index={index} />)}</div>}
      </ReviewDisclosure>

      <ReviewDisclosure title={isArabic ? "توقيت الإرسال التجريبي" : "Demo submission timing"} description={isArabic ? "توقيت تجريبي للعرض، وليس قرار تغطية." : "A synthetic presentation aid, not a coverage decision."}>
        <p className="text-sm leading-6 text-[#58767c]">
          {claim.review.timing?.state === "available"
            ? (isArabic
              ? `بحسب إعداد العرض التجريبي، آخر موعد محسوب هو ${claim.review.timing.deadline}. هذا ليس قرار تغطية.`
              : `Under the synthetic demo setting, the calculated deadline is ${claim.review.timing.deadline}. This is not a coverage decision.`)
            : (isArabic
              ? "لا يمكن حساب توقيت الإرسال بأمان من البيانات والإعدادات الحالية."
              : "Submission timing cannot be calculated safely from the current data and demo configuration.")}
        </p>
      </ReviewDisclosure>
    </div>
  );
}

function FinancialEvidenceDetails({ fields, attachmentNames }: {
  fields: ExtractedFields;
  attachmentNames: Map<string, string>;
}) {
  const { language, isArabic } = useLanguage();
  return (
    <div className="mt-5 border-t border-[#e8edf5] pt-5">
      <h4 className="mb-3 text-sm font-extrabold text-[#425979]">{isArabic ? "تفاصيل المستندات المالية" : "Financial document details"}</h4>
      <div className="grid gap-3 sm:grid-cols-2">
        {fields.invoices.map((invoice, index) => <div key={`${invoice.sourceAttachmentRef}-${index}`} className="rounded-xl border border-[#e0eaec] bg-white p-4"><div className="flex items-start justify-between gap-3"><div><p className="text-xs font-extrabold text-[#687a96]">{isArabic ? "فاتورة" : "Invoice"} {index + 1}</p><p className="mt-1 text-sm font-bold text-[#0b1e3d]">{invoice.reference ?? (isArabic ? "بدون رقم مرجعي" : "No printed reference")}</p></div><p className="text-sm font-extrabold text-[#216f78]">{money(invoice.billedAmount, invoice.currency, language)}</p></div><div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-[#687a96]">{invoice.invoiceDate && <span>{isArabic ? "تاريخ الفاتورة" : "Invoice date"}: {invoice.invoiceDate}</span>}{invoice.serviceDate && <span>{isArabic ? "تاريخ الخدمة" : "Service date"}: {invoice.serviceDate}</span>}</div><p className="mt-2 truncate text-xs text-[#91a3a7]">{isArabic ? "المصدر" : "Source"}: {attachmentNames.get(invoice.sourceAttachmentRef) ?? invoice.sourceAttachmentRef}</p></div>)}
        {fields.paymentEvidence.filter((item) => item.evidenceType === "payment_receipt").map((item, index) => <div key={`${item.sourceAttachmentRef}-${index}`} className="rounded-xl border border-[#d5e9e3] bg-white p-4"><div className="flex items-start justify-between gap-3"><p className="text-xs font-extrabold text-[#5d8077]">{isArabic ? "إيصال دفع" : "Payment receipt"}</p><p className="text-sm font-extrabold text-[#28745f]">{money(item.amount, item.currency, language)}</p></div>{item.paymentMethod !== "unknown" && <p className="mt-2 text-xs text-[#687a96]">{isArabic ? "الدفع" : "Payment"}: {paymentMethodLabel(item.paymentMethod, isArabic)}{item.cardNetwork ? ` · ${cardNetworkLabel(item.cardNetwork, isArabic)}` : ""}</p>}<p className="mt-2 truncate text-xs text-[#91a3a7]">{isArabic ? "المصدر" : "Source"}: {attachmentNames.get(item.sourceAttachmentRef) ?? item.sourceAttachmentRef}</p></div>)}
      </div>
    </div>
  );
}

function ClinicalDetails({ fields, attachmentNames, editedDiagnoses, editedProcedures }: {
  fields: ExtractedFields;
  attachmentNames: Map<string, string>;
  editedDiagnoses: boolean;
  editedProcedures: boolean;
}) {
  const { isArabic } = useLanguage();
  return (
    <div className="mt-5 space-y-5 border-t border-[#e8edf5] pt-5">
      <p className="text-xs font-medium leading-5 text-[#687a96]">{isArabic ? "مستخرجة كما طُبعت في مستنداتك ولم ينشئ النظام رموزاً طبية." : "Extracted as printed in your documents; the system has not generated medical codes."}</p>
      <div className="space-y-5">
        <ClinicalGroup title={isArabic ? "التشخيصات والرموز" : "Diagnoses and codes"} items={fields.diagnoses} attachmentNames={attachmentNames} isArabic={isArabic} edited={editedDiagnoses} />
        <ClinicalGroup title={isArabic ? "الإجراءات والرموز" : "Procedures and codes"} items={fields.procedures} attachmentNames={attachmentNames} isArabic={isArabic} edited={editedProcedures} />
      </div>
    </div>
  );
}

function ClinicalGroup({ title, items, attachmentNames, isArabic, edited }: {
  title: string;
  items: Array<{ description: string | null; code: string | null; codingSystem: string | null; sourceAttachmentRefs: string[] }>;
  attachmentNames: Map<string, string>;
  isArabic: boolean;
  edited: boolean;
}) {
  if (items.length === 0) return null;
  return <div><h4 className="mb-3 flex items-center gap-2 text-sm font-extrabold text-[#425979]">{title}{edited && <span className="rounded-full bg-[#eef6fd] px-2 py-0.5 text-[10px] text-[#005eb8]">{isArabic ? "عدّلته أنت" : "Edited by you"}</span>}</h4><div className="grid gap-3 sm:grid-cols-2">{items.map((item, index) => <div key={`${item.code}-${item.description}-${index}`} className="rounded-xl border border-[#e0eaec] bg-white p-4"><div className="flex flex-wrap items-start justify-between gap-2"><p className="text-sm font-bold text-[#0b1e3d]">{item.description ?? (isArabic ? "لا يوجد وصف مطبوع" : "No printed description")}</p>{item.code && <span className="rounded-lg bg-[#e8f5f5] px-2.5 py-1 font-mono text-xs font-bold text-[#176879]" dir="ltr">{item.codingSystem ? `${item.codingSystem} · ` : ""}{item.code}</span>}</div><p className="mt-3 truncate text-xs text-[#91a3a7]">{isArabic ? "المصدر" : "Source"}: {item.sourceAttachmentRefs.map((ref) => attachmentNames.get(ref) ?? ref).join(", ")}</p></div>)}</div></div>;
}

function ClaimEditor({ fields, setFields, category, opticalItem, issues, saving, onCancel, onSave }: {
  fields: ExtractedFields;
  setFields: (fields: ExtractedFields) => void;
  category: ClaimDetail["category"];
  opticalItem: ClaimDetail["opticalItem"];
  issues: ValidationIssue[];
  saving: boolean;
  onCancel: () => void;
  onSave: () => void;
}) {
  const { isArabic } = useLanguage();
  const setText = (key: TextField, value: string) => setFields({ ...fields, [key]: value || null });
  const setNumber = (key: NumberField, value: string) => setFields({ ...fields, [key]: numberOrNull(value) });
  const updateLine = (index: number, updates: Partial<ExtractedServiceLine>) => setFields({ ...fields, serviceLines: fields.serviceLines.map((line, lineIndex) => lineIndex === index ? { ...line, ...updates } : line) });
  const updateClinicalDescription = (
    kind: "diagnoses" | "procedures",
    index: number,
    description: string
  ) => setFields({
    ...fields,
    [kind]: fields[kind].map((item, itemIndex) =>
      itemIndex === index ? { ...item, description: description || null } : item
    )
  });
  const multipleInvoices = fields.invoices.length > 1;
  const fieldSeverity = (field: string) => issues.find((issue) => issue.field === field)?.severity;
  const inputTone = (field: string) => fieldSeverity(field) === "blocking_error"
    ? "border-[#c95d49] ring-2 ring-[#f8d8d1]"
    : fieldSeverity(field) === "warning"
      ? "border-[#c89632] ring-2 ring-[#f9edcf]"
      : "";
  const includeServiceDate = category !== "inpatient_surgery" || (!fields.admissionDate && !fields.dischargeDate);

  return (
    <div className="space-y-8">
      <SummarySection title={isArabic ? "تفاصيل المطالبة والفاتورة" : "Claim and invoice details"}>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {identityFields(isArabic, { includeServiceDate, multipleInvoices }).map(({ key, label, type }) => <Field key={key} fieldKey={key} label={label} severity={fieldSeverity(key)}><input type={type ?? "text"} value={(fields[key] as string | null) ?? ""} onChange={(event) => setText(key, event.target.value)} aria-invalid={fieldSeverity(key) === "blocking_error"} className={`review-input ${inputTone(key)}`} /></Field>)}
          <Field fieldKey="paymentStatus" label={isArabic ? "حالة الدفع" : "Payment status"}><select value={fields.paymentStatus} onChange={(event) => setFields({ ...fields, paymentStatus: event.target.value as ExtractedFields["paymentStatus"] })} className="review-input"><option value="unclear">{isArabic ? "غير واضحة" : "Unclear"}</option><option value="paid">{isArabic ? "مدفوعة" : "Paid"}</option><option value="unpaid">{isArabic ? "غير مدفوعة" : "Unpaid"}</option></select></Field>
          <Field fieldKey="paymentMethod" label={isArabic ? "طريقة الدفع" : "Payment method"}><select value={fields.paymentMethod} onChange={(event) => { const paymentMethod = event.target.value as ExtractedFields["paymentMethod"]; setFields({ ...fields, paymentMethod, cardNetwork: paymentMethod === "card" ? fields.cardNetwork : null }); }} className="review-input"><option value="unknown">{isArabic ? "غير ظاهرة في المستند" : "Not shown on document"}</option><option value="cash">{isArabic ? "نقداً" : "Cash"}</option><option value="card">{isArabic ? "بطاقة" : "Card"}</option><option value="bank_transfer">{isArabic ? "تحويل بنكي" : "Bank transfer"}</option><option value="digital_wallet">{isArabic ? "محفظة رقمية" : "Digital wallet"}</option><option value="cheque">{isArabic ? "شيك" : "Cheque"}</option><option value="other">{isArabic ? "أخرى" : "Other"}</option></select></Field>
          {fields.paymentMethod === "card" && <Field fieldKey="cardNetwork" label={isArabic ? "شبكة البطاقة" : "Card network"}><select value={fields.cardNetwork ?? ""} onChange={(event) => setFields({ ...fields, cardNetwork: (event.target.value || null) as ExtractedFields["cardNetwork"] })} className="review-input"><option value="">{isArabic ? "غير ظاهرة في المستند" : "Not shown on document"}</option><option value="mada">Mada</option><option value="visa">Visa</option><option value="mastercard">Mastercard</option><option value="amex">American Express</option><option value="other">{isArabic ? "أخرى" : "Other"}</option></select></Field>}
        </div>
      </SummarySection>
      <SummarySection title={multipleInvoices ? (isArabic ? "مبالغ الفاتورة الرئيسية" : "Primary invoice amounts") : (isArabic ? "المبالغ" : "Amounts")}>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {amountFields(isArabic, multipleInvoices).map(({ key, label }) => <Field key={key} fieldKey={key} label={label} severity={fieldSeverity(key)}><input type="number" min="0" step="0.01" value={(fields[key] as number | null) ?? ""} onChange={(event) => setNumber(key, event.target.value)} aria-invalid={fieldSeverity(key) === "blocking_error"} className={`review-input ${inputTone(key)}`} /></Field>)}
          {category === "optical" && (opticalItem === "frames" || opticalItem === "both") && <Field label={isArabic ? "مبلغ الإطار" : "Frame amount"}><input type="number" min="0" step="0.01" value={fields.opticalFrameAmount ?? ""} onChange={(event) => setNumber("opticalFrameAmount", event.target.value)} className="review-input" /></Field>}
          {category === "optical" && (opticalItem === "lenses" || opticalItem === "both") && <Field label={isArabic ? "مبلغ العدسات" : "Lens amount"}><input type="number" min="0" step="0.01" value={fields.opticalLensAmount ?? ""} onChange={(event) => setNumber("opticalLensAmount", event.target.value)} className="review-input" /></Field>}
        </div>
      </SummarySection>
      <div data-review-field="serviceLines">
      <SummarySection title={isArabic ? "بنود الفاتورة" : "Invoice items"}>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-xs leading-5 text-[#687a96]">{isArabic ? "أدرج فقط البنود الظاهرة في فاتورة نفس الزيارة أو الإجراء العلاجي." : "Only include a line item shown on the invoice for this same treatment episode."}</p>
          <button type="button" onClick={() => setFields({ ...fields, serviceLines: [...fields.serviceLines, emptyServiceLine()] })} className="w-fit shrink-0 rounded-xl border border-[#c9dcec] px-3 py-2 text-xs font-extrabold text-[#316a73] hover:bg-[#eef6fd]">{isArabic ? "إضافة بند مفقود" : "Add missing invoice item"}</button>
        </div>
        <div className="mt-4 space-y-4">
          {fields.serviceLines.length === 0 && <EmptyValue text={isArabic ? "لا توجد بنود فاتورة بعد." : "No invoice items yet."} />}
          {fields.serviceLines.map((line, index) => (
            <div key={index} className="rounded-2xl border border-[#dce6f0] bg-[#fbfdfd] p-4">
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <Field label={isArabic ? "الوصف" : "Description"} wide><input value={line.description ?? ""} onChange={(event) => updateLine(index, { description: event.target.value || null })} className="review-input" /></Field>
                <Field label={isArabic ? "تاريخ الخدمة" : "Service date"} severity={fieldSeverity("serviceLines")}><input type="date" value={line.serviceDate ?? ""} onChange={(event) => updateLine(index, { serviceDate: event.target.value || null })} aria-invalid={fieldSeverity("serviceLines") === "blocking_error"} className={`review-input ${inputTone("serviceLines")}`} /></Field>
                <Field label={isArabic ? "الكمية" : "Quantity"}><input type="number" min="0" step="0.01" value={line.quantity ?? ""} onChange={(event) => updateLine(index, { quantity: numberOrNull(event.target.value) })} className="review-input" /></Field>
                <Field label={isArabic ? "سعر الوحدة" : "Unit price"}><input type="number" min="0" step="0.01" value={line.unitPrice ?? ""} onChange={(event) => updateLine(index, { unitPrice: numberOrNull(event.target.value) })} className="review-input" /></Field>
                <Field label={isArabic ? "مبلغ البند" : "Line amount"}><input type="number" min="0" step="0.01" value={line.billedAmount ?? ""} onChange={(event) => updateLine(index, { billedAmount: numberOrNull(event.target.value) })} className="review-input" /></Field>
                <Field label={isArabic ? "العملة" : "Currency"}><input value={line.currency ?? ""} onChange={(event) => updateLine(index, { currency: event.target.value || null })} className="review-input" /></Field>
                <Field label={isArabic ? "التشخيص" : "Diagnosis"}><input value={line.diagnosisText ?? ""} onChange={(event) => updateLine(index, { diagnosisText: event.target.value || null })} className="review-input" /></Field>
                {category === "dental" && <Field label={isArabic ? "رقم السن" : "Tooth number"}><input value={line.toothNumber ?? ""} onChange={(event) => updateLine(index, { toothNumber: event.target.value || null })} className="review-input" /></Field>}
              </div>
              <button type="button" onClick={() => setFields({ ...fields, serviceLines: fields.serviceLines.filter((_, lineIndex) => lineIndex !== index) })} className="mt-3 rounded-lg px-2.5 py-1.5 text-xs font-bold text-[#9a5545] hover:bg-[#fff0ed]">{isArabic ? "إزالة الخدمة" : "Remove service"}</button>
            </div>
          ))}
        </div>
      </SummarySection>
      </div>
      {(fields.diagnoses.length > 0 || fields.procedures.length > 0) && (
        <SummarySection title={isArabic ? "التفاصيل الطبية" : "Medical details"}>
          <p className="mb-4 text-xs leading-5 text-[#687a96]">
            {isArabic ? "يمكنك تصحيح الوصف. تبقى الرموز المطبوعة مرتبطة بالمستند الأصلي ولا يمكن تعديلها هنا." : "You can correct descriptions. Printed codes remain tied to the source document and cannot be edited here."}
          </p>
          <div className="space-y-4">
            {(["diagnoses", "procedures"] as const).map((kind) => fields[kind].map((item, index) => (
              <Field key={`${kind}-${index}`} label={kind === "diagnoses" ? (isArabic ? "التشخيص" : "Diagnosis") : (isArabic ? "الإجراء" : "Procedure")}>
                <input value={item.description ?? ""} onChange={(event) => updateClinicalDescription(kind, index, event.target.value)} className="review-input" />
                {item.code && <span className="mt-1 block text-xs text-[#82999e]">{item.codingSystem ? `${item.codingSystem} · ` : ""}{item.code}</span>}
              </Field>
            )))}
          </div>
        </SummarySection>
      )}
      {category === "inpatient_surgery" && <SummarySection title={isArabic ? "تفاصيل الدخول" : "Admission details"}><div className="grid gap-4 sm:grid-cols-2"><Field fieldKey="admissionDate" label={isArabic ? "تاريخ الدخول" : "Admission date"}><input type="date" value={fields.admissionDate ?? ""} onChange={(event) => setText("admissionDate", event.target.value)} className="review-input" /></Field><Field fieldKey="dischargeDate" label={isArabic ? "تاريخ الخروج" : "Discharge date"}><input type="date" value={fields.dischargeDate ?? ""} onChange={(event) => setText("dischargeDate", event.target.value)} className="review-input" /></Field></div></SummarySection>}
      <div className="flex flex-col-reverse gap-3 border-t border-[#e5edef] pt-5 sm:flex-row sm:justify-end"><button type="button" onClick={onCancel} disabled={saving} className="rounded-xl border border-[#c9dcec] px-5 py-3 text-sm font-extrabold text-[#58767c] hover:bg-[#f5f9f9] disabled:opacity-60">{isArabic ? "إلغاء" : "Cancel"}</button><button type="button" onClick={onSave} disabled={saving} className="rounded-xl bg-[#005eb8] px-5 py-3 text-sm font-extrabold text-white transition hover:bg-[#004f9f] disabled:opacity-60">{saving ? (isArabic ? "جارٍ الحفظ والتحقق..." : "Saving and checking...") : (isArabic ? "حفظ التغييرات" : "Save changes")}</button></div>
    </div>
  );
}

function SummarySection({ title, edited = false, children }: { title: string; edited?: boolean; children: ReactNode }) { return <section><div className="mb-4 flex flex-wrap items-center gap-2"><h3 className="text-sm font-semibold text-[#425979]">{title}</h3>{edited && <MemberEditBadge />}</div>{children}</section>; }
function ReviewDisclosure({ title, description, edited = false, children }: { title: string; description: string; edited?: boolean; children: ReactNode }) { return <details className="review-disclosure group rounded-2xl border border-[#dce6f0] bg-[#fbfdfd]"><summary className="flex cursor-pointer list-none items-center justify-between gap-4 p-4 focus:outline-none focus-visible:ring-4 focus-visible:ring-inset focus-visible:ring-[#0072ce]/20"><span><span className="flex flex-wrap items-center gap-2 text-sm font-extrabold text-[#425979]">{title}{edited && <MemberEditBadge />}</span><span className="mt-1 block text-xs font-medium leading-5 text-[#687a96]">{description}</span></span><ChevronIcon open={false} /></summary><div className="border-t border-[#e8edf5] p-4 sm:p-5">{children}</div></details>; }
function SummaryValue({ label, value, sources, evidenceSources, attachmentNames, edited = false, severity, isArabic }: { label: string; value: string; sources?: string[]; evidenceSources?: ClaimReview["evidenceSources"][string]; attachmentNames: Map<string, string>; edited?: boolean; severity?: ValidationIssue["severity"]; isArabic: boolean }) { const unitLabels = evidenceSourceLabels(evidenceSources, isArabic); const fallbackNames = (sources ?? []).map((id) => attachmentNames.get(id)).filter(Boolean) as string[]; return <ReviewSummaryValue label={label} value={value} sourceNames={unitLabels.length > 0 ? unitLabels : fallbackNames} edited={edited} severity={severity} isArabic={isArabic} />; }
function MemberEditBadge() { const { isArabic } = useLanguage(); return <span className="inline-flex rounded-full bg-[#eef3f6] px-1.5 py-0.5 text-[9px] font-semibold text-[#71858c]">{isArabic ? "تم التعديل" : "Edited"}</span>; }
function ServiceLineSummary({ line, index }: { line: ExtractedServiceLine; index: number }) { const { language, isArabic } = useLanguage(); return <div className="rounded-2xl border border-[#e0eaec] bg-[#fbfdfd] p-4"><div className="flex items-start justify-between gap-3"><div><p className="text-[11px] font-medium text-[#687a96]">{isArabic ? "بند الفاتورة" : "Invoice item"} {index + 1}</p><p className="mt-1 text-sm font-semibold text-[#0b1e3d]">{display(line.description, isArabic)}</p></div><p className="shrink-0 text-sm font-semibold text-[#216f78]">{money(line.billedAmount, line.currency, language)}</p></div><div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-xs text-[#687a96]">{line.serviceDate && <span>{line.serviceDate}</span>}{line.quantity !== null && <span>{isArabic ? "الكمية" : "Qty"} {line.quantity}</span>}{line.unitPrice !== null && <span>{isArabic ? "الوحدة" : "Unit"} {money(line.unitPrice, line.currency, language)}</span>}{line.toothNumber && <span>{isArabic ? "السن" : "Tooth"} {line.toothNumber}</span>}{line.diagnosisCode && <span>{isArabic ? "التشخيص" : "Diagnosis"} {line.diagnosisCode}</span>}{line.procedureCode && <span>{isArabic ? "الإجراء" : "Procedure"} {line.procedureCode}</span>}</div></div>; }
function EmptyValue({ text }: { text: string }) { return <p className="rounded-2xl border border-dashed border-[#cbdde0] bg-[#fafcfc] px-4 py-5 text-center text-sm text-[#7a9297]">{text}</p>; }
function Field({ label, fieldKey, wide = false, severity, children }: { label: string; fieldKey?: string; wide?: boolean; severity?: ValidationIssue["severity"]; children: ReactNode }) { const { isArabic } = useLanguage(); return <label data-review-field={fieldKey} className={wide ? "sm:col-span-2" : ""}><span className="mb-1.5 flex items-center gap-2 text-xs font-extrabold text-[#58767c]">{label}{severity && <span className={severity === "blocking_error" ? "text-[#a04c39]" : severity === "warning" ? "text-[#8a6118]" : "text-[#005eb8]"}>{severity === "blocking_error" ? (isArabic ? "تصحيح مطلوب" : "Must fix") : severity === "warning" ? (isArabic ? "تنبيه" : "Warning") : (isArabic ? "معلومة" : "Information")}</span>}</span>{children}</label>; }

function ReviewProgress({ onDetails, onDocuments, isArabic }: { onDetails: () => void; onDocuments: () => void; isArabic: boolean }) {
  const steps = [{ label: isArabic ? "تفاصيل المطالبة" : "Claim details", action: onDetails }, { label: isArabic ? "المستندات" : "Documents", action: onDocuments }, { label: isArabic ? "المراجعة" : "Review", action: null }];
  return <ol aria-label={isArabic ? "تقدم المطالبة" : "Claim progress"} className="grid grid-cols-3 gap-1 rounded-2xl border border-[#dce6f0] bg-white p-2 sm:flex sm:items-center sm:gap-0 sm:px-5">{steps.map((step, index) => <li key={step.label} aria-current={step.action ? undefined : "step"} className="flex min-w-0 flex-1 flex-col items-center gap-1 text-center sm:flex-row sm:gap-2 sm:text-start">{step.action ? <button type="button" onClick={step.action} aria-label={`${step.label} — ${isArabic ? "مكتملة" : "completed"}`} className="group flex min-w-0 flex-col items-center gap-1 rounded-xl px-1 py-1 text-[#28745f] hover:bg-[#eff8f5] sm:flex-row sm:gap-2"><span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-[#28745f] text-xs font-extrabold text-white shadow-sm">✓</span><span className="w-full text-[10px] font-bold leading-tight underline-offset-4 group-hover:underline sm:w-auto sm:text-sm">{step.label}</span></button> : <><span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-[#005eb8] text-xs font-extrabold text-white shadow-sm">3</span><span className="w-full text-[10px] font-bold leading-tight text-[#0b1e3d] sm:w-auto sm:text-sm">{step.label}<span className="sr-only"> — {isArabic ? "الخطوة الحالية" : "current step"}</span></span></>}{index < steps.length - 1 && <span className="hidden h-px flex-1 bg-[#8bc9b7] sm:block" />}</li>)}</ol>;
}

function canConfirm(code: string) { return ["document_readability_unclear", "document_relevance_unclear", "document_type_unclear", "invoice_reference_unclear", "invoice_currency_mismatch", "invoice_subtotal_needs_review", "invoice_total_needs_review", "patient_name_mismatch", "provider_mismatch", "service_date_mismatch", "payment_evidence_unclear", "payment_currency_mismatch", "payment_amount_mismatch", "payment_coverage_unclear", "episode_dates_unclear"].includes(code); }
function confirmationLabel(code: string, isArabic: boolean) { if (code.includes("document_readability")) return isArabic ? "المستند واضح" : "Document is clear"; if (code.includes("document_relevance")) return isArabic ? "ينتمي إلى هذه المطالبة" : "It belongs to this claim"; if (code === "document_type_unclear") return isArabic ? "نوع المستند صحيح" : "Document type is correct"; if (code === "category_unclear") return isArabic ? "فئة المطالبة صحيحة" : "Selected category is correct"; if (code === "episode_dates_unclear") return isArabic ? "نفس الحالة العلاجية" : "Same treatment episode"; if (code.startsWith("payment_")) return isArabic ? "إثبات الدفع صحيح" : "Payment evidence is correct"; if (code.includes("mismatch")) return isArabic ? "هذه التفاصيل متطابقة" : "These details match"; return isArabic ? "القيمة المستخرجة صحيحة" : "Extracted value is correct"; }
function issueKey(issue: ValidationIssue) { return `${issue.code}-${issue.attachmentId ?? "claim"}-${issue.evidenceUnitId ?? "attachment"}`; }
function emptyServiceLine(): ExtractedFields["serviceLines"][number] { return { description: null, serviceDate: null, quantity: null, unitPrice: null, billedAmount: null, currency: null, diagnosisText: null, diagnosisCode: null, procedureCode: null, sbsCode: null, sbsDescription: null, toothNumber: null, sourceAttachmentRefs: [], sourceEvidenceUnitRefs: [] }; }
function cloneFields(fields: ExtractedFields): ExtractedFields { return { ...fields, serviceLines: fields.serviceLines.map((line) => ({ ...line, sourceAttachmentRefs: [...line.sourceAttachmentRefs], sourceEvidenceUnitRefs: [...line.sourceEvidenceUnitRefs] })), diagnoses: fields.diagnoses.map((item) => ({ ...item, sourceAttachmentRefs: [...item.sourceAttachmentRefs], sourceEvidenceUnitRefs: [...item.sourceEvidenceUnitRefs] })), procedures: fields.procedures.map((item) => ({ ...item, sourceAttachmentRefs: [...item.sourceAttachmentRefs], sourceEvidenceUnitRefs: [...item.sourceEvidenceUnitRefs] })), invoices: fields.invoices.map((invoice) => ({ ...invoice, items: invoice.items.map((item) => ({ ...item, sourceAttachmentRefs: [...item.sourceAttachmentRefs], sourceEvidenceUnitRefs: [...item.sourceEvidenceUnitRefs] })) })), paymentEvidence: fields.paymentEvidence.map((item) => ({ ...item })) }; }
function numberOrNull(value: string) { return value === "" ? null : Number(value); }
function display(value: string | number | null | undefined, isArabic = false) { return value === null || value === undefined || value === "" ? (isArabic ? "غير موجود" : "Not found") : String(value); }
function money(value: number | null, currency: string | null, language: "en" | "ar" = "en") { return value === null ? (language === "ar" ? "غير موجود" : "Not found") : `${currency ?? ""} ${value.toLocaleString(language === "ar" ? "ar-SA" : "en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`.trim(); }
function formatFileSize(bytes: number) { return bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / (1024 * 1024)).toFixed(1)} MB`; }
function formatSubmittedDate(value: string, language: "en" | "ar" = "en") { return new Intl.DateTimeFormat(language === "ar" ? "ar-SA" : "en-US", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value)); }
function formatDocumentType(value: string, language: "en" | "ar" = "en") { const arabic: Record<string, string> = { unknown: "غير معروف", invoice: "فاتورة", receipt: "إيصال دفع", medical_report: "تقرير طبي", prescription: "وصفة طبية", lab_result: "نتيجة مختبر", imaging_result: "نتيجة أشعة", paid: "مدفوعة", unpaid: "غير مدفوعة", unclear: "غير واضحة" }; if (language === "ar") return arabic[value] ?? value.replaceAll("_", " "); const label = value.replaceAll("_", " "); return label ? `${label[0]!.toUpperCase()}${label.slice(1)}` : label; }
function paymentMethodLabel(value: ExtractedFields["paymentMethod"], isArabic: boolean) { const arabic: Record<ExtractedFields["paymentMethod"], string> = { cash: "نقداً", card: "بطاقة", bank_transfer: "تحويل بنكي", digital_wallet: "محفظة رقمية", cheque: "شيك", other: "أخرى", unknown: "غير ظاهرة في المستند" }; if (isArabic) return arabic[value]; return formatDocumentType(value); }
function cardNetworkLabel(value: NonNullable<ExtractedFields["cardNetwork"]>, isArabic: boolean) { if (isArabic) return ({ mada: "مدى", visa: "فيزا", mastercard: "ماستركارد", amex: "أمريكان إكسبريس", other: "أخرى" } as Record<string, string>)[value]; return ({ mada: "Mada", visa: "Visa", mastercard: "Mastercard", amex: "American Express", other: "Other" } as Record<string, string>)[value]; }
function BackIcon() { return <svg viewBox="0 0 24 24" className="directional-back-icon h-4 w-4" aria-hidden="true"><path d="m14 6-6 6 6 6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>; }
function ChevronIcon({ open }: { open: boolean }) { return <svg viewBox="0 0 20 20" className={`h-4 w-4 transition-transform duration-200 ${open ? "rotate-180" : ""}`} aria-hidden="true"><path d="m5 7.5 5 5 5-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>; }
