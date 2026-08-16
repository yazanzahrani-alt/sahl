import { Injectable } from "@nestjs/common";

interface MockMemberMapping {
  memberId: string;
  loginIdentifiers: string[];
}

const DEMO_MEMBER_MAPPINGS: MockMemberMapping[] = [
  {
    memberId: "00123456",
    loginIdentifiers: ["00123456", "1234567890"]
  }
];

@Injectable()
export class MockMemberLookupService {
  resolve(identifier: string) {
    return (
      DEMO_MEMBER_MAPPINGS.find(
        (mapping) =>
          mapping.memberId === identifier ||
          mapping.loginIdentifiers.includes(identifier)
      ) ?? null
    );
  }

  isReservedMemberId(memberId: string) {
    return DEMO_MEMBER_MAPPINGS.some(
      (mapping) => mapping.memberId === memberId
    );
  }
}
