import { Request } from "express";
import { SESSION_CONFIG } from "./session.config";

export interface JwtPayload {
  sub: string;
  iss: typeof SESSION_CONFIG.issuer;
  aud: typeof SESSION_CONFIG.audience;
}

export interface AuthenticatedRequest extends Request {
  user: JwtPayload;
}
