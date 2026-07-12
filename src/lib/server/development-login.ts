import { timingSafeEqual } from "node:crypto";

export type DevelopmentLoginEnvironment = {
  NODE_ENV?: string;
  ENABLE_DEVELOPMENT_LOGIN?: string;
  DEVELOPMENT_LOGIN_EMAIL?: string;
  DEVELOPMENT_LOGIN_ACCESS_CODE?: string;
};

export type DevelopmentLoginConfiguration = {
  status: "disabled" | "not-configured" | "ready";
  missing: string[];
};

/**
 * The code login is intentionally unavailable in production. In local/test
 * environments it is opt-in and bound to one configured email, so a shared code
 * can never be combined with an arbitrary existing user's address.
 */
export function checkDevelopmentLoginConfiguration(
  environment: DevelopmentLoginEnvironment = process.env,
): DevelopmentLoginConfiguration {
  if (environment.NODE_ENV === "production" || environment.ENABLE_DEVELOPMENT_LOGIN !== "true") {
    return { status: "disabled", missing: [] };
  }

  const missing = [
    environment.DEVELOPMENT_LOGIN_EMAIL?.trim() ? null : "DEVELOPMENT_LOGIN_EMAIL",
    environment.DEVELOPMENT_LOGIN_ACCESS_CODE?.trim() ? null : "DEVELOPMENT_LOGIN_ACCESS_CODE",
  ].filter((value): value is string => Boolean(value));

  return { status: missing.length ? "not-configured" : "ready", missing };
}

export function validateDevelopmentLogin(
  input: { email: string; accessCode: string },
  environment: DevelopmentLoginEnvironment = process.env,
) {
  if (checkDevelopmentLoginConfiguration(environment).status !== "ready") return false;

  const suppliedEmail = input.email.trim().toLowerCase();
  const expectedEmail = environment.DEVELOPMENT_LOGIN_EMAIL?.trim().toLowerCase() ?? "";
  const suppliedCode = input.accessCode.trim();
  const expectedCode = environment.DEVELOPMENT_LOGIN_ACCESS_CODE?.trim() ?? "";

  return safeEqual(suppliedEmail, expectedEmail) && safeEqual(suppliedCode, expectedCode);
}

function safeEqual(supplied: string, expected: string) {
  const suppliedBuffer = Buffer.from(supplied);
  const expectedBuffer = Buffer.from(expected);
  return suppliedBuffer.length === expectedBuffer.length && timingSafeEqual(suppliedBuffer, expectedBuffer);
}
