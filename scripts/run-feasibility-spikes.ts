import { execFileSync, spawnSync } from "node:child_process";
import {
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { gzipSync } from "node:zlib";

type CommandMeasurement = {
  command: string;
  durationMs: number;
  exitCode: number;
  maxRssKb: number;
  userCpuMicros: number;
  systemCpuMicros: number;
};

type BundleMeasurement = {
  bytes: number;
  gzipBytes: number;
  nodeImportCount: number;
};

type RemoteProbeMeasurement = {
  durationMs: number;
  path: string;
  status: number;
  subrequests: number | null;
};

const repositoryRoot = resolve(import.meta.dirname, "..");

function measureCommand(command: string, args: string[]): CommandMeasurement {
  const before = process.resourceUsage();
  const startedAt = performance.now();
  const result = spawnSync(command, args, {
    cwd: repositoryRoot,
    encoding: "utf8",
    env: { ...process.env, CI: "true" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const after = process.resourceUsage();

  if (result.status !== 0) {
    process.stderr.write(result.stderr || result.stdout);
  }

  return {
    command: [command, ...args].join(" "),
    durationMs: Math.round(performance.now() - startedAt),
    exitCode: result.status ?? 1,
    maxRssKb: after.maxRSS,
    userCpuMicros: after.userCPUTime - before.userCPUTime,
    systemCpuMicros: after.systemCPUTime - before.systemCPUTime,
  };
}

function measureBundle(): BundleMeasurement {
  const outputDirectory = mkdtempSync(join(tmpdir(), "sera-strands-bundle-"));
  try {
    execFileSync(
      "pnpm",
      [
        "--dir",
        "apps/backend",
        "exec",
        "wrangler",
        "deploy",
        "--config",
        "../../spikes/worker/wrangler.jsonc",
        "--dry-run",
        "--outdir",
        outputDirectory,
      ],
      {
        cwd: repositoryRoot,
        env: { ...process.env, CI: "true" },
        stdio: "ignore",
      },
    );
    const bundleName = readdirSync(outputDirectory).find((name) =>
      name.endsWith(".js"),
    );
    if (!bundleName) {
      throw new Error("Wrangler dry-run did not emit a JavaScript bundle");
    }
    const bundlePath = join(outputDirectory, bundleName);
    const bundle = readFileSync(bundlePath);
    const source = bundle.toString("utf8");
    const nodeImports = source.match(/(?:from\s+|require\()["']node:/gu) ?? [];
    return {
      bytes: statSync(bundlePath).size,
      gzipBytes: gzipSync(bundle).byteLength,
      nodeImportCount: nodeImports.length,
    };
  } finally {
    rmSync(outputDirectory, { force: true, recursive: true });
  }
}

async function measureRemoteProbe(
  baseUrl: string,
  path: string,
): Promise<RemoteProbeMeasurement> {
  const startedAt = performance.now();
  const response = await fetch(new URL(path, baseUrl), {
    redirect: "error",
  });
  await response.arrayBuffer();
  const subrequests = Number.parseInt(
    response.headers.get("x-spike-subrequests") ?? "",
    10,
  );
  return {
    durationMs: Math.round(performance.now() - startedAt),
    path,
    status: response.status,
    subrequests: Number.isFinite(subrequests) ? subrequests : null,
  };
}

async function run(): Promise<void> {
  const localTests = measureCommand("pnpm", [
    "exec",
    "vitest",
    "run",
    "--config",
    "spikes/worker/vitest.config.ts",
  ]);
  const remoteWorkerUrl = process.env.REMOTE_WORKER_URL;
  const shouldRunRemoteTests = Boolean(
    remoteWorkerUrl && process.env.SKIP_REMOTE_TESTS !== "true",
  );
  const remoteTests = shouldRunRemoteTests
    ? measureCommand("pnpm", [
        "exec",
        "vitest",
        "run",
        "--config",
        "spikes/worker/remote.vitest.config.ts",
      ])
    : null;
  const remoteProbes = remoteWorkerUrl
    ? await Promise.all([
        measureRemoteProbe(remoteWorkerUrl, "/__spike/sera-public"),
        measureRemoteProbe(remoteWorkerUrl, "/__spike/sepolia-rpc"),
      ])
    : null;

  const report = {
    recordedAt: new Date().toISOString(),
    versions: {
      node: process.version,
      gitCommit: execFileSync("git", ["rev-parse", "HEAD"], {
        cwd: repositoryRoot,
        encoding: "utf8",
      }).trim(),
    },
    bundle: measureBundle(),
    localTests,
    remoteTests,
    remoteProbes,
    remoteWorkerConfigured: Boolean(remoteWorkerUrl),
    remoteTestsSkipped: Boolean(remoteWorkerUrl && !shouldRunRemoteTests),
    limitations: [
      "maxRssKb is the peak RSS of the local spike runner, not Cloudflare isolate memory.",
      "Remote CPU and wall time are collected separately from Cloudflare observability logs.",
      "Reported subrequests are explicit endpoint instrumentation and must match the implementation when probes change.",
    ],
  };
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (
    localTests.exitCode !== 0 ||
    (remoteTests && remoteTests.exitCode !== 0)
  ) {
    process.exitCode = 1;
  }
}

await run();
