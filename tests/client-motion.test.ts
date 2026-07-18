import assert from "node:assert/strict";
import test from "node:test";
import { prefersReducedMotion, scrollIntoViewWithMotion } from "../src/lib/client-motion";

test("motion preference follows the reduced-motion media query", () => {
  assert.equal(prefersReducedMotion({ matchMedia: () => ({ matches: true }) }), true);
  assert.equal(prefersReducedMotion({ matchMedia: () => ({ matches: false }) }), false);
});

test("programmatic scroll is instant for reduced motion and smooth otherwise", () => {
  const calls: ScrollIntoViewOptions[] = [];
  const element = { scrollIntoView: (options: ScrollIntoViewOptions) => calls.push(options) } as unknown as Element;
  scrollIntoViewWithMotion(element, { block: "start" }, { matchMedia: () => ({ matches: true }) });
  scrollIntoViewWithMotion(element, { block: "nearest" }, { matchMedia: () => ({ matches: false }) });
  assert.deepEqual(calls, [
    { block: "start", behavior: "auto" },
    { block: "nearest", behavior: "smooth" },
  ]);
});