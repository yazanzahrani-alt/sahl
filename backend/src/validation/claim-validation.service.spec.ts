import { BadRequestException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ClaimReviewService } from "../claims/claim-review.service";
import { ClaimSubmissionService } from "../claims/claim-submission.service";
import { ClaimsService } from "../claims/claims.service";
import { DocumentsService } from "../claims/documents.service";
import { DatabaseService } from "../database/database.service";
import {
  blankExtractedFields,
  createEvidenceUnits,
  DOCUMENT_ANALYSIS_SCHEMA_VERSION,
  DOCUMENT_EXTRACTION_VERSION,
  type DocumentAnalysisResult,
  type DocumentType,
  type ExtractedDocumentFields,
  type ProviderEvidenceUnit
} from "../document-intelligence/document-analysis";
import { ClaimValidationService } from "./claim-validation.service";
import { validationIssueKey } from "./validation";
import { DocumentIntelligenceService } from "../document-intelligence/document-intelligence.service";

describe("Change Set 2 claim validation", () => {
  let directory: string;
  let database: DatabaseService;
  let claims: ClaimsService;
  let review: ClaimReviewService;
  let validation: ClaimValidationService;
  let documents: DocumentsService;
  let intelligence: DocumentIntelligenceService;
  let submissions: ClaimSubmissionService;
  let claimId: string;

  const memberId = "00123456";
  const now = new Date("2026-08-10T12:00:00.000Z");

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), "sahl-validation-"));
    process.env.UPLOADS_PATH = join(directory, "uploads");
    database = new DatabaseService(new ConfigService({ SQLITE_PATH: join(directory, "sahl.db") }));
    database.onModuleInit();
    database.run(
      `INSERT INTO members (member_id, member_id_source, password_hash, created_at)
       VALUES (?, 'provided', 'test-hash', ?)`,
      memberId,
      now.toISOString()
    );
    claims = new ClaimsService(database);
    review = new ClaimReviewService(database, claims);
    validation = new ClaimValidationService(database, claims);
    documents = new DocumentsService(database, claims);
    intelligence = new DocumentIntelligenceService(
      database,
      documents,
      new ConfigService({ DOCUMENT_INTELLIGENCE_PROVIDER: "test" }),
      {} as never,
      {} as never
    );
    submissions = new ClaimSubmissionService(
      database,
      claims,
      documents,
      review,
      validation,
      intelligence
    );
    claimId = claims.create(memberId, {
      category: "dental",
      claimLocation: "local"
    }).claimId;
  });

  afterEach(() => {
    database.onApplicationShutdown();
    rmSync(directory, { recursive: true, force: true });
    delete process.env.UPLOADS_PATH;
  });

  it("treats warnings as non-blocking and blockers as submission-blocking", () => {
    const warningInvoice = persist(analysis("ATT-1", {
      extracted: { invoiceReference: null }
    }));
    const warningResult = validation.validate(
      memberId,
      claims.findOne(memberId, claimId),
      [warningInvoice],
      now
    );

    expect(warningResult.readyToSubmit).toBe(true);
    expect(warningResult.warningCount).toBe(1);
    expect(warningResult.blockingIssueCount).toBe(0);
    expect(warningResult.issues[0]?.severity).toBe("warning");
    expect(claims.findOne(memberId, claimId).status).toBe("ready");

    const invalidInvoice = analysis("ATT-1", {
      extracted: { invoiceDate: "not-a-date", invoiceReference: null }
    });
    const blockedResult = validation.validate(
      memberId,
      claims.findOne(memberId, claimId),
      [invalidInvoice],
      now
    );
    expect(blockedResult.readyToSubmit).toBe(false);
    expect(blockedResult.warningCount).toBeGreaterThan(0);
    expect(blockedResult.blockingIssueCount).toBeGreaterThan(0);
    expect(blockedResult.issues.find((issue) => issue.code === "invoice_date_invalid")?.severity)
      .toBe("blocking_error");
  });

  it("revalidates member edits deterministically and preserves the source value", () => {
    const raw = persist(analysis("ATT-1", {
      extracted: { serviceDate: "2030-01-01" }
    }));
    const initial = validation.validate(memberId, claims.findOne(memberId, claimId), [raw], now);
    expect(initial.issues.some((issue) => issue.code === "service_date_future")).toBe(true);

    const edited = review.buildReview(claimId, [raw]).extracted;
    review.saveReview(memberId, claimId, [raw], { ...edited, serviceDate: "2026-08-01" });
    const effective = review.validationAnalyses(claimId, [raw]);
    const result = validation.validate(
      memberId,
      claims.findOne(memberId, claimId),
      [raw],
      now,
      effective
    );

    expect(result.issues.some((issue) => issue.code === "service_date_future")).toBe(false);
    expect(result.issues.some((issue) => issue.code === "member_edit_differs_from_source_serviceDate"))
      .toBe(true);
    expect(raw.extracted.serviceDate).toBe("2030-01-01");
    const provenance = review.buildReview(claimId, [raw]).provenance
      .find((item) => item.field === "serviceDate");
    expect(provenance).toMatchObject({
      sourceValue: "2030-01-01",
      memberValue: "2026-08-01",
      effectiveValue: "2026-08-01",
      editedByMember: true,
      sourceAttachmentRefs: ["ATT-1"]
    });
  });

  it("blocks malformed member-entered service dates", () => {
    const raw = persist(analysis("ATT-1"));
    const edited = review.buildReview(claimId, [raw]).extracted;
    review.saveReview(memberId, claimId, [raw], { ...edited, serviceDate: "10/08/2026" });
    const result = validation.validate(
      memberId,
      claims.findOne(memberId, claimId),
      [raw],
      now,
      review.validationAnalyses(claimId, [raw])
    );
    expect(result.issues.find((issue) => issue.code === "service_date_invalid"))
      .toMatchObject({ severity: "blocking_error" });
  });

  it("does not create noisy edit provenance for normalization-equivalent text", () => {
    const raw = persist(analysis("ATT-1", { extracted: { providerName: "Riyadh Clinic" } }));
    const edited = review.buildReview(claimId, [raw]).extracted;
    review.saveReview(memberId, claimId, [raw], {
      ...edited,
      providerName: "  RIYADH   CLINIC  "
    });

    const result = review.buildReview(claimId, [raw]);
    expect(result.editedFields).not.toContain("providerName");
    expect(result.provenance.find((item) => item.field === "providerName")?.editedByMember)
      .toBe(false);
  });

  it("keeps raw cross-document conflicts after a member edit", () => {
    const invoice = persist(analysis("ATT-1", { extracted: { patientName: "Alice Smith" } }));
    const report = persist(analysis("ATT-2", {
      documentType: "medical_report",
      extracted: {
        patientName: "Bob Jones",
        providerName: "Riyadh Clinic",
        serviceLines: [],
        billedAmount: null,
        paymentStatus: "unclear"
      }
    }));
    const merged = review.buildReview(claimId, [invoice, report]).extracted;
    review.saveReview(memberId, claimId, [invoice, report], {
      ...merged,
      patientName: "Alice Smith"
    });

    const result = validation.validate(
      memberId,
      claims.findOne(memberId, claimId),
      [invoice, report],
      now,
      review.validationAnalyses(claimId, [invoice, report])
    );
    expect(result.issues.find((issue) => issue.code === "patient_name_mismatch"))
      .toMatchObject({ severity: "blocking_error", state: "conflict" });
  });

  it("collapses an unreadable invoice to its document root cause", () => {
    const unreadable = persist(analysis("ATT-1", {
      readability: "unreadable",
      extracted: { serviceLines: [], billedAmount: null }
    }));
    const report = persist(analysis("ATT-2", {
      documentType: "medical_report",
      extracted: { serviceLines: [], billedAmount: null, paymentStatus: "unclear" }
    }));

    const result = validation.validate(
      memberId,
      claims.findOne(memberId, claimId),
      [unreadable, report],
      now
    );
    expect(result.issues.map((issue) => issue.code)).toContain("document_unreadable");
    expect(result.issues.map((issue) => issue.code)).not.toContain("invoice_missing");
    expect(result.issues.some((issue) => issue.code.startsWith("invoice_") && issue.code.endsWith("_missing")))
      .toBe(false);
  });

  it("warns about an unreadable optional document without treating it as required evidence", () => {
    const invoice = persist(analysis("ATT-1"));
    const optionalReport = persist(analysis("ATT-2", {
      documentType: "medical_report",
      readability: "unreadable",
      extracted: { serviceLines: [], billedAmount: null, paymentStatus: "unclear" }
    }));

    const result = validation.validate(
      memberId,
      claims.findOne(memberId, claimId),
      [invoice, optionalReport],
      now
    );
    expect(result.issues.find((issue) => issue.attachmentId === "ATT-2"))
      .toMatchObject({
        code: "document_optional_unreadable",
        severity: "warning",
        messageAr: expect.any(String)
      });
    expect(result.blockingIssueCount).toBe(0);
    expect(result.readyToSubmit).toBe(true);
  });

  it("submits with warnings and stores provenance, validation, raw extraction, and uncertainty", () => {
    persist(analysis("ATT-1", { extracted: { invoiceReference: null } }));

    const submission = submissions.submit(memberId, claimId, now);

    expect(submission.payload.schemaVersion).toBe("1.2");
    expect(submission.payload.intake).toMatchObject({
      readyToSubmit: true,
      blockingIssueCount: 0,
      warningCount: 1,
      acceptedForProcessing: true
    });
    expect(submission.payload.unresolvedWarnings[0]?.severity).toBe("warning");
    expect(submission.payload.provenance.length).toBeGreaterThan(0);
    expect(submission.payload.rawDocumentExtractions[0]?.analysis.extracted.invoiceReference)
      .toBeNull();
    expect(submission.payload.internalUncertainty[0]).toMatchObject({
      attachmentReference: "ATT-1",
      level: "low"
    });
    expect(Object.keys(submission.payload.validationSnapshot).sort()).toEqual([
      "blockingIssueCount",
      "claimId",
      "infoCount",
      "issues",
      "readyToSubmit",
      "state",
      "validatedAt",
      "warningCount"
    ].sort());
    const submissionIssueKeys = [
      "attachmentId",
      "code",
      "field",
      "message",
      "severity",
      "state"
    ].sort();
    expect(Object.keys(submission.payload.validationSnapshot.issues[0]!).sort())
      .toEqual(submissionIssueKeys);
    expect(Object.keys(submission.payload.unresolvedWarnings[0]!).sort())
      .toEqual(submissionIssueKeys);
    expect(submission.payload.patient.name).toBe("Alice Smith");
    expect(submission.payload.invoices[0]).toMatchObject({
      billedAmount: 100,
      currency: "SAR"
    });
    expect(submission.payload.items[0]?.description).toBe("Consultation");
    expect(JSON.stringify({
      invoices: submission.payload.invoices,
      paymentEvidence: submission.payload.paymentEvidence,
      items: submission.payload.items,
      clinical: submission.payload.clinical,
      provenance: submission.payload.provenance,
      validationSnapshot: submission.payload.validationSnapshot,
      unresolvedWarnings: submission.payload.unresolvedWarnings
    })).not.toContain("sourceEvidenceUnitRef");
    expect(JSON.stringify({
      validationSnapshot: submission.payload.validationSnapshot,
      unresolvedWarnings: submission.payload.unresolvedWarnings
    })).not.toMatch(/evidenceUnitId|pageStart|pageEnd|messageAr|detailsAr|"details"/);
    expect(claims.findOne(memberId, claimId).status).toBe("accepted_for_processing");
  });

  it.each([
    ["schema version", { schemaVersion: DOCUMENT_ANALYSIS_SCHEMA_VERSION - 1 }],
    ["extraction version", { extractionVersion: "stale-extraction-version" }],
    ["provider", { provider: "stale-provider" }],
    ["model", { model: "stale-model" }]
  ] as const)("rejects submission when a complete extraction has a stale %s", (_label, stale) => {
    persist(analysis("ATT-STALE", stale));

    try {
      submissions.submit(memberId, claimId, now);
      throw new Error("Expected stale analysis submission to be rejected.");
    } catch (error) {
      expect(error).toBeInstanceOf(BadRequestException);
      expect((error as BadRequestException).getResponse()).toMatchObject({
        code: "DOCUMENT_ANALYSIS_STALE",
        message: "Your documents need to be analyzed again before submission."
      });
    }
    expect(claims.findOne(memberId, claimId).status).not.toBe("accepted_for_processing");
  });

  it("preserves source 450 and member 400 while allowing warning-only submission", () => {
    const raw = persist(analysis("ATT-1", {
      extracted: {
        subtotal: 450,
        billedAmount: 450,
        serviceLines: [{
          description: "Treatment",
          serviceDate: "2026-08-01",
          quantity: 1,
          unitPrice: 450,
          billedAmount: 450,
          currency: "SAR",
          diagnosisText: null,
          diagnosisCode: null,
          procedureCode: null,
          sbsCode: null,
          sbsDescription: null,
          toothNumber: null
        }]
      }
    }));
    const edited = review.buildReview(claimId, [raw]).extracted;
    review.saveReview(memberId, claimId, [raw], { ...edited, billedAmount: 400 });

    const submission = submissions.submit(memberId, claimId, now);
    const amountProvenance = submission.payload.provenance
      .find((item) => item.field === "billedAmount");
    expect(amountProvenance).toMatchObject({
      sourceValue: 450,
      memberValue: 400,
      effectiveValue: 400,
      editedByMember: true,
      severity: "warning"
    });
    expect(submission.payload.unresolvedWarnings.some((issue) =>
      issue.code === "member_edit_differs_from_source_billedAmount"
    )).toBe(true);
    expect(submission.payload.rawDocumentExtractions[0]?.analysis.extracted.billedAmount)
      .toBe(450);
  });

  it("uses a field-level blocker for a readable invoice missing a critical value", () => {
    const raw = persist(analysis("ATT-1", { extracted: { billedAmount: null } }));
    const result = validation.validate(memberId, claims.findOne(memberId, claimId), [raw], now);
    expect(result.issues.find((issue) => issue.code === "invoice_billedAmount_missing"))
      .toMatchObject({ field: "billedAmount", severity: "blocking_error" });
    expect(result.issues.some((issue) => issue.code === "document_unreadable")).toBe(false);
  });

  it("rejects submission when a blocking error remains", () => {
    persist(analysis("ATT-1", { extracted: { serviceDate: "2030-01-01" } }));
    expect(() => submissions.submit(memberId, claimId, now)).toThrow(BadRequestException);
  });

  it("does not enforce an unsupported fixed submission window", () => {
    const oldInvoice = persist(analysis("ATT-1", {
      extracted: { invoiceDate: "2024-01-01" }
    }));

    const result = validation.validate(
      memberId,
      claims.findOne(memberId, claimId),
      [oldInvoice],
      now
    );

    expect(result.issues.some((issue) => issue.code === "submission_window_expired"))
      .toBe(false);
    expect(result.readyToSubmit).toBe(true);
  });

  it("blocks invalid admission and discharge dates and their ordering", () => {
    const invoice = persist(analysis("ATT-1"));
    const reversedStay = persist(analysis("ATT-2", {
      documentType: "discharge_summary",
      extracted: {
        serviceLines: [],
        billedAmount: null,
        paymentStatus: "unclear",
        admissionDate: "2026-08-08",
        dischargeDate: "2026-08-07"
      }
    }));

    const reversed = validation.validate(
      memberId,
      claims.findOne(memberId, claimId),
      [invoice, reversedStay],
      now
    );
    expect(reversed.issues.find((issue) => issue.code === "admission_discharge_order_invalid"))
      .toMatchObject({ field: "admissionDate", severity: "blocking_error" });

    const malformedStay = analysis("ATT-2", {
      documentType: "discharge_summary",
      extracted: {
        serviceLines: [],
        billedAmount: null,
        paymentStatus: "unclear",
        admissionDate: "08/08/2026",
        dischargeDate: "2030-01-01"
      }
    });
    const malformed = validation.validate(
      memberId,
      claims.findOne(memberId, claimId),
      [invoice, malformedStay],
      now
    );
    expect(malformed.issues.some((issue) => issue.code === "admission_date_invalid"))
      .toBe(true);
    expect(malformed.issues.some((issue) => issue.code === "discharge_date_future"))
      .toBe(true);
  });

  it("preserves printed technical codes, SBS evidence, and source document types", () => {
    const source = persist(analysis("ATT-1", {
      extracted: {
        serviceLines: [{
          description: "Printed treatment",
          serviceDate: "2026-08-01",
          quantity: 1,
          unitPrice: 100,
          billedAmount: 100,
          currency: "SAR",
          diagnosisText: "Printed diagnosis",
          diagnosisCode: "DX-PRINTED",
          procedureCode: "PROC-PRINTED",
          sbsCode: "SBS-123",
          sbsDescription: "Printed SBS service",
          toothNumber: null
        }]
      }
    }));
    const fields = review.buildReview(claimId, [source]).extracted;
    review.saveReview(memberId, claimId, [source], {
      ...fields,
      serviceLines: [{
        ...fields.serviceLines[0],
        diagnosisCode: "MEMBER-DX",
        procedureCode: "MEMBER-PROC",
        sbsCode: "MEMBER-SBS",
        sbsDescription: "Member-created SBS"
      }]
    });

    const rebuilt = review.buildReview(claimId, [source]);
    expect(rebuilt.extracted.serviceLines[0]).toMatchObject({
      diagnosisCode: "DX-PRINTED",
      procedureCode: "PROC-PRINTED",
      sbsCode: "SBS-123",
      sbsDescription: "Printed SBS service"
    });
    expect(rebuilt.provenance.find((item) => item.field === "serviceLines"))
      .toMatchObject({ sourceDocumentTypes: ["invoice"] });

    const submission = submissions.submit(memberId, claimId, now);
    expect(submission.payload.items[0]).toMatchObject({
      sbsCode: "SBS-123",
      sbsDescription: "Printed SBS service"
    });
    expect(submission.payload.rawDocumentExtractions[0]?.analysis.extracted.serviceLines[0])
      .toMatchObject({ sbsCode: "SBS-123" });
  });

  it("blocks an inpatient claim when required supporting evidence is absent", () => {
    setCategory("inpatient_surgery");
    const invoice = persist(analysis("ATT-1", { detectedCategories: ["inpatient_surgery"] }));

    const result = validation.validate(memberId, claims.findOne(memberId, claimId), [invoice], now);

    expect(result.issues.find((issue) => issue.code === "inpatient_document_missing"))
      .toMatchObject({ severity: "blocking_error", attachmentId: null });
  });

  it("targets a role-classified but clinically empty medical report for replacement", () => {
    setCategory("inpatient_surgery");
    const invoice = persist(analysis("ATT-1", { detectedCategories: ["inpatient_surgery"] }));
    const report = persist(analysis("ATT-2", {
      documentType: "medical_report",
      detectedCategories: ["inpatient_surgery"],
      extracted: {
        serviceLines: [],
        diagnoses: [],
        procedures: [],
        billedAmount: null,
        paymentStatus: "unclear"
      }
    }));

    const result = validation.validate(
      memberId,
      claims.findOne(memberId, claimId),
      [invoice, report],
      now
    );

    expect(result.issues.find((issue) => issue.code === "medical_report_insufficient"))
      .toMatchObject({ severity: "blocking_error", attachmentId: "ATT-2" });
    expect(result.issues.some((issue) => issue.code === "inpatient_document_missing")).toBe(false);
  });

  it("suppresses only derivative support noise while preserving an independent payment issue", () => {
    setCategory("inpatient_surgery");
    const invoice = persist(analysis("ATT-1", {
      detectedCategories: ["inpatient_surgery"],
      extracted: { paymentStatus: "unpaid" }
    }));
    const report = persist(analysis("ATT-2", {
      documentType: "medical_report",
      detectedCategories: ["inpatient_surgery"],
      readability: "unclear",
      extracted: {
        serviceLines: [],
        diagnoses: [],
        procedures: [],
        billedAmount: null,
        paymentStatus: "unclear"
      }
    }));

    const result = validation.validate(
      memberId,
      claims.findOne(memberId, claimId),
      [invoice, report],
      now
    );

    expect(result.issues.find((issue) => issue.code === "medical_report_insufficient"))
      .toMatchObject({ attachmentId: "ATT-2", severity: "blocking_error" });
    expect(result.issues.some((issue) =>
      issue.code === "document_readability_unclear" && issue.attachmentId === "ATT-2"
    )).toBe(false);
    expect(result.issues.find((issue) => issue.code === "payment_evidence_missing"))
      .toMatchObject({ attachmentId: null, severity: "blocking_error" });
  });

  it("accepts meaningful medical or discharge evidence for the inpatient group", () => {
    setCategory("inpatient_surgery");
    const invoice = persist(analysis("ATT-1", { detectedCategories: ["inpatient_surgery"] }));
    const medicalReport = analysis("ATT-2", {
      documentType: "medical_report",
      detectedCategories: ["inpatient_surgery"],
      extracted: {
        serviceLines: [],
        billedAmount: null,
        paymentStatus: "unclear",
        diagnoses: [{ description: "Post-operative review", code: null, codingSystem: null }]
      }
    });
    const dischargeSummary = analysis("ATT-3", {
      documentType: "discharge_summary",
      detectedCategories: ["inpatient_surgery"],
      extracted: {
        serviceLines: [],
        billedAmount: null,
        paymentStatus: "unclear",
        admissionDate: "2026-08-01",
        dischargeDate: "2026-08-02"
      }
    });

    for (const supportingDocument of [medicalReport, dischargeSummary]) {
      const result = validation.validate(
        memberId,
        claims.findOne(memberId, claimId),
        [invoice, supportingDocument],
        now
      );
      expect(result.issues.some((issue) =>
        issue.code === "inpatient_document_missing" || issue.code.endsWith("_insufficient")
      )).toBe(false);
    }
  });

  it("keeps an unreadable required report as one source-level root cause", () => {
    setCategory("inpatient_surgery");
    const invoice = persist(analysis("ATT-1", { detectedCategories: ["inpatient_surgery"] }));
    const report = persist(analysis("ATT-2", {
      documentType: "medical_report",
      detectedCategories: ["inpatient_surgery"],
      readability: "unreadable",
      extracted: { serviceLines: [], billedAmount: null, paymentStatus: "unclear" }
    }));

    const result = validation.validate(
      memberId,
      claims.findOne(memberId, claimId),
      [invoice, report],
      now
    );

    expect(result.issues.filter((issue) => issue.attachmentId === "ATT-2"))
      .toEqual([expect.objectContaining({ code: "document_unreadable" })]);
    expect(result.issues.some((issue) =>
      issue.code === "inpatient_document_missing" || issue.code === "medical_report_insufficient"
    )).toBe(false);
  });

  it("uses useful, insufficient, and uncertain optical evidence conservatively", () => {
    setCategory("optical", "frames");
    const invoice = persist(analysis("ATT-1", {
      detectedCategories: ["optical"],
      detectedOpticalItems: ["frames"],
      extracted: { opticalFrameAmount: 100 }
    }));
    const baseEyeTest = {
      documentType: "eye_test" as const,
      detectedCategories: ["optical"] as DocumentAnalysisResult["detectedCategories"],
      extracted: {
        ...blankExtractedFields(),
        patientName: "Alice Smith",
        providerName: "Riyadh Clinic"
      }
    };

    const useful = persist(analysis("ATT-2", {
      ...baseEyeTest,
      extracted: {
        ...baseEyeTest.extracted,
        serviceLines: [{
          description: "Refraction assessment",
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
      }
    }));
    const insufficient = persist(analysis("ATT-3", {
      documentType: "eye_test",
      detectedCategories: ["optical"],
      extracted: blankExtractedFields(),
      missingOrUnclear: ["The document is blank."]
    }));
    const uncertain = persist(analysis("ATT-4", {
      ...baseEyeTest,
      missingOrUnclear: ["Refraction details are not represented in the current schema."]
    }));

    const usefulResult = validation.validate(
      memberId, claims.findOne(memberId, claimId), [invoice, useful], now
    );
    expect(usefulResult.issues.some((issue) =>
      issue.code === "optical_document_missing" || issue.code.startsWith("eye_test_")
    )).toBe(false);

    const insufficientResult = validation.validate(
      memberId, claims.findOne(memberId, claimId), [invoice, insufficient], now
    );
    expect(insufficientResult.issues.find((issue) => issue.code === "eye_test_insufficient"))
      .toMatchObject({ severity: "blocking_error", attachmentId: "ATT-3" });

    const uncertainResult = validation.validate(
      memberId, claims.findOne(memberId, claimId), [invoice, uncertain], now
    );
    expect(uncertainResult.issues.find((issue) => issue.code === "eye_test_uncertain"))
      .toMatchObject({ severity: "warning", attachmentId: "ATT-4" });
    expect(uncertainResult.blockingIssueCount).toBe(0);
    expect(uncertainResult.readyToSubmit).toBe(true);
  });

  it("does not make absent optional dental X-ray, lab, or imaging evidence blocking", () => {
    const dental = validation.validate(
      memberId,
      claims.findOne(memberId, claimId),
      [persist(analysis("ATT-1"))],
      now
    );
    expect(dental.issues.some((issue) => issue.code.includes("dental_xray"))).toBe(false);

    setCategory("other_outpatient");
    const outpatient = validation.validate(
      memberId,
      claims.findOne(memberId, claimId),
      [analysis("ATT-1", { detectedCategories: ["other_outpatient"] })],
      now
    );
    expect(outpatient.issues.some((issue) =>
      issue.code.includes("lab_result") || issue.code.includes("imaging_result")
    )).toBe(false);
  });

  it("preserves category mismatch detection without fabricating or auto-switching categories", () => {
    setCategory("optical", "frames");
    const dentalEvidence = persist(analysis("ATT-1", { detectedCategories: ["dental"] }));
    const mismatch = validation.validate(
      memberId, claims.findOne(memberId, claimId), [dentalEvidence], now
    );
    expect(mismatch.issues.find((issue) => issue.code === "category_mismatch"))
      .toMatchObject({ severity: "blocking_error", attachmentId: "ATT-1" });
    expect(claims.findOne(memberId, claimId).category).toBe("optical");

    const ambiguous = analysis("ATT-1", {
      detectedCategories: ["optical", "dental"],
      extracted: { opticalFrameAmount: 100 }
    });
    const unclear = validation.validate(
      memberId, claims.findOne(memberId, claimId), [ambiguous], now
    );
    expect(unclear.issues.find((issue) => issue.code === "category_unclear"))
      .toMatchObject({ severity: "warning" });

    const noSignal = validation.validate(
      memberId,
      claims.findOne(memberId, claimId),
      [analysis("ATT-1", { detectedCategories: [], extracted: { opticalFrameAmount: 100 } })],
      now
    );
    expect(noSignal.issues.some((issue) => issue.code === "category_mismatch")).toBe(false);

    setCategory("dental");
    const reverseMismatch = validation.validate(
      memberId,
      claims.findOne(memberId, claimId),
      [analysis("ATT-1", { detectedCategories: ["optical"] })],
      now
    );
    expect(reverseMismatch.issues.some((issue) => issue.code === "category_mismatch")).toBe(true);
  });

  it("preserves attachments and invalidates validation when the member changes category", () => {
    const source = persist(analysis("ATT-1", { detectedCategories: ["other_outpatient"] }));
    const initial = validation.validate(memberId, claims.findOne(memberId, claimId), [source], now);
    expect(initial.issues.some((issue) => issue.code === "category_mismatch")).toBe(true);
    expect(claims.findOne(memberId, claimId).status).toBe("needs_review");

    claims.update(memberId, claimId, { category: "other_outpatient" });

    expect(claims.findOne(memberId, claimId)).toMatchObject({
      category: "other_outpatient",
      status: "draft"
    });
    expect(documents.list(memberId, claimId).map((item) => item.attachmentId)).toEqual(["ATT-1"]);
    expect(validation.getCurrent(claims.findOne(memberId, claimId))).toBeNull();

    const revalidated = validation.validate(
      memberId,
      claims.findOne(memberId, claimId),
      [source],
      now
    );
    expect(revalidated.issues.some((issue) => issue.code === "category_mismatch")).toBe(false);
  });

  it("keeps validation current when a claim update does not change any input", () => {
    const source = persist(analysis("ATT-UNCHANGED"));
    const initial = validation.validate(
      memberId,
      claims.findOne(memberId, claimId),
      [source],
      now
    );
    const status = claims.findOne(memberId, claimId).status;

    claims.update(memberId, claimId, {
      category: "dental",
      claimLocation: "local"
    });

    expect(claims.findOne(memberId, claimId).status).toBe(status);
    expect(validation.getCurrent(claims.findOne(memberId, claimId))).toMatchObject({
      readyToSubmit: initial.readyToSubmit,
      blockingIssueCount: initial.blockingIssueCount,
      warningCount: initial.warningCount
    });
  });

  it("keeps secondary-invoice blockers source-specific without mutating raw extraction", () => {
    const primary = persist(analysis("ATT-1", {
      extracted: { invoiceReference: "INV-PRIMARY" }
    }));
    const secondary = persist(analysis("ATT-2", {
      extracted: { invoiceReference: "INV-SECONDARY", providerName: null }
    }));
    const secondaryBeforeValidation = JSON.stringify(secondary);

    const result = validation.validate(
      memberId,
      claims.findOne(memberId, claimId),
      [primary, secondary],
      now
    );

    expect(result.issues.find((issue) => issue.code === "invoice_providerName_missing"))
      .toMatchObject({ attachmentId: "ATT-2", field: "providerName" });
    expect(result.issues.some((issue) =>
      issue.code === "invoice_providerName_missing" && issue.attachmentId === "ATT-1"
    )).toBe(false);
    expect(JSON.stringify(secondary)).toBe(secondaryBeforeValidation);
  });

  it("exposes the actual invoice attachment as the authoritative editable primary", () => {
    const itemizedReceipt = analysis("ATT-RECEIPT", {
      documentType: "payment_receipt",
      extracted: { invoiceReference: "DUPLICATE-REFERENCE" }
    });
    const actualInvoice = analysis("ATT-INVOICE", {
      documentType: "invoice",
      extracted: { invoiceReference: "DUPLICATE-REFERENCE" }
    });

    const built = review.buildReview(claimId, [itemizedReceipt, actualInvoice]);

    expect(built.extracted.invoices.map((invoice) => invoice.sourceAttachmentRef))
      .toEqual(["ATT-RECEIPT", "ATT-INVOICE"]);
    expect(built.extracted.invoices.map((invoice) => invoice.reference))
      .toEqual(["DUPLICATE-REFERENCE", "DUPLICATE-REFERENCE"]);
    expect(built.primaryInvoiceAttachmentId).toBe("ATT-INVOICE");
    expect(built.primaryInvoiceEvidenceUnitId).toBe("ATT-INVOICE:evidence:legacy:1");
  });

  it("selects a deterministic primary invoice unit by attachment and unit identity", () => {
    const mixed = multiRoleAnalysis("ATT-MULTI-INVOICE", [
      unit("payment_receipt", 1, {
        ...analysis("TEMP").extracted,
        invoiceReference: "DUPLICATE"
      }, ["dental"]),
      unit("invoice", 2, { invoiceReference: "DUPLICATE" }, ["dental"]),
      unit("invoice", 3, { invoiceReference: "DUPLICATE" }, ["dental"])
    ]);
    const built = review.buildReview(claimId, [mixed]);
    const actualInvoices = mixed.evidenceUnits!.filter((item) => item.documentType === "invoice");

    expect(built.primaryInvoiceAttachmentId).toBe("ATT-MULTI-INVOICE");
    expect(built.primaryInvoiceEvidenceUnitId).toBe(actualInvoices[0]!.evidenceUnitId);
    expect(built.primaryInvoiceEvidenceUnitId).not.toBe(
      mixed.evidenceUnits!.find((item) => item.documentType === "payment_receipt")!.evidenceUnitId
    );
    expect(actualInvoices.every((item) => item.extracted.invoiceReference === "DUPLICATE"))
      .toBe(true);
  });

  it("recognizes invoice, payment, and inpatient support roles independently inside one PDF", () => {
    setCategory("inpatient_surgery");
    const mixed = persist(multiRoleAnalysis("ATT-MIXED", [
      unit("invoice", 1, { paymentStatus: "unpaid" }, ["inpatient_surgery"]),
      unit("payment_receipt", 2, {
        patientName: null,
        providerLocation: null,
        invoiceReference: "PAY-1",
        billedAmount: 100,
        currency: "SAR",
        serviceLines: []
      }, ["inpatient_surgery"]),
      unit("medical_report", 3, {
        invoiceReference: null,
        invoiceDate: null,
        currency: null,
        billedAmount: null,
        paymentStatus: "unclear",
        serviceLines: [],
        diagnoses: [{ description: "Post-operative care", code: "Z48.8", codingSystem: "ICD-10" }]
      }, ["inpatient_surgery"])
    ]));

    const result = validation.validate(memberId, claims.findOne(memberId, claimId), [mixed], now);
    const codes = result.issues.map((issue) => issue.code);

    expect(codes).not.toContain("invoice_missing");
    expect(codes).not.toContain("payment_evidence_missing");
    expect(codes).not.toContain("inpatient_document_missing");
    expect(codes.some((code) => code.endsWith("_insufficient"))).toBe(false);
    const reopened = validation.getCurrent(claims.findOne(memberId, claimId));
    expect(reopened?.issues.map((issue) => issue.code)).not.toContain("inpatient_document_missing");
    expect(documents.list(memberId, claimId)[0]?.analysis?.evidenceUnits?.map(
      (unit) => [unit.documentType, unit.pageStart]
    )).toEqual([
      ["invoice", 1],
      ["payment_receipt", 2],
      ["medical_report", 3]
    ]);
  });

  it("uses unit roles rather than the attachment compatibility type for required evidence", () => {
    setCategory("inpatient_surgery");
    const compatibilityInvoice = multiRoleAnalysis("ATT-INVOICE-TOP", [
      unit("invoice", 1, {}, ["inpatient_surgery"]),
      unit("medical_report", 2, {
        serviceLines: [],
        diagnoses: [{ description: "Appendicitis", code: "K35.8", codingSystem: "ICD-10" }]
      }, ["inpatient_surgery"])
    ], "invoice");
    const inpatient = validation.validate(
      memberId, claims.findOne(memberId, claimId), [compatibilityInvoice], now
    );
    expect(inpatient.issues.some((issue) => issue.code === "inpatient_document_missing"))
      .toBe(false);

    setCategory("dental");
    const compatibilityOther = multiRoleAnalysis("ATT-OTHER-TOP", [
      unit("invoice", 1, {}, ["dental"])
    ], "other");
    const dental = validation.validate(
      memberId, claims.findOne(memberId, claimId), [compatibilityOther], now
    );
    expect(dental.issues.some((issue) => issue.code === "invoice_missing")).toBe(false);
  });

  it("lets a useful repeated role satisfy its group and keeps uncertain-only optical support non-blocking", () => {
    setCategory("inpatient_surgery");
    const repeatedReports = multiRoleAnalysis("ATT-REPORTS", [
      unit("invoice", 1, {}, ["inpatient_surgery"]),
      unit("medical_report", 2, { serviceLines: [], diagnoses: [] }, ["inpatient_surgery"]),
      unit("medical_report", 3, {
        serviceLines: [],
        diagnoses: [{ description: "Fracture", code: "S52.5", codingSystem: "ICD-10" }]
      }, ["inpatient_surgery"])
    ]);
    const complete = validation.validate(
      memberId, claims.findOne(memberId, claimId), [repeatedReports], now
    );
    expect(complete.issues.some((issue) =>
      issue.code === "inpatient_document_missing" || issue.code.endsWith("_insufficient")
    )).toBe(false);

    setCategory("optical", "frames");
    const uncertainOptical = persist(multiRoleAnalysis("ATT-OPTICAL", [
      unit("invoice", 1, { opticalFrameAmount: 100 }, ["optical"]),
      unit("prescription", 2, {
        patientName: "Alice Smith",
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
        serviceLines: []
      }, ["optical"])
    ]));
    const uncertain = validation.validate(
      memberId, claims.findOne(memberId, claimId), [uncertainOptical], now
    );
    expect(uncertain.issues.find((issue) => issue.code === "prescription_uncertain"))
      .toMatchObject({ severity: "warning", pageStart: 2 });
    expect(uncertain.blockingIssueCount).toBe(0);
    expect(uncertain.readyToSubmit).toBe(true);
  });

  it("consolidates financial and clinical units with distinct immutable provenance", () => {
    const mixed = multiRoleAnalysis("ATT-PROVENANCE", [
      unit("medical_report", 2, {
        patientName: "Alice Smith",
        providerName: "Riyadh Clinic",
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
        serviceLines: [],
        diagnoses: [{ description: "Dental caries", code: "K02.9", codingSystem: "ICD-10" }],
        procedures: [{ description: "Restoration", code: "PROC-9", codingSystem: null }]
      }, ["dental"]),
      unit("invoice", 1, {
        billedAmount: 850,
        subtotal: 850,
        paymentStatus: "unpaid"
      }, ["dental"]),
      unit("payment_receipt", 3, {
        invoiceReference: "PAY-850",
        currency: "SAR",
        billedAmount: 850,
        paymentStatus: "paid",
        paymentMethod: "card",
        cardNetwork: "mada"
      }, ["dental"])
    ]);
    const rawBefore = JSON.stringify(mixed.evidenceUnits);
    const built = review.buildReview(claimId, [mixed]);
    const invoiceUnit = mixed.evidenceUnits!.find((item) => item.documentType === "invoice")!;
    const reportUnit = mixed.evidenceUnits!.find((item) => item.documentType === "medical_report")!;
    const receiptUnit = mixed.evidenceUnits!.find((item) => item.documentType === "payment_receipt")!;

    expect(built.extracted.billedAmount).toBe(850);
    expect(built.extracted.paymentMethod).toBe("card");
    expect(built.extracted.diagnoses).toContainEqual(expect.objectContaining({
      code: "K02.9",
      sourceEvidenceUnitRefs: [reportUnit.evidenceUnitId]
    }));
    expect(built.extracted.procedures).toContainEqual(expect.objectContaining({
      code: "PROC-9",
      sourceEvidenceUnitRefs: [reportUnit.evidenceUnitId]
    }));
    expect(built.provenance.find((entry) => entry.field === "billedAmount"))
      .toMatchObject({ sourceEvidenceUnitRefs: [invoiceUnit.evidenceUnitId] });
    expect(built.provenance.find((entry) => entry.field === "paymentMethod"))
      .toMatchObject({ sourceEvidenceUnitRefs: [receiptUnit.evidenceUnitId] });
    expect(JSON.stringify(mixed.evidenceUnits)).toBe(rawBefore);

    const reorderedProviderInput = multiRoleAnalysis("ATT-PROVENANCE", [
      unit("invoice", 1, {
        billedAmount: 850,
        subtotal: 850,
        paymentStatus: "unpaid"
      }, ["dental"]),
      unit("medical_report", 2, {
        patientName: "Alice Smith",
        providerName: "Riyadh Clinic",
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
        serviceLines: [],
        diagnoses: [{ description: "Dental caries", code: "K02.9", codingSystem: "ICD-10" }],
        procedures: [{ description: "Restoration", code: "PROC-9", codingSystem: null }]
      }, ["dental"]),
      unit("payment_receipt", 3, {
        invoiceReference: "PAY-850",
        currency: "SAR",
        billedAmount: 850,
        paymentStatus: "paid",
        paymentMethod: "card",
        cardNetwork: "mada"
      }, ["dental"])
    ]);
    expect(review.buildReview(claimId, [reorderedProviderInput]).extracted)
      .toEqual(built.extracted);
  });

  it("keeps a strong kept-type mismatch blocking, grouped, bilingual, and non-confirmable", () => {
    setCategory("other_outpatient");
    const dentalEvidence = persist(multiRoleAnalysis("ATT-DENTAL", [
      unit("invoice", 1, {
        paymentStatus: "unpaid",
        serviceLines: [{
          ...analysis("TEMP").extracted.serviceLines[0]!,
          description: "Dental restoration",
          toothNumber: "16"
        }]
      }, ["dental"])
    ]));
    const result = validation.validate(
      memberId, claims.findOne(memberId, claimId), [dentalEvidence], now
    );
    const mismatch = result.issues.filter((issue) => issue.code === "category_mismatch");
    expect(claims.findOne(memberId, claimId).category).toBe("other_outpatient");
    expect(mismatch).toHaveLength(1);
    expect(mismatch[0]).toMatchObject({ severity: "blocking_error", pageStart: 1 });
    expect(mismatch[0]?.message).toContain("don't support");
    expect(mismatch[0]?.message).toContain("Upload documents that support");
    expect(mismatch[0]?.message).not.toContain("medical documents");
    expect(mismatch[0]?.messageAr).toBeTruthy();
    expect(mismatch[0]?.details).toEqual(expect.arrayContaining([
      expect.stringContaining("Dental"),
      "Tooth-specific treatment was detected."
    ]));
    expect(result.issues.some((issue) => issue.code === "payment_evidence_missing")).toBe(true);
    expect(result.readyToSubmit).toBe(false);
    expect(() => review.confirmIssue(
      memberId,
      claimId,
      "category_mismatch",
      mismatch[0]!.attachmentId,
      mismatch[0]!.evidenceUnitId ?? null
    )).toThrow(BadRequestException);
    const reopened = new ClaimValidationService(database, claims).getCurrent(
      claims.findOne(memberId, claimId)
    );
    expect(claims.findOne(memberId, claimId).category).toBe("other_outpatient");
    expect(reopened?.issues.filter((issue) => issue.code === "category_mismatch"))
      .toHaveLength(1);
    expect(reopened?.issues.find((issue) => issue.code === "category_mismatch"))
      .toMatchObject({
        severity: "blocking_error",
        details: expect.arrayContaining([expect.stringContaining("Dental")])
      });
    expect(reopened?.readyToSubmit).toBe(false);
  });

  it("applies the same category consistency rule to Dental vs Optical and warns on ambiguity", () => {
    setCategory("dental");
    const optical = persist(multiRoleAnalysis("ATT-OPTICAL-MISMATCH", [
      unit("invoice", 1, {
        opticalFrameAmount: 100
      }, ["optical"])
    ]));
    const mismatch = validation.validate(
      memberId, claims.findOne(memberId, claimId), [optical], now
    );
    expect(mismatch.issues.filter((issue) => issue.code === "category_mismatch")).toHaveLength(1);

    const ambiguous = persist(multiRoleAnalysis("ATT-AMBIGUOUS", [
      unit("invoice", 1, {}, ["dental", "optical"])
    ]));
    const warning = validation.validate(
      memberId, claims.findOne(memberId, claimId), [ambiguous], now
    );
    expect(warning.issues.some((issue) => issue.code === "category_mismatch")).toBe(false);
    expect(warning.issues.find((issue) => issue.code === "category_unclear"))
      .toMatchObject({ severity: "warning" });
    expect(warning.blockingIssueCount).toBe(0);
  });

  it("keeps repeated unit issue identities and confirmation keys separate from legacy issues", () => {
    const repeatedInvoices = persist(multiRoleAnalysis("ATT-TWO-INVOICES", [
      unit("invoice", 1, { providerName: null, invoiceReference: null }, ["dental"]),
      unit("invoice", 2, { providerName: null, invoiceReference: null }, ["dental"])
    ]));
    const result = validation.validate(
      memberId, claims.findOne(memberId, claimId), [repeatedInvoices], now
    );
    const blockers = result.issues.filter((issue) => issue.code === "invoice_providerName_missing");
    const warnings = result.issues.filter((issue) => issue.code === "invoice_reference_unclear");
    expect(blockers).toHaveLength(2);
    expect(new Set(blockers.map((issue) => issue.evidenceUnitId)).size).toBe(2);
    expect(new Set(warnings.map((issue) => validationIssueKey(
      issue.code, issue.attachmentId, issue.evidenceUnitId ?? null
    ))).size).toBe(2);

    const warning = warnings[0]!;
    review.confirmIssue(
      memberId, claimId, warning.code, warning.attachmentId, warning.evidenceUnitId ?? null
    );
    const revalidated = validation.validate(
      memberId, claims.findOne(memberId, claimId), [repeatedInvoices], now
    );
    expect(revalidated.issues.filter((issue) => issue.code === "invoice_reference_unclear"))
      .toHaveLength(1);

    const legacy = persist(analysis("ATT-LEGACY", { extracted: { invoiceReference: null } }));
    const legacyResult = validation.validate(
      memberId, claims.findOne(memberId, claimId), [legacy], now
    );
    expect(legacyResult.issues.find((issue) => issue.code === "invoice_reference_unclear"))
      .toMatchObject({
        attachmentId: "ATT-LEGACY",
        evidenceUnitId: "ATT-LEGACY:evidence:legacy:1",
        pageStart: null,
        pageEnd: null
      });
    expect(validationIssueKey(
      "invoice_reference_unclear",
      "ATT-LEGACY",
      "ATT-LEGACY:evidence:legacy:1"
    )).toBe("invoice_reference_unclear|ATT-LEGACY");
  });

  it("scopes claim-level confirmation keys and preserves legacy keys for their stored claim", () => {
    const claimA = claimId;
    const claimB = claims.create(memberId, {
      category: "dental",
      claimLocation: "local"
    }).claimId;
    const analysesA = [
      persistForClaim(analysis("ATT-A-1", { extracted: { providerName: "Provider A" } }), claimA),
      persistForClaim(analysis("ATT-A-2", { extracted: { providerName: "Provider B" } }), claimA)
    ];
    const analysesB = [
      persistForClaim(analysis("ATT-B-1", { extracted: { providerName: "Provider A" } }), claimB),
      persistForClaim(analysis("ATT-B-2", { extracted: { providerName: "Provider B" } }), claimB)
    ];

    const firstA = validation.validate(memberId, claims.findOne(memberId, claimA), analysesA, now);
    const firstB = validation.validate(memberId, claims.findOne(memberId, claimB), analysesB, now);
    expect(firstA.issues.find((issue) => issue.code === "provider_mismatch"))
      .toMatchObject({ attachmentId: null, evidenceUnitId: null, severity: "warning" });
    expect(firstB.issues.find((issue) => issue.code === "provider_mismatch"))
      .toMatchObject({ attachmentId: null, evidenceUnitId: null, severity: "warning" });

    review.confirmIssue(memberId, claimA, "provider_mismatch", null, null);
    expect(validation.validate(
      memberId, claims.findOne(memberId, claimA), analysesA, now
    ).issues.some((issue) => issue.code === "provider_mismatch")).toBe(false);
    expect(validation.validate(
      memberId, claims.findOne(memberId, claimB), analysesB, now
    ).issues.some((issue) => issue.code === "provider_mismatch")).toBe(true);

    review.confirmIssue(memberId, claimB, "provider_mismatch", null, null);
    expect(validation.validate(
      memberId, claims.findOne(memberId, claimB), analysesB, now
    ).issues.some((issue) => issue.code === "provider_mismatch")).toBe(false);
    expect(validation.validate(
      memberId, claims.findOne(memberId, claimA), analysesA, now
    ).issues.some((issue) => issue.code === "provider_mismatch")).toBe(false);
    expect(database.all<{ issue_key: string; claim_id: string }>(
      `SELECT issue_key, claim_id FROM validation_confirmations
       WHERE code = 'provider_mismatch' ORDER BY claim_id`
    )).toEqual([
      { issue_key: `provider_mismatch|claim|${claimA}`, claim_id: claimA },
      { issue_key: `provider_mismatch|claim|${claimB}`, claim_id: claimB }
    ]);

    const legacyClaim = claims.create(memberId, {
      category: "dental",
      claimLocation: "local"
    }).claimId;
    const legacyAnalyses = [
      persistForClaim(analysis("ATT-OLD-1", { extracted: { providerName: "Provider A" } }), legacyClaim),
      persistForClaim(analysis("ATT-OLD-2", { extracted: { providerName: "Provider B" } }), legacyClaim)
    ];
    database.run(
      `INSERT INTO validation_confirmations
       (issue_key, claim_id, code, attachment_id, evidence_unit_id, confirmed_at)
       VALUES (?, ?, 'provider_mismatch', NULL, NULL, ?)`,
      "provider_mismatch|claim",
      legacyClaim,
      now.toISOString()
    );
    expect(validation.validate(
      memberId, claims.findOne(memberId, legacyClaim), legacyAnalyses, now
    ).issues.some((issue) => issue.code === "provider_mismatch")).toBe(false);
  });

  it("supports legacy review data, requires fresh extraction for new submission, and preserves old submissions", () => {
    const legacy = persist({
      ...analysis("ATT-V2", { extracted: { invoiceReference: null } }),
      schemaVersion: 2,
      extractionVersion: "independent-document-v2-sbs",
      evidenceUnits: undefined
    });
    const initial = validation.validate(
      memberId, claims.findOne(memberId, claimId), [legacy], now
    );
    const warning = initial.issues.find((issue) => issue.code === "invoice_reference_unclear")!;
    expect(warning).toMatchObject({
      attachmentId: "ATT-V2",
      evidenceUnitId: "ATT-V2:evidence:legacy:1",
      pageStart: null,
      pageEnd: null,
      severity: "warning"
    });
    review.confirmIssue(
      memberId, claimId, warning.code, warning.attachmentId, warning.evidenceUnitId ?? null
    );

    const reloadedReview = new ClaimReviewService(database, claims);
    const reloadedValidation = new ClaimValidationService(database, claims);
    const afterReload = reloadedValidation.validate(
      memberId, claims.findOne(memberId, claimId), [legacy], now
    );
    expect(afterReload.issues.some((issue) => issue.code === "invoice_reference_unclear"))
      .toBe(false);

    const edited = reloadedReview.buildReview(claimId, [legacy]).extracted;
    reloadedReview.saveReview(memberId, claimId, [legacy], {
      ...edited,
      providerLocation: "Jeddah"
    });
    const revalidated = reloadedValidation.validate(
      memberId,
      claims.findOne(memberId, claimId),
      [legacy],
      now,
      reloadedReview.validationAnalyses(claimId, [legacy])
    );
    expect(revalidated.readyToSubmit).toBe(true);
    expect(reloadedReview.buildReview(claimId, [legacy]).extracted.providerLocation)
      .toBe("Jeddah");

    expect(() => submissions.submit(memberId, claimId, now)).toThrow(
      "Your documents need to be analyzed again before submission."
    );

    const storedClaimId = claims.create(memberId, {
      category: "dental",
      claimLocation: "local"
    }).claimId;
    const oldPayload = {
      schemaVersion: "1.2",
      claim: { referenceId: storedClaimId, status: "accepted_for_processing" },
      patient: { name: "Legacy Member" },
      provider: { name: "Legacy Provider", location: "Riyadh" },
      invoices: [],
      paymentEvidence: [],
      items: [],
      clinical: { admissionDate: null, dischargeDate: null, diagnoses: [], procedures: [] },
      attachments: [],
      sources: {},
      provenance: [],
      intake: {
        readyToSubmit: true,
        blockingIssueCount: 0,
        warningCount: 0,
        acceptedForProcessing: true
      },
      validationSnapshot: {
        claimId: storedClaimId,
        state: "ready",
        readyToSubmit: true,
        blockingIssueCount: 0,
        warningCount: 0,
        infoCount: 0,
        validatedAt: now.toISOString(),
        issues: []
      },
      unresolvedWarnings: [],
      rawDocumentExtractions: [],
      internalUncertainty: []
    };
    const oldPayloadJson = JSON.stringify(oldPayload);
    database.run(
      `INSERT INTO claim_submissions
       (claim_id, acceptance_reference, payload_json, submitted_at)
       VALUES (?, ?, ?, ?)`,
      storedClaimId,
      "ACK-LEGACY-STORED",
      oldPayloadJson,
      now.toISOString()
    );
    expect(submissions.findForMember(memberId, storedClaimId)?.payload).toEqual(oldPayload);
    expect(database.get<{ payload_json: string }>(
      "SELECT payload_json FROM claim_submissions WHERE claim_id = ?",
      storedClaimId
    )?.payload_json).toBe(oldPayloadJson);
  });

  it("adapts stored legacy service-line corrections without evidence-unit references", () => {
    const legacy = persist(analysis("ATT-LEGACY-CORRECTION"));
    const legacyLine = {
      ...legacy.extracted.serviceLines[0]!,
      description: "Member-corrected consultation",
      sourceAttachmentRefs: [legacy.attachmentId]
    };
    database.run(
      `INSERT INTO claim_review_corrections (claim_id, corrected_json, updated_at)
       VALUES (?, ?, ?)`,
      claimId,
      JSON.stringify({ serviceLines: [legacyLine] }),
      now.toISOString()
    );

    const built = review.buildReview(claimId, [legacy]);
    expect(built.extracted.serviceLines[0]).toMatchObject({
      description: "Member-corrected consultation",
      sourceAttachmentRefs: [legacy.attachmentId],
      sourceEvidenceUnitRefs: []
    });
    const effective = review.validationAnalyses(claimId, [legacy]);
    expect(effective[0]?.evidenceUnits?.[0]?.extracted.serviceLines[0]?.description)
      .toBe("Member-corrected consultation");
  });

  it("groups incomplete printed date evidence without inventing a future date", () => {
    const incomplete = unit("invoice", 1, { invoiceDate: null, serviceDate: null });
    incomplete.extracted.serviceLines[0]!.serviceDate = null;
    incomplete.dateEvidence = [{
      field: "invoiceDate",
      rawText: "August 2026",
      day: null,
      month: 8,
      year: 2026,
      precision: "month_year",
      normalizedDate: null
    }, {
      field: "serviceDate",
      serviceLineIndex: 0,
      rawText: "2026",
      day: null,
      month: null,
      year: 2026,
      precision: "year",
      normalizedDate: null
    }];
    const source = persist(multiRoleAnalysis("ATT-PARTIAL-DATE", [incomplete]));

    const result = validation.validate(memberId, claims.findOne(memberId, claimId), [source], now);
    const dateIssues = result.issues.filter((issue) => issue.field === "invoiceDate");
    expect(dateIssues.filter((issue) => issue.code === "invoice_date_incomplete")).toHaveLength(1);
    expect(dateIssues.some((issue) => issue.code === "invoice_date_future")).toBe(false);
    expect(dateIssues.some((issue) => issue.code === "invoice_invoiceDate_missing")).toBe(false);
    expect(dateIssues[0]).toMatchObject({ severity: "blocking_error", messageAr: expect.any(String) });
    expect(result.issues.some((issue) =>
      issue.code === "service_date_incomplete" && issue.field === "serviceLines"
    )).toBe(true);
  });

  it("blocks only confidently duplicated invoice evidence and preserves receipt identity", () => {
    const first = unit("invoice", 1);
    const duplicate = unit("invoice", 2);
    const receipt = unit("payment_receipt", 3, {
      invoiceReference: "INV-1",
      invoiceDate: "2026-08-01",
      currency: "SAR",
      billedAmount: 100,
      paymentStatus: "paid"
    });
    const source = persist(multiRoleAnalysis("ATT-DUPLICATE-INVOICE", [first, duplicate, receipt]));

    const result = validation.validate(memberId, claims.findOne(memberId, claimId), [source], now);
    const duplicates = result.issues.filter((issue) => issue.code === "duplicate_invoice_evidence");
    expect(duplicates).toHaveLength(1);
    expect(duplicates[0]).toMatchObject({
      attachmentId: "ATT-DUPLICATE-INVOICE",
      evidenceUnitId: source.evidenceUnits?.[1]?.evidenceUnitId,
      pageStart: 2,
      severity: "blocking_error"
    });
    expect(duplicates[0]?.evidenceUnitId).not.toBe(source.evidenceUnits?.[2]?.evidenceUnitId);
  });

  it("records uncertainty from each evidence unit in a mixed attachment", () => {
    const optional = unit("medical_report", 2);
    optional.readability = "unreadable";
    optional.missingOrUnclear = ["diagnosis"];
    const source = persist(multiRoleAnalysis("ATT-UNIT-UNCERTAINTY", [
      unit("invoice", 1),
      optional
    ]));

    const submission = submissions.submit(memberId, claimId, now);
    expect(submission.payload.schemaVersion).toBe("1.2");
    expect(submission.payload.internalUncertainty[0]).toMatchObject({
      attachmentReference: "ATT-UNIT-UNCERTAINTY",
      level: "high"
    });
    expect(submission.payload.internalUncertainty[0]?.reasons).toEqual(expect.arrayContaining([
      expect.stringContaining(`${source.evidenceUnits?.[1]?.evidenceUnitId}:page:2:medical_report:readability:unreadable`),
      expect.stringContaining(`${source.evidenceUnits?.[1]?.evidenceUnitId}:page:2:medical_report:missing_or_unclear:diagnosis`)
    ]));
  });

  it("preserves conflicting service-date sources until a member correction resolves them", () => {
    const first = unit("invoice", 1, { serviceDate: "2026-08-05" });
    const second = unit("medical_report", 2, { serviceDate: "2026-08-07" });
    first.dateEvidence = [{ field: "serviceDate", rawText: "5 Aug 2026", day: 5, month: 8, year: 2026, precision: "complete", normalizedDate: "2026-08-05" }];
    second.dateEvidence = [{ field: "serviceDate", rawText: "7 Aug 2026", day: 7, month: 8, year: 2026, precision: "complete", normalizedDate: "2026-08-07" }];
    const raw = persist(multiRoleAnalysis("ATT-DATE-CONFLICT", [first, second]));
    const before = review.buildReview(claimId, [raw]);
    expect(before.extracted.serviceDate).toBeNull();
    const blocked = validation.validate(memberId, claims.findOne(memberId, claimId), [raw], now);
    expect(blocked.issues.filter((issue) => issue.code === "service_date_conflict")).toHaveLength(1);

    review.saveReview(memberId, claimId, [raw], {
      ...before.extracted,
      serviceDate: "2026-08-05"
    });
    const effective = review.validationAnalyses(claimId, [raw]);
    const resolved = validation.validate(memberId, claims.findOne(memberId, claimId), [raw], now, effective);
    expect(resolved.issues.some((issue) => issue.code === "service_date_conflict")).toBe(false);
    expect(raw.evidenceUnits?.map((item) => item.dateEvidence?.[0]?.rawText))
      .toEqual(["5 Aug 2026", "7 Aug 2026"]);
    expect(review.buildReview(claimId, [raw]).provenance.find((item) => item.field === "serviceDate"))
      .toMatchObject({ sourceValue: null, memberValue: "2026-08-05", effectiveValue: "2026-08-05", editedByMember: true });
  });

  it("does not substitute invoice dates for missing service dates", () => {
    const raw = persist(analysis("ATT-SEMANTIC-DATE", {
      extracted: { invoiceDate: "2026-08-01", serviceDate: null }
    }));
    const built = review.buildReview(claimId, [raw]).extracted;
    expect(built.invoiceDate).toBe("2026-08-01");
    expect(built.serviceDate).toBeNull();
  });

  it("persists member clinical-description corrections without changing raw extraction", () => {
    const raw = persist(analysis("ATT-CLINICAL-EDIT", {
      documentType: "medical_report",
      extracted: {
        diagnoses: [{ description: "Original diagnosis", code: "K02.9", codingSystem: "ICD-10" }]
      }
    }));
    const built = review.buildReview(claimId, [raw]);
    const providerRerun = jest.spyOn(intelligence, "analyseAll");
    review.saveReview(memberId, claimId, [raw], {
      ...built.extracted,
      diagnoses: built.extracted.diagnoses.map((item) => ({ ...item, description: "Corrected diagnosis" }))
    });
    const reloaded = new ClaimReviewService(database, claims).buildReview(claimId, [raw]);
    expect(reloaded.extracted.diagnoses[0]?.description).toBe("Corrected diagnosis");
    expect(reloaded.editedFields).toContain("diagnoses");
    expect(reloaded.provenance.find((item) => item.field === "diagnoses")?.editedByMember).toBe(true);
    expect(raw.extracted.diagnoses[0]?.description).toBe("Original diagnosis");
    expect(reloaded.extracted.diagnoses[0]?.code).toBe("K02.9");
    expect(providerRerun).not.toHaveBeenCalled();
  });

  function setCategory(
    category: "inpatient_surgery" | "dental" | "optical" | "other_outpatient",
    opticalItem?: "frames" | "lenses" | "both"
  ) {
    claims.update(memberId, claimId, { category, opticalItem });
  }

  function persist(value: DocumentAnalysisResult) {
    return persistForClaim(value, claimId);
  }

  function persistForClaim(value: DocumentAnalysisResult, targetClaimId: string) {
    const createdAt = now.toISOString();
    database.run(
      `INSERT INTO attachments
       (attachment_id, claim_id, original_filename, stored_filename, mime_type, size_bytes, document_type, created_at)
       VALUES (?, ?, ?, ?, 'application/pdf', 100, ?, ?)`,
      value.attachmentId,
      targetClaimId,
      `${value.attachmentId}.pdf`,
      `${value.attachmentId}.pdf`,
      value.documentType,
      createdAt
    );
    database.run(
      `INSERT INTO extraction_results (attachment_id, result_json, created_at)
       VALUES (?, ?, ?)`,
      value.attachmentId,
      JSON.stringify(value),
      createdAt
    );
    return value;
  }

  function unit(
    documentType: DocumentType,
    page: number,
    extracted: Partial<ExtractedDocumentFields> = {},
    detectedCategories: DocumentAnalysisResult["detectedCategories"] = []
  ): ProviderEvidenceUnit {
    const defaults = documentType === "invoice"
      ? analysis("UNIT").extracted
      : blankExtractedFields();
    return {
      pageStart: page,
      pageEnd: page,
      documentType,
      readability: "readable" as const,
      relevance: "relevant" as const,
      detectedCategories,
      detectedOpticalItems: [] as DocumentAnalysisResult["detectedOpticalItems"],
      summary: `${documentType} evidence`,
      extracted: { ...defaults, ...extracted },
      missingOrUnclear: []
    };
  }

  function multiRoleAnalysis(
    attachmentId: string,
    units: ReturnType<typeof unit>[],
    compatibilityType: DocumentType = "invoice"
  ): DocumentAnalysisResult {
    const base = analysis(attachmentId, { documentType: compatibilityType });
    return {
      ...base,
      evidenceUnits: createEvidenceUnits(attachmentId, units)
    };
  }

  function analysis(
    attachmentId: string,
    overrides: Partial<Omit<DocumentAnalysisResult, "extracted">> & {
      extracted?: Partial<ExtractedDocumentFields>;
    } = {}
  ): DocumentAnalysisResult {
    const extracted: ExtractedDocumentFields = {
      ...blankExtractedFields(),
      patientName: "Alice Smith",
      providerName: "Riyadh Clinic",
      providerLocation: "Riyadh",
      invoiceReference: "INV-1",
      invoiceDate: "2026-08-01",
      serviceDate: "2026-08-01",
      currency: "SAR",
      subtotal: 100,
      taxAmount: 0,
      discountAmount: 0,
      billedAmount: 100,
      paymentStatus: "paid",
      serviceLines: [{
        description: "Consultation",
        serviceDate: "2026-08-01",
        quantity: 1,
        unitPrice: 100,
        billedAmount: 100,
        currency: "SAR",
        diagnosisText: null,
        diagnosisCode: null,
        procedureCode: null,
        sbsCode: null,
        sbsDescription: null,
        toothNumber: null
      }],
      ...overrides.extracted
    };
    const { extracted: _extracted, ...rest } = overrides;
    return {
      attachmentId,
      schemaVersion: DOCUMENT_ANALYSIS_SCHEMA_VERSION,
      extractionVersion: DOCUMENT_EXTRACTION_VERSION,
      analysisStatus: "complete",
      provider: "test",
      model: null,
      analysedAt: now.toISOString(),
      readability: "readable",
      relevance: "relevant",
      documentType: "invoice",
      detectedCategories: ["dental"],
      detectedOpticalItems: [],
      summary: "Test document",
      extracted,
      missingOrUnclear: [],
      ...rest
    };
  }
});
