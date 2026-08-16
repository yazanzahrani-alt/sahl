import { createHash } from "node:crypto";
import { CLAIM_CATEGORIES, type ClaimCategory, type OpticalComponent } from "../claims/claim";
import { isValidDateEvidence, type DateEvidence } from "./date-evidence";

export const DOCUMENT_TYPES = [
  "invoice",
  "payment_receipt",
  "medical_report",
  "prescription",
  "eye_test",
  "discharge_summary",
  "lab_result",
  "imaging_result",
  "dental_xray",
  "other",
  "unknown"
] as const;

export type DocumentType = (typeof DOCUMENT_TYPES)[number];
export type Readability = "readable" | "unreadable" | "unclear";
export type Relevance = "relevant" | "irrelevant" | "unclear";
export type AnalysisStatus = "complete" | "needs_configuration" | "failed";
export const PAYMENT_METHODS = [
  "cash",
  "card",
  "bank_transfer",
  "digital_wallet",
  "cheque",
  "other",
  "unknown"
] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export const CARD_NETWORKS = ["mada", "visa", "mastercard", "amex", "other"] as const;
export type CardNetwork = (typeof CARD_NETWORKS)[number];
const READABILITIES = ["readable", "unreadable", "unclear"] as const;
const RELEVANCES = ["relevant", "irrelevant", "unclear"] as const;
const PAYMENT_STATUSES = ["paid", "unpaid", "unclear"] as const;
const OPTICAL_COMPONENTS = ["frames", "lenses"] as const;
export const DOCUMENT_ANALYSIS_SCHEMA_VERSION = 4;
// Bump this whenever extraction instructions or other extraction semantics change.
export const DOCUMENT_EXTRACTION_VERSION = "independent-document-v4-date-evidence";

export interface ExtractedDiagnosis {
  description: string | null;
  code: string | null;
  codingSystem: string | null;
}

export interface ExtractedProcedure {
  description: string | null;
  code: string | null;
  codingSystem: string | null;
}

export interface ExtractedServiceLine {
  description: string | null;
  serviceDate: string | null;
  quantity: number | null;
  unitPrice: number | null;
  billedAmount: number | null;
  currency: string | null;
  diagnosisText: string | null;
  diagnosisCode: string | null;
  procedureCode: string | null;
  sbsCode: string | null;
  sbsDescription: string | null;
  toothNumber: string | null;
}

export interface ExtractedDocumentFields {
  patientName: string | null;
  providerName: string | null;
  providerLocation: string | null;
  invoiceReference: string | null;
  invoiceDate: string | null;
  serviceDate: string | null;
  currency: string | null;
  subtotal: number | null;
  taxAmount: number | null;
  discountAmount: number | null;
  billedAmount: number | null;
  paymentStatus: "paid" | "unpaid" | "unclear";
  paymentMethod: PaymentMethod;
  cardNetwork: CardNetwork | null;
  admissionDate: string | null;
  dischargeDate: string | null;
  serviceLines: ExtractedServiceLine[];
  diagnoses: ExtractedDiagnosis[];
  procedures: ExtractedProcedure[];
  opticalFrameAmount: number | null;
  opticalLensAmount: number | null;
}

export type EvidenceUnitPageProvenance =
  | "provider_page_range"
  | "provider_attachment_level"
  | "legacy_attachment_level";

export interface EvidenceUnit {
  evidenceUnitId: string;
  attachmentId: string;
  pageStart: number | null;
  pageEnd: number | null;
  pageProvenance: EvidenceUnitPageProvenance;
  documentType: DocumentType;
  readability: Readability;
  relevance: Relevance;
  detectedCategories: ClaimCategory[];
  detectedOpticalItems: OpticalComponent[];
  summary: string;
  extracted: ExtractedDocumentFields;
  dateEvidence?: DateEvidence[];
  missingOrUnclear: string[];
}

export interface ProviderEvidenceUnit {
  pageStart?: number | null;
  pageEnd?: number | null;
  documentType: DocumentType;
  readability: Readability;
  relevance: Relevance;
  detectedCategories: ClaimCategory[];
  detectedOpticalItems: OpticalComponent[];
  summary: string;
  extracted: ExtractedDocumentFields;
  dateEvidence?: DateEvidence[];
  missingOrUnclear: string[];
}

export interface DocumentAnalysisResult {
  attachmentId: string;
  schemaVersion: number;
  extractionVersion: string;
  analysisStatus: AnalysisStatus;
  provider: string;
  model: string | null;
  analysedAt: string;
  readability: Readability;
  relevance: Relevance;
  documentType: DocumentType;
  detectedCategories: ClaimCategory[];
  detectedOpticalItems: OpticalComponent[];
  summary: string;
  extracted: ExtractedDocumentFields;
  missingOrUnclear: string[];
  evidenceUnits?: EvidenceUnit[];
}

export interface DocumentAnalysisInput {
  attachmentId: string;
  originalFilename: string;
  mimeType: string;
  bytes: Buffer;
}

export interface DocumentIntelligenceProvider {
  analyse(input: DocumentAnalysisInput): Promise<Omit<DocumentAnalysisResult, "attachmentId">>;
}

export function createEvidenceUnits(
  attachmentId: string,
  input: readonly ProviderEvidenceUnit[]
): EvidenceUnit[] {
  const ordered = input
    .map((unit, originalIndex) => {
      const range = validPageRange(unit.pageStart, unit.pageEnd);
      return {
        ...unit,
        originalIndex,
        pageStart: range ? range.pageStart : null,
        pageEnd: range ? range.pageEnd : null,
        pageProvenance: range
          ? "provider_page_range" as const
          : "provider_attachment_level" as const,
        fingerprint: evidenceUnitFingerprint(unit)
      };
    })
    .sort((left, right) => {
      if (left.pageStart === null && right.pageStart !== null) return 1;
      if (left.pageStart !== null && right.pageStart === null) return -1;
      return (left.pageStart ?? 0) - (right.pageStart ?? 0) ||
        (left.pageEnd ?? 0) - (right.pageEnd ?? 0) ||
        left.fingerprint.localeCompare(right.fingerprint) ||
        left.originalIndex - right.originalIndex;
    });
  const occurrences = new Map<string, number>();

  return ordered.map(({ originalIndex: _originalIndex, fingerprint, ...unit }) => {
    const identityKey = evidenceUnitIdentityKey(unit, fingerprint);
    const occurrence = (occurrences.get(identityKey) ?? 0) + 1;
    occurrences.set(identityKey, occurrence);
    return {
      ...unit,
      evidenceUnitId: `${attachmentId}:evidence:${identityKey}:${occurrence}`,
      attachmentId
    };
  });
}

export function getEvidenceUnits(analysis: DocumentAnalysisResult): EvidenceUnit[] {
  if (hasValidEvidenceUnits(analysis)) {
    return analysis.evidenceUnits;
  }

  return [{
    evidenceUnitId: `${analysis.attachmentId}:evidence:legacy:1`,
    attachmentId: analysis.attachmentId,
    pageStart: null,
    pageEnd: null,
    pageProvenance: "legacy_attachment_level",
    documentType: analysis.documentType,
    readability: analysis.readability,
    relevance: analysis.relevance,
    detectedCategories: analysis.detectedCategories,
    detectedOpticalItems: analysis.detectedOpticalItems,
    summary: analysis.summary,
    extracted: analysis.extracted,
    missingOrUnclear: analysis.missingOrUnclear
  }];
}

export function hasValidEvidenceUnits(
  analysis: DocumentAnalysisResult
): analysis is DocumentAnalysisResult & { evidenceUnits: EvidenceUnit[] } {
  return Array.isArray(analysis.evidenceUnits) &&
    analysis.evidenceUnits.length > 0 &&
    validPersistedEvidenceUnits(analysis.evidenceUnits, analysis.attachmentId);
}

export function selectLegacySummaryUnit(
  units: readonly EvidenceUnit[]
): EvidenceUnit | null {
  if (units.length === 0) return null;
  if (units.length === 1) return units[0];
  const invoices = units.filter((unit) => unit.documentType === "invoice");
  if (invoices.length > 0) return invoices[0];
  const roles = new Set(units.map((unit) => unit.documentType));
  return roles.size === 1 ? units[0] : null;
}

function validPageRange(
  pageStart: number | null | undefined,
  pageEnd: number | null | undefined
) {
  if (!Number.isInteger(pageStart) || !Number.isInteger(pageEnd) ||
      (pageStart as number) < 1 || (pageEnd as number) < (pageStart as number)) {
    return null;
  }
  return { pageStart: pageStart as number, pageEnd: pageEnd as number };
}

function validPersistedEvidenceUnits(units: unknown[], attachmentId: string) {
  if (!units.every((unit) => validEvidenceUnit(unit, attachmentId))) return false;
  const candidates = units as EvidenceUnit[];
  const ids = candidates.map((unit) => unit.evidenceUnitId);
  if (new Set(ids).size !== ids.length) return false;

  const legacyUnits = candidates.filter(
    (unit) => unit.pageProvenance === "legacy_attachment_level"
  );
  if (legacyUnits.length > 0) {
    return candidates.length === 1 &&
      legacyUnits[0].evidenceUnitId === `${attachmentId}:evidence:legacy:1`;
  }

  const expectedIds = new Set(createEvidenceUnits(
    attachmentId,
    candidates.map((unit) => ({
      pageStart: unit.pageStart,
      pageEnd: unit.pageEnd,
      documentType: unit.documentType,
      readability: unit.readability,
      relevance: unit.relevance,
      detectedCategories: unit.detectedCategories,
      detectedOpticalItems: unit.detectedOpticalItems,
      summary: unit.summary,
      extracted: unit.extracted,
      dateEvidence: unit.dateEvidence,
      missingOrUnclear: unit.missingOrUnclear
    }))
  ).map((unit) => unit.evidenceUnitId));
  return candidates.every((unit) =>
    expectedIds.has(unit.evidenceUnitId) &&
    unit.evidenceUnitId.startsWith(
      `${attachmentId}:evidence:${evidenceUnitIdentityKey(unit)}:`
    )
  );
}

function validEvidenceUnit(unit: unknown, attachmentId: string): unit is EvidenceUnit {
  if (typeof unit !== "object" || unit === null) return false;
  const candidate = unit as Partial<EvidenceUnit>;
  const hasValidRange = validPageRange(candidate.pageStart, candidate.pageEnd) !== null;
  const hasNoRange = candidate.pageStart === null && candidate.pageEnd === null;
  const validPageProvenance = candidate.pageProvenance === "provider_page_range"
    ? hasValidRange
    : candidate.pageProvenance === "provider_attachment_level" ||
      candidate.pageProvenance === "legacy_attachment_level"
      ? hasNoRange
      : false;
  return typeof candidate.evidenceUnitId === "string" &&
    Boolean(candidate.evidenceUnitId.trim()) &&
    candidate.attachmentId === attachmentId &&
    DOCUMENT_TYPES.includes(candidate.documentType as DocumentType) &&
    READABILITIES.includes(candidate.readability as Readability) &&
    RELEVANCES.includes(candidate.relevance as Relevance) &&
    (hasValidRange || hasNoRange) &&
    validPageProvenance &&
    validEnumArray(candidate.detectedCategories, CLAIM_CATEGORIES) &&
    validEnumArray(candidate.detectedOpticalItems, OPTICAL_COMPONENTS) &&
    typeof candidate.summary === "string" &&
    validExtractedFields(candidate.extracted) &&
    (candidate.dateEvidence === undefined ||
      Array.isArray(candidate.dateEvidence) && candidate.dateEvidence.every(isValidDateEvidence)) &&
    validStringArray(candidate.missingOrUnclear);
}

function evidenceUnitFingerprint(unit: ProviderEvidenceUnit) {
  const content = {
    readability: unit.readability,
    relevance: unit.relevance,
    detectedCategories: [...unit.detectedCategories].sort(),
    detectedOpticalItems: [...unit.detectedOpticalItems].sort(),
    summary: unit.summary,
    extracted: unit.extracted,
    dateEvidence: unit.dateEvidence,
    missingOrUnclear: unit.missingOrUnclear
  };
  return createHash("sha256")
    .update(JSON.stringify(canonicalize(content)))
    .digest("hex");
}

function evidenceUnitIdentityKey(
  unit: ProviderEvidenceUnit,
  fingerprint = evidenceUnitFingerprint(unit)
) {
  const range = validPageRange(unit.pageStart, unit.pageEnd);
  const rangeKey = range
    ? `pages-${range.pageStart}-${range.pageEnd}`
    : "pages-unknown";
  return `${rangeKey}:${unit.documentType}:${fingerprint}`;
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!isRecord(value)) return value;
  return Object.fromEntries(
    Object.keys(value).sort().map((key) => [key, canonicalize(value[key])])
  );
}

function validExtractedFields(value: unknown): value is ExtractedDocumentFields {
  if (!hasExactKeys(value, [
    "patientName", "providerName", "providerLocation", "invoiceReference",
    "invoiceDate", "serviceDate", "currency", "subtotal", "taxAmount",
    "discountAmount", "billedAmount", "paymentStatus", "paymentMethod", "cardNetwork",
    "admissionDate", "dischargeDate", "serviceLines", "diagnoses", "procedures",
    "opticalFrameAmount", "opticalLensAmount"
  ])) return false;
  return [
    value.patientName, value.providerName, value.providerLocation, value.invoiceReference,
    value.invoiceDate, value.serviceDate, value.currency, value.admissionDate, value.dischargeDate
  ].every(validNullableString) &&
    [
      value.subtotal, value.taxAmount, value.discountAmount, value.billedAmount,
      value.opticalFrameAmount, value.opticalLensAmount
    ].every(validNullableNumber) &&
    PAYMENT_STATUSES.includes(value.paymentStatus as ExtractedDocumentFields["paymentStatus"]) &&
    PAYMENT_METHODS.includes(value.paymentMethod as PaymentMethod) &&
    (value.cardNetwork === null || CARD_NETWORKS.includes(value.cardNetwork as CardNetwork)) &&
    Array.isArray(value.serviceLines) && value.serviceLines.every(validServiceLine) &&
    Array.isArray(value.diagnoses) && value.diagnoses.every(validClinicalItem) &&
    Array.isArray(value.procedures) && value.procedures.every(validClinicalItem);
}

function validServiceLine(value: unknown): value is ExtractedServiceLine {
  if (!hasExactKeys(value, [
    "description", "serviceDate", "quantity", "unitPrice", "billedAmount", "currency",
    "diagnosisText", "diagnosisCode", "procedureCode", "sbsCode", "sbsDescription",
    "toothNumber"
  ])) return false;
  return [
    value.description, value.serviceDate, value.currency, value.diagnosisText,
    value.diagnosisCode, value.procedureCode, value.sbsCode, value.sbsDescription,
    value.toothNumber
  ].every(validNullableString) &&
    [value.quantity, value.unitPrice, value.billedAmount].every(validNullableNumber);
}

function validClinicalItem(value: unknown): value is ExtractedDiagnosis | ExtractedProcedure {
  return hasExactKeys(value, ["description", "code", "codingSystem"]) &&
    [value.description, value.code, value.codingSystem].every(validNullableString);
}

function hasExactKeys<T extends string>(
  value: unknown,
  keys: readonly T[]
): value is Record<T, unknown> {
  if (!isRecord(value)) return false;
  const actualKeys = Object.keys(value);
  return actualKeys.length === keys.length && keys.every((key) => key in value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validEnumArray<T extends string>(
  value: unknown,
  allowed: readonly T[]
): value is T[] {
  return Array.isArray(value) && value.every(
    (item): item is T => typeof item === "string" && allowed.includes(item as T)
  );
}

function validStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function validNullableString(value: unknown): value is string | null {
  return value === null || typeof value === "string";
}

function validNullableNumber(value: unknown): value is number | null {
  return value === null || typeof value === "number" && Number.isFinite(value);
}

export function blankExtractedFields(): ExtractedDocumentFields {
  return {
    patientName: null,
    providerName: null,
    providerLocation: null,
    invoiceReference: null,
    invoiceDate: null,
    serviceDate: null,
    currency: null,
    subtotal: null,
    taxAmount: null,
    discountAmount: null,
    billedAmount: null,
    paymentStatus: "unclear",
    paymentMethod: "unknown",
    cardNetwork: null,
    admissionDate: null,
    dischargeDate: null,
    serviceLines: [],
    diagnoses: [],
    procedures: [],
    opticalFrameAmount: null,
    opticalLensAmount: null
  };
}
