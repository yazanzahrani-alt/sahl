import { ServiceUnavailableException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import OpenAI from "openai";
import {
  blankExtractedFields,
  type DocumentType,
  type ExtractedDocumentFields,
  type ProviderEvidenceUnit
} from "./document-analysis";
import {
  OpenAiClientFactory,
  OpenAiDocumentIntelligenceProvider
} from "./openai-document-intelligence.provider";

const input = {
  attachmentId: "ATT-TEST",
  originalFilename: "invoice.pdf",
  mimeType: "application/pdf",
  bytes: Buffer.from("%PDF-test")
};

function invoiceFields(): ExtractedDocumentFields {
  return {
    ...blankExtractedFields(),
    providerName: "Test Clinic",
    billedAmount: 125,
    serviceLines: [{
      description: "Printed service",
      serviceDate: "2026-08-01",
      quantity: 1,
      unitPrice: 125,
      billedAmount: 125,
      currency: "SAR",
      diagnosisText: null,
      diagnosisCode: null,
      procedureCode: null,
      sbsCode: "SBS-123",
      sbsDescription: "Printed SBS service",
      toothNumber: null
    }]
  };
}

function evidenceUnit(
  documentType: DocumentType,
  pageStart: number | null,
  pageEnd: number | null,
  extracted: ExtractedDocumentFields = blankExtractedFields()
): ProviderEvidenceUnit {
  return {
    pageStart,
    pageEnd,
    readability: "readable",
    relevance: "relevant",
    documentType,
    detectedCategories: [],
    detectedOpticalItems: [],
    summary: `${documentType} evidence`,
    extracted,
    missingOrUnclear: []
  };
}

function structuredOutput(
  evidenceUnits: ProviderEvidenceUnit[] = [
    evidenceUnit("invoice", 1, 1, invoiceFields())
  ]
) {
  return JSON.stringify({
    readability: "readable",
    relevance: "relevant",
    documentType: "invoice",
    detectedCategories: ["dental"],
    detectedOpticalItems: [],
    summary: "Readable invoice",
    extracted: invoiceFields(),
    missingOrUnclear: [],
    evidenceUnits
  });
}

function providerWith(
  create: jest.Mock,
  settings: Record<string, string> = {}
) {
  const factory = jest.fn(() => ({ responses: { create } })) as unknown as OpenAiClientFactory;
  const config = new ConfigService({
    OPENAI_API_KEY: "test-key",
    OPENAI_MODEL: "gpt-test",
    ...settings
  });
  return {
    provider: new OpenAiDocumentIntelligenceProvider(config, factory),
    factory
  };
}

describe("OpenAiDocumentIntelligenceProvider", () => {
  it("parses a successful SDK Responses result", async () => {
    const create = jest.fn().mockResolvedValue({ output_text: structuredOutput() });
    const { provider } = providerWith(create);

    const result = await provider.analyse(input);

    expect(result.analysisStatus).toBe("complete");
    expect(result.provider).toBe("openai");
    expect(result.model).toBe("gpt-test");
    expect(result.extracted.providerName).toBe("Test Clinic");
    expect(result.extracted.billedAmount).toBe(125);
    expect(result.extracted.serviceLines[0]).toMatchObject({
      sbsCode: "SBS-123",
      sbsDescription: "Printed SBS service"
    });
    expect(create).toHaveBeenCalledWith(expect.objectContaining({
      model: "gpt-test",
      store: false,
      text: expect.objectContaining({
        format: expect.objectContaining({
          schema: expect.objectContaining({
            required: expect.arrayContaining(["evidenceUnits"])
          })
        })
      })
    }));
    expect(JSON.stringify(create.mock.calls[0]?.[0])).toContain("1-based page numbers");
    expect(result.evidenceUnits).toHaveLength(1);
    const request = create.mock.calls[0]?.[0] as { text?: { format?: { schema?: unknown } } };
    expect(request.text?.format?.schema).toMatchObject({
      properties: {
        evidenceUnits: {
          items: {
            required: expect.arrayContaining(["dateEvidence"])
          }
        }
      }
    });
    expect(result.evidenceUnits?.[0]).toMatchObject({
      attachmentId: "ATT-TEST",
      pageStart: 1,
      pageEnd: 1,
      documentType: "invoice",
      pageProvenance: "provider_page_range"
    });
  });

  it("preserves printed partial date evidence without manufacturing a normalized date", async () => {
    const fields = { ...invoiceFields(), invoiceDate: null };
    const unit = evidenceUnit("invoice", 1, 1, fields);
    unit.dateEvidence = [{
      field: "invoiceDate",
      rawText: "August 2026",
      day: null,
      month: 8,
      year: 2026,
      precision: "month_year",
      normalizedDate: null
    }];
    const create = jest.fn().mockResolvedValue({ output_text: structuredOutput([unit]) });
    const { provider } = providerWith(create);

    const result = await provider.analyse(input);

    expect(result.evidenceUnits?.[0]?.extracted.invoiceDate).toBeNull();
    expect(result.evidenceUnits?.[0]?.dateEvidence?.[0]).toMatchObject({
      rawText: "August 2026",
      day: null,
      month: 8,
      year: 2026,
      precision: "month_year",
      normalizedDate: null
    });
  });

  it("fails safely when the provider labels an impossible date as complete", async () => {
    const unit = evidenceUnit("invoice", 1, 1, { ...invoiceFields(), invoiceDate: null });
    unit.dateEvidence = [{
      field: "invoiceDate",
      rawText: "31 February 2026",
      day: 31,
      month: 2,
      year: 2026,
      precision: "complete",
      normalizedDate: "2026-02-31"
    }];
    const create = jest.fn().mockResolvedValue({ output_text: structuredOutput([unit]) });

    await expect(providerWith(create).provider.analyse(input)).rejects.toMatchObject({
      message: "We could not read this document. Try again after checking the file and analysis connection."
    });
  });

  it("keeps a multi-page invoice as one ranged evidence unit", async () => {
    const create = jest.fn().mockResolvedValue({
      output_text: structuredOutput([evidenceUnit("invoice", 1, 2, invoiceFields())])
    });

    const result = await providerWith(create).provider.analyse(input);

    expect(result.evidenceUnits).toHaveLength(1);
    expect(result.evidenceUnits?.[0]).toMatchObject({
      documentType: "invoice",
      pageStart: 1,
      pageEnd: 2
    });
  });

  it("represents invoice and medical report as separate role-specific units", async () => {
    const reportFields = {
      ...blankExtractedFields(),
      diagnoses: [{ description: "Printed diagnosis", code: null, codingSystem: null }]
    };
    const create = jest.fn().mockResolvedValue({
      output_text: structuredOutput([
        evidenceUnit("invoice", 1, 1, invoiceFields()),
        evidenceUnit("medical_report", 2, 2, reportFields)
      ])
    });

    const result = await providerWith(create).provider.analyse(input);

    expect(result.evidenceUnits?.map((unit) => unit.documentType))
      .toEqual(["invoice", "medical_report"]);
    expect(result.extracted.diagnoses).toEqual([]);
    expect(result.evidenceUnits?.[1]?.extracted.diagnoses)
      .toEqual(reportFields.diagnoses);
  });

  it("represents invoice, report, and receipt as three independent units", async () => {
    const create = jest.fn().mockResolvedValue({
      output_text: structuredOutput([
        evidenceUnit("invoice", 1, 1, invoiceFields()),
        evidenceUnit("medical_report", 2, 2),
        evidenceUnit("payment_receipt", 3, 3)
      ])
    });

    const result = await providerWith(create).provider.analyse(input);

    expect(result.evidenceUnits?.map((unit) => unit.documentType))
      .toEqual(["invoice", "medical_report", "payment_receipt"]);
    expect(new Set(result.evidenceUnits?.map((unit) => unit.evidenceUnitId)).size).toBe(3);
  });

  it("allows the same role to appear more than once with distinct identities", async () => {
    const create = jest.fn().mockResolvedValue({
      output_text: structuredOutput([
        evidenceUnit("invoice", 1, 1, invoiceFields()),
        evidenceUnit("invoice", 3, 3, { ...invoiceFields(), invoiceReference: "INV-2" })
      ])
    });

    const result = await providerWith(create).provider.analyse(input);

    expect(result.evidenceUnits?.map((unit) => unit.documentType))
      .toEqual(["invoice", "invoice"]);
    expect(result.evidenceUnits?.[0]?.evidenceUnitId)
      .not.toBe(result.evidenceUnits?.[1]?.evidenceUnitId);
  });

  it("preserves unknown content without fabricating a known role", async () => {
    const create = jest.fn().mockResolvedValue({
      output_text: structuredOutput([evidenceUnit("unknown", 1, 1)])
    });

    const result = await providerWith(create).provider.analyse(input);

    expect(result.documentType).toBe("unknown");
    expect(result.evidenceUnits?.[0]?.documentType).toBe("unknown");
  });

  it("uses other with empty legacy extraction for mixed non-invoice roles", async () => {
    const create = jest.fn().mockResolvedValue({
      output_text: structuredOutput([
        evidenceUnit("medical_report", 1, 1, {
          ...blankExtractedFields(),
          diagnoses: [{ description: "Printed diagnosis", code: null, codingSystem: null }]
        }),
        evidenceUnit("payment_receipt", 2, 2, {
          ...blankExtractedFields(),
          billedAmount: 125
        })
      ])
    });

    const result = await providerWith(create).provider.analyse(input);

    expect(result.documentType).toBe("other");
    expect(result.extracted).toEqual(blankExtractedFields());
    expect(result.evidenceUnits).toHaveLength(2);
  });

  it("normalizes missing or invalid provider page ranges to attachment-level provenance", async () => {
    const missingRange = evidenceUnit("invoice", 1, 1, invoiceFields());
    delete missingRange.pageStart;
    delete missingRange.pageEnd;
    const invalidRange = evidenceUnit("medical_report", 4, 2);
    const create = jest.fn().mockResolvedValue({
      output_text: structuredOutput([missingRange, invalidRange])
    });

    const result = await providerWith(create).provider.analyse(input);

    expect(result.evidenceUnits).toHaveLength(2);
    for (const unit of result.evidenceUnits ?? []) {
      expect(unit).toMatchObject({
        pageStart: null,
        pageEnd: null,
        pageProvenance: "provider_attachment_level"
      });
    }
  });

  it("passes an explicit bounded timeout to the SDK and fails safely on timeout", async () => {
    const create = jest.fn().mockRejectedValue(new Error("Request timed out after 1500ms"));
    const { provider, factory } = providerWith(create, {
      OPENAI_TIMEOUT_MS: "1500"
    });

    await expect(provider.analyse(input)).rejects.toEqual(
      expect.objectContaining({
        constructor: ServiceUnavailableException,
        message: "We could not read this document. Try again after checking the file and analysis connection."
      })
    );
    expect(factory).toHaveBeenCalledWith(expect.objectContaining({ timeout: 1500 }));
  });

  it("lets the SDK retry a transient failure and then succeeds", async () => {
    const fetchMock = jest.fn()
      .mockResolvedValueOnce(new Response(
        JSON.stringify({ error: { message: "try again", type: "server_error" } }),
        { status: 500, headers: { "retry-after-ms": "0" } }
      ))
      .mockResolvedValueOnce(new Response(
        JSON.stringify({ output_text: structuredOutput() }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      ));
    const factory = ((options: ConstructorParameters<typeof OpenAI>[0]) =>
      new OpenAI({ ...options, fetch: fetchMock as typeof fetch })) as OpenAiClientFactory;
    const provider = new OpenAiDocumentIntelligenceProvider(
      new ConfigService({
        OPENAI_API_KEY: "test-key",
        OPENAI_MODEL: "gpt-test",
        OPENAI_MAX_RETRIES: "1"
      }),
      factory
    );

    const result = await provider.analyse(input);

    expect(result.analysisStatus).toBe("complete");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("does not expose malformed extraction details to the member", async () => {
    const create = jest.fn().mockResolvedValue({ output_text: "not-json" });
    const { provider } = providerWith(create);

    await expect(provider.analyse(input)).rejects.toMatchObject({
      message: "We could not read this document. Try again after checking the file and analysis connection."
    });
  });
});
