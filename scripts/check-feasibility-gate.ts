import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const evidencePath = resolve(
  import.meta.dirname,
  "../docs/evidence/phase-0-feasibility.md",
);
const evidence = readFileSync(evidencePath, "utf8");
const requiredSpikes = [
  "T011",
  "T012",
  "T013",
  "T014",
  "T015",
  "T016",
] as const;
const failures: string[] = [];

for (const taskId of requiredSpikes) {
  const row = evidence
    .split("\n")
    .find((line) => line.startsWith(`| ${taskId} |`));
  if (!row) {
    failures.push(`${taskId}: evidence row is missing`);
    continue;
  }
  const columns = row.split("|").map((column) => column.trim());
  if (columns[2] !== "PASS") {
    failures.push(`${taskId}: expected PASS, got ${columns[2] || "UNKNOWN"}`);
  }
}

if (failures.length > 0) {
  console.error("Feasibility gate is closed:");
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exitCode = 1;
} else {
  console.log("Feasibility gate is open: all blocking spikes passed.");
}
