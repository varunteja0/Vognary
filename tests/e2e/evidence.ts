import { mkdirSync } from "node:fs";
import path from "node:path";

export function evidencePath(filename: string) {
  const root = process.env.VOGNARY_E2E_EVIDENCE_DIR?.trim() || "docs/evidence/surface-10";
  mkdirSync(root, { recursive: true });
  return path.join(root, filename);
}
