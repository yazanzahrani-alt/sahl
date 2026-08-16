import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { DatabaseService } from "../database/database.service";
import {
  blankExtractedFields,
  getEvidenceUnits,
  type DocumentAnalysisResult,
  type EvidenceUnit,
  type ExtractedDocumentFields,
  type ExtractedDiagnosis,
  type ExtractedProcedure
} from "../document-intelligence/document-analysis";
import {
  DATE_FIELDS,
  dateEvidenceFor,
  type DateField
} from "../document-intelligence/date-evidence";
import {
  claimEvidenceUnits,
  type ClaimEvidenceUnit
} from "../document-intelligence/claim-evidence";
import { validationIssueKey, type ValidationIssue } from "../validation/validation";
import type { AttachmentRecord } from "./attachment";
import { ClaimsService } from "./claims.service";
import type { ClaimCategory } from "./claim";
import { calculateSubmissionTiming } from "./synthetic-demo-policy";
import type {
  ConsolidatedClaimFields,
  ConsolidatedInvoice,
  ConsolidatedPaymentEvidence,
  ClaimEvidenceSource,
  ClaimFieldProvenance,
  MemberEditedField,
  SourceLinkedServiceLine,
  SourceLinkedDiagnosis,
  SourceLinkedProcedure
} from "./claim-review";

interface ReviewCorrectionRow {
  corrected_json: string;
  updated_at: string;
}

interface IssueRow {
  state: string;
}

type EditableReviewFields = Omit<ExtractedDocumentFields, "serviceLines" | "diagnoses" | "procedures"> & {
  serviceLines: SourceLinkedServiceLine[];
  diagnoses: SourceLinkedDiagnosis[];
  procedures: SourceLinkedProcedure[];
};

type ReviewCorrections = Partial<Omit<
  ExtractedDocumentFields,
  "serviceLines" | "diagnoses" | "procedures"
>> & {
  serviceLines?: SourceLinkedServiceLine[];
  diagnoses?: SourceLinkedDiagnosis[];
  procedures?: SourceLinkedProcedure[];
};

const SHARED_FIELDS = [
  "patientName",
  "providerName",
  "providerLocation",
  "serviceDate",
  "admissionDate",
  "dischargeDate"
] as const satisfies readonly (keyof ExtractedDocumentFields)[];

const INVOICE_FIELDS = [
  "invoiceReference",
  "invoiceDate",
  "currency",
  "subtotal",
  "taxAmount",
  "discountAmount",
  "billedAmount",
  "paymentStatus",
  "paymentMethod",
  "cardNetwork",
  "opticalFrameAmount",
  "opticalLensAmount"
] as const satisfies readonly (keyof ExtractedDocumentFields)[];

const PAYMENT_FIELDS = [
  "paymentStatus",
  "paymentMethod",
  "cardNetwork"
] as const satisfies readonly (keyof ExtractedDocumentFields)[];

const EDITABLE_FIELDS = [
  ...SHARED_FIELDS,
  ...INVOICE_FIELDS,
  "serviceLines",
  "diagnoses",
  "procedures"
] as const;

@Injectable()
export class ClaimReviewService {
  constructor(
    private readonly database: DatabaseService,
    private readonly claims: ClaimsService
  ) {}

  enrichAttachments(claimId: string, attachments: AttachmentRecord[]) {
    void claimId;
    return attachments;
  }

  buildReview(
    claimId: string,
    analyses: DocumentAnalysisResult[],
    validationIssues: ValidationIssue[] = [],
    category?: ClaimCategory
  ) {
    const base = this.consolidate(analyses);
    const saved = this.savedCorrections(claimId);
    const extracted = this.applyCorrections(base.extracted, saved?.value);
    return {
      primaryInvoiceAttachmentId: base.primaryInvoice?.attachmentId ?? null,
      primaryInvoiceEvidenceUnitId: base.primaryInvoice?.evidenceUnitId ?? null,
      extracted,
      sources: base.sources,
      evidenceSources: base.evidenceSources,
      editedFields: saved ? this.editedFields(saved.value) : [],
      editedAt: saved?.updatedAt ?? null,
      timing: calculateSubmissionTiming(category, extracted.serviceDate),
      provenance: this.buildProvenance(
        base.extracted,
        extracted,
        base.sources,
        base.evidenceSources,
        saved?.value,
        validationIssues
      )
    };
  }

  validationAnalyses(claimId: string, analyses: DocumentAnalysisResult[]) {
    const corrections = this.savedCorrections(claimId)?.value;
    if (!corrections || analyses.length === 0) return analyses;

    const primary = this.primaryInvoice(claimEvidenceUnits(analyses));
    const firstClinicalId = claimEvidenceUnits(analyses)
      .find((unit) => this.isClinicalEvidence(unit))?.evidenceUnitId;
    return analyses.map((analysis) => {
      const extracted = { ...analysis.extracted };
      for (const field of SHARED_FIELDS) {
        if (!(field in corrections)) continue;
        if (analysis.attachmentId === primary.attachmentId || this.hasValue(extracted[field])) {
          this.assign(extracted, field, corrections[field]);
        }
      }
      if (analysis.attachmentId === primary.attachmentId) {
        for (const field of INVOICE_FIELDS) {
          if (field in corrections) this.assign(extracted, field, corrections[field]);
        }
      }
      if (corrections.serviceLines && this.isInvoiceEvidence(analysis)) {
        extracted.serviceLines = corrections.serviceLines
          .filter((line) => (line.sourceAttachmentRefs ?? []).includes(analysis.attachmentId))
          .map(({ sourceAttachmentRefs: _sourceAttachmentRefs, ...line }) => line);
      }
      const evidenceUnits = getEvidenceUnits(analysis).map((unit) => {
        const unitExtracted = { ...unit.extracted };
        const isPrimary = unit.evidenceUnitId === primary.evidenceUnitId;
        for (const field of SHARED_FIELDS) {
          if (!(field in corrections)) continue;
          if (isPrimary || this.hasValue(unitExtracted[field])) {
            this.assign(unitExtracted, field, corrections[field]);
          }
        }
        if (isPrimary) {
          for (const field of INVOICE_FIELDS) {
            if (field in corrections) this.assign(unitExtracted, field, corrections[field]);
          }
        }
        if (corrections.serviceLines && this.isInvoiceEvidence(unit)) {
          unitExtracted.serviceLines = corrections.serviceLines
            .filter((line) => (line.sourceEvidenceUnitRefs ?? []).includes(unit.evidenceUnitId) ||
              ((line.sourceEvidenceUnitRefs ?? []).length === 0 &&
                (line.sourceAttachmentRefs ?? []).includes(unit.attachmentId)))
            .map(({
              sourceAttachmentRefs: _sourceAttachmentRefs,
              sourceEvidenceUnitRefs: _sourceEvidenceUnitRefs,
              ...line
            }) => line);
        }
        if (unit.evidenceUnitId === firstClinicalId) {
          if (corrections.diagnoses) {
            unitExtracted.diagnoses = corrections.diagnoses.map(
              ({ sourceAttachmentRefs: _attachments, sourceEvidenceUnitRefs: _units, ...item }) => item
            );
          }
          if (corrections.procedures) {
            unitExtracted.procedures = corrections.procedures.map(
              ({ sourceAttachmentRefs: _attachments, sourceEvidenceUnitRefs: _units, ...item }) => item
            );
          }
        }
        return { ...unit, extracted: unitExtracted };
      });
      return { ...analysis, extracted, evidenceUnits };
    });
  }

  saveReview(
    memberId: string,
    claimId: string,
    analyses: DocumentAnalysisResult[],
    extracted: Record<string, unknown>
  ) {
    const claim = this.claims.findOne(memberId, claimId);
    if (claim.status === "accepted_for_processing") {
      throw new BadRequestException("An accepted claim cannot be changed.");
    }
    if (analyses.length === 0) {
      throw new BadRequestException("Finish document analysis before editing claim information.");
    }

    const base = this.consolidate(analyses).extracted;
    const normalised = this.normaliseFields(extracted);
    const evidence = claimEvidenceUnits(analyses);
    const allowedAttachmentIds = new Set(analyses.map((analysis) => analysis.attachmentId));
    const allowedEvidenceUnitIds = new Set(evidence.map((unit) => unit.evidenceUnitId));
    const primary = this.primaryInvoice(evidence);
    const unmatchedSourceLines = [...base.serviceLines];
    normalised.serviceLines = normalised.serviceLines.map((line) => {
      const sourceAttachmentRefs = line.sourceAttachmentRefs.filter((id) =>
        allowedAttachmentIds.has(id)
      );
      const sourceEvidenceUnitRefs = line.sourceEvidenceUnitRefs.filter((id) =>
        allowedEvidenceUnitIds.has(id)
      );
      const sourceLine = this.matchSourceLine(
        line,
        sourceAttachmentRefs,
        sourceEvidenceUnitRefs,
        unmatchedSourceLines
      );
      if (sourceLine) {
        unmatchedSourceLines.splice(unmatchedSourceLines.indexOf(sourceLine), 1);
      }
      return {
        ...line,
        // Printed technical codes are source evidence, not member-entered data.
        diagnosisCode: sourceLine?.diagnosisCode ?? null,
        procedureCode: sourceLine?.procedureCode ?? null,
        sbsCode: sourceLine?.sbsCode ?? null,
        sbsDescription: sourceLine?.sbsDescription ?? null,
        sourceAttachmentRefs: sourceAttachmentRefs.length > 0
          ? sourceAttachmentRefs
          : [primary.attachmentId],
        sourceEvidenceUnitRefs: sourceEvidenceUnitRefs.length > 0
          ? sourceEvidenceUnitRefs
          : [primary.evidenceUnitId]
      };
    });
    normalised.diagnoses = this.preserveClinicalSources(normalised.diagnoses, base.diagnoses);
    normalised.procedures = this.preserveClinicalSources(normalised.procedures, base.procedures);
    const corrections: ReviewCorrections = {};
    for (const field of EDITABLE_FIELDS) {
      if (!this.valuesEquivalent(base[field], normalised[field])) {
        this.assign(corrections, field, normalised[field]);
      }
    }
    const updatedAt = new Date().toISOString();

    this.database.transaction(() => {
      if (Object.keys(corrections).length === 0) {
        this.database.run(
          "DELETE FROM claim_review_corrections WHERE claim_id = ?",
          claimId
        );
      } else {
        this.database.run(
          `INSERT INTO claim_review_corrections
           (claim_id, corrected_json, updated_at)
           VALUES (?, ?, ?)
           ON CONFLICT(claim_id) DO UPDATE SET
             corrected_json = excluded.corrected_json,
             updated_at = excluded.updated_at`,
          claimId,
          JSON.stringify(corrections),
          updatedAt
        );
      }
      this.claims.invalidateValidationInCurrentTransaction(memberId, claimId);
    });
  }

  confirmIssue(
    memberId: string,
    claimId: string,
    code: string,
    attachmentId: string | null,
    evidenceUnitId: string | null
  ) {
    const claim = this.claims.findOne(memberId, claimId);
    if (claim.status === "accepted_for_processing") {
      throw new BadRequestException("An accepted claim cannot be changed.");
    }
    const issue = this.database.get<IssueRow>(
      `SELECT state FROM validation_issues
       WHERE claim_id = ? AND code = ?
         AND ((attachment_id = ?) OR (attachment_id IS NULL AND ? IS NULL))
         AND ((evidence_unit_id = ?) OR (evidence_unit_id IS NULL AND ? IS NULL))`,
      claimId,
      code,
      attachmentId,
      attachmentId,
      evidenceUnitId,
      evidenceUnitId
    );
    if (!issue) throw new NotFoundException("Review item not found");
    if (issue.state !== "needs_review") {
      throw new BadRequestException("This item must be corrected rather than confirmed.");
    }

    this.database.run(
      `INSERT INTO validation_confirmations
       (issue_key, claim_id, code, attachment_id, evidence_unit_id, confirmed_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(issue_key) DO UPDATE SET confirmed_at = excluded.confirmed_at`,
      validationIssueKey(code, attachmentId, evidenceUnitId, claimId),
      claimId,
      code,
      attachmentId,
      evidenceUnitId,
      new Date().toISOString()
    );
  }

  private consolidate(analyses: DocumentAnalysisResult[]) {
    const evidence = claimEvidenceUnits(analyses);
    if (evidence.length === 0) {
      return {
        extracted: {
          ...blankExtractedFields(),
          serviceLines: [],
          diagnoses: [],
          procedures: [],
          invoices: [],
          paymentEvidence: []
        } satisfies ConsolidatedClaimFields,
        sources: {} as Record<string, string[]>,
        evidenceSources: {} as Record<string, ClaimEvidenceSource[]>,
        primaryInvoice: null as ClaimEvidenceUnit | null
      };
    }
    const primary = this.primaryInvoice(evidence);
    const invoiceEvidence = evidence.filter((unit) => this.isInvoiceEvidence(unit));
    const clinicalEvidence = evidence.filter((unit) => this.isClinicalEvidence(unit));
    const paymentFieldEvidence = [
      primary,
      ...evidence.filter((unit) =>
        unit.evidenceUnitId !== primary.evidenceUnitId &&
        (this.isInvoiceEvidence(unit) || unit.documentType === "payment_receipt")
      )
    ];
    const invoices = invoiceEvidence.map((unit) => this.invoiceFrom(unit));
    const serviceLines = invoices.flatMap((invoice) => invoice.items);
    const diagnoses = this.consolidateDiagnoses(clinicalEvidence);
    const procedures = this.consolidateProcedures(clinicalEvidence);
    const paymentEvidence = this.consolidatePaymentEvidence(evidence);
    const extracted: ConsolidatedClaimFields = {
      ...blankExtractedFields(),
      serviceLines,
      diagnoses,
      procedures,
      invoices,
      paymentEvidence
    };
    const sources: Record<string, string[]> = {};
    const evidenceSources: Record<string, ClaimEvidenceSource[]> = {};

    for (const field of [...SHARED_FIELDS, ...INVOICE_FIELDS]) {
      const candidates = field === "admissionDate" || field === "dischargeDate"
        ? clinicalEvidence
        : PAYMENT_FIELDS.includes(field as typeof PAYMENT_FIELDS[number])
          ? paymentFieldEvidence
        : INVOICE_FIELDS.includes(field as typeof INVOICE_FIELDS[number])
          ? invoiceEvidence
          : [primary, ...evidence.filter((unit) => unit.evidenceUnitId !== primary.evidenceUnitId)];
      if (DATE_FIELDS.includes(field as DateField)) {
        const dateField = field as DateField;
        const matching = candidates.filter((unit) =>
          dateEvidenceFor(dateField, unit.extracted[dateField], unit.dateEvidence) !== null
        );
        sources[field] = [...new Set(matching.map((unit) => unit.attachmentId))];
        evidenceSources[field] = matching.map((unit) => this.evidenceSource(unit));
        const completeValues = [...new Set(matching.flatMap((unit) => {
          const item = dateEvidenceFor(dateField, unit.extracted[dateField], unit.dateEvidence);
          return item?.precision === "complete" && item.normalizedDate
            ? [item.normalizedDate]
            : [];
        }))];
        if (completeValues.length === 1) this.assign(extracted, field, completeValues[0]);
        continue;
      }
      const matching = candidates.filter((unit) =>
        this.hasConsolidatableValue(field, unit.extracted[field])
      );
      sources[field] = [...new Set(matching.map((unit) => unit.attachmentId))];
      evidenceSources[field] = matching.map((unit) => this.evidenceSource(unit));
      if (matching[0]) {
        this.assign(extracted, field, matching[0].extracted[field]);
      }
    }

    sources.serviceLines = [...new Set(serviceLines.flatMap((line) => line.sourceAttachmentRefs))];
    sources.diagnoses = [...new Set(diagnoses.flatMap((item) => item.sourceAttachmentRefs))];
    sources.procedures = [...new Set(procedures.flatMap((item) => item.sourceAttachmentRefs))];
    sources.invoices = invoices.map((invoice) => invoice.sourceAttachmentRef);
    sources.paymentEvidence = paymentEvidence.map((item) => item.sourceAttachmentRef);
    evidenceSources.serviceLines = this.uniqueEvidenceSources(
      serviceLines.flatMap((line) => line.sourceEvidenceUnitRefs), evidence
    );
    evidenceSources.diagnoses = this.uniqueEvidenceSources(
      diagnoses.flatMap((item) => item.sourceEvidenceUnitRefs), evidence
    );
    evidenceSources.procedures = this.uniqueEvidenceSources(
      procedures.flatMap((item) => item.sourceEvidenceUnitRefs), evidence
    );
    evidenceSources.invoices = invoices.flatMap((invoice) =>
      evidence.filter((unit) => unit.evidenceUnitId === invoice.sourceEvidenceUnitRef)
        .map((unit) => this.evidenceSource(unit))
    );
    evidenceSources.paymentEvidence = paymentEvidence.flatMap((item) =>
      evidence.filter((unit) => unit.evidenceUnitId === item.sourceEvidenceUnitRef)
        .map((unit) => this.evidenceSource(unit))
    );

    return { extracted, sources, evidenceSources, primaryInvoice: primary };
  }

  private applyCorrections(
    base: ConsolidatedClaimFields,
    corrections: ReviewCorrections | undefined
  ): ConsolidatedClaimFields {
    if (!corrections) return base;
    const corrected = { ...base, ...corrections } as ConsolidatedClaimFields;
    if (corrections.serviceLines) {
      corrected.serviceLines = corrections.serviceLines.map((line) => ({
        ...line,
        sourceAttachmentRefs: line.sourceAttachmentRefs ?? [],
        sourceEvidenceUnitRefs: line.sourceEvidenceUnitRefs ?? []
      }));
      corrected.invoices = base.invoices.map((invoice) => ({
        ...invoice,
        items: corrected.serviceLines.filter((line) =>
          line.sourceEvidenceUnitRefs.includes(invoice.sourceEvidenceUnitRef) ||
          (line.sourceEvidenceUnitRefs.length === 0 &&
            line.sourceAttachmentRefs.includes(invoice.sourceAttachmentRef))
        )
      }));
    }
    if (corrected.invoices.length > 0) {
      const invoice = corrected.invoices[0];
      corrected.invoices = [{
        ...invoice,
        reference: corrected.invoiceReference,
        invoiceDate: corrected.invoiceDate,
        serviceDate: corrected.serviceDate,
        currency: corrected.currency,
        subtotal: corrected.subtotal,
        discountAmount: corrected.discountAmount,
        taxAmount: corrected.taxAmount,
        billedAmount: corrected.billedAmount,
        paymentStatus: corrected.paymentStatus,
        paymentMethod: corrected.paymentMethod,
        cardNetwork: corrected.cardNetwork,
        items: corrected.serviceLines.filter((line) =>
          line.sourceEvidenceUnitRefs.includes(invoice.sourceEvidenceUnitRef) ||
          (line.sourceEvidenceUnitRefs.length === 0 &&
            line.sourceAttachmentRefs.includes(invoice.sourceAttachmentRef))
        )
      }, ...corrected.invoices.slice(1)];
    }
    corrected.paymentEvidence = [
      ...base.paymentEvidence.filter((item) => item.evidenceType === "payment_receipt"),
      ...corrected.invoices
        .filter((invoice) => invoice.paymentStatus === "paid")
        .map((invoice) => ({
          reference: invoice.reference,
          date: invoice.invoiceDate ?? invoice.serviceDate,
          providerName: corrected.providerName,
          currency: invoice.currency,
          amount: invoice.billedAmount,
          paymentMethod: invoice.paymentMethod,
          cardNetwork: invoice.cardNetwork,
          evidenceType: "paid_invoice" as const,
          sourceAttachmentRef: invoice.sourceAttachmentRef,
          sourceEvidenceUnitRef: invoice.sourceEvidenceUnitRef
        }))
    ];
    return corrected;
  }

  private isInvoiceEvidence(unit: Pick<EvidenceUnit, "documentType" | "extracted">) {
    const itemized = unit.extracted.serviceLines.some(
      (line) => Boolean(line.description?.trim()) && line.billedAmount !== null
    );
    return unit.documentType === "invoice" ||
      (unit.documentType === "payment_receipt" && itemized);
  }

  private invoiceFrom(unit: ClaimEvidenceUnit): ConsolidatedInvoice {
    const fields = unit.extracted;
    return {
      reference: fields.invoiceReference,
      invoiceDate: fields.invoiceDate,
      serviceDate: fields.serviceDate,
      currency: fields.currency,
      subtotal: fields.subtotal,
      discountAmount: fields.discountAmount,
      taxAmount: fields.taxAmount,
      billedAmount: fields.billedAmount,
      paymentStatus: fields.paymentStatus,
      paymentMethod: fields.paymentMethod,
      cardNetwork: fields.cardNetwork,
      sourceAttachmentRef: unit.attachmentId,
      sourceEvidenceUnitRef: unit.evidenceUnitId,
      items: fields.serviceLines.map((line) => ({
        ...line,
        sourceAttachmentRefs: [unit.attachmentId],
        sourceEvidenceUnitRefs: [unit.evidenceUnitId]
      }))
    };
  }

  private matchSourceLine(
    line: SourceLinkedServiceLine,
    sourceAttachmentRefs: string[],
    sourceEvidenceUnitRefs: string[],
    candidates: SourceLinkedServiceLine[]
  ) {
    const matchingSources = candidates.filter((candidate) =>
      candidate.sourceEvidenceUnitRefs.some((id) => sourceEvidenceUnitRefs.includes(id)) ||
      (sourceEvidenceUnitRefs.length === 0 &&
        candidate.sourceAttachmentRefs.some((id) => sourceAttachmentRefs.includes(id)))
    );
    if (matchingSources.length === 1) return matchingSources[0];
    if (matchingSources.length === 0) return undefined;

    const editableLineFields = [
      "description",
      "serviceDate",
      "quantity",
      "unitPrice",
      "billedAmount",
      "currency",
      "diagnosisText",
      "toothNumber"
    ] as const;
    const ranked = matchingSources
      .map((candidate) => ({
        candidate,
        score: editableLineFields.filter((field) =>
          this.hasValue(line[field]) && this.valuesEquivalent(line[field], candidate[field])
        ).length
      }))
      .sort((left, right) => right.score - left.score);
    return ranked[0].score > 0 && ranked[0].score > (ranked[1]?.score ?? -1)
      ? ranked[0].candidate
      : undefined;
  }

  private consolidatePaymentEvidence(
    evidence: ClaimEvidenceUnit[]
  ): ConsolidatedPaymentEvidence[] {
    return evidence.flatMap((unit) => {
      const isReceipt = unit.documentType === "payment_receipt" &&
        !this.isInvoiceEvidence(unit);
      const isPaidInvoice = this.isInvoiceEvidence(unit) &&
        unit.extracted.paymentStatus === "paid";
      if (!isReceipt && !isPaidInvoice) return [];
      const fields = unit.extracted;
      return [{
        reference: fields.invoiceReference,
        date: fields.invoiceDate ?? fields.serviceDate,
        providerName: fields.providerName,
        currency: fields.currency,
        amount: fields.billedAmount,
        paymentMethod: fields.paymentMethod,
        cardNetwork: fields.cardNetwork,
        evidenceType: isPaidInvoice ? "paid_invoice" as const : "payment_receipt" as const,
        sourceAttachmentRef: unit.attachmentId,
        sourceEvidenceUnitRef: unit.evidenceUnitId
      }];
    });
  }

  private consolidateDiagnoses(evidence: ClaimEvidenceUnit[]) {
    return this.consolidateClinical<ExtractedDiagnosis>(
      evidence,
      (unit) => unit.extracted.diagnoses ?? []
    );
  }

  private consolidateProcedures(evidence: ClaimEvidenceUnit[]) {
    return this.consolidateClinical<ExtractedProcedure>(
      evidence,
      (unit) => unit.extracted.procedures ?? []
    );
  }

  private isClinicalEvidence(unit: Pick<EvidenceUnit, "documentType">) {
    return [
      "medical_report",
      "prescription",
      "eye_test",
      "discharge_summary",
      "lab_result",
      "imaging_result",
      "dental_xray"
    ].includes(unit.documentType);
  }

  private consolidateClinical<
    T extends { description: string | null; code: string | null; codingSystem: string | null }
  >(
    evidence: ClaimEvidenceUnit[],
    select: (unit: ClaimEvidenceUnit) => T[]
  ): Array<T & { sourceAttachmentRefs: string[]; sourceEvidenceUnitRefs: string[] }> {
    const results = new Map<
      string,
      T & { sourceAttachmentRefs: string[]; sourceEvidenceUnitRefs: string[] }
    >();
    for (const unit of evidence) {
      for (const item of select(unit)) {
        if (!item.description && !item.code) continue;
        const normalizedCode = this.normalize(item.code ?? "");
        const key = normalizedCode
          ? `code:${normalizedCode}`
          : `description:${this.normalize(item.description ?? "")}`;
        const existing = results.get(key);
        if (existing) {
          if (!existing.description && item.description) existing.description = item.description;
          if (!existing.code && item.code) existing.code = item.code;
          if (!existing.codingSystem && item.codingSystem) {
            existing.codingSystem = item.codingSystem;
          }
          existing.sourceAttachmentRefs = [...new Set([
            ...existing.sourceAttachmentRefs,
            unit.attachmentId
          ])];
          existing.sourceEvidenceUnitRefs = [...new Set([
            ...existing.sourceEvidenceUnitRefs,
            unit.evidenceUnitId
          ])];
        } else {
          results.set(key, {
            ...item,
            sourceAttachmentRefs: [unit.attachmentId],
            sourceEvidenceUnitRefs: [unit.evidenceUnitId]
          });
        }
      }
    }
    return [...results.values()];
  }

  private evidenceSource(unit: ClaimEvidenceUnit): ClaimEvidenceSource {
    return {
      attachmentId: unit.attachmentId,
      evidenceUnitId: unit.evidenceUnitId,
      documentType: unit.documentType,
      pageStart: unit.pageStart,
      pageEnd: unit.pageEnd,
      dateEvidence: unit.dateEvidence
    };
  }

  private uniqueEvidenceSources(
    evidenceUnitIds: string[],
    evidence: ClaimEvidenceUnit[]
  ) {
    const ids = new Set(evidenceUnitIds);
    return evidence
      .filter((unit) => ids.has(unit.evidenceUnitId))
      .map((unit) => this.evidenceSource(unit));
  }

  private primaryInvoice(evidence: ClaimEvidenceUnit[]) {
    return evidence.find((unit) => unit.documentType === "invoice") ?? evidence[0]!;
  }

  private savedCorrections(claimId: string) {
    const row = this.database.get<ReviewCorrectionRow>(
      `SELECT corrected_json, updated_at
       FROM claim_review_corrections WHERE claim_id = ?`,
      claimId
    );
    if (!row) return null;
    try {
      return {
        value: JSON.parse(row.corrected_json) as ReviewCorrections,
        updatedAt: row.updated_at
      };
    } catch {
      throw new BadRequestException("Saved claim corrections are invalid.");
    }
  }

  private editedFields(corrections: ReviewCorrections): MemberEditedField[] {
    return EDITABLE_FIELDS.filter((field) => field in corrections);
  }

  private buildProvenance(
    source: ConsolidatedClaimFields,
    effective: ConsolidatedClaimFields,
    sources: Record<string, string[]>,
    evidenceSources: Record<string, ClaimEvidenceSource[]>,
    corrections: ReviewCorrections | undefined,
    validationIssues: ValidationIssue[]
  ): ClaimFieldProvenance[] {
    return EDITABLE_FIELDS.map((field) => {
      const editedByMember = Boolean(corrections && field in corrections);
      const issue = validationIssues.find((item) => item.field === field);
      const sourceAttachmentRefs = sources[field] ?? [];
      const unitSources = evidenceSources[field] ?? [];
      return {
        field,
        sourceValue: source[field],
        memberValue: editedByMember ? corrections?.[field] ?? null : null,
        effectiveValue: effective[field],
        editedByMember,
        sourceAttachmentRefs,
        sourceEvidenceUnitRefs: unitSources.map((source) => source.evidenceUnitId),
        sourceDocumentTypes: [...new Set(unitSources.map((source) => source.documentType))],
        validationState: issue?.state ?? "ready",
        severity: issue?.severity ?? "info"
      };
    });
  }

  private valuesEquivalent(left: unknown, right: unknown) {
    if (left === right) return true;
    if (typeof left === "number" && typeof right === "number") {
      return Math.abs(left - right) <= 0.000001;
    }
    if (typeof left === "string" && typeof right === "string") {
      return this.normalize(left) === this.normalize(right);
    }
    return JSON.stringify(left) === JSON.stringify(right);
  }

  private normaliseFields(input: Record<string, unknown>): EditableReviewFields {
    return {
      patientName: this.text(input.patientName),
      providerName: this.text(input.providerName),
      providerLocation: this.text(input.providerLocation),
      invoiceReference: this.text(input.invoiceReference),
      invoiceDate: this.text(input.invoiceDate),
      serviceDate: this.text(input.serviceDate),
      currency: this.text(input.currency),
      subtotal: this.number(input.subtotal),
      taxAmount: this.number(input.taxAmount),
      discountAmount: this.number(input.discountAmount),
      billedAmount: this.number(input.billedAmount),
      paymentStatus: this.paymentStatus(input.paymentStatus),
      paymentMethod: this.paymentMethod(input.paymentMethod),
      cardNetwork: this.cardNetwork(input.cardNetwork),
      admissionDate: this.text(input.admissionDate),
      dischargeDate: this.text(input.dischargeDate),
      serviceLines: this.serviceLines(input.serviceLines),
      diagnoses: this.clinicalItems(input.diagnoses, "diagnosis"),
      procedures: this.clinicalItems(input.procedures, "procedure"),
      opticalFrameAmount: this.number(input.opticalFrameAmount),
      opticalLensAmount: this.number(input.opticalLensAmount)
    };
  }

  private serviceLines(value: unknown): SourceLinkedServiceLine[] {
    if (value === undefined || value === null) return [];
    if (!Array.isArray(value) || value.length > 100) {
      throw new BadRequestException("Service lines are invalid.");
    }
    return value.map((line) => {
      if (!line || typeof line !== "object" || Array.isArray(line)) {
        throw new BadRequestException("A service line is invalid.");
      }
      const item = line as Record<string, unknown>;
      return {
        description: this.text(item.description),
        serviceDate: this.text(item.serviceDate),
        quantity: this.number(item.quantity),
        unitPrice: this.number(item.unitPrice),
        billedAmount: this.number(item.billedAmount),
        currency: this.text(item.currency),
        diagnosisText: this.text(item.diagnosisText),
        diagnosisCode: this.text(item.diagnosisCode),
        procedureCode: this.text(item.procedureCode),
        sbsCode: this.text(item.sbsCode),
        sbsDescription: this.text(item.sbsDescription),
        toothNumber: this.text(item.toothNumber),
        sourceAttachmentRefs: this.attachmentRefs(item.sourceAttachmentRefs),
        sourceEvidenceUnitRefs: this.evidenceUnitRefs(item.sourceEvidenceUnitRefs)
      };
    });
  }

  private attachmentRefs(value: unknown): string[] {
    if (value === undefined || value === null) return [];
    if (!Array.isArray(value) || value.length > 10 ||
      value.some((item) => typeof item !== "string" || item.length > 100)) {
      throw new BadRequestException("Service line sources are invalid.");
    }
    return [...new Set(value)];
  }

  private clinicalItems(
    value: unknown,
    kind: "diagnosis" | "procedure"
  ): Array<ExtractedDiagnosis & { sourceAttachmentRefs: string[]; sourceEvidenceUnitRefs: string[] }> {
    if (value === undefined || value === null) return [];
    if (!Array.isArray(value) || value.length > 100) {
      throw new BadRequestException(`Claim ${kind} information is invalid.`);
    }
    return value.map((entry) => {
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
        throw new BadRequestException(`A claim ${kind} is invalid.`);
      }
      const item = entry as Record<string, unknown>;
      return {
        description: this.text(item.description),
        // Printed codes remain immutable source evidence.
        code: this.text(item.code),
        codingSystem: this.text(item.codingSystem),
        sourceAttachmentRefs: this.attachmentRefs(item.sourceAttachmentRefs),
        sourceEvidenceUnitRefs: this.evidenceUnitRefs(item.sourceEvidenceUnitRefs)
      };
    });
  }

  private preserveClinicalSources<T extends SourceLinkedDiagnosis | SourceLinkedProcedure>(
    submitted: T[],
    source: T[]
  ): T[] {
    return submitted.map((item, index) => {
      const original = source[index];
      return {
        ...item,
        code: original?.code ?? null,
        codingSystem: original?.codingSystem ?? null,
        sourceAttachmentRefs: original?.sourceAttachmentRefs ?? [],
        sourceEvidenceUnitRefs: original?.sourceEvidenceUnitRefs ?? []
      } as T;
    });
  }

  private evidenceUnitRefs(value: unknown): string[] {
    if (value === undefined || value === null) return [];
    if (!Array.isArray(value) || value.length > 100 ||
      value.some((item) => typeof item !== "string" || item.length > 300)) {
      throw new BadRequestException("Service line evidence-unit sources are invalid.");
    }
    return [...new Set(value)];
  }

  private text(value: unknown): string | null {
    if (value === undefined || value === null || value === "") return null;
    if (typeof value !== "string" || value.length > 500) {
      throw new BadRequestException("A corrected text value is invalid.");
    }
    return value.trim() || null;
  }

  private number(value: unknown): number | null {
    if (value === undefined || value === null || value === "") return null;
    if (typeof value !== "number" || !Number.isFinite(value)) {
      throw new BadRequestException("A corrected number is invalid.");
    }
    return value;
  }

  private paymentStatus(value: unknown): ExtractedDocumentFields["paymentStatus"] {
    if (value === undefined || value === null) return "unclear";
    if (value === "paid" || value === "unpaid" || value === "unclear") return value;
    throw new BadRequestException("Payment status is invalid.");
  }

  private paymentMethod(value: unknown): ExtractedDocumentFields["paymentMethod"] {
    if (value === undefined || value === null) return "unknown";
    if (["cash", "card", "bank_transfer", "digital_wallet", "cheque", "other", "unknown"].includes(value as string)) {
      return value as ExtractedDocumentFields["paymentMethod"];
    }
    throw new BadRequestException("Payment method is invalid.");
  }

  private cardNetwork(value: unknown): ExtractedDocumentFields["cardNetwork"] {
    if (value === undefined || value === null || value === "") return null;
    if (["mada", "visa", "mastercard", "amex", "other"].includes(value as string)) {
      return value as ExtractedDocumentFields["cardNetwork"];
    }
    throw new BadRequestException("Card network is invalid.");
  }

  private hasValue(value: unknown) {
    return value !== null && value !== undefined && value !== "" &&
      (!Array.isArray(value) || value.length > 0);
  }

  private hasConsolidatableValue(
    field: keyof ExtractedDocumentFields,
    value: unknown
  ) {
    if (field === "paymentStatus" && value === "unclear") return false;
    if (field === "paymentMethod" && value === "unknown") return false;
    return this.hasValue(value);
  }

  private normalize(value: string) {
    return value.toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
  }

  private assign<T extends object, K extends keyof T>(target: T, key: K, value: T[K] | undefined) {
    if (value !== undefined) target[key] = value;
  }
}
