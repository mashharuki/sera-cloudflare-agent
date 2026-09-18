import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";

const operationId = "op-concurrency-spike";

async function prepareOperation(): Promise<void> {
  await env.DB.prepare("DROP TABLE IF EXISTS operations").run();
  await env.DB.prepare(
    `CREATE TABLE operations (
      id TEXT PRIMARY KEY,
      state TEXT NOT NULL,
      broadcast_count INTEGER NOT NULL DEFAULT 0
    )`,
  ).run();
  await env.DB.prepare(
    "INSERT INTO operations (id, state, broadcast_count) VALUES (?, 'READY', 0)",
  )
    .bind(operationId)
    .run();
}

describe("D1 idempotency concurrency", () => {
  beforeEach(async () => {
    await prepareOperation();
  });

  it("should select exactly one broadcast winner across 20 concurrent executions", async () => {
    const attempts = Array.from({ length: 20 }, () =>
      env.DB.prepare(
        `UPDATE operations
         SET state = 'BROADCASTING', broadcast_count = broadcast_count + 1
         WHERE id = ? AND state = 'READY'`,
      )
        .bind(operationId)
        .run(),
    );

    const results = await Promise.all(attempts);
    const winnerCount = results.filter(
      (result) => result.meta.changes === 1,
    ).length;
    const operation = await env.DB.prepare(
      "SELECT state, broadcast_count FROM operations WHERE id = ?",
    )
      .bind(operationId)
      .first<{ state: string; broadcast_count: number }>();

    expect(winnerCount).toBe(1);
    expect(operation).toEqual({ state: "BROADCASTING", broadcast_count: 1 });
  });
});
