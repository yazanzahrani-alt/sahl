import { Injectable } from "@nestjs/common";
import { randomInt } from "node:crypto";
import { DatabaseService } from "../database/database.service";
import {
  getIdentifierType,
  MemberIdentifierType,
  MemberIdSource,
  MemberRecord
} from "./member";
import { MockMemberLookupService } from "./mock-member-lookup.service";

interface MemberRow {
  member_id: string;
  member_id_source: MemberIdSource;
  identifier: string;
  identifier_type: MemberIdentifierType;
  password_hash: string;
  created_at: string;
}

function mapMember(row: MemberRow): MemberRecord {
  return {
    memberId: row.member_id,
    memberIdSource: row.member_id_source,
    identifier: row.identifier,
    identifierType: row.identifier_type,
    passwordHash: row.password_hash,
    createdAt: new Date(row.created_at)
  };
}

const MEMBER_SELECT = `
  SELECT
    members.member_id,
    members.member_id_source,
    member_identifiers.identifier,
    member_identifiers.identifier_type,
    members.password_hash,
    members.created_at
  FROM members
  JOIN member_identifiers
    ON member_identifiers.member_id = members.member_id
`;

@Injectable()
export class MembersService {
  constructor(
    private readonly database: DatabaseService,
    private readonly memberLookup: MockMemberLookupService
  ) {}

  findByIdentifier(identifier: string) {
    const row = this.database.get<MemberRow>(
      `${MEMBER_SELECT}
       WHERE member_identifiers.identifier = ?`,
      identifier
    );

    return row ? mapMember(row) : null;
  }

  findByMemberId(memberId: string) {
    const row = this.database.get<MemberRow>(
      `${MEMBER_SELECT}
       WHERE members.member_id = ?
         AND member_identifiers.identifier = members.member_id`,
      memberId
    );

    return row ? mapMember(row) : null;
  }

  createIfMissing(
    identifier: string,
    identifierType: MemberIdentifierType,
    passwordHash: string
  ) {
    return this.database.transaction(() => {
      const existing = this.findByIdentifier(identifier);
      if (existing) {
        return { member: existing, created: false };
      }

      const mapping = this.memberLookup.resolve(identifier);
      const memberId =
        identifierType === "member_id"
          ? identifier
          : mapping?.memberId ?? this.generateSyntheticMemberId();
      const memberIdSource: MemberIdSource =
        mapping || identifierType !== "member_id"
          ? "synthetic"
          : "provided";

      const memberWithCanonicalId = this.findByMemberId(memberId);
      if (memberWithCanonicalId) {
        this.linkIdentifier(memberId, identifier, identifierType);
        const linkedMember = this.findByIdentifier(identifier);
        if (!linkedMember) {
          throw new Error("Login identifier was not linked");
        }
        return { member: linkedMember, created: false };
      }

      const createdAt = new Date().toISOString();
      this.database.run(
        `INSERT INTO members
         (member_id, member_id_source, password_hash, created_at)
         VALUES (?, ?, ?, ?)`,
        memberId,
        memberIdSource,
        passwordHash,
        createdAt
      );

      this.linkIdentifier(memberId, memberId, "member_id");

      for (const linkedIdentifier of mapping?.loginIdentifiers ?? [
        identifier
      ]) {
        this.linkIdentifier(
          memberId,
          linkedIdentifier,
          getIdentifierType(linkedIdentifier)
        );
      }

      const member = this.findByIdentifier(identifier);
      if (!member) {
        throw new Error("Member was not created or found");
      }

      return { member, created: true };
    });
  }

  private linkIdentifier(
    memberId: string,
    identifier: string,
    identifierType: MemberIdentifierType
  ) {
    const existingIdentity = this.database.get<{
      member_id: string;
    }>(
      `SELECT member_id
       FROM member_identifiers
       WHERE identifier = ?`,
      identifier
    );

    if (existingIdentity) {
      if (existingIdentity.member_id !== memberId) {
        throw new Error(
          `Identifier ${identifier} is already linked to another member`
        );
      }
      return;
    }

    this.database.run(
      `INSERT INTO member_identifiers
       (member_id, identifier, identifier_type)
       VALUES (?, ?, ?)`,
      memberId,
      identifier,
      identifierType
    );
  }

  private generateSyntheticMemberId() {
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const candidate = randomInt(100_000_000)
        .toString()
        .padStart(8, "0");

      if (
        !this.memberLookup.isReservedMemberId(candidate) &&
        !this.findByMemberId(candidate)
      ) {
        return candidate;
      }
    }

    throw new Error("Unable to generate a unique synthetic Member ID");
  }
}
