import { useEffect, useState } from "react";
import { Navigate, useNavigate, useParams } from "react-router-dom";
import { SahlBrand } from "../components/brand-mark";
import { HeaderUtilities } from "../components/demo-ops-launcher";
import { useLanguage } from "../i18n/language-context";
import { claimsApi, localizedApiError } from "../lib/api";
import { formatCategory } from "../lib/claim-content";
import type { ClaimDetail } from "../types";
import { Button, DelayedPageState, PageState } from "../components/ui";

export function SubmittedClaimPage() {
  const { claimId } = useParams();
  const navigate = useNavigate();
  const { language, isArabic } = useLanguage();
  const [claim, setClaim] = useState<ClaimDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!claimId) return;
    setLoading(true);
    setError(null);
    void claimsApi.get(claimId)
      .then(setClaim)
      .catch((requestError) => setError(localizedApiError(
        requestError,
        isArabic,
        "تعذر فتح تفاصيل المطالبة. حاول مرة أخرى.",
        "We could not open this claim. Please try again."
      )))
      .finally(() => setLoading(false));
  }, [claimId, isArabic]);

  if (loading) {
    return <DelayedPageState title={isArabic ? "جارٍ فتح تفاصيل المطالبة" : "Opening claim details"} description={isArabic ? "جارٍ تحميل هذه المطالبة." : "Loading this claim."} />;
  }

  if (!claim || !claimId) {
    return <PageState tone="error" title={error ?? (isArabic ? "تعذر فتح هذه المطالبة." : "This claim could not be opened.")} />;
  }

  if (claim.status !== "accepted_for_processing") {
    const destination = claim.status === "ready" || claim.status === "needs_review"
      ? `/claims/${claimId}/review`
      : `/claims/${claimId}/documents`;
    return <Navigate to={destination} replace />;
  }

  if (!claim.submission) {
    return <PageState tone="error" title={isArabic ? "بيانات إرسال هذه المطالبة غير متاحة." : "Submission details are unavailable for this claim."} />;
  }

  const submission = claim.submission;
  const fields = claim.review.extracted;
  const invoices = fields.invoices;
  const multipleInvoices = invoices.length > 1;
  const invoiceDates = [...new Set(invoices.map((invoice) => invoice.invoiceDate).filter((value): value is string => Boolean(value)))];
  const invoiceCurrencies = [...new Set(invoices.map((invoice) => invoice.currency?.trim().toUpperCase()).filter((value): value is string => Boolean(value)))];
  const combinedInvoiceTotal = invoices.length > 1 && invoices.every((invoice) => invoice.billedAmount !== null) && invoiceCurrencies.length === 1
    ? invoices.reduce((total, invoice) => total + (invoice.billedAmount ?? 0), 0)
    : null;
  const invoiceReferenceSummary = multipleInvoices
    ? (isArabic ? `${invoices.length} فواتير` : `${invoices.length} invoices`)
    : display(fields.invoiceReference, isArabic);
  const invoiceDateSummary = multipleInvoices
    ? invoiceDates.length === 1
      ? invoiceDates[0]
      : (isArabic ? "تواريخ متعددة" : "Multiple dates")
    : display(fields.invoiceDate, isArabic);
  const totalSummary = multipleInvoices
    ? combinedInvoiceTotal !== null
      ? money(combinedInvoiceTotal, invoiceCurrencies[0], language)
      : invoiceCurrencies.length > 1
        ? (isArabic ? "عملات متعددة" : "Multiple currencies")
        : (isArabic ? "راجع الفواتير المرسلة" : "See submitted invoices")
    : money(fields.billedAmount, fields.currency, language);

  return (
    <main className="sahl-app min-h-screen bg-[#f4f7fb] text-[#0b1e3d]">
      <header className="sahl-topbar border-b border-[#dce6f0] bg-white/95 backdrop-blur">
        <div className="relative mx-auto flex min-h-14 max-w-4xl items-center justify-between gap-2 px-3 py-2 sm:gap-4 sm:px-6">
          <button type="button" onClick={() => navigate("/claims")} className="group flex items-center gap-2 rounded-xl px-2 py-2 text-sm font-medium text-[#425979] transition hover:bg-[#f7fafd]">
            <BackIcon /> {isArabic ? "العودة إلى المطالبات" : "Back to claims"}
          </button>
          <div className="absolute start-1/2 hidden -translate-x-1/2 md:block rtl:translate-x-1/2"><SahlBrand compact /></div>
          <HeaderUtilities />
        </div>
      </header>

      <div className="mx-auto max-w-4xl px-4 py-8 sm:px-6 sm:py-10">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[#0072ce]">{isArabic ? "مطالبة مرسلة" : "Submitted claim"}</p>
            <h1 className="mt-2 text-2xl font-semibold tracking-[-0.035em] text-[#0b1e3d] sm:text-3xl">{isArabic ? "تفاصيل المطالبة" : "Claim details"}</h1>
            <p className="mt-2 font-mono text-sm font-semibold tracking-wide text-[#687a96]">{claim.claimId}</p>
          </div>
          <span className="w-fit rounded-full bg-[#e8f7f1] px-3 py-1.5 text-xs font-semibold text-[#27755f]">
            {isArabic ? "مقبولة للمعالجة" : "Accepted for processing"}
          </span>
        </div>

        <section className="mt-7 rounded-[24px] border border-[#cfe6df] bg-[#f5fbf8] p-5 sm:p-6">
          <div className="flex items-start gap-4">
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-[#dff2eb] text-[#28745f]" aria-hidden="true">✓</span>
            <div>
              <h2 className="text-base font-semibold text-[#205448]">{isArabic ? "تم استلام مطالبتك" : "Your claim has been received"}</h2>
              <p className="mt-1.5 text-sm leading-6 text-[#617f77]">
                {isArabic ? "المطالبة قيد المعالجة. لا تعني هذه الحالة أنه تمت الموافقة عليها أو دفعها." : "The claim is being processed. This status does not mean it has been approved or paid."}
              </p>
            </div>
          </div>
        </section>

        {(submission.payload.unresolvedWarnings?.length ?? 0) > 0 && (
          <section className="mt-5 rounded-[24px] border border-[#ead9bd] bg-[#fffaf2] p-5 sm:p-6">
            <h2 className="text-sm font-semibold text-[#7a5618]">{isArabic ? "تنبيهات محفوظة مع الإرسال" : "Warnings retained with this submission"}</h2>
            <p className="mt-1 text-xs leading-5 text-[#806b45]">{isArabic ? "لم تمنع هذه التنبيهات الإرسال، وتم حفظها للمراجعة أثناء المعالجة." : "These warnings did not block submission and remain available during processing."}</p>
            <ul className="mt-3 space-y-2">{submission.payload.unresolvedWarnings.map((issue) => <li key={`${issue.code}-${issue.attachmentId ?? "claim"}`} className="rounded-xl border border-[#ead9bd] bg-white px-3 py-2 text-xs text-[#6f5c38]">{issue.message}</li>)}</ul>
          </section>
        )}

        <section className="mt-6 overflow-hidden rounded-[24px] border border-[#dce6f0] bg-white shadow-[0_12px_34px_rgba(38,79,89,0.05)]">
          <SectionHeading title={isArabic ? "بيانات الإرسال" : "Submission details"} />
          <dl className="grid gap-px bg-[#e8edf5] sm:grid-cols-2">
            <DetailField label={isArabic ? "فئة المطالبة" : "Claim category"} value={formatCategory(claim.category, claim.opticalItem, language)} />
            <DetailField label={isArabic ? "مرجع الاستلام" : "Acceptance reference"} value={submission.acceptanceReference} mono />
            <DetailField label={isArabic ? "تاريخ الإرسال" : "Submitted"} value={formatSubmittedDate(submission.submittedAt, language)} />
            <DetailField label={isArabic ? "الحالة" : "Status"} value={isArabic ? "مقبولة للمعالجة" : "Accepted for processing"} />
          </dl>
        </section>

        <section className="mt-6 overflow-hidden rounded-[24px] border border-[#dce6f0] bg-white shadow-[0_12px_34px_rgba(38,79,89,0.05)]">
          <SectionHeading title={isArabic ? "ملخص المطالبة" : "Claim summary"} />
          <dl className="grid gap-x-6 px-5 pb-5 sm:grid-cols-2 sm:px-6 sm:pb-6 lg:grid-cols-3">
            <SummaryField label={isArabic ? "اسم المريض" : "Patient name"} value={display(fields.patientName, isArabic)} />
            <SummaryField label={isArabic ? "مقدم الخدمة" : "Provider"} value={display(fields.providerName, isArabic)} />
            {(multipleInvoices || fields.invoiceReference) && <SummaryField label={multipleInvoices ? (isArabic ? "الفواتير" : "Invoices") : (isArabic ? "رقم الفاتورة" : "Invoice reference")} value={invoiceReferenceSummary} />}
            <SummaryField label={multipleInvoices ? (isArabic ? "تواريخ الفواتير" : "Invoice dates") : (isArabic ? "تاريخ الفاتورة" : "Invoice date")} value={invoiceDateSummary} />
            {claim.category === "inpatient_surgery" ? (
              <>
                {fields.admissionDate && <SummaryField label={isArabic ? "تاريخ الدخول" : "Admission date"} value={fields.admissionDate} />}
                {fields.dischargeDate && <SummaryField label={isArabic ? "تاريخ الخروج" : "Discharge date"} value={fields.dischargeDate} />}
                {!fields.admissionDate && !fields.dischargeDate && fields.serviceDate && (
                  <SummaryField label={isArabic ? "تاريخ الخدمة" : "Service date"} value={fields.serviceDate} />
                )}
              </>
            ) : fields.serviceDate ? (
              <SummaryField label={isArabic ? "تاريخ الخدمة" : "Service date"} value={fields.serviceDate} />
            ) : null}
            <SummaryField label={multipleInvoices ? (isArabic ? "الإجمالي المجمع" : "Combined total") : (isArabic ? "الإجمالي النهائي" : "Final total")} value={totalSummary} />
          </dl>
        </section>

        <section className="mt-6 overflow-hidden rounded-[24px] border border-[#dce6f0] bg-white shadow-[0_12px_34px_rgba(38,79,89,0.05)]">
          <SectionHeading title={isArabic ? "المستندات المرسلة" : "Submitted documents"} detail={`${claim.attachments.length}`} />
          <ul className="divide-y divide-[#e8edf5] px-5 pb-2 sm:px-6">
            {claim.attachments.map((attachment) => (
              <li key={attachment.attachmentId} className="flex items-center justify-between gap-4 py-4">
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-[#0b1e3d]">{attachment.originalFilename}</p>
                  <p className="mt-1 text-xs text-[#8a9bbb]">{formatFileSize(attachment.sizeBytes)}</p>
                </div>
                <span className="shrink-0 rounded-lg bg-[#eef6fd] px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide text-[#005eb8]">{fileType(attachment.mimeType)}</span>
              </li>
            ))}
          </ul>
        </section>

        <div className="mt-7 flex justify-center">
          <Button fullWidth size="lg" onClick={() => navigate("/claims")}>
            {isArabic ? "العودة إلى المطالبات" : "Back to claims"}
          </Button>
        </div>
      </div>
    </main>
  );
}

function SectionHeading({ title, detail }: { title: string; detail?: string }) {
  return <div className="flex items-center justify-between gap-3 px-5 py-5 sm:px-6"><h2 className="text-base font-semibold text-[#0b1e3d]">{title}</h2>{detail && <span className="rounded-full bg-[#f0f4fa] px-2.5 py-1 text-xs font-semibold text-[#687a96]">{detail}</span>}</div>;
}

function DetailField({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return <div className="bg-white px-5 py-4 sm:px-6"><dt className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[#8a9bbb]">{label}</dt><dd className={`mt-1.5 break-words text-sm font-semibold text-[#0b1e3d] ${mono ? "font-mono tracking-wide" : ""}`}>{value}</dd></div>;
}

function SummaryField({ label, value }: { label: string; value: string }) {
  return <div className="border-b border-[#f0f4fa] py-4"><dt className="text-[11px] font-medium text-[#8a9bbb]">{label}</dt><dd className="mt-1 break-words text-sm font-medium text-[#0b1e3d]">{value}</dd></div>;
}

function formatSubmittedDate(value: string, language: "en" | "ar") {
  return new Intl.DateTimeFormat(language === "ar" ? "ar-SA" : "en-US", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}

function display(value: string | null, isArabic: boolean) {
  return value ? value : (isArabic ? "غير موجود" : "Not found");
}

function money(value: number | null, currency: string | null, language: "en" | "ar") {
  if (value === null) return language === "ar" ? "غير موجود" : "Not found";
  return `${currency ?? ""} ${value.toLocaleString(language === "ar" ? "ar-SA" : "en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`.trim();
}

function formatFileSize(bytes: number) {
  return bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function fileType(mimeType: string) {
  if (mimeType === "application/pdf") return "PDF";
  if (mimeType.startsWith("image/")) return "IMG";
  return "FILE";
}

function BackIcon() {
  return <svg viewBox="0 0 24 24" className="directional-back-icon h-4 w-4" aria-hidden="true"><path d="m14 6-6 6 6 6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>;
}
