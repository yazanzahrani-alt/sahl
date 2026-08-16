export const PASSWORD_POLICY = {
  minimumLength: 8,
  maximumLength: 72
} as const;

export type PasswordPolicyErrorCode =
  | "PASSWORD_TOO_SHORT"
  | "PASSWORD_TOO_LONG"
  | "PASSWORD_MISSING_UPPERCASE"
  | "PASSWORD_MISSING_LOWERCASE"
  | "PASSWORD_MISSING_NUMBER"
  | "PASSWORD_MISSING_SPECIAL_CHARACTER";

export interface PasswordPolicyError {
  code: PasswordPolicyErrorCode;
  message: string;
}

export function normalizePassword(password: string) {
  return password.normalize("NFC");
}

export function getPasswordPolicyError(
  password: string
): PasswordPolicyError | null {
  const normalizedPassword = normalizePassword(password);

  if (normalizedPassword.length < PASSWORD_POLICY.minimumLength) {
    return {
      code: "PASSWORD_TOO_SHORT",
      message: `Password must contain at least ${PASSWORD_POLICY.minimumLength} characters.`
    };
  }

  if (
    normalizedPassword.length > PASSWORD_POLICY.maximumLength ||
    Buffer.byteLength(normalizedPassword, "utf8") >
      PASSWORD_POLICY.maximumLength
  ) {
    return {
      code: "PASSWORD_TOO_LONG",
      message: `Password must be no more than ${PASSWORD_POLICY.maximumLength} characters.`
    };
  }

  if (!/[A-Z]/.test(normalizedPassword)) {
    return {
      code: "PASSWORD_MISSING_UPPERCASE",
      message: "Password must contain at least one uppercase letter."
    };
  }

  if (!/[a-z]/.test(normalizedPassword)) {
    return {
      code: "PASSWORD_MISSING_LOWERCASE",
      message: "Password must contain at least one lowercase letter."
    };
  }

  if (!/\d/.test(normalizedPassword)) {
    return {
      code: "PASSWORD_MISSING_NUMBER",
      message: "Password must contain at least one number."
    };
  }

  if (!/[^\p{L}\p{N}\s]/u.test(normalizedPassword)) {
    return {
      code: "PASSWORD_MISSING_SPECIAL_CHARACTER",
      message: "Password must contain at least one special character."
    };
  }

  return null;
}
