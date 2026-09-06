import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

/**
 * The brand page drifted once: it documented a Fraunces / graphite / gold
 * identity for weeks after the product had stopped rendering any of it. Copy
 * cannot be trusted to stay true on its own, so the claims that page makes
 * about type and colour are asserted against the files that actually decide
 * them. A swatch that no longer matches its token is a failing test, not a
 * discovery someone makes in a review.
 */

const brandPage = readFileSync("src/app/brand/page.tsx", "utf8");
const globals = readFileSync("src/app/globals.css", "utf8");
const layout = readFileSync("src/app/layout.tsx", "utf8");
const mark = readFileSync("src/app/brand.tsx", "utf8");

test("every colour the brand page documents is the value its token holds", () => {
  const documented = [...brandPage.matchAll(/\[\s*"[^"]+",\s*"(#[0-9a-f]{6})",\s*"(--[a-z0-9-]+)"/gi)]
    .map(([, hex, token]) => ({ hex, token }));

  assert.ok(documented.length >= 8, `expected the palette tables to be parsed, got ${documented.length}`);

  for (const { hex, token } of documented) {
    const declaration = globals.match(new RegExp(`^\\s*${token}:\\s*([^;]+);`, "m"));
    assert.ok(declaration, `${token} is documented on /brand but not declared in globals.css`);
    assert.equal(
      declaration[1].trim().toLowerCase(),
      hex.toLowerCase(),
      `/brand shows ${token} as ${hex}, globals.css declares ${declaration[1].trim()}`,
    );
  }
});

test("the brand page names the typefaces the app actually loads", () => {
  for (const family of ["Bricolage_Grotesque", "Manrope", "IBM_Plex_Mono"]) {
    assert.match(layout, new RegExp(family), `layout.tsx should load ${family}`);
  }
  assert.match(brandPage, /Bricolage Grotesque/, "/brand must name the display face");
  assert.match(brandPage, /Manrope/, "/brand must name the interface face");
  assert.match(brandPage, /IBM Plex Mono/, "/brand must name IBM Plex Mono");
});

test("the brand page never advertises a typeface the app does not load", () => {
  // Naming a dead face is the exact defect this file exists to catch. The
  // retrospective comment is allowed to say the word; the rendered page is not.
  const rendered = brandPage.replace(/\/\*[\s\S]*?\*\//g, "");
  for (const dead of ["Fraunces", "Playfair", "Inter", "Newsreader", "IBM Plex Sans"]) {
    assert.doesNotMatch(rendered, new RegExp(dead), `/brand still advertises ${dead}`);
    assert.doesNotMatch(layout, new RegExp(dead), `layout.tsx still loads ${dead}`);
  }
});

test("the champagne gold the brand page claims is the gold the mark draws", () => {
  const goldInMark = mark.match(/const GOLD = "(#[0-9a-f]{6})"/i);
  assert.ok(goldInMark, "brand.tsx should declare the mark's gold");
  assert.equal(goldInMark[1].toLowerCase(), "#d8b87a");
  assert.match(brandPage, /champagne gold/i, "/brand must still describe the mark's gold V");
  // --gold is a legacy alias pointing at forest; the page has to say so rather
  // than let a reader assume the interface is still gold.
  assert.match(globals, /--gold:\s*var\(--frozen\)/, "--gold should alias forest");
  assert.match(brandPage, /legacy alias/i, "/brand must disclose that --gold is now an alias");
});

test("the brand page marks itself an unaccepted candidate", () => {
  assert.match(brandPage, /Unaccepted candidate/i);
  assert.match(brandPage, /has not accepted it/i);
  assert.match(brandPage, /robots:\s*\{\s*index:\s*false/, "/brand must stay out of the index");
});
