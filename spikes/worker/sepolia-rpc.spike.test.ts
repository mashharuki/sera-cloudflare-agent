import { SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";

type SepoliaRpcResult = {
  chainId: number;
  blockNumber: string;
  balance: string;
  tokenAddress: string;
};

describe("Sepolia RPC Worker compatibility", () => {
  it("should read an ERC-20 balance with eth_call", async () => {
    const response = await SELF.fetch(
      "https://spike.local/__spike/sepolia-rpc",
    );
    const body = await response.text();

    expect(response.status, body).toBe(200);
    const result = JSON.parse(body) as SepoliaRpcResult;
    expect(result.chainId).toBe(11_155_111);
    expect(result.blockNumber).toMatch(/^0x[0-9a-f]+$/iu);
    expect(result.balance).toMatch(/^0x[0-9a-f]+$/iu);
    expect(result.tokenAddress).toMatch(/^0x[0-9a-f]{40}$/iu);
  });
});
