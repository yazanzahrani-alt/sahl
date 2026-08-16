type Environment = Record<string, string | undefined>;

export function validateEnvironment(environment: Environment) {
  const required = ["WEB_ORIGIN"] as const;

  for (const key of required) {
    if (!environment[key]) {
      throw new Error(`Missing required environment variable: ${key}`);
    }
  }

  parseAllowedOrigins(environment.WEB_ORIGIN!);
  for (const key of [
    "SYNTHETIC_DEMO_SUBMISSION_WINDOW_DAYS",
    "SYNTHETIC_DEMO_INPATIENT_WINDOW_DAYS",
    "SYNTHETIC_DEMO_DENTAL_WINDOW_DAYS",
    "SYNTHETIC_DEMO_OPTICAL_WINDOW_DAYS",
    "SYNTHETIC_DEMO_OUTPATIENT_WINDOW_DAYS"
  ]) {
    const value = environment[key];
    if (value === undefined || value.trim() === "") continue;
    const days = Number(value);
    if (!Number.isInteger(days) || days < 0 || days > 3650) {
      throw new Error(`${key} must be a whole number from 0 to 3650`);
    }
  }

  return environment;
}

export function parseAllowedOrigins(value: string) {
  const origins = value
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);

  if (origins.length === 0) {
    throw new Error("WEB_ORIGIN must contain at least one allowed web origin");
  }

  for (const origin of origins) {
    if (origin === "*") {
      throw new Error("WEB_ORIGIN cannot use a wildcard when credentials are enabled");
    }

    let parsed: URL;
    try {
      parsed = new URL(origin);
    } catch {
      throw new Error(`WEB_ORIGIN contains an invalid origin: ${origin}`);
    }

    if (
      !["http:", "https:"].includes(parsed.protocol) ||
      parsed.origin !== origin ||
      parsed.username ||
      parsed.password
    ) {
      throw new Error(`WEB_ORIGIN must contain exact HTTP(S) origins only: ${origin}`);
    }
  }

  return [...new Set(origins)];
}
