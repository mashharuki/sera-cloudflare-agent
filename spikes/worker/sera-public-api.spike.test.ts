import { SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";

type SeraPublicApiResult = {
  network: string;
  baseUrl: string;
  config: { status: number; chainId: number; seraAddress: string };
  tokens: { status: number; count: number };
  markets: { status: number; count: number };
  quote: { status: number; outcome: "quoted" | "business_rejection" };
};

describe("Sera public API Worker compatibility", () => {
  it("should validate Sepolia config, tokens, and markets without credentials", async () => {
    const response = await SELF.fetch(
      "https://spike.local/__spike/sera-public",
    );
    const body = await response.text();

    expect(response.status, body).toBe(200);
    const result = JSON.parse(body) as SeraPublicApiResult;
    expect(result.network).toBe("sepolia");
    expect(result.baseUrl).toBe("https://api-testnet.sera.cx/api/v1");
    expect(result.config).toMatchObject({ status: 200, chainId: 11_155_111 });
    expect(result.config.seraAddress).toMatch(/^0x[0-9a-f]{40}$/iu);
    expect(result.tokens).toMatchObject({ status: 200 });
    expect(result.tokens.count).toBeGreaterThan(0);
    expect(result.markets).toMatchObject({ status: 200 });
    expect(result.markets.count).toBeGreaterThan(0);
    expect(["quoted", "business_rejection"]).toContain(result.quote.outcome);
    expect([200, 400]).toContain(result.quote.status);
  });
});
