import { describe, expect, it } from "vitest";

import {
  createGeminiOpenAiFetch,
  normalizeGeminiSseLine,
} from "./gemini-openai-fetch";

describe("Gemini OpenAI compatibility", () => {
  it("should add a missing tool call index", () => {
    const normalized = normalizeGeminiSseLine(
      'data: {"choices":[{"delta":{"tool_calls":[{"id":"call-1","type":"function"}]}}]}',
    );

    expect(JSON.parse(normalized.slice(6))).toMatchObject({
      choices: [{ delta: { tool_calls: [{ id: "call-1", index: 0 }] } }],
    });
  });

  it("should normalize a streamed response without changing metadata", async () => {
    const upstream = async (): Promise<Response> =>
      new Response(
        'data: {"choices":[{"delta":{"tool_calls":[{"id":"call-1"}]}}]}\n\ndata: [DONE]\n\n',
        { headers: { "content-type": "text/event-stream" }, status: 200 },
      );
    const geminiFetch = createGeminiOpenAiFetch(upstream as typeof fetch);

    const response = await geminiFetch("https://example.invalid");
    const body = await response.text();

    expect(response.status).toBe(200);
    expect(body).toContain('"index":0');
    expect(body).toContain("data: [DONE]");
  });
});
