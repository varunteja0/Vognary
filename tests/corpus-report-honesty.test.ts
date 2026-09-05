import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

const root = process.cwd();

for (const kind of ["statement", "receipt"] as const) {
  test(`${kind} corpus never publishes measured accuracy without real evaluation cases`, async () => {
    await mkdir(path.join(root, ".fallow"), { recursive: true });
    const temporary = await mkdtemp(path.join(root, ".fallow", "corpus-report-test-"));
    const corpusRoot = path.join(temporary, "fixtures");
    const environment = {
      ...process.env,
      TSX_TSCONFIG_PATH: path.join(root, "tsconfig.json"),
      [`${kind.toUpperCase()}_CORPUS_DIR`]: corpusRoot,
    };
    delete environment.DATABASE_URL;
    try {
      for (const fixtureMode of ["missing", "empty", "synthetic"] as const) {
        if (fixtureMode !== "missing") {
          await mkdir(corpusRoot, { recursive: true });
          await writeFile(path.join(corpusRoot, "synthetic.txt"), "Vendor: Synthetic Vendor; invoice paid INR 100.00 on 5 September 2026. Monthly subscription.");
          const fixtures = fixtureMode === "empty" ? [] : [{
            file: "synthetic.txt",
            institution: "Synthetic fixture institution",
            channel: "invoice",
            provenance: "synthetic",
            expected: { recurring: [], candidates: [] },
          }];
          await writeFile(path.join(corpusRoot, "manifest.yaml"), JSON.stringify({ version: 1, fixtures }));
        }
        for (const strict of [false, true]) {
          const result = spawnSync(process.execPath, [
            "--conditions=react-server", "--import=tsx",
            path.join(root, "scripts", `check-${kind}-corpus.ts`),
            ...(strict ? ["--strict"] : []),
          ], { cwd: temporary, env: environment, encoding: "utf8", timeout: 30_000 });
          assert.equal(result.status, strict ? 1 : 0, `${fixtureMode}: ${result.stderr}`);
          const report = JSON.parse(result.stdout);
          assert.equal(report.realFixtureCount, 0);
          assert.equal(report.thresholds.active, false);
          assert.equal(report.score.precision, null, `${fixtureMode}: precision is unmeasured`);
          assert.equal(report.score.recall, null, `${fixtureMode}: recall is unmeasured`);
          assert.notEqual(report.status, "ready");
          if (kind === "receipt") assert.equal(report.performance.p95FirstResultMs, null);
        }
      }
    } finally {
      await rm(temporary, { recursive: true, force: true });
    }
  });
}
