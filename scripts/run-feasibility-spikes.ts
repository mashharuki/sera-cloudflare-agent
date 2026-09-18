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

function run(): void {
  const localTests = measureCommand("pnpm", [
    "exec",
    "vitest",
    "run",
    "--config",
    "spikes/worker/vitest.config.ts",
  ]);
  const remoteWorkerUrl = process.env.REMOTE_WORKER_URL;
  const remoteTests = remoteWorkerUrl
    ? measureCommand("pnpm", [
        "exec",
        "vitest",
        "run",
        "--config",
        "spikes/worker/remote.vitest.config.ts",
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
    remoteWorkerConfigured: Boolean(remoteWorkerUrl),
    limitations: [
      "maxRssKb is the peak RSS of the local spike runner, not Cloudflare isolate memory.",
      "CPU, subrequest, startup and remote latency require a deployed Worker with observability enabled.",
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

run();
