import assert from "node:assert/strict";
import test from "node:test";

import { PROPOSE_READ_TIMEOUT_MS, wasmOcrIsAllowed } from "../src/lib/server/receipt-image-ocr";

test("Vercel never runs WASM Tesseract on the request isolate", () => {
  assert.equal(wasmOcrIsAllowed({ vercel: "1", bytes: 80_000 }), false);
  assert.equal(wasmOcrIsAllowed({ lifecycle: "test", bytes: 80_000 }), false);
  assert.equal(wasmOcrIsAllowed({ bytes: 100 }), false);
  assert.equal(wasmOcrIsAllowed({ bytes: 80_000 }), true);
  assert.equal(PROPOSE_READ_TIMEOUT_MS, 8_000);
});
