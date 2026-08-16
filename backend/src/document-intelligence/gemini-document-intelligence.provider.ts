import { Injectable, ServiceUnavailableException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { ClaimCategory } from "../claims/claim";
import {
  DOCUMENT_ANALYSIS_SCHEMA_VERSION,
  DOCUMENT_EXTRACTION_VERSION,
  DocumentAnalysisInput,
  DocumentIntelligenceProvider,
  DocumentType,
  ExtractedDocumentFields,
  ProviderEvidenceUnit,
  blankExtractedFields,
  createEvidenceUnits,
  selectLegacySummaryUnit
} from "./document-analysis";
import { RESPONSE_SCHEMA } from "./openai-document-intelligence.provider";
import { isValidDateEvidence } from "./date-evidence";

interface GeminiResponse {
  candidates?: Array<{
    content?: { parts?: Array<{ text?: string }> };
  }>;
}

@Injectable()
export class GeminiDocumentIntelligenceProvider implements DocumentIntelligenceProvider {
  constructor(private readonly config: ConfigService) {}

  async analyse(input: DocumentAnalysisInput) {
    const apiKey = this.config.get<string>("GEMINI_API_KEY");
    const model = this.config.get<string>("GEMINI_MODEL");
    if (!apiKey || !model) {
      throw new ServiceUnavailableException(
        "Document analysis is not configured. Add GEMINI_API_KEY and GEMINI_MODEL to the backend environment."
      );
    }

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
      {
        method: "POST",
        headers: {
          "x-goog-api-key": apiKey,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: this.instructions(input) }] },
          contents: [{
            role: "user",
            parts: [{
              inlineData: {
                mimeType: input.mimeType,
                data: input.bytes.toString("base64")
              }
            }]
          }],
          generationConfig: {
            responseMimeType: "application/json",
            responseJsonSchema: RESPONSE_SCHEMA
          }
        })
      }
    );

    if (!response.ok) {
      const detail = await response.text();
      throw new ServiceUnavailableException(
        `Document analysis provider could not analyse this file (${response.status}). ${detail.slice(0, 240)}`
      );
    }

    const body = (await response.json()) as GeminiResponse;
    const text = body.candidates?.[0]?.content?.parts?.map((part) => part.text ?? "").join("");
    if (!text) {
      throw new ServiceUnavailableException(
        "Document analysis provider returned no structured result."
      );
    }

    const result = JSON.parse(text) as {
      readability: "readable" | "unreadable" | "unclear";
      relevance: "relevant" | "irrelevant" | "unclear";
      documentType: DocumentType;
      detectedCategories: ClaimCategory[];
      detectedOpticalItems: ("frames" | "lenses")[];
      summary: string;
      extracted: ExtractedDocumentFields;
      missingOrUnclear: string[];
      evidenceUnits?: ProviderEvidenceUnit[];
    };

    const evidenceUnits = this.normaliseEvidenceUnits(input.attachmentId, result);
    const legacySummary = selectLegacySummaryUnit(evidenceUnits);

    return {
      analysisStatus: "complete" as const,
      schemaVersion: DOCUMENT_ANALYSIS_SCHEMA_VERSION,
      extractionVersion: DOCUMENT_EXTRACTION_VERSION,
      provider: "gemini",
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
    result: {
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

  private normaliseFields(fields: ExtractedDocumentFields | undefined) {
    return {
      ...blankExtractedFields(),
      ...fields,
      serviceLines: (fields?.serviceLines ?? []).map((line) => ({
        ...line,
        sbsCode: line.sbsCode ?? null,
        sbsDescription: line.sbsDescription ?? null
      })),
      diagnoses: fields?.diagnoses ?? [],
      procedures: fields?.procedures ?? []
    };
  }
}
