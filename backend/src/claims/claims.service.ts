import {
  BadRequestException,
  Injectable,
  NotFoundException
} from "@nestjs/common";
import { DatabaseService } from "../database/database.service";
import {
  ClaimCategory,
  ClaimLocation,
  ClaimRecord,
  ClaimStatus,
  OpticalItem
} from "./claim";
import { CreateClaimDto } from "./dto/create-claim.dto";
import { UpdateClaimDto } from "./dto/update-claim.dto";

interface ClaimRow {
  claim_id: string;
  member_id: string;
  category: ClaimCategory;
  optical_item: OpticalItem | null;
  claim_location: ClaimLocation;
  status: ClaimStatus;
  created_at: string;
  updated_at: string;
}

function mapClaim(row: ClaimRow): ClaimRecord {
  return {
    claimId: row.claim_id,
    memberId: row.member_id,
    category: row.category,
    opticalItem: row.optical_item,
    claimLocation: row.claim_location,
    status: row.status,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at)
  };
}

const CLAIM_SELECT = `
  SELECT
    claim_id,
    member_id,
    category,
    optical_item,
    claim_location,
    status,
    created_at,
    updated_at
  FROM claims
`;

@Injectable()
export class ClaimsService {
  constructor(private readonly database: DatabaseService) {}

  create(memberId: string, input: CreateClaimDto) {
    return this.database.transaction(() => {
      const claimId = this.nextClaimId();
      const now = new Date().toISOString();
      const opticalItem = this.resolveOpticalItem(
        input.category,
        input.opticalItem,
        input.opticalItem !== undefined
      );

      this.database.run(
        `INSERT INTO claims
         (claim_id, member_id, category, optical_item, claim_location, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, 'draft', ?, ?)`,
        claimId,
        memberId,
        input.category,
        opticalItem,
        input.claimLocation,
        now,
        now
      );

      return this.findOne(memberId, claimId);
    });
  }

  findAll(memberId: string) {
    return this.database
      .all<ClaimRow>(
        `${CLAIM_SELECT}
         WHERE member_id = ?
         ORDER BY updated_at DESC, claim_id DESC`,
        memberId
      )
      .map(mapClaim);
  }

  findOne(memberId: string, claimId: string) {
    const row = this.database.get<ClaimRow>(
      `${CLAIM_SELECT}
       WHERE claim_id = ? AND member_id = ?`,
      claimId,
      memberId
    );

    if (!row) {
      throw new NotFoundException("Claim not found");
    }

    return mapClaim(row);
  }

  discard(memberId: string, claimId: string) {
    const claim = this.findOne(memberId, claimId);
    if (claim.status === "accepted_for_processing") {
      throw new BadRequestException(
        "A submitted claim cannot be discarded."
      );
    }

    const storedFilenames = this.database
      .all<{ stored_filename: string }>(
        "SELECT stored_filename FROM attachments WHERE claim_id = ?",
        claimId
      )
      .map((row) => row.stored_filename);

    this.database.transaction(() => {
      this.database.run(
        "DELETE FROM claims WHERE claim_id = ? AND member_id = ?",
        claimId,
        memberId
      );
    });

    return storedFilenames;
  }

  update(memberId: string, claimId: string, input: UpdateClaimDto) {
    const claim = this.findOne(memberId, claimId);
    if (claim.status === "accepted_for_processing") {
      throw new BadRequestException("An accepted claim cannot be changed.");
    }
    const category = input.category ?? claim.category;
    const claimLocation = input.claimLocation ?? claim.claimLocation;
    const opticalItem = this.resolveOpticalItem(
      category,
      input.opticalItem ?? claim.opticalItem,
      input.opticalItem !== undefined
    );
    if (
      category === claim.category &&
      claimLocation === claim.claimLocation &&
      opticalItem === claim.opticalItem
    ) {
      return claim;
    }

    this.database.transaction(() => {
      this.database.run(
        `UPDATE claims
         SET category = ?, optical_item = ?, claim_location = ?, updated_at = ?
         WHERE claim_id = ? AND member_id = ?`,
        category,
        opticalItem,
        claimLocation,
        new Date().toISOString(),
        claimId,
        memberId
      );
      this.invalidateValidationInCurrentTransaction(memberId, claimId);
    });

    return this.findOne(memberId, claimId);
  }

  invalidateValidation(memberId: string, claimId: string) {
    this.database.transaction(() => {
      this.invalidateValidationInCurrentTransaction(memberId, claimId);
    });
  }

  invalidateValidationInCurrentTransaction(memberId: string, claimId: string) {
    const claim = this.findOne(memberId, claimId);
    if (claim.status === "accepted_for_processing") {
      throw new BadRequestException("An accepted claim cannot be changed.");
    }
    this.database.run(
      "DELETE FROM validation_issues WHERE claim_id = ?",
      claimId
    );
    this.database.run(
      "DELETE FROM validation_confirmations WHERE claim_id = ?",
      claimId
    );
    this.database.run(
      `UPDATE claims SET status = 'draft', updated_at = ?
       WHERE claim_id = ? AND member_id = ?`,
      new Date().toISOString(),
      claimId,
      memberId
    );
  }

  markProcessing(memberId: string, claimId: string) {
    const claim = this.findOne(memberId, claimId);
    if (claim.status === "accepted_for_processing") {
      throw new BadRequestException("An accepted claim cannot be changed.");
    }

    this.database.run(
      `UPDATE claims
       SET status = 'processing', updated_at = ?
       WHERE claim_id = ? AND member_id = ?`,
      new Date().toISOString(),
      claimId,
      memberId
    );

    return this.findOne(memberId, claimId);
  }

  setValidationStatus(
    memberId: string,
    claimId: string,
    status: Extract<ClaimStatus, "ready" | "needs_review">
  ) {
    const claim = this.findOne(memberId, claimId);
    if (claim.status === "accepted_for_processing") {
      throw new BadRequestException("An accepted claim cannot be changed.");
    }

    this.database.run(
      `UPDATE claims
       SET status = ?, updated_at = ?
       WHERE claim_id = ? AND member_id = ?`,
      status,
      new Date().toISOString(),
      claimId,
      memberId
    );

    return this.findOne(memberId, claimId);
  }

  private nextClaimId() {
    const year = new Date().getUTCFullYear();
    const prefix = `CLM-${year}-`;
    const existingIds = this.database.all<{ claim_id: string }>(
      `SELECT claim_id
       FROM claims
       WHERE claim_id LIKE ?`,
      `${prefix}%`
    );
    const sequence = existingIds.reduce((highest, row) => {
      const value = Number(row.claim_id.slice(prefix.length));
      return Number.isInteger(value) ? Math.max(highest, value) : highest;
    }, 0);

    return `${prefix}${String(sequence + 1).padStart(6, "0")}`;
  }

  private resolveOpticalItem(
    category: ClaimCategory,
    suppliedItem: OpticalItem | null | undefined,
    itemWasExplicitlySupplied = false
  ) {
    if (category === "optical") {
      if (!suppliedItem) {
        throw new BadRequestException(
          "Choose Frames, Lenses, or both for an Optical claim."
        );
      }
      return suppliedItem;
    }

    if (itemWasExplicitlySupplied) {
      throw new BadRequestException(
        "Frames, Lenses, or both can only be selected for an Optical claim."
      );
    }

    return null;
  }
}
