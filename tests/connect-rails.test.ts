import assert from "node:assert/strict";
import test from "node:test";
import {
  compileMerchantMatcher,
  describeTileCoverage,
  getConnectTiles,
  getConnectTileById,
  matchTileItems,
  merchantTiles,
  railTiles,
} from "../src/lib/connect-rails";
import { getConnectorById } from "../src/lib/connectors";

test("tile ids are unique and every backing connector exists in the registry", () => {
  const tiles = getConnectTiles();
  const ids = tiles.map((tile) => tile.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const tile of tiles) {
    assert.ok(tile.backingConnectorIds.length, `${tile.id} must name its backing connectors`);
    for (const connectorId of tile.backingConnectorIds) {
      assert.ok(getConnectorById(connectorId), `${tile.id} references unknown connector ${connectorId}`);
    }
  }
});

test("only the two consent rails authorize access; merchant tiles are watch-only", () => {
  assert.equal(railTiles.length, 2);
  assert.deepEqual(railTiles.map((tile) => tile.rail).sort(), ["bank-consent", "email-oauth"]);
  for (const tile of merchantTiles) {
    assert.equal(tile.rail, "merchant-watch", `${tile.id} must not introduce a third redirect surface`);
    assert.ok(tile.merchantPatterns.length, `${tile.id} needs at least one merchant pattern`);
    assert.ok(tile.feeds.length, `${tile.id} must declare which rails feed it`);
    for (const feed of tile.feeds) assert.ok(["gmail", "bank"].includes(feed));
  }
});

test("merchant patterns recognize real bank narrations and receipt descriptors", () => {
  const expectations: Record<string, string[]> = {
    netflix: ["NETFLIX.COM AMSTERDAM", "Netflix India Renewal"],
    spotify: ["SPOTIFY SI 8888", "Spotify Premium receipt"],
    "prime-video": ["AMAZON PRIME MEMBERSHIP", "Prime Video renewal"],
    hotstar: ["JIOHOTSTAR RENEWAL", "Disney+ Hotstar"],
    "youtube-premium": ["GOOGLE YOUTUBE PREMIUM"],
    "chatgpt-plus": ["OPENAI *CHATGPT SUBSCR"],
    claude: ["ANTHROPIC, PBC", "CLAUDE.AI SUBSCRIPTION"],
    "apple-subscriptions": ["APPLE.COM/BILL", "ITUNES.COM"],
    "google-play": ["GOOGLE *PLAY STORE"],
    github: ["GITHUB, INC."],
    vercel: ["VERCEL INC."],
    aws: ["AMAZON WEB SERVICES"],
  };
  for (const [tileId, descriptors] of Object.entries(expectations)) {
    const tile = getConnectTileById(tileId);
    assert.ok(tile, `${tileId} tile must exist`);
    const matcher = compileMerchantMatcher(tile);
    assert.ok(matcher, `${tileId} must compile a matcher`);
    for (const descriptor of descriptors) {
      assert.ok(matcher.test(descriptor), `${tileId} should match "${descriptor}"`);
    }
  }

  const spotify = getConnectTileById("spotify");
  assert.ok(spotify);
  assert.equal(compileMerchantMatcher(spotify)?.test("SHOPIFY COMMERCE"), false, "spotify must not match Shopify");
});

test("matchTileItems filters recurring items by normalized merchant", () => {
  const netflix = getConnectTileById("netflix");
  assert.ok(netflix);
  const items = [
    { normalizedMerchant: "netflix", monthlyCost: 649 },
    { normalizedMerchant: "spotify", monthlyCost: 119 },
    { normalizedMerchant: "netflix.com", monthlyCost: 199 },
  ];
  const matched = matchTileItems(netflix, items);
  assert.deepEqual(matched.map((item) => item.monthlyCost), [649, 199]);
});

test("tile coverage copy stays honest for every rail combination", () => {
  const netflix = getConnectTileById("netflix");
  assert.ok(netflix);
  assert.equal(describeTileCoverage(netflix, { gmailConnected: false, bankConnected: false }).state, "waiting-for-rail");
  assert.equal(describeTileCoverage(netflix, { gmailConnected: true, bankConnected: false }).state, "partially-fed");
  assert.equal(describeTileCoverage(netflix, { gmailConnected: true, bankConnected: true }).state, "fed");
});

test("tile copy avoids prohibited public claims", () => {
  const prohibited = [
    /never paste an api key/i,
    /no api\. no pasting/i,
    /connect once, see everything/i,
    /every subscription, emi, loan, mandate/i,
    /guaranteed savings/i,
    /100% secure/i,
    /fully automated across all/i,
    /merchant.*linked/i,
  ];
  const corpus = JSON.stringify(getConnectTiles());
  for (const pattern of prohibited) {
    assert.equal(pattern.test(corpus), false, `tile copy must not claim ${pattern}`);
  }
});
