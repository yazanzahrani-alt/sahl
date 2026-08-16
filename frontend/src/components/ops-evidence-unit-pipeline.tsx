import type {
  DocumentAnalysis,
  DocumentEvidenceUnit,
  SubmissionPayload
} from "../types";
import { evidenceSourceLabel } from "../lib/evidence-source-label";

type DisplayUnit = Pick<
  DocumentEvidenceUnit,
  | "evidenceUnitId"
  | "documentType"
  | "pageStart"
  | "pageEnd"
  | "readability"
  | "relevance"
  | "detectedCategories"
  | "summary"
  | "extracted"
  | "missingOrUnclear"
> & { legacy: boolean };

export function OpsEvidenceUnitPipeline({
  payload,
  isArabic
}: {
  payload: SubmissionPayload;
  isArabic: boolean;
}) {
  return (
    <section
      data-testid="ops-evidence-unit-pipeline"
      className="ops-evidence-pipeline overflow-hidden rounded-[24px] border border-[#dce6f0] bg-white"
    >
      <div className="border-b border-[#e8edf5] bg-[#f7fafd] px-5 py-4">
        <h3 className="text-[15px] font-semibold text-[#0b1e3d]">
          {isArabic ? "مسار الأدلة المستخرجة" : "Evidence-unit processing pipeline"}
        </h3>
        <p className="mt-1 text-xs text-[#8a9bbb]">
          {isArabic
            ? "يوضح كيف تحولت المرفقات إلى وحدات أدلة مستقلة ثم إلى مطالبة جاهزة للمعالجة."
            : "Shows how uploaded attachments became independent evidence units and a processing-ready claim."}
        </p>
        <ol className="mt-3 flex flex-wrap items-center gap-1.5 text-[10px] font-extrabold uppercase tracking-wide text-[#58767c]">
          {[
            isArabic ? "المرفق" : "Attachment",
            isArabic ? "وحدات الأدلة" : "Evidence units",
            isArabic ? "المطالبة المجمعة" : "Consolidated claim",
            isArabic ? "التحقق" : "Validation",
            isArabic ? "جاهزة للتسليم" : "Submission ready"
          ].map((label, index) => (
            <li key={label} className="flex items-center gap-1.5">
              {index > 0 && <span aria-hidden="true">→</span>}
              <span className="rounded-lg border border-[#dce6f0] bg-white px-2 py-1">{label}</span>
            </li>
          ))}
        </ol>
      </div>

      <div className="space-y-4 p-5 sm:p-6">
        {payload.rawDocumentExtractions.map((raw) => {
          const units = displayUnits(raw.analysis);
          const consolidatedFields = payload.provenance
            .filter((item) => item.sourceAttachmentRefs.includes(raw.attachmentReference))
            .map((item) => item.field);
          return (
            <article
              key={raw.attachmentReference}
              data-attachment-reference={raw.attachmentReference}
              className="rounded-2xl border border-[#dce6f0] bg-[#fbfdfd] p-4"
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-extrabold text-[#0b1e3d]">{raw.filename}</p>
                  <p className="mt-1 text-xs text-[#82979c]">
                    {units.length} {isArabic ? "وحدة دليل في مرفق واحد" : units.length === 1 ? "evidence unit in one attachment" : "evidence units in one attachment"}
                  </p>
                </div>
                {consolidatedFields.length > 0 && (
                  <p className="max-w-xl text-xs text-[#687a96]">
                    <span className="font-extrabold">
                      {isArabic ? "حقول مجمعة من هذا المرفق:" : "Consolidated fields from this attachment:"}
                    </span>{" "}
                    {[...new Set(consolidatedFields)].join(", ")}
                  </p>
                )}
              </div>

              <div className="mt-4 grid gap-3 xl:grid-cols-3">
                {units.map((unit) => (
                  <EvidenceUnitCard
                    key={unit.evidenceUnitId ?? `${unit.documentType}-${unit.pageStart ?? "legacy"}`}
                    unit={unit}
                    isArabic={isArabic}
                  />
                ))}
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}

function EvidenceUnitCard({ unit, isArabic }: { unit: DisplayUnit; isArabic: boolean }) {
  const fields = meaningfulFields(unit.extracted, isArabic);
  return (
    <section
      data-evidence-role={unit.documentType}
      className="rounded-xl border border-[#cfe0e3] bg-white p-4"
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h4 className="text-sm font-extrabold text-[#176879]">
            {evidenceSourceLabel(unit, isArabic)}
          </h4>
          <p className="mt-1 text-[11px] text-[#82979c]">
            {unit.readability} · {unit.relevance}
          </p>
        </div>
        {!unit.legacy && (
          <code className="max-w-full break-all rounded bg-[#f0f4fa] px-2 py-1 text-[9px] text-[#687a96]">
            {unit.evidenceUnitId}
          </code>
        )}
      </div>
      <p className="mt-3 text-xs leading-5 text-[#425979]">{unit.summary}</p>
      {unit.detectedCategories.length > 0 && (
        <p className="mt-2 text-[11px] text-[#687a96]">
          <span className="font-extrabold">{isArabic ? "إشارات الفئة:" : "Category signals:"}</span>{" "}
          {unit.detectedCategories.join(", ")}
        </p>
      )}
      {fields.length > 0 && (
        <dl className="mt-3 space-y-1 border-t border-[#edf2f5] pt-3 text-[11px]">
          {fields.map(([label, value]) => (
            <div key={label} className="flex justify-between gap-3">
              <dt className="text-[#82979c]">{label}</dt>
              <dd className="text-end font-bold text-[#425979]">{value}</dd>
            </div>
          ))}
        </dl>
      )}
      {unit.missingOrUnclear.length > 0 && (
        <details className="mt-3 text-[11px] text-[#8a6118]">
          <summary className="cursor-pointer font-extrabold">
            {isArabic ? "غير موجود أو غير واضح" : "Missing or unclear"}
          </summary>
          <ul className="mt-2 list-disc space-y-1 ps-4">
            {unit.missingOrUnclear.map((item) => <li key={item}>{item}</li>)}
          </ul>
        </details>
      )}
    </section>
  );
}

function displayUnits(analysis: DocumentAnalysis): DisplayUnit[] {
  if (analysis.evidenceUnits?.length) {
    return analysis.evidenceUnits.map((unit) => ({ ...unit, legacy: false }));
  }
  return [{
    evidenceUnitId: `${analysis.attachmentId}:legacy-display`,
    documentType: analysis.documentType,
    pageStart: null,
    pageEnd: null,
    readability: analysis.readability,
    relevance: analysis.relevance,
    detectedCategories: analysis.detectedCategories,
    summary: analysis.summary,
    extracted: analysis.extracted,
    missingOrUnclear: analysis.missingOrUnclear,
    legacy: true
  }];
}

function meaningfulFields(
  fields: DocumentAnalysis["extracted"],
  isArabic: boolean
): Array<[string, string]> {
  const candidates: Array<[string, string | number | null]> = [
    [isArabic ? "المريض" : "Patient", fields.patientName],
    [isArabic ? "مقدم الخدمة" : "Provider", fields.providerName],
    [isArabic ? "مرجع الفاتورة" : "Invoice reference", fields.invoiceReference],
    [isArabic ? "تاريخ الخدمة" : "Service date", fields.serviceDate],
    [isArabic ? "المبلغ" : "Amount", fields.billedAmount],
    [isArabic ? "العملة" : "Currency", fields.currency],
    [isArabic ? "التشخيصات" : "Diagnoses", fields.diagnoses.map((item) => item.code ?? item.description).filter(Boolean).join(", ") || null],
    [isArabic ? "الإجراءات" : "Procedures", fields.procedures.map((item) => item.code ?? item.description).filter(Boolean).join(", ") || null]
  ];
  return candidates
    .filter((item): item is [string, string | number] => item[1] !== null && item[1] !== "")
    .map(([label, value]) => [label, String(value)]);
}
