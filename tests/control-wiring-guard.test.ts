import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import test from "node:test";

/**
 * "No button is a demo" — a static invariant, always-on in `npm run test` (and
 * therefore `npm run ci`). It fails the build the moment anyone (re)introduces a
 * cosmetic control or placeholder copy into shipped product source.
 *
 * This is the cheap, permanent half of the wiring guarantee. The behavioural
 * half — proving each live control actually completes a real round-trip — lives
 * in tests/e2e/control-wiring-inventory.spec.ts.
 *
 * Scope: src/**\/*.{ts,tsx}, excluding tests/specs (fixtures legitimately contain
 * empty handlers and markers).
 */

const SRC_ROOT = path.resolve(import.meta.dirname, "../src");

type AntiPattern = {
  id: string;
  why: string;
  // Matches a genuine "demo" control or unfinished marker. Kept deliberately
  // narrow so legitimate code (e.g. href="#ledger", onClick={() => setOpen(x)})
  // never trips it.
  pattern: RegExp;
};

const ANTI_PATTERNS: AntiPattern[] = [
  {
    id: "empty-handler",
    why: "An event handler with an empty body is a button that does nothing.",
    pattern: /\bon[A-Z][A-Za-z]*\s*=\s*\{\s*(?:async\s+)?\([^)]*\)\s*=>\s*\{\s*\}\s*\}/,
  },
  {
    id: "handler-returns-nothing",
    why: "A handler that only returns null/undefined/void is a silent no-op control.",
    pattern: /\bon[A-Z][A-Za-z]*\s*=\s*\{\s*(?:async\s+)?\([^)]*\)\s*=>\s*(?:null|undefined|void 0)\s*\}/,
  },
  {
    id: "named-noop-handler",
    why: "A handler bound to a noop is a placeholder control.",
    pattern: /\bon[A-Z][A-Za-z]*\s*=\s*\{\s*noop\s*\}/,
  },
  {
    id: "dead-link",
    why: 'href="#" is a dead anchor — a link that goes nowhere.',
    pattern: /href=\{?\s*["']#["']\s*\}?/,
  },
  {
    id: "browser-alert",
    why: "alert() is a debug stand-in, not a wired UI affordance.",
    pattern: /(?<![\w.$])alert\s*\(|window\.alert\s*\(/,
  },
  {
    id: "placeholder-copy",
    why: "Placeholder copy signals an unfinished surface.",
    pattern: /coming soon|lorem ipsum/i,
  },
  {
    id: "unfinished-marker",
    why: "A TODO/FIXME in shipped product source is unfinished work.",
    pattern: /\b(?:TODO|FIXME)\b/,
  },
];

function collectSourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...collectSourceFiles(full));
      continue;
    }
    if (!/\.(ts|tsx)$/.test(entry)) continue;
    if (/\.(test|spec)\.(ts|tsx)$/.test(entry)) continue;
    out.push(full);
  }
  return out;
}

function lineOf(source: string, index: number): number {
  return source.slice(0, index).split("\n").length;
}

test("no product source contains a demo control or unfinished marker", () => {
  const files = collectSourceFiles(SRC_ROOT);
  assert.ok(files.length > 20, `expected to scan the src tree, only found ${files.length} files`);

  const findings: string[] = [];
  for (const file of files) {
    const source = readFileSync(file, "utf8");
    const relative = path.relative(path.resolve(SRC_ROOT, ".."), file);
    for (const { id, why, pattern } of ANTI_PATTERNS) {
      const scan = new RegExp(pattern.source, pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`);
      let match: RegExpExecArray | null;
      while ((match = scan.exec(source)) !== null) {
        findings.push(`${relative}:${lineOf(source, match.index)} [${id}] ${why}\n    ↳ ${match[0].replace(/\s+/g, " ").trim()}`);
      }
    }
  }

  assert.deepEqual(
    findings,
    [],
    `Found ${findings.length} demo/unfinished control(s) in product source:\n${findings.join("\n")}`,
  );
});
