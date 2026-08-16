const ARABIC_DOCUMENT_ROLE_LABELS: Record<string, string> = {
  invoice: "فاتورة",
  payment_receipt: "إيصال دفع",
  receipt: "إيصال دفع",
  medical_report: "تقرير طبي",
  discharge_summary: "ملخص خروج",
  eye_test: "فحص نظر",
  prescription: "وصفة طبية",
  dental_xray: "أشعة أسنان",
  lab_result: "نتيجة مختبر",
  imaging_result: "نتيجة أشعة",
  other: "مستند آخر",
  unknown: "غير معروف"
};

export function documentRoleLabel(value: string, isArabic: boolean) {
  if (isArabic) {
    return ARABIC_DOCUMENT_ROLE_LABELS[value] ?? value.replaceAll("_", " ");
  }

  return value
    .split("_")
    .map((part) => part ? `${part[0]!.toUpperCase()}${part.slice(1)}` : part)
    .join(" ");
}
