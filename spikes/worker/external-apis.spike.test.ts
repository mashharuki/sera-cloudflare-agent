import { describe, expect, it } from "vitest";

import {
  expectJsonResponse,
  getRemoteUrl,
  getRequiredEnvironment,
  remoteWorkerUrl,
} from "./remote-fixture";

const isAccountEnabled = Boolean(
  remoteWorkerUrl &&
    process.env.RUN_SERA_ACCOUNT_SPIKE === "true" &&
    process.env.PRIVY_TEST_ACCESS_TOKEN &&
    process.env.PRIVY_TEST_WALLET_ID,
);

type RpcResult = {
  chainId: number;
  blockNumber: string;
  balance: string;
  tokenAddress: string;
};

type SeraPublicResult = {
  config: { chainId: number; status: number };
  markets: { count: number; status: number };
  quote: { outcome: string; status: number };
  tokens: { count: number; status: number };
};

type SeraAccountResult = {
  accountBalances: { count: number; status: number };
  accountMapping: {
    privyAddress: string;
    seraOwnerAddress: string;
    verified: boolean;
  };
  fills: { count: number; status: number };
  orders: { count: number; status: number };
  transferBuild: { chainId: number; status: number; token: string };
};

describe.skipIf(!remoteWorkerUrl)("remote Sera and Sepolia public APIs", () => {
  it("should reach public discovery, quote and RPC reads from Worker fetch", async () => {
    const [rpc, sera] = await Promise.all([
      fetch(getRemoteUrl("/__spike/sepolia-rpc")).then(
        expectJsonResponse<RpcResult>,
      ),
      fetch(getRemoteUrl("/__spike/sera-public")).then(
        expectJsonResponse<SeraPublicResult>,
      ),
    ]);

    expect(rpc.chainId).toBe(11_155_111);
    expect(rpc.blockNumber).toMatch(/^0x[0-9a-f]+$/iu);
    expect(rpc.balance).toMatch(/^0x[0-9a-f]+$/iu);
    expect(rpc.tokenAddress).toMatch(/^0x[0-9a-f]{40}$/iu);
    expect(sera.config.chainId).toBe(11_155_111);
    expect(sera.tokens.count).toBeGreaterThan(0);
    expect(sera.markets.count).toBeGreaterThan(0);
    expect(["business_rejection", "quoted"]).toContain(sera.quote.outcome);
  });
});

describe.skipIf(!isAccountEnabled)("remote Sera account APIs", () => {
  it("should map the Privy owner and build but not send a transfer", async () => {
    const response = await fetch(getRemoteUrl("/__spike/sera-account"), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        accessToken: getRequiredEnvironment("PRIVY_TEST_ACCESS_TOKEN"),
        idempotencyKey: `privy-spike-${getRequiredEnvironment("PRIVY_SPIKE_RUN_ID")}`,
        walletId: getRequiredEnvironment("PRIVY_TEST_WALLET_ID"),
      }),
    });
    const result = await expectJsonResponse<SeraAccountResult>(response);

    expect(result.accountMapping.verified).toBe(true);
    expect(result.accountMapping.privyAddress.toLowerCase()).toBe(
      result.accountMapping.seraOwnerAddress.toLowerCase(),
    );
    expect(result.accountBalances.status).toBe(200);
    expect(result.orders.status).toBe(200);
    expect(result.fills.status).toBe(200);
    expect(result.transferBuild.status).toBe(200);
    expect(result.transferBuild.chainId).toBe(11_155_111);
    expect(result.transferBuild.token).toMatch(/^0x[0-9a-f]{40}$/iu);
  });
});
