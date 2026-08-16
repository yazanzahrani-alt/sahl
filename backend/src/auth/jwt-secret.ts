import { randomBytes } from "node:crypto";
import {
  mkdirSync,
  readFileSync,
  writeFileSync,
  type WriteFileOptions
} from "node:fs";
import { dirname, resolve } from "node:path";

const SECRET_FILE = ".jwt-secret";
const SECRET_LENGTH = 32;

function readSecret(path: string) {
  const secret = readFileSync(path, "utf8").trim();

  if (secret.length < SECRET_LENGTH) {
    throw new Error(`Generated JWT secret is invalid: ${path}`);
  }

  return secret;
}

export function getOrCreateJwtSecret(databasePath: string) {
  const secretPath = resolve(dirname(resolve(databasePath)), SECRET_FILE);
  mkdirSync(dirname(secretPath), { recursive: true });

  try {
    return readSecret(secretPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      throw error;
    }
  }

  const secret = randomBytes(48).toString("base64url");
  const options: WriteFileOptions = {
    encoding: "utf8",
    flag: "wx",
    mode: 0o600
  };

  try {
    writeFileSync(secretPath, secret, options);
    return secret;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") {
      return readSecret(secretPath);
    }
    throw error;
  }
}
