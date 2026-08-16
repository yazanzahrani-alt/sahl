import {
  BadRequestException,
  Injectable,
  UnauthorizedException
} from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { compare, hash } from "bcryptjs";
import {
  getIdentifierType,
  toPublicMember
} from "../members/member";
import { MembersService } from "../members/members.service";
import { LoginDto } from "./dto/login.dto";
import {
  getPasswordPolicyError,
  normalizePassword
} from "./password-policy";

@Injectable()
export class AuthService {
  constructor(
    private readonly members: MembersService,
    private readonly jwt: JwtService
  ) {}

  async login(input: LoginDto) {
    const passwordError = getPasswordPolicyError(input.password);
    if (passwordError) {
      throw new BadRequestException({
        code: passwordError.code,
        message: passwordError.message
      });
    }

    const existing = await this.members.findByIdentifier(
      input.identifier
    );

    if (existing) {
      const passwordMatches = await this.passwordMatches(
        input.password,
        existing.passwordHash
      );
      if (!passwordMatches) {
        throw new UnauthorizedException("Invalid identifier or password");
      }

      return {
        token: await this.createToken(existing.memberId),
        member: toPublicMember(existing),
        created: false
      };
    }

    const passwordHash = await hash(
      normalizePassword(input.password),
      12
    );
    const result = await this.members.createIfMissing(
      input.identifier,
      getIdentifierType(input.identifier),
      passwordHash
    );

    if (!result.created) {
      const passwordMatches = await this.passwordMatches(
        input.password,
        result.member.passwordHash
      );
      if (!passwordMatches) {
        throw new UnauthorizedException("Invalid identifier or password");
      }
    }

    return {
      token: await this.createToken(result.member.memberId),
      member: toPublicMember(result.member),
      created: result.created
    };
  }

  async getCurrentMember(memberId: string) {
    const member = await this.members.findByMemberId(memberId);
    if (!member) {
      throw new UnauthorizedException("Member no longer exists");
    }
    return toPublicMember(member);
  }

  private createToken(memberId: string) {
    return this.jwt.signAsync(
      {},
      {
        subject: memberId
      }
    );
  }

  private async passwordMatches(
    suppliedPassword: string,
    passwordHash: string
  ) {
    return compare(
      normalizePassword(suppliedPassword),
      passwordHash
    );
  }
}
