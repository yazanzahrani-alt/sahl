import type { CookieOptions } from "express";

export const SESSION_CONFIG = {
  cookieName: "sahl_session",
  durationSeconds: 8 * 60 * 60,
  issuer: "sahl",
  audience: "sahl-web"
} as const;

export function getSessionCookieOptions(
  isProduction: boolean,
  includeLifetime = true
): CookieOptions {
  const crossSite = process.env.SESSION_COOKIE_SAME_SITE === "none";
  const options: CookieOptions = {
    httpOnly: true,
    secure: crossSite || isProduction,
    sameSite: crossSite ? "none" : "lax",
    path: "/"
  };

  if (includeLifetime) {
    options.maxAge = SESSION_CONFIG.durationSeconds * 1000;
  }

  return options;
}
