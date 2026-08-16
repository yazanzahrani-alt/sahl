import {
  blankExtractedFields,
  DOCUMENT_ANALYSIS_SCHEMA_VERSION,
  DOCUMENT_EXTRACTION_VERSION,
  type DocumentAnalysisResult,
  type DocumentType,
  type ExtractedDocumentFields
} from "../document-intelligence/document-analysis";
import { EvidenceCompletenessEvaluator } from "./evidence-completeness.evaluator";

describe("EvidenceCompletenessEvaluator", () => {
  const evaluator = new EvidenceCompletenessEvaluator();

  it("distinguishes meaningful and empty medical evidence", () => {
    expect(evaluator.evaluateAttachment(analysis("medical_report", {
      diagnoses: [{ description: "Acute condition", code: null, codingSystem: null }]
    })).state).toBe("present_useful");
    expect(evaluator.evaluateAttachment(analysis("medical_report")).state)
      .toBe("present_insufficient");
  });

  it.each([
    "",
    "   ",
    "-",
    "--",
    "N/A",
    "NA",
    "N.A.",
    "none",
    "unknown",
    "not available",
    "not applicable"
  ])("does not treat the placeholder %p as meaningful evidence", (placeholder) => {
    expect(evaluator.evaluateAttachment(analysis("medical_report", {
      diagnoses: [{ description: placeholder, code: null, codingSystem: null }],
      procedures: [{ description: placeholder, code: null, codingSystem: null }],
      serviceLines: [{
        description: placeholder,
        serviceDate: null,
        quantity: null,
        unitPrice: null,
        billedAmount: null,
        currency: null,
        diagnosisText: placeholder,
        diagnosisCode: null,
        procedureCode: null,
        sbsCode: null,
        sbsDescription: placeholder,
        toothNumber: null
      }]
    })).state).toBe("present_insufficient");
  });

  it("rejects exact generic clinical labels without rejecting short terms or codes", () => {
    expect(evaluator.evaluateAttachment(analysis("medical_report", {
      diagnoses: [{ description: "Consultation", code: null, codingSystem: null }]
    })).state).toBe("present_insufficient");
    expect(evaluator.evaluateAttachment(analysis("medical_report", {
      diagnoses: [{ description: "Flu", code: null, codingSystem: null }]
    })).state).toBe("present_useful");
    expect(evaluator.evaluateAttachment(analysis("medical_report", {
      procedures: [{ description: null, code: "MRI", codingSystem: null }]
    })).state).toBe("present_useful");
  });

  it("accepts a discharge summary with stay dates or treatment content", () => {
    expect(evaluator.evaluateAttachment(analysis("discharge_summary", {
      admissionDate: "2026-08-01",
      dischargeDate: "2026-08-03"
    })).state).toBe("present_useful");
  });

  it("keeps schema-limited optical evidence uncertain unless emptiness is explicit", () => {
    const uncertain = analysis("eye_test", { patientName: "Test Member" }, [
      "Refraction measurements were not represented in the current schema."
    ]);
    const empty = analysis("eye_test", {}, ["The document is blank."]);
    const useful = analysis("prescription", {
      serviceLines: [{
        description: "Corrective lens prescription",
        serviceDate: null,
        quantity: null,
        unitPrice: null,
        billedAmount: null,
        currency: null,
        diagnosisText: null,
        diagnosisCode: null,
        procedureCode: null,
        sbsCode: null,
        sbsDescription: null,
        toothNumber: null
      }]
    });

    expect(evaluator.evaluateAttachment(uncertain).state).toBe("uncertain");
    expect(evaluator.evaluateAttachment(empty).state).toBe("present_insufficient");
    expect(evaluator.evaluateAttachment(useful).state).toBe("present_useful");
  });

  it("does not promote unrelated or generic clinical content to useful optical evidence", () => {
    const unrelated = analysis("eye_test", {
      diagnoses: [{ description: "Hypertension", code: "I10", codingSystem: "ICD-10" }]
    });
    const unrelatedProcedure = analysis("prescription", {
      procedures: [{ description: "Appendectomy", code: "PROC-1", codingSystem: null }]
    });
    const generic = analysis("prescription", {
      serviceLines: [{
        description: "Consultation",
        serviceDate: null,
        quantity: null,
        unitPrice: null,
        billedAmount: null,
        currency: null,
        diagnosisText: null,
        diagnosisCode: null,
        procedureCode: null,
        sbsCode: null,
        sbsDescription: null,
        toothNumber: null
      }]
    });

    expect(evaluator.evaluateAttachment(unrelated).state).toBe("uncertain");
    expect(evaluator.evaluateAttachment(unrelatedProcedure).state).toBe("uncertain");
    expect(evaluator.evaluateAttachment(unrelatedProcedure).state).not.toBe("present_useful");
    expect(evaluator.evaluateAttachment(generic).state).toBe("uncertain");
  });

  it("does not pretend schema-limited optional roles are complete", () => {
    for (const documentType of ["dental_xray", "lab_result", "imaging_result"] as const) {
      expect(evaluator.evaluateAttachment(analysis(documentType)).state).toBe("uncertain");
      expect(evaluator.evaluateRole(documentType, []).state).toBe("absent");
    }
  });

  it("does not count an unreadable role attachment as useful evidence", () => {
    expect(evaluator.evaluateAttachment({
      ...analysis("medical_report", {
        diagnoses: [{ description: "Visible only in a failed read", code: null, codingSystem: null }]
      }),
      readability: "unreadable"
    }).state).toBe("absent");
  });

  it("does not count a failed legacy analysis as complete evidence", () => {
    expect(evaluator.evaluateAttachment({
      ...analysis("medical_report", {
        diagnoses: [{ description: "Visible in a failed result", code: null, codingSystem: null }]
      }),
      analysisStatus: "failed"
    }).state).toBe("absent");
  });

  function analysis(
    documentType: DocumentType,
    extracted: Partial<ExtractedDocumentFields> = {},
    missingOrUnclear: string[] = []
  ): DocumentAnalysisResult {
    return {
      attachmentId: `ATT-${documentType}`,
      schemaVersion: DOCUMENT_ANALYSIS_SCHEMA_VERSION,
      extractionVersion: DOCUMENT_EXTRACTION_VERSION,
      analysisStatus: "complete",
      provider: "test",
      model: null,
      analysedAt: "2026-08-10T12:00:00.000Z",
      readability: "readable",
      relevance: "relevant",
      documentType,
      detectedCategories: [],
      detectedOpticalItems: [],
      summary: "Ignored by completeness evaluation",
      extracted: { ...blankExtractedFields(), ...extracted },
      missingOrUnclear
    };
  }
});
