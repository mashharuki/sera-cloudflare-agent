import { describe, expect, it } from "vitest";

import { getRemoteUrl, remoteWorkerUrl } from "./remote-fixture";

type ServerEvent = {
  id: number;
  event: string;
  data: { userId: string; terminal?: boolean };
};

const isEnabled = Boolean(remoteWorkerUrl && process.env.SPIKE_TOKEN);

function getHeaders(lastEventId?: number): Record<string, string> {
  return {
    authorization: `Bearer ${process.env.SPIKE_TOKEN ?? ""}`,
    ...(lastEventId === undefined
      ? {}
      : { "last-event-id": String(lastEventId) }),
  };
}

async function readEvents(
  responsePromise: Response | Promise<Response>,
  limit = Number.POSITIVE_INFINITY,
): Promise<ServerEvent[]> {
  const response = await responsePromise;
  if (!response.body) {
    throw new Error("SSE response has no body");
  }
  const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
  const events: ServerEvent[] = [];
  let buffer = "";
  while (events.length < limit) {
    const next = await reader.read();
    if (next.done) break;
    buffer += next.value;
    const frames = buffer.split("\n\n");
    buffer = frames.pop() ?? "";
    for (const frame of frames) {
      const id = Number(frame.match(/^id: (.+)$/mu)?.[1]);
      const event = frame.match(/^event: (.+)$/mu)?.[1];
      const data = frame.match(/^data: (.+)$/mu)?.[1];
      if (event && data) events.push({ id, event, data: JSON.parse(data) });
    }
  }
  await reader.cancel();
  return events;
}

describe.skipIf(!isEnabled)("remote SSE durability and isolation", () => {
  it("should remain open beyond 60 seconds and replay from Last-Event-ID", async () => {
    const startedAt = Date.now();
    const runId = crypto.randomUUID();
    const url = getRemoteUrl(
      `/__spike/sse?runId=${runId}&userId=user-a&durationMs=65000`,
    );
    const first = await readEvents(
      await fetch(url, { headers: getHeaders() }),
      2,
    );
    const lastSeen = first.at(-1)?.id;
    expect(lastSeen).toBeTypeOf("number");

    const resumed = await readEvents(
      await fetch(url, { headers: getHeaders(lastSeen) }),
    );
    expect(resumed[0]?.id).toBe((lastSeen ?? 0) + 1);
    expect(resumed.at(-1)?.data.terminal).toBe(true);
    expect(resumed.every(({ data }) => data.userId === "user-a")).toBe(true);
    expect(Date.now() - startedAt).toBeGreaterThanOrEqual(60_000);
  });

  it("should isolate concurrent state for two users", async () => {
    const runId = crypto.randomUUID();
    const [userA, userB] = await Promise.all(
      ["user-a", "user-b"].map((userId) =>
        readEvents(
          fetch(
            getRemoteUrl(
              `/__spike/sse?runId=${runId}-${userId}&userId=${userId}`,
            ),
            { headers: getHeaders() },
          ),
        ),
      ),
    );
    expect(userA.every(({ data }) => data.userId === "user-a")).toBe(true);
    expect(userB.every(({ data }) => data.userId === "user-b")).toBe(true);
  });
});
