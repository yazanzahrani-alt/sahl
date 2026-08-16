import {
  DOCUMENT_ANALYSIS_SCHEMA_VERSION,
  DOCUMENT_EXTRACTION_VERSION,
  blankExtractedFields,
  createEvidenceUnits,
  getEvidenceUnits,
  selectLegacySummaryUnit,
  type DocumentAnalysisResult
} from "./document-analysis";

describe("document analysis evidence-unit compatibility", () => {
  it("synthesizes one attachment-level legacy unit without fabricating pages", () => {
    const analysis = legacyAnalysis();

    const units = getEvidenceUnits(analysis);

    expect(units).toEqual([expect.objectContaining({
      evidenceUnitId: "ATT-LEGACY:evidence:legacy:1",
      attachmentId: "ATT-LEGACY",
      pageStart: null,
      pageEnd: null,
      pageProvenance: "legacy_attachment_level",
      documentType: "medical_report",
      extracted: analysis.extracted
    })]);
  });

  it("returns valid persisted evidence units instead of synthesizing legacy data", () => {
    const [unit] = createEvidenceUnits("ATT-NEW", [{
      pageStart: 2,
      pageEnd: 3,
      documentType: "discharge_summary",
      readability: "readable",
      relevance: "relevant",
      detectedCategories: ["inpatient_surgery"],
      detectedOpticalItems: [],
      summary: "Discharge summary",
      extracted: blankExtractedFields(),
      missingOrUnclear: []
    }]);
    const analysis = { ...legacyAnalysis(), attachmentId: "ATT-NEW", evidenceUnits: [unit] };

    expect(getEvidenceUnits(analysis)).toEqual([unit]);
  });

  it("falls back to legacy attachment evidence when persisted page ranges are invalid", () => {
    const [unit] = createEvidenceUnits("ATT-LEGACY", [providerUnit("medical_report", 1)]);
    const analysis = {
      ...legacyAnalysis(),
      evidenceUnits: [{ ...unit, pageStart: 3, pageEnd: 2 }]
    };

    expect(getEvidenceUnits(analysis)).toEqual([
      expect.objectContaining({
        evidenceUnitId: "ATT-LEGACY:evidence:legacy:1",
        pageStart: null,
        pageEnd: null,
        pageProvenance: "legacy_attachment_level"
      })
    ]);
  });

  it("uses invoice-first compatibility and refuses to invent a mixed non-invoice primary", () => {
    const units = createEvidenceUnits("ATT-MIXED", [
      providerUnit("medical_report", 1),
      providerUnit("invoice", 2),
      providerUnit("payment_receipt", 3)
    ]);
    const mixedWithoutInvoice = createEvidenceUnits("ATT-MIXED-OTHER", [
      providerUnit("medical_report", 1),
      providerUnit("payment_receipt", 2)
    ]);

    expect(selectLegacySummaryUnit(units)?.documentType).toBe("invoice");
    expect(selectLegacySummaryUnit(mixedWithoutInvoice)).toBeNull();
  });

  it("keeps same-role same-range content identity stable when provider order changes", () => {
    const firstInvoice = {
      ...providerUnit("invoice", 1),
      summary: "First invoice",
      extracted: { ...blankExtractedFields(), invoiceReference: "INV-A" }
    };
    const secondInvoice = {
      ...providerUnit("invoice", 1),
      summary: "Second invoice",
      extracted: { ...blankExtractedFields(), invoiceReference: "INV-B" }
    };

    const first = createEvidenceUnits("ATT-SAME-RANGE", [firstInvoice, secondInvoice]);
    const reordered = createEvidenceUnits("ATT-SAME-RANGE", [secondInvoice, firstInvoice]);
    const idsByReference = (units: typeof first) => Object.fromEntries(
      units.map((unit) => [unit.extracted.invoiceReference, unit.evidenceUnitId])
    );

    expect(idsByReference(reordered)).toEqual(idsByReference(first));
    expect(new Set(first.map((unit) => unit.evidenceUnitId)).size).toBe(2);
    for (const unit of first) {
      expect(unit.evidenceUnitId).toMatch(
        /^ATT-SAME-RANGE:evidence:pages-1-1:invoice:[0-9a-f]{64}:1$/
      );
      expect(unit.evidenceUnitId).not.toContain(unit.extracted.invoiceReference ?? "INV-");
    }
  });

  it("gives identical same-range duplicates deterministic unique identities", () => {
    const duplicate = {
      ...providerUnit("invoice", 1),
      summary: "Identical invoice",
      extracted: { ...blankExtractedFields(), invoiceReference: "INV-DUPLICATE" }
    };

    const first = createEvidenceUnits("ATT-DUPLICATE", [duplicate, duplicate]);
    const repeated = createEvidenceUnits("ATT-DUPLICATE", [duplicate, duplicate]);

    expect(first.map((unit) => unit.evidenceUnitId))
      .toEqual(repeated.map((unit) => unit.evidenceUnitId));
    expect(new Set(first.map((unit) => unit.evidenceUnitId)).size).toBe(2);
    expect(first.map((unit) => unit.evidenceUnitId)).toEqual([
      expect.stringMatching(/:[0-9a-f]{64}:1$/),
      expect.stringMatching(/:[0-9a-f]{64}:2$/)
    ]);
  });

  it("keeps different-page identities stable when provider output order changes", () => {
    const invoice = providerUnit("invoice", 3);
    const report = providerUnit("medical_report", 1);

    const first = createEvidenceUnits("ATT-STABLE", [invoice, report]);
    const second = createEvidenceUnits("ATT-STABLE", [report, invoice]);

    expect(first.map((unit) => [unit.documentType, unit.pageStart])).toEqual([
      ["medical_report", 1],
      ["invoice", 3]
    ]);
    expect(second.map((unit) => unit.evidenceUnitId))
      .toEqual(first.map((unit) => unit.evidenceUnitId));
  });

  it.each([
    ["non-deterministic ID", (unit: ReturnType<typeof validPersistedUnit>) => ({
      ...unit,
      evidenceUnitId: "arbitrary"
    })],
    ["invalid document type", (unit: ReturnType<typeof validPersistedUnit>) => ({
      ...unit,
      documentType: "not_a_document_type"
    })],
    ["invalid category", (unit: ReturnType<typeof validPersistedUnit>) => ({
      ...unit,
      detectedCategories: ["not_a_category"]
    })],
    ["invalid optical item", (unit: ReturnType<typeof validPersistedUnit>) => ({
      ...unit,
      detectedOpticalItems: ["not_an_optical_item"]
    })],
    ["non-string missing value", (unit: ReturnType<typeof validPersistedUnit>) => ({
      ...unit,
      missingOrUnclear: [123]
    })],
    ["incomplete extracted fields", (unit: ReturnType<typeof validPersistedUnit>) => ({
      ...unit,
      extracted: {}
    })]
  ])("rejects persisted evidence with %s", (_case, mutate) => {
    expectLegacyFallback([mutate(validPersistedUnit())]);
  });

  it("rejects a persisted array with duplicate evidence-unit IDs", () => {
    const units = createEvidenceUnits("ATT-LEGACY", [
      providerUnit("medical_report", 1),
      providerUnit("medical_report", 2)
    ]);

    expectLegacyFallback([
      units[0],
      { ...units[1], evidenceUnitId: units[0].evidenceUnitId }
    ]);
  });

  function providerUnit(
    documentType: "invoice" | "medical_report" | "payment_receipt",
    page: number
  ) {
    return {
      pageStart: page,
      pageEnd: page,
      documentType,
      readability: "readable" as const,
      relevance: "relevant" as const,
      detectedCategories: [],
      detectedOpticalItems: [],
      summary: documentType,
      extracted: blankExtractedFields(),
      missingOrUnclear: []
    };
  }

  function legacyAnalysis(): DocumentAnalysisResult {
    return {
      attachmentId: "ATT-LEGACY",
      schemaVersion: 2,
      extractionVersion: "independent-document-v2-sbs",
      analysisStatus: "complete",
      provider: "openai",
      model: "gpt-test",
      analysedAt: "2026-08-11T00:00:00.000Z",
      readability: "readable",
      relevance: "relevant",
      documentType: "medical_report",
      detectedCategories: ["inpatient_surgery"],
      detectedOpticalItems: [],
      summary: "Legacy report",
      extracted: {
        ...blankExtractedFields(),
        diagnoses: [{ description: "Printed diagnosis", code: null, codingSystem: null }]
      },
      missingOrUnclear: []
    };
  }

  function validPersistedUnit() {
    return createEvidenceUnits("ATT-LEGACY", [providerUnit("medical_report", 1)])[0];
  }

  function expectLegacyFallback(evidenceUnits: unknown[]) {
    const analysis = {
      ...legacyAnalysis(),
      evidenceUnits: evidenceUnits as DocumentAnalysisResult["evidenceUnits"]
    };

    expect(getEvidenceUnits(analysis)).toEqual([
      expect.objectContaining({
        evidenceUnitId: "ATT-LEGACY:evidence:legacy:1",
        pageProvenance: "legacy_attachment_level"
      })
    ]);
  }

  it("keeps the current constants available to new results", () => {
    expect(DOCUMENT_ANALYSIS_SCHEMA_VERSION).toBe(4);
    expect(DOCUMENT_EXTRACTION_VERSION).toBe("independent-document-v4-date-evidence");
  });
});
