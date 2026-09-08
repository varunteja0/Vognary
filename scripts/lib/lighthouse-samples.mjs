export function readLighthouseSample(report, categoryNames) {
  if (report?.runtimeError) {
    throw new Error(`Lighthouse ${report.runtimeError.code}: ${report.runtimeError.message}`);
  }

  const audit = report?.audits?.["largest-contentful-paint"];
  const lcp = audit?.numericValue;
  if (!Number.isFinite(lcp) || lcp <= 0 || audit.errorMessage) {
    throw new Error(`Invalid LCP (${String(lcp)}): ${audit?.errorMessage ?? "a finite positive measurement is required"}`);
  }

  const categories = {};
  for (const category of categoryNames) {
    const score = report?.categories?.[category]?.score;
    if (!Number.isFinite(score) || score < 0 || score > 1) {
      throw new Error(`Invalid ${category} score (${String(score)}): a finite score from 0 to 1 is required`);
    }
    categories[category] = score;
  }
  return { lcp, categories };
}

export async function runIsolatedLighthouseSample(launchBrowser, runAudit, categoryNames, retainResult) {
  const browser = await launchBrowser();
  try {
    const result = await runAudit(browser.port);
    if (retainResult) await retainResult(result);
    return readLighthouseSample(result?.lhr, categoryNames);
  } finally {
    await browser.kill();
  }
}
