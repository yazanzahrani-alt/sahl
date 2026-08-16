import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../auth/auth-context";
import { apiUrl, localizedApiError, opsApi } from "../lib/api";
import { formatCategory, formatLocation } from "../lib/claim-content";
import type { ClaimFieldProvenance, ClaimSubmission, MemberEditedField, SubmissionPayload } from "../types";
import { useLanguage } from "../i18n/language-context";
import { HeaderUtilities } from "../components/demo-ops-launcher";
import { SahlBrand } from "../components/brand-mark";
import { documentRoleLabel } from "../lib/document-role-label";
import { OpsEvidenceUnitPipeline } from "../components/ops-evidence-unit-pipeline";

export function OpsPage() {
  const navigate = useNavigate();
  const { logout } = useAuth();
  const { language, isArabic } = useLanguage();
  const [claims, setClaims] = useState<ClaimSubmission[]>([]);
  const [selectedClaimId, setSelectedClaimId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function loadClaims() {
    setLoading(true);
    setError(null);
    try {
      const accepted = await opsApi.listAccepted();
      setClaims(accepted);
      setSelectedClaimId((current) =>
        current && accepted.some((claim) => claim.claimId === current)
          ? current
          : accepted[0]?.claimId ?? null
      );
    } catch (requestError) {
      setError(localizedApiError(requestError, isArabic, "تعذر فتح شاشة العمليات التجريبية.", "We could not open the synthetic Ops view."));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadClaims();
  }, [isArabic]);

  const selected = useMemo(
    () => claims.find((claim) => claim.claimId === selectedClaimId) ?? null,
    [claims, selectedClaimId]
  );

  async function handleLogout() {
    await logout();
    navigate("/login", { replace: true });
  }

  return (
    <main className="sahl-app sahl-ops min-h-screen bg-[#f4f7fb] text-[#0b1e3d]">
      <header className="sahl-topbar border-b border-[#dce6f0] bg-[#0b1e3d] text-white shadow-sm">
        <div className="mx-auto flex max-w-[1500px] flex-wrap items-center justify-between gap-3 px-4 py-3 sm:flex-nowrap sm:gap-4 sm:px-8 sm:py-4">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => navigate("/claims")}
              className="grid h-10 w-10 place-items-center rounded-xl border border-white/20 bg-white/10 transition hover:bg-white/15"
              aria-label={isArabic ? "العودة إلى مطالبات العضو" : "Return to member claims"}
            >
              <BackIcon />
            </button>
            <div className="flex items-center gap-3">
              <SahlBrand light compact />
              <div className="hidden h-8 w-px bg-white/15 sm:block" aria-hidden="true" />
              <div className="hidden sm:block">
                <div className="flex items-center gap-2">
                  <p className="text-sm font-extrabold tracking-tight">{isArabic ? "عرض العمليات" : "Ops view"}</p>
                  <span className="rounded-full bg-white/10 px-2 py-0.5 text-[10px] font-extrabold uppercase tracking-wide text-[#9dccf3]">
                    {isArabic ? "تجريبي" : "Demo"}
                  </span>
                </div>
                <p className="text-[11px] text-white/55">{isArabic ? "بيانات جاهزة للمعالجة" : "Processing-ready handoff"}</p>
              </div>
            </div>
          </div>
          <div className="flex items-center justify-end gap-2">
            <HeaderUtilities dark />
            <button
              type="button"
              onClick={() => void loadClaims()}
              disabled={loading}
              className="rounded-xl border border-white/20 px-3 py-2 text-xs font-bold transition hover:bg-white/10 disabled:opacity-50"
            >
              {loading ? (isArabic ? "جارٍ التحديث..." : "Refreshing...") : (isArabic ? "تحديث" : "Refresh")}
            </button>
            <button
              type="button"
              onClick={() => void handleLogout()}
              className="rounded-xl border border-white/20 px-3 py-2 text-xs font-bold transition hover:bg-white/10"
            >
              {isArabic ? "تسجيل الخروج" : "Sign out"}
            </button>
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-[1500px] px-5 py-7 sm:px-8 sm:py-9">
        <section className="ops-page-heading flex flex-col justify-between gap-4 md:flex-row md:items-end">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[#0072ce]">{isArabic ? "التسليم للمعالجة الداخلية" : "Downstream handoff"}</p>
            <h1 className="mt-2 text-2xl font-semibold tracking-[-0.02em] text-[#0b1e3d] sm:text-3xl">{isArabic ? "المطالبات المقبولة للمعالجة" : "Claims accepted for processing"}</h1>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-[#687a96]">
              {isArabic ? "إرسالات تجريبية للقراءة فقط ومُعدة للمعالجة الداخلية. لا يمكن لهذه الشاشة الموافقة على المطالبة أو رفضها أو تسعيرها أو دفعها." : "Read-only synthetic submissions prepared for internal processing. This view cannot approve, reject, price, or pay a claim."}
            </p>
          </div>
          <div className="w-fit rounded-2xl border border-[#c9dcec] bg-[#f7fafd] px-4 py-3">
            <p className="text-[10px] font-extrabold uppercase tracking-[0.12em] text-[#8a9bbb]">{isArabic ? "الإرسالات المقبولة" : "Accepted submissions"}</p>
            <p className="mt-1 text-2xl font-black text-[#0b1e3d]">{loading ? "—" : claims.length}</p>
          </div>
        </section>

        {error ? (
          <PageMessage
            title={isArabic ? "بيانات العمليات غير متاحة" : "Ops data is unavailable"}
            description={error}
            action={isArabic ? "حاول مرة أخرى" : "Try again"}
            onAction={() => void loadClaims()}
          />
        ) : loading ? (
          <PageMessage title={isArabic ? "جارٍ تحميل المطالبات المقبولة" : "Loading accepted claims"} description={isArabic ? "جارٍ قراءة لقطات الإرسال التجريبية النهائية." : "Reading finalized synthetic submission snapshots."} />
        ) : claims.length === 0 ? (
          <PageMessage title={isArabic ? "لا توجد مطالبات مقبولة بعد" : "No accepted claims yet"} description={isArabic ? "أرسل مطالبة عضو مكتملة وستظهر هنا كلقطة معالجة للقراءة فقط." : "Submit a clean member claim and it will appear here as a read-only processing snapshot."} action={isArabic ? "العودة إلى المطالبات" : "Return to claims"} onAction={() => navigate("/claims")} />
        ) : (
        <section className="mt-7 grid gap-5 lg:grid-cols-[22rem_minmax(0,1fr)] lg:items-start">
            <aside className="max-h-[22rem] overflow-hidden rounded-[24px] border border-[#dce6f0] bg-white shadow-[0_12px_35px_rgba(38,79,89,0.06)] lg:max-h-none">
              <div className="border-b border-[#e8edf5] bg-[#f7fafd] px-5 py-4">
                <h2 className="text-base font-semibold text-[#0b1e3d]">{isArabic ? "قائمة انتظار المعالجة" : "Processing queue"}</h2>
                <p className="mt-1 text-xs text-[#7a9196]">{isArabic ? "الأحدث أولاً" : "Newest submissions first"}</p>
              </div>
              <ul className="max-h-[16.5rem] divide-y divide-[#e8edf5] overflow-y-auto lg:max-h-none">
                {claims.map((claim) => {
                  const active = claim.claimId === selected?.claimId;
                  return (
                    <li key={claim.claimId}>
                      <button
                        type="button"
                        onClick={() => setSelectedClaimId(claim.claimId)}
                        className={`ops-queue-item w-full px-5 py-4 text-start transition ${active ? "ops-queue-item-active shadow-[inset_3px_0_0_#4a9ee0]" : "hover:bg-[#f7fafd]"}`}
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <p className="truncate text-sm font-extrabold text-[#0b1e3d]">{formatCategory(claim.payload.claim.category, claim.payload.claim.opticalItem, language)}</p>
                            <p className="mt-1 text-xs font-semibold text-[#6f878d]">{claim.claimId}</p>
                          </div>
                          <span className="mt-0.5 h-2 w-2 shrink-0 rounded-full bg-[#48a98e]" />
                        </div>
                        <p className="mt-2 text-[11px] text-[#8a9da2]">{formatDateTime(claim.submittedAt, language)}</p>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </aside>

            {selected && <OpsClaimDetail submission={selected} />}
          </section>
        )}
      </div>
    </main>
  );
}

function OpsClaimDetail({ submission }: { submission: ClaimSubmission }) {
  const { payload } = submission;
  const { language, isArabic } = useLanguage();
  const primaryInvoice = payload.invoices[0] ?? null;
  const invoiceCurrencies = [...new Set(payload.invoices.map((invoice) => invoice.currency).filter(Boolean))];
  const serviceDates = [...new Set(payload.invoices.flatMap((invoice) => [
    invoice.serviceDate,
    ...invoice.items.map((item) => item.serviceDate)
  ]).filter((value): value is string => Boolean(value)))];
  const serviceDateSummary = serviceDates.length === 1
    ? serviceDates[0]
    : serviceDates.length > 1
      ? (isArabic ? "تواريخ متعددة" : "Multiple dates")
      : null;
  const showServiceDateSummary = Boolean(serviceDateSummary) && (
    payload.claim.category !== "inpatient_surgery" ||
    (!payload.clinical.admissionDate && !payload.clinical.dischargeDate)
  );
  const combinedTotal = payload.invoices.every((invoice) => invoice.billedAmount !== null) && invoiceCurrencies.length <= 1
    ? payload.invoices.reduce((sum, invoice) => sum + (invoice.billedAmount ?? 0), 0)
    : null;
  const [showJson, setShowJson] = useState(false);
  const [openAttachmentId, setOpenAttachmentId] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const technicalPayload = useMemo(() => compactTechnicalPayload(payload), [payload]);
  const sbsItems = payload.items.filter((item) => Boolean(item.sbsCode));
  const editedFields = new Set<MemberEditedField>(payload.memberEdits?.fields ?? []);
  const invoiceEdited = ["invoiceReference", "invoiceDate", "serviceDate", "currency", "subtotal", "taxAmount", "discountAmount", "billedAmount", "paymentStatus", "paymentMethod", "cardNetwork", "opticalFrameAmount", "opticalLensAmount"].some((field) => editedFields.has(field as MemberEditedField));

  useEffect(() => {
    setShowJson(false);
    setOpenAttachmentId(null);
    setCopied(false);
  }, [submission.claimId]);

  async function copyJson() {
    await navigator.clipboard.writeText(JSON.stringify(technicalPayload, null, 2));
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  }

  return (
    <article className="min-w-0 space-y-5">
      {payload.memberEdits && <div className="flex items-center gap-2 rounded-xl border border-[#dce6f0] bg-[#f7fafd] px-4 py-3 text-xs text-[#687a96]"><OpsEditBadge /><span>{memberEditSummary(payload.memberEdits.fields.length, isArabic)}</span></div>}
      {payload.provenance?.some((item) => item.editedByMember) && (
        <OpsValueComparison provenance={payload.provenance} isArabic={isArabic} />
      )}
      <section className="overflow-hidden rounded-[24px] border border-[#dce6f0] bg-white shadow-[0_12px_35px_rgba(38,79,89,0.06)]">
        <div className="flex flex-col gap-4 border-b border-[#e8edf5] bg-[#f7fafd] p-5 sm:flex-row sm:items-start sm:justify-between sm:p-6">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded-full bg-[#e6f6f0] px-2.5 py-1 text-[11px] font-extrabold uppercase tracking-wide text-[#28745f]">{isArabic ? "مقبولة للمعالجة" : "Accepted for processing"}</span>
              <span className="text-xs font-bold text-[#687a96]">{submission.acceptanceReference}</span>
            </div>
            <h2 className="mt-3 text-xl font-semibold tracking-[-0.015em] text-[#0b1e3d]">{submission.claimId}</h2>
            <p className="mt-1 text-sm text-[#687a96]">{isArabic ? "أُرسلت في" : "Submitted"} {formatDateTime(submission.submittedAt, language)}</p>
          </div>
          <div className="rounded-xl border border-[#dce6f0] bg-white px-4 py-3 text-end">
            <p className="text-[10px] font-extrabold uppercase tracking-wide text-[#8a9bbb]">{isArabic ? "مرجع العضو" : "Member reference"}</p>
            <p className="mt-1 text-sm font-black tracking-wide text-[#0b1e3d]">{payload.claim.member.referenceId}</p>
          </div>
        </div>

        <div className="grid gap-4 p-5 sm:grid-cols-2 sm:p-6 xl:grid-cols-4">
          <DataPoint label={isArabic ? "الفئة" : "Category"} value={formatCategory(payload.claim.category, payload.claim.opticalItem, language)} />
          <DataPoint label={isArabic ? "الموقع" : "Location"} value={formatLocation(payload.claim.location, language)} />
          <DataPoint label={isArabic ? "مقدم الخدمة" : "Provider"} value={payload.provider.name} edited={editedFields.has("providerName")} />
          <DataPoint label={isArabic ? "موقع مقدم الخدمة" : "Provider location"} value={payload.provider.location} edited={editedFields.has("providerLocation")} />
          <DataPoint label={isArabic ? "المريض" : "Patient"} value={payload.patient.name} edited={editedFields.has("patientName")} />
          <DataPoint label={isArabic ? "الفواتير" : "Invoices"} value={payload.invoices.length === 1 ? (primaryInvoice?.reference ?? (isArabic ? "فاتورة واحدة بدون رقم مرجعي مطبوع" : "1 invoice without a printed reference")) : `${payload.invoices.length} ${isArabic ? "فواتير" : "invoices"}`} edited={editedFields.has("invoiceReference")} />
          <DataPoint label={isArabic ? "تاريخ الفاتورة" : "Invoice date"} value={payload.invoices.length === 1 ? primaryInvoice?.invoiceDate ?? null : (isArabic ? "تواريخ متعددة" : "Multiple dates")} edited={editedFields.has("invoiceDate")} />
          {payload.claim.category === "inpatient_surgery" && payload.clinical.admissionDate && <DataPoint label={isArabic ? "تاريخ الدخول" : "Admission date"} value={payload.clinical.admissionDate} edited={editedFields.has("admissionDate")} />}
          {payload.claim.category === "inpatient_surgery" && payload.clinical.dischargeDate && <DataPoint label={isArabic ? "تاريخ الخروج" : "Discharge date"} value={payload.clinical.dischargeDate} edited={editedFields.has("dischargeDate")} />}
          {showServiceDateSummary && <DataPoint label={isArabic ? "تاريخ الخدمة" : "Service date"} value={serviceDateSummary} edited={editedFields.has("serviceDate")} />}
          <DataPoint label={isArabic ? "إثبات الدفع" : "Payment evidence"} value={`${payload.paymentEvidence.length} ${isArabic ? "مستند" : payload.paymentEvidence.length === 1 ? "document" : "documents"}`} />
          <DataPoint label={isArabic ? "الإجمالي النهائي" : "Final total"} value={combinedTotal === null ? (isArabic ? "راجع الفواتير" : "See invoices") : formatMoney(combinedTotal, invoiceCurrencies[0] ?? primaryInvoice?.currency ?? null, language)} strong edited={editedFields.has("billedAmount")} />
        </div>
      </section>

      <section className="overflow-hidden rounded-[24px] border border-[#dce6f0] bg-white">
        <SectionHeading title={isArabic ? "الفواتير وإثباتات الدفع" : "Invoices and payment evidence"} description={isArabic ? "السجلات المالية محفوظة منفصلة مع مصدر كل مستند" : "Financial records kept separate with their exact document sources"} />
        <div className="grid gap-4 p-5 sm:p-6 xl:grid-cols-2">
          {payload.invoices.map((invoice, index) => (
            <div key={`${invoice.sourceAttachmentRef}-${index}`} className="rounded-2xl border border-[#dce6f0] bg-[#f7fafd] p-4">
              <div className="flex items-start justify-between gap-3">
                <div><div className="flex flex-wrap items-center gap-2"><p className="text-xs font-extrabold text-[#687a96]">{isArabic ? "فاتورة" : "Invoice"} {index + 1}</p>{index === 0 && invoiceEdited && <OpsEditBadge />}</div><p className="mt-1 text-sm font-extrabold text-[#0b1e3d]">{invoice.reference ?? (isArabic ? "بدون رقم مرجعي" : "No printed reference")}</p></div>
                <p className="text-sm font-black text-[#005eb8]">{formatMoney(invoice.billedAmount, invoice.currency, language)}</p>
              </div>
              <div className="mt-3 grid grid-cols-2 gap-2 text-xs text-[#687a96]"><span>{isArabic ? "تاريخ الفاتورة" : "Invoice date"}: {invoice.invoiceDate ?? "—"}</span><span>{paymentLabel(invoice.paymentStatus, isArabic)}</span>{invoice.serviceDate && <span className="col-span-2">{isArabic ? "تاريخ الخدمة" : "Service date"}: {invoice.serviceDate}</span>}{invoice.paymentMethod !== "unknown" && <span className="col-span-2">{isArabic ? "الدفع" : "Payment"}: {paymentMethodLabel(invoice.paymentMethod, isArabic)}{invoice.cardNetwork ? ` · ${cardNetworkLabel(invoice.cardNetwork, isArabic)}` : ""}</span>}<span className="col-span-2 truncate">{isArabic ? "المصدر" : "Source"}: {attachmentName(payload, invoice.sourceAttachmentRef)}</span></div>
            </div>
          ))}
          {payload.paymentEvidence.map((evidence, index) => (
            <div key={`${evidence.sourceAttachmentRef}-${index}`} className="rounded-2xl border border-[#cfe5df] bg-[#f5fbf9] p-4">
              <div className="flex items-start justify-between gap-3"><div><div className="flex flex-wrap items-center gap-2"><p className="text-xs font-extrabold text-[#5d8077]">{isArabic ? "إثبات دفع" : "Payment evidence"} {index + 1}</p>{evidence.evidenceType === "paid_invoice" && invoiceEdited && <OpsEditBadge />}</div><p className="mt-1 text-sm font-extrabold text-[#0b1e3d]">{evidence.evidenceType === "paid_invoice" ? (isArabic ? "فاتورة موضح بها الدفع" : "Paid itemized invoice") : (isArabic ? "إيصال دفع" : "Payment receipt")}</p></div><p className="text-sm font-black text-[#28745f]">{formatMoney(evidence.amount, evidence.currency, language)}</p></div>
              {evidence.paymentMethod !== "unknown" && <p className="mt-3 text-xs text-[#687a96]">{isArabic ? "الدفع" : "Payment"}: {paymentMethodLabel(evidence.paymentMethod, isArabic)}{evidence.cardNetwork ? ` · ${cardNetworkLabel(evidence.cardNetwork, isArabic)}` : ""}</p>}<p className="mt-3 truncate text-xs text-[#687a96]">{isArabic ? "المصدر" : "Source"}: {attachmentName(payload, evidence.sourceAttachmentRef)}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="overflow-hidden rounded-[24px] border border-[#cdd9e8] bg-white">
        <SectionHeading title={isArabic ? "أدوات المطور للقراءة فقط" : "Read-only Dev Tools"} description={isArabic ? "لقطات تقنية مؤمنة للمراجعة الداخلية؛ لا توجد إجراءات تعديل أو قرار." : "Secured internal snapshots with no mutation or adjudication actions"} />
        <div className="space-y-3 p-5 sm:p-6">
          <DevData title={isArabic ? "JSON النهائي المنظم" : "Final structured JSON"} value={payload} />
          <DevData title={isArabic ? "الاستخراج الخام لكل مستند" : "Raw document extractions"} value={payload.rawDocumentExtractions ?? []} />
          <DevData title={isArabic ? "البيانات النهائية المدمجة" : "Final merged claim data"} value={{ patient: payload.patient, provider: payload.provider, invoices: payload.invoices, paymentEvidence: payload.paymentEvidence, items: payload.items, clinical: payload.clinical }} />
          <DevData title={isArabic ? "لقطة التحقق والتنبيهات" : "Validation snapshot and warnings"} value={{ validation: payload.validationSnapshot ?? null, unresolvedWarnings: payload.unresolvedWarnings ?? [] }} />
          <DevData title={isArabic ? "مصدر القيم وتعديلات العضو" : "Field provenance and member edits"} value={payload.provenance ?? []} />
          <DevData title={isArabic ? "عدم اليقين الداخلي" : "Internal extraction uncertainty"} value={payload.internalUncertainty ?? []} />
        </div>
      </section>

      <OpsEvidenceUnitPipeline payload={payload} isArabic={isArabic} />

      <section className="overflow-hidden rounded-[24px] border border-[#dce6f0] bg-white">
        <SectionHeading title={isArabic ? "بنود الخدمة المستخرجة" : "Extracted service lines"} description={isArabic ? `${payload.items.length} ${payload.items.length === 1 ? "بند مُعد" : "بنود مُعدة"} للمعالجة الداخلية` : `${payload.items.length} ${payload.items.length === 1 ? "item" : "items"} prepared for downstream processing`} edited={editedFields.has("serviceLines")} />
        {payload.items.length === 0 ? (
          <p className="p-6 text-sm text-[#687a96]">{isArabic ? "لم يتم تضمين أي بنود خدمة." : "No service lines were included."}</p>
        ) : (
          <>
          <div className="grid gap-3 p-4 md:hidden">
            {payload.items.map((item, index) => (
              <article key={`${item.description}-${index}`} className="rounded-2xl border border-[#dce6f0] bg-[#fbfdfd] p-4">
                <div className="flex items-start justify-between gap-3"><div className="min-w-0"><p className="font-bold text-[#294d56]">{item.description ?? `${isArabic ? "البند" : "Item"} ${index + 1}`}</p><p className="mt-1 text-xs text-[#8a9da2]">{[item.sbsCode ? `SBS ${item.sbsCode}` : null, item.diagnosisCode, item.procedureCode, item.toothNumber ? `${isArabic ? "السن" : "Tooth"} ${item.toothNumber}` : null].filter(Boolean).join(" · ") || (isArabic ? "لا توجد رموز مطبوعة" : "No printed codes")}</p></div><p className="shrink-0 text-sm font-extrabold text-[#0b1e3d]">{formatMoney(item.billedAmount, item.currency, language)}</p></div>
                <dl className="mt-3 grid grid-cols-3 gap-2 border-t border-[#e7eff0] pt-3 text-xs"><div><dt className="text-[#82979c]">{isArabic ? "التاريخ" : "Date"}</dt><dd className="mt-1 font-semibold text-[#425979]">{item.serviceDate ?? "—"}</dd></div><div><dt className="text-[#82979c]">{isArabic ? "الكمية" : "Qty"}</dt><dd className="mt-1 font-semibold text-[#425979]">{item.quantity ?? "—"}</dd></div><div><dt className="text-[#82979c]">{isArabic ? "الوحدة" : "Unit"}</dt><dd className="mt-1 font-semibold text-[#425979]">{formatMoney(item.unitPrice, item.currency, language)}</dd></div></dl>
              </article>
            ))}
          </div>
          <div className="hidden overflow-x-auto md:block">
            <table className="w-full min-w-[720px] border-collapse text-start text-sm">
              <thead className="bg-[#f7fafd] text-xs uppercase tracking-wide text-[#758d93]">
                <tr><th className="px-5 py-3 text-start">{isArabic ? "الخدمة" : "Service"}</th><th className="px-4 py-3 text-start">{isArabic ? "التاريخ" : "Date"}</th><th className="px-4 py-3 text-end">{isArabic ? "الكمية" : "Qty"}</th><th className="px-4 py-3 text-end">{isArabic ? "الوحدة" : "Unit"}</th><th className="px-5 py-3 text-end">{isArabic ? "المبلغ" : "Amount"}</th></tr>
              </thead>
              <tbody className="divide-y divide-[#e8eff0]">
                {payload.items.map((item, index) => (
                  <tr key={`${item.description}-${index}`}>
                    <td className="px-5 py-4"><p className="font-bold text-[#294d56]">{item.description ?? `${isArabic ? "البند" : "Item"} ${index + 1}`}</p><p className="mt-1 text-xs text-[#8a9da2]">{[item.sbsCode ? `SBS ${item.sbsCode}` : null, item.diagnosisCode, item.procedureCode, item.toothNumber ? `${isArabic ? "السن" : "Tooth"} ${item.toothNumber}` : null].filter(Boolean).join(" · ") || (isArabic ? "لا توجد رموز مطبوعة" : "No printed codes")}</p></td>
                    <td className="px-4 py-4 text-[#607b82]">{item.serviceDate ?? "—"}</td>
                    <td className="px-4 py-4 text-end text-[#607b82]">{item.quantity ?? "—"}</td>
                    <td className="px-4 py-4 text-end text-[#607b82]">{formatMoney(item.unitPrice, item.currency, language)}</td>
                    <td className="px-5 py-4 text-end font-extrabold text-[#0b1e3d]">{formatMoney(item.billedAmount, item.currency, language)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          </>
        )}
      </section>

      {sbsItems.length > 0 && (
        <section className="overflow-hidden rounded-[24px] border border-[#dce6f0] bg-white">
          <SectionHeading title={isArabic ? "رموز SBS المطبوعة" : "Printed SBS codes"} description={isArabic ? "أدلة داخلية للقراءة فقط؛ لم يتم التحقق منها مقابل كتالوج SBS." : "Read-only internal evidence; no SBS catalogue validation was performed."} />
          <div className="grid gap-3 p-5 sm:grid-cols-2 sm:p-6">
            {sbsItems.map((item, index) => (
              <div key={`${item.sbsCode}-${index}`} className="rounded-2xl border border-[#dce6f0] bg-[#fbfdfd] p-4">
                <p className="text-xs font-extrabold text-[#176879]">SBS {item.sbsCode}</p>
                <p className="mt-1 text-sm font-bold text-[#294d56]">{item.sbsDescription ?? item.description ?? "—"}</p>
                <p className="mt-2 text-xs text-[#687a96]">{isArabic ? "المصدر" : "Source"}: {item.sourceAttachmentRefs.map((id) => attachmentName(payload, id)).join(", ")}</p>
              </div>
            ))}
          </div>
        </section>
      )}

      {(payload.clinical.diagnoses.length > 0 || payload.clinical.procedures.length > 0 || payload.clinical.admissionDate || payload.clinical.dischargeDate) && (
        <section className="overflow-hidden rounded-[24px] border border-[#dce6f0] bg-white">
          <SectionHeading title={isArabic ? "المعلومات الطبية المستخرجة" : "Extracted clinical information"} description={isArabic ? "معلومات مطبوعة في المستندات، وليست تشخيصاً أو ترميزاً أنشأه النظام" : "Information printed in the documents, not diagnosis or coding created by the system"} />
          <div className="space-y-5 p-5 sm:p-6">
            {(payload.clinical.admissionDate || payload.clinical.dischargeDate) && <div className="grid gap-3 sm:grid-cols-2"><DataPoint label={isArabic ? "تاريخ الدخول" : "Admission date"} value={payload.clinical.admissionDate} edited={editedFields.has("admissionDate")} /><DataPoint label={isArabic ? "تاريخ الخروج" : "Discharge date"} value={payload.clinical.dischargeDate} edited={editedFields.has("dischargeDate")} /></div>}
            <ClinicalEvidenceList title={isArabic ? "التشخيصات والرموز المطبوعة" : "Diagnoses and printed codes"} items={payload.clinical.diagnoses} payload={payload} isArabic={isArabic} />
            <ClinicalEvidenceList title={isArabic ? "الإجراءات والرموز المطبوعة" : "Procedures and printed codes"} items={payload.clinical.procedures} payload={payload} isArabic={isArabic} />
          </div>
        </section>
      )}

      <section className="overflow-hidden rounded-[24px] border border-[#dce6f0] bg-white">
        <SectionHeading title={isArabic ? "المرفقات المصدرية" : "Source attachments"} description={isArabic ? "تم الاحتفاظ بالأدلة التجريبية الأصلية مع الإرسال" : "Original synthetic evidence retained with the submission"} />
        <ul className="divide-y divide-[#e8eff0]">
          {payload.attachments.map((attachment) => {
            const open = openAttachmentId === attachment.referenceId;
            const url = apiUrl(`/ops/claims/${submission.claimId}/attachments/${attachment.referenceId}/download`);
            return (
              <li key={attachment.referenceId}>
                <button type="button" onClick={() => setOpenAttachmentId(open ? null : attachment.referenceId)} className="flex w-full items-center justify-between gap-4 px-5 py-4 text-start transition hover:bg-[#f7fafd]">
                  <div className="min-w-0"><p className="truncate text-sm font-extrabold text-[#294d56]">{attachment.filename}</p><p className="mt-1 text-xs text-[#82979c]">{documentRoleLabel(attachment.documentType, isArabic)} · {attachment.referenceId}</p></div>
                  <ChevronIcon open={open} />
                </button>
                {open && (
                  <div className="border-t border-[#e5edef] bg-[#f4f8f9] p-4">
                    <div className="mb-3 flex justify-end"><a href={url} target="_blank" rel="noreferrer" className="text-xs font-extrabold text-[#087d88] hover:underline">{isArabic ? "فتح بالحجم الكامل" : "Open full size"}</a></div>
                    {isImage(attachment.filename) ? <img src={url} alt={`${isArabic ? "المستند المصدر" : "Source document"} ${attachment.filename}`} className="mx-auto max-h-[65dvh] rounded-xl border border-[#dce6f0] bg-white object-contain sm:max-h-[650px]" /> : <iframe src={url} title={`${isArabic ? "المستند المصدر" : "Source document"} ${attachment.filename}`} className="h-[55dvh] min-h-[300px] w-full rounded-xl border border-[#dce6f0] bg-white sm:h-[650px]" />}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      </section>

      <section className="overflow-hidden rounded-[24px] border border-[#dce6f0] bg-white">
        <div className="flex flex-col gap-3 p-5 sm:flex-row sm:items-center sm:justify-between sm:p-6">
          <div><h3 className="font-semibold text-[#0b1e3d]">{isArabic ? "بيانات التكامل المنظمة" : "Structured integration data"}</h3><p className="mt-1 text-sm text-[#687a96]">{isArabic ? "ملخص تقني جاهز للتسليم، دون قيم فارغة أو بيانات مكررة." : "A processing-ready technical payload without empty or duplicated data."}</p></div>
          <div className="flex gap-2"><button type="button" onClick={() => void copyJson()} className="rounded-xl border border-[#c4d6ec] bg-white px-3 py-2 text-xs font-bold text-[#005eb8] hover:bg-[#f7fafd]">{copied ? (isArabic ? "تم النسخ" : "Copied") : (isArabic ? "نسخ JSON" : "Copy JSON")}</button><button type="button" aria-expanded={showJson} onClick={() => setShowJson((current) => !current)} className="rounded-xl bg-[#005eb8] px-3 py-2 text-xs font-bold text-white hover:bg-[#004f9f]">{showJson ? (isArabic ? "إخفاء JSON التقني" : "Hide technical JSON") : (isArabic ? "عرض JSON التقني" : "View technical JSON")}</button></div>
        </div>
        {showJson && <pre className="max-h-[720px] overflow-auto border-t border-[#0b1e3d] bg-[#0b1e3d] p-5 text-xs leading-6 text-[#eef6fd] sm:p-6">{JSON.stringify(technicalPayload, null, 2)}</pre>}
      </section>
    </article>
  );
}

function DevData({ title, value }: { title: string; value: unknown }) {
  return <details className="ops-dev-data overflow-hidden rounded-xl border border-white/10 bg-white/[0.035]"><summary className="cursor-pointer px-4 py-3 text-sm font-bold text-[#e8f2fb] transition hover:bg-white/[0.045] focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#69b9f1]">{title}</summary><pre className="max-h-[520px] overflow-auto border-t border-white/10 bg-[#07172f] p-4 text-xs leading-6 text-[#dcecff]">{JSON.stringify(value, null, 2)}</pre></details>;
}

function OpsValueComparison({ provenance, isArabic }: { provenance: ClaimFieldProvenance[]; isArabic: boolean }) {
  const edited = provenance.filter((item) => item.editedByMember);
  return (
    <section className="ops-value-comparison overflow-hidden rounded-[24px] border border-[#294d6d] bg-[#0d223d] text-white shadow-[0_18px_48px_rgba(2,14,31,0.22)]">
      <div className="border-b border-white/10 px-5 py-4 sm:px-6">
        <p className="text-[10px] font-black uppercase tracking-[0.14em] text-[#7bc4f4]">{isArabic ? "مصدر القيمة" : "Value provenance"}</p>
        <h3 className="mt-1 text-base font-extrabold">{isArabic ? "القيم الأصلية والتعديلات الفعالة" : "Original and effective member-corrected values"}</h3>
      </div>
      <div className="grid gap-3 p-4 sm:p-5 xl:grid-cols-2">
        {edited.map((item) => (
          <article key={item.field} className="rounded-2xl border border-white/10 bg-white/[0.045] p-4">
            <div className="flex items-center justify-between gap-3">
              <p className="text-xs font-extrabold text-[#a9c6df]">{humanizeField(item.field)}</p>
              <OpsEditBadge />
            </div>
            <dl className="mt-3 grid gap-2 sm:grid-cols-3">
              <ValueStage label={isArabic ? "قيمة المستند / الذكاء الاصطناعي" : "Document / AI value"} value={formatProvenanceValue(item.sourceValue)} />
              <ValueStage label={isArabic ? "تصحيح العضو" : "Member correction"} value={formatProvenanceValue(item.memberValue)} accent />
              <ValueStage label={isArabic ? "القيمة الفعالة" : "Effective value"} value={formatProvenanceValue(item.effectiveValue)} strong />
            </dl>
          </article>
        ))}
      </div>
    </section>
  );
}

function ValueStage({ label, value, accent = false, strong = false }: { label: string; value: string; accent?: boolean; strong?: boolean }) {
  return <div className={`rounded-xl border px-3 py-3 ${strong ? "border-[#57bda0]/40 bg-[#57bda0]/10" : accent ? "border-[#65ace0]/35 bg-[#65ace0]/10" : "border-white/10 bg-black/10"}`}><dt className="text-[9px] font-bold uppercase leading-4 tracking-wide text-[#8ca9c2]">{label}</dt><dd className={`mt-1.5 break-words text-xs ${strong ? "font-extrabold text-[#8de0c7]" : "font-semibold text-white"}`}>{value}</dd></div>;
}

function formatProvenanceValue(value: unknown) {
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return String(value);
  return JSON.stringify(value);
}

function humanizeField(value: string) {
  return value.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/^./, (character) => character.toUpperCase());
}

function SectionHeading({ title, description, edited = false }: { title: string; description: string; edited?: boolean }) {
  return <div className="border-b border-[#e8edf5] bg-[#f7fafd] px-5 py-4"><div className="flex flex-wrap items-center gap-2"><h3 className="text-[15px] font-semibold text-[#0b1e3d]">{title}</h3>{edited && <OpsEditBadge />}</div><p className="mt-1 text-xs text-[#8a9bbb]">{description}</p></div>;
}

function ClinicalEvidenceList({ title, items, payload, isArabic }: {
  title: string;
  items: Array<{
    description: string | null;
    code: string | null;
    codingSystem: string | null;
    sourceAttachmentRefs: string[];
  }>;
  payload: SubmissionPayload;
  isArabic: boolean;
}) {
  if (items.length === 0) return null;
  return <div><h4 className="mb-3 text-sm font-extrabold text-[#425979]">{title}</h4><div className="grid gap-3 lg:grid-cols-2">{items.map((item, index) => <div key={`${item.code}-${item.description}-${index}`} className="rounded-2xl border border-[#dce6f0] bg-[#fbfdfd] p-4"><div className="flex flex-wrap items-start justify-between gap-2"><p className="text-sm font-extrabold text-[#0b1e3d]">{item.description ?? (isArabic ? "وصف غير مطبوع" : "No printed description")}</p>{item.code && <span className="rounded-lg bg-[#e8f5f5] px-2.5 py-1 font-mono text-xs font-bold text-[#176879]" dir="ltr">{item.codingSystem ? `${item.codingSystem} · ` : ""}{item.code}</span>}</div><p className="mt-3 truncate text-xs text-[#82979c]">{isArabic ? "المصدر" : "Source"}: {item.sourceAttachmentRefs.map((ref) => attachmentName(payload, ref)).join(", ")}</p></div>)}</div></div>;
}

function DataPoint({ label, value, strong = false, edited = false }: { label: string; value: string | null; strong?: boolean; edited?: boolean }) {
  return <div className="ops-data-point rounded-xl border border-[#e0eaec] bg-[#fbfdfd] px-4 py-3"><div className="flex flex-wrap items-center gap-1.5"><p className="text-[10px] font-semibold uppercase tracking-wide text-[#82979c]">{label}</p>{edited && <OpsEditBadge />}</div><p className={`mt-1.5 break-words ${strong ? "text-base font-semibold text-[#176879]" : "text-sm font-medium text-[#425979]"}`}>{value || "—"}</p></div>;
}

function OpsEditBadge() { const { isArabic } = useLanguage(); return <span className="inline-flex rounded-full bg-[#f0f4fa] px-1.5 py-0.5 text-[9px] font-semibold text-[#687a96]">{isArabic ? "عدّله العضو" : "Member updated"}</span>; }
function memberEditSummary(count: number, isArabic: boolean) { if (!isArabic) return `The member updated ${count} ${count === 1 ? "field" : "fields"} during review.`; if (count === 1) return "عدّل العضو حقلاً واحداً أثناء المراجعة."; if (count === 2) return "عدّل العضو حقلين أثناء المراجعة."; return `عدّل العضو ${count} حقول أثناء المراجعة.`; }

function PageMessage({ title, description, action, onAction }: { title: string; description: string; action?: string; onAction?: () => void }) {
  return <section className="mt-8 grid min-h-[360px] place-items-center rounded-[24px] border border-[#dce6f0] bg-white px-6 py-12 text-center"><div className="max-w-md"><span className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-[#e8f5f5] text-[#005eb8]"><DocumentIcon /></span><h2 className="mt-5 text-xl font-extrabold text-[#0b1e3d]">{title}</h2><p className="mt-2 text-sm leading-6 text-[#687a96]">{description}</p>{action && onAction && <button type="button" onClick={onAction} className="mt-5 rounded-xl bg-[#005eb8] px-4 py-2.5 text-sm font-extrabold text-white hover:bg-[#004f9f]">{action}</button>}</div></section>;
}

function formatDateTime(value: string, language: "en" | "ar" = "en") { return new Intl.DateTimeFormat(language === "ar" ? "ar-SA" : "en-US", { day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(value)); }
function formatMoney(value: number | null, currency: string | null, language: "en" | "ar" = "en") { return value === null ? "—" : `${currency ?? ""} ${value.toLocaleString(language === "ar" ? "ar-SA" : "en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`.trim(); }
function capitalize(value: string) { return value.charAt(0).toUpperCase() + value.slice(1); }
function paymentLabel(value: string, isArabic: boolean) { if (!isArabic) return capitalize(value); return ({ paid: "مدفوعة", unpaid: "غير مدفوعة", unclear: "غير واضحة" } as Record<string, string>)[value] ?? value; }
function paymentMethodLabel(value: string, isArabic: boolean) { if (isArabic) return ({ cash: "نقداً", card: "بطاقة", bank_transfer: "تحويل بنكي", digital_wallet: "محفظة رقمية", cheque: "شيك", other: "أخرى", unknown: "غير ظاهرة" } as Record<string, string>)[value] ?? value; return ({ cash: "Cash", card: "Card", bank_transfer: "Bank transfer", digital_wallet: "Digital wallet", cheque: "Cheque", other: "Other", unknown: "Not shown" } as Record<string, string>)[value] ?? capitalize(value); }
function cardNetworkLabel(value: string, isArabic: boolean) { if (isArabic) return ({ mada: "مدى", visa: "فيزا", mastercard: "ماستركارد", amex: "أمريكان إكسبريس", other: "أخرى" } as Record<string, string>)[value] ?? value; return ({ mada: "Mada", visa: "Visa", mastercard: "Mastercard", amex: "American Express", other: "Other" } as Record<string, string>)[value] ?? capitalize(value); }
function attachmentName(payload: SubmissionPayload, referenceId: string) { return payload.attachments.find((attachment) => attachment.referenceId === referenceId)?.filename ?? referenceId; }
function isImage(filename: string) { return /\.(png|jpe?g)$/i.test(filename); }

function compactTechnicalPayload(payload: SubmissionPayload) {
  const {
    items: _duplicateServiceLines,
    sources: _duplicateSources,
    rawDocumentExtractions: _rawDocumentExtractions,
    internalUncertainty: _internalUncertainty,
    provenance: _provenance,
    validationSnapshot: _validationSnapshot,
    ...payloadWithoutDuplicates
  } = payload;
  return removeEmptyValues(payloadWithoutDuplicates);
}

function removeEmptyValues(value: unknown): unknown {
  if (Array.isArray(value)) {
    const items = value.map(removeEmptyValues).filter((item) => item !== undefined);
    return items.length > 0 ? items : undefined;
  }
  if (value && typeof value === "object") {
    const entries = Object.entries(value)
      .map(([key, item]) => [key, removeEmptyValues(item)] as const)
      .filter(([, item]) => item !== undefined);
    return entries.length > 0 ? Object.fromEntries(entries) : undefined;
  }
  return value === null || value === "" ? undefined : value;
}

function BackIcon() { return <svg viewBox="0 0 24 24" className="directional-back-icon h-5 w-5" aria-hidden="true"><path d="m14.5 6-6 6 6 6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>; }
function DocumentIcon() { return <svg viewBox="0 0 24 24" className="h-7 w-7" aria-hidden="true"><path d="M6 3.5h8l4 4V20H6V3.5Zm8 0V8h4M9 12h6m-6 3.5h6" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" /></svg>; }
function ChevronIcon({ open }: { open: boolean }) { return <svg viewBox="0 0 24 24" className={`h-5 w-5 shrink-0 text-[#6f8b91] transition ${open ? "rotate-180" : ""}`} aria-hidden="true"><path d="m7 10 5 5 5-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>; }
