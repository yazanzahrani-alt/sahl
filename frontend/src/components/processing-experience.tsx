import { useLanguage } from "../i18n/language-context";

export type ProcessingPhase =
  | "preparing"
  | "checking"
  | "extracting"
  | "validating"
  | "review";

const phaseOrder: ProcessingPhase[] = [
  "preparing",
  "checking",
  "extracting",
  "validating",
  "review"
];

const copy = {
  en: {
    eyebrow: "Preparing your claim",
    title: "Reading your documents…",
    description: "Keep this page open while Sahl prepares the information for your review.",
    preparing: "Preparing documents",
    checking: "Checking documents",
    extracting: "Reading claim information",
    validating: "Checking your claim",
    review: "Preparing your review",
    preparingDetail: "Getting your files ready.",
    checkingDetail: "Making sure the documents can be used.",
    extractingDetail: "Identifying the important claim details.",
    validatingDetail: "Checking for anything missing or unclear.",
    reviewDetail: "Organising everything for you to review."
  },
  ar: {
    eyebrow: "تجهيز مطالبتك",
    title: "جارٍ قراءة مستنداتك…",
    description: "أبقِ هذه الصفحة مفتوحة بينما يجهّز سهل المعلومات لمراجعتك.",
    preparing: "تجهيز المستندات",
    checking: "التحقق من المستندات",
    extracting: "قراءة معلومات المطالبة",
    validating: "التحقق من المطالبة",
    review: "تجهيز المراجعة",
    preparingDetail: "جارٍ تجهيز ملفاتك.",
    checkingDetail: "جارٍ التأكد من وضوح المستندات وصلاحيتها.",
    extractingDetail: "جارٍ تحديد معلومات المطالبة المهمة.",
    validatingDetail: "جارٍ التحقق من أي معلومات ناقصة أو غير واضحة.",
    reviewDetail: "جارٍ تنظيم المعلومات لمراجعتها."
  }
} as const;

export function ProcessingExperience({ phase }: { phase: ProcessingPhase }) {
  const { language, isArabic } = useLanguage();
  const text = copy[language];
  const activeIndex = phaseOrder.indexOf(phase);

  return (
    <div className="processing-overlay" role="status" aria-live="polite" aria-atomic="true" dir={isArabic ? "rtl" : "ltr"}>
      <div className="processing-card">
        <div className="processing-orbit" aria-hidden="true"><span /><span /><span /></div>
        <p className="processing-eyebrow">{text.eyebrow}</p>
        <h2>{text.title}</h2>
        <p className="processing-description">{text.description}</p>

        <ol className="processing-steps">
          {phaseOrder.map((item, index) => {
            const complete = index < activeIndex;
            const active = index === activeIndex;
            return (
              <li key={item} className={complete ? "is-complete" : active ? "is-active" : ""}>
                <span className="processing-step-mark" aria-hidden="true">{complete ? "✓" : active ? <i /> : index + 1}</span>
                <span>
                  <strong>{text[item]}</strong>
                  {active && <small>{text[`${item}Detail` as keyof typeof text]}</small>}
                </span>
              </li>
            );
          })}
        </ol>
      </div>
    </div>
  );
}
