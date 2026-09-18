import { test as base, expect } from "@playwright/test";

const forbiddenSecretPatterns = [
  /authorization:\s*bearer\s+\S+/i,
  /privy[_-]?(?:app[_-])?secret/i,
  /private[_-]?key/i,
];

export const test = base;

test.afterEach(async ({ page }) => {
  const body = await page
    .locator("body")
    .innerText()
    .catch(() => "");
  for (const pattern of forbiddenSecretPatterns) {
    expect(body).not.toMatch(pattern);
  }
});

export { expect };
