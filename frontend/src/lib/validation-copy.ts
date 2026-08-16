import type { ValidationIssue } from "../types";

const arabicMessages: Record<string, string> = {
  document_unreadable: "استبدل هذا الملف بنسخة أوضح يمكن قراءتها.",
  document_unverifiable: "استبدل هذا الملف بنسخة واضحة من فاتورة أو مستند طبي داعم.",
  document_readability_unclear: "تأكد من أن جميع تفاصيل هذا المستند واضحة وقابلة للقراءة.",
  document_irrelevant: "احذف هذا الملف أو استبدله بمستند يخص هذه المطالبة.",
  document_relevance_unclear: "أكد أن هذا المستند يخص الحالة العلاجية لهذه المطالبة.",
  document_type_unclear: "أكد نوع هذا المستند.",
  category_unclear: "يحتوي المستند على مؤشرات لأكثر من فئة. أكد الفئة المختارة.",
  category_mismatch: "يبدو أن المستندات لا تطابق فئة المطالبة المختارة. غيّر الفئة أو استبدل المستندات.",
  invoice_missing: "ارفع فاتورة تفصيلية توضح الخدمة والمبلغ.",
  invoice_currency_mismatch: "تختلف العملات بين الفواتير. أكد أن جميع الفواتير تخص هذه المطالبة.",
  invoice_patientName_missing: "أكد اسم المريض الظاهر في الفاتورة.",
  invoice_providerName_missing: "أضف أو أكد اسم مقدم الرعاية الصحية.",
  invoice_providerLocation_missing: "أضف أو أكد موقع مقدم الخدمة.",
  invoice_invoiceDate_missing: "أضف أو أكد تاريخ الفاتورة.",
  invoice_currency_missing: "أضف أو أكد عملة الفاتورة.",
  invoice_billedAmount_missing: "أضف أو أكد إجمالي المبلغ المفوتر.",
  invoice_amount_invalid: "أكد أن المبلغ المفوتر أكبر من صفر.",
  invoice_reference_unclear: "أكد رقم الفاتورة أو الإيصال إذا كان ظاهراً.",
  service_lines_missing: "قدم فاتورة تفصيلية تحتوي على وصف خدمة واحد على الأقل.",
  service_line_amount_invalid: "تحقق من مبالغ بنود الخدمة؛ يجب أن تكون أكبر من صفر.",
  service_line_calculation_conflict: "لا تتطابق كمية وسعر أحد البنود مع مبلغه. أكد قيم الفاتورة.",
  invoice_subtotal_needs_review: "لا يساوي مجموع البنود الإجمالي الفرعي للفاتورة. تحقق من القيم المستخرجة.",
  invoice_total_needs_review: "لا يساوي مجموع البنود إجمالي الفاتورة. تحقق من الضريبة أو الخصم أو القيم المستخرجة.",
  invoice_date_invalid: "أكد تاريخ الفاتورة بصيغة السنة-الشهر-اليوم.",
  invoice_date_future: "لا يمكن أن يكون تاريخ الفاتورة في المستقبل.",
  service_date_invalid: "أكد تاريخ الخدمة بصيغة السنة-الشهر-اليوم.",
  service_date_future: "لا يمكن أن يكون تاريخ الخدمة في المستقبل.",
  admission_date_invalid: "أكد تاريخ الدخول بصيغة السنة-الشهر-اليوم.",
  discharge_date_invalid: "أكد تاريخ الخروج بصيغة السنة-الشهر-اليوم.",
  admission_date_future: "لا يمكن أن يكون تاريخ الدخول في المستقبل.",
  discharge_date_future: "لا يمكن أن يكون تاريخ الخروج في المستقبل.",
  admission_discharge_order_invalid: "لا يمكن أن يكون تاريخ الدخول بعد تاريخ الخروج.",
  payment_evidence_missing: "ارفع إثبات الدفع أو فاتورة تفصيلية توضح أنها مدفوعة.",
  payment_evidence_unclear: "أكد أن هذا الإيصال يثبت دفع فاتورة هذه المطالبة.",
  payment_currency_mismatch: "تختلف عملة الإيصال عن عملة الفاتورة. أكد أنهما مرتبطان.",
  payment_amount_mismatch: "لا يطابق مبلغ الإيصال فاتورة واحدة أو إجمالي الفواتير. أكد إثبات الدفع.",
  payment_coverage_unclear: "لا توضح الإيصالات المرفوعة دفع كل الفواتير غير المثبت دفعها. أكد اكتمال إثبات الدفع.",
  medical_report_insufficient: "وجدنا التقرير الطبي، لكنه لا يحتوي على معلومات سريرية مقروءة وكافية. استبدله بنسخة أكثر اكتمالاً.",
  discharge_summary_insufficient: "وجدنا ملخص الخروج، لكنه لا يحتوي على معلومات سريرية مقروءة وكافية. استبدله بنسخة أكثر اكتمالاً.",
  eye_test_insufficient: "وجدنا فحص النظر، لكنه لا يحتوي على معلومات مقروءة وكافية. استبدله بنسخة أكثر اكتمالاً.",
  prescription_insufficient: "وجدنا الوصفة الطبية، لكنها لا تحتوي على معلومات مقروءة وكافية. استبدلها بنسخة أكثر اكتمالاً.",
  eye_test_uncertain: "وجدنا فحص النظر، لكن تعذر التحقق آلياً من بعض التفاصيل الداعمة. راجع المستند قبل الإرسال.",
  prescription_uncertain: "وجدنا الوصفة الطبية، لكن تعذر التحقق آلياً من بعض التفاصيل الداعمة. راجع المستند قبل الإرسال.",
  inpatient_document_missing: "ارفع تقريراً طبياً أو ملخص خروج لمطالبة التنويم أو الجراحة.",
  optical_document_missing: "ارفع فحص النظر أو الوصفة الطبية الداعمة للمطالبة البصرية.",
  optical_item_mismatch: "لا يطابق عنصر البصريات الظاهر في المستند العنصر المختار. تحقق من الاختيار أو الفاتورة.",
  optical_frame_amount_missing: "أكد مبلغ الإطار المفصل بشكل منفصل.",
  optical_lens_amount_missing: "أكد مبلغ العدسات المفصل بشكل منفصل.",
  patient_name_mismatch: "تختلف أسماء المرضى بين المستندات. استبدل الملف غير المرتبط أو صحح الاسم المستخرج.",
  provider_mismatch: "تختلف أسماء مقدمي الخدمة بين المستندات. أكد أنها تخص حالة علاجية واحدة.",
  service_date_mismatch: "تختلف تواريخ الخدمة بين المستندات. أكد أنها تخص حالة علاجية واحدة.",
  episode_dates_unclear: "تحتوي المستندات على أكثر من تاريخ خدمة. أكد أنها تخص حالة علاجية واحدة."
};

export function validationIssueMessage(issue: ValidationIssue, isArabic: boolean) {
  if (isArabic && issue.messageAr) return issue.messageAr;
  if (isArabic && issue.code.startsWith("member_edit_differs_from_source_")) {
    return "تختلف القيمة التي أدخلتها عن المستند المرفوع. راجعها قبل الإرسال.";
  }
  return isArabic ? arabicMessages[issue.code] ?? "راجع هذه المعلومة قبل إرسال المطالبة." : issue.message;
}
