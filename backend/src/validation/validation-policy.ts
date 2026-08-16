import type { ClaimCategory } from "../claims/claim";
import type { DocumentType } from "../document-intelligence/document-analysis";

interface CategoryValidationPolicy {
  requiredDocumentGroups: DocumentType[][];
  conditionalDocuments: DocumentType[];
}

export const CLAIM_VALIDATION_POLICY = {
  requiredInvoiceFields: [
    "patientName",
    "providerName",
    "providerLocation",
    "invoiceDate",
    "currency",
    "billedAmount"
  ] as const,
  categories: {
    inpatient_surgery: {
      requiredDocumentGroups: [["medical_report", "discharge_summary"]],
      conditionalDocuments: ["lab_result", "imaging_result"]
    },
    dental: {
      requiredDocumentGroups: [],
      conditionalDocuments: ["dental_xray"]
    },
    optical: {
      requiredDocumentGroups: [["eye_test", "prescription"]],
      conditionalDocuments: []
    },
    other_outpatient: {
      requiredDocumentGroups: [],
      conditionalDocuments: [
        "medical_report",
        "prescription",
        "lab_result",
        "imaging_result"
      ]
    }
  } satisfies Record<ClaimCategory, CategoryValidationPolicy>
} as const;
