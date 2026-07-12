export type PlatformLedgerCursor = {
  recurringAfter: string | null;
  decisionsAfter: string | null;
};

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function normalizePlatformPageLimit(value: string | null) {
  if (value == null || value === "") return 100;
  if (!/^\d+$/.test(value)) throw new Error("limit must be an integer from 1 to 200.");
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > 200) {
    throw new Error("limit must be an integer from 1 to 200.");
  }
  return parsed;
}

export function encodePlatformLedgerCursor(cursor: PlatformLedgerCursor) {
  return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
}

export function decodePlatformLedgerCursor(value: string | null): PlatformLedgerCursor {
  if (!value) return { recurringAfter: null, decisionsAfter: null };
  try {
    const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as Record<string, unknown>;
    const recurringAfter = readUuidOrNull(parsed.recurringAfter);
    const decisionsAfter = readUuidOrNull(parsed.decisionsAfter);
    return { recurringAfter, decisionsAfter };
  } catch {
    throw new Error("cursor is invalid or malformed.");
  }
}

function readUuidOrNull(value: unknown) {
  if (value == null) return null;
  if (typeof value !== "string" || !uuidPattern.test(value)) throw new Error("cursor id is invalid.");
  return value.toLowerCase();
}