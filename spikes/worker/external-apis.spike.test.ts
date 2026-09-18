import { describe, expect, it } from "vitest";

import {
  expectJsonResponse,
  getRemoteUrl,
  remoteWorkerUrl,
} from "./remote-fixture";

type ExternalApiResult = {
  rpc: {
    chainId: number;
    blockNumber: string;
    balance: string;
    tokenAddress: string;
  };
  sera: Record<string, { ok: boolean; status: number }>;
  accountMapping: { verified: boolean; reason: string };
};

describe.skipIf(!remoteWorkerUrl)("remote Sera and Sepolia APIs", () => {
  it("should reach every required read/build capability from Worker fetch", async () => {
    const response = await fetch(getRemoteUrl("/__spike/external-apis"));
    const result = await expectJsonResponse<ExternalApiResult>(response);

    expect(result.rpc.chainId).toBe(11_155_111);
    expect(result.rpc.blockNumber).toMatch(/^0x[0-9a-f]+$/iu);
    expect(result.rpc.balance).toMatch(/^0x[0-9a-f]+$/iu);
    expect(result.rpc.tokenAddress).toMatch(/^0x[0-9a-f]{40}$/iu);
    expect(Object.keys(result.sera).sort()).toEqual(
      [
        "account-balances",
        "config",
        "fills",
        "markets",
        "orders",
        "quote",
        "tokens",
        "transfer-build",
      ].sort(),
    );
    expect(Object.values(result.sera).every(({ ok }) => ok)).toBe(true);
    expect(result.accountMapping.reason.length).toBeGreaterThan(0);
  });
});
