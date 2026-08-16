export type MemberIdentifierType =
  | "member_id"
  | "national_id"
  | "iqama_id";

export type MemberIdSource = "provided" | "synthetic";

export interface MemberRecord {
  memberId: string;
  memberIdSource: MemberIdSource;
  identifier: string;
  identifierType: MemberIdentifierType;
  passwordHash: string;
  createdAt: Date;
}

export interface PublicMember {
  memberId: string;
  memberIdSource: MemberIdSource;
  identifier: string;
  identifierType: MemberIdentifierType;
  createdAt: Date;
}

export function getIdentifierType(
  identifier: string
): MemberIdentifierType {
  if (/^\d{8}$/.test(identifier)) {
    return "member_id";
  }

  if (/^1\d{9}$/.test(identifier)) {
    return "national_id";
  }

  if (/^2\d{9}$/.test(identifier)) {
    return "iqama_id";
  }

  throw new Error(
    "Identifier must be an 8-digit Member ID, a 10-digit National ID starting with 1, or a 10-digit Iqama starting with 2"
  );
}

export function toPublicMember(member: MemberRecord): PublicMember {
  return {
    memberId: member.memberId,
    memberIdSource: member.memberIdSource,
    identifier: member.identifier,
    identifierType: member.identifierType,
    createdAt: member.createdAt
  };
}
