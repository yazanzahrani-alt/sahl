import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { JwtService } from "@nestjs/jwt";
import { Request } from "express";
import { JwtPayload } from "../auth.types";
import { IS_PUBLIC_KEY } from "../decorators/public.decorator";
import { SESSION_CONFIG } from "../session.config";

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly jwtService: JwtService
  ) {}

  async canActivate(context: ExecutionContext) {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass()
    ]);

    if (isPublic) {
      return true;
    }

    const request = context.switchToHttp().getRequest<Request>();
    const token = request.cookies?.[SESSION_CONFIG.cookieName] as
      | string
      | undefined;

    if (!token) {
      throw new UnauthorizedException("Authentication required");
    }

    try {
      const payload = await this.jwtService.verifyAsync<JwtPayload>(token, {
        issuer: SESSION_CONFIG.issuer,
        audience: SESSION_CONFIG.audience
      });
      Object.assign(request, { user: payload });
      return true;
    } catch {
      throw new UnauthorizedException("Session is invalid or expired");
    }
  }
}
