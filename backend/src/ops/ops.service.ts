import { BadRequestException, Injectable } from "@nestjs/common";
import { DatabaseService } from "../database/database.service";
import type { ClaimSubmission, SubmissionPayload } from "../claims/claim-submission";

interface OpsSubmissionRow {
  claim_id: string;
  acceptance_reference: string;
  payload_json: string;
  submitted_at: string;
}

@Injectable()
export class OpsService {
  constructor(private readonly database: DatabaseService) {}

  listAccepted(memberId: string): ClaimSubmission[] {
    return this.database
      .all<OpsSubmissionRow>(
        `SELECT s.claim_id, s.acceptance_reference, s.payload_json, s.submitted_at
         FROM claim_submissions s
         INNER JOIN claims c ON c.claim_id = s.claim_id
         WHERE c.status = 'accepted_for_processing'
           AND c.member_id = ?
         ORDER BY s.submitted_at DESC, s.claim_id DESC`,
        memberId
      )
      .map((row) => this.mapSubmission(row));
  }

  private mapSubmission(row: OpsSubmissionRow): ClaimSubmission {
    try {
      return {
        claimId: row.claim_id,
        acceptanceReference: row.acceptance_reference,
        submittedAt: row.submitted_at,
        payload: JSON.parse(row.payload_json) as SubmissionPayload
      };
    } catch {
      throw new BadRequestException(
        `The stored submission payload for ${row.claim_id} is invalid.`
      );
    }
  }
}
