import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Res
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import {
  ApiCookieAuth,
  ApiOkResponse,
  ApiOperation,
  ApiTags
} from "@nestjs/swagger";
import { Response } from "express";
import { AuthService } from "./auth.service";
import { CurrentMemberId } from "./decorators/current-member-id.decorator";
import { Public } from "./decorators/public.decorator";
import { LoginDto } from "./dto/login.dto";
import {
  getSessionCookieOptions,
  SESSION_CONFIG
} from "./session.config";

@ApiTags("Authentication")
@Controller("auth")
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly config: ConfigService
  ) {}

  @Public()
  @Post("login")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Log in or create a first-time prototype profile" })
  @ApiOkResponse({ description: "Authenticated successfully" })
  async login(
    @Body() input: LoginDto,
    @Res({ passthrough: true }) response: Response
  ) {
    const result = await this.auth.login(input);
    response.cookie(
      SESSION_CONFIG.cookieName,
      result.token,
      getSessionCookieOptions(this.isProduction)
    );

    return {
      member: result.member,
      created: result.created
    };
  }

  @Post("logout")
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiCookieAuth(SESSION_CONFIG.cookieName)
  @ApiOperation({ summary: "Log out of the current browser" })
  logout(@Res({ passthrough: true }) response: Response) {
    response.clearCookie(
      SESSION_CONFIG.cookieName,
      getSessionCookieOptions(this.isProduction, false)
    );
  }

  @Get("me")
  @ApiCookieAuth(SESSION_CONFIG.cookieName)
  @ApiOperation({ summary: "Get the authenticated member" })
  me(@CurrentMemberId() memberId: string) {
    return this.auth.getCurrentMember(memberId);
  }

  private get isProduction() {
    return this.config.get<string>("NODE_ENV") === "production";
  }
}
