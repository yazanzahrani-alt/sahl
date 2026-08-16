import type { ValidationIssue } from "../types";

type Severity = ValidationIssue["severity"];

const SEVERITY_PRESENTATION: Record<Severity, {
  container: string;
  indicator: string;
  value: string;
}> = {
  blocking_error: {
    container: "border-[#efc0b7] bg-[#fff7f5] text-[#a04c39]",
    indicator: "bg-[#fff0ed] text-[#a04c39]",
    value: "text-[#a04c39]"
  },
  warning: {
    container: "border-[#ead9bd] bg-[#fffaf2] text-[#665539]",
    indicator: "bg-[#fff0dc] text-[#8a6118]",
    value: "text-[#8a6118]"
  },
  info: {
    container: "border-[#bfd8ee] bg-[#f3f8fd] text-[#425979]",
    indicator: "bg-[#eaf3fb] text-[#005eb8]",
    value: "text-[#005eb8]"
  }
};

function severityLabel(severity: Severity, isArabic: boolean) {
  if (severity === "blocking_error") return isArabic ? "إجراء مطلوب" : "Required action";
  if (severity === "warning") return isArabic ? "تنبيه" : "Warning";
  return isArabic ? "معلومة" : "Information";
}

export function DocumentValidationIssue({
  issue,
  message,
  isArabic
}: {
  issue: ValidationIssue;
  message: string;
  isArabic: boolean;
}) {
  const presentation = SEVERITY_PRESENTATION[issue.severity];
  const indicator = issue.severity === "info" ? "i" : "!";

  return (
    <li
      data-severity={issue.severity}
      className={`flex gap-2.5 rounded-xl border px-3 py-2.5 text-sm leading-5 ${presentation.container}`}
    >
      <span
        aria-hidden="true"
        className={`mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full text-[11px] font-black ${presentation.indicator}`}
      >
        {indicator}
      </span>
      <span>
        <span className="block text-[10px] font-black uppercase tracking-[0.08em]">
          {severityLabel(issue.severity, isArabic)}
        </span>
        <span className="mt-0.5 block">{message}</span>
      </span>
    </li>
  );
}

export function ValidationIssueDetails({
  issue,
  isArabic
}: {
  issue: ValidationIssue;
  isArabic: boolean;
}) {
  const details = (isArabic ? issue.detailsAr : issue.details) ?? issue.details ?? [];
  const hasPage = issue.pageStart !== null && issue.pageStart !== undefined;
  if (!hasPage && details.length === 0) return null;

  return (
    <div className="mt-2 text-xs text-[#58767c]">
      {hasPage && (
        <p className="text-[#82999e]">
          {isArabic ? "الصفحة" : "Page"} {issue.pageStart}
          {issue.pageEnd && issue.pageEnd !== issue.pageStart ? `–${issue.pageEnd}` : ""}
        </p>
      )}
      {details.length > 0 && (
        <details className="mt-2">
          <summary className="cursor-pointer font-bold text-[#316a73]">
            {isArabic ? "عرض التفاصيل" : "View details"}
          </summary>
          <ul className="mt-2 list-disc space-y-1 ps-5">
            {details.map((detail) => <li key={detail}>{detail}</li>)}
          </ul>
        </details>
      )}
    </div>
  );
}

export function ReviewSubmissionAction({
  submitting,
  ready,
  blockingCount,
  warningCount,
  isArabic,
  onSubmit
}: {
  submitting: boolean;
  ready: boolean;
  blockingCount: number;
  warningCount: number;
  isArabic: boolean;
  onSubmit: () => void;
}) {
  const blocked = blockingCount > 0;
  const unavailable = blocked || !ready;
  const readinessMessage = blocked
    ? blockerExplanation(blockingCount, isArabic)
    : !ready
      ? (isArabic ? "لا تزال فحوصات الإرسال قيد الإعداد." : "Submission checks are still being prepared.")
      : (isArabic ? "اكتملت فحوصات الإرسال. يمكنك إرسال مطالبتك للمعالجة." : "Submission checks are complete. You can submit your claim for processing.");

  return (
    <section
      data-readiness={unavailable ? "blocked" : "ready"}
      className={`submission-action mt-8 rounded-[24px] border p-5 shadow-[0_12px_35px_rgba(38,79,89,0.06)] sm:p-6 ${unavailable ? "submission-action-blocked" : ""}`}
    >
      <div className="flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="font-extrabold text-[#0b1e3d]">
            {unavailable
              ? (isArabic ? "الإرسال غير متاح حالياً" : "Submission unavailable")
              : (isArabic ? "جاهزة للإرسال" : "Ready to submit")}
          </h2>
          <p className="mt-1 max-w-2xl text-sm leading-6 text-[#58767c]">
            {isArabic
              ? "أرسل هذه المعلومات التي راجعتها للمعالجة. بعد الإرسال، لن يمكن تعديل المطالبة أو مستنداتها."
              : "Submit this reviewed information for processing. After submission, this claim and its documents can no longer be changed."}
          </p>
          <p
            id="claim-submit-readiness"
            aria-live="polite"
            className={`mt-2 text-sm font-bold ${blocked ? "text-[#a04c39]" : "text-[#005eb8]"}`}
          >
            {readinessMessage}
          </p>
          {warningCount > 0 && (
            <p className="mt-2 text-xs font-semibold text-[#8a6118]">
              {isArabic
                ? `يمكنك الإرسال مع ${warningCount} ${warningCount === 1 ? "تنبيه" : "تنبيهات"} قيد المراجعة بعد معالجة أي متطلبات مانعة.`
                : `Warnings do not block submission. ${warningCount} unresolved ${warningCount === 1 ? "warning remains" : "warnings remain"} attached to the claim.`}
            </p>
          )}
        </div>
        <button
          type="button"
          onClick={onSubmit}
          disabled={submitting || unavailable}
          aria-describedby="claim-submit-readiness"
          className="shrink-0 rounded-xl bg-[#005eb8] px-5 py-3 text-sm font-extrabold text-white transition hover:bg-[#004f9f] focus:outline-none focus:ring-4 focus:ring-[#0072ce]/20 disabled:cursor-not-allowed disabled:bg-[#d8e1ec] disabled:text-[#7e8fa9]"
        >
          {submitting
            ? (isArabic ? "جارٍ الإرسال..." : "Submitting...")
            : (isArabic ? "إرسال للمعالجة" : "Submit for processing")}
        </button>
      </div>
    </section>
  );
}

export function ReviewSummaryValue({
  label,
  value,
  sourceNames = [],
  edited = false,
  severity,
  isArabic
}: {
  label: string;
  value: string;
  sourceNames?: string[];
  edited?: boolean;
  severity?: Severity;
  isArabic: boolean;
}) {
  const missing = value === "Not found" || value === "غير موجود";
  const semanticTone = severity ?? "neutral";
  const tone = severity ? SEVERITY_PRESENTATION[severity].container : "border-[#f0f4fa]";
  const valueTone = severity
    ? SEVERITY_PRESENTATION[severity].value
    : missing
      ? "text-[#687a96]"
      : "text-[#0b1e3d]";

  return (
    <div
      data-semantic-tone={semanticTone}
      className={`prototype-review-field rounded-lg border-b px-2 py-3.5 ${tone}`}
    >
      <div className="flex flex-wrap items-center gap-1.5">
        <p className="text-[11px] font-medium text-[#8a9bbb]">{label}</p>
        {edited && <MemberEditBadge isArabic={isArabic} />}
        {severity && (
          <span className={`text-[10px] font-bold ${SEVERITY_PRESENTATION[severity].value}`}>
            {severityLabel(severity, isArabic)}
          </span>
        )}
      </div>
      <p className={`mt-1 break-words text-sm font-medium ${valueTone}`}>{value}</p>
      {sourceNames.length > 0 && (
        <p className="mt-1 truncate text-[11px] text-[#a2aec0]">
          {edited ? (isArabic ? "المصدر الأصلي" : "Original source") : (isArabic ? "من" : "From")} {sourceNames.join(", ")}
        </p>
      )}
    </div>
  );
}

export function DemoUploadNotice({ isArabic }: { isArabic: boolean }) {
  return (
    <aside
      role="note"
      data-testid="demo-upload-notice"
      className="mb-5 flex items-center gap-2.5 rounded-xl border border-[#bfd8ee] bg-[#f3f8fd] px-3.5 py-3 text-sm text-[#425979]"
    >
      <span aria-hidden="true" className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-[#eaf3fb] text-xs font-black text-[#005eb8]">i</span>
      <span>
        {isArabic
          ? "بيئة تجريبية — استخدم مستندات اصطناعية أو اختبارية فقط."
          : "Demo environment — use synthetic or test documents only."}
      </span>
    </aside>
  );
}

function blockerExplanation(count: number, isArabic: boolean) {
  if (!isArabic) return `Fix ${count} required ${count === 1 ? "issue" : "issues"} before submitting.`;
  if (count === 1) return "عالج مشكلة مطلوبة واحدة قبل الإرسال.";
  if (count === 2) return "عالج مشكلتين مطلوبتين قبل الإرسال.";
  return `عالج ${count} مشكلات مطلوبة قبل الإرسال.`;
}

function MemberEditBadge({ isArabic }: { isArabic: boolean }) {
  return (
    <span className="inline-flex rounded-full bg-[#eef3f6] px-1.5 py-0.5 text-[9px] font-semibold text-[#71858c]">
      {isArabic ? "تم التعديل" : "Edited"}
    </span>
  );
}
