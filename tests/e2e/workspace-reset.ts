import { expect, type Page } from "@playwright/test";

const baseUrl = (process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:3000").replace(/\/$/, "");

/**
 * Normalize the one email-bound development identity without direct database
 * access. This uses the same authenticated delete route available to a user,
 * then revokes the temporary session before the actual journey begins.
 */
export async function resetDevelopmentWorkspace(page: Page, email: string, accessCode: string, identity: string) {
  const headers = {
    origin: new URL(baseUrl).origin,
    "x-forwarded-for": `vognary-e2e-reset-${identity}-${Date.now()}`,
  };
  const login = await page.request.post(`${baseUrl}/api/auth/login`, {
    headers,
    data: { email, accessCode },
  });
  expect(login.status(), await login.text()).toBe(200);

  const deleted = await page.request.delete(`${baseUrl}/api/workspaces/current/audit-snapshot`, { headers });
  expect(deleted.status(), await deleted.text()).toBe(200);

  const logout = await page.request.post(`${baseUrl}/api/auth/logout`, { headers });
  expect(logout.status(), await logout.text()).toBe(200);
  await page.context().clearCookies();
}
