import assert from "node:assert/strict";
import test from "node:test";
import {
  applyHydrationArrayDelta,
  applyHydrationRecordDelta,
  applyHydrationTextDelta,
} from "../src/lib/workspace-hydration";

test("hydration keeps untouched server fields and replays early record edits", () => {
  const baseline = { netflix: "watch" };
  const current = { netflix: "keep", spotify: "watch" };
  assert.deepEqual(
    applyHydrationRecordDelta({ netflix: "watch", notion: "cancel" }, baseline, current),
    { netflix: "keep", notion: "cancel", spotify: "watch" },
  );
});

test("hydration applies early array additions and removals without dropping server values", () => {
  const netflix = { id: "netflix", label: "Netflix" };
  const baseline = [netflix, { id: "old", label: "Old watch" }];
  const current = [netflix, { id: "spotify", label: "Spotify" }];
  assert.deepEqual(
    applyHydrationArrayDelta(
      [{ id: "netflix", label: "Netflix from server" }, { id: "notion", label: "Notion" }, { id: "old", label: "Old watch" }],
      baseline,
      current,
      (value) => value.id,
    ),
    [{ id: "netflix", label: "Netflix from server" }, { id: "notion", label: "Notion" }, { id: "spotify", label: "Spotify" }],
  );
});

test("an early first paste is appended to receipt evidence already on the server", () => {
  assert.equal(
    applyHydrationTextDelta("Netflix receipt", "", "Spotify receipt"),
    "Netflix receipt\n\nSpotify receipt",
  );
  assert.equal(applyHydrationTextDelta("Server copy", "Draft", ""), "");
});
