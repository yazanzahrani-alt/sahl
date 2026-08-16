import {
  Inject,
  Injectable,
  Logger,
  ServiceUnavailableException
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import OpenAI from "openai";
import type { ClaimCategory } from "../claims/claim";
import {
  DOCUMENT_ANALYSIS_SCHEMA_VERSION,
  DOCUMENT_EXTRACTION_VERSION,
  DOCUMENT_TYPES,
  DocumentAnalysisInput,
  DocumentIntelligenceProvider,
  DocumentType,
  ProviderEvidenceUnit,
  ExtractedDocumentFields,
  ExtractedDiagnosis,
  ExtractedProcedure,
  ExtractedServiceLine,
  blankExtractedFields,
  createEvidenceUnits,
  selectLegacySummaryUnit
} from "./document-analysis";
import { isValidDateEvidence } from "./date-evidence";

const DETECTED_CATEGORIES_SCHEMA = {
  type: "array",
  maxItems: 4,
  items: {
    type: "string",
    enum: ["inpatient_surgery", "dental", "optical", "other_outpatient"]
  }
} as const;

const DETECTED_OPTICAL_ITEMS_SCHEMA = {
  type: "array",
  maxItems: 2,
  items: { type: "string", enum: ["frames", "lenses"] }
} as const;

const EXTRACTED_FIELDS_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [
    "patientName", "providerName", "providerLocation", "invoiceReference",
    "invoiceDate", "serviceDate", "currency", "subtotal", "taxAmount",
    "discountAmount", "billedAmount", "paymentStatus", "paymentMethod", "cardNetwork",
    "admissionDate", "dischargeDate", "serviceLines", "diagnoses", "procedures", "opticalFrameAmount",
    "opticalLensAmount"
  ],
  properties: {
    patientName: { type: ["string", "null"] },
    providerName: { type: ["string", "null"] },
    providerLocation: { type: ["string", "null"] },
    invoiceReference: { type: ["string", "null"] },
    invoiceDate: { type: ["string", "null"] },
    serviceDate: { type: ["string", "null"] },
    currency: { type: ["string", "null"] },
    subtotal: { type: ["number", "null"] },
    taxAmount: { type: ["number", "null"] },
    discountAmount: { type: ["number", "null"] },
    billedAmount: { type: ["number", "null"] },
    paymentStatus: { type: "string", enum: ["paid", "unpaid", "unclear"] },
    paymentMethod: { type: "string", enum: ["cash", "card", "bank_transfer", "digital_wallet", "cheque", "other", "unknown"] },
    cardNetwork: { type: ["string", "null"], enum: ["mada", "visa", "mastercard", "amex", "other", null] },
    admissionDate: { type: ["string", "null"] },
    dischargeDate: { type: ["string", "null"] },
    serviceLines: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: [
          "description", "serviceDate", "quantity", "unitPrice", "billedAmount",
          "currency", "diagnosisText", "diagnosisCode", "procedureCode", "sbsCode",
          "sbsDescription", "toothNumber"
        ],
        properties: {
          description: { type: ["string", "null"] },
          serviceDate: { type: ["string", "null"] },
          quantity: { type: ["number", "null"] },
          unitPrice: { type: ["number", "null"] },
          billedAmount: { type: ["number", "null"] },
          currency: { type: ["string", "null"] },
          diagnosisText: { type: ["string", "null"] },
          diagnosisCode: { type: ["string", "null"] },
          procedureCode: { type: ["string", "null"] },
          sbsCode: { type: ["string", "null"] },
          sbsDescription: { type: ["string", "null"] },
          toothNumber: { type: ["string", "null"] }
        }
      }
    },
    diagnoses: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["description", "code", "codingSystem"],
        properties: {
          description: { type: ["string", "null"] },
          code: { type: ["string", "null"] },
          codingSystem: { type: ["string", "null"] }
        }
      }
    },
    procedures: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["description", "code", "codingSystem"],
        properties: {
          description: { type: ["string", "null"] },
          code: { type: ["string", "null"] },
          codingSystem: { type: ["string", "null"] }
        }
      }
    },
    opticalFrameAmount: { type: ["number", "null"] },
    opticalLensAmount: { type: ["number", "null"] }
  }
} as const;

const DATE_EVIDENCE_SCHEMA = {
  type: "array",
  maxItems: 20,
  items: {
    type: "object",
    additionalProperties: false,
    required: ["field", "serviceLineIndex", "rawText", "day", "month", "year", "precision", "normalizedDate"],
    properties: {
      field: { type: "string", enum: ["invoiceDate", "serviceDate", "admissionDate", "dischargeDate"] },
      serviceLineIndex: { type: ["integer", "null"], minimum: 0 },
      rawText: { type: "string", maxLength: 100 },
      day: { type: ["integer", "null"], minimum: 1, maximum: 31 },
      month: { type: ["integer", "null"], minimum: 1, maximum: 12 },
      year: { type: ["integer", "null"], minimum: 1, maximum: 9999 },
      precision: { type: "string", enum: ["complete", "month_year", "year", "day_month", "day_year", "ambiguous", "invalid"] },
      normalizedDate: { type: ["string", "null"] }
    }
  }
} as const;

const EVIDENCE_UNIT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [
    "pageStart", "pageEnd", "readability", "relevance", "documentType",
    "detectedCategories", "detectedOpticalItems", "summary", "extracted",
    "dateEvidence", "missingOrUnclear"
  ],
  properties: {
    pageStart: { type: ["integer", "null"], minimum: 1 },
    pageEnd: { type: ["integer", "null"], minimum: 1 },
    readability: { type: "string", enum: ["readable", "unreadable", "unclear"] },
    relevance: { type: "string", enum: ["relevant", "irrelevant", "unclear"] },
    documentType: { type: "string", enum: DOCUMENT_TYPES },
    detectedCategories: DETECTED_CATEGORIES_SCHEMA,
    detectedOpticalItems: DETECTED_OPTICAL_ITEMS_SCHEMA,
    summary: { type: "string", maxLength: 500 },
    extracted: EXTRACTED_FIELDS_SCHEMA,
    dateEvidence: DATE_EVIDENCE_SCHEMA,
    missingOrUnclear: {
      type: "array",
      maxItems: 20,
      items: { type: "string", maxLength: 240 }
    }
  }
} as const;

export const RESPONSE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [
    "readability",
    "relevance",
    "documentType",
    "detectedCategories",
    "detectedOpticalItems",
    "summary",
    "extracted",
    "missingOrUnclear",
    "evidenceUnits"
  ],
  properties: {
    readability: { type: "string", enum: ["readable", "unreadable", "unclear"] },
    relevance: { type: "string", enum: ["relevant", "irrelevant", "unclear"] },
    documentType: { type: "string", enum: DOCUMENT_TYPES },
    detectedCategories: DETECTED_CATEGORIES_SCHEMA,
    detectedOpticalItems: DETECTED_OPTICAL_ITEMS_SCHEMA,
    summary: { type: "string", maxLength: 500 },
    extracted: EXTRACTED_FIELDS_SCHEMA,
    missingOrUnclear: {
      type: "array",
      maxItems: 20,
      items: { type: "string", maxLength: 240 }
    },
    evidenceUnits: {
      type: "array",
      minItems: 1,
      maxItems: 50,
      items: EVIDENCE_UNIT_SCHEMA
    }
  }
} as const;

interface OpenAiAnalysisPayload {
  readability: "readable" | "unreadable" | "unclear";
  relevance: "relevant" | "irrelevant" | "unclear";
  documentType: DocumentType;
  detectedCategories: ClaimCategory[];
  detectedOpticalItems: ("frames" | "lenses")[];
  summary: string;
  extracted: ExtractedDocumentFields;
  missingOrUnclear: string[];
  evidenceUnits?: ProviderEvidenceUnit[];
}

type OpenAiClient = Pick<OpenAI, "responses">;
export type OpenAiClientFactory = (
  options: ConstructorParameters<typeof OpenAI>[0]
) => OpenAiClient;
export const OPENAI_CLIENT_FACTORY = Symbol("OPENAI_CLIENT_FACTORY");

const DEFAULT_OPENAI_TIMEOUT_MS = 60_000;
const DEFAULT_OPENAI_MAX_RETRIES = 2;

@Injectable()
export class OpenAiDocumentIntelligenceProvider implements DocumentIntelligenceProvider {
  private readonly logger = new Logger(OpenAiDocumentIntelligenceProvider.name);

  constructor(
    private readonly config: ConfigService,
    @Inject(OPENAI_CLIENT_FACTORY)
    private readonly createClient: OpenAiClientFactory
  ) {}

  async analyse(input: DocumentAnalysisInput) {
    const apiKey = this.config.get<string>("OPENAI_API_KEY");
    const model = this.config.get<string>("OPENAI_MODEL");
    if (!apiKey || !model) {
      throw new ServiceUnavailableException(
        "Document analysis is not configured. Add OPENAI_API_KEY and OPENAI_MODEL to the backend environment."
      );
    }

    const documentContent = input.mimeType === "application/pdf"
      ? {
          type: "input_file",
          filename: input.originalFilename,
          file_data: `data:${input.mimeType};base64,${input.bytes.toString("base64")}`
        }
      : {
          type: "input_image",
          image_url: `data:${input.mimeType};base64,${input.bytes.toString("base64")}`,
          detail: "high"
        };

    const timeout = this.integerSetting(
      "OPENAI_TIMEOUT_MS",
      DEFAULT_OPENAI_TIMEOUT_MS,
      1_000,
      300_000
    );
    const maxRetries = this.integerSetting(
      "OPENAI_MAX_RETRIES",
      DEFAULT_OPENAI_MAX_RETRIES,
      0,
      5
    );

    try {
      const client = this.createClient({ apiKey, timeout, maxRetries });
      const response = await client.responses.create({
        model,
        store: false,
        input: [{
          role: "user",
          content: [
            {
              type: "input_text",
              text: this.instructions(input)
            },
            documentContent
          ]
        }],
        text: {
          format: {
            type: "json_schema",
            name: "claim_document_analysis",
            strict: true,
            schema: RESPONSE_SCHEMA
          }
        }
      } as Parameters<OpenAiClient["responses"]["create"]>[0]);

      if (!("output_text" in response) || typeof response.output_text !== "string" || !response.output_text) {
        throw new Error("The model returned no structured result.");
      }

      const result = JSON.parse(response.output_text) as OpenAiAnalysisPayload;
      const evidenceUnits = this.normaliseEvidenceUnits(input.attachmentId, result);
      const legacySummary = selectLegacySummaryUnit(evidenceUnits);
      return {
        analysisStatus: "complete" as const,
        schemaVersion: DOCUMENT_ANALYSIS_SCHEMA_VERSION,
        extractionVersion: DOCUMENT_EXTRACTION_VERSION,
        provider: "openai",
        model,
        analysedAt: new Date().toISOString(),
        readability: legacySummary?.readability ?? result.readability,
        relevance: legacySummary?.relevance ?? result.relevance,
        documentType: legacySummary?.documentType ?? "other",
        detectedCategories: legacySummary?.detectedCategories ?? [
          ...new Set(evidenceUnits.flatMap((unit) => unit.detectedCategories))
        ],
        detectedOpticalItems: legacySummary?.detectedOpticalItems ?? [
          ...new Set(evidenceUnits.flatMap((unit) => unit.detectedOpticalItems))
        ],
        summary: legacySummary?.summary ?? result.summary,
        extracted: legacySummary?.extracted ?? blankExtractedFields(),
        missingOrUnclear: legacySummary?.missingOrUnclear ?? result.missingOrUnclear,
        evidenceUnits
      };
    } catch (error) {
      const reason = error instanceof Error ? error.message : "Unknown OpenAI error";
      this.logger.error(
        `OpenAI document analysis failed for ${input.attachmentId}: ${reason}`
      );
      throw new ServiceUnavailableException(
        "We could not read this document. Try again after checking the file and analysis connection."
      );
    }
  }

  private integerSetting(
    key: string,
    fallback: number,
    minimum: number,
    maximum: number
  ) {
    const configured = Number(this.config.get<string>(key));
    if (!Number.isInteger(configured)) return fallback;
    return Math.min(maximum, Math.max(minimum, configured));
  }

  private instructions(_input: DocumentAnalysisInput) {
    return `Analyse this one synthetic reimbursement attachment independently. Inspect every visible page and return one or more logical evidence units.

For every evidence unit, use 1-based page numbers. pageStart must be less than or equal to pageEnd. Never invent a page number; use null for both page fields when page metadata cannot be established. Determine roles from visible page content, never from the filename or page position. Combine consecutive pages only when they belong to the same logical evidence item. The same role may occur more than once and must remain separate when it represents separate evidence. Avoid unnecessary overlapping ranges, but do not force genuinely distinct evidence on the same page into one role. Do not force every page into a known role: use other for clearly visible uncategorized content and unknown when the role itself is unclear. Return evidenceUnits in page order, without assuming that order implies role.

Extract each evidence unit independently. Never copy a value, code, diagnosis, amount, or payment signal from one unit into another unit. Keep each unit summary short and keep missingOrUnclear specific. The legacy top-level fields are a compatibility summary; repeat the first actual invoice unit there when one exists, otherwise repeat the single/common role when unambiguous, and use other with empty extracted fields for mixed non-invoice roles.

Keep date meanings separate. invoiceDate is only the invoice issue date. serviceDate is only a clearly identified date when healthcare treatment or a billed service was delivered. Never copy a report issue date, result date, prescription date, payment date, or document creation date into serviceDate.

For every printed invoiceDate, serviceDate, admissionDate, dischargeDate, or service-line serviceDate, preserve the exact printed text in dateEvidence. Use serviceLineIndex (zero-based) only for a date owned by that service line; otherwise use null. Record only components that are visibly printed. Never insert a missing day, month, or year. Set precision to complete only for a valid, unambiguous calendar date and then provide normalizedDate in YYYY-MM-DD. Use month_year, year, day_month, or day_year when components are missing; ambiguous when numeric ordering cannot be determined; and invalid for an impossible or malformed printed date. For incomplete, ambiguous, or invalid evidence, keep the matching normalized extracted date field null.

Judge readability and relevance independently and only from visible evidence. Readability means whether enough content is visible to inspect and extract; relevance means whether there is enough evidence that the upload belongs to a medical reimbursement claim. A clearly visible unrelated document, screenshot, object, person, or other unrelated image is readable but irrelevant. A recognisable invoice, receipt, or supporting medical document whose necessary content is blurred, cropped, dark, obstructed, or illegible is relevant but unreadable. If degradation makes the upload impossible to identify, set readability to unreadable and relevance to unclear; never guess that an unidentifiable upload is irrelevant. Mark relevance irrelevant whenever the upload is confidently unrelated, even if small text within it cannot be read.

Classify document type and category signals only from evidence visible in the document. Extract only information visibly present. Never infer or invent patient names, dates, codes, providers, amounts, payment status, payment method, card network, or category. Use ISO dates (YYYY-MM-DD) only when the date is unambiguous. For invoices, billedAmount is the final total; extract subtotal, taxAmount, and discountAmount separately only when each value is explicitly shown. Record discounts as positive amounts. A payment receipt is not an itemized invoice. If an itemized invoice clearly says paid, paymentStatus may be paid. Set paymentMethod only when printed or otherwise clearly evidenced: cash, card, bank_transfer, digital_wallet, cheque, or other; otherwise use unknown. Set cardNetwork only for a visible card network such as mada, visa, mastercard, or amex. Never infer credit or debit, and if cardNetwork is set, paymentMethod must be card. For Optical, frames and lenses may appear separately or together. Include each visibly evidenced component in detectedOpticalItems, and extract opticalFrameAmount and opticalLensAmount independently only when each amount is visibly itemized.

Keep billing and clinical evidence separate. For an invoice or payment receipt, put every billed service and any code printed beside it only in serviceLines; leave diagnoses and procedures empty. For a medical report, discharge summary, prescription, eye test, laboratory result, imaging result, or dental X-ray, put explicitly documented diagnoses and clinical procedures in diagnoses and procedures; do not turn them into billed serviceLines. Preserve every code exactly as printed. Set codingSystem only when the document explicitly labels it, for example ICD-10-AM; otherwise use null. Never derive a code from descriptive text. Set sbsCode on a billed service line only when the document explicitly prints or labels that exact code as SBS. Set sbsDescription only when an SBS description is explicitly printed with that line. Never infer SBS from a service description, diagnosis, CPT/procedure code, or model knowledge.

A generic invoice or report should not be assigned a category without clear category evidence. Keep missingOrUnclear short and specific.`;
  }

  private normaliseEvidenceUnits(
    attachmentId: string,
    result: OpenAiAnalysisPayload
  ) {
    const provided = Array.isArray(result.evidenceUnits) && result.evidenceUnits.length > 0
      ? result.evidenceUnits
      : [{
          pageStart: null,
          pageEnd: null,
          readability: result.readability,
          relevance: result.relevance,
          documentType: result.documentType,
          detectedCategories: result.detectedCategories,
          detectedOpticalItems: result.detectedOpticalItems,
          summary: result.summary,
          extracted: result.extracted,
          dateEvidence: [],
          missingOrUnclear: result.missingOrUnclear
        }];
    if (provided.some((unit) =>
      unit.dateEvidence !== undefined &&
      (!Array.isArray(unit.dateEvidence) || !unit.dateEvidence.every(isValidDateEvidence))
    )) {
      throw new Error("The model returned inconsistent date evidence.");
    }
    return createEvidenceUnits(
      attachmentId,
      provided.map((unit) => ({
        ...unit,
        dateEvidence: unit.dateEvidence ?? [],
        extracted: this.normaliseFields(unit.extracted)
      }))
    );
  }

  private normaliseFields(fields: ExtractedDocumentFields | undefined): ExtractedDocumentFields {
    return {
      ...blankExtractedFields(),
      ...fields,
      serviceLines: (fields?.serviceLines ?? []).map((line) => this.normaliseServiceLine(line)),
      diagnoses: (fields?.diagnoses ?? []).map((item) => this.normaliseDiagnosis(item)),
      procedures: (fields?.procedures ?? []).map((item) => this.normaliseProcedure(item))
    };
  }

  private normaliseServiceLine(line: ExtractedServiceLine): ExtractedServiceLine {
    return {
      description: line.description ?? null,
      serviceDate: line.serviceDate ?? null,
      quantity: line.quantity ?? null,
      unitPrice: line.unitPrice ?? null,
      billedAmount: line.billedAmount ?? null,
      currency: line.currency ?? null,
      diagnosisText: line.diagnosisText ?? null,
      diagnosisCode: line.diagnosisCode ?? null,
      procedureCode: line.procedureCode ?? null,
      sbsCode: line.sbsCode ?? null,
      sbsDescription: line.sbsDescription ?? null,
      toothNumber: line.toothNumber ?? null
    };
  }

  private normaliseDiagnosis(item: ExtractedDiagnosis): ExtractedDiagnosis {
    return {
      description: item.description ?? null,
      code: item.code ?? null,
      codingSystem: item.codingSystem ?? null
    };
  }

  private normaliseProcedure(item: ExtractedProcedure): ExtractedProcedure {
    return {
      description: item.description ?? null,
      code: item.code ?? null,
      codingSystem: item.codingSystem ?? null
    };
  }
}
