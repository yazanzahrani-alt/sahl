import type {
  DocumentAnalysisResult,
  DocumentType,
  EvidenceUnit,
  ExtractedDocumentFields
} from "../document-intelligence/document-analysis";
import { getEvidenceUnits } from "../document-intelligence/document-analysis";

type CompletenessEvidenceUnit = EvidenceUnit & {
  analysisStatus?: DocumentAnalysisResult["analysisStatus"];
};

export type EvidenceCompletenessState =
  | "present_useful"
  | "present_insufficient"
  | "uncertain"
  | "absent";

export interface EvidenceCompletenessResult {
  state: EvidenceCompletenessState;
  documentType: DocumentType;
  attachmentId: string | null;
  evidenceUnitId: string | null;
  pageStart: number | null;
  pageEnd: number | null;
}

const EVIDENCE_DOCUMENT_TYPES = new Set<DocumentType>([
  "medical_report",
  "discharge_summary",
  "eye_test",
  "prescription",
  "dental_xray",
  "lab_result",
  "imaging_result"
]);

const PLACEHOLDER_VALUES = new Set([
  "na",
  "none",
  "null",
  "unknown",
  "notavailable",
  "notapplicable"
]);

const GENERIC_CLINICAL_VALUES = new Set([
  "consultation",
  "service",
  "treatment",
  "procedure"
]);

/**
 * Derives intake evidence completeness from one independently extracted
 * evidence unit. This is deliberately not a medical-quality or coverage decision.
 */
export class EvidenceCompletenessEvaluator {
  evaluateRequiredGroup(
    documentTypes: readonly DocumentType[],
    evidenceUnits: readonly CompletenessEvidenceUnit[]
  ): EvidenceCompletenessResult {
    const evaluations = documentTypes.flatMap((documentType) =>
      evidenceUnits
        .filter((unit) => unit.documentType === documentType)
        .map((unit) => this.evaluateUnit(unit))
    );

    return evaluations.find((result) => result.state === "present_useful") ??
      evaluations.find((result) => result.state === "uncertain") ??
      evaluations.find((result) => result.state === "present_insufficient") ?? {
        state: "absent",
        documentType: documentTypes[0] ?? "unknown",
        attachmentId: null,
        evidenceUnitId: null,
        pageStart: null,
        pageEnd: null
      };
  }

  evaluateRole(
    documentType: DocumentType,
    evidenceUnits: readonly CompletenessEvidenceUnit[]
  ): EvidenceCompletenessResult {
    return this.evaluateRequiredGroup([documentType], evidenceUnits);
  }

  evaluateUnit(
    unit: CompletenessEvidenceUnit
  ): EvidenceCompletenessResult {
    const result = (state: EvidenceCompletenessState): EvidenceCompletenessResult => ({
      state,
      documentType: unit.documentType,
      attachmentId: unit.attachmentId,
      evidenceUnitId: unit.evidenceUnitId,
      pageStart: unit.pageStart,
      pageEnd: unit.pageEnd
    });

    if ((unit.analysisStatus !== undefined && unit.analysisStatus !== "complete") ||
        !EVIDENCE_DOCUMENT_TYPES.has(unit.documentType) ||
        unit.readability === "unreadable" ||
        unit.relevance === "irrelevant") {
      return result("absent");
    }

    if (unit.documentType === "medical_report" ||
        unit.documentType === "discharge_summary") {
      return result(this.hasMeaningfulClinicalContent(
        unit.extracted,
        false
      ) ? "present_useful" : "present_insufficient");
    }

    if (unit.documentType === "eye_test" ||
        unit.documentType === "prescription") {
      if (this.hasMeaningfulOpticalContent(unit)) return result("present_useful");
      if (this.hasStrongEmptySignal(unit)) return result("present_insufficient");
      return result("uncertain");
    }

    if (this.hasMeaningfulClinicalContent(
      unit.extracted,
      unit.documentType === "dental_xray"
    )) return result("present_useful");
    if (this.hasStrongEmptySignal(unit)) return result("present_insufficient");

    // The current schema has no refraction, prescription-detail, lab, imaging,
    // or X-ray-specific fields. Sparse results for those roles are ambiguous.
    return result("uncertain");
  }

  evaluateAttachment(analysis: DocumentAnalysisResult | EvidenceUnit) {
    const unit = "evidenceUnitId" in analysis
      ? analysis
      : { ...getEvidenceUnits(analysis)[0], analysisStatus: analysis.analysisStatus };
    return this.evaluateUnit(unit);
  }

  private hasMeaningfulClinicalContent(
    fields: ExtractedDocumentFields,
    includeDentalSignals: boolean
  ) {
    if (this.meaningfulText(fields.admissionDate) ||
        this.meaningfulText(fields.dischargeDate)) return true;
    if (fields.diagnoses.some((item) =>
      this.substantiveClinicalText(item.description) || this.meaningfulText(item.code)
    )) {
      return true;
    }
    if (fields.procedures.some((item) =>
      this.substantiveClinicalText(item.description) || this.meaningfulText(item.code)
    )) {
      return true;
    }
    return fields.serviceLines.some((line) =>
      this.substantiveClinicalText(line.description) ||
      this.substantiveClinicalText(line.diagnosisText) ||
      this.meaningfulText(line.diagnosisCode) ||
      this.meaningfulText(line.procedureCode) ||
      this.meaningfulText(line.sbsCode) ||
      this.substantiveClinicalText(line.sbsDescription) ||
      (includeDentalSignals && this.meaningfulText(line.toothNumber))
    );
  }

  private hasMeaningfulOpticalContent(unit: EvidenceUnit) {
    if (unit.detectedOpticalItems.length > 0) return true;
    const fields = unit.extracted;
    const descriptions = [
      ...fields.diagnoses.map((item) => item.description),
      ...fields.procedures.map((item) => item.description),
      ...fields.serviceLines.flatMap((line) => [
        line.description,
        line.diagnosisText,
        line.sbsDescription
      ])
    ].filter((value): value is string => this.meaningfulText(value));
    const text = descriptions.join(" ").toLocaleLowerCase();
    return /\b(eye|eyes|vision|visual|ocular|optical|optometry|optometric|ophthalmic|ophthalmology|refraction|refractive|spectacle|spectacles|eyeglass|eyeglasses|lens|lenses|myopia|hyperopia|astigmatism)\b/.test(text) ||
      /(عين|عيون|نظر|بصر|بصري|بصرية|انكسار|عدسة|عدسات|نظارة|نظارات)/.test(text);
  }

  private hasStrongEmptySignal(unit: EvidenceUnit) {
    if (this.hasAnyExtractedValue(unit.extracted)) return false;
    return unit.missingOrUnclear.some((value) =>
      /\b(blank|empty|no (?:readable|visible|substantive|clinical) (?:content|information)|no content)\b/i
        .test(value)
    );
  }

  private hasAnyExtractedValue(fields: ExtractedDocumentFields) {
    return [
      fields.patientName,
      fields.providerName,
      fields.providerLocation,
      fields.invoiceReference,
      fields.invoiceDate,
      fields.serviceDate,
      fields.currency,
      fields.subtotal,
      fields.taxAmount,
      fields.discountAmount,
      fields.billedAmount,
      fields.cardNetwork,
      fields.admissionDate,
      fields.dischargeDate,
      fields.opticalFrameAmount,
      fields.opticalLensAmount
    ].some((value) => typeof value === "number" || this.meaningfulText(value)) ||
      fields.paymentStatus !== "unclear" ||
      fields.paymentMethod !== "unknown" ||
      fields.serviceLines.some((line) => [
        line.description,
        line.serviceDate,
        line.currency,
        line.diagnosisText,
        line.diagnosisCode,
        line.procedureCode,
        line.sbsCode,
        line.sbsDescription,
        line.toothNumber
      ].some((value) => this.meaningfulText(value)) || [
        line.quantity,
        line.unitPrice,
        line.billedAmount
      ].some((value) => typeof value === "number")) ||
      fields.diagnoses.some((item) =>
        this.meaningfulText(item.description) || this.meaningfulText(item.code)
      ) ||
      fields.procedures.some((item) =>
        this.meaningfulText(item.description) || this.meaningfulText(item.code)
      );
  }

  private meaningfulText(value: string | null): value is string {
    if (!value?.trim()) return false;
    const normalized = value
      .toLocaleLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, "");
    return Boolean(normalized) && !PLACEHOLDER_VALUES.has(normalized);
  }

  private substantiveClinicalText(value: string | null) {
    if (!this.meaningfulText(value)) return false;
    const normalized = value.toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
    return !GENERIC_CLINICAL_VALUES.has(normalized);
  }
}
