import assert from "node:assert/strict";
import test from "node:test";

import { allowsAiPdfAssist } from "../src/app/api/ingest/route";

test("Recovery v1 never promotes AI-assisted PDF rows into deterministic evidence", () => {
  assert.equal(allowsAiPdfAssist("recovery-v1"), false);
  assert.equal(allowsAiPdfAssist(null), true, "legacy non-Recovery ingestion may retain its separately-labelled AI assist");
});