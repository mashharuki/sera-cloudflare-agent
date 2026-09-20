import { SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";

describe("Strands SDK Worker compatibility", () => {
  it("should reject model spikes when the bearer secret is unavailable", async () => {
    const response = await SELF.fetch("https://spike.local/__spike/model", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ scenario: "japanese-stream" }),
    });

    expect(response.status).toBe(401);
  });

  it("should stream a direct tool call when using the default export", async () => {
    const response = await SELF.fetch("https://spike.local/tool-stream", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ left: 20, right: 22 }),
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/event-stream");

    const body = await response.text();
    expect(body).toContain('event: progress\ndata: {"step":"adding"}');
    expect(body).toContain('event: result\ndata: {"sum":42}');
  });
});
