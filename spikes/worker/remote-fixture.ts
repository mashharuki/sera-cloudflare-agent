import { expect } from "vitest";

export const remoteWorkerUrl = process.env.REMOTE_WORKER_URL;

export function getRemoteUrl(path: string): URL {
  if (!remoteWorkerUrl) {
    throw new Error("REMOTE_WORKER_URL is required for remote spike tests");
  }
  return new URL(path, remoteWorkerUrl);
}

export async function expectJsonResponse<T>(response: Response): Promise<T> {
  const body = await response.text();
  expect(response.status, body).toBeGreaterThanOrEqual(200);
  expect(response.status, body).toBeLessThan(300);
  expect(response.headers.get("content-type")).toContain("application/json");
  return JSON.parse(body) as T;
}

export function getRequiredEnvironment(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is required for this remote spike`);
  }
  return value;
}
