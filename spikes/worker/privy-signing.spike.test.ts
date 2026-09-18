import { describe, expect, it } from "vitest";

import {
  expectJsonResponse,
  getRemoteUrl,
  getRequiredEnvironment,
  remoteWorkerUrl,
} from "./remote-fixture";

const isEnabled = Boolean(
  remoteWorkerUrl && process.env.RUN_MUTATING_PRIVY_SPIKE === "true",
);

type PrivySpikeResponse = {
  privyDid: string;
  walletId: string;
  walletAddress: string;
  ownerVerified: boolean;
  typedDataSignature: string;
  requestHash: string;
  transactionHash: string;
};

describe.skipIf(!isEnabled)("remote Privy signing", () => {
  it("should bind token, owner, EIP-712 and exact request to one idempotent Sepolia action", async () => {
    const body = {
      accessToken: getRequiredEnvironment("PRIVY_TEST_ACCESS_TOKEN"),
      walletId: getRequiredEnvironment("PRIVY_TEST_WALLET_ID"),
      idempotencyKey: `privy-spike-${getRequiredEnvironment("PRIVY_SPIKE_RUN_ID")}`,
    };
    const send = () =>
      fetch(getRemoteUrl("/__spike/privy-signing"), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      }).then(expectJsonResponse<PrivySpikeResponse>);

    const [first, replay] = await Promise.all([send(), send()]);

    expect(first.ownerVerified).toBe(true);
    expect(first.privyDid).toMatch(/^did:privy:/u);
    expect(first.walletAddress).toMatch(/^0x[0-9a-f]{40}$/iu);
    expect(first.typedDataSignature).toMatch(/^0x[0-9a-f]+$/iu);
    expect(first.requestHash).toBe(replay.requestHash);
    expect(first.transactionHash).toBe(replay.transactionHash);
  });
});
