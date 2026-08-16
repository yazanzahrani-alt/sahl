import { Injectable } from "@nestjs/common";
import type { ClaimRecord } from "../claims/claim";
import { ClaimsService } from "../claims/claims.service";
import { DatabaseService } from "../database/database.service";
import type {
  DocumentAnalysisResult,
  DocumentType,
  ExtractedServiceLine
} from "../document-intelligence/document-analysis";
import {
  claimEvidenceUnits,
  type ClaimEvidenceUnit
} from "../document-intelligence/claim-evidence";
import {
  dateEvidenceFor,
  type DateEvidence,
  type DateField
} from "../document-intelligence/date-evidence";
import type {
  ClaimValidationResult,
  ValidationIssue,
  ValidationSeverity,
  ValidationState
} from "./validation";
import { validationIssueKey } from "./validation";
import { CLAIM_VALIDATION_POLICY } from "./validation-policy";
import {
  EvidenceCompletenessEvaluator,
  type EvidenceCompletenessResult
} from "./evidence-completeness.evaluator";

interface ValidationIssueRow {
  code: string;
  state: ValidationIssue["state"];
  field: string | null;
  attachment_id: string | null;
  evidence_unit_id: string | null;
  page_start: number | null;
  page_end: number | null;
  message: string;
  message_ar: string | null;
  details_json: string | null;
  details_ar_json: string | null;
  created_at: string;
}

interface IssueSource {
  attachmentId: string;
  evidenceUnitId: string;
  pageStart: number | null;
  pageEnd: number | null;
}

interface IssueCopy {
  messageAr?: string;
  details?: string[];
  detailsAr?: string[];
}

const MONEY_TOLERANCE = 0.05;

@Injectable()
export class ClaimValidationService {
  private readonly evidenceCompleteness = new EvidenceCompletenessEvaluator();

  constructor(
    private readonly database: DatabaseService,
    private readonly claims: ClaimsService
  ) {}

  validate(
    memberId: string,
    claim: ClaimRecord,
    sourceAnalyses: DocumentAnalysisResult[],
    now = new Date(),
    effectiveAnalyses = sourceAnalyses
  ): ClaimValidationResult {
    const issues: ValidationIssue[] = [];
    const sourceEvidence = claimEvidenceUnits(sourceAnalyses);
    const effectiveEvidence = claimEvidenceUnits(effectiveAnalyses);

    for (const unit of sourceEvidence) {
      this.checkDocument(unit, claim, issues);
    }

    const usableSources = sourceEvidence.filter(
      (unit) =>
        unit.readability !== "unreadable" &&
        unit.relevance !== "irrelevant"
    );
    const usableEffective = effectiveEvidence.filter(
      (unit) =>
        unit.readability !== "unreadable" &&
        unit.relevance !== "irrelevant"
    );
    const blockedByUnusableUploads = sourceEvidence.length > 0 &&
      usableSources.length === 0 &&
      sourceEvidence.some((unit) =>
        unit.documentType === "invoice" &&
        (unit.readability === "unreadable" || unit.relevance === "irrelevant")
      );

    if (!blockedByUnusableUploads) {
      const invoices = usableEffective.filter((unit) => this.isInvoiceEvidence(unit));
      const sourceInvoices = usableSources.filter((unit) => this.isInvoiceEvidence(unit));
      const unreadableInvoiceExists = sourceEvidence.some(
        (unit) => unit.readability === "unreadable" && unit.documentType === "invoice"
      );
      const strongCategoryMismatch = this.checkDocumentCategories(claim, usableSources, issues);
      this.checkInvoices(invoices, issues, now, unreadableInvoiceExists);
      this.checkDuplicateInvoiceEvidence(sourceInvoices, issues);
      this.checkPaymentEvidence(usableEffective, issues);
      if (!strongCategoryMismatch) {
        this.checkCategoryEvidence(claim, usableEffective, issues, sourceEvidence);
      }
      this.checkCrossDocumentConsistency(usableSources, issues);
      this.checkEpisodeBoundary(usableSources, issues);
      this.checkAdmissionDates(usableEffective, issues, now);
      this.checkClinicalServiceDates(usableEffective, issues, now);
      this.checkMemberEdits(sourceEvidence, effectiveEvidence, issues);
      this.checkServiceDateConflict(usableSources, usableEffective, issues);
    }

    const confirmedKeys = new Set(
      this.database.all<{ issue_key: string }>(
        "SELECT issue_key FROM validation_confirmations WHERE claim_id = ?",
        claim.claimId
      ).map((row) => row.issue_key)
    );
    const unresolvedIssues = issues.filter((issue) => {
      if (issue.state !== "needs_review") return true;
      const scopedKey = validationIssueKey(
        issue.code,
        issue.attachmentId,
        issue.evidenceUnitId ?? null,
        claim.claimId
      );
      if (confirmedKeys.has(scopedKey)) return false;
      const legacyClaimKey = issue.attachmentId === null
        ? validationIssueKey(issue.code, null)
        : null;
      return !legacyClaimKey || !confirmedKeys.has(legacyClaimKey);
    });
    const state = this.overallState(unresolvedIssues);
    const summary = this.issueSummary(unresolvedIssues);
    const validatedAt = now.toISOString();

    this.database.transaction(() => {
      this.database.run(
        "DELETE FROM validation_issues WHERE claim_id = ?",
        claim.claimId
      );
      for (const issue of unresolvedIssues) {
        this.database.run(
          `INSERT INTO validation_issues
           (claim_id, attachment_id, evidence_unit_id, page_start, page_end,
            code, field, message, message_ar, details_json, details_ar_json, state, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          claim.claimId,
          issue.attachmentId,
          issue.evidenceUnitId ?? null,
          issue.pageStart ?? null,
          issue.pageEnd ?? null,
          issue.code,
          issue.field,
          issue.message,
          issue.messageAr ?? null,
          issue.details ? JSON.stringify(issue.details) : null,
          issue.detailsAr ? JSON.stringify(issue.detailsAr) : null,
          issue.state,
          validatedAt
        );
      }
    });

    this.claims.setValidationStatus(
      memberId,
      claim.claimId,
      summary.readyToSubmit ? "ready" : "needs_review"
    );

    return {
      claimId: claim.claimId,
      state,
      ...summary,
      validatedAt,
      issues: unresolvedIssues
    };
  }

  getCurrent(claim: ClaimRecord): ClaimValidationResult | null {
    if (claim.status !== "ready" && claim.status !== "needs_review") {
      return null;
    }

    const rows = this.database.all<ValidationIssueRow>(
      `SELECT code, state, field, attachment_id, evidence_unit_id, page_start, page_end,
              message, message_ar, details_json, details_ar_json, created_at
       FROM validation_issues
       WHERE claim_id = ?
       ORDER BY id`,
      claim.claimId
    );
    const issues = rows.map((row) => ({
      code: row.code,
      state: row.state,
      field: row.field,
      attachmentId: row.attachment_id,
      evidenceUnitId: row.evidence_unit_id,
      pageStart: row.page_start,
      pageEnd: row.page_end,
      message: row.message,
      ...(row.message_ar ? { messageAr: row.message_ar } : {}),
      ...(this.stringArray(row.details_json) ? { details: this.stringArray(row.details_json)! } : {}),
      ...(this.stringArray(row.details_ar_json)
        ? { detailsAr: this.stringArray(row.details_ar_json)! }
        : {}),
      severity: this.severityForState(row.state)
    }));
    const summary = this.issueSummary(issues);

    return {
      claimId: claim.claimId,
      state: issues.length === 0 ? "ready" : this.overallState(issues),
      ...summary,
      validatedAt: rows[0]?.created_at ?? claim.updatedAt.toISOString(),
      issues
    };
  }

  private checkDocument(
    analysis: ClaimEvidenceUnit,
    claim: ClaimRecord,
    issues: ValidationIssue[]
  ) {
    const attachmentId = analysis.attachmentId;
    if (analysis.relevance === "irrelevant") {
      this.add(issues, "document_irrelevant", "invalid", "attachment", attachmentId,
        "Remove this file or replace it with a document for this claim.", this.source(analysis));
      return;
    }

    if (analysis.readability === "unreadable") {
      if (analysis.documentType !== "invoice" &&
          !this.isRequiredSupportingDocument(claim, analysis.documentType)) {
        this.add(
          issues,
          "document_optional_unreadable",
          "needs_review",
          "attachment",
          attachmentId,
          "We could not read this optional document. It was not used as required evidence; replace or remove it if it matters to this claim.",
          this.source(analysis),
          {
            messageAr: "تعذر علينا قراءة هذا المستند الاختياري. لم يُستخدم كدليل مطلوب؛ استبدله أو احذفه إذا كان مهماً لهذه المطالبة."
          }
        );
        return;
      }
      const relevanceCouldNotBeEstablished = analysis.relevance === "unclear";
      this.add(
        issues,
        relevanceCouldNotBeEstablished ? "document_unverifiable" : "document_unreadable",
        "invalid",
        "attachment",
        attachmentId,
        relevanceCouldNotBeEstablished
          ? "Replace this file with a clear invoice or supporting medical document."
          : analysis.documentType === "invoice"
            ? "We could not reliably read this invoice. Replace it with a clearer copy."
            : "Replace this required supporting document with a clearer copy.",
        this.source(analysis)
      );
      return;
    }

    if (analysis.readability === "unclear") {
      this.add(issues, "document_readability_unclear", "needs_review", "attachment", attachmentId,
        "Check that this document is clear and fully visible.", this.source(analysis));
    }

    if (analysis.relevance === "unclear") {
      this.add(issues, "document_relevance_unclear", "needs_review", "attachment", attachmentId,
        "Confirm that this document belongs to this treatment claim.", this.source(analysis));
    }

    if (analysis.documentType === "unknown" || analysis.documentType === "other") {
      this.add(issues, "document_type_unclear", "needs_review", "documentType", attachmentId,
        "Confirm what type of document this is.", this.source(analysis));
    }

    const categories = [...new Set(analysis.detectedCategories)];
    if (categories.length > 1 && categories.includes(claim.category)) {
      this.add(issues, "category_unclear", "needs_review", "category", attachmentId,
        "This document contains signals for more than one category. Confirm the selected category.",
        this.source(analysis));
    }
  }

  private checkDocumentCategories(
    claim: ClaimRecord,
    evidence: ClaimEvidenceUnit[],
    issues: ValidationIssue[]
  ) {
    const signalled = evidence.map((unit) => ({
      unit,
      categories: this.strongCategorySignals(unit)
    })).filter((item) => item.categories.length > 0);
    if (signalled.length === 0) return false;

    const supportsSelected = signalled.some((item) =>
      item.categories.includes(claim.category)
    );
    const exclusivelyOther = signalled.filter((item) =>
      item.categories.length === 1 && item.categories[0] !== claim.category
    );
    const detected = [...new Set(exclusivelyOther.flatMap((item) => item.categories))];
    const strongMismatch = !supportsSelected && exclusivelyOther.length > 0 && detected.length === 1;

    if (!strongMismatch) {
      const ambiguousMismatch = !supportsSelected && signalled.some((item) =>
        !item.categories.includes(claim.category)
      );
      if (ambiguousMismatch) {
        const only = signalled.length === 1 ? signalled[0].unit : null;
        this.add(
          issues,
          "category_unclear",
          "needs_review",
          "category",
          only?.attachmentId ?? null,
          "The documents contain mixed or uncertain category signals. Review the selected claim type.",
          only ? this.source(only) : undefined
        );
      }
      return false;
    }

    const detectedCategory = detected[0]!;
    const only = exclusivelyOther.length === 1 ? exclusivelyOther[0].unit : null;
    const selectedLabel = this.categoryLabel(claim.category);
    const detectedLabel = this.categoryLabel(detectedCategory);
    const details = [
      `Uploaded evidence appears related to ${detectedLabel} treatment.`,
      ...this.categorySignalDetails(exclusivelyOther.map((item) => item.unit)),
      `The uploaded evidence does not support the selected ${selectedLabel} claim type.`
    ];
    const detailsAr = [
      `تبدو المستندات المرفوعة مرتبطة بعلاج من فئة ${this.categoryLabelAr(detectedCategory)}.`,
      ...this.categorySignalDetailsAr(exclusivelyOther.map((item) => item.unit)),
      `لا تدعم الأدلة المرفوعة نوع المطالبة المحدد: ${this.categoryLabelAr(claim.category)}.`
    ];
    this.add(
      issues,
      "category_mismatch",
      "conflict",
      "category",
      only?.attachmentId ?? null,
      `Your documents don't support a ${selectedLabel} claim yet. Upload documents that support this ${selectedLabel} claim, or change the claim type.`,
      only ? this.source(only) : undefined,
      {
        messageAr: `لا تدعم مستنداتك مطالبة من فئة ${this.categoryLabelAr(claim.category)} حتى الآن. ارفع مستندات تدعم هذه المطالبة، أو غيّر نوع المطالبة.`,
        details: [...new Set(details)],
        detailsAr: [...new Set(detailsAr)]
      }
    );
    return true;
  }

  private isInvoiceEvidence(analysis: ClaimEvidenceUnit) {
    const fields = analysis.extracted;
    const itemized = fields.serviceLines.some(
      (line) => Boolean(line.description?.trim()) && this.positive(line.billedAmount)
    );
    return analysis.documentType === "invoice" ||
      (analysis.documentType === "payment_receipt" &&
        this.positive(fields.billedAmount) && itemized);
  }

  private checkInvoices(
    invoices: ClaimEvidenceUnit[],
    issues: ValidationIssue[],
    now: Date,
    unreadableInvoiceExists = false
  ) {
    if (invoices.length === 0) {
      if (!unreadableInvoiceExists) {
        this.add(issues, "invoice_missing", "missing", "invoice", null,
          "Upload an itemized invoice showing the service and amount.");
      }
      return;
    }

    for (const invoice of invoices) {
      this.checkInvoice(invoice, issues, now);
    }

    const currencies = new Set(
      invoices
        .map((invoice) => invoice.extracted.currency?.trim().toUpperCase())
        .filter((currency): currency is string => Boolean(currency))
    );
    if (currencies.size > 1) {
      this.add(issues, "invoice_currency_mismatch", "needs_review", "currency", null,
        "Invoice currencies differ. Confirm that all invoices belong to this claim.");
    }
  }

  private checkInvoice(
    invoice: ClaimEvidenceUnit,
    issues: ValidationIssue[],
    now: Date
  ) {
    const fields = invoice.extracted;
    const attachmentId = invoice.attachmentId;
    const source = this.source(invoice);
    const messages = {
      patientName: "Confirm the patient name shown on the invoice.",
      providerName: "Add or confirm the healthcare provider name.",
      providerLocation: "Add or confirm the provider location.",
      invoiceDate: "Add or confirm the invoice date.",
      currency: "Add or confirm the invoice currency.",
      billedAmount: "Add or confirm the total billed amount."
    } as const;
    for (const field of CLAIM_VALIDATION_POLICY.requiredInvoiceFields) {
      const value = fields[field];
      if (field === "invoiceDate" &&
          dateEvidenceFor("invoiceDate", fields.invoiceDate, invoice.dateEvidence)) {
        continue;
      }
      if (value === null || value === undefined || value === "") {
        this.add(
          issues, `invoice_${field}_missing`, "missing", field, attachmentId, messages[field], source
        );
      }
    }

    if (fields.billedAmount !== null && !this.positive(fields.billedAmount)) {
      this.add(issues, "invoice_amount_invalid", "invalid", "billedAmount", attachmentId,
        "Confirm a billed amount greater than zero.", source);
    }
    if (!fields.invoiceReference) {
      this.add(issues, "invoice_reference_unclear", "needs_review", "invoiceReference", attachmentId,
        "Confirm the invoice or receipt reference if one is shown.", source);
    }

    const describedLines = fields.serviceLines.filter((line) => line.description?.trim());
    if (describedLines.length === 0) {
      this.add(issues, "service_lines_missing", "missing", "serviceLines", attachmentId,
        "Provide an itemized invoice with at least one service description.", source);
    }
    this.checkLines(
      describedLines,
      fields.subtotal,
      fields.taxAmount,
      fields.discountAmount,
      fields.billedAmount,
      attachmentId,
      issues,
      source
    );
    this.checkInvoiceDate(fields.invoiceDate, attachmentId, issues, now, source, invoice.dateEvidence);
    this.checkServiceDate(fields.serviceDate, attachmentId, issues, now, "serviceDate", source, invoice.dateEvidence);
    for (const [lineIndex, line] of fields.serviceLines.entries()) {
      if (!line.description?.trim()) continue;
      this.checkServiceDate(
        line.serviceDate,
        attachmentId,
        issues,
        now,
        "serviceLines",
        source,
        invoice.dateEvidence,
        lineIndex
      );
    }
  }

  private checkLines(
    lines: ExtractedServiceLine[],
    subtotal: number | null,
    taxAmount: number | null,
    discountAmount: number | null,
    invoiceTotal: number | null,
    attachmentId: string,
    issues: ValidationIssue[],
    source: IssueSource
  ) {
    for (const line of lines) {
      for (const [field, value] of [
        ["quantity", line.quantity],
        ["unitPrice", line.unitPrice],
        ["billedAmount", line.billedAmount]
      ] as const) {
        if (value !== null && !this.positive(value)) {
          this.add(issues, "service_line_amount_invalid", "invalid", field, attachmentId,
            "Check the service-line amounts; values must be greater than zero.", source);
          break;
        }
      }
      if (line.quantity !== null && line.unitPrice !== null && line.billedAmount !== null &&
          Math.abs(line.quantity * line.unitPrice - line.billedAmount) > MONEY_TOLERANCE) {
        this.add(issues, "service_line_calculation_conflict", "conflict", "serviceLines", attachmentId,
          "A service-line quantity and price do not match its billed amount. Confirm the invoice values.",
          source);
      }
    }

    const amounts = lines.map((line) => line.billedAmount);
    const allLinesHaveAmounts = amounts.length > 0 && amounts.every((amount) => amount !== null);
    const lineTotal = allLinesHaveAmounts
      ? (amounts as number[]).reduce((sum, amount) => sum + amount, 0)
      : null;

    const discount = discountAmount ?? 0;
    const tax = taxAmount ?? 0;
    const subtotalBasedTotal = subtotal === null
      ? null
      : subtotal - discount + tax;
    const lineTotalMatchesSubtotal =
      subtotal !== null && lineTotal !== null &&
      this.moneyMatches(lineTotal, subtotal);
    const lineTotalMatchesFinalTotal =
      invoiceTotal !== null && lineTotal !== null &&
      this.moneyMatches(lineTotal, invoiceTotal);
    const subtotalBreakdownMatchesFinalTotal =
      invoiceTotal !== null && subtotalBasedTotal !== null &&
      this.moneyMatches(subtotalBasedTotal, invoiceTotal);

    // Some invoices show pre-tax item prices, while others show tax-inclusive
    // line prices alongside a separate pre-tax subtotal and tax breakdown.
    const taxInclusiveLinesReconcile =
      lineTotalMatchesFinalTotal && subtotalBreakdownMatchesFinalTotal;

    if (subtotal !== null && lineTotal !== null &&
        !lineTotalMatchesSubtotal && !taxInclusiveLinesReconcile) {
      this.add(issues, "invoice_subtotal_needs_review", "needs_review", "subtotal", attachmentId,
        "The itemized amounts do not equal the invoice subtotal. Check the extracted values.", source);
    }

    if (invoiceTotal !== null && (subtotal !== null || lineTotal !== null)) {
      const possibleTotals = [
        subtotalBasedTotal,
        lineTotal === null ? null : lineTotal - discount + tax,
        lineTotal
      ].filter((value): value is number => value !== null);
      if (!possibleTotals.some((value) => this.moneyMatches(value, invoiceTotal))) {
        this.add(issues, "invoice_total_needs_review", "needs_review", "billedAmount", attachmentId,
          "The itemized amounts do not equal the invoice total. Check for tax, discount, or an extraction error.",
          source);
      }
    }
  }

  private moneyMatches(first: number, second: number) {
    return Math.abs(first - second) <= MONEY_TOLERANCE;
  }

  private checkInvoiceDate(
    value: string | null,
    attachmentId: string,
    issues: ValidationIssue[],
    now: Date,
    source: IssueSource,
    evidence?: DateEvidence[]
  ) {
    const date = this.checkDateIntegrity("invoiceDate", value, attachmentId, issues, source, evidence);
    if (!date) return;
    const today = Date.UTC(
      now.getUTCFullYear(),
      now.getUTCMonth(),
      now.getUTCDate()
    );
    if (date.getTime() > today) {
      this.add(issues, "invoice_date_future", "invalid", "invoiceDate", attachmentId,
        "The invoice date cannot be in the future.", source);
    }
  }

  private checkDuplicateInvoiceEvidence(
    invoices: ClaimEvidenceUnit[],
    issues: ValidationIssue[]
  ) {
    const seen = new Map<string, ClaimEvidenceUnit>();
    for (const invoice of invoices.filter((unit) => unit.documentType === "invoice")) {
      const fields = invoice.extracted;
      const reference = this.normalize(fields.invoiceReference ?? "");
      const currency = fields.currency?.trim().toUpperCase() ?? "";
      const date = dateEvidenceFor("invoiceDate", fields.invoiceDate, invoice.dateEvidence);
      if (!reference || !currency || !this.positive(fields.billedAmount) ||
          date?.precision !== "complete" || !date.normalizedDate) {
        continue;
      }
      const key = `${reference}|${date.normalizedDate}|${currency}|${fields.billedAmount!.toFixed(2)}`;
      const original = seen.get(key);
      if (!original) {
        seen.set(key, invoice);
        continue;
      }
      this.add(
        issues,
        "duplicate_invoice_evidence",
        "conflict",
        "invoice",
        invoice.attachmentId,
        "This appears to repeat another invoice in this claim. Remove the duplicate or replace it with the intended invoice.",
        this.source(invoice),
        {
          messageAr: "يبدو أن هذه الفاتورة مكررة ضمن المطالبة. احذف النسخة المكررة أو استبدلها بالفاتورة المقصودة.",
          details: [`Matches invoice evidence from attachment ${original.attachmentId}.`],
          detailsAr: ["تتطابق مع دليل فاتورة آخر مرفوع ضمن هذه المطالبة."]
        }
      );
    }
  }

  private checkAdmissionDates(
    analyses: ClaimEvidenceUnit[],
    issues: ValidationIssue[],
    now: Date
  ) {
    const clinicalTypes = new Set(["medical_report", "discharge_summary"]);
    const dateAnalyses = analyses.filter((item) =>
      this.hasValue(item.extracted.admissionDate) || this.hasValue(item.extracted.dischargeDate) ||
      item.dateEvidence?.some((date) =>
        date.field === "admissionDate" || date.field === "dischargeDate"
      )
    );
    if (dateAnalyses.length === 0) return;

    const parsedByUnit = new Map<string, Partial<Record<"admissionDate" | "dischargeDate", Date>>>();
    for (const analysis of dateAnalyses) {
      const parsed: Partial<Record<"admissionDate" | "dischargeDate", Date>> = {};
      for (const field of ["admissionDate", "dischargeDate"] as const) {
        const value = analysis.extracted[field];
        const codePrefix = field === "admissionDate" ? "admission_date" : "discharge_date";
        const date = this.checkDateIntegrity(
          field,
          value,
          analysis.attachmentId,
          issues,
          this.source(analysis),
          analysis.dateEvidence
        );
        if (!date) continue;
        parsed[field] = date;
        const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
        if (date.getTime() > today) {
          this.add(issues, `${codePrefix}_future`, "invalid", field, analysis.attachmentId,
            `The ${this.fieldLabel(field)} cannot be in the future.`, this.source(analysis));
        }
      }
      parsedByUnit.set(analysis.evidenceUnitId, parsed);
      if (parsed.admissionDate && parsed.dischargeDate &&
          parsed.admissionDate.getTime() > parsed.dischargeDate.getTime()) {
        this.add(issues, "admission_discharge_order_invalid", "invalid", "admissionDate",
          analysis.attachmentId, "The admission date cannot be after the discharge date.",
          this.source(analysis));
      }
    }

    const ordered = [
      ...dateAnalyses.filter((item) => clinicalTypes.has(item.documentType)),
      ...dateAnalyses.filter((item) => !clinicalTypes.has(item.documentType))
    ];
    const admission = ordered.flatMap((analysis) => {
      const date = parsedByUnit.get(analysis.evidenceUnitId)?.admissionDate;
      return date ? [{ date, unit: analysis }] : [];
    })[0];
    const discharge = ordered.flatMap((analysis) => {
      const date = parsedByUnit.get(analysis.evidenceUnitId)?.dischargeDate;
      return date ? [{ date, unit: analysis }] : [];
    })[0];
    if (admission && discharge && admission.unit.evidenceUnitId !== discharge.unit.evidenceUnitId &&
        admission.date.getTime() > discharge.date.getTime()) {
      this.add(issues, "admission_discharge_order_invalid", "invalid", "admissionDate",
        null, "The admission date cannot be after the discharge date.");
    }
  }

  private checkClinicalServiceDates(
    analyses: ClaimEvidenceUnit[],
    issues: ValidationIssue[],
    now: Date
  ) {
    for (const unit of analyses.filter((item) => !this.isInvoiceEvidence(item))) {
      this.checkServiceDate(
        unit.extracted.serviceDate,
        unit.attachmentId,
        issues,
        now,
        "serviceDate",
        this.source(unit),
        unit.dateEvidence
      );
    }
  }

  private checkServiceDate(
    value: string | null,
    attachmentId: string,
    issues: ValidationIssue[],
    now: Date,
    field = "serviceDate",
    source?: IssueSource,
    evidence?: DateEvidence[],
    serviceLineIndex: number | null = null
  ) {
    const date = this.checkDateIntegrity(
      "serviceDate",
      value,
      attachmentId,
      issues,
      source,
      evidence,
      field,
      serviceLineIndex
    );
    if (!date) return;
    const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
    if (date.getTime() > today) {
      this.add(issues, "service_date_future", "invalid", field, attachmentId,
        "The service date cannot be in the future.", source);
    }
  }

  private checkDateIntegrity(
    semanticField: DateField,
    value: string | null,
    attachmentId: string,
    issues: ValidationIssue[],
    source?: IssueSource,
    evidence?: DateEvidence[],
    issueField: string = semanticField,
    serviceLineIndex: number | null = null
  ) {
    const item = dateEvidenceFor(semanticField, value, evidence, serviceLineIndex);
    if (!item) return null;
    const label = this.fieldLabel(semanticField);
    if (item.precision !== "complete" || !item.normalizedDate) {
      const incomplete = ["month_year", "year", "day_month", "day_year"].includes(item.precision);
      const state = item.precision === "ambiguous" ? "conflict" as const : "invalid" as const;
      const missing = [
        item.day === null ? "day" : null,
        item.month === null ? "month" : null,
        item.year === null ? "year" : null
      ].filter((part): part is string => Boolean(part));
      this.add(
        issues,
        `${semanticField.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`)}_${incomplete ? "incomplete" : "invalid"}`,
        incomplete ? "missing" : state,
        issueField,
        attachmentId,
        incomplete
          ? `${this.title(label)} is incomplete.`
          : item.precision === "ambiguous"
            ? `${this.title(label)} is ambiguous. Enter the complete date.`
            : `${this.title(label)} is not a valid calendar date.`,
        source,
        {
          messageAr: incomplete
            ? `تاريخ ${this.arabicDateLabel(semanticField)} غير مكتمل.`
            : item.precision === "ambiguous"
              ? `تاريخ ${this.arabicDateLabel(semanticField)} ملتبس. أدخل التاريخ كاملاً.`
              : `تاريخ ${this.arabicDateLabel(semanticField)} غير صالح.`,
          details: missing.length > 0
            ? [`Missing from the uploaded document: ${missing.join(", ")}. Printed value: ${item.rawText}`]
            : [`Printed value: ${item.rawText}`],
          detailsAr: missing.length > 0
            ? [`الأجزاء غير الموجودة في المستند: ${missing.join("، ")}. القيمة المطبوعة: ${item.rawText}`]
            : [`القيمة المطبوعة: ${item.rawText}`]
        }
      );
      return null;
    }
    const parsed = this.parseIsoDate(item.normalizedDate);
    if (!parsed) {
      this.add(
        issues,
        `${semanticField.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`)}_invalid`,
        "invalid",
        issueField,
        attachmentId,
        `${this.title(label)} is not a valid calendar date.`,
        source,
        {
          messageAr: `تاريخ ${this.arabicDateLabel(semanticField)} غير صالح.`,
          details: [`Printed value: ${item.rawText}`],
          detailsAr: [`القيمة المطبوعة: ${item.rawText}`]
        }
      );
      return null;
    }
    return parsed;
  }

  private checkServiceDateConflict(
    sources: ClaimEvidenceUnit[],
    effective: ClaimEvidenceUnit[],
    issues: ValidationIssue[]
  ) {
    const values = (units: ClaimEvidenceUnit[]) => [...new Set(units.flatMap((unit) => {
      const item = dateEvidenceFor("serviceDate", unit.extracted.serviceDate, unit.dateEvidence);
      return item?.precision === "complete" && item.normalizedDate ? [item.normalizedDate] : [];
    }))];
    const sourceValues = values(sources);
    if (sourceValues.length < 2 || values(effective).length === 1) return;
    this.add(
      issues,
      "service_date_conflict",
      "conflict",
      "serviceDate",
      null,
      "We found different service dates in your documents. Choose the correct effective date.",
      undefined,
      {
        messageAr: "وجدنا تواريخ خدمة مختلفة في مستنداتك. اختر التاريخ الصحيح للمطالبة.",
        details: sourceValues.map((value) => `Document service date: ${value}`),
        detailsAr: sourceValues.map((value) => `تاريخ الخدمة في المستند: ${value}`)
      }
    );
  }

  private title(value: string) {
    return value.charAt(0).toUpperCase() + value.slice(1);
  }

  private arabicDateLabel(field: DateField) {
    return ({
      invoiceDate: "الفاتورة",
      serviceDate: "الخدمة",
      admissionDate: "الدخول",
      dischargeDate: "الخروج"
    } as const)[field];
  }

  private checkMemberEdits(
    sources: ClaimEvidenceUnit[],
    effective: ClaimEvidenceUnit[],
    issues: ValidationIssue[]
  ) {
    if (sources.length === 0 || effective === sources) return;
    const primary = sources.find((item) => this.isInvoiceEvidence(item)) ?? sources[0];
    const importantFields = [
      "patientName",
      "providerName",
      "providerLocation",
      "invoiceReference",
      "invoiceDate",
      "serviceDate",
      "currency",
      "billedAmount"
    ] as const;
    for (const field of importantFields) {
      const source = sources.find((item) => this.hasValue(item.extracted[field])) ?? primary;
      const current = effective.find((item) =>
        item.evidenceUnitId === source.evidenceUnitId
      );
      if (!current) continue;
      const sourceValue = source.extracted[field];
      if (!this.hasValue(sourceValue)) continue;
      const memberValue = current.extracted[field];
      if (this.valuesEquivalent(sourceValue, memberValue)) continue;
      this.add(
        issues,
        `member_edit_differs_from_source_${field}`,
        "needs_review",
        field,
        source.attachmentId,
        `Your ${this.fieldLabel(field)} differs from the uploaded document. Review it before submitting.`,
        this.source(source)
      );
    }
  }

  private valuesEquivalent(left: unknown, right: unknown) {
    if (left === right) return true;
    if (typeof left === "number" && typeof right === "number") {
      return this.moneyMatches(left, right);
    }
    if (typeof left === "string" && typeof right === "string") {
      return this.normalize(left) === this.normalize(right);
    }
    return left === null && right === null;
  }

  private fieldLabel(field: string) {
    return field.replace(/([a-z])([A-Z])/g, "$1 $2").toLocaleLowerCase();
  }

  private hasValue(value: unknown) {
    return value !== null && value !== undefined && value !== "";
  }

  private checkPaymentEvidence(
    analyses: ClaimEvidenceUnit[],
    issues: ValidationIssue[]
  ) {
    const invoices = analyses.filter((analysis) => this.isInvoiceEvidence(analysis));
    const invoicesNeedingSeparateEvidence = invoices.filter(
      (analysis) => analysis.extracted.paymentStatus !== "paid"
    );
    const receipts = analyses.filter(
      (analysis) => analysis.documentType === "payment_receipt" &&
        !this.isInvoiceEvidence(analysis)
    );
    if (invoicesNeedingSeparateEvidence.length > 0 && receipts.length === 0) {
      this.add(issues, "payment_evidence_missing", "missing", "paymentEvidence", null,
        invoices.length > 1
          ? "Upload proof of payment for each invoice that does not clearly show it was paid."
          : "Upload proof of payment, or an itemized invoice that clearly shows it was paid.");
      return;
    }
    if (invoicesNeedingSeparateEvidence.length === 0) return;

    const invoiceAmounts = invoicesNeedingSeparateEvidence
      .map((invoice) => invoice.extracted.billedAmount)
      .filter((amount): amount is number => this.positive(amount));
    const invoiceTotal = invoiceAmounts.reduce((sum, amount) => sum + amount, 0);
    const invoiceCurrencies = new Set(
      invoicesNeedingSeparateEvidence
        .map((invoice) => invoice.extracted.currency?.trim().toUpperCase())
        .filter((currency): currency is string => Boolean(currency))
    );
    const receiptAmounts: number[] = [];
    let hasUnclearReceiptAmount = false;
    let hasAmountMismatch = false;

    for (const receipt of receipts) {
      const amount = receipt.extracted.billedAmount;
      const currency = receipt.extracted.currency?.trim().toUpperCase() ?? null;
      if (!this.positive(amount) || !currency) {
        hasUnclearReceiptAmount = true;
        this.add(issues, "payment_evidence_unclear", "needs_review", "paymentEvidence", receipt.attachmentId,
          "Confirm that this receipt shows payment for the invoice in this claim.",
          this.source(receipt));
        continue;
      }
      const paidAmount = amount as number;
      receiptAmounts.push(paidAmount);
      if (invoiceCurrencies.size > 0 && !invoiceCurrencies.has(currency)) {
        this.add(issues, "payment_currency_mismatch", "needs_review", "paymentEvidence", receipt.attachmentId,
          "The receipt currency differs from the invoice currency. Confirm that they belong together.",
          this.source(receipt));
      }
      if (invoiceAmounts.length > 0 &&
          !invoiceAmounts.some((invoiceAmount) => this.moneyMatches(invoiceAmount, paidAmount)) &&
          !this.moneyMatches(invoiceTotal, paidAmount)) {
        hasAmountMismatch = true;
        this.add(issues, "payment_amount_mismatch", "needs_review", "paymentEvidence", receipt.attachmentId,
          "The receipt amount does not match an invoice or the combined invoice total. Confirm the payment evidence.",
          this.source(receipt));
      }
    }

    if (invoiceAmounts.length > 1 && !hasUnclearReceiptAmount && !hasAmountMismatch) {
      const oneReceiptCoversTotal = receiptAmounts.some((amount) =>
        this.moneyMatches(amount, invoiceTotal)
      );
      const unmatchedReceipts = [...receiptAmounts];
      const everyInvoiceCovered = invoiceAmounts.every((invoiceAmount) => {
        const matchIndex = unmatchedReceipts.findIndex((receiptAmount) =>
          this.moneyMatches(receiptAmount, invoiceAmount)
        );
        if (matchIndex < 0) return false;
        unmatchedReceipts.splice(matchIndex, 1);
        return true;
      });
      if (!oneReceiptCoversTotal && !everyInvoiceCovered) {
        this.add(issues, "payment_coverage_unclear", "needs_review", "paymentEvidence", null,
          "The uploaded receipts do not clearly cover every unpaid invoice. Confirm that the payment evidence is complete.");
      }
    }
  }

  private checkCategoryEvidence(
    claim: ClaimRecord,
    analyses: ClaimEvidenceUnit[],
    issues: ValidationIssue[],
    sourceAnalyses = analyses
  ) {
    const policy = CLAIM_VALIDATION_POLICY.categories[claim.category];
    for (const requiredGroup of policy.requiredDocumentGroups) {
      const hasUnusableSource = sourceAnalyses.some((analysis) =>
        requiredGroup.some((type) => type === analysis.documentType) &&
        (analysis.readability === "unreadable" || analysis.relevance === "irrelevant")
      );
      if (hasUnusableSource) continue;

      const completeness = this.evidenceCompleteness.evaluateRequiredGroup(
        requiredGroup,
        analyses
      );
      this.addEvidenceCompletenessIssue(claim, completeness, issues);
    }
    if (claim.category === "optical") {
      const selectedItems = claim.opticalItem === "both"
        ? (["frames", "lenses"] as const)
        : claim.opticalItem ? [claim.opticalItem] : [];
      const evidence = {
        frames: {
          amount: analyses.find((analysis) => this.positive(analysis.extracted.opticalFrameAmount)),
          detected: analyses.find((analysis) => analysis.detectedOpticalItems.includes("frames"))
        },
        lenses: {
          amount: analyses.find((analysis) => this.positive(analysis.extracted.opticalLensAmount)),
          detected: analyses.find((analysis) => analysis.detectedOpticalItems.includes("lenses"))
        }
      };

      for (const selectedItem of selectedItems) {
        if (evidence[selectedItem].amount) continue;

        const otherItem = selectedItem === "frames" ? "lenses" : "frames";
        const onlyOtherItemIsEvidenced = selectedItems.length === 1 &&
          !evidence[selectedItem].detected &&
          Boolean(evidence[otherItem].amount || evidence[otherItem].detected);

        if (onlyOtherItemIsEvidenced) {
          const source = evidence[otherItem].amount ?? evidence[otherItem].detected;
          this.add(
            issues,
            "optical_item_mismatch",
            "conflict",
            "opticalItem",
            source?.attachmentId ?? null,
            `This claim is for ${selectedItem}, but the documents only show ${otherItem}. Check the selection or invoice.`,
            source ? this.source(source) : undefined
          );
          continue;
        }

        const label = selectedItem === "frames" ? "frame" : "lens";
        this.add(
          issues,
          selectedItem === "frames" ? "optical_frame_amount_missing" : "optical_lens_amount_missing",
          "missing",
          selectedItem === "frames" ? "opticalFrameAmount" : "opticalLensAmount",
          null,
          `Confirm the separately itemized ${label} amount.`
        );
      }
    }
  }

  private checkCrossDocumentConsistency(
    analyses: ClaimEvidenceUnit[],
    issues: ValidationIssue[]
  ) {
    const names = analyses
      .filter((analysis) => analysis.extracted.patientName)
      .map((analysis) => ({ unit: analysis, value: analysis.extracted.patientName! }));
    if (names.length > 1) {
      const base = names[0];
      for (const candidate of names.slice(1)) {
        const match = this.compareNames(base.value, candidate.value);
        if (match !== "same") {
          this.add(issues, "patient_name_mismatch", match === "different" ? "conflict" : "needs_review",
            "patientName", candidate.unit.attachmentId,
            match === "different"
              ? "Patient names differ across the uploaded documents. Replace the unrelated file or correct the extracted name."
              : "Confirm that the patient names across these documents refer to the same person.",
            this.source(candidate.unit));
          break;
        }
      }
    }

    const providers = new Set(
      analyses.map((analysis) => this.normalize(analysis.extracted.providerName ?? "")).filter(Boolean)
    );
    if (providers.size > 1) {
      this.add(issues, "provider_mismatch", "needs_review", "providerName", null,
        "Provider names differ across the documents. Confirm they belong to one treatment episode.");
    }

  }

  private checkEpisodeBoundary(
    analyses: ClaimEvidenceUnit[],
    issues: ValidationIssue[]
  ) {
    // A report, prescription, test result, or payment receipt may be created on
    // a different date while still supporting the same treatment episode. Only
    // billed invoice services define the episode boundary here.
    const invoiceAnalyses = analyses.filter((analysis) => this.isInvoiceEvidence(analysis));
    const values = invoiceAnalyses.flatMap((analysis) => [
      analysis.extracted.serviceDate,
      ...analysis.extracted.serviceLines.map((line) => line.serviceDate)
    ]).filter((value): value is string => Boolean(value));
    const dates = [...new Set(values)]
      .map((value) => this.parseIsoDate(value))
      .filter((value): value is Date => value !== null);
    if (dates.length <= 1) return;

    const admissionRanges = analyses.flatMap((analysis) => {
      const start = this.parseIsoDate(analysis.extracted.admissionDate ?? "");
      const end = this.parseIsoDate(analysis.extracted.dischargeDate ?? "");
      return start && end ? [{ start, end }] : [];
    });
    const coveredByAdmission = admissionRanges.some(({ start, end }) =>
      dates.every((date) => date >= start && date <= end)
    );
    if (coveredByAdmission) return;

    this.add(issues, "episode_dates_unclear", "needs_review", "serviceDate", null,
      "The documents contain more than one service date. Confirm they belong to the same treatment episode.");
  }

  private compareNames(left: string, right: string): "same" | "uncertain" | "different" {
    const a = this.normalize(left);
    const b = this.normalize(right);
    if (a === b) return "same";
    const aArabic = /[\u0600-\u06ff]/.test(a);
    const bArabic = /[\u0600-\u06ff]/.test(b);
    if (aArabic !== bArabic) return "uncertain";
    const aTokens = new Set(a.split(" ").filter((token) => token.length > 1));
    const shared = b.split(" ").some((token) => token.length > 1 && aTokens.has(token));
    return shared ? "uncertain" : "different";
  }

  private normalize(value: string) {
    return value.toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
  }

  private categoryLabel(category: ClaimRecord["category"]) {
    const labels: Record<ClaimRecord["category"], string> = {
      inpatient_surgery: "Inpatient and Surgery",
      dental: "Dental",
      optical: "Optical",
      other_outpatient: "Other/Outpatient"
    };
    return labels[category];
  }

  private categoryLabelAr(category: ClaimRecord["category"]) {
    const labels: Record<ClaimRecord["category"], string> = {
      inpatient_surgery: "التنويم والجراحة",
      dental: "الأسنان",
      optical: "البصريات",
      other_outpatient: "العيادات الخارجية الأخرى"
    };
    return labels[category];
  }

  private strongCategorySignals(unit: ClaimEvidenceUnit) {
    const categories = new Set(unit.detectedCategories);
    if (unit.detectedOpticalItems.length > 0 ||
        this.positive(unit.extracted.opticalFrameAmount) ||
        this.positive(unit.extracted.opticalLensAmount)) {
      categories.add("optical");
    }
    if (unit.extracted.serviceLines.some((line) => Boolean(line.toothNumber?.trim()))) {
      categories.add("dental");
    }
    return [...categories];
  }

  private categorySignalDetails(units: ClaimEvidenceUnit[]) {
    const details: string[] = [];
    if (units.some((unit) => unit.extracted.serviceLines.some((line) =>
      Boolean(line.toothNumber?.trim())
    ))) details.push("Tooth-specific treatment was detected.");
    if (units.some((unit) => unit.detectedOpticalItems.length > 0 ||
      this.positive(unit.extracted.opticalFrameAmount) ||
      this.positive(unit.extracted.opticalLensAmount))) {
      details.push("Optical-specific evidence was detected.");
    }
    return details;
  }

  private categorySignalDetailsAr(units: ClaimEvidenceUnit[]) {
    const details: string[] = [];
    if (units.some((unit) => unit.extracted.serviceLines.some((line) =>
      Boolean(line.toothNumber?.trim())
    ))) details.push("تم اكتشاف علاج مرتبط بأسنان محددة.");
    if (units.some((unit) => unit.detectedOpticalItems.length > 0 ||
      this.positive(unit.extracted.opticalFrameAmount) ||
      this.positive(unit.extracted.opticalLensAmount))) {
      details.push("تم اكتشاف أدلة خاصة بخدمات البصريات.");
    }
    return details;
  }

  private documentTypeLabel(documentType: DocumentType) {
    const labels: Partial<Record<DocumentType, string>> = {
      medical_report: "medical report",
      discharge_summary: "discharge summary",
      eye_test: "eye test",
      prescription: "prescription",
      dental_xray: "dental X-ray",
      lab_result: "lab result",
      imaging_result: "imaging result"
    };
    return labels[documentType] ?? "supporting document";
  }

  private parseIsoDate(value: string) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
    const date = new Date(`${value}T00:00:00.000Z`);
    return Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value
      ? null
      : date;
  }

  private positive(value: number | null) {
    return value !== null && Number.isFinite(value) && value > 0;
  }

  private source(unit: ClaimEvidenceUnit): IssueSource {
    return {
      attachmentId: unit.attachmentId,
      evidenceUnitId: unit.evidenceUnitId,
      pageStart: unit.pageStart,
      pageEnd: unit.pageEnd
    };
  }

  private completenessSource(
    completeness: EvidenceCompletenessResult
  ): IssueSource | undefined {
    return completeness.attachmentId && completeness.evidenceUnitId
      ? {
          attachmentId: completeness.attachmentId,
          evidenceUnitId: completeness.evidenceUnitId,
          pageStart: completeness.pageStart,
          pageEnd: completeness.pageEnd
        }
      : undefined;
  }

  private stringArray(value: string | null) {
    if (!value) return null;
    try {
      const parsed = JSON.parse(value) as unknown;
      return Array.isArray(parsed) && parsed.every((item) => typeof item === "string")
        ? parsed
        : null;
    } catch {
      return null;
    }
  }

  private addEvidenceCompletenessIssue(
    claim: ClaimRecord,
    completeness: EvidenceCompletenessResult,
    issues: ValidationIssue[]
  ) {
    if (completeness.state === "present_useful") return;

    if (completeness.state === "absent") {
      const categoryMessage = claim.category === "inpatient_surgery"
        ? "Upload a medical or discharge report for this inpatient or surgery claim."
        : "Upload the eye test or prescription supporting this Optical claim.";
      this.add(
        issues,
        claim.category === "inpatient_surgery"
          ? "inpatient_document_missing"
          : `${claim.category}_document_missing`,
        "missing",
        "supportingDocument",
        null,
        categoryMessage
      );
      return;
    }

    const label = this.documentTypeLabel(completeness.documentType);
    if (completeness.state === "present_insufficient") {
      this.removeDerivativeDocumentWarnings(
        issues, completeness.attachmentId, completeness.evidenceUnitId
      );
      const informationLabel = completeness.documentType === "medical_report" ||
        completeness.documentType === "discharge_summary"
        ? "readable clinical information"
        : "enough readable supporting information";
      this.add(
        issues,
        `${completeness.documentType}_insufficient`,
        "missing",
        "supportingDocument",
        completeness.attachmentId,
        `We found the ${label}, but it does not contain ${informationLabel}. Replace it with a more complete copy.`,
        this.completenessSource(completeness)
      );
      return;
    }

    this.removeDerivativeDocumentWarnings(
      issues, completeness.attachmentId, completeness.evidenceUnitId
    );
    this.add(
      issues,
      `${completeness.documentType}_uncertain`,
      "needs_review",
      "supportingDocument",
      completeness.attachmentId,
      `We found the ${label}, but some supporting details could not be verified automatically. Review the document before submitting.`,
      this.completenessSource(completeness)
    );
  }

  private removeDerivativeDocumentWarnings(
    issues: ValidationIssue[],
    attachmentId: string | null,
    evidenceUnitId: string | null
  ) {
    if (!attachmentId) return;
    const derivativeCodes = new Set([
      "document_readability_unclear",
      "document_relevance_unclear"
    ]);
    for (let index = issues.length - 1; index >= 0; index -= 1) {
      if (issues[index]?.attachmentId === attachmentId &&
          (evidenceUnitId === null || issues[index]?.evidenceUnitId === evidenceUnitId) &&
          derivativeCodes.has(issues[index]!.code)) {
        issues.splice(index, 1);
      }
    }
  }

  private isRequiredSupportingDocument(
    claim: ClaimRecord,
    documentType: DocumentType
  ) {
    return CLAIM_VALIDATION_POLICY.categories[claim.category].requiredDocumentGroups
      .some((group) => group.some((type) => type === documentType));
  }

  private severityForState(state: ValidationIssue["state"]): ValidationSeverity {
    return state === "needs_review" ? "warning" : "blocking_error";
  }

  private issueSummary(issues: ValidationIssue[]) {
    const blockingIssueCount = issues.filter(
      (issue) => issue.severity === "blocking_error"
    ).length;
    return {
      readyToSubmit: blockingIssueCount === 0,
      blockingIssueCount,
      warningCount: issues.filter((issue) => issue.severity === "warning").length,
      infoCount: issues.filter((issue) => issue.severity === "info").length
    };
  }

  private overallState(issues: ValidationIssue[]): ValidationState {
    for (const state of ["invalid", "conflict", "missing", "needs_review"] as const) {
      if (issues.some((issue) => issue.state === state)) return state;
    }
    return "ready";
  }

  private add(
    issues: ValidationIssue[],
    code: string,
    state: ValidationIssue["state"],
    field: string | null,
    attachmentId: string | null,
    message: string,
    source?: IssueSource,
    copy: IssueCopy = {}
  ) {
    const evidenceUnitId = source?.evidenceUnitId ?? null;
    if (!issues.some((issue) =>
      issue.code === code &&
      issue.attachmentId === attachmentId &&
      (issue.evidenceUnitId ?? null) === evidenceUnitId
    )) {
      issues.push({
        code,
        state,
        field,
        attachmentId,
        evidenceUnitId,
        pageStart: source?.pageStart ?? null,
        pageEnd: source?.pageEnd ?? null,
        message,
        ...copy,
        severity: this.severityForState(state)
      });
    }
  }
}
