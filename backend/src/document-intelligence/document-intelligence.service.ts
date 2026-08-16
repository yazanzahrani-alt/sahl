import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { readFileSync } from "node:fs";
import { ClaimRecord } from "../claims/claim";
import { DocumentsService } from "../claims/documents.service";
import { DatabaseService } from "../database/database.service";
import {
  DocumentAnalysisResult,
  DocumentIntelligenceProvider,
  DOCUMENT_ANALYSIS_SCHEMA_VERSION,
  DOCUMENT_EXTRACTION_VERSION,
  blankExtractedFields,
  hasValidEvidenceUnits
} from "./document-analysis";
import { OpenAiDocumentIntelligenceProvider } from "./openai-document-intelligence.provider";
import { GeminiDocumentIntelligenceProvider } from "./gemini-document-intelligence.provider";

@Injectable()
export class DocumentIntelligenceService {
  private readonly inFlightClaims = new Map<
    string,
    Promise<DocumentAnalysisResult[]>
  >();

  constructor(
    private readonly database: DatabaseService,
    private readonly documents: DocumentsService,
    private readonly config: ConfigService,
    private readonly openAi: OpenAiDocumentIntelligenceProvider,
    private readonly gemini: GeminiDocumentIntelligenceProvider
  ) {}

  async analyseAll(memberId: string, claim: ClaimRecord) {
    const existing = this.inFlightClaims.get(claim.claimId);
    if (existing) return existing;

    const pending = this.analyseAllIndependently(memberId, claim);
    this.inFlightClaims.set(claim.claimId, pending);
    try {
      return await pending;
    } finally {
      if (this.inFlightClaims.get(claim.claimId) === pending) {
        this.inFlightClaims.delete(claim.claimId);
      }
    }
  }

  private async analyseAllIndependently(memberId: string, claim: ClaimRecord) {
    const attachments = this.documents.list(memberId, claim.claimId);
    const results: DocumentAnalysisResult[] = [];
    for (let index = 0; index < attachments.length; index += 2) {
      const batch = attachments.slice(index, index + 2);
      results.push(...await Promise.all(
        batch.map((attachment) => {
          if (this.isAnalysisCurrent(attachment.analysis)) {
            return attachment.analysis;
          }
          return this.analyseOne(memberId, claim, attachment.attachmentId);
        })
      ));
    }
    return results;
  }

  async analyseOne(memberId: string, claim: ClaimRecord, attachmentId: string) {
    const { attachment, path } = this.documents.findForDownload(
      memberId,
      claim.claimId,
      attachmentId
    );

    let result: DocumentAnalysisResult;
    try {
      const provider = this.provider();
      const analysed = await provider.analyse({
        attachmentId,
        originalFilename: attachment.originalFilename,
        mimeType: attachment.mimeType,
        bytes: readFileSync(path)
      });
      result = { attachmentId, ...analysed };
    } catch (error) {
      result = this.failedResult(attachmentId, error);
    }

    this.database.transaction(() => {
      this.database.run(
        `INSERT INTO extraction_results (attachment_id, result_json, created_at)
         VALUES (?, ?, ?)`,
        attachmentId,
        JSON.stringify(result),
        result.analysedAt
      );
      this.database.run(
        `UPDATE attachments SET document_type = ? WHERE attachment_id = ?`,
        result.analysisStatus === "complete" ? result.documentType : null,
        attachmentId
      );
    });

    return result;
  }

  private provider(): DocumentIntelligenceProvider {
    const provider = this.config.get<string>("DOCUMENT_INTELLIGENCE_PROVIDER", "openai");
    if (provider === "openai") return this.openAi;
    if (provider === "gemini") return this.gemini;
    throw new Error(
      `Document analysis provider "${provider}" is not supported. Set DOCUMENT_INTELLIGENCE_PROVIDER to openai or gemini.`
    );
  }

  isAnalysisCurrent(
    analysis: DocumentAnalysisResult | null
  ): analysis is DocumentAnalysisResult {
    if (!analysis || analysis.analysisStatus !== "complete") return false;
    const expected = this.expectedConfiguration();
    return analysis.schemaVersion === DOCUMENT_ANALYSIS_SCHEMA_VERSION &&
      analysis.extractionVersion === DOCUMENT_EXTRACTION_VERSION &&
      analysis.provider === expected.provider &&
      analysis.model === expected.model &&
      (analysis.evidenceUnits === undefined || hasValidEvidenceUnits(analysis));
  }

  private expectedConfiguration() {
    const provider = this.config.get<string>(
      "DOCUMENT_INTELLIGENCE_PROVIDER",
      "openai"
    );
    const modelKey = provider === "gemini" ? "GEMINI_MODEL" : "OPENAI_MODEL";
    return {
      provider,
      model: this.config.get<string>(modelKey) ?? null
    };
  }

  private failedResult(attachmentId: string, error: unknown): DocumentAnalysisResult {
    const message = error instanceof Error ? error.message : "Document analysis could not be completed.";
    const needsConfiguration = message.includes("not configured");
    const provider = this.config.get<string>("DOCUMENT_INTELLIGENCE_PROVIDER", "openai");
    return {
      attachmentId,
      schemaVersion: DOCUMENT_ANALYSIS_SCHEMA_VERSION,
      extractionVersion: DOCUMENT_EXTRACTION_VERSION,
      analysisStatus: needsConfiguration ? "needs_configuration" : "failed",
      provider,
      model: this.config.get<string>(provider === "gemini" ? "GEMINI_MODEL" : "OPENAI_MODEL") ?? null,
      analysedAt: new Date().toISOString(),
      readability: "unclear",
      relevance: "unclear",
      documentType: "unknown",
      detectedCategories: [],
      detectedOpticalItems: [],
      summary: needsConfiguration
        ? "Analysis is ready to use once the document-analysis provider is configured."
        : "We could not analyse this document. Try again after checking the file and analysis connection.",
      extracted: blankExtractedFields(),
      missingOrUnclear: [
        needsConfiguration
          ? "Document analysis is not configured."
          : "Document analysis did not complete."
      ]
    };
  }
}
