export type ValidationState =
  | "ready"
  | "needs_review"
  | "conflict"
  | "missing"
  | "invalid";

export type ValidationSeverity = "info" | "warning" | "blocking_error";

export interface ValidationIssue {
  code: string;
  state: Exclude<ValidationState, "ready">;
  field: string | null;
  attachmentId: string | null;
  evidenceUnitId?: string | null;
  pageStart?: number | null;
  pageEnd?: number | null;
  message: string;
  messageAr?: string;
  details?: string[];
  detailsAr?: string[];
  severity: ValidationSeverity;
}

export interface ClaimValidationResult {
  claimId: string;
  state: ValidationState;
  readyToSubmit: boolean;
  blockingIssueCount: number;
  warningCount: number;
  infoCount: number;
  validatedAt: string;
  issues: ValidationIssue[];
}

export function validationIssueKey(
  code: string,
  attachmentId: string | null,
  evidenceUnitId: string | null = null,
  claimId: string | null = null
) {
  const legacyKey = `${code}|${attachmentId ?? "claim"}`;
  if (attachmentId === null && claimId) return `${legacyKey}|${claimId}`;
  const synthesizedLegacyUnit = attachmentId !== null &&
    evidenceUnitId === `${attachmentId}:evidence:legacy:1`;
  return evidenceUnitId && !synthesizedLegacyUnit
    ? `${legacyKey}|${evidenceUnitId}`
    : legacyKey;
}
