import { ConfigService } from "@nestjs/config";
import { blankExtractedFields } from "./document-analysis";
import { GeminiDocumentIntelligenceProvider } from "./gemini-document-intelligence.provider";

describe("GeminiDocumentIntelligenceProvider evidence-unit compatibility", () => {
  afterEach(() => jest.restoreAllMocks());

  it("returns the same evidence-unit contract while preserving an invoice summary", async () => {
    const payload = {
      readability: "readable",
      relevance: "relevant",
      documentType: "invoice",
      detectedCategories: [],
      detectedOpticalItems: [],
      summary: "Mixed attachment",
      extracted: blankExtractedFields(),
      missingOrUnclear: [],
      evidenceUnits: [
        {
          pageStart: 1,
          pageEnd: 1,
          readability: "readable",
          relevance: "relevant",
          documentType: "invoice",
          detectedCategories: [],
          detectedOpticalItems: [],
          summary: "Invoice",
          extracted: { ...blankExtractedFields(), billedAmount: 100 },
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
          extracted: {
            ...blankExtractedFields(),
            diagnoses: [{ description: "Printed diagnosis", code: null, codingSystem: null }]
          },
          missingOrUnclear: []
        }
      ]
    };
    const fetchMock = jest.spyOn(global, "fetch").mockResolvedValue(new Response(
      JSON.stringify({
        candidates: [{ content: { parts: [{ text: JSON.stringify(payload) }] } }]
      }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    ));
    const provider = new GeminiDocumentIntelligenceProvider(new ConfigService({
      GEMINI_API_KEY: "test-key",
      GEMINI_MODEL: "gemini-test"
    }));

    const result = await provider.analyse({
      attachmentId: "ATT-GEMINI",
      originalFilename: "mixed.pdf",
      mimeType: "application/pdf",
      bytes: Buffer.from("%PDF-test")
    });

    expect(result.documentType).toBe("invoice");
    expect(result.extracted.billedAmount).toBe(100);
    expect(result.evidenceUnits?.map((unit) => unit.documentType))
      .toEqual(["invoice", "medical_report"]);
    const request = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body)) as {
      generationConfig: { responseJsonSchema: { required: string[] } };
    };
    expect(request.generationConfig.responseJsonSchema.required).toContain("evidenceUnits");
  });
});
