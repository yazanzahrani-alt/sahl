import { ConfigService } from "@nestjs/config";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ClaimRecord } from "../claims/claim";
import type { StoredAttachment } from "../claims/attachment";
import type { DocumentsService } from "../claims/documents.service";
import type { DatabaseService } from "../database/database.service";
import {
  DOCUMENT_ANALYSIS_SCHEMA_VERSION,
  DOCUMENT_EXTRACTION_VERSION,
  DocumentAnalysisResult,
  blankExtractedFields,
  createEvidenceUnits
} from "./document-analysis";
import { DocumentIntelligenceService } from "./document-intelligence.service";
import type { GeminiDocumentIntelligenceProvider } from "./gemini-document-intelligence.provider";
import type { OpenAiDocumentIntelligenceProvider } from "./openai-document-intelligence.provider";

const claim: ClaimRecord = {
  claimId: "CLM-TEST",
  memberId: "00123456",
  category: "dental",
  opticalItem: null,
  claimLocation: "local",
  status: "draft",
  createdAt: new Date(),
  updatedAt: new Date()
};

function completeResult(overrides: Partial<DocumentAnalysisResult> = {}): DocumentAnalysisResult {
  return {
    attachmentId: "ATT-TEST",
    schemaVersion: DOCUMENT_ANALYSIS_SCHEMA_VERSION,
    extractionVersion: DOCUMENT_EXTRACTION_VERSION,
    analysisStatus: "complete",
    provider: "openai",
    model: "gpt-test",
    analysedAt: new Date().toISOString(),
    readability: "readable",
    relevance: "relevant",
    documentType: "invoice",
    detectedCategories: ["dental"],
    detectedOpticalItems: [],
    summary: "Invoice",
    extracted: blankExtractedFields(),
    missingOrUnclear: [],
    evidenceUnits: createEvidenceUnits("ATT-TEST", [{
      pageStart: 1,
      pageEnd: 1,
      readability: "readable",
      relevance: "relevant",
      documentType: "invoice",
      detectedCategories: ["dental"],
      detectedOpticalItems: [],
      summary: "Invoice",
      extracted: blankExtractedFields(),
      missingOrUnclear: []
    }]),
    ...overrides
  };
}

describe("DocumentIntelligenceService", () => {
  let directory: string;
  let path: string;
  let attachment: StoredAttachment;
  let database: { run: jest.Mock; transaction: jest.Mock };
  let documents: { list: jest.Mock; findForDownload: jest.Mock };
  let openAi: { analyse: jest.Mock };

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), "sahl-analysis-"));
    path = join(directory, "document.pdf");
    writeFileSync(path, "%PDF-test");
    attachment = {
      attachmentId: "ATT-TEST",
      originalFilename: "document.pdf",
      storedFilename: "document.pdf",
      mimeType: "application/pdf",
      sizeBytes: 9,
      documentType: null,
      createdAt: new Date(),
      analysis: null
    };
    database = {
      run: jest.fn(),
      transaction: jest.fn((operation: () => unknown) => operation())
    };
    documents = {
      list: jest.fn(() => [attachment]),
      findForDownload: jest.fn(() => ({ attachment, path }))
    };
    openAi = { analyse: jest.fn() };
  });

  afterEach(() => rmSync(directory, { recursive: true, force: true }));

  function service() {
    return new DocumentIntelligenceService(
      database as unknown as DatabaseService,
      documents as unknown as DocumentsService,
      new ConfigService({
        DOCUMENT_INTELLIGENCE_PROVIDER: "openai",
        OPENAI_MODEL: "gpt-test"
      }),
      openAi as unknown as OpenAiDocumentIntelligenceProvider,
      { analyse: jest.fn() } as unknown as GeminiDocumentIntelligenceProvider
    );
  }

  it("coalesces concurrent duplicate claim processing into one extraction/result", async () => {
    let resolveAnalysis!: (value: Omit<DocumentAnalysisResult, "attachmentId">) => void;
    openAi.analyse.mockReturnValue(new Promise((resolve) => {
      resolveAnalysis = resolve;
    }));
    const intelligence = service();

    const first = intelligence.analyseAll("00123456", claim);
    const second = intelligence.analyseAll("00123456", claim);
    expect(openAi.analyse).toHaveBeenCalledTimes(1);

    const { attachmentId: _attachmentId, ...analysed } = completeResult();
    resolveAnalysis(analysed);
    const [firstResults, secondResults] = await Promise.all([first, second]);

    expect(firstResults).toEqual(secondResults);
    expect(openAi.analyse).toHaveBeenCalledTimes(1);
    expect(database.run.mock.calls.filter(([sql]) =>
      String(sql).includes("INSERT INTO extraction_results")
    )).toHaveLength(1);
  });

  it("reuses a valid cached extraction across service reloads without invoking AI", async () => {
    attachment.analysis = completeResult();

    const first = await service().analyseAll("00123456", claim);
    const results = await service().analyseAll("00123456", claim);

    expect(first).toEqual([attachment.analysis]);
    expect(results).toEqual([attachment.analysis]);
    expect(results[0].evidenceUnits).toHaveLength(1);
    expect(openAi.analyse).not.toHaveBeenCalled();
    expect(database.run).not.toHaveBeenCalled();
  });

  it("reuses a valid cached extraction after a claim-category correction", async () => {
    attachment.analysis = completeResult();
    const correctedClaim: ClaimRecord = {
      ...claim,
      category: "optical",
      opticalItem: "frames",
      updatedAt: new Date(claim.updatedAt.getTime() + 1000)
    };

    const results = await service().analyseAll("00123456", correctedClaim);

    expect(results).toEqual([attachment.analysis]);
    expect(openAi.analyse).not.toHaveBeenCalled();
    expect(database.run).not.toHaveBeenCalled();
  });

  it("preserves cached multi-role evidence across revisits without invoking AI", async () => {
    attachment.analysis = completeResult({
      evidenceUnits: createEvidenceUnits("ATT-TEST", [
        {
          pageStart: 1,
          pageEnd: 1,
          readability: "readable",
          relevance: "relevant",
          documentType: "invoice",
          detectedCategories: ["inpatient_surgery"],
          detectedOpticalItems: [],
          summary: "Invoice",
          extracted: blankExtractedFields(),
          missingOrUnclear: []
        },
        {
          pageStart: 2,
          pageEnd: 2,
          readability: "readable",
          relevance: "relevant",
          documentType: "medical_report",
          detectedCategories: ["inpatient_surgery"],
          detectedOpticalItems: [],
          summary: "Medical report",
          extracted: blankExtractedFields(),
          missingOrUnclear: []
        },
        {
          pageStart: 3,
          pageEnd: 3,
          readability: "readable",
          relevance: "relevant",
          documentType: "payment_receipt",
          detectedCategories: ["inpatient_surgery"],
          detectedOpticalItems: [],
          summary: "Payment receipt",
          extracted: blankExtractedFields(),
          missingOrUnclear: []
        }
      ])
    });

    const [result] = await service().analyseAll("00123456", claim);

    expect(result.evidenceUnits?.map((unit) => unit.documentType)).toEqual([
      "invoice",
      "medical_report",
      "payment_receipt"
    ]);
    expect(result.evidenceUnits?.map((unit) => unit.pageStart)).toEqual([1, 2, 3]);
    expect(openAi.analyse).not.toHaveBeenCalled();
  });

  it("reanalyzes when the extraction version is stale", async () => {
    attachment.analysis = completeResult({ extractionVersion: "old-prompt" });
    const { attachmentId: _attachmentId, ...analysed } = completeResult();
    openAi.analyse.mockResolvedValue(analysed);

    const results = await service().analyseAll("00123456", claim);

    expect(openAi.analyse).toHaveBeenCalledTimes(1);
    expect(results[0].extractionVersion).toBe(DOCUMENT_EXTRACTION_VERSION);
  });

  it("reanalyzes a current-version cache with invalid date evidence", async () => {
    const cached = completeResult();
    cached.evidenceUnits![0] = {
      ...cached.evidenceUnits![0]!,
      dateEvidence: [{
        field: "invoiceDate",
        rawText: "31 February 2026",
        day: 31,
        month: 2,
        year: 2026,
        precision: "complete",
        normalizedDate: "2026-02-31"
      }]
    };
    attachment.analysis = cached;
    const { attachmentId: _attachmentId, ...analysed } = completeResult();
    openAi.analyse.mockResolvedValue(analysed);

    const results = await service().analyseAll("00123456", claim);

    expect(openAi.analyse).toHaveBeenCalledTimes(1);
    expect(results[0].analysisStatus).toBe("complete");
  });

  it("reanalyzes when the analysis schema predates evidence units", async () => {
    attachment.analysis = completeResult({ schemaVersion: 2, evidenceUnits: undefined });
    const { attachmentId: _attachmentId, ...analysed } = completeResult();
    openAi.analyse.mockResolvedValue(analysed);

    const results = await service().analyseAll("00123456", claim);

    expect(openAi.analyse).toHaveBeenCalledTimes(1);
    expect(results[0].schemaVersion).toBe(DOCUMENT_ANALYSIS_SCHEMA_VERSION);
    expect(results[0].evidenceUnits).toHaveLength(1);
  });

  it("stores a member-safe failed result when extraction throws", async () => {
    openAi.analyse.mockRejectedValue(new Error("upstream secret detail"));

    const [result] = await service().analyseAll("00123456", claim);

    expect(result.analysisStatus).toBe("failed");
    expect(result.summary).toBe(
      "We could not analyse this document. Try again after checking the file and analysis connection."
    );
    expect(JSON.stringify(result)).not.toContain("upstream secret detail");
    expect(database.run.mock.calls.some(([sql, _id, json]) =>
      String(sql).includes("INSERT INTO extraction_results") &&
      String(json).includes('"analysisStatus":"failed"')
    )).toBe(true);
  });

  it("does not treat a failed cached extraction as current, so retry remains available", async () => {
    attachment.analysis = completeResult({ analysisStatus: "failed" });
    const { attachmentId: _attachmentId, ...analysed } = completeResult();
    openAi.analyse.mockResolvedValue(analysed);

    const [result] = await service().analyseAll("00123456", claim);

    expect(openAi.analyse).toHaveBeenCalledTimes(1);
    expect(result.analysisStatus).toBe("complete");
  });
});
