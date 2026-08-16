import type { ClaimCategory, OpticalItem } from "../types";
import type { Language } from "../i18n/language-context";

export interface CategoryGuidance {
  label: string;
  description: string;
  required: string[];
  conditional: string[];
}

export const categoryGuidance: Record<ClaimCategory, CategoryGuidance> = {
  inpatient_surgery: {
    label: "Inpatient and Surgery",
    description: "For hospital admissions, surgery, and related inpatient care.",
    required: [
      "Itemized invoice with a cost breakdown",
      "Proof of payment",
      "Detailed discharge or medical report"
    ],
    conditional: [
      "Laboratory or imaging results, when relevant",
      "Device or implant invoice, when relevant"
    ]
  },
  dental: {
    label: "Dental",
    description: "For dental consultations, treatment, and procedures.",
    required: [
      "Itemized invoice showing procedures and costs",
      "Proof of payment"
    ],
    conditional: ["Dental X-ray, when relevant to the treatment"]
  },
  optical: {
    label: "Optical",
    description: "For glasses, lenses, frames, and related eye care.",
    required: [
      "Invoice showing the selected item cost separately",
      "Proof of payment",
      "Eye test or prescription"
    ],
    conditional: []
  },
  other_outpatient: {
    label: "Other / Outpatient",
    description: "For consultations and treatment outside hospital admission.",
    required: ["Itemized invoice", "Proof of payment"],
    conditional: [
      "Medical report, prescription, lab result, or imaging result when relevant"
    ]
  }
};

export const categoryGuidanceArabic: Record<ClaimCategory, CategoryGuidance> = {
  inpatient_surgery: {
    label: "التنويم والجراحة",
    description: "لحالات التنويم والعمليات الجراحية والرعاية المرتبطة بها.",
    required: [
      "فاتورة تفصيلية موضح بها توزيع التكاليف",
      "إثبات الدفع",
      "تقرير طبي مفصل أو ملخص الخروج"
    ],
    conditional: [
      "نتائج المختبر أو الأشعة عند الحاجة",
      "فاتورة الجهاز أو الزراعة الطبية عند الحاجة"
    ]
  },
  dental: {
    label: "الأسنان",
    description: "لاستشارات وعلاجات وإجراءات الأسنان.",
    required: [
      "فاتورة تفصيلية توضح الإجراءات والتكاليف",
      "إثبات الدفع"
    ],
    conditional: ["أشعة الأسنان عندما تكون مرتبطة بالعلاج"]
  },
  optical: {
    label: "البصريات",
    description: "للنظارات والعدسات والإطارات والرعاية البصرية المرتبطة بها.",
    required: [
      "فاتورة توضح تكلفة العنصر المختار بشكل منفصل",
      "إثبات الدفع",
      "فحص نظر أو وصفة طبية"
    ],
    conditional: []
  },
  other_outpatient: {
    label: "أخرى / عيادات خارجية",
    description: "للاستشارات والعلاج من دون تنويم بالمستشفى.",
    required: ["فاتورة تفصيلية", "إثبات الدفع"],
    conditional: [
      "تقرير طبي أو وصفة أو نتيجة مختبر أو أشعة عند الحاجة"
    ]
  }
};

export const opticalItemGuidance: Record<OpticalItem, CategoryGuidance> = {
  frames: {
    label: "Optical — Frames",
    description: "For an Optical claim that includes an eyeglass frame.",
    required: [
      "Invoice clearly showing the frame cost",
      "Proof of payment",
      "Eye test or prescription"
    ],
    conditional: []
  },
  lenses: {
    label: "Optical — Lenses",
    description: "For an Optical claim that includes eyeglass lenses.",
    required: [
      "Invoice clearly showing the lens cost",
      "Proof of payment",
      "Eye test or prescription"
    ],
    conditional: []
  },
  both: {
    label: "Optical — Frames and lenses",
    description: "For frames and lenses claimed together from the same treatment episode.",
    required: [
      "Invoice clearly showing frame and lens costs separately",
      "Proof of payment",
      "Eye test or prescription"
    ],
    conditional: []
  }
};

export const opticalItemGuidanceArabic: Record<OpticalItem, CategoryGuidance> = {
  frames: {
    label: "البصريات — الإطار",
    description: "لمطالبة بصرية تتضمن إطار النظارة.",
    required: [
      "فاتورة توضح تكلفة الإطار بوضوح",
      "إثبات الدفع",
      "فحص نظر أو وصفة طبية"
    ],
    conditional: []
  },
  lenses: {
    label: "البصريات — العدسات",
    description: "لمطالبة بصرية تتضمن عدسات النظارة.",
    required: [
      "فاتورة توضح تكلفة العدسات بوضوح",
      "إثبات الدفع",
      "فحص نظر أو وصفة طبية"
    ],
    conditional: []
  },
  both: {
    label: "البصريات — الإطار والعدسات",
    description: "للإطار والعدسات المطالب بهما معًا ضمن الحالة العلاجية نفسها.",
    required: [
      "فاتورة توضح تكلفة الإطار والعدسات كلًا على حدة",
      "إثبات الدفع",
      "فحص نظر أو وصفة طبية"
    ],
    conditional: []
  }
};

export function getCategoryGuidance(language: Language) {
  return language === "ar" ? categoryGuidanceArabic : categoryGuidance;
}

export function getClaimGuidance(
  category: ClaimCategory,
  opticalItem: OpticalItem | null | undefined,
  language: Language = "en"
) {
  const categories = getCategoryGuidance(language);
  const opticalItems = language === "ar"
    ? opticalItemGuidanceArabic
    : opticalItemGuidance;
  if (category === "optical" && opticalItem) {
    return opticalItems[opticalItem];
  }

  return categories[category];
}

export function formatCategory(
  category: ClaimCategory,
  opticalItem?: OpticalItem | null,
  language: Language = "en"
) {
  return getClaimGuidance(category, opticalItem, language).label;
}

export function formatLocation(
  location: "local" | "international",
  language: Language = "en"
) {
  if (language === "ar") {
    return location === "local" ? "محلية" : "دولية";
  }
  return location === "local" ? "Local" : "International";
}
