import { BadRequestException, ConflictException, Injectable } from "@nestjs/common";
import { createHash } from "node:crypto";
import { DatabaseService } from "../database/database.service";
import {
  getEvidenceUnits,
  type DocumentAnalysisResult
} from "../document-intelligence/document-analysis";
import { ClaimValidationService } from "../validation/claim-validation.service";
import type { AttachmentRecord } from "./attachment";
import type { ClaimRecord } from "./claim";
import type { ClaimSubmission, SubmissionPayload } from "./claim-submission";
import { ClaimReviewService } from "./claim-review.service";
import { ClaimsService } from "./claims.service";
import { DocumentsService } from "./documents.service";
import { DocumentIntelligenceService } from "../document-intelligence/document-intelligence.service";

interface SubmissionRow {
  claim_id: string;
  acceptance_reference: string;
  payload_json: string;
  submitted_at: string;
}

interface PriorSubmissionRow extends SubmissionRow {
  member_id: string;
  category: ClaimRecord["category"];
  optical_item: ClaimRecord["opticalItem"];
  fingerprint: string;
}

@Injectable()
export class ClaimSubmissionService {
  constructor(
    private readonly database: DatabaseService,
    private readonly claims: ClaimsService,
    private readonly documents: DocumentsService,
    private readonly review: ClaimReviewService,
    private readonly validation: ClaimValidationService,
    private readonly intelligence: DocumentIntelligenceService
  ) {}

  submit(memberId: string, claimId: string, now = new Date()): ClaimSubmission {
    const claim = this.claims.findOne(memberId, claimId);
    const existing = this.findStored(claimId);
    if (existing) return existing;
    if (claim.status === "accepted_for_processing") {
      throw new BadRequestException("This accepted claim has no submission record.");
    }

    const attachments = this.documents.list(memberId, claimId);
    if (attachments.length === 0) {
      throw new BadRequestException("Upload and review the required documents before submitting.");
    }
    const analyses = attachments
      .map((attachment) => attachment.analysis)
      .filter((analysis): analysis is DocumentAnalysisResult =>
        analysis?.analysisStatus === "complete"
      );
    if (analyses.length !== attachments.length) {
      throw new BadRequestException("Finish document analysis before submitting this claim.");
    }
    if (attachments.some((attachment) =>
      !this.intelligence.isAnalysisCurrent(attachment.analysis)
    )) {
      throw new BadRequestException({
        code: "DOCUMENT_ANALYSIS_STALE",
        message: "Your documents need to be analyzed again before submission."
      });
    }

    const effective = this.review.validationAnalyses(claimId, analyses);
    const validation = this.validation.validate(memberId, claim, analyses, now, effective);
    if (!validation.readyToSubmit) {
      throw new BadRequestException(
        "Resolve every blocking review item before submitting this claim."
      );
    }

    const submittedAt = now.toISOString();
    const acceptanceReference = claimId.replace(/^CLM-/, "ACK-");
    const review = this.review.buildReview(claimId, analyses, validation.issues, claim.category);
    const payload = this.buildPayload(claim, attachments, review, validation, submittedAt);
    const fingerprint = this.submissionFingerprint(payload);

    return this.database.transaction(() => {
      const repeated = this.findStored(claimId);
      if (repeated) return repeated;
      const current = this.claims.findOne(memberId, claimId);
      if (current.status !== "ready") {
        throw new BadRequestException("This claim is no longer ready to submit.");
      }
      this.assertNoDuplicate(memberId, claim, attachments, payload, fingerprint);
      this.database.run(
        `INSERT INTO claim_submissions
         (claim_id, acceptance_reference, payload_json, submitted_at)
         VALUES (?, ?, ?, ?)`,
        claimId,
        acceptanceReference,
        JSON.stringify(payload),
        submittedAt
      );
      this.database.run(
        `INSERT INTO submission_fingerprints (claim_id, fingerprint)
         VALUES (?, ?)`,
        claimId,
        fingerprint
      );
      this.database.run(
        `UPDATE claims
         SET status = 'accepted_for_processing', updated_at = ?
         WHERE claim_id = ? AND member_id = ?`,
        submittedAt,
        claimId,
        memberId
      );
      return { claimId, acceptanceReference, submittedAt, payload };
    });
  }

  findForMember(memberId: string, claimId: string) {
    this.claims.findOne(memberId, claimId);
    return this.findStored(claimId);
  }

  private buildPayload(
    claim: ClaimRecord,
    attachments: AttachmentRecord[],
    review: ReturnType<ClaimReviewService["buildReview"]>,
    validation: ReturnType<ClaimValidationService["validate"]>,
    submittedAt: string
  ): SubmissionPayload {
    const { extracted, sources, editedFields, editedAt, provenance } = review;
    const submissionLine = ({ sourceEvidenceUnitRefs: _unitRefs, ...line }: typeof extracted.serviceLines[number]) => line;
    const submissionDiagnosis = ({ sourceEvidenceUnitRefs: _unitRefs, ...diagnosis }: typeof extracted.diagnoses[number]) => diagnosis;
    const submissionProcedure = ({ sourceEvidenceUnitRefs: _unitRefs, ...procedure }: typeof extracted.procedures[number]) => procedure;
    const submissionValidationIssue = ({
      code,
      state,
      field,
      attachmentId,
      message,
      severity
    }: typeof validation.issues[number]) => ({
      code,
      state,
      field,
      attachmentId,
      message,
      severity
    });
    const submissionValidation = {
      claimId: validation.claimId,
      state: validation.state,
      readyToSubmit: validation.readyToSubmit,
      blockingIssueCount: validation.blockingIssueCount,
      warningCount: validation.warningCount,
      infoCount: validation.infoCount,
      validatedAt: validation.validatedAt,
      issues: validation.issues.map(submissionValidationIssue)
    };
    return {
      schemaVersion: "1.2",
      claim: {
        referenceId: claim.claimId,
        member: { referenceId: claim.memberId },
        category: claim.category,
        opticalItem: claim.opticalItem,
        location: claim.claimLocation,
        submittedAt,
        status: "accepted_for_processing"
      },
      patient: { name: extracted.patientName },
      provider: {
        name: extracted.providerName,
        location: extracted.providerLocation
      },
      invoices: extracted.invoices.map(({ sourceEvidenceUnitRef: _unitRef, items, ...invoice }) => ({
        ...invoice,
        items: items.map(submissionLine)
      })),
      paymentEvidence: extracted.paymentEvidence.map(({ sourceEvidenceUnitRef: _unitRef, ...payment }) => payment),
      items: extracted.serviceLines.map(submissionLine),
      clinical: {
        admissionDate: extracted.admissionDate,
        dischargeDate: extracted.dischargeDate,
        diagnoses: extracted.diagnoses.map(submissionDiagnosis),
        procedures: extracted.procedures.map(submissionProcedure)
      },
      attachments: attachments.map((attachment) => ({
        referenceId: attachment.attachmentId,
        filename: attachment.originalFilename,
        documentType: attachment.analysis?.documentType ?? "unknown"
      })),
      sources,
      provenance: provenance.map(({
        sourceEvidenceUnitRefs: _unitRefs,
        sourceValue,
        memberValue,
        effectiveValue,
        ...entry
      }) => ({
        ...entry,
        sourceValue: this.submissionValue(sourceValue),
        memberValue: this.submissionValue(memberValue),
        effectiveValue: this.submissionValue(effectiveValue)
      })),
      intake: {
        readyToSubmit: validation.readyToSubmit,
        blockingIssueCount: validation.blockingIssueCount,
        warningCount: validation.warningCount,
        acceptedForProcessing: true
      },
      validationSnapshot: submissionValidation,
      unresolvedWarnings: validation.issues.filter(
        (issue) => issue.severity === "warning"
      ).map(submissionValidationIssue),
      rawDocumentExtractions: attachments.flatMap((attachment) =>
        attachment.analysis
          ? [{
              attachmentReference: attachment.attachmentId,
              filename: attachment.originalFilename,
              analysis: attachment.analysis
            }]
          : []
      ),
      internalUncertainty: attachments.flatMap((attachment) =>
        attachment.analysis
          ? [this.extractionUncertainty(attachment.analysis)]
          : []
      ),
      ...(editedFields.length > 0 && editedAt
        ? { memberEdits: { fields: editedFields, updatedAt: editedAt } }
        : {})
    };
  }

  private extractionUncertainty(analysis: DocumentAnalysisResult) {
    const reasons: string[] = [];
    if (analysis.analysisStatus !== "complete") reasons.push(`analysis:${analysis.analysisStatus}`);
    const evidenceUnits = getEvidenceUnits(analysis);
    for (const unit of evidenceUnits) {
      const page = unit.pageStart === null
        ? "page:unknown"
        : unit.pageEnd !== null && unit.pageEnd !== unit.pageStart
          ? `pages:${unit.pageStart}-${unit.pageEnd}`
          : `page:${unit.pageStart}`;
      const prefix = `evidence_unit:${unit.evidenceUnitId}:${page}:${unit.documentType}`;
      if (unit.readability !== "readable") reasons.push(`${prefix}:readability:${unit.readability}`);
      if (unit.relevance !== "relevant") reasons.push(`${prefix}:relevance:${unit.relevance}`);
      if (unit.documentType === "unknown") reasons.push(`${prefix}:document_type:unknown`);
      reasons.push(...unit.missingOrUnclear.map((field) => `${prefix}:missing_or_unclear:${field}`));
    }
    const hasHighUncertaintyUnit = evidenceUnits.some((unit) =>
      unit.readability === "unreadable" || unit.relevance === "irrelevant"
    );
    const level = analysis.analysisStatus !== "complete"
      ? "unknown" as const
      : hasHighUncertaintyUnit
        ? "high" as const
        : reasons.length > 0
          ? "medium" as const
          : "low" as const;
    return { attachmentReference: analysis.attachmentId, level, reasons };
  }

  private submissionValue(value: unknown): unknown {
    if (Array.isArray(value)) return value.map((item) => this.submissionValue(item));
    if (!value || typeof value !== "object") return value;
    return Object.fromEntries(
      Object.entries(value).flatMap(([key, item]) =>
        key === "sourceEvidenceUnitRef" || key === "sourceEvidenceUnitRefs"
          ? []
          : [[key, this.submissionValue(item)]]
      )
    );
  }

  private findStored(claimId: string): ClaimSubmission | null {
    const row = this.database.get<SubmissionRow>(
      `SELECT claim_id, acceptance_reference, payload_json, submitted_at
       FROM claim_submissions WHERE claim_id = ?`,
      claimId
    );
    if (!row) return null;
    try {
      return {
        claimId: row.claim_id,
        acceptanceReference: row.acceptance_reference,
        submittedAt: row.submitted_at,
        payload: JSON.parse(row.payload_json) as SubmissionPayload
      };
    } catch {
      throw new BadRequestException("The stored submission payload is invalid.");
    }
  }

  private assertNoDuplicate(
    memberId: string,
    claim: ClaimRecord,
    attachments: AttachmentRecord[],
    payload: SubmissionPayload,
    fingerprint: string
  ) {
    const prior = this.database.all<PriorSubmissionRow>(
      `SELECT s.claim_id, s.acceptance_reference, s.payload_json, s.submitted_at,
              c.member_id, c.category, c.optical_item, f.fingerprint
       FROM claim_submissions s
       INNER JOIN claims c ON c.claim_id = s.claim_id
       INNER JOIN submission_fingerprints f ON f.claim_id = s.claim_id
       WHERE c.member_id = ? AND s.claim_id <> ?`,
      memberId,
      claim.claimId
    );

    for (const previous of prior) {
      if (this.areDisjointOpticalClaims(claim, previous)) continue;

      if (this.hasDuplicateDocument(attachments, previous.claim_id)) {
        this.duplicate(previous.claim_id, "A document in this claim");
      }

      let previousPayload: SubmissionPayload;
      try {
        previousPayload = JSON.parse(previous.payload_json) as SubmissionPayload;
      } catch {
        continue;
      }

      if (
        previous.fingerprint === fingerprint ||
        this.hasMatchingInvoice(payload, previousPayload)
      ) {
        this.duplicate(previous.claim_id, "These invoice details");
      }
    }
  }

  private hasDuplicateDocument(
    attachments: AttachmentRecord[],
    previousClaimId: string
  ) {
    if (attachments.length === 0) return false;
    const placeholders = attachments.map(() => "?").join(", ");
    const result = this.database.get<{ found: number }>(
      `SELECT 1 AS found
       FROM attachment_fingerprints incoming
       INNER JOIN attachment_fingerprints prior
         ON prior.sha256 = incoming.sha256
       INNER JOIN attachments prior_attachment
         ON prior_attachment.attachment_id = prior.attachment_id
       WHERE incoming.attachment_id IN (${placeholders})
         AND prior_attachment.claim_id = ?
       LIMIT 1`,
      ...attachments.map((attachment) => attachment.attachmentId),
      previousClaimId
    );
    return Boolean(result);
  }

  private hasMatchingInvoice(
    current: SubmissionPayload,
    previous: SubmissionPayload
  ) {
    const currentKeys = this.invoiceKeys(current);
    if (currentKeys.size === 0) return false;
    const previousKeys = this.invoiceKeys(previous);
    return [...currentKeys].some((key) => previousKeys.has(key));
  }

  private invoiceKeys(payload: SubmissionPayload) {
    const keys = new Set<string>();
    const provider = this.normalise(payload.provider.name);
    if (!provider) return keys;

    for (const invoice of payload.invoices) {
      const reference = this.normalise(invoice.reference);
      if (!reference) continue;
      // An itemized invoice reference is the strongest business identifier.
      // Do not fall back to provider/date/total alone: that combination can
      // legitimately describe two separate visits.
      keys.add(JSON.stringify({ provider, reference }));
    }
    return keys;
  }

  private submissionFingerprint(payload: SubmissionPayload) {
    const normalised = {
      memberId: payload.claim.member.referenceId,
      category: payload.claim.category,
      opticalItem: payload.claim.opticalItem,
      provider: this.normalise(payload.provider.name),
      invoices: payload.invoices.map((invoice) => ({
        reference: this.normalise(invoice.reference),
        date: invoice.invoiceDate ?? invoice.serviceDate,
        currency: invoice.currency?.toUpperCase() ?? null,
        total: invoice.billedAmount
      })).sort(this.compareJson),
      items: payload.items.map((item) => ({
        description: this.normalise(item.description),
        date: item.serviceDate,
        amount: item.billedAmount,
        currency: item.currency?.toUpperCase() ?? null
      })).sort(this.compareJson)
    };
    return createHash("sha256")
      .update(JSON.stringify(normalised))
      .digest("hex");
  }

  private areDisjointOpticalClaims(
    current: ClaimRecord,
    previous: Pick<PriorSubmissionRow, "category" | "optical_item">
  ) {
    if (
      current.category !== "optical" ||
      previous.category !== "optical" ||
      current.opticalItem === null ||
      previous.optical_item === null
    ) {
      return false;
    }

    const currentItems = this.opticalComponents(current.opticalItem);
    const previousItems = this.opticalComponents(previous.optical_item);
    return currentItems.every((item) => !previousItems.includes(item));
  }

  private opticalComponents(item: NonNullable<ClaimRecord["opticalItem"]>) {
    return item === "both"
      ? (["frames", "lenses"] as const)
      : [item];
  }

  private duplicate(claimId: string, subject: string): never {
    throw new ConflictException({
      message: `${subject} match submitted claim ${claimId}. Open that claim instead.`,
      code: "DUPLICATE_CLAIM",
      claimId
    });
  }

  private normalise(value: string | null) {
    return value
      ?.toLocaleLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, " ")
      .trim() ?? null;
  }

  private compareJson<T>(left: T, right: T) {
    return JSON.stringify(left).localeCompare(JSON.stringify(right));
  }
}
