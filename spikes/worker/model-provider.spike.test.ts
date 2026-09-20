import { describe, expect, it } from "vitest";

import {
  expectJsonResponse,
  getRemoteUrl,
  remoteWorkerUrl,
} from "./remote-fixture";

type ModelSpikeResponse = {
  text: string;
  events: string[];
  toolResult?: { sum: number };
};

const isEnabled = Boolean(remoteWorkerUrl && process.env.SPIKE_TOKEN);

function getHeaders(): Record<string, string> {
  return {
    authorization: `Bearer ${process.env.SPIKE_TOKEN ?? ""}`,
    "content-type": "application/json",
  };
}

describe.skipIf(!isEnabled)("remote model provider", () => {
  it("should stream Japanese text through Gemini", async () => {
    const response = await fetch(getRemoteUrl("/__spike/model"), {
      method: "POST",
      headers: getHeaders(),
      body: JSON.stringify({ scenario: "japanese-stream" }),
    });
    const result = await expectJsonResponse<ModelSpikeResponse>(response);

    expect(result.text).toMatch(/[ぁ-んァ-ヶ一-龠]/u);
    expect(
      result.events.filter((event) => event === "delta").length,
    ).toBeGreaterThan(1);
  });

  it("should execute a structured tool call", async () => {
    const response = await fetch(getRemoteUrl("/__spike/model"), {
      method: "POST",
      headers: getHeaders(),
      body: JSON.stringify({
        scenario: "structured-tool",
        left: 20,
        right: 22,
      }),
    });
    const result = await expectJsonResponse<ModelSpikeResponse>(response);

    expect(result.toolResult).toEqual({ sum: 42 });
  });

  it("should propagate abort without completing the inference", async () => {
    await expect(
      fetch(getRemoteUrl("/__spike/model"), {
        method: "POST",
        headers: getHeaders(),
        body: JSON.stringify({ scenario: "slow" }),
        signal: AbortSignal.timeout(50),
      }),
    ).rejects.toThrow();
  });

  it("should normalize provider errors", async () => {
    const response = await fetch(getRemoteUrl("/__spike/model"), {
      method: "POST",
      headers: getHeaders(),
      body: JSON.stringify({ scenario: "provider-error" }),
    });
    const body = (await response.json()) as {
      code: string;
      retryable: boolean;
    };

    expect(response.status).toBe(502);
    expect(body).toMatchObject({ code: "MODEL_PROVIDER_ERROR" });
    expect(typeof body.retryable).toBe("boolean");
  });
});
